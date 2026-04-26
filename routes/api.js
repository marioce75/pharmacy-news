const express = require('express');
const router = express.Router();
const store = require('../lib/store');
const { requireAdminApi } = require('../middleware/auth');

router.use('/admin', requireAdminApi);

// Approve article
router.post('/admin/approve/:id', async (req, res, next) => {
  try {
    const article = await store.moveArticle('pending', 'approved', req.params.id);
    const pharmeditor = require('../lib/pharmeditor');
    pharmeditor.recordFeedback(req.params.id, article.editorial_score || null, 'approved');
    res.json({ success: true, article });
  } catch (err) {
    next(err);
  }
});

// Decline article
router.post('/admin/decline/:id', async (req, res, next) => {
  try {
    const article = await store.moveArticle('pending', 'declined', req.params.id);
    const pharmeditor = require('../lib/pharmeditor');
    pharmeditor.recordFeedback(req.params.id, article.editorial_score || null, 'declined');
    res.json({ success: true, article });
  } catch (err) {
    next(err);
  }
});

// Unpublish article (move from approved back to pending)
router.post('/admin/unpublish/:id', async (req, res, next) => {
  try {
    const article = await store.moveArticle('approved', 'pending', req.params.id);
    res.json({ success: true, article });
  } catch (err) {
    next(err);
  }
});

// Update article
router.put('/admin/articles/:id', async (req, res, next) => {
  try {
    // Find article in any directory
    let article = null;
    let status = null;
    for (const s of ['pending', 'approved', 'declined']) {
      if (await store.articleExists(s, req.params.id)) {
        article = await store.readArticle(s, req.params.id);
        status = s;
        break;
      }
    }
    if (!article) return res.status(404).json({ error: 'Article not found' });

    // Update fields
    const allowedFields = [
      'title', 'summary', 'body', 'category', 'source', 'source_url',
      'tags', 'drug_names', 'companies', 'therapeutic_area', 'region',
      'instagram_caption', 'image', 'image_prompt', 'priority', 'slug'
    ];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        article[field] = req.body[field];
      }
    }

    await store.writeArticle(status, article.id, article);
    res.json({ success: true, article });
  } catch (err) {
    next(err);
  }
});

// Stats
router.get('/admin/stats', async (req, res, next) => {
  try {
    const stats = await store.getStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// Trigger scrape
router.post('/admin/scrape', async (req, res, next) => {
  try {
    const scraper = require('../scrapers');
    // Run in background, respond immediately
    scraper.runAll()
      .then(result => console.log(`[SCRAPE] Manual: ${result.newArticles} new, ${result.duplicates} dupes`))
      .catch(err => console.error('[SCRAPE] Manual failed:', err.message));
    res.json({ success: true, message: 'Scraping started in background' });
  } catch (err) {
    next(err);
  }
});

// Bulk approve
router.post('/admin/bulk-approve', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
    const pharmeditor = require('../lib/pharmeditor');
    const results = [];
    for (const id of ids) {
      try {
        const article = await store.moveArticle('pending', 'approved', id);
        pharmeditor.recordFeedback(id, article.editorial_score || null, 'approved');
        results.push({ id, success: true });
      } catch {
        results.push({ id, success: false });
      }
    }
    res.json({ success: true, results });
  } catch (err) {
    next(err);
  }
});

// Bulk decline
router.post('/admin/bulk-decline', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
    const pharmeditor = require('../lib/pharmeditor');
    const results = [];
    for (const id of ids) {
      try {
        const article = await store.moveArticle('pending', 'declined', id);
        pharmeditor.recordFeedback(id, article.editorial_score || null, 'declined');
        results.push({ id, success: true });
      } catch {
        results.push({ id, success: false });
      }
    }
    res.json({ success: true, results });
  } catch (err) {
    next(err);
  }
});

// === PharmEditor Endpoints ===

// Get daily slate
router.get('/admin/slate/:date', async (req, res, next) => {
  try {
    const slate = await store.readSlate(req.params.date);
    res.json(slate);
  } catch {
    res.status(404).json({ error: 'No slate found for this date' });
  }
});

// Approve entire recommended slate
router.post('/admin/approve-slate', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const slate = await store.readSlate(today);
    if (!slate || !slate.recommended_slate) {
      return res.status(404).json({ error: 'No slate found for today' });
    }

    const pharmeditor = require('../lib/pharmeditor');
    const results = [];
    for (const item of slate.recommended_slate) {
      try {
        const article = await store.moveArticle('pending', 'approved', item.id);
        pharmeditor.recordFeedback(item.id, item.score || null, 'approved');
        results.push({ id: item.id, success: true });
      } catch {
        results.push({ id: item.id, success: false });
      }
    }
    res.json({ success: true, results, approved: results.filter(r => r.success).length });
  } catch (err) {
    next(err);
  }
});

// Manual PharmEditor trigger
router.post('/admin/run-pharmeditor', async (req, res, next) => {
  try {
    const pharmeditor = require('../lib/pharmeditor');
    // Get all pending article IDs
    const pending = await store.listArticles('pending');
    const ids = pending.map(a => a.id);

    if (ids.length === 0) {
      return res.json({ success: true, message: 'No pending articles to analyze' });
    }

    // Run in background
    pharmeditor.analyze(ids)
      .then(result => console.log(`[PHARMEDITOR] Manual: ${result.scored} scored, ${result.errors} errors, slate: ${result.slateGenerated}`))
      .catch(err => console.error('[PHARMEDITOR] Manual failed:', err.message));

    res.json({ success: true, message: `PharmEditor analyzing ${ids.length} articles in background` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
