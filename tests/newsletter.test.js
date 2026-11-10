'use strict';
// Newsletter workflow tests. Everything is local: a temporary content directory,
// synthetic addresses at example.com, fake transports, and loopback HTTP only.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

// CONTENT_DIR must be set before any application module is loaded.
const root = require('fs').mkdtempSync(path.join(os.tmpdir(), 'pharmacy-newsletter-'));
process.env.CONTENT_DIR = root;
delete process.env.ALLOW_COLLECTION; delete process.env.ALLOW_MODEL_CALLS; delete process.env.RUN_SCHEDULED_JOBS;
delete process.env.REVIEWER_REGISTRY_FILE;
// Fixture-only administrator; the hash is generated per run and never stored.
const hash = require('bcrypt').hashSync('fixture-newsletter-password', 4);
process.env.ADMIN_USERNAME = 'offline-test-reviewer';
process.env.ADMIN_PASSWORD_HASH = hash;

const express = require('express');
const store = require('../lib/store');
const pub = require('../lib/publication');
const editions = require('../lib/editions');
const newsletter = require('../lib/newsletter');
const routes = require('../routes/newsletter');
const { sourceApprovals } = require('./approval-fixture');

const editor = { id: 'fixture-editor', type: 'human', authenticated: true, roles: ['editor'] };
const fixtureSession = () => ({ authenticated: true, username: 'offline-test-reviewer', account_source: 'legacy_admin', credential: require('../lib/reviewers').credentialDigest(hash) });
const FLAGS = ['NEWSLETTER_SIGNUP_ENABLED', 'NEWSLETTER_SENDING_ENABLED', 'NEWSLETTER_TRANSPORT', 'NEWSLETTER_POSTAL_ADDRESS', 'PUBLIC_SITE_URL'];
const POSTAL = '1 Fixture Street, Testville, TX 00000';
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function configure(overrides = {}) {
  for (const f of FLAGS) delete process.env[f];
  Object.assign(process.env, { NEWSLETTER_POSTAL_ADDRESS: POSTAL, PUBLIC_SITE_URL: 'https://news.example.com', ...overrides });
}
const openSignup = () => configure({ NEWSLETTER_SIGNUP_ENABLED: 'true', NEWSLETTER_TRANSPORT: 'dry-run' });
const openSending = () => configure({ NEWSLETTER_SENDING_ENABLED: 'true', NEWSLETTER_TRANSPORT: 'dry-run' });

// Each test starts with no subscribers, no outbox, every flag at its default (off), and a
// fresh app (so one test's sign-up posts do not use up another's rate limit).
beforeEach(async () => {
  url = await startApp();
  for (const f of FLAGS) delete process.env[f];
  await fs.rm(path.join(root, 'newsletter'), { recursive: true, force: true });
});

// ---- HTTP fixture -----------------------------------------------------------------
const servers = [];
async function startApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use((req, res, next) => { if (req.get('x-fixture-auth') === 'yes') req.session = fixtureSession(); next(); });
  app.use('/', routes.createPublicRouter()); // a fresh router has its own rate-limit counters
  app.use('/admin', routes.createAdminRouter());
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  servers.push(server);
  return 'http://127.0.0.1:' + server.address().port;
}
let url;
before(() => store.ensureDirectories());
after(async () => { await Promise.all(servers.map(s => new Promise(r => s.close(r)))); await fs.rm(root, { recursive: true, force: true }); });

async function get(route, headers = {}, base = url) {
  const r = await fetch(base + route, { headers, redirect: 'manual' });
  return { status: r.status, text: await r.text(), headers: r.headers };
}
async function post(route, fields = {}, headers = {}, base = url) {
  const r = await fetch(base + route, { method: 'POST', redirect: 'manual', body: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base, ...headers } });
  return { status: r.status, text: await r.text(), headers: r.headers };
}
const admin = { 'x-fixture-auth': 'yes' };

// Messages the dry-run transport wrote, oldest first.
async function dryRunMessages() {
  const dir = path.join(root, 'newsletter', 'dry-run');
  let names; try { names = (await fs.readdir(dir)).sort(); } catch { return []; }
  return Promise.all(names.map(async n => JSON.parse(await fs.readFile(path.join(dir, n), 'utf8'))));
}
const tokenFrom = (text, kind) => new RegExp(`/newsletter/${kind}\\?token=([A-Za-z0-9_-]+)`).exec(text)?.[1];
const subscribersOnDisk = async () => fs.readFile(path.join(root, 'newsletter', 'subscribers.json'), 'utf8').catch(() => '');

// ---- Edition fixture: the same review -> approvals -> publish -> draft -> release path the application uses.
// Fixture stories are dated inside the 90-day freshness window (relative to the test run).
const RECENT_DAY = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
async function publishArticle(id, fields = {}) {
  const article = { id, slug: id, status: 'pending', title: 'Synthetic regulator notice ' + id, source: 'Example Agency',
    source_url: 'https://example.org/notices/' + id, date_published: RECENT_DAY, content_kind: 'news',
    summary: 'An original synthetic summary written for this local fixture only.',
    body: '<p>' + 'Original synthetic editorial text for a local fixture. '.repeat(4) + '</p>', ...fields };
  await store.writeArticle('pending', id, article);
  const { revision } = await pub.preview(id);
  await pub.review(id, revision, editor, { confirmed: true, contentKind: 'news' });
  await sourceApprovals(pub, id);
  return pub.publish(id, editor.id);
}
async function releaseEdition(day, ids) {
  const e = await editions.draft(day, ids, 'Synthetic edition note', editor);
  return editions.release(day, editions.revision(e), editor, true);
}
// A transport that records messages; `failFor` makes chosen recipients fail.
function fakeTransport(failFor = () => false) {
  const sent = [];
  return { name: 'fake', sent, async send(m) { if (failFor(m)) throw new Error(`550 mailbox ${m.to} rejected`); sent.push(m); } };
}

// ====================================================================================
// Sign-up and double opt-in
// ====================================================================================

test('sign-up is closed by default: page says so, form is disabled, POST is refused with 503', async () => {
  const page = await get('/newsletter');
  assert.equal(page.status, 200);
  assert.match(page.text, /Sign-up is not open yet/);
  assert.match(page.text, /<button class="btn-primary" type="submit" disabled>/);
  const r = await post('/newsletter/subscribe', { email: 'reader@example.com', consent: 'yes' });
  assert.equal(r.status, 503);
  assert.match(r.text, /not open yet/);
  assert.equal(await subscribersOnDisk(), '');
});

test('sign-up stays closed when the transport is none, or the postal address or https site URL is missing', async () => {
  for (const env of [
    { NEWSLETTER_SIGNUP_ENABLED: 'true' },                                                        // transport defaults to none
    { NEWSLETTER_SIGNUP_ENABLED: 'true', NEWSLETTER_TRANSPORT: 'none' },
    { NEWSLETTER_SIGNUP_ENABLED: 'true', NEWSLETTER_TRANSPORT: 'smtp' },                          // unknown values fail closed
    { NEWSLETTER_SIGNUP_ENABLED: 'true', NEWSLETTER_TRANSPORT: 'dry-run', NEWSLETTER_POSTAL_ADDRESS: '' },
    { NEWSLETTER_SIGNUP_ENABLED: 'true', NEWSLETTER_TRANSPORT: 'dry-run', PUBLIC_SITE_URL: 'http://news.example.com' },
    { NEWSLETTER_SIGNUP_ENABLED: 'yes', NEWSLETTER_TRANSPORT: 'dry-run' }                         // only the exact word "true" opens it
  ]) {
    configure(env);
    assert.equal(newsletter.config().signupOpen, false, JSON.stringify(env));
    assert.equal((await post('/newsletter/subscribe', { email: 'reader@example.com', consent: 'yes' })).status, 503, JSON.stringify(env));
    assert.match((await get('/newsletter')).text, /Sign-up is not open yet/);
  }
  assert.equal(await subscribersOnDisk(), '');
  await assert.rejects(newsletter.requestSubscription('reader@example.com'), /not open/);
});

test('double opt-in happy path over HTTP; GET on the confirm link changes nothing', async () => {
  openSignup();
  const page = await get('/newsletter');
  assert.doesNotMatch(page.text, /Sign-up is not open yet/);
  assert.doesNotMatch(page.text, /disabled/);

  const r = await post('/newsletter/subscribe', { email: 'Reader@Example.com', consent: 'yes' });
  assert.equal(r.status, 200);
  assert.match(r.text, /Check your email/);
  assert.deepEqual(await newsletter.counts(), { pending: 1, active: 0, unsubscribed: 0 });

  // Stored: lower-cased email only; tokens as hashes; no IP address or profile data.
  const disk = JSON.parse(await subscribersOnDisk());
  const record = disk.subscribers[0];
  assert.equal(record.email, 'reader@example.com');
  assert.equal(record.consent_version, newsletter.CONSENT_VERSION);
  assert.ok(Date.parse(record.consent_at));
  assert.deepEqual(Object.keys(record).sort(), ['confirm_expires_at', 'confirm_sent_at', 'confirm_token_hash', 'consent_at', 'consent_version', 'created_at', 'email', 'email_hash', 'id', 'status', 'unsubscribe_token_hash']);

  const [mail] = await dryRunMessages();
  assert.equal(mail.to, 'reader@example.com');
  const token = tokenFrom(mail.text, 'confirm');
  assert.ok(token);
  assert.ok(!JSON.stringify(disk).includes(token), 'confirm token must be stored only as a hash');
  assert.match(mail.text, new RegExp(POSTAL));
  assert.match(mail.text, /not medical advice/);
  assert.match(mail.headers['List-Unsubscribe'], /^<https:\/\/news\.example\.com\/newsletter\/unsubscribe\?token=[\w-]+>$/);

  // Opening the link (as a mail scanner would) shows a button and does not activate.
  const shown = await get('/newsletter/confirm?token=' + token);
  assert.equal(shown.status, 200);
  assert.match(shown.text, /<form class="form-grid" method="post" action="\/newsletter\/confirm">/);
  assert.match(shown.text, /<meta name="robots" content="noindex">/);
  assert.equal(shown.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await newsletter.counts(), { pending: 1, active: 0, unsubscribed: 0 });

  const done = await post('/newsletter/confirm', { token });
  assert.equal(done.status, 200);
  assert.match(done.text, /Subscription confirmed/);
  assert.deepEqual(await newsletter.counts(), { pending: 0, active: 1, unsubscribed: 0 });
  // A used link cannot be replayed.
  assert.equal((await post('/newsletter/confirm', { token })).status, 400);
});

test('confirmation tokens expire after 7 days and wrong tokens are refused', async () => {
  const t0 = Date.parse('2026-03-01T00:00:00Z');
  const s = await newsletter.subscribe('late@example.com', { now: t0 });
  assert.equal(s.ok, true);
  assert.deepEqual(await newsletter.confirm('x'.repeat(43), { now: t0 }), { ok: false, reason: 'invalid' });
  assert.deepEqual(await newsletter.confirm('', { now: t0 }), { ok: false, reason: 'invalid' });
  assert.deepEqual(await newsletter.confirm(s.confirmToken, { now: t0 + newsletter.CONFIRM_TTL_MS }), { ok: false, reason: 'expired' });
  // The expired request and its address are gone.
  assert.deepEqual(await newsletter.counts(), { pending: 0, active: 0, unsubscribed: 0 });
  assert.ok(!(await subscribersOnDisk()).includes('late@example.com'));
  // Just inside the window it works.
  const s2 = await newsletter.subscribe('ontime@example.com', { now: t0 });
  assert.deepEqual(await newsletter.confirm(s2.confirmToken, { now: t0 + newsletter.CONFIRM_TTL_MS - 1 }), { ok: true });
});

test('responses are identical for a new, a pending and an already subscribed address', async () => {
  openSignup();
  const fields = { email: 'same@example.com', consent: 'yes' };
  const first = await post('/newsletter/subscribe', fields);          // new
  const second = await post('/newsletter/subscribe', fields);         // pending
  const token = tokenFrom((await dryRunMessages())[0].text, 'confirm');
  assert.equal((await post('/newsletter/confirm', { token })).status, 200);
  const third = await post('/newsletter/subscribe', fields);          // active
  const other = await post('/newsletter/subscribe', { email: 'other@example.com', consent: 'yes' });
  for (const r of [second, third, other]) { assert.equal(r.status, first.status); assert.equal(r.text, first.text); }
  assert.doesNotMatch(first.text, /@|same|other/, 'the page never echoes the address');
  // An active subscriber is not re-mailed, and a pending one is not mailed twice within minutes.
  assert.deepEqual((await dryRunMessages()).map(m => m.to), ['same@example.com', 'other@example.com']);
  assert.deepEqual(await newsletter.counts(), { pending: 1, active: 1, unsubscribed: 0 });
});

test('invalid addresses and missing consent are refused without storing anything', async () => {
  openSignup();
  assert.equal((await post('/newsletter/subscribe', { email: 'not-an-address', consent: 'yes' })).status, 400);
  assert.equal((await post('/newsletter/subscribe', { email: 'reader@example.com' })).status, 400);
  assert.deepEqual(await newsletter.subscribe('a b@example.com'), { ok: false, reason: 'invalid_email' });
  assert.equal(await subscribersOnDisk(), '');
});

test('honeypot gets the generic success page but stores and sends nothing; cross-site posts are refused', async () => {
  openSignup();
  const genuine = await post('/newsletter/subscribe', { email: 'real@example.com', consent: 'yes' });
  const bot = await post('/newsletter/subscribe', { email: 'bot@example.com', consent: 'yes', website: 'https://spam.example.com' });
  assert.equal(bot.status, 200);
  assert.equal(bot.text, genuine.text);
  assert.ok(!(await subscribersOnDisk()).includes('bot@example.com'));
  assert.equal((await dryRunMessages()).length, 1);

  const cross = await post('/newsletter/subscribe', { email: 'x@example.com', consent: 'yes' }, { origin: 'https://attacker.example.com' });
  assert.equal(cross.status, 403);
  const r = await fetch(url + '/newsletter/subscribe', { method: 'POST', body: 'email=y%40example.com&consent=yes', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(r.status, 403, 'no Origin and no Referer is refused');
  assert.equal((await post('/newsletter/confirm', { token: 'x'.repeat(43) }, { origin: 'https://attacker.example.com' })).status, 403);
  assert.deepEqual(await newsletter.counts(), { pending: 1, active: 0, unsubscribed: 0 });
});

test('sign-up posts are rate limited to 5 per hour per client', async () => {
  openSignup();
  const base = url;
  for (let i = 0; i < 5; i++) assert.equal((await post('/newsletter/subscribe', { email: `r${i}@example.com`, consent: 'yes' }, {}, base)).status, 200);
  const blocked = await post('/newsletter/subscribe', { email: 'r5@example.com', consent: 'yes' }, {}, base);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.ok(!(await subscribersOnDisk()).includes('r5@example.com'));
});

test('oversized form bodies are refused', async () => {
  openSignup();
  assert.equal((await post('/newsletter/subscribe', { email: 'big@example.com', consent: 'yes', pad: 'x'.repeat(11000) })).status, 413);
});

// ====================================================================================
// Unsubscribe
// ====================================================================================

test('unsubscribe: GET changes nothing, POST deletes the address and leaves a hashed tombstone', async () => {
  const s = await newsletter.subscribe('leaver@example.com');
  await newsletter.confirm(s.confirmToken);
  const shown = await get('/newsletter/unsubscribe?token=' + s.unsubscribeToken);
  assert.equal(shown.status, 200);
  assert.match(shown.text, /method="post" action="\/newsletter\/unsubscribe"/);
  assert.deepEqual(await newsletter.counts(), { pending: 0, active: 1, unsubscribed: 0 });
  assert.equal((await post('/newsletter/unsubscribe', { token: s.unsubscribeToken }, { origin: 'https://attacker.example.com' })).status, 403);

  const done = await post('/newsletter/unsubscribe', { token: s.unsubscribeToken });
  assert.equal(done.status, 200);
  assert.match(done.text, /You are unsubscribed/);
  assert.deepEqual(await newsletter.counts(), { pending: 0, active: 0, unsubscribed: 1 });
  const disk = await subscribersOnDisk();
  assert.ok(!disk.includes('leaver@example.com'));
  assert.ok(!disk.includes(s.unsubscribeToken));
  assert.deepEqual(Object.keys(JSON.parse(disk).subscribers[0]).sort(), ['email_hash', 'id', 'status', 'unsubscribe_token_hash', 'unsubscribed_at']);
  // Repeating is harmless; an unknown token is refused.
  assert.equal((await post('/newsletter/unsubscribe', { token: s.unsubscribeToken })).status, 200);
  assert.equal((await post('/newsletter/unsubscribe', { token: 'y'.repeat(43) })).status, 400);

  // Signing up again needs a fresh confirmation before the address is active again.
  const again = await newsletter.subscribe('leaver@example.com');
  assert.deepEqual(await newsletter.counts(), { pending: 1, active: 0, unsubscribed: 1 });
  await newsletter.confirm(again.confirmToken);
  assert.deepEqual(await newsletter.counts(), { pending: 0, active: 1, unsubscribed: 0 });
  assert.notEqual(again.id, s.id);
});

test('one-click unsubscribe (List-Unsubscribe-Post) works without an Origin header', async () => {
  const s = await newsletter.subscribe('oneclick@example.com');
  await newsletter.confirm(s.confirmToken);
  const r = await fetch(`${url}/newsletter/unsubscribe?token=${s.unsubscribeToken}`, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(r.status, 200);
  assert.deepEqual(await newsletter.counts(), { pending: 0, active: 0, unsubscribed: 1 });
  // Without the one-click body, a token in the query string alone is not enough for a cross-site POST.
  const s2 = await newsletter.subscribe('stay@example.com');
  await newsletter.confirm(s2.confirmToken);
  const r2 = await fetch(`${url}/newsletter/unsubscribe?token=${s2.unsubscribeToken}`, { method: 'POST', body: 'x=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(r2.status, 403);
  assert.equal((await newsletter.counts()).active, 1);
});

// ====================================================================================
// Issue building
// ====================================================================================

test('buildIssue returns null without a released edition and rejects invalid dates', async () => {
  configure();
  assert.equal(await newsletter.buildIssue('2026-02-01'), null);
  await publishArticle('nl-draft-only');
  await editions.draft('2026-02-02', ['nl-draft-only'], 'Draft, not released', editor);
  assert.equal(await newsletter.buildIssue('2026-02-02'), null, 'a draft edition is not an issue');
  await assert.rejects(newsletter.buildIssue('2026-02-31'), /Invalid edition date/);
  await assert.rejects(newsletter.buildIssue('../../etc'), /Invalid edition date/);
});

test('buildIssue lists headline, source, date, https link and reviewed summary; escapes a hostile headline; no body, images or tracking', async () => {
  configure();
  const hostile = '<script>alert("x")</script> <img src="https://tracker.example.com/p.png"> Tom & "Jerry"';
  await publishArticle('nl-hostile', { title: hostile, summary: 'Summary with <b>markup</b> & an "attribute" breaker.', body: '<p>' + 'BODY-ONLY-MARKER text that must never be emailed. '.repeat(4) + '</p>' });
  await publishArticle('nl-plain');
  await releaseEdition('2026-02-03', ['nl-hostile', 'nl-plain']);

  const issue = await newsletter.buildIssue('2026-02-03');
  assert.equal(issue.day, '2026-02-03');
  assert.equal(issue.items.length, 2);
  assert.equal(issue.unavailable, 0);
  assert.deepEqual(issue.items[1], { headline: 'Synthetic regulator notice nl-plain', source: 'Example Agency', published: RECENT_DAY, url: 'https://example.org/notices/nl-plain', summary: 'An original synthetic summary written for this local fixture only.' });
  assert.equal(issue.items[0].headline, hostile);

  assert.doesNotMatch(issue.html, /<script|<img|<b>|<iframe|<link/i);
  assert.match(issue.html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(issue.html, /Tom &amp; &quot;Jerry&quot;/);
  // The only links are the original sources, the edition page and the unsubscribe page.
  const links = [...issue.html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(links, ['https://example.org/notices/nl-hostile', 'https://example.org/notices/nl-plain', 'https://news.example.com/edition/2026-02-03', 'https://news.example.com/newsletter/unsubscribe?token=PER-RECIPIENT-LINK']);
  for (const body of [issue.html, issue.text]) {
    assert.doesNotMatch(body, /BODY-ONLY-MARKER/);
    assert.match(body, /not medical advice/);
    assert.ok(body.includes(POSTAL));
  }
  assert.match(issue.text, /Original source: https:\/\/example\.org\/notices\/nl-plain/);

  // Each recipient's copy carries their own link and the list headers.
  const m = newsletter.messageFor(issue, { to: 'reader@example.com', unsubscribeToken: 'tok_' + 'a'.repeat(30), cfg: newsletter.config() });
  assert.equal(m.headers['List-Unsubscribe'], `<https://news.example.com/newsletter/unsubscribe?token=tok_${'a'.repeat(30)}>`);
  assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(m.html.includes('token=tok_') && m.text.includes('token=tok_'));
});

test('buildIssue leaves out corrected and withdrawn articles, and returns null when none remain', async () => {
  configure();
  await publishArticle('nl-keep'); await publishArticle('nl-change'); await publishArticle('nl-withdraw');
  await releaseEdition('2026-02-04', ['nl-keep', 'nl-change', 'nl-withdraw']);
  assert.equal((await newsletter.buildIssue('2026-02-04')).items.length, 3);

  // A correction published after release changes the revision the edition pinned.
  const { revision } = await pub.preview('nl-change');
  await pub.edit('nl-change', { title: 'Corrected headline', correction_reason: 'Fixture correction' }, revision, editor.id);
  assert.equal((await newsletter.buildIssue('2026-02-04')).items.length, 3, 'an unpublished draft correction does not change the issue');
  const draft = await pub.preview('nl-change');
  await pub.review('nl-change', draft.revision, editor, { confirmed: true, contentKind: 'news' });
  await sourceApprovals(pub, 'nl-change');
  await pub.publish('nl-change', editor.id);
  await pub.unpublish('nl-withdraw', editor.id, 'Fixture withdrawal');

  const issue = await newsletter.buildIssue('2026-02-04');
  assert.deepEqual(issue.items.map(i => i.url), ['https://example.org/notices/nl-keep']);
  assert.equal(issue.unavailable, 2);
  assert.doesNotMatch(issue.html, /Corrected headline|nl-withdraw/);
  assert.match(issue.text, /2 item\(s\) from this edition were withdrawn or corrected/);

  await pub.unpublish('nl-keep', editor.id, 'Fixture withdrawal');
  assert.equal(await newsletter.buildIssue('2026-02-04'), null);
});

// ====================================================================================
// Outbox
// ====================================================================================

async function activeSubscriber(email) {
  const s = await newsletter.subscribe(email);
  assert.deepEqual(await newsletter.confirm(s.confirmToken), { ok: true });
  return s;
}

test('queueIssue: refused without the sending flag, for a non-editor, without an edition, and a second time', async () => {
  await publishArticle('nl-queue');
  await releaseEdition('2026-02-05', ['nl-queue']);
  await activeSubscriber('q1@example.com');

  configure({ NEWSLETTER_TRANSPORT: 'dry-run' }); // flag off
  await assert.rejects(newsletter.queueIssue('2026-02-05', editor), /not enabled/);
  configure({ NEWSLETTER_SENDING_ENABLED: 'true' }); // transport none
  await assert.rejects(newsletter.queueIssue('2026-02-05', editor), /not enabled/);

  openSending();
  for (const principal of [null, { ...editor, roles: ['evidence_reviewer'] }, { ...editor, type: 'service' }, { ...editor, authenticated: false }]) {
    await assert.rejects(newsletter.queueIssue('2026-02-05', principal), /human editor/);
  }
  await assert.rejects(newsletter.queueIssue('2026-02-06', editor), /No released edition/);
  assert.equal(await newsletter.readOutbox('2026-02-05'), null);

  const summary = await newsletter.queueIssue('2026-02-05', editor);
  assert.equal(summary.total, 1);
  assert.equal(summary.states.pending, 1);
  await assert.rejects(newsletter.queueIssue('2026-02-05', editor), /already queued/);
  // The outbox refers to subscribers by id; it holds no addresses.
  assert.doesNotMatch(await fs.readFile(path.join(root, 'newsletter', 'outbox', '2026-02-05.json'), 'utf8'), EMAIL_PATTERN);
});

test('queueIssue takes only confirmed subscribers and refuses when there are none', async () => {
  await publishArticle('nl-none');
  await releaseEdition('2026-02-07', ['nl-none']);
  openSending();
  await newsletter.subscribe('pending-only@example.com');
  await assert.rejects(newsletter.queueIssue('2026-02-07', editor), /no confirmed subscribers/);
});

test('processOutbox refuses unless sending is enabled and the transport is not none', async () => {
  await publishArticle('nl-refuse');
  await releaseEdition('2026-02-08', ['nl-refuse']);
  await activeSubscriber('p1@example.com');
  openSending();
  await newsletter.queueIssue('2026-02-08', editor);
  const transport = fakeTransport();

  configure({ NEWSLETTER_TRANSPORT: 'dry-run' });
  await assert.rejects(newsletter.processOutbox({ transport }), /not enabled/);
  configure({ NEWSLETTER_SENDING_ENABLED: 'true' });
  await assert.rejects(newsletter.processOutbox({}), /not enabled/);
  await assert.rejects(newsletter.processOutbox({ transport: newsletter.noneTransport }), /not enabled/);
  assert.equal(transport.sent.length, 0);
  assert.equal((await newsletter.readOutbox('2026-02-08')).recipients[0].state, 'pending');
});

test('processOutbox sends once, with unsubscribe link, postal address, list headers and the not-medical-advice line', async () => {
  await publishArticle('nl-send');
  await releaseEdition('2026-02-09', ['nl-send']);
  const a = await activeSubscriber('a@example.com'); const b = await activeSubscriber('b@example.com');
  openSending();
  await newsletter.queueIssue('2026-02-09', editor);
  const transport = fakeTransport();
  const first = await newsletter.processOutbox({ transport });
  assert.deepEqual([first.attempted, first.sent, first.failed, first.skipped], [2, 2, 0, 0]);
  assert.deepEqual(transport.sent.map(m => m.to).sort(), ['a@example.com', 'b@example.com']);
  for (const [m, s] of [[transport.sent.find(x => x.to === 'a@example.com'), a], [transport.sent.find(x => x.to === 'b@example.com'), b]]) {
    const link = `https://news.example.com/newsletter/unsubscribe?token=${s.unsubscribeToken}`;
    assert.equal(m.headers['List-Unsubscribe'], `<${link}>`);
    assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    for (const body of [m.html, m.text]) { assert.ok(body.includes(link)); assert.ok(body.includes(POSTAL)); assert.match(body, /not medical advice/); }
    assert.doesNotMatch(m.html, /<img|<script|<iframe|<link/i);
    assert.deepEqual(Object.keys(m).sort(), ['headers', 'html', 'subject', 'text', 'to']);
  }
  // A second run has nothing left to do.
  const second = await newsletter.processOutbox({ transport });
  assert.equal(second.attempted, 0);
  assert.equal(transport.sent.length, 2);
});

test('the dry-run transport writes files and the per-run limit is respected', async () => {
  await publishArticle('nl-dry');
  await releaseEdition('2026-02-10', ['nl-dry']);
  await activeSubscriber('d1@example.com'); await activeSubscriber('d2@example.com'); await activeSubscriber('d3@example.com');
  openSending();
  await newsletter.queueIssue('2026-02-10', editor);
  const r = await newsletter.processOutbox({ limit: 2 });
  assert.equal(r.transport, 'dry-run');
  assert.equal(r.sent, 2);
  assert.equal((await dryRunMessages()).length, 2);
  assert.equal((await newsletter.processOutbox({})).sent, 1);
  assert.equal((await dryRunMessages()).length, 3);
});

test('a failing transport never loses state: backoff of 5m, 30m, 2h, 8h, then gave_up after the fifth attempt', async () => {
  await publishArticle('nl-retry');
  await releaseEdition('2026-02-11', ['nl-retry']);
  await activeSubscriber('good@example.com'); await activeSubscriber('bad@example.com');
  openSending();
  let now = Date.parse('2026-02-11T12:00:00Z');
  await newsletter.queueIssue('2026-02-11', editor, { now });
  const transport = fakeTransport(m => m.to === 'bad@example.com');
  const state = async () => (await newsletter.readOutbox('2026-02-11')).recipients.find(r => r.state !== 'sent');
  const MIN = 60 * 1000;

  let r = await newsletter.processOutbox({ transport, now });
  assert.deepEqual([r.sent, r.failed, r.gave_up], [1, 1, 0], 'one recipient failing does not stop the other');
  let bad = await state();
  assert.equal(bad.state, 'failed'); assert.equal(bad.attempts, 1);
  assert.equal(Date.parse(bad.next_attempt_at), now + 5 * MIN);
  assert.doesNotMatch(bad.last_error, EMAIL_PATTERN, 'stored error text must not contain the address');
  assert.match(bad.last_error, /address removed/);

  for (const [attempt, waited, nextWait] of [[2, 5, 30], [3, 30, 120], [4, 120, 480]]) {
    // Not due yet: nothing is attempted.
    assert.equal((await newsletter.processOutbox({ transport, now: now + waited * MIN - 1 })).attempted, 0);
    now += waited * MIN;
    r = await newsletter.processOutbox({ transport, now });
    assert.equal(r.failed, 1);
    bad = await state();
    assert.equal(bad.attempts, attempt);
    assert.equal(Date.parse(bad.next_attempt_at), now + nextWait * MIN);
  }
  now += 480 * MIN;
  r = await newsletter.processOutbox({ transport, now });
  assert.deepEqual([r.failed, r.gave_up], [0, 1]);
  bad = await state();
  assert.equal(bad.state, 'gave_up'); assert.equal(bad.attempts, 5); assert.equal(bad.next_attempt_at, null);
  // Given-up recipients are never tried again.
  assert.equal((await newsletter.processOutbox({ transport, now: now + 10000 * MIN })).attempted, 0);
  assert.deepEqual(transport.sent.map(m => m.to), ['good@example.com']);
});

test('someone who unsubscribes after queuing is skipped and their address is gone', async () => {
  await publishArticle('nl-skip');
  await releaseEdition('2026-02-12', ['nl-skip']);
  const stay = await activeSubscriber('stay@example.com'); const leave = await activeSubscriber('leave@example.com');
  openSending();
  await newsletter.queueIssue('2026-02-12', editor);
  assert.deepEqual(await newsletter.unsubscribe(leave.unsubscribeToken), { ok: true });
  const transport = fakeTransport();
  const r = await newsletter.processOutbox({ transport });
  assert.deepEqual([r.sent, r.skipped], [1, 1]);
  assert.deepEqual(transport.sent.map(m => m.to), ['stay@example.com']);
  const outbox = await newsletter.readOutbox('2026-02-12');
  assert.deepEqual(outbox.recipients.map(x => x.state).sort(), ['sent', 'skipped']);
  assert.ok(!(await subscribersOnDisk()).includes('leave@example.com'));
  // Re-subscribing later does not revive the old queue entry.
  const back = await newsletter.subscribe('leave@example.com');
  await newsletter.confirm(back.confirmToken);
  assert.equal((await newsletter.processOutbox({ transport })).attempted, 0);
  assert.ok(stay.id);
});

test('an article withdrawn after queuing is not sent; with nothing left the day is blocked', async () => {
  await publishArticle('nl-late-a'); await publishArticle('nl-late-b');
  await releaseEdition('2026-02-13', ['nl-late-a', 'nl-late-b']);
  await activeSubscriber('w@example.com');
  openSending();
  await newsletter.queueIssue('2026-02-13', editor);
  await pub.unpublish('nl-late-a', editor.id, 'Fixture withdrawal'); await pub.unpublish('nl-late-b', editor.id, 'Fixture withdrawal');
  const transport = fakeTransport();
  const r = await newsletter.processOutbox({ transport, day: '2026-02-13' });
  assert.equal(transport.sent.length, 0);
  assert.equal(r.blocked[0].day, '2026-02-13');
  assert.equal((await newsletter.readOutbox('2026-02-13')).recipients[0].state, 'pending');
});

// ====================================================================================
// Admin pages
// ====================================================================================

test('admin pages require a session, are no-store, and never contain an email address', async () => {
  await publishArticle('nl-admin');
  await releaseEdition('2026-02-14', ['nl-admin']);
  await activeSubscriber('hidden1@example.com'); await activeSubscriber('hidden2@example.com');
  await newsletter.subscribe('hidden3@example.com');
  openSending();
  await newsletter.queueIssue('2026-02-14', editor);

  const anonymous = await get('/admin/newsletter');
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.headers.get('location'), '/admin/login');
  assert.equal((await get('/admin/newsletter/preview/2026-02-14')).status, 302);

  const page = await get('/admin/newsletter', admin);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(page.text, /<th scope="row">Active<\/th><td>2<\/td>/);
  assert.match(page.text, /<th scope="row">Pending<\/th><td>1<\/td>/);
  assert.match(page.text, /2026-02-14/);
  const preview = await get('/admin/newsletter/preview/2026-02-14', admin);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('cache-control'), 'no-store');
  assert.match(preview.text, /Synthetic regulator notice nl-admin/);
  const rendered = await get('/admin/newsletter/preview/2026-02-14?format=html', admin);
  assert.equal(rendered.status, 200);
  assert.match(rendered.headers.get('content-security-policy'), /sandbox/);
  for (const r of [page, preview, rendered]) { assert.doesNotMatch(r.text, EMAIL_PATTERN); assert.doesNotMatch(r.text, /hidden\d/); }

  const none = await get('/admin/newsletter/preview/2026-02-15', admin);
  assert.equal(none.status, 404);
  assert.match(none.text, /No released edition/);
  assert.equal((await get('/admin/newsletter/preview/not-a-date', admin)).status, 400);
});

test('admin queue route: same-origin, session, sending flag and review tick are all required; second queue refused', async () => {
  await publishArticle('nl-route');
  await releaseEdition('2026-02-16', ['nl-route']);
  await activeSubscriber('route@example.com');
  const route = '/admin/newsletter/queue/2026-02-16';

  openSending();
  assert.equal((await post(route, { reviewed: 'yes' })).status, 302, 'no session -> login');
  assert.equal((await post(route, { reviewed: 'yes' }, { ...admin, origin: 'https://attacker.example.com' })).status, 403);
  assert.equal((await post(route, {}, admin)).status, 422);

  configure({ NEWSLETTER_TRANSPORT: 'dry-run' }); // sending flag off
  const off = await post(route, { reviewed: 'yes' }, admin);
  assert.equal(off.status, 403);
  assert.match(off.text, /switched off/);
  assert.equal(await newsletter.readOutbox('2026-02-16'), null);

  openSending();
  const ok = await post(route, { reviewed: 'yes' }, admin);
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/admin/newsletter?queued=2026-02-16');
  const outbox = await newsletter.readOutbox('2026-02-16');
  assert.equal(outbox.queued_by, 'offline-test-reviewer');
  assert.equal(outbox.recipients.length, 1);
  assert.equal((await dryRunMessages()).length, 0, 'queuing sends nothing');

  const twice = await post(route, { reviewed: 'yes' }, admin);
  assert.equal(twice.status, 409);
  assert.match(twice.text, /already queued/);
  assert.equal((await post('/admin/newsletter/queue/2026-02-17', { reviewed: 'yes' }, admin)).status, 409, 'no released edition');
});

// ====================================================================================
// Send script
// ====================================================================================

test('scripts/newsletter-send.js: without --confirm it only reports; with --confirm it sends what is due (dry-run files)', async () => {
  await publishArticle('nl-script');
  await releaseEdition('2026-02-18', ['nl-script']);
  await activeSubscriber('script@example.com');
  openSending();
  const script = path.join(__dirname, '..', 'scripts', 'newsletter-send.js');
  // Run from the temporary directory so no project .env file is read.
  const run = (...args) => require('child_process').spawnSync(process.execPath, [script, ...args], { cwd: root, env: { ...process.env }, encoding: 'utf8' });

  let r = run('2026-02-18');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Not queued/);
  assert.equal(run().status, 2);
  assert.equal(run('2026-02-18', '--force').status, 2);

  await newsletter.queueIssue('2026-02-18', editor);
  r = run('2026-02-18');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Nothing was sent\. 1 message\(s\) would be attempted/);
  assert.doesNotMatch(r.stdout + r.stderr, EMAIL_PATTERN);
  assert.equal((await dryRunMessages()).length, 0);

  process.env.NEWSLETTER_SENDING_ENABLED = 'false';
  r = run('2026-02-18', '--confirm');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Sending is not enabled/);
  assert.equal((await dryRunMessages()).length, 0);

  process.env.NEWSLETTER_SENDING_ENABLED = 'true';
  r = run('2026-02-18', '--confirm');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /attempted 1 \| sent 1/);
  assert.doesNotMatch(r.stdout + r.stderr, EMAIL_PATTERN);
  const [mail] = await dryRunMessages();
  assert.equal(mail.to, 'script@example.com');
  assert.equal((await newsletter.readOutbox('2026-02-18')).recipients[0].state, 'sent');
});

// Release blocker 3 (review of 3e41396): the newsletter is a publication path too.
test('an issue never includes a reviewed story older than the 90-day freshness window', async () => {
  configure();
  const old = new Date(Date.now() - 200 * 86400000).toISOString(), recent = new Date(Date.now() - 3 * 86400000).toISOString();
  await publishArticle('fresh-window-fixture', { date_published: recent.slice(0, 10), provenance: { published_at: recent, retrieved_at: recent } });
  await publishArticle('stale-window-fixture', { title: 'STALE STORY MUST NOT BE MAILED', date_published: old.slice(0, 10), provenance: { published_at: old, retrieved_at: recent } });
  await releaseEdition('2026-10-05', ['fresh-window-fixture', 'stale-window-fixture']);
  const issue = await newsletter.buildIssue('2026-10-05');
  assert.equal(issue.items.length, 1);
  assert.equal(issue.unavailable, 1);
  assert.ok(!issue.html.includes('STALE STORY') && !issue.text.includes('STALE STORY'));
});
