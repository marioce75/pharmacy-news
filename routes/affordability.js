'use strict';
/*
 * GET /affordability: medication affordability resource directory.
 * Mount in server.js before the 404 handler:
 *   app.use('/', require('./routes/affordability'));
 * Read-only. Takes three optional filter parameters and stores nothing.
 */
const express = require('express');
const affordability = require('../lib/affordability');

const router = express.Router();

function one(value) {
  return typeof value === 'string' ? value : '';
}

// Test hook only: app.locals.affordabilityNow may be a Date, a timestamp or a
// function returning one. It is never taken from the request.
function clock(app) {
  const v = app && app.locals ? app.locals.affordabilityNow : undefined;
  return typeof v === 'function' ? v() : v;
}

router.get('/affordability', (req, res) => {
  const typeOptions = affordability.types();
  const geographyOptions = affordability.geographies();
  const q = affordability.cleanQuery(one(req.query.q));
  const rawType = one(req.query.type);
  const rawGeography = one(req.query.geography);
  // Unknown values are dropped so a mistyped link shows the full directory.
  const type = typeOptions.some(t => t.value === rawType) ? rawType : '';
  const geography = geographyOptions.includes(rawGeography) ? rawGeography : '';
  const now = clock(req.app);

  const results = affordability.list({ q, type, geography, now });
  const groups = typeOptions
    .map(t => ({ ...t, entries: results.filter(e => e.type === t.value) }))
    .filter(g => g.entries.length > 0);
  const all = affordability.list({ now });

  res.render('affordability', {
    title: 'Medication costs: where to look for help | PharmacyNews.ai',
    description: 'A plain directory of government, charity, manufacturer and commercial resources for medicine costs, with the date each link was checked. Not financial, insurance or medical advice.',
    groups,
    resultCount: results.length,
    totalCount: all.length,
    typeOptions,
    geographyOptions,
    filters: { q, type, geography },
    filtered: Boolean(q || type || geography),
    anyStale: all.some(e => e.stale),
    safetyResource: affordability.get('fda-besaferx', now),
    referralResource: affordability.get('united-way-211', now),
    staleAfterDays: affordability.STALE_AFTER_DAYS
  });
});

module.exports = router;
