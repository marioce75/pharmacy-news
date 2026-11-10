'use strict';
// Advertising / sponsorship store and rules.
//
// What lives here:
//   * private sponsor enquiries ("submissions") sent through the public form;
//   * placements an editor typed and approved from one of those submissions;
//   * an append-only audit log of every reviewer action.
//
// Guarantees enforced in this module rather than in the routes or views:
//   * a placement can only be created from an existing submission, by a named reviewer;
//   * placement text is plain text (no '<' or '>'), the body carries no URLs, and the
//     single link is https;
//   * sponsor slots exist only for an explicit allowlist; asking for any other slot
//     throws, so a slot cannot be added to clinical or affordability pages by mistake;
//   * nothing is displayed unless SPONSOR_DISPLAY_ENABLED=true;
//   * public output is a fixed five-field projection (publicView).
//
// Storage is one JSON file per record under <CONTENT_DIR>/sponsors. The application is a
// single process, so one in-module promise queue serialises every read-modify-write.

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { durableReplace } = require('./store');
const { ensureDirectory } = require('./fsync');
const { cleanText, validEmail, httpsUrl, enabled } = require('./public-forms');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUBMISSION_TYPES = Object.freeze(['display_ad', 'sponsored_content', 'newsletter_sponsorship']);
const TYPE_LABELS = Object.freeze({
  display_ad: 'Display advertisement',
  sponsored_content: 'Sponsored content',
  newsletter_sponsorship: 'Newsletter sponsorship'
});
// new -> under_review -> declined | placed. "placed" is set only by createPlacement.
const SUBMISSION_STATUSES = Object.freeze(['new', 'under_review', 'declined', 'placed']);
const REVIEW_STATUSES = Object.freeze(['under_review', 'declined']);

const LABELS = Object.freeze(['Advertisement', 'Sponsored']);

// The only places a sponsor slot may ever be rendered.
const SLOT_ALLOWLIST = Object.freeze(['news-list', 'article-footer', 'newsletter']);
// Contexts that must never carry sponsor material. They are listed so tests (and anyone
// reading this file) can see the intent; the real protection is that activePlacements()
// throws for every name that is not in SLOT_ALLOWLIST.
const FORBIDDEN_CONTEXTS = Object.freeze([
  'tools', 'clinical-tools', 'calculators', 'bugs-and-drugs',
  'treatments', 'treatment-evidence',
  'substance-alerts', 'outbreaks', 'monitor',
  'affordability', 'medication-costs',
  'sources', 'source-coverage'
]);

const LIMITS = Object.freeze({
  organisation: 120, contact_name: 120, website: 300, message: 2000, note: 500,
  sponsor_name: 120, headline: 90, body: 240, reason: 500
});
const MAX_SPAN_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const PUBLIC_FIELDS = Object.freeze(['label', 'sponsor_name', 'headline', 'body', 'link']);

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// Anything that reads as a web address: a scheme, "www.", or a bare domain such as
// "example.com". Deliberately broad; the editor is told to move addresses to the link field.
const URLISH = /(?:[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]+\.[a-z]{2,}\b)/i;

// ---------------------------------------------------------------------------
// Paths and low-level storage
// ---------------------------------------------------------------------------

// Resolved on every call so tests (and operators) can point CONTENT_DIR elsewhere.
function baseDir() {
  return path.join(process.env.CONTENT_DIR || path.join(__dirname, '..', 'content'), 'sponsors');
}
const dirOf = kind => path.join(baseDir(), kind);
const auditFile = () => path.join(baseDir(), 'audit.jsonl');

function fail(message, status = 400, fields = null) {
  return Object.assign(new Error(message), { status, fields, expose: true });
}

function recordPath(kind, id) {
  if (typeof id !== 'string' || !ID.test(id)) throw fail('Unknown record', 404);
  return path.join(dirOf(kind), `${id}.json`);
}

// One queue for the whole module: each task starts only after the previous one settled.
let queue = Promise.resolve();
function serial(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

async function writeRecord(kind, record) {
  await ensureDirectory(dirOf(kind));
  await durableReplace(recordPath(kind, record.id), JSON.stringify(record, null, 2));
}

async function readRecord(kind, id) {
  try {
    return JSON.parse(await fs.readFile(recordPath(kind, id), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function listRecords(kind) {
  let names;
  try { names = await fs.readdir(dirOf(kind)); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json') || !ID.test(name.slice(0, -5))) continue; // skips *.tmp files
    out.push(JSON.parse(await fs.readFile(path.join(dirOf(kind), name), 'utf8')));
  }
  return out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

// Append one line and flush it. Lines are only ever added, never rewritten.
async function appendAudit(actor, action, target, detail = {}) {
  await ensureDirectory(baseDir());
  const line = JSON.stringify({ at: new Date().toISOString(), actor, action, target, ...detail }) + '\n';
  const handle = await fs.open(auditFile(), 'a', 0o600);
  try { await handle.appendFile(line, 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
}

async function readAudit() {
  let text;
  try { text = await fs.readFile(auditFile(), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

// Reads a text field one character past its limit so "too long" is reported, not truncated.
function field(input, name, max) {
  return cleanText(input?.[name], max + 1);
}

// Editors act under their own id; the id is written to every record and audit line.
function reviewerId(reviewer) {
  const id = typeof reviewer === 'string' ? reviewer : reviewer?.id;
  if (typeof id !== 'string' || !id.trim()) throw fail('A signed-in reviewer is required', 403);
  return id;
}

function parseDay(value) {
  if (typeof value !== 'string' || !DAY.test(value)) return null;
  const ms = Date.parse(value + 'T00:00:00Z');
  // Reject impossible dates such as 2026-02-31, which Date would roll forward.
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

// Public enquiry form. Returns { errors, values }; `values` is safe to re-render.
function validateSubmission(input) {
  const errors = {};
  const values = {
    organisation: field(input, 'organisation', LIMITS.organisation),
    contact_name: field(input, 'contact_name', LIMITS.contact_name),
    email: cleanText(input?.email, 255),
    website: field(input, 'website', LIMITS.website),
    type: cleanText(input?.type, 40),
    message: field(input, 'message', LIMITS.message),
    acknowledge: input?.acknowledge === 'yes' || input?.acknowledge === true
  };
  if (!values.organisation) errors.organisation = 'Enter the name of your organisation.';
  else if (values.organisation.length > LIMITS.organisation) errors.organisation = `Organisation name must be ${LIMITS.organisation} characters or fewer.`;
  if (!values.contact_name) errors.contact_name = 'Enter a contact name.';
  else if (values.contact_name.length > LIMITS.contact_name) errors.contact_name = `Contact name must be ${LIMITS.contact_name} characters or fewer.`;
  if (!validEmail(values.email)) errors.email = 'Enter a valid business email address, for example name@example.com.';
  if (!httpsUrl(values.website, LIMITS.website)) errors.website = 'Enter your website address starting with https://';
  if (!SUBMISSION_TYPES.includes(values.type)) errors.type = 'Choose what you are enquiring about.';
  if (!values.message) errors.message = 'Enter the copy or message you are proposing.';
  else if (values.message.length > LIMITS.message) errors.message = `Proposed copy must be ${LIMITS.message} characters or fewer.`;
  if (!values.acknowledge) errors.acknowledge = 'Confirm that you have read the advertising policy.';
  return { errors, values };
}

// Placement fields typed by the editor. Nothing is copied from the sponsor's submission.
function validatePlacement(input) {
  const errors = {};
  const values = {
    label: cleanText(input?.label, 40),
    sponsor_name: field(input, 'sponsor_name', LIMITS.sponsor_name),
    headline: field(input, 'headline', LIMITS.headline),
    body: field(input, 'body', LIMITS.body),
    link: cleanText(input?.link, LIMITS.website + 1),
    slot: cleanText(input?.slot, 40),
    start_date: cleanText(input?.start_date, 10),
    end_date: cleanText(input?.end_date, 10)
  };
  if (!LABELS.includes(values.label)) errors.label = 'Choose the label: Advertisement or Sponsored.';
  for (const name of ['sponsor_name', 'headline', 'body']) {
    const text = values[name], title = name.replace('_', ' ');
    if (!text) errors[name] = `Enter the ${title}.`;
    else if (text.length > LIMITS[name]) errors[name] = `The ${title} must be ${LIMITS[name]} characters or fewer.`;
    else if (/[<>]/.test(text)) errors[name] = `The ${title} must be plain text without < or >.`;
    else if (/[\r\n]/.test(text)) errors[name] = `The ${title} must be a single line.`;
  }
  for (const name of ['headline', 'body']) {
    if (!errors[name] && URLISH.test(values[name])) errors[name] = `The ${name} must not contain web addresses; use the link field.`;
  }
  const link = httpsUrl(values.link, LIMITS.website);
  if (!link) errors.link = 'Enter one link starting with https://';
  else values.link = link;
  if (!SLOT_ALLOWLIST.includes(values.slot)) errors.slot = 'Choose one of the permitted slots.';
  const start = parseDay(values.start_date), end = parseDay(values.end_date);
  if (start === null) errors.start_date = 'Enter the start date as YYYY-MM-DD.';
  if (end === null) errors.end_date = 'Enter the end date as YYYY-MM-DD.';
  if (start !== null && end !== null) {
    if (end <= start) errors.end_date = 'The end date must be after the start date.';
    else if ((end - start) / DAY_MS > MAX_SPAN_DAYS) errors.end_date = `A placement can run for at most ${MAX_SPAN_DAYS} days.`;
  }
  return { errors, values };
}

// ---------------------------------------------------------------------------
// Submissions (private)
// ---------------------------------------------------------------------------

// Stores a validated enquiry. No IP address or other request metadata is recorded.
function createSubmission(input) {
  const { errors, values } = validateSubmission(input);
  if (Object.keys(errors).length) return Promise.reject(fail('Submission is not valid', 400, errors));
  return serial(async () => {
    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(), status: 'new', created_at: now, updated_at: now,
      organisation: values.organisation, contact_name: values.contact_name, email: values.email,
      website: httpsUrl(values.website, LIMITS.website), type: values.type, message: values.message,
      policy_acknowledged: true, review_note: '', reviewed_by: null
    };
    await writeRecord('submissions', record);
    await appendAudit('public-form', 'submission_received', record.id);
    return record;
  });
}

const listSubmissions = () => listRecords('submissions');
const getSubmission = id => readRecord('submissions', id);

// Editor marks an enquiry as under review or declined, with an optional note.
function setSubmissionStatus(id, status, note, reviewer) {
  const actor = reviewerId(reviewer);
  if (!REVIEW_STATUSES.includes(status)) return Promise.reject(fail('Status must be under_review or declined'));
  const cleanNote = field({ note }, 'note', LIMITS.note);
  if (cleanNote.length > LIMITS.note) return Promise.reject(fail(`Note must be ${LIMITS.note} characters or fewer`));
  return serial(async () => {
    const record = await readRecord('submissions', id);
    if (!record) throw fail('Submission not found', 404);
    if (record.status === 'placed') throw fail('This submission already has a placement; withdraw the placement instead', 409);
    Object.assign(record, { status, review_note: cleanNote, reviewed_by: actor, updated_at: new Date().toISOString() });
    await writeRecord('submissions', record);
    await appendAudit(actor, 'submission_' + status, record.id);
    return record;
  });
}

// ---------------------------------------------------------------------------
// Placements
// ---------------------------------------------------------------------------

// Creating a placement is the approval: a named editor typed the text and chose the
// label, slot and dates. It always hangs off a real, non-declined submission.
function createPlacement(submissionId, input, reviewer) {
  const actor = reviewerId(reviewer);
  const { errors, values } = validatePlacement(input);
  return serial(async () => {
    if (typeof submissionId !== 'string' || !ID.test(submissionId)) throw fail('A placement must be created from an existing submission', 400);
    const submission = await readRecord('submissions', submissionId);
    if (!submission) throw fail('A placement must be created from an existing submission', 400);
    if (submission.status === 'declined') throw fail('This submission was declined; it cannot be placed', 409);
    if (Object.keys(errors).length) throw fail('Placement is not valid', 400, errors);
    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(), submission_id: submission.id, status: 'approved',
      ...values, approved_by: actor, approved_at: now, created_at: now, updated_at: now,
      withdrawn_by: null, withdrawn_at: null, withdrawal_reason: ''
    };
    await writeRecord('placements', record);
    Object.assign(submission, { status: 'placed', reviewed_by: actor, updated_at: now });
    await writeRecord('submissions', submission);
    await appendAudit(actor, 'placement_approved', record.id, { submission: submission.id, slot: record.slot });
    return record;
  });
}

// Withdrawal is permanent for that placement and needs a stated reason.
function withdrawPlacement(id, reason, reviewer) {
  const actor = reviewerId(reviewer);
  const cleanReason = field({ reason }, 'reason', LIMITS.reason);
  if (!cleanReason) return Promise.reject(fail('Give a reason for withdrawing this placement', 400, { reason: 'Give a reason for withdrawing this placement.' }));
  if (cleanReason.length > LIMITS.reason) return Promise.reject(fail(`Reason must be ${LIMITS.reason} characters or fewer`));
  return serial(async () => {
    const record = await readRecord('placements', id);
    if (!record) throw fail('Placement not found', 404);
    if (record.status === 'withdrawn') throw fail('Placement is already withdrawn', 409);
    const now = new Date().toISOString();
    Object.assign(record, { status: 'withdrawn', withdrawn_by: actor, withdrawn_at: now, withdrawal_reason: cleanReason, updated_at: now });
    await writeRecord('placements', record);
    await appendAudit(actor, 'placement_withdrawn', record.id);
    return record;
  });
}

const listPlacements = () => listRecords('placements');

// ---------------------------------------------------------------------------
// Public display
// ---------------------------------------------------------------------------

// The only shape that may reach a public page: no contact details, notes, ids or reviewers.
function publicView(placement) {
  return Object.fromEntries(PUBLIC_FIELDS.map(name => [name, String(placement?.[name] ?? '')]));
}

function assertSlot(slot) {
  if (typeof slot !== 'string' || !SLOT_ALLOWLIST.includes(slot)) {
    throw Object.assign(new Error(`Sponsor slot "${String(slot)}" is not permitted. Sponsor material may appear only in: ${SLOT_ALLOWLIST.join(', ')}.`), { code: 'SPONSOR_SLOT_FORBIDDEN' });
  }
}

// A placement runs from 00:00 UTC on start_date to the end of end_date (UTC), inclusive.
// The stored record is re-checked here so a hand-edited file cannot widen what is shown.
function isLive(placement, slot, nowMs) {
  if (!placement || placement.status !== 'approved' || placement.withdrawn_at) return false;
  if (placement.slot !== slot || !LABELS.includes(placement.label)) return false;
  if (!httpsUrl(placement.link, LIMITS.website)) return false;
  if (['sponsor_name', 'headline', 'body'].some(k => typeof placement[k] !== 'string' || !placement[k] || /[<>]/.test(placement[k]))) return false;
  const start = parseDay(placement.start_date), end = parseDay(placement.end_date);
  return start !== null && end !== null && nowMs >= start && nowMs < end + DAY_MS;
}

// Placements to show in `slot` right now, already projected with publicView.
// Throws for any slot outside the allowlist, whether or not display is switched on.
async function activePlacements(slot, now = new Date()) {
  assertSlot(slot);
  if (!enabled('SPONSOR_DISPLAY_ENABLED')) return [];
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) throw new Error('activePlacements needs a valid date');
  return (await listPlacements()).filter(p => isLive(p, slot, nowMs)).map(publicView);
}

// Names of sponsors with a live placement in any slot, for the public policy page.
async function activeSponsors(now = new Date()) {
  const seen = new Map();
  for (const slot of SLOT_ALLOWLIST) {
    for (const p of await activePlacements(slot, now)) seen.set(p.sponsor_name + '|' + p.label, { sponsor_name: p.sponsor_name, label: p.label });
  }
  return [...seen.values()];
}

module.exports = {
  SUBMISSION_TYPES, TYPE_LABELS, SUBMISSION_STATUSES, REVIEW_STATUSES, LABELS, SLOT_ALLOWLIST, FORBIDDEN_CONTEXTS,
  LIMITS, MAX_SPAN_DAYS, PUBLIC_FIELDS,
  validateSubmission, validatePlacement,
  createSubmission, listSubmissions, getSubmission, setSubmissionStatus,
  createPlacement, withdrawPlacement, listPlacements,
  publicView, activePlacements, activeSponsors, assertSlot, readAudit
};
