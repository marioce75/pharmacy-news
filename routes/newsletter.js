'use strict';
// Newsletter pages.
//   publicRouter  -> mount at '/'       (sign-up, confirm, unsubscribe)
//   adminRouter   -> mount at '/admin'  (counts, preview, queue; never lists addresses)
// Rules and reasons are in docs/NEWSLETTER.md.

const express = require('express');
const newsletter = require('../lib/newsletter');
const forms = require('../lib/public-forms');
const policy = require('../lib/review-policy');
const { requireAdmin, identity } = require('../middleware/auth');

const BODY_LIMIT = 10 * 1024; // bytes

// The application may already have parsed the body with a larger limit before this router
// runs, so the 10kb limit is also enforced on the declared length.
function smallBody(req, res, next) {
  if (Number(req.get('content-length') || 0) > BODY_LIMIT) return res.status(413).type('text').send('Request too large.');
  next();
}
const urlencoded = express.urlencoded({ extended: false, limit: '10kb' });
const field = (source, name, max = 400) => forms.cleanText(typeof source?.[name] === 'string' ? source[name] : '', max);

// ---------------------------------------------------------------------------
// Public pages
// ---------------------------------------------------------------------------

// A factory so tests can build a router with its own rate limiter and clock.
function createPublicRouter({ now } = {}) {
  const router = express.Router();
  router.use('/newsletter', smallBody, urlencoded);

  const subscribeLimit = forms.rateLimit({ limit: 5, windowMs: 60 * 60 * 1000, ...(now ? { now } : {}) });
  const confirmLimit = forms.rateLimit({ limit: 30, windowMs: 60 * 60 * 1000, ...(now ? { now } : {}) });

  function signupPage(res, status, extra = {}) {
    const cfg = newsletter.config();
    res.status(status).render('newsletter', {
      title: 'Newsletter | PharmacyNews.ai',
      description: 'Sign up for the PharmacyNews.ai email newsletter: reviewed daily editions with links to the original sources.',
      open: cfg.signupOpen, consentText: newsletter.CONSENT_TEXT, consentVersion: newsletter.CONSENT_VERSION,
      postalAddress: cfg.postalAddress, error: '', email: '', ...extra
    });
  }
  // Confirm / unsubscribe / result pages carry a token in the address, so they are
  // never cached, never indexed, and never leak the address to another site.
  function actionPage(res, status, view) {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).status(status).render('newsletter-action', {
      title: view.heading + ' | PharmacyNews.ai', description: 'PharmacyNews.ai newsletter.',
      heading: view.heading, message: view.message, form: view.form || null
    });
  }
  const closed = (req, res, next) => newsletter.config().signupOpen ? next()
    : signupPage(res.set('Retry-After', '86400'), 503, { error: 'Newsletter sign-up is not open yet. Nothing was saved.' });

  router.get('/newsletter', (req, res) => signupPage(res, 200));

  router.post('/newsletter/subscribe', closed, subscribeLimit, forms.sameOrigin, async (req, res, next) => {
    try {
      // One outcome text for every accepted request: new, already pending, already
      // subscribed, and bots caught by the hidden field all see exactly this page.
      const accepted = () => actionPage(res, 200, {
        heading: 'Check your email',
        message: 'If this address can be subscribed, a confirmation email is on its way. The subscription starts only after you open that email and confirm. The link works for 7 days.'
      });
      if (forms.honeypotTripped(req.body)) return accepted();
      const email = field(req.body, 'email', 254).toLowerCase();
      if (!forms.validEmail(email)) return signupPage(res, 400, { error: 'Enter a valid email address.', email });
      if (field(req.body, 'consent', 10) !== 'yes') return signupPage(res, 400, { error: 'Tick the consent box to subscribe.', email });
      await newsletter.requestSubscription(email, { consentVersion: newsletter.CONSENT_VERSION, ...(now ? { now } : {}) });
      accepted();
    } catch (e) { next(e); }
  });

  const INVALID_LINK = { heading: 'This link cannot be used', message: 'The link is incomplete, has expired or was already used. You can sign up again on the newsletter page.' };

  // GET only shows a button. Mail scanners and link previews fetch links automatically,
  // so opening the link must never confirm or unsubscribe anyone.
  router.get('/newsletter/confirm', (req, res) => {
    const token = field(req.query, 'token', 120);
    if (!newsletter.TOKEN_SHAPE.test(token)) return actionPage(res, 400, INVALID_LINK);
    actionPage(res, 200, { heading: 'Confirm your subscription', message: 'Press the button to start receiving the PharmacyNews.ai newsletter at the address this link was sent to.',
      form: { action: '/newsletter/confirm', token, button: 'Confirm subscription' } });
  });
  router.post('/newsletter/confirm', confirmLimit, forms.sameOrigin, async (req, res, next) => {
    try {
      const result = await newsletter.confirm(field(req.body, 'token', 120), now ? { now } : {});
      if (!result.ok) return actionPage(res, 400, INVALID_LINK);
      actionPage(res, 200, { heading: 'Subscription confirmed', message: 'Thank you. You will receive the newsletter at this address. Every email has an unsubscribe link.' });
    } catch (e) { next(e); }
  });

  router.get('/newsletter/unsubscribe', (req, res) => {
    const token = field(req.query, 'token', 120);
    if (!newsletter.TOKEN_SHAPE.test(token)) return actionPage(res, 400, { heading: 'This link cannot be used', message: 'The unsubscribe link is incomplete. Use the link at the bottom of any newsletter email.' });
    actionPage(res, 200, { heading: 'Unsubscribe', message: 'Press the button to stop the newsletter. Your email address is deleted from the subscriber list.',
      form: { action: '/newsletter/unsubscribe', token, button: 'Unsubscribe' } });
  });
  // Two callers: the button on the page above (token in the form, same-origin checked),
  // and a mail provider's one-click request (RFC 8058): a POST to the link itself with the
  // body "List-Unsubscribe=One-Click". Mail providers send no Origin header; possession of
  // the token is the authorisation, and all it can do is unsubscribe its own address.
  const oneClick = req => req.body?.['List-Unsubscribe'] === 'One-Click' && typeof req.query.token === 'string';
  router.post('/newsletter/unsubscribe', (req, res, next) => oneClick(req) ? next() : forms.sameOrigin(req, res, next), async (req, res, next) => {
    try {
      const token = oneClick(req) ? field(req.query, 'token', 120) : field(req.body, 'token', 120);
      const result = await newsletter.unsubscribe(token, now ? { now } : {});
      if (!result.ok) return actionPage(res, 400, { heading: 'This link cannot be used', message: 'The unsubscribe link was not recognised. Use the link at the bottom of the most recent newsletter email.' });
      actionPage(res, 200, { heading: 'You are unsubscribed', message: 'Your email address has been deleted from the subscriber list. No further newsletters will be sent unless you sign up and confirm again.' });
    } catch (e) { next(e); }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Admin pages (mounted at /admin). Counts only: no route lists or exports addresses.
// ---------------------------------------------------------------------------

function createAdminRouter() {
  const router = express.Router();
  router.use('/newsletter', requireAdmin, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, smallBody, urlencoded);

  async function overview(req, extra = {}) {
    const principal = identity(req.session);
    return {
      counts: await newsletter.counts(), cfg: newsletter.config(), outboxes: await newsletter.listOutboxes(),
      isEditor: policy.human(principal, 'editor'), today: new Date().toISOString().slice(0, 10),
      message: '', error: '', preview: null, previewDay: '', ...extra
    };
  }

  router.get('/newsletter', async (req, res, next) => {
    try {
      const queued = field(req.query, 'queued', 10);
      // A ?day= box on the page is a plain GET form; send it on to the preview address.
      const day = field(req.query, 'day', 10);
      if (day) return res.redirect(303, newsletter.validDay(day) ? `/admin/newsletter/preview/${day}` : '/admin/newsletter');
      res.render('admin/newsletter', await overview(req, { message: newsletter.validDay(queued) ? `The ${queued} issue is queued. Nothing has been sent; sending runs only from scripts/newsletter-send.js.` : '' }));
    } catch (e) { next(e); }
  });

  router.get('/newsletter/preview/:day', async (req, res, next) => {
    try {
      const day = req.params.day;
      if (!newsletter.validDay(day)) return res.status(400).render('admin/newsletter', await overview(req, { error: 'That is not a valid date (use YYYY-MM-DD).' }));
      const issue = await newsletter.buildIssue(day);
      if (!issue) return res.status(404).render('admin/newsletter', await overview(req, { previewDay: day, error: `No released edition with available articles for ${day}. There is no issue to preview or send.` }));
      if (req.query.format === 'html') {
        // The email exactly as a mail client would show it, locked down: no scripts,
        // no network requests, no form posts.
        return res.set('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'").type('html').send(issue.html);
      }
      res.render('admin/newsletter', await overview(req, { preview: issue, previewDay: day }));
    } catch (e) { next(e); }
  });

  router.post('/newsletter/queue/:day', async (req, res, next) => {
    try {
      const refuse = async (status, error) => res.status(status).render('admin/newsletter', await overview(req, { error }));
      if (req.get('origin') !== `${req.protocol}://${req.get('host')}`) return res.status(403).type('text').send('Same-origin request required');
      const principal = identity(req.session);
      if (!policy.human(principal, 'editor')) return refuse(403, 'Only a signed-in editor can queue a newsletter issue.');
      if (!newsletter.config().sendingFlag) return refuse(403, 'Newsletter sending is switched off (NEWSLETTER_SENDING_ENABLED). Nothing was queued.');
      if (field(req.body, 'reviewed', 10) !== 'yes') return refuse(422, 'Tick the box to confirm you reviewed the preview. Nothing was queued.');
      try { await newsletter.queueIssue(req.params.day, principal); }
      catch (e) { if (e.status && e.status < 500) return refuse(e.status, e.message); throw e; }
      res.redirect(303, '/admin/newsletter?queued=' + encodeURIComponent(req.params.day));
    } catch (e) { next(e); }
  });

  return router;
}

module.exports = { publicRouter: createPublicRouter(), adminRouter: createAdminRouter(), createPublicRouter, createAdminRouter };
