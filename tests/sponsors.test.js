'use strict';
// Advertising / sponsorship module. Everything here is synthetic (example.com / *.test),
// runs against a temporary CONTENT_DIR and makes no network requests beyond 127.0.0.1.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

// The temporary content directory must be in place BEFORE any app module is required.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-sponsors-'));
process.env.CONTENT_DIR = root;
delete process.env.SPONSOR_SUBMISSIONS_ENABLED;
delete process.env.SPONSOR_DISPLAY_ENABLED;

// Fixture identities: a legacy administrator (holds the editor role) and a registry
// account that holds only source-review roles. Hashes are generated per run.
const hash = require('bcrypt').hashSync('fixture-sponsor-password', 4);
process.env.ADMIN_USERNAME = 'fixture-sponsor-editor';
process.env.ADMIN_PASSWORD_HASH = hash;
const registryFile = path.join(root, 'reviewers.fixture.json');
fs.writeFileSync(registryFile, JSON.stringify({ reviewers: [
  { id: 'fixture-source', display_name: 'Fixture Source Reviewer (synthetic)', password_hash: hash, roles: ['evidence_reviewer', 'rights_reviewer'] }
] }), { mode: 0o600 });
process.env.REVIEWER_REGISTRY_FILE = registryFile;

const express = require('express');
const ejs = require('ejs');
const sponsors = require('../lib/sponsors');
const { publicRouter, adminRouter } = require('../routes/sponsors');
const digest = require('../lib/reviewers').credentialDigest(hash);
const SESSIONS = {
  editor: { authenticated: true, username: 'fixture-sponsor-editor', account_source: 'legacy_admin', credential: digest },
  source: { authenticated: true, username: 'fixture-source', account_source: 'registry', credential: digest }
};
const EDITOR = { id: 'fixture-sponsor-editor' };
const viewsDir = path.join(__dirname, '..', 'views');

let server, url, ipCounter = 0;

before(async () => {
  const app = express();
  app.set('trust proxy', true); // lets each test post from its own synthetic client address
  app.set('view engine', 'ejs');
  app.set('views', viewsDir);
  app.use((req, res, next) => { const s = SESSIONS[req.get('x-fixture-auth')]; if (s) req.session = { ...s }; next(); });
  app.use('/', publicRouter);
  app.use('/admin', adminRouter);
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  url = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  await fsp.rm(root, { recursive: true, force: true });
});

// ---- helpers --------------------------------------------------------------

const freshIp = () => `203.0.113.${++ipCounter}`; // TEST-NET-3, never routed
const goodForm = (over = {}) => ({
  organisation: 'Example Pharmacy Supplies (synthetic)', contact_name: 'Test Contact',
  email: 'ads@example.com', website: 'https://sponsor.example.com/', type: 'display_ad',
  message: 'Synthetic proposal text for a test.', acknowledge: 'yes', ...over
});
async function submit(form, { ip = freshIp(), origin = url } = {}) {
  const r = await fetch(url + '/advertise/submit', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip, ...(origin ? { origin } : {}) },
    body: new URLSearchParams(form).toString()
  });
  return { status: r.status, text: await r.text() };
}
async function admin(route, { method = 'GET', form, as = 'editor', origin = url } = {}) {
  const r = await fetch(url + '/admin/sponsors' + route, {
    method, redirect: 'manual',
    headers: { ...(as ? { 'x-fixture-auth': as } : {}), ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded', ...(origin ? { origin } : {}) } : {}) },
    ...(form ? { body: new URLSearchParams(form).toString() } : {})
  });
  return { status: r.status, location: r.headers.get('location'), cache: r.headers.get('cache-control'), text: await r.text() };
}
const goodPlacement = (over = {}) => ({
  label: 'Advertisement', sponsor_name: 'Example Pharmacy Supplies', headline: 'Synthetic headline for testing',
  body: 'Plain synthetic body text for a test placement.', link: 'https://sponsor.example.com/offer',
  slot: 'news-list', start_date: '2026-11-01', end_date: '2026-11-30', ...over
});
const submissionCount = async () => (await sponsors.listSubmissions()).length;
const renderSlot = placements => ejs.renderFile(path.join(viewsDir, 'partials', 'sponsor-slot.ejs'), { placements });

// ---- public form ----------------------------------------------------------

test('policy page states the rules and says there are no active sponsors; form is closed by default', async () => {
  const r = await fetch(url + '/advertise'), html = await r.text();
  assert.equal(r.status, 200);
  for (const phrase of ['Advertisement', 'Sponsored', 'no influence', 'human editor', 'No tracking pixels', 'does not create an agreement', 'No pricing is published', 'not shared', 'currently no active advertisers or sponsors', 'not open yet'])
    assert.ok(html.includes(phrase), 'policy page should mention: ' + phrase);
  assert.match(html, /<fieldset[^>]* disabled/);
  assert.doesNotMatch(html, /<script/i);
});

test('submissions are refused with 503 while SPONSOR_SUBMISSIONS_ENABLED is not "true"', async () => {
  const r = await submit(goodForm());
  assert.equal(r.status, 503);
  assert.match(r.text, /not open yet/i);
  assert.equal(await submissionCount(), 0);
});

test('a valid submission is stored privately with status new and no IP address', async () => {
  process.env.SPONSOR_SUBMISSIONS_ENABLED = 'true';
  const ip = freshIp(), r = await submit(goodForm(), { ip });
  assert.equal(r.status, 200);
  assert.match(r.text, /An editor will review it/);
  assert.ok(!r.text.includes('ads@example.com'), 'confirmation must not echo contact details');
  const all = await sponsors.listSubmissions();
  assert.equal(all.length, 1);
  assert.equal(all[0].status, 'new');
  assert.equal(all[0].email, 'ads@example.com');
  assert.equal(all[0].type, 'display_ad');
  const raw = await fsp.readFile(path.join(root, 'sponsors', 'submissions', all[0].id + '.json'), 'utf8');
  assert.ok(!raw.includes(ip) && !/"ip"/i.test(raw), 'no IP address is stored');
  // Stored under the private content directory, never shown on the public page.
  const page = await (await fetch(url + '/advertise')).text();
  assert.ok(!page.includes('ads@example.com') && !page.includes('Example Pharmacy Supplies'));
});

test('validation errors are field-level, accessible, preserve values and store nothing', async () => {
  const before = await submissionCount();
  const cases = [
    [{ email: 'not-an-email' }, 'e-email', /valid business email/],
    [{ website: 'http://sponsor.example.com/' }, 'e-website', /starting with https:\/\//],
    [{ acknowledge: '' }, 'e-acknowledge', /Confirm that you have read/],
    [{ organisation: 'O'.repeat(121) }, 'e-organisation', /120 characters or fewer/],
    [{ message: 'm'.repeat(2001) }, 'e-message', /2000 characters or fewer/],
    [{ type: 'homepage_takeover' }, 'e-type', /Choose what you are enquiring about/]
  ];
  for (const [over, errorId, message] of cases) {
    const r = await submit(goodForm({ contact_name: 'Preserved Name', ...over }));
    assert.equal(r.status, 400, errorId);
    assert.match(r.text, message);
    assert.match(r.text, /role="alert"/);
    assert.ok(r.text.includes(`id="${errorId}"`), 'error element ' + errorId);
    assert.match(r.text, new RegExp(`aria-describedby="[^"]*${errorId}`));
    assert.ok(r.text.includes('value="Preserved Name"'), 'other values are preserved');
  }
  assert.equal(await submissionCount(), before);
});

test('markup typed into the form is escaped when the form is re-rendered', async () => {
  const r = await submit(goodForm({ organisation: '<script>alert(1)</script>', email: 'bad' }));
  assert.equal(r.status, 400);
  assert.ok(!r.text.includes('<script>alert(1)</script>'));
  assert.ok(r.text.includes('&lt;script&gt;'));
});

test('honeypot posts get the generic success page and nothing is stored', async () => {
  const before = await submissionCount();
  const r = await submit(goodForm({ homepage: 'https://spam.example.com/' }));
  assert.equal(r.status, 200);
  assert.match(r.text, /An editor will review it/);
  assert.equal(await submissionCount(), before);
});

test('cross-origin and origin-less posts are refused', async () => {
  const before = await submissionCount();
  assert.equal((await submit(goodForm(), { origin: 'https://other.example' })).status, 403);
  assert.equal((await submit(goodForm(), { origin: null })).status, 403);
  assert.equal(await submissionCount(), before);
});

test('the fourth post in an hour from one client is rate limited', async () => {
  const ip = freshIp(), statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await submit(goodForm({ email: 'x' }), { ip })).status);
  assert.deepEqual(statuses, [400, 400, 400, 429]);
});

// ---- admin workflow -------------------------------------------------------

test('unauthenticated admin access is refused for reads and writes', async () => {
  const [s] = await sponsors.listSubmissions();
  let r = await admin('', { as: null });
  assert.equal(r.status, 302); assert.equal(r.location, '/admin/login');
  r = await admin(`/submissions/${s.id}/status`, { method: 'POST', as: null, form: { status: 'declined' } });
  assert.equal(r.status, 302);
  r = await admin('/placements', { method: 'POST', as: null, form: { submission_id: s.id, ...goodPlacement() } });
  assert.equal(r.status, 302);
  assert.equal((await sponsors.getSubmission(s.id)).status, 'new');
  assert.equal((await sponsors.listPlacements()).length, 0);
});

test('a signed-in reviewer without the editor role can read but cannot mutate', async () => {
  const [s] = await sponsors.listSubmissions();
  let r = await admin('', { as: 'source' });
  assert.equal(r.status, 200);
  assert.equal(r.cache, 'no-store');
  assert.match(r.text, /Read-only/);
  r = await admin(`/submissions/${s.id}/status`, { method: 'POST', as: 'source', form: { status: 'declined' } });
  assert.equal(r.status, 403);
  r = await admin('/placements', { method: 'POST', as: 'source', form: { submission_id: s.id, ...goodPlacement() } });
  assert.equal(r.status, 403);
  assert.equal((await sponsors.getSubmission(s.id)).status, 'new');
  assert.equal((await sponsors.listPlacements()).length, 0);
});

test('admin mutations require a same-origin request', async () => {
  const [s] = await sponsors.listSubmissions();
  for (const origin of ['https://other.example', null]) {
    const r = await admin(`/submissions/${s.id}/status`, { method: 'POST', origin, form: { status: 'declined' } });
    assert.equal(r.status, 403);
  }
  assert.equal((await sponsors.getSubmission(s.id)).status, 'new');
});

test('editor can list submissions and move one to under_review with a note; other statuses are rejected', async () => {
  const [s] = await sponsors.listSubmissions();
  let r = await admin('');
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('ads@example.com'), 'editors see the private contact details');
  r = await admin(`/submissions/${s.id}/status`, { method: 'POST', form: { status: 'under_review', note: 'Checking the organisation' } });
  assert.equal(r.status, 303);
  const stored = await sponsors.getSubmission(s.id);
  assert.equal(stored.status, 'under_review');
  assert.equal(stored.review_note, 'Checking the organisation');
  assert.equal(stored.reviewed_by, 'fixture-sponsor-editor');
  r = await admin(`/submissions/${s.id}/status`, { method: 'POST', form: { status: 'placed' } });
  assert.equal(r.status, 400);
  assert.equal((await sponsors.getSubmission(s.id)).status, 'under_review');
});

test('a placement cannot be created without an existing submission', async () => {
  for (const submission_id of ['', 'not-an-id', '00000000-0000-4000-8000-000000000000']) {
    const r = await admin('/placements', { method: 'POST', form: { submission_id, ...goodPlacement() } });
    assert.equal(r.status, 400, JSON.stringify(submission_id));
    assert.match(r.text, /must be created from an existing submission/);
  }
  await assert.rejects(sponsors.createPlacement(undefined, goodPlacement(), EDITOR), /existing submission/);
  assert.equal((await sponsors.listPlacements()).length, 0);
});

test('a declined submission cannot be placed', async () => {
  const declined = await sponsors.createSubmission(goodForm({ organisation: 'Declined Org (synthetic)', email: 'declined@example.com' }));
  await sponsors.setSubmissionStatus(declined.id, 'declined', '', EDITOR);
  await assert.rejects(sponsors.createPlacement(declined.id, goodPlacement(), EDITOR), e => e.status === 409);
});

test('placement text is validated: markup, URLs in body, label, link, slot and dates', async () => {
  const s = (await sponsors.listSubmissions()).find(x => x.status === 'under_review');
  const bad = [
    [{ headline: '<script>alert(1)</script>' }, 'headline'],
    [{ body: 'Bold <b>claim</b>' }, 'body'],
    [{ sponsor_name: 'Example > Others' }, 'sponsor_name'],
    [{ body: 'See https://tracker.example.com/pixel for more' }, 'body'],
    [{ body: 'See www.example.com for more' }, 'body'],
    [{ body: 'Visit example.com today' }, 'body'],
    [{ headline: 'h'.repeat(91) }, 'headline'],
    [{ body: 'b'.repeat(241) }, 'body'],
    [{ label: '' }, 'label'],
    [{ label: 'Partner content' }, 'label'],
    [{ link: 'http://sponsor.example.com/' }, 'link'],
    [{ link: 'javascript:alert(1)' }, 'link'],
    [{ slot: 'affordability' }, 'slot'],
    [{ start_date: '01/11/2026' }, 'start_date'],
    [{ end_date: '2026-02-31' }, 'end_date'],
    [{ start_date: '2026-11-30', end_date: '2026-11-30' }, 'end_date'],
    [{ start_date: '2026-11-30', end_date: '2026-11-01' }, 'end_date'],
    [{ start_date: '2026-01-01', end_date: '2026-04-02' }, 'end_date'] // 91 days
  ];
  for (const [over, fieldName] of bad) {
    const { errors } = sponsors.validatePlacement(goodPlacement(over));
    assert.ok(errors[fieldName], `expected an error on ${fieldName} for ${JSON.stringify(over)}`);
    await assert.rejects(sponsors.createPlacement(s.id, goodPlacement(over), EDITOR), e => e.status === 400 && !!e.fields[fieldName]);
  }
  assert.deepEqual(sponsors.validatePlacement(goodPlacement({ start_date: '2026-01-01', end_date: '2026-04-01' })).errors, {}); // exactly 90 days
  // Through the route as well: the script headline is rejected and shown escaped.
  const r = await admin('/placements', { method: 'POST', form: { submission_id: s.id, ...goodPlacement({ headline: '<script>alert(1)</script>' }) } });
  assert.equal(r.status, 400);
  assert.match(r.text, /plain text without &lt; or &gt;/);
  assert.ok(!r.text.includes('<script>alert(1)</script>'));
  assert.equal((await sponsors.listPlacements()).length, 0);
});

test('placements need a named reviewer', async () => {
  const s = (await sponsors.listSubmissions()).find(x => x.status === 'under_review');
  assert.throws(() => sponsors.createPlacement(s.id, goodPlacement(), null), e => e.status === 403);
  assert.throws(() => sponsors.withdrawPlacement('00000000-0000-4000-8000-000000000000', 'reason', {}), e => e.status === 403);
});

// ---- display --------------------------------------------------------------

let placementId;
const inWindow = new Date('2026-11-15T12:00:00Z');

test('editor creates a placement; display stays off by default even though it is approved', async () => {
  const s = (await sponsors.listSubmissions()).find(x => x.status === 'under_review');
  const r = await admin('/placements', { method: 'POST', form: { submission_id: s.id, ...goodPlacement() } });
  assert.equal(r.status, 303);
  const all = await sponsors.listPlacements();
  assert.equal(all.length, 1);
  placementId = all[0].id;
  assert.equal(all[0].status, 'approved');
  assert.equal(all[0].approved_by, 'fixture-sponsor-editor');
  assert.equal(all[0].submission_id, s.id);
  assert.equal((await sponsors.getSubmission(s.id)).status, 'placed');
  assert.equal(process.env.SPONSOR_DISPLAY_ENABLED, undefined);
  assert.deepEqual(await sponsors.activePlacements('news-list', inWindow), []);
  for (const value of ['1', 'yes', 'TRUE']) {
    process.env.SPONSOR_DISPLAY_ENABLED = value;
    assert.deepEqual(await sponsors.activePlacements('news-list', inWindow), [], `"${value}" must not enable display`);
  }
  delete process.env.SPONSOR_DISPLAY_ENABLED;
});

test('with display enabled the placement shows only in its slot and only inside its date window', async () => {
  process.env.SPONSOR_DISPLAY_ENABLED = 'true';
  const shown = await sponsors.activePlacements('news-list', inWindow);
  assert.equal(shown.length, 1);
  assert.deepEqual(Object.keys(shown[0]).sort(), ['body', 'headline', 'label', 'link', 'sponsor_name']);
  assert.equal(shown[0].label, 'Advertisement');
  assert.deepEqual(await sponsors.activePlacements('article-footer', inWindow), []);
  assert.deepEqual(await sponsors.activePlacements('newsletter', inWindow), []);
  const at = iso => sponsors.activePlacements('news-list', new Date(iso)).then(x => x.length);
  assert.equal(await at('2026-10-31T23:59:59Z'), 0, 'before the start date');
  assert.equal(await at('2026-11-01T00:00:00Z'), 1, 'first moment of the start date');
  assert.equal(await at('2026-11-30T23:59:59Z'), 1, 'last moment of the end date');
  assert.equal(await at('2026-12-01T00:00:00Z'), 0, 'after the end date');
});

test('slots outside the allowlist throw, including every clinical and affordability context', async () => {
  assert.deepEqual([...sponsors.SLOT_ALLOWLIST], ['news-list', 'article-footer', 'newsletter']);
  assert.ok(sponsors.FORBIDDEN_CONTEXTS.length > 0);
  for (const required of ['tools', 'treatments', 'substance-alerts', 'affordability'])
    assert.ok(sponsors.FORBIDDEN_CONTEXTS.includes(required), required + ' is listed as forbidden');
  for (const slot of [...sponsors.FORBIDDEN_CONTEXTS, 'homepage', '', undefined, null, 42, 'News-List', '__proto__']) {
    assert.ok(!sponsors.SLOT_ALLOWLIST.includes(slot));
    await assert.rejects(sponsors.activePlacements(slot, inWindow), /not permitted/, String(slot));
  }
  // Throws even when display is switched off, so a wrong include fails in development too.
  delete process.env.SPONSOR_DISPLAY_ENABLED;
  await assert.rejects(sponsors.activePlacements('affordability', inWindow), /not permitted/);
  process.env.SPONSOR_DISPLAY_ENABLED = 'true';
  assert.throws(() => { sponsors.SLOT_ALLOWLIST.push('tools'); }, TypeError, 'allowlist is frozen');
});

test('a stored record that was edited by hand cannot widen what is shown', async () => {
  const file = path.join(root, 'sponsors', 'placements', placementId + '.json');
  const original = await fsp.readFile(file, 'utf8');
  for (const tamper of [{ link: 'http://sponsor.example.com/' }, { label: 'Editorial' }, { headline: '<img src=x>' }, { slot: 'tools' }]) {
    await fsp.writeFile(file, JSON.stringify({ ...JSON.parse(original), ...tamper }));
    assert.deepEqual(await sponsors.activePlacements('news-list', inWindow), [], JSON.stringify(tamper));
  }
  await fsp.writeFile(file, original);
  assert.equal((await sponsors.activePlacements('news-list', inWindow)).length, 1);
});

test('publicView exposes only label, sponsor_name, headline, body and link', async () => {
  const [stored] = await sponsors.listPlacements();
  const view = sponsors.publicView({ ...stored, email: 'ads@example.com', contact_name: 'Test Contact', review_note: 'private note' });
  assert.deepEqual(Object.keys(view), ['label', 'sponsor_name', 'headline', 'body', 'link']);
  const text = JSON.stringify(view);
  for (const secret of ['ads@example.com', 'Test Contact', 'private note', 'fixture-sponsor-editor', stored.id, stored.submission_id, 'approved'])
    assert.ok(!text.includes(secret), 'publicView must not contain ' + secret);
});

test('slot partial renders nothing when empty and a labelled, rel="sponsored" block otherwise', async () => {
  assert.equal((await renderSlot([])).trim(), '');
  assert.equal((await renderSlot(undefined)).trim(), '');
  const html = await renderSlot(await sponsors.activePlacements('news-list', inWindow));
  assert.match(html, /<aside class="sponsor-slot" aria-label="Advertisement">/);
  assert.match(html, /class="sponsor-label">Advertisement/);
  assert.ok(html.includes('rel="sponsored nofollow noopener noreferrer"'));
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('href="https://sponsor.example.com/offer"'));
  assert.ok(html.includes('Synthetic headline for testing') && html.includes('Example Pharmacy Supplies'));
  assert.doesNotMatch(html, /<script|<img|ads@example\.com|fixture-sponsor-editor/i);
  // Output is escaped even if something unexpected is passed in, and unlabelled items are dropped.
  const hostile = await renderSlot([{ label: 'Sponsored', sponsor_name: 'A&B <i>', headline: '<script>x</script>', body: 'b', link: 'https://example.com/?a=1&b=2' }, { label: '', sponsor_name: 'Unlabelled', headline: 'h', body: 'b', link: 'https://example.com/' }, { label: 'Sponsored', sponsor_name: 'Bad link', headline: 'h', body: 'b', link: 'javascript:alert(1)' }]);
  assert.ok(!hostile.includes('<script>') && hostile.includes('&lt;script&gt;'));
  assert.ok(!hostile.includes('Unlabelled') && !hostile.includes('javascript:'));
  assert.equal(hostile.match(/<aside/g).length, 1);
});

test('the policy page names the active sponsor while a placement is live', async () => {
  // Uses the real clock, so add a placement that is live today.
  const s = await sponsors.createSubmission(goodForm({ organisation: 'Live Today Org (synthetic)', email: 'live@example.com' }));
  const today = new Date(), day = d => d.toISOString().slice(0, 10);
  const live = await sponsors.createPlacement(s.id, goodPlacement({ label: 'Sponsored', sponsor_name: 'Live Today Sponsor', slot: 'newsletter', start_date: day(today), end_date: day(new Date(today.getTime() + 7 * 864e5)) }), EDITOR);
  let html = await (await fetch(url + '/advertise')).text();
  assert.ok(html.includes('Live Today Sponsor'));
  assert.ok(!html.includes('currently no active advertisers or sponsors'));
  assert.ok(!html.includes('live@example.com'));
  await sponsors.withdrawPlacement(live.id, 'Test clean-up', EDITOR);
  html = await (await fetch(url + '/advertise')).text();
  assert.ok(!html.includes('Live Today Sponsor'), 'withdrawn sponsor is no longer named');
  // With display switched off, no sponsor is named whatever is stored.
  delete process.env.SPONSOR_DISPLAY_ENABLED;
  html = await (await fetch(url + '/advertise')).text();
  assert.ok(html.includes('currently no active advertisers or sponsors'));
  process.env.SPONSOR_DISPLAY_ENABLED = 'true';
});

test('withdrawal needs a reason; a withdrawn placement disappears and cannot be withdrawn twice', async () => {
  let r = await admin(`/placements/${placementId}/withdraw`, { method: 'POST', form: { reason: '   ' } });
  assert.equal(r.status, 400);
  assert.equal((await sponsors.activePlacements('news-list', inWindow)).length, 1);
  r = await admin(`/placements/${placementId}/withdraw`, { method: 'POST', as: 'source', form: { reason: 'Not an editor' } });
  assert.equal(r.status, 403);
  r = await admin(`/placements/${placementId}/withdraw`, { method: 'POST', form: { reason: 'Sponsor asked to stop' } });
  assert.equal(r.status, 303);
  assert.deepEqual(await sponsors.activePlacements('news-list', inWindow), []);
  const stored = (await sponsors.listPlacements()).find(p => p.id === placementId);
  assert.equal(stored.status, 'withdrawn');
  assert.equal(stored.withdrawn_by, 'fixture-sponsor-editor');
  assert.equal(stored.withdrawal_reason, 'Sponsor asked to stop');
  r = await admin(`/placements/${placementId}/withdraw`, { method: 'POST', form: { reason: 'Again' } });
  assert.equal(r.status, 409);
  r = await admin('/placements/00000000-0000-4000-8000-000000000000/withdraw', { method: 'POST', form: { reason: 'Missing' } });
  assert.equal(r.status, 404);
});

// ---- audit and storage ----------------------------------------------------

test('audit log is append-only JSON lines recording actor, action, target and time', async () => {
  const raw = await fsp.readFile(path.join(root, 'sponsors', 'audit.jsonl'), 'utf8');
  const lines = raw.trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(lines, await sponsors.readAudit());
  for (const entry of lines) {
    assert.ok(typeof entry.actor === 'string' && entry.actor);
    assert.ok(typeof entry.action === 'string' && entry.action);
    assert.match(entry.target, /^[a-f0-9-]{36}$/);
    assert.ok(Number.isFinite(Date.parse(entry.at)));
  }
  const by = action => lines.filter(l => l.action === action);
  assert.equal(by('submission_received')[0].actor, 'public-form');
  for (const action of ['submission_under_review', 'submission_declined', 'placement_approved', 'placement_withdrawn'])
    assert.ok(by(action).length && by(action).every(l => l.actor === 'fixture-sponsor-editor'), action + ' records the acting reviewer');
  assert.ok(by('placement_withdrawn').some(l => l.target === placementId));
  // Refused attempts (non-editor, cross-origin, unauthenticated) left no trace as actions.
  assert.ok(!lines.some(l => l.actor === 'fixture-source'));
  assert.ok(!raw.includes('ads@example.com'), 'audit log holds ids, not contact details');
});

test('concurrent writes are serialised and leave no temporary files', async () => {
  const before = await submissionCount();
  await Promise.all(Array.from({ length: 8 }, (_, i) => sponsors.createSubmission(goodForm({ email: `bulk${i}@example.com` }))));
  assert.equal(await submissionCount(), before + 8);
  const files = await fsp.readdir(path.join(root, 'sponsors', 'submissions'));
  assert.ok(files.every(f => f.endsWith('.json')));
  const lines = (await fsp.readFile(path.join(root, 'sponsors', 'audit.jsonl'), 'utf8')).trim().split('\n');
  assert.doesNotThrow(() => lines.forEach(l => JSON.parse(l)));
});
