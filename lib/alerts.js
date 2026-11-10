'use strict';
// Collection-failure alerts.
//
// After each scheduled run the operational issues are evaluated. New "error" severity issues
// are always appended to a local alert log (shown on the admin monitoring page). If the owner
// has configured ALERT_WEBHOOK_URL (https), a short JSON summary is also POSTed there.
// No webhook is configured by default, and this module never emails anyone. The payload
// contains issue kinds, source IDs and timestamps only: no article content, no credentials.
const https = require('https');
const state = require('./collection/state');

const COOLDOWN_MS = 6 * 3600000; // the same issue is not re-sent more often than this
const KEEP = 200;

function webhookUrl() {
  const raw = process.env.ALERT_WEBHOOK_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password ? u : null;
  } catch { return null; }
}
const configured = () => !!webhookUrl();
const keyOf = i => [i.kind, i.source_id || '', i.slot || '', i.run_id || ''].join('|');

function post(url, payload, request = https.request) {
  return new Promise(resolve => {
    const body = JSON.stringify(payload);
    const req = request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'PharmacyNews/1.0 alerts' }, timeout: 10000 }, res => {
      res.resume();
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', e => resolve({ ok: false, error: e.code || 'request_failed' }));
    req.end(body);
  });
}

// `issues` is the list from lib/collection/coverage.report(). Only error-severity issues alert.
async function notify(issues, { now = Date.now(), send = post } = {}) {
  const log = await state.read('alerts', { sent: {}, entries: [] });
  const fresh = issues.filter(i => i.severity === 'error').filter(i => !(now - (log.sent[keyOf(i)] || 0) < COOLDOWN_MS));
  if (!fresh.length) return { new_alerts: 0, delivery: 'none_needed' };
  const url = webhookUrl();
  let delivery = 'not_configured';
  if (url) {
    const r = await send(url, { service: 'PharmacyNews.ai collection', generated_at: new Date(now).toISOString(), text: `PharmacyNews collection needs attention: ${fresh.map(i => i.kind + (i.source_id ? ' (' + i.source_id + ')' : '')).join(', ')}`, issues: fresh.map(i => ({ kind: i.kind, source_id: i.source_id || null, slot: i.slot || null, count: i.count || null })) });
    delivery = r.ok ? 'delivered' : 'delivery_failed';
  }
  // A failed delivery is not marked as sent, so it is retried after the next run.
  if (delivery !== 'delivery_failed') for (const i of fresh) log.sent[keyOf(i)] = now;
  for (const k of Object.keys(log.sent)) if (now - log.sent[k] > 7 * 24 * 3600000) delete log.sent[k];
  log.entries = [{ at: new Date(now).toISOString(), delivery, issues: fresh.map(i => ({ kind: i.kind, source_id: i.source_id || null, slot: i.slot || null })) }, ...(log.entries || [])].slice(0, KEEP);
  await state.write('alerts', log);
  return { new_alerts: fresh.length, delivery };
}

async function recent(limit = 20) {
  return ((await state.read('alerts', { entries: [] })).entries || []).slice(0, limit);
}

module.exports = { notify, recent, configured, COOLDOWN_MS };
