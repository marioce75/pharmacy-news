'use strict';
// Request logging that cannot record credentials.
//
// The access log keeps what an operator needs for audit (client address, method, path, the
// names of query parameters, status, size, timing) but never the value of a credential-like
// parameter. Request bodies are not logged anywhere; `redact` exists so any future diagnostic
// that prints a body or query object goes through the same rule.
const morgan = require('morgan');

const MASK = '[REDACTED]';
// Parameter names whose values are secrets or bearer-equivalent (passwords, tokens, keys,
// one-time codes, session identifiers, signatures).
const SENSITIVE = /pass(word|wd|phrase|code)?|pwd|secret|token|credential|api[-_]?key|auth|session|signature|otp|cookie|^(key|code|sig|pin)$/i;
const decode = s => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
const sensitive = name => SENSITIVE.test(decode(String(name)));

// "/path?a=1&password=x#y" -> "/path?a=1&password=[REDACTED]". Parameter names are kept as sent.
function redactUrl(url) {
  const text = String(url == null ? '' : url), q = text.indexOf('?');
  if (q < 0) return text;
  const query = text.slice(q + 1).split('#')[0];
  return text.slice(0, q + 1) + query.split(/[&;]/).map(pair => {
    const eq = pair.indexOf('='), name = eq < 0 ? pair : pair.slice(0, eq);
    return sensitive(name) ? name + '=' + MASK : pair;
  }).join('&');
}

// Deep copy of a body/query object with credential-like values masked.
function redact(value, depth = 0) {
  if (value === null || typeof value !== 'object') return value;
  if (depth > 6) return MASK;
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1));
  return Object.fromEntries(Object.keys(value).map(k => [k, sensitive(k) ? MASK : redact(value[k], depth + 1)]));
}

// morgan's "short" format with the URL token replaced by the redacted URL.
const FORMAT = ':remote-addr :remote-user :method :safe-url HTTP/:http-version :status :res[content-length] - :response-time ms';
morgan.token('safe-url', req => redactUrl(req.originalUrl || req.url));
const requestLogger = options => morgan(FORMAT, options);

module.exports = { redactUrl, redact, requestLogger, MASK, FORMAT };
