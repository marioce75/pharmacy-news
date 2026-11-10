'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

const { RESOURCES, UNVERIFIED } = require('../config/affordability');
const aff = require('../lib/affordability');
const router = require('../routes/affordability');

const DAY = 24 * 60 * 60 * 1000;
const CHECK_DAY = Date.parse('2026-11-09T00:00:00Z');
const FIXED_NOW = Date.parse('2026-11-09T18:00:00Z');

function sample(overrides = {}) {
  return {
    id: 'sample-entry',
    name: 'Sample programme',
    operator: 'Sample operator',
    type: 'government',
    commercial: false,
    url: 'https://example.org/help',
    geography: 'United States',
    summary: 'A sample entry.',
    who_it_may_help: 'Eligibility is set by the programme; check the linked page',
    limitations: ['Programmes change.'],
    verified_at: '2026-11-09',
    evidence: { final_url: 'https://example.org/help', http_status: 200, confirmed: ['Page describes the programme.'] },
    ...overrides
  };
}

async function withServer(locals, fn) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  Object.assign(app.locals, locals);
  app.use('/', router);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function getPage(base, query = '') {
  const res = await fetch(`${base}/affordability${query}`);
  return { status: res.status, html: await res.text() };
}

test('shipped config validates and every entry carries evidence from the check date', () => {
  assert.doesNotThrow(() => aff.validate(RESOURCES, { now: FIXED_NOW }));
  assert.ok(RESOURCES.length > 0);
  for (const e of RESOURCES) {
    assert.equal(e.verified_at, '2026-11-09', e.id);
    assert.equal(e.evidence.http_status, 200, e.id);
    assert.ok(e.evidence.confirmed.length >= 2, e.id);
    assert.ok(e.limitations.length >= 1, e.id);
  }
  assert.equal(new Set(RESOURCES.map(e => e.id)).size, RESOURCES.length);
});

test('every URL is https with no query string, fragment or tracking parameter', () => {
  for (const e of RESOURCES) {
    for (const value of [e.url, e.evidence.final_url]) {
      const u = new URL(value);
      assert.equal(u.protocol, 'https:', e.id);
      assert.equal(u.search, '', e.id);
      assert.equal(u.hash, '', e.id);
      assert.ok(!value.includes('?'), e.id);
      assert.ok(!/utm_|affid|affiliate|ref=/i.test(value), e.id);
    }
  }
});

test('no prices, percentages or superlative claims anywhere in the public text', () => {
  const text = JSON.stringify(RESOURCES.map(e => [e.name, e.operator, e.summary, e.who_it_may_help, e.limitations, e.evidence.confirmed]));
  assert.ok(!/[$%£€]/.test(text));
  assert.ok(!/cheapest|lowest\s+price|guarantee/i.test(text));
});

test('commercial resources are labelled and manufacturer programmes link to the manufacturer', () => {
  for (const e of RESOURCES) {
    if (e.type === 'discount_tool' || e.type === 'low_cost_pharmacy') assert.equal(e.commercial, true, e.id);
    if (e.type === 'discount_tool') assert.ok(e.limitations.some(l => /commercial service/i.test(l)), e.id);
    if (e.type === 'charitable_foundation') assert.ok(e.limitations.some(l => /open and close|open, close|depends on/i.test(l)), e.id);
  }
  const hosts = { 'lilly-insulin-value-program': 'lilly.com', 'novo-nordisk-insulin-costs': 'novocare.com', 'sanofi-patient-support': 'sanofi.us' };
  for (const [id, host] of Object.entries(hosts)) {
    const e = RESOURCES.find(x => x.id === id);
    assert.ok(e, id);
    assert.ok(new URL(e.url).hostname.endsWith(host), id);
  }
});

test('unverified candidates are kept apart with a reason and never listed', () => {
  assert.ok(Array.isArray(UNVERIFIED));
  const publicIds = new Set(aff.list().map(e => e.id));
  for (const u of UNVERIFIED) {
    assert.ok(u.id && u.name && u.candidate_url && u.reason, u.id);
    assert.equal(u.checked_at, '2026-11-09');
    assert.ok(!publicIds.has(u.id), u.id);
  }
});

test('validator accepts a clean entry and rejects each kind of bad edit', () => {
  const opts = { now: FIXED_NOW };
  assert.doesNotThrow(() => aff.validate([sample()], opts));

  const bad = {
    'dollar sign': sample({ summary: 'Costs $4 a month.' }),
    'percent sign': sample({ limitations: ['Saves up to 80% on medicines.'] }),
    'percent in evidence': sample({ evidence: { final_url: 'https://example.org/help', http_status: 200, confirmed: ['Income within 500% of the poverty level.'] } }),
    'cheapest': sample({ summary: 'The cheapest way to fill a prescription.' }),
    'Cheapest in name': sample({ name: 'CHEAPEST pharmacy list' }),
    'lowest price': sample({ who_it_may_help: 'Anyone wanting the lowest price.' }),
    'guarantee': sample({ summary: 'A price guarantee for members.' }),
    'http url': sample({ url: 'http://example.org/help' }),
    'query string': sample({ url: 'https://example.org/help?utm_source=pharmacynews' }),
    'affiliate param': sample({ url: 'https://example.org/help?ref=partner123' }),
    'bare question mark': sample({ url: 'https://example.org/help?' }),
    'affiliate in path': sample({ url: 'https://example.org/affiliate/abc', evidence: { final_url: 'https://example.org/affiliate/abc', http_status: 200, confirmed: ['x'] } }),
    'evidence url with query': sample({ evidence: { final_url: 'https://example.org/help?x=1', http_status: 200, confirmed: ['x'] } }),
    'url host differs from checked page': sample({ url: 'https://other.example.com/help' }),
    'future date': sample({ verified_at: '2026-11-10' }),
    'far future date': sample({ verified_at: '2099-01-01' }),
    'malformed date': sample({ verified_at: '09/11/2026' }),
    'impossible date': sample({ verified_at: '2026-02-31' }),
    'missing summary': sample({ summary: '' }),
    'missing operator': sample({ operator: undefined }),
    'missing limitations': sample({ limitations: [] }),
    'missing evidence': sample({ evidence: undefined }),
    'unread page': sample({ evidence: { final_url: 'https://example.org/help', http_status: 403, confirmed: ['x'] } }),
    'unknown type': sample({ type: 'sponsor' }),
    'commercial not boolean': sample({ commercial: 'no' }),
    'discount tool not marked commercial': sample({ type: 'discount_tool', commercial: false })
  };
  for (const [label, entry] of Object.entries(bad)) {
    assert.throws(() => aff.validate([entry], opts), /affordability:/, label);
  }
  assert.throws(() => aff.validate([sample(), sample()], opts), /duplicate id/);
  assert.throws(() => aff.validate('nope', opts), /array/);
});

test('stale flag turns on at 91 days, not at 90', () => {
  assert.equal(aff.isStale('2026-11-09', CHECK_DAY + 90 * DAY), false);
  assert.equal(aff.isStale('2026-11-09', CHECK_DAY + 91 * DAY), true);
  assert.ok(aff.list({ now: CHECK_DAY + 90 * DAY }).every(e => e.stale === false));
  assert.ok(aff.list({ now: CHECK_DAY + 91 * DAY }).every(e => e.stale === true));
  assert.ok(aff.list({ now: new Date(CHECK_DAY + 91 * DAY) }).every(e => e.stale === true));
  assert.equal(aff.formatDate('2026-11-09'), '9 Nov 2026');
});

test('filters by type, geography and name, and never mutate the config', () => {
  const all = aff.list({ now: FIXED_NOW });
  assert.equal(all.length, RESOURCES.length);

  const typeValues = aff.types().map(t => t.value);
  assert.deepEqual([...new Set(RESOURCES.map(e => e.type))].sort(), [...typeValues].sort());
  for (const t of aff.types()) assert.ok(t.label);
  assert.deepEqual(aff.geographies(), [...new Set(RESOURCES.map(e => e.geography))].sort());

  const gov = aff.list({ type: 'government', now: FIXED_NOW });
  assert.ok(gov.length > 0 && gov.every(e => e.type === 'government'));

  const england = aff.list({ geography: 'England', now: FIXED_NOW });
  assert.ok(england.length > 0 && england.every(e => e.geography === 'England'));

  const both = aff.list({ type: 'manufacturer_program', geography: 'United States', now: FIXED_NOW });
  assert.ok(both.length > 0 && both.every(e => e.type === 'manufacturer_program' && e.geography === 'United States'));
  assert.deepEqual(aff.list({ type: 'manufacturer_program', geography: 'England', now: FIXED_NOW }), []);

  const byName = aff.list({ q: '  MEDICARE ', now: FIXED_NOW });
  assert.ok(byName.length > 0 && byName.every(e => /medicare/i.test(e.name + e.operator)));
  assert.deepEqual(aff.list({ q: 'zzz-no-such-resource', now: FIXED_NOW }), []);
  assert.deepEqual(aff.list({ type: 'not-a-type', now: FIXED_NOW }), []);

  all[0].limitations.push('mutated');
  all[0].name = 'mutated';
  assert.notEqual(RESOURCES.find(e => e.id === all[0].id).name, 'mutated');
  assert.ok(!RESOURCES.find(e => e.id === all[0].id).limitations.includes('mutated'));
});

test('page renders 200 with the disclaimers, how-to list and every resource', async () => {
  await withServer({ affordabilityNow: FIXED_NOW }, async base => {
    const { status, html } = await getPage(base);
    assert.equal(status, 200);
    assert.match(html, /not financial, insurance or medical advice/);
    assert.match(html, /no affiliate relationship/);
    assert.match(html, /receives nothing from them/);
    assert.match(html, /no sponsor placements on this page/);
    assert.match(html, /Programmes change/);
    assert.match(html, /<ol>[\s\S]*pharmacist[\s\S]*generic[\s\S]*government help first[\s\S]*manufacturer[\s\S]*discount tool[\s\S]*licensed pharmacies[\s\S]*<\/ol>/);
    assert.match(html, /do not enter personal or health details/);
    assert.match(html, /Not finding help\?/);
    assert.match(html, /<main id="main" class="page">/);
    assert.match(html, /aria-current="page"/);

    for (const e of RESOURCES) assert.ok(html.includes(`id="resource-${e.id}"`), e.id);
    // One per card; the 211 pointer under 'Not finding help?' repeats its own check date.
    assert.equal((html.match(/<span class="muted">Link checked 9 Nov 2026<\/span>/g) || []).length, RESOURCES.length);
    assert.match(html, /Link checked 9 Nov 2026\./);
    assert.ok(!html.includes('Check may be out of date'));
    assert.equal((html.match(/>Commercial service</g) || []).length, RESOURCES.filter(e => e.commercial).length);
    for (const u of UNVERIFIED) assert.ok(!html.includes(u.candidate_url), u.id);
  });
});

test('page asks for nothing beyond the three filters and has no scripts, handlers or tracked links', async () => {
  await withServer({ affordabilityNow: FIXED_NOW }, async base => {
    const { html } = await getPage(base);
    const fields = [...html.matchAll(/<(input|select|textarea)\b[^>]*>/gi)].map(m => m[0]);
    const names = fields.map(f => (f.match(/\bname="([^"]*)"/) || [])[1]).sort();
    assert.deepEqual(names, ['geography', 'q', 'type']);
    assert.equal((html.match(/<form\b/gi) || []).length, 1);
    assert.match(html, /<form method="get" action="\/affordability"/);
    assert.ok(!/<script\b/i.test(html));
    assert.ok(!/\son[a-z]+\s*=/i.test(html));
    assert.ok(!/teal/i.test(html));
    assert.ok(!/[$%£€]/.test(html.replace(/<head>[\s\S]*?<\/head>/, '')));

    const external = [...html.matchAll(/<a\b[^>]*href="(https?:[^"]*)"[^>]*>/gi)];
    assert.ok(external.length >= RESOURCES.length);
    for (const [tag, href] of external) {
      assert.match(tag, /rel="noopener noreferrer"/, href);
      assert.ok(href.startsWith('https://'), href);
      assert.ok(!href.includes('?') && !href.includes('&amp;'), href);
    }
    const assets = [...html.matchAll(/<(?:link|img|iframe)\b[^>]*(?:href|src)="([^"]*)"/gi)].map(m => m[1]);
    for (const a of assets) assert.ok(a.startsWith('/'), a);
  });
});

test('filters work through the page, with an honest empty state', async () => {
  await withServer({ affordabilityNow: FIXED_NOW }, async base => {
    const england = await getPage(base, '?geography=England');
    assert.equal(england.status, 200);
    for (const e of RESOURCES) assert.equal(england.html.includes(`id="resource-${e.id}"`), e.geography === 'England', e.id);
    assert.match(england.html, /<option value="England" selected>/);
    assert.match(england.html, /Clear filters/);

    const tools = await getPage(base, '?type=discount_tool');
    for (const e of RESOURCES) assert.equal(tools.html.includes(`id="resource-${e.id}"`), e.type === 'discount_tool', e.id);

    const named = await getPage(base, '?q=medicare');
    assert.ok(named.html.includes('id="resource-medicare-help-with-drug-costs"'));
    assert.ok(!named.html.includes('id="resource-goodrx"'));

    const none = await getPage(base, '?q=zzz-no-such-resource');
    assert.equal(none.status, 200);
    assert.match(none.html, /No resources match those filters/);
    assert.match(none.html, /does not mean help does not exist/);
    assert.match(none.html, /Showing 0 of/);
    assert.ok(!none.html.includes('class="card"'));

    const junk = await getPage(base, '?type=not-a-type&geography=Atlantis&q[]=a&q[]=b');
    assert.equal(junk.status, 200);
    assert.match(junk.html, new RegExp(`Showing ${RESOURCES.length} of ${RESOURCES.length}`));
  });
});

test('stale badge appears when the clock is advanced past 90 days', async () => {
  await withServer({ affordabilityNow: () => CHECK_DAY + 91 * DAY }, async base => {
    const { status, html } = await getPage(base);
    assert.equal(status, 200);
    assert.ok((html.match(/Check may be out of date/g) || []).length >= RESOURCES.length);
    assert.match(html, /Link last checked 9 Nov 2026/);
    assert.ok(!/Link checked 9 Nov 2026/.test(html));
  });
  await withServer({ affordabilityNow: CHECK_DAY + 90 * DAY }, async base => {
    const { html } = await getPage(base);
    assert.ok(!html.includes('Check may be out of date'));
  });
});

test('hostile search input is escaped and cannot move the clock', async () => {
  await withServer({ affordabilityNow: FIXED_NOW }, async base => {
    const payload = '"><script>alert(1)</script><img src=x onerror=alert(2)>';
    const { status, html } = await getPage(base, `?q=${encodeURIComponent(payload)}&now=2099-01-01&type=${encodeURIComponent('"><svg onload=alert(3)>')}`);
    assert.equal(status, 200);
    assert.ok(!html.includes('<script>alert(1)'));
    assert.ok(!/<script\b/i.test(html));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('<svg'));
    assert.ok(html.includes('&#34;&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!html.includes('Check may be out of date'));
    assert.match(html, /No resources match those filters/);

    const long = await getPage(base, `?q=${'a'.repeat(5000)}`);
    assert.equal(long.status, 200);
    assert.ok(!long.html.includes('a'.repeat(81)));
  });
});
