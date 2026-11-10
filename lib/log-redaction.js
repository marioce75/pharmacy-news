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
// Percent-decoding that never throws and never gives up: each valid %XX (and legacy %u00XX) is
// decoded on its own, repeatedly, so a malformed escape elsewhere or a double-encoded name
// ("pass%2577ord") cannot hide a parameter name from the check.
const pct = s => s.replace(/%u00([0-9a-f]{2})|%([0-9a-f]{2})/gi, (m, u, h) => String.fromCharCode(parseInt(u || h, 16)));
const decode = s => { let t = String(s).replace(/\+/g, ' '); for (let i = 0; i < 3; i++) { const n = pct(t); if (n === t) break; t = n; } return t; };
const sensitive = name => SENSITIVE.test(decode(name).trim());
// True when text, once decoded, contains a credential-like "name=value" behind any separator a
// client, proxy or framework might honour (; & ? # , | / whitespace), e.g. a return address
// that carries a token, or ";password=..." appended to a path.
const hidesAssignment = text => decode(text).split(/[;&?#,|\/\s]+/).some(piece => { const eq = piece.indexOf('='); return eq > 0 && SENSITIVE.test(piece.slice(0, eq).trim()); });
// A sensitive parameter keeps its name in the log only when the name is plain; a name that
// could itself carry the value (an encoded "=", a separator) is masked too.
const safeName = name => (name.length <= 64 && /^[A-Za-z0-9_.\-[\]%+]+$/.test(name) && /^[A-Za-z0-9_.\-[\] ]+$/.test(decode(name)) ? name : MASK);

// "/path?a=1&password=x#y" -> "/path?a=1&password=[REDACTED]".
// Parameters are separated on "&" only, exactly as the server parses them, so the whole value
// of a sensitive parameter is masked whatever it contains ("password=a;b" has the value "a;b").
// Any other parameter or path segment that hides a credential-like assignment is masked whole.
function redactUrl(url) {
  const text = String(url == null ? '' : url).split('#')[0], q = text.indexOf('?');
  const route = (q < 0 ? text : text.slice(0, q)).split('/').map(seg => (hidesAssignment(seg) ? MASK : seg)).join('/');
  if (q < 0) return route;
  return route + '?' + text.slice(q + 1).split('&').map(pair => {
    const eq = pair.indexOf('='), name = eq < 0 ? pair : pair.slice(0, eq);
    return sensitive(name) || hidesAssignment(pair) ? safeName(name) + '=' + MASK : pair;
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
