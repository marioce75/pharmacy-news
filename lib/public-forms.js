'use strict';
// Shared safeguards for public form posts (newsletter, sponsor enquiries).
// In-memory only: limits reset on restart and are per process, which matches the
// single-process file store this application runs on.

function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// Fixed-window limiter. Returns Express middleware; `limit` posts per `windowMs` per client.
function rateLimit({ limit = 5, windowMs = 60 * 60 * 1000, maxKeys = 5000, now = Date.now } = {}) {
  const hits = new Map();
  return function limiter(req, res, next) {
    const t = now();
    for (const [k, v] of hits) if (v.until <= t) hits.delete(k);
    const key = clientKey(req);
    let v = hits.get(key);
    if (!v) {
      if (hits.size >= maxKeys) return res.status(429).type('text').send('Too many requests right now; please try again later.');
      v = { count: 0, until: t + windowMs };
      hits.set(key, v);
    }
    if (++v.count > limit) {
      res.set('Retry-After', String(Math.ceil((v.until - t) / 1000)));
      return res.status(429).type('text').send('Too many requests; please try again later.');
    }
    next();
  };
}

// Browsers send Origin on form posts; a cross-site post is refused. A missing Origin
// (some privacy tools, non-browser clients) falls back to the Referer host, and a request
// with neither is refused.
function sameOrigin(req, res, next) {
  const expected = `${req.protocol}://${req.get('host')}`;
  const origin = req.get('origin');
  if (origin) return origin === expected ? next() : res.status(403).type('text').send('Cross-site form posts are not accepted.');
  try {
    if (new URL(req.get('referer') || '').origin === expected) return next();
  } catch { /* fall through */ }
  return res.status(403).type('text').send('Cross-site form posts are not accepted.');
}

// A hidden field real users never fill. Bots that do get a generic success-looking refusal.
function honeypotTripped(body, field = 'website') {
  return typeof body?.[field] === 'string' && body[field].trim() !== '';
}

function cleanText(value, max = 500) {
  if (typeof value !== 'string') return '';
  // Strip control characters; keep newlines/tabs for multi-line fields.
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

const EMAIL = /^[^\s@<>"',;:\\]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL.test(value);
}

function httpsUrl(value, max = 300) {
  if (typeof value !== 'string' || value.length > max) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null;
  } catch { return null; }
}

function enabled(flag) {
  return process.env[flag] === 'true';
}

module.exports = { rateLimit, sameOrigin, honeypotTripped, cleanText, validEmail, httpsUrl, enabled, clientKey };
