const express = require('express');
const router = express.Router();
const store = require('../lib/store');
const scrapeLog = require('../lib/scrape-log');
const { CATEGORIES } = require('../config/categories');
const { requireAdmin, verifyCredentials } = require('../middleware/auth');

// Login page
router.get('/login', (req, res) => {
  res.render('admin/login', {
    error: null,
    categories: CATEGORIES,
    activeCategory: null
  });
});

// Login handler
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const ok = await verifyCredentials(username, password);
  if (ok) {
    req.session.authenticated = true;
    req.session.username = username;
    return res.redirect('/admin');
  }
  res.status(401).render('admin/login', {
    error: 'Invalid username or password',
    categories: CATEGORIES,
    activeCategory: null
  });
});

// Logout (POST per spec; keep GET for sidebar link compatibility)
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// All routes below require auth
router.use(requireAdmin);

// Dashboard home
router.get('/', async (req, res, next) => {
  try {
    const stats = await store.getStats();
    const todayStr = new Date().toISOString().slice(0, 10);
    const pending = await store.listArticles('pending', { sortBy: 'editorial_score', sortDir: 'desc' });
    const todayPending = pending.filter(a => (a.date_scraped || '').slice(0, 10) === todayStr);
    const recentPending = pending.slice(0, 5);
    const lastLog = await scrapeLog.getLastRun();
    const recentLogs = await scrapeLog.listRecent(5);
    const nextRunUTC = nextCronUTC();
    res.render('admin/dashboard', {
      stats,
      todayPendingCount: todayPending.length,
      recentPending,
      lastLog,
      recentLogs,
      nextRunUTC,
      todayStr,
      categories: CATEGORIES,
      activeCategory: null,
      totalPending: stats.counts.pending,
      page: 'dashboard'
    });
  } catch (err) {
    next(err);
  }
});

function nextCronUTC() {
  // Cron is "0 10 * * *" — daily at 10:00 UTC (4 AM CST / 5 AM CDT)
  const now = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 10, 0, 0
  ));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

// Review queue
router.get('/queue', async (req, res, next) => {
  try {
    const category = req.query.category;
    const options = category && category !== 'all' ? { category } : {};
    const articles = await store.listArticles('pending', options);
    const counts = await store.countByCategory('pending');
    const totalPending = Object.values(counts).reduce((s, n) => s + n, 0);
    res.render('admin/queue', {
      articles,
      counts,
      totalPending,
      activeCategory: category || 'all',
      categories: CATEGORIES,
      page: 'queue'
    });
  } catch (err) {
    next(err);
  }
});

// Published articles
router.get('/published', async (req, res, next) => {
  try {
    const category = req.query.category;
    const options = category && category !== 'all' ? { category } : {};
    const articles = await store.listArticles('approved', options);
    res.render('admin/published', {
      articles,
      activeCategory: category || 'all',
      categories: CATEGORIES,
      page: 'published'
    });
  } catch (err) {
    next(err);
  }
});

// Edit article
router.get('/edit/:id', async (req, res, next) => {
  try {
    // Try to find in all directories
    let article = null;
    let status = null;
    for (const s of ['pending', 'approved', 'declined']) {
      if (await store.articleExists(s, req.params.id)) {
        article = await store.readArticle(s, req.params.id);
        status = s;
        break;
      }
    }
    if (!article) {
      return res.status(404).send('Article not found');
    }
    res.render('admin/edit', {
      article,
      articleStatus: status,
      categories: CATEGORIES,
      activeCategory: null,
      page: 'edit'
    });
  } catch (err) {
    next(err);
  }
});

// Analytics
router.get('/analytics', async (req, res, next) => {
  try {
    const stats = await store.getStats();
    res.render('admin/analytics', {
      stats,
      categories: CATEGORIES,
      activeCategory: null,
      page: 'analytics'
    });
  } catch (err) {
    next(err);
  }
});

// Settings
router.get('/settings', (req, res) => {
  const sources = require('../config/sources');
  res.render('admin/settings', {
    sources,
    categories: CATEGORIES,
    activeCategory: null,
    page: 'settings'
  });
});

// Scrape run logs
router.get('/logs', async (req, res, next) => {
  try {
    const logs = await scrapeLog.listRecent(100);
    res.render('admin/logs', {
      logs,
      categories: CATEGORIES,
      activeCategory: null,
      page: 'logs'
    });
  } catch (err) {
    next(err);
  }
});

// Manual scrape trigger (server-rendered form post)
router.post('/scrape/run', async (req, res, next) => {
  try {
    const scheduler = require('../lib/scheduler');
    scheduler.triggerManualScrape().catch((err) => {
      console.error('[SCRAPE] Manual run failed:', err.message);
    });
    if (req.accepts('html')) return res.redirect('/admin/logs');
    res.json({ success: true, message: 'Scraping started' });
  } catch (err) {
    next(err);
  }
});

// Editor's Picks
router.get('/editors-picks', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Try to load today's slate
    let slate = null;
    try {
      slate = await store.readSlate(today);
    } catch {
      // No slate for today
    }

    // Get all pending articles with scores for charts
    const pending = await store.listArticles('pending', { sortBy: 'editorial_score', sortDir: 'desc' });
    const scored = pending.filter(a => typeof a.editorial_score === 'number');

    // Get feedback history
    let feedbackStats = null;
    try {
      const pharmeditor = require('../lib/pharmeditor');
      feedbackStats = await pharmeditor.getFeedbackHistory(30);
    } catch {}

    // Compute score stats
    const scores = scored.map(a => a.editorial_score);
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) : 0;
    const topScore = scores.length > 0 ? Math.max(...scores) : 0;

    // Category coverage in slate
    const slateCategories = {};
    if (slate && slate.recommended_slate) {
      for (const item of slate.recommended_slate) {
        // Find the article to get its category
        const article = scored.find(a => a.id === item.id);
        const cat = article ? article.category : item.category;
        if (cat) slateCategories[cat] = (slateCategories[cat] || 0) + 1;
      }
    }

    // Score distribution histogram
    const histogram = [0, 0, 0, 0, 0]; // 0-20, 20-40, 40-60, 60-80, 80-100
    for (const s of scores) {
      const bucket = Math.min(Math.floor(s / 20), 4);
      histogram[bucket]++;
    }

    // Enrich slate articles with full data
    let slateArticles = [];
    if (slate && slate.recommended_slate) {
      for (const item of slate.recommended_slate) {
        const article = scored.find(a => a.id === item.id) || pending.find(a => a.id === item.id);
        if (article) {
          slateArticles.push({ ...article, slate_rank: item.rank, slate_reason: item.reason });
        }
      }
    }

    let honorableMentionArticles = [];
    if (slate && slate.honorable_mentions) {
      for (const item of slate.honorable_mentions) {
        const article = scored.find(a => a.id === item.id) || pending.find(a => a.id === item.id);
        if (article) {
          honorableMentionArticles.push({ ...article, slate_reason: item.reason });
        }
      }
    }

    res.render('admin/editors-picks', {
      slate,
      slateArticles,
      honorableMentionArticles,
      scored,
      avgScore,
      topScore,
      histogram,
      slateCategories,
      feedbackStats,
      today,
      categories: CATEGORIES,
      activeCategory: null,
      totalPending: pending.length,
      page: 'editors-picks'
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
