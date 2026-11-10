'use strict';
// Advertising / sponsorship routes.
//
//   publicRouter (mount at "/"):      GET /advertise, POST /advertise/submit
//   adminRouter  (mount at "/admin"): GET /sponsors and the review actions below
//
// All rules about what may be stored or shown live in lib/sponsors.js; this file only
// handles HTTP concerns (limits, origin checks, roles, rendering).

const express = require('express');
const sponsors = require('../lib/sponsors');
const forms = require('../lib/public-forms');
const { requireAdmin, identity } = require('../middleware/auth');
const { human } = require('../lib/review-policy');

const BODY_LIMIT = 20 * 1024;
const HONEYPOT = 'homepage'; // hidden field; the real address field is "website"

// The application may already have parsed the body with a larger global limit, in which
// case the router-level parser below is skipped. Checking the declared length here keeps
// the 20kb ceiling either way.
function declaredSize(req, res, next) {
  if (Number(req.get('content-length')) > BODY_LIMIT) return res.status(413).type('text').send('Form is too large.');
  next();
}
const formBody = [declaredSize, express.urlencoded({ extended: false, limit: '20kb' })];

// ---------------------------------------------------------------------------
// Public: policy page and enquiry form
// ---------------------------------------------------------------------------

const publicRouter = express.Router();

async function renderAdvertise(res, status, extra = {}) {
  res.status(status).set('Cache-Control', 'no-store').render('advertise', {
    title: 'Advertising and sponsorship policy — PharmacyNews.ai',
    description: 'How advertising and sponsored content are labelled, reviewed and kept separate from news and clinical content on PharmacyNews.ai.',
    open: forms.enabled('SPONSOR_SUBMISSIONS_ENABLED'),
    state: 'form', // 'form' | 'received' | 'closed'
    errors: {}, values: {},
    types: sponsors.SUBMISSION_TYPES, typeLabels: sponsors.TYPE_LABELS, limits: sponsors.LIMITS,
    slots: sponsors.SLOT_ALLOWLIST, honeypot: HONEYPOT,
    activeSponsors: await sponsors.activeSponsors(),
    ...extra
  });
}

publicRouter.get('/advertise', (req, res) => renderAdvertise(res, 200));

// Closed by default: nothing is parsed, counted or stored until the owner opens the form.
function submissionsOpen(req, res, next) {
  if (forms.enabled('SPONSOR_SUBMISSIONS_ENABLED')) return next();
  return renderAdvertise(res, 503, { state: 'closed' }).catch(next);
}

publicRouter.post('/advertise/submit',
  submissionsOpen,
  formBody,
  forms.rateLimit({ limit: 3, windowMs: 60 * 60 * 1000 }),
  forms.sameOrigin,
  async (req, res) => {
    const body = req.body || {};
    // Bots that fill the hidden field see the same page as a real sender; nothing is stored.
    if (forms.honeypotTripped(body, HONEYPOT)) return renderAdvertise(res, 200, { state: 'received' });
    const { errors, values } = sponsors.validateSubmission(body);
    if (Object.keys(errors).length) return renderAdvertise(res, 400, { errors, values });
    await sponsors.createSubmission(body);
    return renderAdvertise(res, 200, { state: 'received' });
  });

// ---------------------------------------------------------------------------
// Admin: review workflow
// ---------------------------------------------------------------------------

const adminRouter = express.Router();

// Every /admin/sponsors request: signed-in reviewer, never cached.
adminRouter.use('/sponsors', requireAdmin, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  req.sponsorReviewer = identity(req.session);
  next();
});

// Mutations: same-origin browser post from a human holding the editor role.
function editorMutation(req, res, next) {
  if (req.get('origin') !== `${req.protocol}://${req.get('host')}`) return res.status(403).type('text').send('Same-origin request required.');
  if (!human(req.sponsorReviewer, 'editor')) return res.status(403).type('text').send('The editor role is required for sponsor decisions.');
  next();
}

async function renderAdmin(req, res, status = 200, extra = {}) {
  res.status(status).render('admin/sponsors', {
    submissions: await sponsors.listSubmissions(),
    placements: await sponsors.listPlacements(),
    audit: (await sponsors.readAudit()).slice(-50).reverse(),
    reviewer: req.sponsorReviewer,
    canEdit: human(req.sponsorReviewer, 'editor'),
    displayEnabled: forms.enabled('SPONSOR_DISPLAY_ENABLED'),
    submissionsEnabled: forms.enabled('SPONSOR_SUBMISSIONS_ENABLED'),
    labels: sponsors.LABELS, slots: sponsors.SLOT_ALLOWLIST, limits: sponsors.LIMITS,
    typeLabels: sponsors.TYPE_LABELS, maxSpanDays: sponsors.MAX_SPAN_DAYS,
    today: new Date().toISOString().slice(0, 10),
    notice: '', error: '', fieldErrors: {}, draft: {},
    ...extra
  });
}

// Validation and state errors from the store are shown on the page; anything else is a 500.
function shown(handler) {
  return async (req, res, next) => {
    try { await handler(req, res); }
    catch (e) {
      if (!e.expose) return next(e);
      await renderAdmin(req, res, e.status || 400, { error: e.message, fieldErrors: e.fields || {}, draft: req.body || {} });
    }
  };
}

const NOTICES = { status: 'Submission status updated.', placed: 'Placement created.', withdrawn: 'Placement withdrawn.' };

adminRouter.get('/sponsors', (req, res) => renderAdmin(req, res, 200, { notice: NOTICES[req.query.done] || '' }));

adminRouter.post('/sponsors/submissions/:id/status', formBody, editorMutation, shown(async (req, res) => {
  await sponsors.setSubmissionStatus(req.params.id, req.body?.status, req.body?.note, req.sponsorReviewer);
  res.redirect(303, '/admin/sponsors?done=status');
}));

adminRouter.post('/sponsors/placements', formBody, editorMutation, shown(async (req, res) => {
  await sponsors.createPlacement(req.body?.submission_id, req.body, req.sponsorReviewer);
  res.redirect(303, '/admin/sponsors?done=placed');
}));

adminRouter.post('/sponsors/placements/:id/withdraw', formBody, editorMutation, shown(async (req, res) => {
  await sponsors.withdrawPlacement(req.params.id, req.body?.reason, req.sponsorReviewer);
  res.redirect(303, '/admin/sponsors?done=withdrawn');
}));

module.exports = { publicRouter, adminRouter };
