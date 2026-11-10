'use strict';
// Tests for the 2026-11-09 platform work: due-based hourly schedule, startup policy, alerts,
// all-desk news listing and public projection, clinical-tool gate and calculators, and the
// new reader pages. Synthetic data only; no network.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const root = require('fs').mkdtempSync(path.join(os.tmpdir(), 'pharmacy-platform-'));
process.env.CONTENT_DIR = root;
for (const k of ['ALLOW_COLLECTION', 'RUN_SCHEDULED_JOBS', 'RUN_NEWS_SCHEDULE', 'ALLOW_MODEL_CALLS', 'NEWS_SOURCE_IDS', 'ALERT_WEBHOOK_URL', 'SPONSOR_DISPLAY_ENABLED', 'PUBLIC_SITE_URL', 'REVIEWER_REGISTRY_FILE']) delete process.env[k];
const password = 'fixture-platform-password', hash = require('bcrypt').hashSync(password, 4);
process.env.ADMIN_USERNAME = 'offline-test-editor'; process.env.ADMIN_PASSWORD_HASH = hash;

const express = require('express');
const store = require('../lib/store');
const due = require('../lib/collection/due-schedule');
const policy = require('../lib/collection/schedule-policy');
const state = require('../lib/collection/state');
const registry = require('../config/source-registry');
const HOUR = 3600000;
let server, url;

before(async () => {
  await store.ensureDirectories();
  const app = express();
  app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'views'));
  app.use(require('../middleware/security').headers);
  app.use(express.json()); app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => { if (req.get('x-fixture-auth') === 'yes') req.session = { authenticated: true, username: 'offline-test-editor', account_source: 'legacy_admin', credential: require('../lib/reviewers').credentialDigest(hash) }; else req.session = {}; next(); });
  app.use((req, res, next) => { res.locals.categories = require('../config/categories').CATEGORIES; next(); });
  const site = require('../routes/site');
  app.use('/', site.publicRouter); app.use('/admin', site.adminRouter); app.use('/', require('../routes/public'));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  url = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { await new Promise(r => server.close(r)); await fs.rm(root, { recursive: true, force: true }); });

// ---------------------------------------------------------------- schedule
test('due schedule: every eligible source has a polling interval of at most 24 hours and the pool covers the whole mission', () => {
  const pool = due.pool();
  assert.ok(pool.length >= 50);
  for (const s of pool) { const h = due.pollHours(s); assert.ok(Number.isInteger(h) && h >= 1 && h <= 24, s.id); assert.equal(s.access, 'public_metadata'); assert.notEqual(s.adapter, 'unavailable'); }
  const desks = require('../lib/news/desks'), covered = new Set(pool.map(desks.forSource));
  for (const d of ['approvals', 'safety', 'infectious', 'amr', 'research', 'autoimmune', 'ai', 'repurposing', 'substances']) assert.ok(covered.has(d), 'no scheduled source for desk ' + d);
  // Blocked, restricted, prohibited and unbuilt sources are never scheduled.
  for (const s of registry.filter(x => x.adapter === 'unavailable' || x.access !== 'public_metadata' || x.rights?.status === 'prohibited')) assert.ok(!pool.includes(s), s.id);
});

test('due schedule capacity: the intended cadence fits one hourly tick, the daily request cap and every per-host cap', () => {
  const c = due.capacity();
  assert.equal(c.achievable, true);
  assert.ok(c.utilisation <= 0.8, 'needs headroom, got ' + c.utilisation);
  assert.ok(c.worst_case_requests_per_day <= due.LIMITS.dailyRequests * 0.5);
  assert.deepEqual(c.hosts_over_limit, []);
  // The old rotation could not meet a daily cadence for 24-hour sources: 34 sources at 8 per six-hour run.
  assert.ok(34 / policy.PER_RUN * 6 > 24);
});

test('due schedule fairness: over 72 simulated hours no source waits more than its interval plus two ticks, including after a cold start', () => {
  const pool = due.pool(), health = {}, last = {}, worst = {};
  const t0 = Date.parse('2026-11-01T00:07:00Z');
  for (let tick = 0; tick < 72; tick++) {
    const now = t0 + tick * HOUR, { batch } = due.select({ sources: pool, health, now });
    assert.ok(batch.length <= due.PER_RUN);
    for (const s of batch) { if (last[s.id] != null) worst[s.id] = Math.max(worst[s.id] || 0, (now - last[s.id]) / HOUR); last[s.id] = now; health[s.id] = { status: 'success', completed_at: new Date(now).toISOString(), consecutive_failures: 0 }; }
    if (tick === 3) assert.equal(Object.keys(last).length, pool.length, 'cold start should reach every source within four ticks');
  }
  for (const s of pool) assert.ok((worst[s.id] || 0) <= due.pollHours(s) + 2, `${s.id} waited ${worst[s.id]}h for a ${due.pollHours(s)}h interval`);
});

test('due schedule: most-overdue first, a batch cap that defers rather than drops, and missed ticks are caught up', () => {
  const sources = Array.from({ length: 30 }, (_, i) => ({ id: 's' + String(i).padStart(2, '0'), adapter: 'rss', access: 'public_metadata', poll_hours: 1, url: 'https://example.test/' + i, rights: {} }));
  const now = Date.parse('2026-11-01T12:07:00Z'), health = Object.fromEntries(sources.map((s, i) => [s.id, { status: 'success', completed_at: new Date(now - (i + 1) * HOUR).toISOString() }]));
  const first = due.select({ sources, health, now });
  assert.equal(first.due, 30); assert.equal(first.batch.length, due.PER_RUN); assert.equal(first.deferred, 30 - due.PER_RUN);
  assert.equal(first.batch[0].id, 's29'); // oldest
  // After a six-hour outage every source is simply due again; nothing is skipped or double-counted.
  const later = due.select({ sources, health: Object.fromEntries(sources.map(s => [s.id, { status: 'success', completed_at: new Date(now).toISOString() }])), now: now + 6 * HOUR });
  assert.equal(later.due, 30);
  // Not due yet inside the interval.
  assert.equal(due.select({ sources, health: Object.fromEntries(sources.map(s => [s.id, { status: 'success', completed_at: new Date(now).toISOString() }])), now: now + 20 * 60000 }).due, 0);
});

test('due schedule failure recovery: failed sources back off exponentially, keep their last success, and state survives a restart', async () => {
  process.env.ALLOW_COLLECTION = 'true'; process.env.NEWS_SOURCE_IDS = due.NAME;
  try {
    const requested = [], failing = async (u, source) => { requested.push(source.id); throw Object.assign(new Error('Source HTTP 503'), { code: 'HTTP_503' }); };
    const t0 = Date.parse('2026-11-02T00:07:00Z');
    const r1 = await policy.run({ trigger: 'cron', now: t0, client: failing });
    assert.equal(r1.status, 'failed'); assert.equal(r1.schedule.collected, due.PER_RUN); assert.ok(r1.schedule.deferred_to_next_tick > 0);
    // "Restart": everything is read back from disk, nothing from memory.
    const health = await state.read('health', {});
    const failed = Object.values(health).filter(h => h.status === 'failed');
    assert.equal(failed.length, due.PER_RUN); assert.ok(failed.every(h => h.consecutive_failures === 1 && h.last_success_at === null));
    // 30 minutes later the failed sources are backing off; other never-attempted sources go first.
    const second = due.select({ health, now: t0 + 30 * 60000 });
    assert.ok(second.batch.every(s => !health[s.id]));
    // Backoff grows 1h, 2h, 4h … capped at 24h.
    assert.deepEqual([1, 2, 3, 4, 9].map(n => due.retryDelayMs(n) / HOUR), [1, 2, 4, 8, 24]);
    const id = failed[0].source_id, src = registry.find(s => s.id === id);
    assert.equal(due.dueAt(src, { ...health[id], consecutive_failures: 3 }), Date.parse(health[id].completed_at) + 4 * HOUR);
    // The run journal recorded a failed scheduled run; blocked sources were never requested.
    const journal = await require('../lib/collection/run-journal').inspect({ now: t0 + 60000 });
    assert.equal(journal.last_run.status, 'failed'); assert.equal(journal.consecutive_failures, 1);
    assert.ok(requested.every(x => due.pool().some(s => s.id === x)));
  } finally { delete process.env.ALLOW_COLLECTION; delete process.env.NEWS_SOURCE_IDS; }
});

test('hourly missed-slot detection does not let a later run mask an earlier missed hour', () => {
  const { missedSlots } = require('../lib/collection/run-journal');
  const at = h => new Date(Date.parse('2026-11-03T00:07:00Z') + h * HOUR).toISOString();
  const runs = [0, 1, 3, 4].map(h => ({ trigger: 'cron', started_at: at(h) })); // hour 2 missed
  assert.deepEqual(missedSlots(runs, { everyHours: 1, now: Date.parse(at(4)) + 40 * 60000 }), ['2026-11-03T02:00:00.000Z']);
  assert.deepEqual(policy.timing(due.NAME), { name: due.NAME, cron: '7 * * * *', tickHours: 1 });
  assert.equal(policy.timing('rotation:worldwide').tickHours, 6);
});

// ---------------------------------------------------------------- startup
test('startup policy: collection is off unless COLLECTION_PAUSED is exactly "false"; models and watcher are always off', () => {
  const { decide } = require('../lib/collection/startup-policy');
  for (const v of [undefined, '', 'true', 'TRUE', 'no', '0', 'False']) { const d = decide({ COLLECTION_PAUSED: v, ALLOW_COLLECTION: 'true', ALLOW_MODEL_CALLS: 'true' }); assert.equal(d.collection_enabled, false, String(v)); assert.equal(d.env.ALLOW_COLLECTION, 'false'); assert.equal(d.env.RUN_SCHEDULED_JOBS, 'false'); assert.equal(d.env.ALLOW_MODEL_CALLS, 'false'); }
  const on = decide({ COLLECTION_PAUSED: 'false', ALLOW_MODEL_CALLS: 'true', ALLOW_ANTIBIOTIC_WATCH: 'true' });
  assert.equal(on.collection_enabled, true); assert.equal(on.env.NEWS_SOURCE_IDS, 'schedule:due');
  assert.equal(on.env.ALLOW_MODEL_CALLS, 'false'); assert.equal(on.env.ALLOW_ANTIBIOTIC_WATCH, 'false'); assert.equal(on.env.RUN_ANTIBIOTIC_SCHEDULE, 'false');
});

test('production refuses a direct server.js start, and render.yaml uses the durable entry point with collection paused', async () => {
  const r = spawnSync(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { PATH: process.env.PATH, NODE_ENV: 'production', CONTENT_DIR: root, PORT: '0', SESSION_SECRET: 'synthetic-fixture-only-not-a-real-secret' }, encoding: 'utf8', timeout: 15000 });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /npm start/);
  const yaml = await fs.readFile(path.join(__dirname, '..', 'render.yaml'), 'utf8');
  assert.match(yaml, /startCommand: node scripts\/start-review\.js/);
  assert.match(yaml, /key: COLLECTION_PAUSED\n\s+value: "true"/);
  assert.doesNotMatch(yaml, /key: CONTENT_DIR/);
  assert.equal(require('../package.json').scripts.start, 'node scripts/start-review.js');
  // The preview entry forces every outward-facing switch off and never uses ./content.
  const preview = await fs.readFile(path.join(__dirname, '..', 'scripts', 'start-preview.js'), 'utf8');
  assert.match(preview, /HOST = '127\.0\.0\.1'/); assert.match(preview, /\.preview-store/); assert.doesNotMatch(preview, /\.\.\/content'/);
});

// ---------------------------------------------------------------- alerts
test('alerts: error issues are logged once per cooldown, nothing is sent without a webhook, and a failed delivery is retried', async () => {
  const alerts = require('../lib/alerts'), now = Date.parse('2026-11-04T00:00:00Z');
  const issues = [{ severity: 'error', kind: 'scheduled_run_missed', slot: '2026-11-03T23:00:00.000Z' }, { severity: 'warning', kind: 'source_failing', source_id: 'x' }];
  let sent = 0; const send = async () => { sent++; return { ok: true }; };
  assert.deepEqual(await alerts.notify(issues, { now, send }), { new_alerts: 1, delivery: 'not_configured' });
  assert.equal(sent, 0); assert.equal(alerts.configured(), false);
  assert.equal((await alerts.notify(issues, { now: now + HOUR, send })).new_alerts, 0); // cooldown
  process.env.ALERT_WEBHOOK_URL = 'http://insecure.example.test/hook'; assert.equal(alerts.configured(), false); // https only
  process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.test/pn';
  try {
    const other = [{ severity: 'error', kind: 'consecutive_run_failures', count: 2 }];
    assert.equal((await alerts.notify(other, { now, send: async () => ({ ok: false }) })).delivery, 'delivery_failed');
    let payload; const r = await alerts.notify(other, { now: now + 60000, send: async (u, p) => { payload = p; return { ok: true }; } });
    assert.equal(r.delivery, 'delivered'); assert.deepEqual(Object.keys(payload.issues[0]).sort(), ['count', 'kind', 'slot', 'source_id']);
  } finally { delete process.env.ALERT_WEBHOOK_URL; }
  assert.ok((await alerts.recent()).length >= 2);
});

// ---------------------------------------------------------------- news listing
const lead = (id, sourceId, title, extra = {}) => {
  const s = registry.find(x => x.id === sourceId), now = new Date().toISOString();
  return { id, slug: id, title, source: s.name, source_url: extra.url || s.url, summary: '', body: '', category: 'global-health', status: 'pending', language: 'en', data_kind: 'news_metadata',
    provenance: { source_id: sourceId, published_at: extra.published === undefined ? now : extra.published, retrieved_at: now }, ingestion: { source_id: sourceId, source_hash: 'h', requires_original_summary: true }, tags: [], ...extra.fields };
};
test('news listing: desks cover the mission, unreviewed titles are labelled by kind, drafts and blocked sources stay private', async () => {
  const news = require('../lib/news/listing');
  await store.writeArticle('pending', 'lead-ema', lead('lead-ema', 'ema-news', 'Synthetic regulator title <script>alert(1)</script>'));
  await store.writeArticle('pending', 'lead-who', lead('lead-who', 'who-don-api', 'Synthetic outbreak title', { url: 'https://www.who.int/emergencies/disease-outbreak-news/item/synthetic' }));
  await store.writeArticle('pending', 'lead-pubmed', lead('lead-pubmed', 'pubmed-repurposing', 'Synthetic repurposing paper title', { url: 'https://pubmed.ncbi.nlm.nih.gov/1/', published: null }));
  await store.writeArticle('pending', 'lead-offsite', lead('lead-offsite', 'ema-news', 'Off-site link', { url: 'https://evil.example.test/x' }));
  await store.writeArticle('pending', 'lead-future', lead('lead-future', 'ema-news', 'Future dated', { url: 'https://www.ema.europa.eu/en/news/future', published: new Date(Date.now() + 5 * 86400000).toISOString() }));
  await store.writeArticle('pending', 'draft-private', lead('draft-private', 'ema-news', 'PRIVATE DRAFT TITLE', { url: 'https://www.ema.europa.eu/en/news/draft', fields: { summary: 'Private editorial draft summary that must never be public.' } }));
  const blocked = registry.find(s => s.access === 'validation_blocked');
  await store.writeArticle('pending', 'lead-blocked', lead('lead-blocked', blocked.id, 'From a blocked source'));
  news.clearCache();
  const all = await news.listing({});
  const titles = all.items.map(i => i.title);
  assert.ok(titles.includes('Synthetic outbreak title')); assert.ok(!titles.includes('PRIVATE DRAFT TITLE')); assert.ok(!titles.includes('Off-site link')); assert.ok(!titles.includes('From a blocked source'));
  const by = id => all.items.find(i => i.id === id);
  assert.equal(by('lead-ema').kind, 'official_title'); assert.equal(by('lead-ema').desk, 'approvals');
  assert.equal(by('lead-who').desk, 'infectious');
  assert.equal(by('lead-pubmed').kind, 'research_index'); assert.equal(by('lead-pubmed').desk, 'repurposing');
  assert.equal(by('lead-pubmed').date_published, null); assert.equal(by('lead-pubmed').date_note, 'Source gave no publication date'); assert.ok(by('lead-pubmed').retrieved_at);
  assert.equal(by('lead-future').date_published, null); assert.match(by('lead-future').date_note, /later than retrieval/);
  for (const i of all.items) { assert.equal(i.summary, undefined); assert.ok(/^https:\/\//.test(i.source_url)); }
  assert.equal((await news.listing({ desk: 'repurposing' })).items.length, 1);
  assert.equal((await news.listing({ kind: 'research_index' })).totals.matching, 1);
  assert.equal((await news.listing({ q: 'OUTBREAK' })).totals.matching, 1);
  assert.equal((await news.listing({ desk: 'not-a-desk', kind: 'bogus', region: 'ZZ', since: '2026-13-45' })).totals.matching, all.totals.matching); // invalid filters ignored, not errors
  // Pages
  const html = await (await fetch(url + '/news')).text();
  assert.match(html, /Official title \(unreviewed\)/); assert.match(html, /Research index title \(unreviewed\)/);
  assert.ok(!html.includes('<script>alert(1)</script>')); assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;')); assert.ok(!html.includes('PRIVATE DRAFT'));
  assert.equal((await fetch(url + '/news/approvals')).status, 200); assert.equal((await fetch(url + '/news/not-a-desk')).status, 404);
  const empty = await (await fetch(url + '/news/industry')).text(); assert.match(empty, /does not mean nothing happened/);
  const api = await (await fetch(url + '/api/news?desk=infectious')).json(); assert.equal(api.items.length, 1); assert.equal(JSON.stringify(api).includes('ingestion'), false);
});

test('public article projection never exposes reviewer identities, approvals, scores or ingestion state', () => {
  const pa = require('../lib/news/public-article');
  const a = { id: 'a1', slug: 'a1', title: 'T', summary: 'S', body: '<p>B</p><script>x</script>', category: 'industry', source: 'Src', source_url: 'javascript:alert(1)', date_published: '2026-11-01',
    review: { reviewer: 'secret-reviewer', reviewed_at: '2026-11-02T00:00:00Z', event: 'e', revision: 'r' }, clinical_review: { reviewer: 'secret-clinician' }, evidence_review: { reviewer: 'x' }, rights_review: { reviewer: 'y', basis: 'z' },
    editorial_score: 9, editorial: { specialist_review_requirements: 'internal note' }, ingestion: { source_hash: 'h' }, instagram_caption: 'c', image_prompt: 'p', provenance: { retrieved_at: '2026-11-01T00:00:00Z' } };
  const out = pa.detail(a, require('../lib/publication').sanitize), text = JSON.stringify(out);
  for (const leak of ['secret-reviewer', 'secret-clinician', 'internal note', 'editorial_score', 'ingestion', 'instagram', 'image_prompt', 'rights_review', 'javascript:']) assert.ok(!text.includes(leak), leak);
  assert.equal(out.source_url, null); assert.equal(out.reviewed_at, '2026-11-02T00:00:00Z'); assert.equal(out.desk, 'industry'); assert.ok(!out.body_html.includes('<script'));
});

// ---------------------------------------------------------------- clinical tools
test('calculators: documented reference cases, unit handling, boundaries and error states', () => {
  const { calculate, CALCULATORS } = require('../lib/clinical/calculators');
  const v = (id, input) => calculate(id, input).results[0].value;
  // Cockcroft–Gault: (140−age)×kg ÷ (72×SCr), ×0.85 female.
  assert.equal(v('cockcroft-gault', { age: '60', weight: '72', scr: '1.0', sex: 'male' }), 80);
  assert.equal(v('cockcroft-gault', { age: '60', weight: '72', scr: '1.0', sex: 'female' }), 68);
  assert.equal(v('cockcroft-gault', { age: '40', weight: '80', scr: '1.2', sex: 'male' }), 92.6);
  assert.equal(v('cockcroft-gault', { age: '120', weight: '20', scr: '20', sex: 'female' }), 0.2); // extreme bounds stay finite and non-negative
  // Devine: 50 / 45.5 kg + 2.3 kg per inch over 60 inches.
  assert.equal(v('ideal-body-weight-devine', { height: '177.8', sex: 'male' }), 73);
  assert.equal(v('ideal-body-weight-devine', { height: '160.02', sex: 'female' }), 52.4);
  assert.equal(v('ideal-body-weight-devine', { height: '152.4', sex: 'male' }), 50);
  assert.throws(() => calculate('ideal-body-weight-devine', { height: '150', sex: 'male' }), /between 152.4/); // no extrapolation below 60 inches
  // Mosteller: √(cm×kg/3600).
  assert.equal(v('bsa-mosteller', { height: '180', weight: '80' }), 2);
  assert.equal(v('bsa-mosteller', { height: '170', weight: '70' }), 1.82);
  // Infusion conversion: mcg/kg/min × kg × 60 ÷ mcg/mL.
  assert.equal(v('infusion-rate-conversion', { dose: '0.1', weight: '80', concentration: '16' }), 30);
  assert.equal(v('infusion-rate-conversion', { dose: '5', weight: '70', concentration: '1600' }), 13.13);
  // Error states: missing, non-numeric, negative, scientific notation, out of range, bad choice, unknown tool.
  for (const bad of [{}, { age: 'abc', weight: '70', scr: '1', sex: 'male' }, { age: '-5', weight: '70', scr: '1', sex: 'male' }, { age: '1e2', weight: '70', scr: '1', sex: 'male' }, { age: '17', weight: '70', scr: '1', sex: 'male' }, { age: '60', weight: '70', scr: '0', sex: 'male' }, { age: '60', weight: '70', scr: '1', sex: 'other' }, { age: '60', weight: '70', scr: '1' }])
    assert.throws(() => calculate('cockcroft-gault', bad), e => e.code === 'INVALID_INPUT');
  assert.throws(() => calculate('nope', {}), e => e.code === 'UNKNOWN_TOOL');
  // Every calculator states population, units, assumptions, warnings, citations and a version; none names a drug dose.
  for (const c of CALCULATORS) { for (const k of ['population', 'formula', 'purpose', 'version']) assert.ok(c[k], c.id + ' ' + k); assert.ok(c.assumptions.length && c.warnings.length && c.citations.length); for (const f of c.inputs) assert.ok(f.type === 'choice' || (f.unit && Number.isFinite(f.min) && Number.isFinite(f.max))); }
});

test('clinical gate: tools are unavailable until a verified clinical reviewer signs the exact version; expiry, content change and withdrawal close them again', async () => {
  const tools = require('../lib/clinical-tools'), id = 'bsa-mosteller';
  const first = await tools.status(id);
  assert.equal(first.state, 'awaiting_clinical_review'); assert.equal(first.available, false);
  const editor = { id: 'ed', type: 'human', authenticated: true, roles: ['editor'], clinicalCredentialVerified: false, stepUp: true };
  const clinician = { id: 'synthetic-clinician', type: 'human', authenticated: true, roles: ['clinical_reviewer'], clinicalCredentialVerified: true, credential: { profession: 'Pharmacist (synthetic fixture)' }, credentialDigest: 'd', stepUp: true };
  const ok = { formulaChecked: true, citationsChecked: true, testCasesChecked: true };
  await assert.rejects(tools.approve(id, first.version_digest, editor, ok), /credential-verified clinical reviewer/);
  await assert.rejects(tools.approve(id, first.version_digest, { ...clinician, clinicalCredentialVerified: false }, ok), /credential-verified/);
  await assert.rejects(tools.approve(id, first.version_digest, { ...clinician, type: 'model' }, ok), /credential-verified/);
  await assert.rejects(tools.approve(id, first.version_digest, { ...clinician, stepUp: false }, ok), /password/);
  await assert.rejects(tools.approve(id, 'f'.repeat(64), clinician, ok), /changed/);
  await assert.rejects(tools.approve(id, first.version_digest, clinician, { ...ok, testCasesChecked: false }), /Confirm/);
  assert.equal((await tools.status(id)).available, false);
  const now = Date.parse('2026-11-09T12:00:00Z');
  assert.equal((await tools.approve(id, first.version_digest, clinician, ok, now)).state, 'clinically_reviewed');
  assert.equal((await tools.status(id, now)).available, true);
  // A changed tool no longer matches the signed digest.
  const record = JSON.parse(await fs.readFile(path.join(root, 'clinical-tools', 'approvals', id + '.json'), 'utf8'));
  assert.equal(tools.evaluate({ ...first.tool, formula: first.tool.formula + ' (edited)' }, record, now).available, false);
  assert.notEqual(tools.digest({ ...first.tool, compute: v => 1 }), first.version_digest); // a changed calculation also changes the digest
  // Expiry after one year.
  assert.equal((await tools.status(id, now + 366 * 86400000)).state, 'review_expired');
  // Withdrawal needs a reason and a reviewer, takes effect immediately, and is audited.
  await assert.rejects(tools.withdraw(id, editor, ''), /reason/);
  await assert.rejects(tools.withdraw(id, { id: 'anon', type: 'human', authenticated: true, roles: [] }, 'x'), /required/);
  await tools.withdraw(id, editor, 'Synthetic withdrawal');
  assert.equal((await tools.status(id, now)).state, 'withdrawn');
  const log = (await fs.readFile(path.join(root, 'clinical-tools', 'audit.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(log.map(x => [x.action, x.actor]), [['approved', 'synthetic-clinician'], ['withdrawn', 'ed']]);
  // Reference sections without sourced content are listed as unavailable and carry no dosing text.
  for (const r of tools.REFERENCES.filter(x => ['extravasation', 'iv-push', 'critical-care-infusions'].includes(x.id))) { assert.equal(r.status, 'not_available'); assert.doesNotMatch(r.needs, /\d+\s?(mg|mcg|mL|units)/i); }
  assert.equal(tools.REFERENCES.find(r => r.id === 'bugs-and-drugs').status, 'disabled');
});

test('tool pages: an unapproved calculator cannot be run publicly, reviewers can preview, the shared-admin login cannot approve', async () => {
  const page = await fetch(url + '/tools'); assert.equal(page.status, 200);
  const html = await page.text(); assert.match(html, /Awaiting clinical review/); assert.match(html, /Extravasation management/); assert.match(html, /Not available/);
  const tool = await (await fetch(url + '/tools/cockcroft-gault')).text();
  assert.match(tool, /Not available for clinical use/); assert.ok(!tool.includes('<form class="form-grid" method="post"')); assert.match(tool, /noindex/); assert.match(tool, /Nephron/);
  const body = new URLSearchParams({ age: '60', weight: '72', scr: '1.0', sex: 'male' });
  const run = await fetch(url + '/tools/cockcroft-gault', { method: 'POST', body }); assert.equal(run.status, 403); assert.ok(!(await run.text()).includes('80 mL/min'));
  assert.equal((await fetch(url + '/tools/unknown-tool')).status, 404);
  // Admin preview requires sign-in.
  const anon = await fetch(url + '/admin/tools', { redirect: 'manual' }); assert.equal(anon.status, 302);
  const auth = { 'x-fixture-auth': 'yes' };
  const preview = await fetch(url + '/admin/tools/cockcroft-gault/preview', { method: 'POST', body, headers: auth }); assert.equal(preview.status, 200);
  const ptext = await preview.text(); assert.match(ptext, /Reviewer preview/); assert.match(ptext, /80 mL\/min/);
  const bad = await fetch(url + '/admin/tools/cockcroft-gault/preview', { method: 'POST', body: new URLSearchParams({ age: 'x' }), headers: auth }); assert.equal(bad.status, 422); assert.match(await bad.text(), /role="alert"/);
  // Approval: cross-origin refused; wrong password refused; the shared admin has no clinical identity.
  const digest = (await require('../lib/clinical-tools').status('cockcroft-gault')).version_digest, json = { ...auth, 'content-type': 'application/json' };
  const payload = pw => JSON.stringify({ version_digest: digest, password: pw, attestation: { formulaChecked: true, citationsChecked: true, testCasesChecked: true } });
  assert.equal((await fetch(url + '/admin/tools/cockcroft-gault/approve', { method: 'POST', headers: json, body: payload(password) })).status, 403); // no Origin
  assert.equal((await fetch(url + '/admin/tools/cockcroft-gault/approve', { method: 'POST', headers: { ...json, origin: url }, body: payload('wrong') })).status, 401);
  const denied = await fetch(url + '/admin/tools/cockcroft-gault/approve', { method: 'POST', headers: { ...json, origin: url }, body: payload(password) });
  assert.equal(denied.status, 403); assert.match((await denied.json()).error, /credential-verified/);
  assert.equal((await require('../lib/clinical-tools').status('cockcroft-gault')).available, false);
});

// ---------------------------------------------------------------- pages and headers
test('reader pages render with honest states, a restrictive CSP on public pages, robots rules and no sitemap without a configured site URL', async () => {
  for (const p of ['/sources', '/about', '/edition', '/news']) { const r = await fetch(url + p); assert.equal(r.status, 200, p); const t = await r.text(); assert.match(t, /Skip to main content/); assert.match(t, /<main id="main"/); assert.ok(!t.includes('fonts.googleapis.com')); assert.ok(!/teal/i.test(t)); }
  const src = await (await fetch(url + '/sources')).text();
  assert.match(src, /Blocked or restricted/); assert.match(src, /Automatic collection is currently <strong>paused<\/strong>/); assert.match(src, /A gap means we are not seeing reports/);
  assert.equal((await (await fetch(url + '/sources?state=blocked')).text()).includes('ProMED'), true);
  assert.match(await (await fetch(url + '/edition')).text(), /No edition has been released yet/);
  const csp = (await fetch(url + '/news')).headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/); assert.match(csp, /script-src 'self'/); assert.match(csp, /form-action 'self'/); assert.ok(!csp.includes("'unsafe-eval'"));
  const robots = await (await fetch(url + '/robots.txt')).text(); assert.match(robots, /Disallow: \/admin/); assert.ok(!robots.includes('Sitemap:'));
  assert.equal((await fetch(url + '/sitemap.xml')).status, 404);
  process.env.PUBLIC_SITE_URL = 'https://pharmacynews.example.test';
  try { const map = await fetch(url + '/sitemap.xml'); assert.equal(map.status, 200); const xml = await map.text(); assert.match(xml, /https:\/\/pharmacynews\.example\.test\/news\/safety/); assert.ok(!xml.includes('/admin')); assert.ok(!xml.includes('lead-ema')); }
  finally { delete process.env.PUBLIC_SITE_URL; }
  // Public article API: unreviewed collector leads are never served as articles.
  const api = await (await fetch(url + '/api/articles')).json(); assert.deepEqual(api.articles, []);
});
