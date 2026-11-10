'use strict';
// Catalogue and release gate for clinical tools and quick references.
//
// Nothing that could influence treatment is offered for clinical use until a
// credential-verified clinical reviewer approves its exact content version. An approval
// names the version digest; any change to a tool's formula, bounds, citations or wording
// changes the digest and the tool returns to "awaiting clinical review". Approvals expire
// (review_due) and can be withdrawn with a reason. Every action is appended to an audit log.
//
// Reference sections that have no sourced, reviewed content (extravasation, IV push,
// critical-care infusions) are listed with an honest "not available" status. No doses,
// antidotes, rates or recommendations are written here without sources and review.
const fs = require('fs/promises'), path = require('path'), crypto = require('crypto');
const { CALCULATORS } = require('./clinical/calculators');
const policy = require('./review-policy');

const REVIEW_VALID_DAYS = 365;
const root = () => path.join(process.env.CONTENT_DIR || path.join(__dirname, '..', 'content'), 'clinical-tools');

// Reference sections planned but not built. `needs` states exactly what is missing.
const REFERENCES = Object.freeze([
  { id: 'extravasation', name: 'Extravasation management', section: 'Quick references', status: 'not_available',
    needs: 'A licensed source or an institution-authored monograph set with per-agent citations, plus sign-off by a verified clinical reviewer. No antidotes, compresses or doses are published until then.' },
  { id: 'iv-push', name: 'IV push administration', section: 'Quick references', status: 'not_available',
    needs: 'Per-medicine rates, dilutions and monitoring taken from current product labelling (with label version and date) and sign-off by a verified clinical reviewer.' },
  { id: 'critical-care-infusions', name: 'Critical-care infusion guidance', section: 'Quick references', status: 'not_available',
    needs: 'Per-medicine concentrations, dose ranges and titration from cited labelling or guidelines, with population and units, and sign-off by a verified critical-care clinical reviewer.' },
  { id: 'bugs-and-drugs', name: 'Infectious-disease “Bugs & Drugs” reference', section: 'Infectious diseases', status: 'disabled',
    needs: 'An earlier draft exists in the codebase but is switched off: its regimens were not sourced line-by-line or clinically reviewed. It stays disabled until each entry has citations and a verified clinical approval.' },
  { id: 'treatment-evidence', name: 'Treatment evidence summaries', section: 'Infectious diseases', status: 'review_gated', href: '/treatments',
    needs: 'Live workflow: a guide appears only after editorial, evidence, rights and clinical approvals of one exact revision. None is published yet.' },
  { id: 'substance-alerts', name: 'Emerging-substance alerts (news, not treatment)', section: 'Substances', status: 'review_gated', href: '/substance-alerts',
    needs: 'Alerts report detections and warnings only. Treatment for an alerted substance is never inferred; where no reviewed guidance exists the page says so.' }
]);

const stable = v => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
// Digest of everything a clinician would be approving (the compute function is included as source text).
function digest(tool) {
  const { compute, ...rest } = tool;
  return crypto.createHash('sha256').update(JSON.stringify(stable({ ...rest, compute: String(compute) }))).digest('hex');
}

let queue = Promise.resolve();
const serial = fn => (queue = queue.then(fn, fn));
async function readJSON(file, fallback) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }
async function writeJSON(file, data) { await require('./fsync').ensureDirectory(path.dirname(file)); await require('./store').durableReplace(file, JSON.stringify(data, null, 2) + '\n'); }
async function audit(entry) { await require('./fsync').ensureDirectory(root()); await fs.appendFile(path.join(root(), 'audit.jsonl'), JSON.stringify({ ...entry, at: new Date().toISOString() }) + '\n', { mode: 0o600 }); }
const approvalFile = id => path.join(root(), 'approvals', id + '.json');
const today = now => new Date(now).toISOString().slice(0, 10);

function evaluate(tool, record, now = Date.now()) {
  const version_digest = digest(tool);
  if (!record) return { state: 'awaiting_clinical_review', available: false, version_digest };
  if (record.withdrawn_at) return { state: 'withdrawn', available: false, version_digest, withdrawn_at: record.withdrawn_at, reason: record.withdrawal_reason };
  if (record.version_digest !== version_digest) return { state: 'awaiting_clinical_review', available: false, version_digest, note: 'Content changed since the last clinical approval' };
  if (!(record.review_due > today(now))) return { state: 'review_expired', available: false, version_digest, review_due: record.review_due };
  return { state: 'clinically_reviewed', available: true, version_digest, reviewed_at: record.approved_at.slice(0, 10), review_due: record.review_due, reviewer_profession: record.reviewer_profession || null };
}

async function status(id, now = Date.now()) {
  const tool = CALCULATORS.find(c => c.id === id);
  if (!tool) return null;
  return { tool, ...evaluate(tool, await readJSON(approvalFile(id), null), now) };
}
async function catalogue(now = Date.now()) {
  const calculators = [];
  for (const c of CALCULATORS) calculators.push(await status(c.id, now));
  return { calculators, references: REFERENCES };
}

// Approval: only a signed-in human holding the clinical_reviewer role with an independently
// verified, unexpired credential, who has just re-entered their password (stepUp), and only
// for the exact digest they were shown.
async function approve(id, expectedDigest, principal, attestation, now = Date.now()) {
  return serial(async () => {
    const tool = CALCULATORS.find(c => c.id === id);
    if (!tool) throw Object.assign(new Error('Unknown tool'), { status: 404 });
    if (!policy.human(principal, 'clinical_reviewer') || principal.clinicalCredentialVerified !== true) throw Object.assign(new Error('A credential-verified clinical reviewer is required'), { status: 403 });
    if (principal.stepUp !== true) throw Object.assign(new Error('Re-enter your password to sign this approval'), { status: 401 });
    if (digest(tool) !== expectedDigest) throw Object.assign(new Error('Tool content changed; reload and review the current version'), { status: 409 });
    if (!attestation || attestation.formulaChecked !== true || attestation.citationsChecked !== true || attestation.testCasesChecked !== true) throw Object.assign(new Error('Confirm that the formula, citations and test cases were checked'), { status: 422 });
    const record = { tool_id: id, tool_version: tool.version, version_digest: expectedDigest, approved_by: principal.id, reviewer_profession: principal.credential?.profession || null, credential_digest: principal.credentialDigest || null,
      approved_at: new Date(now).toISOString(), review_due: today(now + REVIEW_VALID_DAYS * 86400000), attestation: { formulaChecked: true, citationsChecked: true, testCasesChecked: true } };
    await writeJSON(approvalFile(id), record);
    await audit({ action: 'approved', tool_id: id, version_digest: expectedDigest, actor: principal.id });
    return evaluate(tool, record, now);
  });
}
// Withdrawal: any signed-in editor or clinical reviewer can take a tool down immediately.
async function withdraw(id, principal, reason, now = Date.now()) {
  return serial(async () => {
    if (!policy.human(principal, 'editor') && !policy.human(principal, 'clinical_reviewer')) throw Object.assign(new Error('Editor or clinical reviewer required'), { status: 403 });
    const text = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
    if (!text) throw Object.assign(new Error('Withdrawal reason required'), { status: 422 });
    const record = await readJSON(approvalFile(id), null);
    if (!record) throw Object.assign(new Error('No approval to withdraw'), { status: 404 });
    await writeJSON(approvalFile(id), { ...record, withdrawn_at: new Date(now).toISOString(), withdrawn_by: principal.id, withdrawal_reason: text });
    await audit({ action: 'withdrawn', tool_id: id, actor: principal.id, reason: text });
    return { state: 'withdrawn' };
  });
}

const STATE_LABELS = Object.freeze({
  awaiting_clinical_review: 'Awaiting clinical review — not available for clinical use',
  clinically_reviewed: 'Clinically reviewed',
  review_expired: 'Review expired — not available until re-reviewed',
  withdrawn: 'Withdrawn',
  not_available: 'Not available — no sourced, reviewed content yet',
  disabled: 'Disabled',
  review_gated: 'Review-gated'
});

module.exports = { catalogue, status, approve, withdraw, digest, evaluate, REFERENCES, STATE_LABELS, REVIEW_VALID_DAYS };
