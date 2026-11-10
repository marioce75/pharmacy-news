'use strict';
// Due-based collection schedule ("schedule:due").
//
// The scheduler ticks once an hour. On each tick it picks the sources whose own polling
// interval has elapsed, most overdue first, up to a fixed batch size, and collects them with
// bounded request, time and intake budgets. Nothing here publishes anything: collected
// records are pending metadata that still need human review.
//
// Why not a fixed rotation? The earlier six-hour rotation visited 8 of 34 sources per run, so
// each source was seen roughly every 25.5 hours regardless of how often it publishes, and
// regulator, safety and research sources were not scheduled at all. Here every eligible
// source has an explicit polling interval and the capacity maths is checked by tests.
const registry = require('../../config/source-registry');

const NAME = 'schedule:due';
const TICK_HOURS = 1;
const CRON = '7 * * * *';           // minute 7 of every hour, UTC
const PER_RUN = 20;                 // most sources collected in one tick
const HOUR = 3600000;
const TOLERANCE_MS = 5 * 60000;     // a source polled 55 minutes ago counts as due on an hourly tick
const LIMITS = Object.freeze({
  requestsPerRun: 60,               // HTTP requests in one tick
  runSeconds: 600,                  // wall-clock budget for one tick
  itemsPerRun: 60,                  // records accepted into pending in one tick
  itemsPerSource: 8,                // fairness: one busy source cannot take the whole tick
  dailyRequests: 1500,              // all hosts, per UTC day
  dailyItems: 800,                  // records accepted per UTC day
  perHostDaily: 120,                // default per-host requests per UTC day
  perHostDailyOverrides: Object.freeze({ 'api.fda.gov': 400, 'eutils.ncbi.nlm.nih.gov': 300 })
});

// Default polling interval by adapter when a source does not state one.
// RSS/Atom feeds are designed for frequent conditional polling (ETag / If-Modified-Since),
// so they are checked hourly. APIs are checked every six hours. Scraped HTML indexes are
// checked twice a day to keep load on publisher sites low.
const ADAPTER_POLL_HOURS = Object.freeze({
  rss: 1, 'rss-filtered': 6, 'json-api': 6, 'html-index': 12, page: 12,
  'fda-applications': 6, 'fda-shortages': 12, 'fda-recalls': 6, pubmed: 6, 'europe-pmc': 6,
  trials: 6, 'pmda-index': 24, 'euda-news': 12
});

function eligible(s) {
  return !!s && s.adapter !== 'unavailable' && s.access === 'public_metadata' && s.rights?.status !== 'prohibited';
}

// Hours between polls of one source. `poll_hours` on the registry entry wins; otherwise a
// source's stated publishing cadence is used but never slower than daily, so every working
// source is refreshed at least once a day.
function pollHours(s) {
  if (Number.isFinite(s.poll_hours) && s.poll_hours >= 1) return Math.min(24, Math.round(s.poll_hours));
  if (Number.isFinite(s.cadence_hours) && s.cadence_hours >= 1) return Math.max(1, Math.min(24, Math.round(s.cadence_hours)));
  return ADAPTER_POLL_HOURS[s.adapter] || 12;
}

// Upper bound on HTTP requests one poll of a source can make.
function maxRequestsPerPoll(s) {
  if (s.pagination) return (s.pagination.max_pages_per_run || 2) * (s.adapter === 'pubmed' ? 2 : 1);
  if (s.page) return s.page.max_pages_per_run || 3;
  return s.adapter === 'pubmed' ? 2 : 1;
}

function pool() {
  return registry.filter(eligible);
}

// After a failed poll a source is retried with exponential backoff (1h, 2h, 4h … capped at
// 24h) instead of every tick, so one broken endpoint cannot crowd out healthy sources.
function retryDelayMs(failures) {
  return Math.min(24, 2 ** Math.max(0, failures - 1)) * HOUR;
}

function dueAt(s, health) {
  const last = Date.parse(health?.completed_at || '');
  if (!Number.isFinite(last)) return 0; // never attempted: due immediately
  const failures = Number(health.consecutive_failures) || 0;
  if (failures > 0 && ['failed', 'deferred'].includes(health.status)) return last + retryDelayMs(failures);
  return last + pollHours(s) * HOUR;
}

// The batch for one tick: every due source, most overdue (relative to its own interval)
// first, capped at PER_RUN. Sources left over stay due and move to the front next tick.
function select({ sources = pool(), health = {}, now = Date.now(), perRun = PER_RUN } = {}) {
  const due = [];
  for (const s of sources) {
    const at = dueAt(s, health[s.id]);
    if (at - TOLERANCE_MS > now) continue;
    const never = at === 0;
    due.push({ source: s, never, lateness: never ? Infinity : (now - at) / (pollHours(s) * HOUR) });
  }
  due.sort((a, b) => (b.never - a.never) || (b.lateness - a.lateness) || a.source.id.localeCompare(b.source.id));
  return { batch: due.slice(0, perRun).map(x => x.source), due: due.length, deferred: Math.max(0, due.length - perRun) };
}

// Steady-state capacity: how many polls and requests the schedule needs, against what one
// tick and one day allow. Used by the monitoring page and asserted in tests so that adding
// sources cannot silently make the intended cadence unachievable.
function capacity(sources = pool()) {
  const pollsPerHour = sources.reduce((n, s) => n + 1 / pollHours(s), 0);
  const worstRequestsPerDay = sources.reduce((n, s) => n + (24 / pollHours(s)) * maxRequestsPerPoll(s), 0);
  const hosts = {};
  for (const s of sources) {
    const h = new URL(s.url).hostname;
    hosts[h] = (hosts[h] || 0) + (24 / pollHours(s)) * maxRequestsPerPoll(s);
  }
  const hostLimit = h => LIMITS.perHostDailyOverrides[h] || LIMITS.perHostDaily;
  const hostsOverLimit = Object.entries(hosts).filter(([h, n]) => n > hostLimit(h)).map(([host, requests]) => ({ host, worst_case_requests_per_day: Math.ceil(requests), limit: hostLimit(host) }));
  return {
    sources: sources.length,
    tick_hours: TICK_HOURS,
    per_run: PER_RUN,
    polls_needed_per_tick: Number((pollsPerHour * TICK_HOURS).toFixed(2)),
    utilisation: Number((pollsPerHour * TICK_HOURS / PER_RUN).toFixed(2)),
    worst_case_requests_per_day: Math.ceil(worstRequestsPerDay),
    daily_request_limit: LIMITS.dailyRequests,
    hosts_over_limit: hostsOverLimit,
    achievable: pollsPerHour * TICK_HOURS <= PER_RUN && worstRequestsPerDay <= LIMITS.dailyRequests && hostsOverLimit.length === 0,
    by_interval: Object.entries(sources.reduce((m, s) => { const k = pollHours(s); m[k] = (m[k] || 0) + 1; return m; }, {})).map(([hours, count]) => ({ poll_hours: Number(hours), sources: count })).sort((a, b) => a.poll_hours - b.poll_hours)
  };
}

// Per-source schedule view for monitoring and the public sources page.
function describe(s, health, now = Date.now()) {
  const at = dueAt(s, health);
  return { poll_hours: pollHours(s), next_due_at: at === 0 ? null : new Date(at).toISOString(), overdue: at !== 0 && now - at > pollHours(s) * HOUR, consecutive_failures: Number(health?.consecutive_failures) || 0 };
}

module.exports = { NAME, TICK_HOURS, CRON, PER_RUN, LIMITS, ADAPTER_POLL_HOURS, eligible, pollHours, maxRequestsPerPoll, pool, retryDelayMs, dueAt, select, capacity, describe };
