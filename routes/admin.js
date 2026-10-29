const express = require('express');
const router = express.Router();
const store = require('../lib/store');
const scrapeLog = require('../lib/scrape-log');
const { CATEGORIES } = require('../config/categories');
const { requireAdmin, authenticate, establish } = require('../middleware/auth');

router.use((req,res,next)=>{
 if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.get('origin')!==`${req.protocol}://${req.get('host')}`)return res.status(403).send('Same-origin request required');next();
});
// Login page
router.get('/login', (req, res) => {
  res.render('admin/login', {
    error: null,
    categories: CATEGORIES,
    activeCategory: null
  });
});

// Login handler
router.post('/login', require('../middleware/security').loginThrottle(), async (req, res) => {
  const { username, password } = req.body;
  const login = await authenticate(username, password);
  if (login) {
    await new Promise((resolve,reject)=>req.session.regenerate(err=>err?reject(err):resolve()));
    establish(req.session, login);
    // Persist before redirecting: express-session otherwise sends the redirect headers
    // while the file store is still writing, so the next request can miss the session.
    await new Promise((resolve,reject)=>req.session.save(err=>err?reject(err):resolve()));
    return res.redirect('/admin');
  }
  res.status(401).render('admin/login', {
    error: 'Invalid username or password',
    categories: CATEGORIES,
    activeCategory: null
  });
});

// Logout changes session state and requires a same-origin POST.
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});
router.get('/logout', (req,res)=>res.status(405).send('Use POST to log out'));

// All routes below require auth
router.use(requireAdmin);
router.use((req,res,next)=>{if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!require('../lib/review-policy').human(require('../middleware/auth').identity(req.session),'editor'))return res.status(403).send('Editor role required');next();});

// Collection/editorial workspace: no collection button or model invocation here.
router.get('/discovery',async(req,res,next)=>{try{const kind=String(req.query.kind||'all'),query=String(req.query.q||'');res.render('admin/discovery',{kind,query,rows:await require('../lib/discovery').list({kind,query})});}catch(e){next(e);}});
router.get('/collection',async(req,res,next)=>{try{const day=req.query.day||new Date().toISOString().slice(0,10),editions=require('../lib/editions');const pending=await store.listArticles('pending'),approved=await store.listArticles('approved'),edition=await editions.read(day);res.render('admin/collection',{coverage:await require('../lib/collection/runner').status(),pending,approved,day,edition,editionRevision:edition?editions.revision(edition):null,revision:require('../lib/publication').revision});}catch(e){next(e);}});
router.post('/intake/:id',async(req,res,next)=>{try{
 const pub=require('../lib/publication'),a=(await pub.preview(req.params.id)).article,b=req.body;
 const changes={summary:b.summary,body:b.body,content_kind:b.content_kind,correction_reason:b.correction_reason,
 editorial:{...a.editorial,original_summary:b.original_summary==='yes',translation_reviewed:b.translation_reviewed==='yes'},
 rights:{...a.rights,status:b.rights_status,license_url:b.license_url,attribution:b.attribution},
 translation:{required:b.translation_required==='yes',original_language:b.original_language,target_language:b.target_language},outbreak:a.outbreak||null};
 if(b.event_kind)changes.outbreak={kind:b.event_kind,disease:b.disease,confirmation:b.confirmation,report_url:b.report_url,report_date:b.report_date,update_date:b.update_date||null,onset_date:b.onset_date||null,uncertainty:b.uncertainty,location:{name:b.location_name,precision:b.precision,basis:'reported_area_centroid',lat:b.lat?.trim()?Number(b.lat):null,lon:b.lon?.trim()?Number(b.lon):null,evidence_url:b.location_evidence},assessment_text:b.assessment_text,assessment_version:b.assessment_version,assessment_date:b.assessment_date||null,cross_border_evidence:b.cross_border_evidence};
 await pub.edit(req.params.id,changes,b.revision,require('../middleware/auth').identity(req.session).id);res.redirect('/admin/edit/'+req.params.id);
 }catch(e){next(e);}});
router.post('/edition/:day',async(req,res,next)=>{try{const ed=require('../lib/editions'),principal=require('../middleware/auth').identity(req.session);if(req.body.action==='release')await ed.release(req.params.day,req.body.revision,principal,req.body.confirmed==='yes');else await ed.draft(req.params.day,[req.body.ids||[]].flat(),req.body.note,principal);res.redirect('/admin/collection?day='+req.params.day);}catch(e){next(e);}});

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
  if(process.env.RUN_SCHEDULED_JOBS!=='true'||process.env.RUN_NEWS_SCHEDULE!=='true'||process.env.ALLOW_COLLECTION!=='true')return null;
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(Math.floor(now.getUTCHours()/6)*6+6,0,0,0);
  return next.toISOString();
}

// Review queue
router.get('/queue', async (req, res, next) => {
  try {
    const category = req.query.category;
    const peptideOnly = req.query.peptide === '1';
    const options = category && category !== 'all' ? { category } : {};
    let articles = await store.listArticles('pending', options);
    if (peptideOnly) articles = articles.filter(a => a.is_peptide);
    const counts = await store.countByCategory('pending');
    const totalPending = Object.values(counts).reduce((s, n) => s + n, 0);

    // Peptide count across all pending (independent of category filter)
    const allPending = await store.listArticles('pending');
    const peptidePending = allPending.filter(a => a.is_peptide).length;

    res.render('admin/queue', {
      articles,
      counts,
      totalPending,
      peptideOnly,
      peptidePending,
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

router.get('/source-health',async(req,res,next)=>{try{res.json(await scrapeLog.listRecent(20));}catch(e){next(e);}});

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
 if(process.env.ALLOW_COLLECTION!=='true')return res.status(403).send('Collection disabled');
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

// Bugs & Drugs antibiotic-watch log + manual trigger
router.get('/bugs-drugs-watch', async (req, res, next) => {
  try {
    const fs = require('fs').promises;
    const path = require('path');
    const logFile = path.join(__dirname, '..', 'content', 'bugs-drugs', 'watch-log.json');
    let entries = [];
    try { entries = JSON.parse(await fs.readFile(logFile, 'utf8')); } catch {}
    res.render('admin/bugs-drugs-watch', {
      entries: entries.slice(0, 30),
      categories: CATEGORIES,
      activeCategory: null,
      page: 'bugs-drugs-watch'
    });
  } catch (err) { next(err); }
});

router.post('/bugs-drugs-watch/run', async (req, res, next) => {
 if(process.env.ALLOW_COLLECTION!=='true')return res.status(403).send('Collection disabled');
  try {
    const scheduler = require('../lib/scheduler');
    scheduler.triggerManualBugsDrugsWatch().catch((err) => {
      console.error('[BD-WATCH] Manual run failed:', err.message);
    });
    if (req.accepts('html')) return res.redirect('/admin/bugs-drugs-watch');
    res.json({ success: true, message: 'Bugs & Drugs watch started' });
  } catch (err) { next(err); }
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
