'use strict';
// Regression tests for the five release blockers found in review of 3e41396.
// Each test fails on 3e41396 and passes after the correction. Synthetic data; no network.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises'), os = require('os'), path = require('path');
const root = require('fs').mkdtempSync(path.join(os.tmpdir(), 'pharmacy-blockers-'));
process.env.CONTENT_DIR = root;
for (const k of ['ALLOW_COLLECTION', 'RUN_SCHEDULED_JOBS', 'RUN_NEWS_SCHEDULE', 'ALLOW_MODEL_CALLS', 'NEWS_SOURCE_IDS', 'ALERT_WEBHOOK_URL', 'PUBLIC_SITE_URL', 'REVIEWER_REGISTRY_FILE']) delete process.env[k];
const store = require('../lib/store'), state = require('../lib/collection/state');
const HOUR = 3600000, DAY = 86400000;
after(() => fs.rm(root, { recursive: true, force: true }));

// 1 ------------------------------------------------------------------------------------
test('blocker 1: a clinical approval is bound to the whole executable calculator implementation, including shared helpers', async () => {
  const tools = require('../lib/clinical-tools'), calc = require('../lib/clinical/calculators');
  const tool = calc.CALCULATORS.find(c => c.id === 'cockcroft-gault');
  const real = await fs.readFile(require.resolve('../lib/clinical/calculators'), 'utf8');
  assert.ok(real.includes('const round ='), 'fixture assumption: shared rounding helper exists');
  // Same tool definition, but the shared rounding helper behaves differently.
  const tampered = real.replace('const round =', 'const round = (n) => Math.floor(n); const _original_round =');
  assert.notEqual(tampered, real);
  const before = tools.digest(tool), afterChange = tools.digest(tool, tools.implementationFingerprint({ [require.resolve('../lib/clinical/calculators')]: tampered }));
  assert.notEqual(afterChange, before, 'changing a shared helper must change the approval digest');
  // An approval recorded for the real implementation is no longer valid for the tampered one.
  const record = { version_digest: before, approved_at: '2026-11-09T00:00:00.000Z', review_due: '2027-11-09' };
  const now = Date.parse('2026-11-10T00:00:00Z');
  assert.equal(tools.evaluate(tool, record, now).available, true);
  assert.equal(tools.evaluate(tool, record, now, tools.implementationFingerprint({ [require.resolve('../lib/clinical/calculators')]: tampered })).available, false);
  // The fingerprint names every file that can change a result, and is stable for unchanged code.
  assert.ok(tools.IMPLEMENTATION_FILES.some(f => f.endsWith(path.join('clinical', 'calculators.js'))));
  assert.equal(tools.digest(tool), tools.digest(tool));
  assert.doesNotMatch(real, /\brequire\s*\(|\bimport\b/, 'calculators.js gained a dependency: add it to IMPLEMENTATION_FILES');
  // Gates are not weakened: the approval still needs a verified clinical reviewer and step-up.
  await assert.rejects(tools.approve(tool.id, before, { id: 'ed', type: 'human', authenticated: true, roles: ['editor'], stepUp: true }, { formulaChecked: true, citationsChecked: true, testCasesChecked: true }), /credential-verified/);
});

// 2 ------------------------------------------------------------------------------------
test('blocker 2: a positive result is never displayed as zero', () => {
  const { calculate, CALCULATORS } = require('../lib/clinical/calculators');
  // Smallest accepted inputs: 0.001 mcg/kg/min × 0.3 kg × 60 ÷ 9999 mcg/mL ≈ 0.0000018 mL/h.
  assert.throws(() => calculate('infusion-rate-conversion', { dose: '0.001', weight: '0.3', concentration: '9999' }), e => e.code === 'INVALID_INPUT' && /too small to display/i.test(e.message));
  // Just below the display threshold is refused, at the threshold is shown as non-zero.
  assert.throws(() => calculate('infusion-rate-conversion', { dose: '0.001', weight: '1', concentration: '15' }), e => e.code === 'INVALID_INPUT'); // 0.004 mL/h
  assert.throws(() => calculate('infusion-rate-conversion', { dose: '0.001', weight: '1', concentration: '10' }), e => e.code === 'INVALID_INPUT'); // 0.006 mL/h: below 0.01, refused rather than shown as 0.01
  assert.equal(calculate('infusion-rate-conversion', { dose: '0.001', weight: '1', concentration: '5' }).results[0].value, 0.012); // small rates keep three decimals
  assert.equal(calculate('infusion-rate-conversion', { dose: '5', weight: '70', concentration: '1600' }).results[0].value, 13.13);
  assert.equal(calculate('infusion-rate-conversion', { dose: '0.1', weight: '80', concentration: '16' }).results[0].value, 30);
  // Property check across every calculator's corner inputs: no finite positive raw value yields a displayed 0.
  for (const c of CALCULATORS) {
    const nums = c.inputs.filter(f => f.type !== 'choice'), choices = c.inputs.filter(f => f.type === 'choice');
    for (let mask = 0; mask < 2 ** nums.length; mask++) for (const opt of (choices[0]?.options || [{ value: undefined }])) {
      const v = Object.fromEntries(nums.map((f, i) => [f.name, String(mask & (1 << i) ? f.max : f.min)])); if (choices[0]) v[choices[0].name] = opt.value;
      try { for (const r of calculate(c.id, v).results) assert.ok(r.value > 0, `${c.id} displayed ${r.value} for ${JSON.stringify(v)}`); }
      catch (e) { assert.equal(e.code, 'INVALID_INPUT', `${c.id}: ${e.message}`); }
    }
  }
});

// 3 ------------------------------------------------------------------------------------
const reviewed = (id, publishedDaysAgo, extra = {}) => ({ id, slug: id, title: 'Reviewed story ' + id, summary: 'A synthetic reviewed summary that is long enough to pass intake checks.', body: '<p>Body</p>', category: 'industry', source: 'Synthetic Source', source_url: 'https://source.example.test/' + id,
  date_published: new Date(Date.now() - publishedDaysAgo * DAY).toISOString().slice(0, 10), status: 'approved', tags: [], review: { reviewed_at: new Date().toISOString() }, ...extra });
test('blocker 3: reviewed stories older than the 90-day window are excluded from every current listing and labelled as archive on their own page', async () => {
  await store.ensureDirectories();
  const cap = require('../lib/publication-capability');
  await store.writeArticle('approved', 'fresh-story', reviewed('fresh-story', 5), cap);
  await store.writeArticle('approved', 'old-story', reviewed('old-story', 200), cap); // reviewed today, source published 200 days ago
  await store.writeArticle('approved', 'old-peptide', reviewed('old-peptide', 120, { is_peptide: true }), cap);
  const news = require('../lib/news/listing'), freshness = require('../lib/news/freshness');
  news.clearCache();
  const ids = (await news.listing({})).items.map(i => i.id);
  assert.ok(ids.includes('fresh-story')); assert.ok(!ids.includes('old-story'), '/news must not list a story outside the window');
  assert.equal(freshness.current(reviewed('x', 89)), true); assert.equal(freshness.current(reviewed('x', 91)), false);
  // HTTP paths
  const express = require('express'), app = express();
  app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'views'));
  app.use((req, res, next) => { res.locals.categories = require('../config/categories').CATEGORIES; next(); });
  app.use('/', require('../routes/site').publicRouter); app.use('/', require('../routes/public'));
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); }), url = 'http://127.0.0.1:' + server.address().port;
  try {
    const api = await (await fetch(url + '/api/articles')).json();
    assert.deepEqual(api.articles.map(a => a.id), ['fresh-story']);
    const home = await (await fetch(url + '/')).text(); assert.ok(home.includes('Reviewed story fresh-story')); assert.ok(!home.includes('Reviewed story old-story'));
    assert.ok(!(await (await fetch(url + '/news')).text()).includes('old-story'));
    assert.ok(!(await (await fetch(url + '/api/news')).text()).includes('old-story'));
    assert.ok(!(await (await fetch(url + '/peptides')).text()).includes('old-peptide'));
    process.env.PUBLIC_SITE_URL = 'https://pharmacynews.example.test';
    try { const map = await (await fetch(url + '/sitemap.xml')).text(); assert.ok(map.includes('/article/fresh-story')); assert.ok(!map.includes('old-story')); } finally { delete process.env.PUBLIC_SITE_URL; }
    // The permanent page still resolves (links are not broken) but is labelled archive and not indexed.
    const page = await fetch(url + '/article/old-story'), html = await page.text();
    assert.equal(page.status, 200); assert.match(html, /Archive/); assert.match(html, /older than 90 days/); assert.match(html, /name="robots" content="noindex"/);
    assert.equal((await (await fetch(url + '/api/articles/old-story')).json()).article.archived, true);
    assert.equal((await (await fetch(url + '/api/articles/fresh-story')).json()).article.archived, false);
    assert.doesNotMatch(await (await fetch(url + '/article/fresh-story')).text(), /older than 90 days/);
  } finally { await new Promise(r => server.close(r)); }
});

// 4 ------------------------------------------------------------------------------------
test('blocker 4: moving from the six-hour rotation to the hourly schedule does not report the old gaps as missed runs, but real misses after the change are still reported', async () => {
  const journal = require('../lib/collection/run-journal');
  const t0 = Date.parse('2026-11-08T00:00:00Z'), at = h => new Date(t0 + h * HOUR).toISOString();
  // History written by the six-hour rotation: runs at 00:00, 06:00, 12:00, 18:00 …
  const old = [0, 6, 12, 18, 24, 30].map(h => ({ run_id: 'old-' + h, trigger: 'cron', status: 'success', started_at: at(h), completed_at: at(h) }));
  await state.write('run-journal', { runs: [...old].reverse() });
  // Switch-over: the hourly schedule is activated at hour 31.
  const switched = t0 + 31 * HOUR;
  const epoch = await journal.activateSchedule({ name: 'schedule:due', tickHours: 1, enabled: true }, switched);
  assert.equal(epoch.since, new Date(switched).toISOString());
  let r = await journal.inspect({ now: switched + 20 * 60000, scheduleEnabled: true, everyHours: 1 });
  assert.deepEqual(r.missed_slots, [], 'six-hourly history must not be read as ~25 missed hourly runs');
  assert.equal((await journal.read()).runs.length, 6, 'historical runs are preserved');
  // Hourly runs at 32:07 and 33:07, then 34:07 is missed, 35:07 runs.
  const j = await journal.read();
  for (const h of [35, 33, 32]) j.runs.unshift({ run_id: 'new-' + h, trigger: 'cron', status: 'success', started_at: new Date(t0 + h * HOUR + 7 * 60000).toISOString(), completed_at: new Date(t0 + h * HOUR + 8 * 60000).toISOString() });
  j.runs.sort((a, b) => b.started_at.localeCompare(a.started_at)); await state.write('run-journal', j);
  r = await journal.inspect({ now: t0 + 35 * HOUR + 40 * 60000, scheduleEnabled: true, everyHours: 1 });
  assert.deepEqual(r.missed_slots, [at(34)]);
  // A restart with the same schedule keeps the epoch, so downtime is still reported …
  assert.equal((await journal.activateSchedule({ name: 'schedule:due', tickHours: 1, enabled: true }, t0 + 36 * HOUR)).since, new Date(switched).toISOString());
  // … but a pause followed by re-enabling starts a new epoch: paused hours are not "missed".
  await journal.activateSchedule({ name: 'schedule:due', tickHours: 1, enabled: false }, t0 + 37 * HOUR);
  const resumed = await journal.activateSchedule({ name: 'schedule:due', tickHours: 1, enabled: true }, t0 + 60 * HOUR);
  assert.equal(resumed.since, new Date(t0 + 60 * HOUR).toISOString());
  assert.deepEqual((await journal.inspect({ now: t0 + 60 * HOUR + 20 * 60000, scheduleEnabled: true, everyHours: 1 })).missed_slots, []);
  // With the schedule enabled and no run at all for two hours, the misses are reported even though no run exists in the new epoch.
  assert.equal((await journal.inspect({ now: t0 + 62 * HOUR + 40 * 60000, scheduleEnabled: true, everyHours: 1 })).missed_slots.length, 2);
});

// 5 ------------------------------------------------------------------------------------
test('blocker 5: an idle run or a poll that retrieved nothing never clears an earlier failure; only a completed retrieval does', async () => {
  process.env.ALLOW_COLLECTION = 'true';
  try {
    await fs.rm(path.join(root, 'collection'), { recursive: true, force: true });
    const runner = require('../lib/collection/runner'), journal = require('../lib/collection/run-journal');
    const source = { id: 'synthetic-feed', name: 'Synthetic feed', url: 'https://feed.example.test/rss.xml', adapter: 'rss', languages: ['en'], jurisdictions: ['global'], topic: 'safety', official: true, access: 'public_metadata', rights: { status: 'item_review_required', full_text: false }, freshness_hours: 48 };
    const t0 = Date.parse('2026-11-09T00:07:00Z');
    const failing = async () => { throw Object.assign(new Error('Source HTTP 503'), { code: 'HTTP_503' }); };
    const feed = '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><item><title>Synthetic item</title><link>https://feed.example.test/a</link><guid>a</guid><pubDate>Sun, 08 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>';
    const working = async () => ({ status: 200, headers: {}, body: feed });
    const r1 = await runner.run({ sources: [source], client: failing, now: t0, trigger: 'cron' });
    assert.equal(r1.status, 'failed');
    // (a) An idle run — nothing was due — is recorded as idle, not success.
    const idle = await runner.run({ sources: [], client: failing, now: t0 + HOUR, trigger: 'cron' });
    assert.equal(idle.status, 'idle');
    let j = await journal.inspect({ now: t0 + HOUR + 60000 });
    assert.equal(j.consecutive_failures, 1, 'idle run must not reset the failure count');
    assert.equal(j.last_completed_success_at, null, 'idle run is not a successful collection');
    assert.equal((await state.read('last-run', null)).status, 'failed', 'idle run must not overwrite the last real outcome');
    // (b) A poll that makes no retrieval (source still inside its refetch interval, queue non-empty) keeps the failure.
    await state.write('source-synthetic-feed', { cursor: null, queue: [{ external_id: 'q1', title: 'Queued earlier', url: 'https://feed.example.test/q1', published_at: '2026-11-08T09:00:00.000Z', updated_at: null, source_hash: 'h1' }], etag: null, modified: null, fetched_at: new Date(t0).toISOString() });
    let requests = 0; const counting = async (...a) => { requests++; return working(...a); };
    const r2 = await runner.run({ sources: [source], client: counting, now: t0 + 2 * HOUR, trigger: 'cron' });
    assert.equal(requests, 0, 'fixture assumption: no retrieval happened');
    let h = (await state.read('health', {}))['synthetic-feed'];
    assert.equal(h.status, 'failed'); assert.equal(h.consecutive_failures, 1); assert.equal(h.error_code, 'HTTP_503'); assert.equal(h.failure_carried_forward, true);
    assert.equal(r2.status, 'idle', 'a run in which nothing was retrieved is not a success');
    assert.equal((await journal.inspect({ now: t0 + 2 * HOUR + 60000 })).consecutive_failures, 1);
    const cov = await require('../lib/collection/coverage').report({ now: t0 + 2 * HOUR + 60000, scheduleEnabled: false });
    assert.ok(cov.issues.some(i => i.kind === 'consecutive_run_failures') === false); // one failure is below the alert threshold of two
    // (c) A completed retrieval for that source clears it.
    const r3 = await runner.run({ sources: [source], client: working, now: t0 + 9 * HOUR, trigger: 'cron' });
    assert.ok(['success', 'incomplete'].includes(r3.status), r3.status);
    h = (await state.read('health', {}))['synthetic-feed'];
    assert.notEqual(h.status, 'failed'); assert.equal(h.consecutive_failures, 0); assert.equal(h.failure_carried_forward, undefined); assert.ok(h.last_success_at);
    j = await journal.inspect({ now: t0 + 9 * HOUR + 60000 });
    assert.equal(j.consecutive_failures, 0); assert.ok(j.last_completed_success_at);
    // (d) A success for a different source does not clear another source's failure.
    const other = { ...source, id: 'synthetic-other', url: 'https://other.example.test/rss.xml' };
    await runner.run({ sources: [other], client: failing, now: t0 + 10 * HOUR, trigger: 'cron' });
    await runner.run({ sources: [source], client: working, now: t0 + 17 * HOUR, trigger: 'cron' });
    assert.equal((await state.read('health', {}))['synthetic-other'].status, 'failed');
  } finally { delete process.env.ALLOW_COLLECTION; }
});
