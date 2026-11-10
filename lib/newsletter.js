'use strict';
// Newsletter workflow: double opt-in subscribers, issue building from a released daily
// edition, and an outbox with retries.
//
// Safety properties this module is built around (see docs/NEWSLETTER.md):
//  - Everything is OFF by default. Sign-up and sending each need their own flag AND a
//    configured transport. There is no real email provider here; "dry-run" writes files.
//  - Only an email address is stored. No IP address, name, profession or health data.
//  - Confirm and unsubscribe tokens are stored as SHA-256 hashes, never in clear text.
//  - Unsubscribing deletes the address and keeps only a hashed tombstone.
//  - An issue contains only reviewed, currently published articles of a released edition.
//  - Nothing here schedules itself. Sending runs only from scripts/newsletter-send.js.
//
// The application runs as ONE web process on a file store. Read-modify-write of the
// subscriber file is serialised through an in-module promise queue. The send script is a
// second process, so it deliberately never writes the subscriber file (it only reads it).

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const { ensureDirectory } = require('./fsync');
const forms = require('./public-forms');
const policy = require('./review-policy');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;      // confirmation links last 7 days
const CONFIRM_RESEND_COOLDOWN_MS = 10 * 60 * 1000;   // do not re-mail the same pending address more often
const BACKOFF_MS = [5, 30, 120, 480].map(m => m * 60 * 1000); // wait after failed attempt 1, 2, 3, 4
const MAX_ATTEMPTS = 5;                              // the 5th failure becomes "gave_up"
const DEFAULT_SEND_LIMIT = 500;                      // most messages one processOutbox call will try
const SUMMARY_MAX = 600;                             // characters of reviewed summary per item

// The exact wording a subscriber agrees to. Change the version whenever the text changes,
// so each record shows which wording the person saw.
const CONSENT_VERSION = '2026-11-09';
const CONSENT_TEXT = 'I agree to receive the PharmacyNews.ai email newsletter at this address. '
  + 'I can unsubscribe at any time using the link in every email. Only my email address is stored.';

const NOT_ADVICE = 'This newsletter is an information service. It is not medical advice and does not '
  + 'replace the linked official sources or a clinician\'s judgement.';

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,100}$/;

function fail(message, status = 409, code) {
  return Object.assign(new Error(message), { status, code });
}

// `now` may be a number (ms), a Date, a function returning ms, or omitted.
function clock(now) {
  if (typeof now === 'function') return now();
  if (now instanceof Date) return now.getTime();
  return Number.isFinite(now) ? now : Date.now();
}
const iso = ms => new Date(ms).toISOString();

// ---------------------------------------------------------------------------
// Paths (resolved on every call so tests and scripts can set CONTENT_DIR first)
// ---------------------------------------------------------------------------

function dir(...parts) {
  return path.join(process.env.CONTENT_DIR || path.join(__dirname, '..', 'content'), 'newsletter', ...parts);
}
const subscribersFile = () => dir('subscribers.json');
const secretFile = () => dir('secret.key');

function validDay(day) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
    && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
}
function outboxFile(day) {
  if (!validDay(day)) throw fail('Invalid edition date', 400);
  return dir('outbox', day + '.json');
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } // a corrupt file is an error, not "empty"
}
async function writeJson(file, value) {
  await ensureDirectory(path.dirname(file));
  await store.durableReplace(file, JSON.stringify(value, null, 2));
}

// One-at-a-time queue for read-modify-write inside this process.
let tail = Promise.resolve();
function serial(fn) {
  const run = tail.then(fn, fn);
  tail = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------------------
// Configuration and feature flags (all default OFF)
// ---------------------------------------------------------------------------

function siteUrl() {
  const u = forms.httpsUrl(process.env.PUBLIC_SITE_URL || '');
  return u ? new URL(u).origin : null; // https origin only, no path or trailing slash
}
function postalAddress() {
  return forms.cleanText(process.env.NEWSLETTER_POSTAL_ADDRESS || '', 300).replace(/\s*[\r\n]+\s*/g, ', ');
}
function transportName() {
  return process.env.NEWSLETTER_TRANSPORT === 'dry-run' ? 'dry-run' : 'none'; // unknown values fail closed
}

// One place that answers "is sign-up open?" and "may we send?", with the reasons why not.
function config() {
  const c = {
    signupFlag: forms.enabled('NEWSLETTER_SIGNUP_ENABLED'),
    sendingFlag: forms.enabled('NEWSLETTER_SENDING_ENABLED'),
    transport: transportName(),
    siteUrl: siteUrl(),
    postalAddress: postalAddress()
  };
  const missing = [];
  if (c.transport === 'none') missing.push('no email transport is configured (NEWSLETTER_TRANSPORT)');
  if (!c.siteUrl) missing.push('PUBLIC_SITE_URL is not an https address');
  if (!c.postalAddress) missing.push('NEWSLETTER_POSTAL_ADDRESS is not set');
  c.signupClosedReasons = [...(c.signupFlag ? [] : ['NEWSLETTER_SIGNUP_ENABLED is not "true"']), ...missing];
  c.sendingClosedReasons = [...(c.sendingFlag ? [] : ['NEWSLETTER_SENDING_ENABLED is not "true"']), ...missing];
  c.signupOpen = c.signupClosedReasons.length === 0;
  c.sendingOpen = c.sendingClosedReasons.length === 0;
  return c;
}

// ---------------------------------------------------------------------------
// Transports
// A transport is { name, async send({ to, subject, html, text, headers }) }.
// send() resolves when the message was accepted and THROWS on any failure.
// ---------------------------------------------------------------------------

const noneTransport = Object.freeze({
  name: 'none',
  async send() { throw fail('No email transport is configured', 503, 'NO_TRANSPORT'); }
});

// Writes each message to newsletter/dry-run/ instead of sending it. Never touches a network.
// The files contain real addresses and working links, so they are owner-only (0600) and
// should be deleted after inspection.
function dryRunTransport() {
  return {
    name: 'dry-run',
    async send(message) {
      const file = dir('dry-run', `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.json`);
      await writeJson(file, { written_at: iso(Date.now()), ...message });
      return { file };
    }
  };
}

function getTransport() {
  return transportName() === 'dry-run' ? dryRunTransport() : noneTransport;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const normaliseEmail = email => (typeof email === 'string' ? email.trim().toLowerCase() : '');
const emailHash = email => sha256('newsletter-email:' + normaliseEmail(email));
const randomToken = () => crypto.randomBytes(32).toString('base64url');

// The unsubscribe link must be re-creatable for every issue, but only its hash may be
// stored. It is therefore derived from the subscriber's random id with a secret key kept
// in newsletter/secret.key. Back that file up together with subscribers.json: without it
// new unsubscribe links cannot be produced and sending stops (it fails closed).
async function secretKey({ create = false } = {}) {
  try {
    const key = (await fs.readFile(secretFile(), 'utf8')).trim();
    if (/^[0-9a-f]{64}$/.test(key)) return key;
    throw fail('Newsletter secret key file is damaged', 500, 'SECRET_KEY');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (!create) throw fail('Newsletter secret key is missing; restore newsletter/secret.key', 500, 'SECRET_KEY');
    const key = crypto.randomBytes(32).toString('hex');
    await ensureDirectory(path.dirname(secretFile()));
    await store.durableReplace(secretFile(), key); // durableReplace creates the file owner-only
    return key;
  }
}
function unsubscribeTokenFor(id, key) {
  return crypto.createHmac('sha256', key).update('unsubscribe:' + id).digest('base64url');
}

// ---------------------------------------------------------------------------
// Subscribers
// Record shapes in subscribers.json:
//   pending / active: { id, status, email, email_hash, consent_version, consent_at,
//                       confirm_token_hash, confirm_expires_at, confirm_sent_at,
//                       unsubscribe_token_hash, created_at, confirmed_at }
//   unsubscribed:     { id, status, email_hash, unsubscribe_token_hash, unsubscribed_at }
// ---------------------------------------------------------------------------

async function readSubscribers() {
  const data = await readJson(subscribersFile(), { version: 1, subscribers: [] });
  if (!Array.isArray(data.subscribers)) throw fail('Newsletter subscriber file is damaged', 500);
  return data;
}

// Pending sign-ups that were never confirmed are removed once their link has expired,
// so an unconfirmed address is not kept longer than a week.
function dropExpiredPending(data, t) {
  data.subscribers = data.subscribers.filter(s => !(s.status === 'pending' && Date.parse(s.confirm_expires_at) <= t));
}

// Creates or refreshes a pending sign-up. The return value is the same shape whether the
// address is new, already pending or already active; `confirmToken` is null when no
// confirmation email should go out (already active, or one was sent minutes ago).
// Callers must show the same text to the visitor in every case.
async function subscribe(email, { consentVersion = CONSENT_VERSION, now } = {}) {
  const address = normaliseEmail(email);
  if (!forms.validEmail(address)) return { ok: false, reason: 'invalid_email' };
  const version = forms.cleanText(String(consentVersion || ''), 40);
  if (!version) return { ok: false, reason: 'consent_required' };
  const t = clock(now);
  return serial(async () => {
    const data = await readSubscribers();
    dropExpiredPending(data, t);
    const hash = emailHash(address);
    const existing = data.subscribers.find(s => s.email_hash === hash && s.status !== 'unsubscribed');
    if (existing?.status === 'active') return { ok: true, confirmToken: null, unsubscribeToken: null, email: address };
    if (existing && existing.confirm_sent_at && t - Date.parse(existing.confirm_sent_at) < CONFIRM_RESEND_COOLDOWN_MS) {
      return { ok: true, confirmToken: null, unsubscribeToken: null, email: address };
    }
    const key = await secretKey({ create: true });
    const confirmToken = randomToken();
    // A returning (previously unsubscribed) address gets a NEW id. Its tombstone stays
    // until the new sign-up is confirmed, and old outbox entries keep pointing at the
    // tombstone, so nothing queued earlier is sent to it.
    const record = existing || { id: crypto.randomBytes(16).toString('hex'), status: 'pending', email: address, email_hash: hash, created_at: iso(t) };
    Object.assign(record, {
      consent_version: version,
      consent_at: iso(t),
      confirm_token_hash: sha256(confirmToken),
      confirm_expires_at: iso(t + CONFIRM_TTL_MS),
      confirm_sent_at: null,
      unsubscribe_token_hash: sha256(unsubscribeTokenFor(record.id, key))
    });
    if (!existing) data.subscribers.push(record);
    await writeJson(subscribersFile(), data);
    return { ok: true, confirmToken, unsubscribeToken: unsubscribeTokenFor(record.id, key), email: address, id: record.id };
  });
}

async function markConfirmationSent(id, now) {
  return serial(async () => {
    const data = await readSubscribers();
    const record = data.subscribers.find(s => s.id === id && s.status === 'pending');
    if (!record) return;
    record.confirm_sent_at = iso(clock(now));
    await writeJson(subscribersFile(), data);
  });
}

// Second step of double opt-in. Only a POST from the confirmation page may call this.
async function confirm(token, { now } = {}) {
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return { ok: false, reason: 'invalid' };
  const t = clock(now);
  return serial(async () => {
    const data = await readSubscribers();
    const hash = sha256(token);
    const record = data.subscribers.find(s => s.status === 'pending' && s.confirm_token_hash === hash);
    if (!record) return { ok: false, reason: 'invalid' };
    if (Date.parse(record.confirm_expires_at) <= t) {
      dropExpiredPending(data, t);
      await writeJson(subscribersFile(), data);
      return { ok: false, reason: 'expired' };
    }
    record.status = 'active';
    record.confirmed_at = iso(t);
    record.confirm_token_hash = null;
    record.confirm_expires_at = null;
    // The fresh confirmation replaces any earlier "unsubscribed" tombstone for this address.
    data.subscribers = data.subscribers.filter(s => !(s.status === 'unsubscribed' && s.email_hash === record.email_hash));
    dropExpiredPending(data, t);
    await writeJson(subscribersFile(), data);
    return { ok: true };
  });
}

// Deletes the address. What remains is a tombstone: status, hashed email, hashed token.
// Works for confirmed and not-yet-confirmed sign-ups, and repeating it is harmless.
async function unsubscribe(token, { now } = {}) {
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return { ok: false, reason: 'invalid' };
  const t = clock(now);
  return serial(async () => {
    const data = await readSubscribers();
    const hash = sha256(token);
    const index = data.subscribers.findIndex(s => s.unsubscribe_token_hash === hash);
    if (index === -1) return { ok: false, reason: 'invalid' };
    const record = data.subscribers[index];
    if (record.status === 'unsubscribed') return { ok: true, already: true };
    data.subscribers[index] = {
      id: record.id, status: 'unsubscribed', email_hash: record.email_hash,
      unsubscribe_token_hash: record.unsubscribe_token_hash, unsubscribed_at: iso(t)
    };
    await writeJson(subscribersFile(), data);
    return { ok: true };
  });
}

// Numbers only. Nothing in this module lists or exports addresses.
async function counts() {
  const out = { pending: 0, active: 0, unsubscribed: 0 };
  for (const s of (await readSubscribers()).subscribers) if (s.status in out) out[s.status]++;
  return out;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Plain-text fields are single-line: no control characters or line breaks from article data.
function line(value, max = 300) {
  return forms.cleanText(String(value ?? ''), max * 2).replace(/\s+/g, ' ').slice(0, max);
}

function unsubscribeUrl(site, token) {
  return `${site}/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
}
function listHeaders(url) {
  return { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}

// Shared footer: unsubscribe link, postal address, "not medical advice".
function footer({ unsubscribe, address }) {
  const where = address || '[postal address not configured]';
  return {
    text: ['--', NOT_ADVICE, `Unsubscribe: ${unsubscribe}`, `PharmacyNews.ai, ${where}`].join('\n'),
    html: `<hr><p style="font-size:13px;color:#555">${esc(NOT_ADVICE)}</p>`
      + `<p style="font-size:13px;color:#555"><a href="${esc(unsubscribe)}">Unsubscribe</a> from this newsletter at any time.</p>`
      + `<p style="font-size:13px;color:#555">PharmacyNews.ai, ${esc(where)}</p>`
  };
}
// Emails use a few inline styles because mail clients ignore stylesheets. No images,
// no remote assets, no tracking pixels or tracked links.
function htmlDocument(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title></head>`
    + `<body style="font-family:Georgia,serif;color:#1c1c1e;max-width:640px;margin:0 auto;padding:16px">${body}</body></html>`;
}

function confirmationMessage({ to, confirmToken, unsubscribeToken, cfg }) {
  const confirmUrl = `${cfg.siteUrl}/newsletter/confirm?token=${encodeURIComponent(confirmToken)}`;
  const unsubscribe = unsubscribeUrl(cfg.siteUrl, unsubscribeToken);
  const foot = footer({ unsubscribe, address: cfg.postalAddress });
  const subject = 'Confirm your PharmacyNews.ai newsletter subscription';
  const intro = 'Someone asked to subscribe this address to the PharmacyNews.ai newsletter.';
  const ignore = 'If this was not you, ignore this email: without confirmation no newsletter is sent and the request is deleted after 7 days.';
  return {
    to, subject,
    text: [intro, '', 'To confirm, open this link and press the confirm button:', confirmUrl, '', ignore, '', foot.text].join('\n'),
    html: htmlDocument(subject, `<h1 style="font-size:20px">Confirm your subscription</h1><p>${esc(intro)}</p>`
      + `<p><a href="${esc(confirmUrl)}">Open the confirmation page</a> and press the confirm button.</p><p>${esc(ignore)}</p>${foot.html}`),
    headers: listHeaders(unsubscribe)
  };
}

// Sign-up as the public form uses it: record the pending sign-up, then send the
// confirmation email. The result never says whether the address was already known.
async function requestSubscription(email, { consentVersion = CONSENT_VERSION, transport, now } = {}) {
  const cfg = config();
  if (!cfg.signupOpen) throw fail('Newsletter sign-up is not open', 503, 'SIGNUP_CLOSED');
  const result = await subscribe(email, { consentVersion, now });
  if (!result.ok) return result;
  if (result.confirmToken) {
    try {
      await (transport || getTransport()).send(confirmationMessage({ to: result.email, confirmToken: result.confirmToken, unsubscribeToken: result.unsubscribeToken, cfg }));
      await markConfirmationSent(result.id, now);
    } catch (e) {
      // Logged without the address. The visitor still sees the generic message and can retry.
      console.error('[NEWSLETTER] Confirmation email could not be handed to the transport:', e.code || e.name || 'error');
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Issue building
// ---------------------------------------------------------------------------

function hostOf(url) { try { return new URL(url).hostname; } catch { return ''; } }

// Same rule as the public /edition/:day page: the edition must be released, and each
// article must still be published at exactly the revision the edition pinned. Articles
// that were corrected or withdrawn since are left out and counted in `unavailable`.
async function editionItems(day) {
  const edition = await require('./editions').read(day);
  if (!edition || edition.status !== 'released') return null;
  const publication = require('./publication');
  const items = [];
  let unavailable = 0;
  for (const ref of edition.items || []) {
    try {
      const a = await store.readArticle('approved', ref.id);
      const link = forms.httpsUrl(a.source_url, 2000);
      if (publication.revision(a) !== ref.revision || !link) { unavailable++; continue; }
      items.push({
        headline: line(a.title, 300),
        source: line(a.source, 120) || hostOf(link),
        published: line(a.provenance?.published_at || a.date_published, 40) || 'Publication date unknown',
        url: link,
        summary: line(a.summary, SUMMARY_MAX) // reviewed summary only; never the article body
      });
    } catch { unavailable++; }
  }
  return { edition, items, unavailable };
}

function renderIssue({ day, note, items, unavailable, unsubscribe, cfg }) {
  const subject = `PharmacyNews.ai daily edition, ${day}`;
  const foot = footer({ unsubscribe, address: cfg.postalAddress });
  const editionLink = cfg.siteUrl ? `${cfg.siteUrl}/edition/${day}` : '';
  const gone = unavailable ? `${unavailable} item(s) from this edition were withdrawn or corrected after release and are not included.` : '';

  const text = [subject, '', ...(note ? [note, ''] : [])];
  items.forEach((item, i) => {
    text.push(`${i + 1}. ${item.headline}`, `   ${item.source} | ${item.published}`);
    if (item.summary) text.push(`   ${item.summary}`);
    text.push(`   Original source: ${item.url}`, '');
  });
  if (gone) text.push(gone, '');
  if (editionLink) text.push(`This edition on the website: ${editionLink}`, '');
  text.push(foot.text);

  const html = htmlDocument(subject, `<h1 style="font-size:22px">${esc(subject)}</h1>`
    + (note ? `<p>${esc(note)}</p>` : '')
    + items.map(item => `<h2 style="font-size:17px;margin-bottom:4px">${esc(item.headline)}</h2>`
      + `<p style="font-size:13px;color:#555;margin-top:0">${esc(item.source)} · ${esc(item.published)}</p>`
      + (item.summary ? `<p>${esc(item.summary)}</p>` : '')
      + `<p><a href="${esc(item.url)}">Read the original source</a></p>`).join('')
    + (gone ? `<p>${esc(gone)}</p>` : '')
    + (editionLink ? `<p><a href="${esc(editionLink)}">This edition on the website</a></p>` : '')
    + foot.html);
  return { subject, text: text.join('\n'), html };
}

// Builds the issue for one day, or returns null when there is nothing that may be sent
// (no released edition, or none of its articles is currently available).
// The html/text returned here are the review copy; each recipient's copy is rendered
// again with their own unsubscribe link (see messageFor).
async function buildIssue(day) {
  if (!validDay(day)) throw fail('Invalid edition date', 400);
  const found = await editionItems(day);
  if (!found || found.items.length === 0) return null;
  const cfg = config();
  const note = line(found.edition.note, 1000);
  const preview = renderIssue({ day, note, items: found.items, unavailable: found.unavailable, cfg,
    unsubscribe: `${cfg.siteUrl || 'https://site-url-not-configured.invalid'}/newsletter/unsubscribe?token=PER-RECIPIENT-LINK` });
  return { day, subject: preview.subject, html: preview.html, text: preview.text, items: found.items, unavailable: found.unavailable, note,
    editionRevision: found.edition.review?.revision || null };
}

// The message one recipient receives: the issue plus their own unsubscribe link and headers.
function messageFor(issue, { to, unsubscribeToken, cfg }) {
  const unsubscribe = unsubscribeUrl(cfg.siteUrl, unsubscribeToken);
  const rendered = renderIssue({ day: issue.day, note: issue.note, items: issue.items, unavailable: issue.unavailable, unsubscribe, cfg });
  return { to, subject: rendered.subject, html: rendered.html, text: rendered.text, headers: listHeaders(unsubscribe) };
}

// ---------------------------------------------------------------------------
// Outbox
// newsletter/outbox/<day>.json holds one entry per recipient, by subscriber id only
// (no addresses), so unsubscribing really does remove the address from disk:
//   { id, state: pending|failed|sent|gave_up|skipped, attempts, last_attempt_at,
//     next_attempt_at, last_error, sent_at }
// ---------------------------------------------------------------------------

function assertSendingOpen(transport) {
  const cfg = config();
  const reasons = cfg.sendingClosedReasons.filter(r => !(transport && r.startsWith('no email transport')));
  if (transport && transport.name === 'none') reasons.push('the transport is "none"');
  if (reasons.length) throw fail('Newsletter sending is not enabled: ' + reasons.join('; '), 403, 'SENDING_CLOSED');
  return cfg;
}

// A human editor queues one released edition for the current confirmed subscribers.
// Queuing does not send anything.
async function queueIssue(day, principal, { now } = {}) {
  if (!policy.human(principal, 'editor')) throw fail('An authenticated human editor is required to queue a newsletter', 403, 'EDITOR_REQUIRED');
  assertSendingOpen();
  const file = outboxFile(day);
  const t = clock(now);
  return serial(async () => {
    if (await readJson(file, null)) throw fail(`The ${day} issue is already queued`, 409, 'ALREADY_QUEUED');
    const issue = await buildIssue(day);
    if (!issue) throw fail(`No released edition with available articles for ${day}`, 409, 'NO_ISSUE');
    const active = (await readSubscribers()).subscribers.filter(s => s.status === 'active');
    if (!active.length) throw fail('There are no confirmed subscribers to send to', 409, 'NO_RECIPIENTS');
    const outbox = {
      version: 1, day, subject: issue.subject, edition_revision: issue.editionRevision,
      queued_at: iso(t), queued_by: principal.id,
      recipients: active.map(s => ({ id: s.id, state: 'pending', attempts: 0, last_attempt_at: null, next_attempt_at: null, last_error: null, sent_at: null }))
    };
    await writeJson(file, outbox);
    return summarise(outbox, t);
  });
}

function isDue(r, t) {
  return r.state === 'pending' || (r.state === 'failed' && Date.parse(r.next_attempt_at) <= t);
}
function summarise(outbox, t = Date.now()) {
  const states = { pending: 0, failed: 0, sent: 0, gave_up: 0, skipped: 0 };
  for (const r of outbox.recipients) states[r.state] = (states[r.state] || 0) + 1;
  return { day: outbox.day, subject: outbox.subject, queued_at: outbox.queued_at, queued_by: outbox.queued_by,
    total: outbox.recipients.length, states, due: outbox.recipients.filter(r => isDue(r, t)).length };
}

async function readOutbox(day) { return readJson(outboxFile(day), null); }

async function listOutboxes({ now } = {}) {
  let names;
  try { names = await fs.readdir(dir('outbox')); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const out = [];
  for (const name of names.filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().reverse()) {
    const outbox = await readOutbox(name.slice(0, 10));
    if (outbox) out.push(summarise(outbox, clock(now)));
  }
  return out;
}

// Error text kept for the operator must not contain an address a provider echoed back.
function safeError(e) {
  return forms.cleanText(String(e?.message || e || 'send failed'), 300).replace(/[^\s@<>"']+@[^\s@<>"']+/g, '[address removed]').slice(0, 200);
}

// Sends what is due: new recipients and failed ones whose waiting time has passed.
// State is saved after every single recipient, so a crash or a thrown transport error
// never loses what already happened. Delivery is "at least once": if the process dies
// between a successful send and the save, that one recipient may get a second copy.
async function processOutbox({ transport, now, limit = DEFAULT_SEND_LIMIT, day } = {}) {
  const use = transport || getTransport();
  const cfg = assertSendingOpen(transport);
  if (!use || typeof use.send !== 'function' || use.name === 'none') throw fail('Newsletter sending is not enabled: no transport', 403, 'SENDING_CLOSED');
  const key = await secretKey(); // never created here: a missing key stops sending
  const days = day ? [day] : (await listOutboxes({ now })).map(o => o.day);
  const summary = { transport: use.name, attempted: 0, sent: 0, failed: 0, gave_up: 0, skipped: 0, blocked: [], days: [] };

  for (const d of days) {
    const file = outboxFile(d);
    const outbox = await readJson(file, null);
    if (!outbox) { summary.blocked.push({ day: d, reason: 'not queued' }); continue; }
    // Rebuilt at send time, so anything withdrawn or corrected since queuing is left out.
    const issue = await buildIssue(d);
    if (!issue) { summary.blocked.push({ day: d, reason: 'edition no longer has available articles' }); continue; }

    for (const r of outbox.recipients) {
      if (summary.attempted >= limit) break;
      const t = clock(now);
      if (!isDue(r, t)) continue;
      // Read fresh for every recipient: an unsubscribe a moment ago must be respected.
      const subscriber = (await readSubscribers()).subscribers.find(s => s.id === r.id);
      const token = unsubscribeTokenFor(r.id, key);
      if (!subscriber || subscriber.status !== 'active' || !subscriber.email) {
        Object.assign(r, { state: 'skipped', last_error: 'no longer subscribed', next_attempt_at: null });
        summary.skipped++;
      } else if (sha256(token) !== subscriber.unsubscribe_token_hash) {
        // Without a working unsubscribe link the message must not go out.
        Object.assign(r, { state: 'gave_up', last_error: 'unsubscribe link could not be created (secret key mismatch)', next_attempt_at: null });
        summary.gave_up++;
      } else {
        summary.attempted++;
        r.attempts++;
        r.last_attempt_at = iso(t);
        try {
          await use.send(messageFor(issue, { to: subscriber.email, unsubscribeToken: token, cfg }));
          Object.assign(r, { state: 'sent', sent_at: iso(t), next_attempt_at: null, last_error: null });
          summary.sent++;
        } catch (e) {
          r.last_error = safeError(e);
          if (r.attempts >= MAX_ATTEMPTS) { r.state = 'gave_up'; r.next_attempt_at = null; summary.gave_up++; }
          else { r.state = 'failed'; r.next_attempt_at = iso(t + BACKOFF_MS[r.attempts - 1]); summary.failed++; }
        }
      }
      await writeJson(file, outbox);
    }
    summary.days.push(summarise(outbox, clock(now)));
  }
  return summary;
}

module.exports = {
  // configuration
  config, getTransport, dryRunTransport, noneTransport, CONSENT_VERSION, CONSENT_TEXT, NOT_ADVICE,
  // subscribers
  subscribe, requestSubscription, confirm, unsubscribe, counts, TOKEN_SHAPE,
  // issues and outbox
  buildIssue, messageFor, queueIssue, processOutbox, listOutboxes, readOutbox, validDay,
  // constants used by tests and documentation
  CONFIRM_TTL_MS, CONFIRM_RESEND_COOLDOWN_MS, BACKOFF_MS, MAX_ATTEMPTS, dir
};
