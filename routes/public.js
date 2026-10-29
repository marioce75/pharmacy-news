const express = require('express');
const router = express.Router();
const store = require('../lib/store');
const {sanitize}=require('../lib/publication');
router.use((req,res,next)=>{res.locals.sanitizeBody=sanitize;next();});
const { CATEGORIES } = require('../config/categories');

// Unreviewed official-source titles and links (owner-approved public listing); no summaries, counts or advice.
router.get('/api/monitor/reports',async(req,res,next)=>{try{const q=req.query,one=(v,ok)=>typeof v==='string'&&ok(v)?v:'';const {COUNTRIES,WHO_REGIONS}=require('../config/countries');
 res.set('Cache-Control','public, max-age=120').json(await require('../lib/events/public-listing').listing({stream:one(q.stream,v=>['outbreak','substance'].includes(v)),region:one(q.region,v=>v in WHO_REGIONS),country:one(q.country,v=>COUNTRIES.some(c=>c.iso2===v)),since:one(q.since,v=>/^\d{4}-\d{2}-\d{2}$/.test(v)),q:typeof q.q==='string'?q.q.slice(0,120):''}));}catch(e){next(e);}});
router.get('/api/outbreaks',async(req,res,next)=>{try{res.json(await require('../lib/outbreaks').publicEvents());}catch(e){next(e);}});
router.get('/api/source-coverage',async(req,res,next)=>{try{const s=await require('../lib/collection/runner').status();res.json({sources:s.sources.map(x=>({id:x.id,name:x.name,url:x.url,topic:x.topic,adapter:x.adapter,validation:x.validation||null,access:x.access,rights:x.rights,data_kind:x.data_kind||"news_metadata",coverage_note:x.coverage_note||null,observation_period:x.observation_period||null,languages:x.languages,jurisdictions:x.jurisdictions,status:s.health[x.id]?.status||x.status,reason:x.reason||null,pagination:s.health[x.id]?.pagination||null,last_success_at:s.health[x.id]?.last_success_at||null})),coverage_gaps:s.coverage_gaps});}catch(e){next(e);}});
router.get('/edition/:day',async(req,res,next)=>{try{const e=await require('../lib/editions').read(req.params.day);if(!e||e.status!=='released')return res.status(404).send('No reviewed edition available');const articles=[];let unavailable=0;for(const ref of e.items){try{const a=await store.readArticle('approved',ref.id);if(require('../lib/publication').revision(a)!==ref.revision){unavailable++;continue;}articles.push(a);}catch{unavailable++;}}res.render('edition',{edition:e,articles,unavailable});}catch(e){next(e);}});
router.get('/treatments',async(req,res,next)=>{try{const t=require('../lib/treatments'),query=typeof req.query.disease==='string'?req.query.disease.slice(0,160):'';let guides=await t.approved();if(query)guides=guides.filter(a=>[a.treatment.disease_key,a.treatment.disease,a.treatment.pathogen].some(v=>v.toLowerCase()===query.toLowerCase()));res.render('treatments',{guides,query,preview:false,keys:t.KEYS,labels:t.LABELS,stale:t.stale});}catch(e){next(e);}});
router.get('/substance-alerts',async(req,res,next)=>{try{const m=require('../lib/substance-alerts'),query=typeof req.query.substance==='string'?req.query.substance.slice(0,120):'',category=m.CATEGORIES.includes(req.query.category)?req.query.category:'';const events=(await m.approved()).filter(e=>(!query||e.substance.toLowerCase().includes(query.toLowerCase()))&&(!category||e.category===category));const {WHO_REGIONS}=require('../config/countries'),region=typeof req.query.region==='string'&&req.query.region in WHO_REGIONS?req.query.region:'';
 const official=await require('../lib/events/public-listing').listing({stream:'substance',q:query,region});res.render('substance-alerts',{events,query,category,categories:m.CATEGORIES,official,region,regions:WHO_REGIONS});}catch(e){next(e);}});
// Homepage
router.get('/', async (req, res, next) => {
  try {
    const category = req.query.category;
    const options = category && category !== 'all' ? { category } : {};
    const articles = await store.listArticles('approved', options);
    res.render('index', {
      articles,
      activeCategory: category || 'all',
      categories: CATEGORIES
    });
  } catch (err) {
    next(err);
  }
});

// Peptide vertical — cross-cutting filter, not a category
router.get('/peptides', async (req, res, next) => {
  try {
    const lane = req.query.lane; // 'clinical' | 'compounding' | 'longevity' | undefined
    const approved = await store.listArticles('approved');
    let articles = approved.filter(a => a.is_peptide);
    if (lane && ['clinical', 'compounding', 'longevity'].includes(lane)) {
      articles = articles.filter(a => Array.isArray(a.peptide_lanes) && a.peptide_lanes.includes(lane));
    }
    res.render('peptides', {
      articles,
      activeCategory: 'peptides',
      activeLane: lane || 'all',
      categories: CATEGORIES
    });
  } catch (err) {
    next(err);
  }
});

// Article detail
router.get('/article/:slug', async (req, res, next) => {
  try {
    const article = await store.findBySlug('approved', req.params.slug);
    if (!article) {
      return res.status(404).render('layout', {
        title: 'Article Not Found — Pharmacy News',
        activeCategory: null,
        body: '<div style="text-align:center;padding:4rem 0"><h1 style="font-family:DM Serif Display,serif;margin-bottom:1rem">Article Not Found</h1><p style="color:var(--text-muted);margin-bottom:2rem">The article you\'re looking for doesn\'t exist or has been moved.</p><a href="/" style="color:var(--signal-green)">← Back to homepage</a></div>'
      });
    }
    res.render('article', {
      article,
      activeCategory: article.category,
      categories: CATEGORIES
    });
  } catch (err) {
    next(err);
  }
});

// JSON API — list articles
router.get('/api/articles', async (req, res, next) => {
  try {
    const category = req.query.category;
    const options = category && category !== 'all' ? { category } : {};
    const articles = await store.listArticles('approved', options);
    res.json({ articles, categories: CATEGORIES });
  } catch (err) {
    next(err);
  }
});

// JSON API — single article
router.get('/api/articles/:slug', async (req, res, next) => {
  try {
    const article = await store.findBySlug('approved', req.params.slug);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    res.json({ article });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
