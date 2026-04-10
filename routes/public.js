const express = require('express');
const router = express.Router();
const store = require('../lib/store');
const { CATEGORIES } = require('../config/categories');

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
