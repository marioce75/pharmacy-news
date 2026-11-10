'use strict';
// Regression tests for the remaining idle-run defect found in the retest of 9a970f8:
// queue-only work on a healthy source (zero HTTP requests) must never assert a successful
// collection run. Only a real, completed retrieval can. Synthetic data; no network.
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises'), os = require('os'), path = require('path');
const root = require('fs').mkdtempSync(path.join(os.tmpdir(), 'pharmacy-idle-'));
process.env.CONTENT_DIR = root; process.env.ALLOW_COLLECTION = 'true';
const state = require('../lib/collection/state'), runner = require('../lib/collection/runner'), journal = require('../lib/collection/run-journal');
const HOUR = 3600000, t0 = Date.parse('2026-11-09T00:07:00Z'), at = h => t0 + h * HOUR;
const src = id => ({ id, name: 'Synthetic ' + id, url: `https://${id}.example.test/rss.xml`, adapter: 'rss', languages: ['en'], jurisdictions: ['global'], topic: 'safety', official: true, access: 'public_metadata', rights: { status: 'item_review_required', full_text: false }, freshness_hours: 48 });
const A = src('feed-a'), B = src('feed-b');
const feed = id => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><item><title>Item from ${id}</title><link>https://${id}.example.test/x</link><guid>${id}-x</guid><pubDate>Sun, 08 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
// Client that fails the named hosts and counts every request.
function client(failHosts = []) {
  const c = async (url) => { c.requests++; const host = new URL(url).hostname.split('.')[0]; if (failHosts.includes(host)) throw Object.assign(new Error('Source HTTP 503'), { code: 'HTTP_503' }); return { status: 200, headers: {}, body: feed(host) }; };
  c.requests = 0; return c;
}
// Puts one already-fetched record in a source's queue, fetched at `hour`, so the next pass inside the refetch interval is queue-only.
const queueOnly = (s, hour, n = 1) => state.write('source-' + s.id, { cursor: null, etag: null, modified: null, fetched_at: new Date(at(hour)).toISOString(), queue: Array.from({ length: n }, (_, i) => ({ external_id: `${s.id}-q${hour}-${i}`, title: `Queued ${s.id} ${i}`, url: `https://${s.id}.example.test/q${hour}-${i}`, published_at: '2026-11-08T09:00:00.000Z', updated_at: null, source_hash: 'h' + hour + i })) });
const run = (sources, c, hour) => runner.run({ sources, client: c, now: at(hour), trigger: 'cron' });
const inspect = hour => journal.inspect({ now: at(hour) + 60000 });
beforeEach(() => fs.rm(path.join(root, 'collection'), { recursive: true, force: true }));
after(() => fs.rm(root, { recursive: true, force: true }));

test('two failed runs for A, then a healthy source B queue-only pass with zero requests: failures stay at 2, no success is recorded, last-run stays failed', async () => {
  assert.equal((await run([A], client(['feed-a']), 0)).status, 'failed');
  assert.equal((await run([A], client(['feed-a']), 1)).status, 'failed');
  assert.equal((await inspect(1)).consecutive_failures, 2);
  await queueOnly(B, 1);
  const c = client(), r = await run([B], c, 2);
  assert.equal(c.requests, 0, 'fixture: the pass must make no HTTP request');
  assert.equal(r.newArticles, 1, 'fixture: queued work was still processed');
  assert.equal(r.status, 'idle'); assert.equal(r.idle, true);
  const row = r.sourceRuns[0]; assert.equal(row.retrieved, false); assert.equal(row.attempted, false);
  const j = await inspect(2);
  assert.equal(j.consecutive_failures, 2); assert.equal(j.last_completed_success_at, null);
  assert.equal((await state.read('last-run', null)).status, 'failed');
  const h = await state.read('health', {});
  assert.equal(h['feed-a'].status, 'failed'); assert.equal(h['feed-a'].consecutive_failures, 2);
  assert.equal(h['feed-b'].last_success_at, null, 'queue-only work is not a retrieval for B either');
  // The alert condition (two consecutive failed runs) is still raised after the idle pass.
  const cov = await require('../lib/collection/coverage').report({ now: at(2) + 60000, scheduleEnabled: false });
  assert.ok(cov.issues.some(i => i.kind === 'consecutive_run_failures' && i.count === 2));
});

test('mixed batch: A fails with a real attempt while B is queue-only — the run is failed, not completed-with-errors or success', async () => {
  await queueOnly(B, 0);
  const c = client(['feed-a']), r = await run([A, B], c, 1);
  assert.equal(c.requests, 1, 'only A was requested; B made none');
  assert.equal(r.status, 'failed');
  const j = await inspect(1); assert.equal(j.consecutive_failures, 1); assert.equal(j.last_completed_success_at, null);
});

test('mixed sequence: fail A, queue-only B, fail A, queue-only B — the streak counts both failures and no pass in between resets it', async () => {
  await run([A], client(['feed-a']), 0);
  await queueOnly(B, 0); assert.equal((await run([B], client(), 1)).status, 'idle');
  assert.equal((await run([A], client(['feed-a']), 2)).status, 'failed');
  await queueOnly(B, 2); assert.equal((await run([B], client(), 3)).status, 'idle');
  const j = await inspect(3);
  assert.equal(j.consecutive_failures, 2); assert.equal(j.last_completed_success_at, null);
  assert.equal((await state.read('last-run', null)).status, 'failed');
});

test('actual recovery: a completed retrieval is a success — for B it ends the run-level streak but leaves A failing; for A it clears A', async () => {
  await run([A], client(['feed-a']), 0); await run([A], client(['feed-a']), 1);
  // B really retrieves (never fetched before): the collector is working, so the run-level streak ends …
  const cB = client(), rB = await run([B], cB, 2);
  assert.equal(cB.requests, 1); assert.equal(rB.sourceRuns[0].retrieved, true); assert.equal(rB.sourceRuns[0].attempted, true);
  assert.ok(['success', 'incomplete'].includes(rB.status), rB.status);
  let j = await inspect(2); assert.equal(j.consecutive_failures, 0); assert.ok(j.last_completed_success_at);
  // … but source A's own failure is untouched until A itself is retrieved.
  let h = await state.read('health', {}); assert.equal(h['feed-a'].status, 'failed'); assert.equal(h['feed-a'].consecutive_failures, 2); assert.ok(h['feed-b'].last_success_at);
  const cA = client(), rA = await run([A], cA, 3);
  assert.equal(cA.requests, 1); assert.ok(['success', 'incomplete'].includes(rA.status));
  h = await state.read('health', {}); assert.notEqual(h['feed-a'].status, 'failed'); assert.equal(h['feed-a'].consecutive_failures, 0); assert.ok(h['feed-a'].last_success_at);
  assert.equal((await state.read('last-run', null)).status, rA.status);
});

test('a 304 Not Modified is a completed retrieval; a run with no sources is idle', async () => {
  await run([A], client(['feed-a']), 0);
  const notModified = async () => ({ status: 304, headers: {}, body: '' });
  const r = await run([A], notModified, 7);
  assert.equal(r.sourceRuns[0].retrieved, true); assert.equal(r.sourceRuns[0].status, 'not_modified'); assert.equal(r.status, 'success');
  assert.equal((await inspect(7)).consecutive_failures, 0);
  assert.equal((await run([], client(), 8)).status, 'idle');
});
