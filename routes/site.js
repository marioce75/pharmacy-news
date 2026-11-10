'use strict';
// Reader-facing pages added on top of the monitor: news index and desks, source coverage,
// methods, edition index, clinical tools, robots and sitemap. Server-rendered, no client
// script required, and every response is built from public-safe projections only.
const express = require('express');
const fs = require('fs/promises'), path = require('path');
const desks = require('../lib/news/desks');
const news = require('../lib/news/listing');
const tools = require('../lib/clinical-tools');
const calculators = require('../lib/clinical/calculators');
const { requireAdmin, identity, reauthenticate } = require('../middleware/auth');
const { WHO_REGIONS } = require('../config/countries');

const publicRouter = express.Router(), adminRouter = express.Router();
const one = v => (typeof v === 'string' ? v.slice(0, 200) : '');
const wrap = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);
const form = express.urlencoded({ extended: false, limit: '10kb' });

async function sponsorPlacements(slot) {
  try { return await require('../lib/sponsors').activePlacements(slot); } catch { return []; }
}

// ---- News ----------------------------------------------------------------------------
async function renderNews(req, res, desk) {
  const q = req.query, data = await news.listing({ desk, kind: one(q.kind), region: one(q.region), q: one(q.q), since: one(q.since), page: one(q.page) });
  res.set('Cache-Control', 'public, max-age=60').render('news', { data, desks: desks.DESKS, regions: WHO_REGIONS, desk: data.filters.desk, sponsorPlacements: await sponsorPlacements('news-list') });
}
publicRouter.get('/news', wrap((req, res) => renderNews(req, res, one(req.query.desk))));
publicRouter.get('/news/:desk', wrap((req, res, next) => (desks.valid(req.params.desk) ? renderNews(req, res, req.params.desk) : next())));
publicRouter.get('/api/news', wrap(async (req, res) => {
  const q = req.query;
  res.set('Cache-Control', 'public, max-age=60').json(await news.listing({ desk: one(q.desk), kind: one(q.kind), region: one(q.region), q: one(q.q), since: one(q.since), page: one(q.page) }));
}));

// ---- Source coverage -----------------------------------------------------------------
const STATE_LABEL = { working: 'Working', checked_once_not_scheduled: 'Checked, not yet collected here', failing: 'Failing', not_recently_retrieved: 'No recent successful retrieval', blocked: 'Blocked or restricted — not requested', untested: 'Not yet tested', not_built: 'Adapter not built' };
publicRouter.get('/sources', wrap(async (req, res) => {
  const report = await require('../lib/collection/coverage').report();
  const registry = require('../config/source-registry');
  const state = one(req.query.state), desk = one(req.query.desk), q = one(req.query.q).toLowerCase();
  const rows = report.sources.map(r => {
    const s = registry.find(x => x.id === r.id), d = desks.forSource(s);
    // Public view: no internal error codes beyond a coarse class, no verification internals.
    return { id: r.id, name: r.name, issuer: r.issuer, desk: d, desk_label: d ? desks.DESKS[d].label : 'Not assigned', region: r.who_region, state: r.state, state_label: STATE_LABEL[r.state] || r.state,
      url: /^https:\/\//.test(r.endpoint || '') ? r.endpoint : null, poll_hours: r.schedule?.poll_hours || null, last_success_at: r.last_success_at, latest_report_at: r.latest_report_at,
      stale: r.flags.includes('latest_report_stale'), incomplete: r.flags.includes('incomplete_queue_or_scan'), rights: r.rights.status, permitted_use: r.rights.permitted_use, reason: r.reason, checked_at: r.verification?.checked_at || null, languages: r.languages };
  }).filter(r => (!state || r.state === state) && (!desk || r.desk === desk) && (!q || [r.name, r.issuer, r.id].join(' ').toLowerCase().includes(q)));
  res.set('Cache-Control', 'public, max-age=120').render('sources', { rows, totals: report.totals, total: report.sources.length, states: STATE_LABEL, desks: desks.DESKS, f: { state, desk, q: one(req.query.q) }, schedule: report.schedule, schedule_enabled: report.schedule_enabled, last_completed_at: report.runs.last_completed_success_at, statement: report.statement, regions: report.regions });
}));

publicRouter.get('/about', (req, res) => res.set('Cache-Control', 'public, max-age=600').render('about', { desks: desks.DESKS }));

// ---- Daily editions ------------------------------------------------------------------
publicRouter.get('/edition', wrap(async (req, res) => {
  const dir = path.join(process.env.CONTENT_DIR || path.join(__dirname, '..', 'content'), 'editions');
  let names = [];
  try { names = await fs.readdir(dir); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const editions = [];
  for (const name of names.filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().reverse().slice(0, 60)) {
    const e = await require('../lib/editions').read(name.slice(0, 10));
    if (e?.status === 'released') editions.push({ day: e.day, items: e.items.length, released_at: e.released_at });
  }
  res.render('editions', { editions });
}));

// ---- Clinical tools ------------------------------------------------------------------
publicRouter.get('/tools', wrap(async (req, res) => {
  const cat = await tools.catalogue(), q = one(req.query.q).toLowerCase();
  const match = t => !q || [t.name, t.purpose || '', t.section || ''].join(' ').toLowerCase().includes(q);
  res.render('tools', { calculators: cat.calculators.filter(c => match(c.tool)), references: cat.references.filter(match), labels: tools.STATE_LABELS, q: one(req.query.q) });
}));
function toolView(s, extra = {}) { return { s, labels: tools.STATE_LABELS, values: {}, result: null, error: null, preview: false, action: '/tools/' + s.tool.id, ...extra }; }
publicRouter.get('/tools/:id', wrap(async (req, res, next) => {
  const s = await tools.status(req.params.id);
  if (!s) return next();
  res.set('Cache-Control', 'no-store').render('tool', toolView(s));
}));
// Inputs are posted (never placed in the URL or logged) and nothing is stored.
publicRouter.post('/tools/:id', form, wrap(async (req, res, next) => {
  const s = await tools.status(req.params.id);
  if (!s) return next();
  res.set('Cache-Control', 'no-store');
  if (!s.available) return res.status(403).render('tool', toolView(s, { error: 'This tool is not available for clinical use.' }));
  try { res.render('tool', toolView(s, { values: req.body || {}, result: calculators.calculate(s.tool.id, req.body) })); }
  catch (e) { if (e.code !== 'INVALID_INPUT') throw e; res.status(422).render('tool', toolView(s, { values: req.body || {}, error: e.message, errorField: e.field })); }
}));

// ---- Admin: tool review --------------------------------------------------------------
const sameOrigin = (req, res, next) => (req.get('origin') === `${req.protocol}://${req.get('host')}` ? next() : res.status(403).json({ error: 'Same-origin request required' }));
adminRouter.use('/tools', requireAdmin, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
adminRouter.get('/tools', wrap(async (req, res) => {
  const p = identity(req.session), cat = await tools.catalogue();
  res.render('admin/tools', { cat, labels: tools.STATE_LABELS, you: { id: p.id, roles: p.roles, clinical: p.clinicalCredentialVerified === true, issue: p.credentialIssue || null } });
}));
adminRouter.get('/tools/:id/preview', wrap(async (req, res, next) => {
  const s = await tools.status(req.params.id);
  if (!s) return next();
  res.render('tool', toolView(s, { preview: true, action: '/admin/tools/' + s.tool.id + '/preview' }));
}));
adminRouter.post('/tools/:id/preview', form, wrap(async (req, res, next) => {
  const s = await tools.status(req.params.id);
  if (!s) return next();
  const base = { preview: true, action: '/admin/tools/' + s.tool.id + '/preview', values: req.body || {} };
  try { res.render('tool', toolView(s, { ...base, result: calculators.calculate(s.tool.id, req.body) })); }
  catch (e) { if (e.code !== 'INVALID_INPUT') throw e; res.status(422).render('tool', toolView(s, { ...base, error: e.message, errorField: e.field })); }
}));
// The id must be an exact catalogue id before anything else happens: no password check, no
// path and no file access for anything that is not a listed calculator.
const knownTool = (req, res, next) => (tools.known(req.params.id) ? next() : res.status(404).json({ error: 'Unknown tool' }));
// The review forms post here directly when the page script has not run (JavaScript disabled,
// blocked or failed), so the password travels in a POST body, never in an address.
const reviewBody = [express.json({ limit: '10kb' }), express.urlencoded({ extended: false, limit: '10kb' })];
const plainForm = req => Boolean(req.is('application/x-www-form-urlencoded'));
const ticked = v => v === 'on';
const done = (req, res, result) => (plainForm(req) ? res.redirect(303, '/admin/tools') : res.json(result));
adminRouter.post('/tools/:id/approve', sameOrigin, knownTool, reviewBody, wrap(async (req, res) => {
  const b = req.body || {};
  const signed = await reauthenticate(req.session, b.password);
  if (!signed) throw Object.assign(new Error('Re-enter your own password to sign this approval'), { status: 401 });
  const attestation = plainForm(req) ? { formulaChecked: ticked(b.formulaChecked), citationsChecked: ticked(b.citationsChecked), testCasesChecked: ticked(b.testCasesChecked) } : b.attestation;
  done(req, res, await tools.approve(req.params.id, b.version_digest, signed, attestation));
}));
adminRouter.post('/tools/:id/withdraw', sameOrigin, knownTool, reviewBody, wrap(async (req, res) => {
  done(req, res, await tools.withdraw(req.params.id, identity(req.session), req.body?.reason));
}));
adminRouter.use('/tools', (err, req, res, next) => {
  if (!err.status) return next(err);
  if (plainForm(req)) return res.status(err.status).type('text').send(err.message + '\n\nNothing was recorded. Go back to the clinical tool review page to try again.');
  res.status(err.status).json({ error: err.message });
});

// ---- robots.txt and sitemap ----------------------------------------------------------
const site = () => { try { const u = new URL(process.env.PUBLIC_SITE_URL || ''); return u.protocol === 'https:' ? u.origin : ''; } catch { return ''; } };
publicRouter.get('/robots.txt', (req, res) => res.type('text/plain').send(['User-agent: *', 'Disallow: /admin', 'Disallow: /api/', 'Disallow: /newsletter/confirm', 'Disallow: /newsletter/unsubscribe', ...(site() ? ['Sitemap: ' + site() + '/sitemap.xml'] : []), ''].join('\n')));
publicRouter.get('/sitemap.xml', wrap(async (req, res, next) => {
  const origin = site();
  if (!origin) return next(); // no canonical site URL configured: no sitemap rather than a wrong one
  const paths = ['/', '/news', ...Object.keys(desks.DESKS).map(d => '/news/' + d), '/sources', '/tools', '/affordability', '/newsletter', '/about', '/advertise', '/substance-alerts', '/treatments', '/edition'];
  for (const a of await require('../lib/store').listArticles('approved')) if (!news.collectorLead(a) && require('../lib/news/freshness').current(a) && /^[a-z0-9-]+$/i.test(a.slug || '')) paths.push('/article/' + a.slug);
  res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + paths.map(p => `<url><loc>${origin}${p}</loc></url>`).join('\n') + '\n</urlset>\n');
}));

module.exports = { publicRouter, adminRouter };
