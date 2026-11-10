'use strict';
/*
 * Medication affordability directory: validation and filtering.
 * Data lives in config/affordability.js. validate() runs at module load so a
 * bad edit to the config stops the app from starting instead of publishing
 * a price, an affiliate link or an unchecked entry.
 */

const { RESOURCES } = require('../config/affordability');

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_AFTER_DAYS = 90;

// Display order follows the "how to use" advice: government help first.
const TYPE_LABELS = Object.freeze({
  government: 'Government programme or information',
  nonprofit_directory: 'Assistance directory',
  charitable_foundation: 'Charity or foundation',
  manufacturer_program: 'Manufacturer programme',
  discount_tool: 'Discount tool',
  low_cost_pharmacy: 'Low-cost pharmacy programme',
  safety_guidance: 'Safety guidance'
});
const TYPE_ORDER = Object.keys(TYPE_LABELS);
const MUST_BE_COMMERCIAL = new Set(['discount_tool', 'low_cost_pharmacy']);

const FORBIDDEN_TEXT = [
  [/[$%£€]/, 'a currency or percent sign (no prices, savings figures or thresholds)'],
  [/cheapest/i, 'the word "cheapest"'],
  [/lowest\s+price/i, 'the phrase "lowest price"'],
  [/guarantee/i, 'the word "guarantee"']
];
const TRACKING_IN_PATH = /(utm_|affid|affiliate|[?&;]ref=|referral|partner_id|gclid|fbclid)/i;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fail(id, message) {
  throw new Error(`affordability: ${id ? `[${id}] ` : ''}${message}`);
}

function isText(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function toMs(now) {
  if (now instanceof Date) return now.getTime();
  if (typeof now === 'number' && Number.isFinite(now)) return now;
  if (typeof now === 'string' && !Number.isNaN(Date.parse(now))) return Date.parse(now);
  return Date.now();
}

function parseDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) return NaN;
  // Reject impossible dates that Date would roll over (for example 2026-02-31).
  return new Date(ms).toISOString().slice(0, 10) === value ? ms : NaN;
}

function checkUrl(id, field, value) {
  if (!isText(value)) fail(id, `${field} is missing`);
  if (/\s/.test(value)) fail(id, `${field} must not contain whitespace`);
  if (value.includes('?')) fail(id, `${field} must not contain a query string or affiliate/tracking parameters`);
  if (value.includes('#')) fail(id, `${field} must not contain a fragment`);
  let u;
  try { u = new URL(value); } catch { fail(id, `${field} is not a valid URL`); }
  if (u.protocol !== 'https:') fail(id, `${field} must use https`);
  if (u.username || u.password) fail(id, `${field} must not contain credentials`);
  if (u.search) fail(id, `${field} must not contain a query string or affiliate/tracking parameters`);
  if (TRACKING_IN_PATH.test(u.pathname)) fail(id, `${field} looks like it carries an affiliate or tracking parameter`);
  if (!u.hostname.includes('.')) fail(id, `${field} must be a public hostname`);
}

function checkText(id, field, value) {
  if (!isText(value)) fail(id, `${field} is missing or empty`);
  for (const [pattern, what] of FORBIDDEN_TEXT) {
    if (pattern.test(value)) fail(id, `${field} contains ${what}`);
  }
}

function checkTextList(id, field, list) {
  if (!Array.isArray(list) || list.length === 0) fail(id, `${field} must be a non-empty array`);
  list.forEach((item, i) => checkText(id, `${field}[${i}]`, item));
}

/**
 * Throws on the first problem found. Returns the entries when valid.
 * options.now lets tests fix "today" for the future-date check.
 */
function validate(entries, options = {}) {
  if (!Array.isArray(entries)) fail('', 'entries must be an array');
  const nowMs = toMs(options.now);
  const seen = new Set();
  for (const e of entries) {
    if (!e || typeof e !== 'object') fail('', 'entry must be an object');
    const id = e.id;
    if (!isText(id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) fail(String(id || ''), 'id is missing or not lower-case-with-hyphens');
    if (seen.has(id)) fail(id, 'duplicate id');
    seen.add(id);

    for (const field of ['name', 'operator', 'geography', 'summary', 'who_it_may_help']) checkText(id, field, e[field]);
    checkTextList(id, 'limitations', e.limitations);

    if (!Object.prototype.hasOwnProperty.call(TYPE_LABELS, e.type)) fail(id, `type "${e.type}" is not one of ${TYPE_ORDER.join(', ')}`);
    if (typeof e.commercial !== 'boolean') fail(id, 'commercial must be true or false');
    if (MUST_BE_COMMERCIAL.has(e.type) && e.commercial !== true) fail(id, `${e.type} entries must be marked commercial`);

    checkUrl(id, 'url', e.url);

    const day = parseDay(e.verified_at);
    if (Number.isNaN(day)) fail(id, 'verified_at must be a real date in YYYY-MM-DD form');
    if (day > nowMs) fail(id, 'verified_at is in the future');

    const ev = e.evidence;
    if (!ev || typeof ev !== 'object') fail(id, 'evidence is missing');
    checkUrl(id, 'evidence.final_url', ev.final_url);
    if (ev.http_status !== 200) fail(id, 'evidence.http_status must be 200 (a page that was not read belongs in UNVERIFIED)');
    checkTextList(id, 'evidence.confirmed', ev.confirmed);
    if (new URL(ev.final_url).hostname.replace(/^www\./, '') !== new URL(e.url).hostname.replace(/^www\./, '')) {
      fail(id, 'url must be on the same host as the page that was actually checked (evidence.final_url)');
    }
  }
  return entries;
}

function isStale(verifiedAt, now) {
  const day = parseDay(verifiedAt);
  if (Number.isNaN(day)) return true;
  return toMs(now) - day > STALE_AFTER_DAYS * DAY_MS;
}

function formatDate(verifiedAt) {
  const day = parseDay(verifiedAt);
  if (Number.isNaN(day)) return '';
  const d = new Date(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function types() {
  const present = new Set(RESOURCES.map(e => e.type));
  return TYPE_ORDER.filter(t => present.has(t)).map(t => ({ value: t, label: TYPE_LABELS[t] }));
}

function geographies() {
  return [...new Set(RESOURCES.map(e => e.geography))].sort((a, b) => a.localeCompare(b));
}

function cleanQuery(q) {
  return typeof q === 'string' ? q.trim().slice(0, 80) : '';
}

/**
 * Filtered, ordered copy of the directory. q matches resource and operator
 * names only (never free text about a person). Unknown type or geography
 * values match nothing rather than silently showing everything.
 */
function list({ q, type, geography, now } = {}) {
  const needle = cleanQuery(q).toLowerCase();
  const wantType = typeof type === 'string' ? type : '';
  const wantGeo = typeof geography === 'string' ? geography : '';
  return RESOURCES
    .filter(e => !wantType || e.type === wantType)
    .filter(e => !wantGeo || e.geography === wantGeo)
    .filter(e => !needle || e.name.toLowerCase().includes(needle) || e.operator.toLowerCase().includes(needle))
    .map(e => ({
      ...e,
      limitations: [...e.limitations],
      evidence: { ...e.evidence, confirmed: [...e.evidence.confirmed] },
      type_label: TYPE_LABELS[e.type],
      verified_label: formatDate(e.verified_at),
      stale: isStale(e.verified_at, now)
    }))
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name));
}

function get(id, now) {
  return list({ now }).find(e => e.id === id) || null;
}

// Fail fast: a bad edit to config/affordability.js stops the process here.
validate(RESOURCES);

module.exports = { validate, list, get, types, geographies, isStale, formatDate, cleanQuery, TYPE_LABELS, TYPE_ORDER, STALE_AFTER_DAYS };
