const express = require('express');
const router = express.Router();
const store = require('../lib/bugsdrugs/store');
const dosing = require('../lib/bugsdrugs/dosing');

const ACK_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function ackRequired(req) {
  const ack = req.session && req.session.bugsDrugsAck;
  if (!ack) return true;
  if (Date.now() - ack > ACK_TTL_MS) return true;
  return false;
}

// Landing — search + browse
router.get('/', async (req, res, next) => {
  try {
    const data = await store.load();
    res.render('bugs-drugs/index', {
      title: 'Bugs & Drugs — Pharmacy News',
      activeCategory: 'bugs-drugs',
      organisms: data.organisms,
      syndromes: data.syndromes,
      drugs: data.drugs,
      ackRequired: ackRequired(req)
    });
  } catch (err) { next(err); }
});

// Terms / disclaimer page
router.get('/terms', (req, res) => {
  res.render('bugs-drugs/terms', { title: 'Terms — Bugs & Drugs', activeCategory: 'bugs-drugs' });
});

// Acknowledge disclaimer
router.post('/acknowledge', (req, res) => {
  if (req.session) req.session.bugsDrugsAck = Date.now();
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({ ok: true });
  }
  res.redirect(req.body.redirect || '/bugs-and-drugs');
});

// Search index (client-side fuzzy search hits this once on page load)
router.get('/api/search-index', async (req, res, next) => {
  try {
    const items = await store.buildSearchIndex();
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ items });
  } catch (err) { next(err); }
});

// Organism page
router.get('/organism/:slug', async (req, res, next) => {
  try {
    const organism = await store.getOrganism(req.params.slug);
    if (!organism) return res.status(404).render('bugs-drugs/not-found', { title: 'Organism not found', activeCategory: 'bugs-drugs', what: 'organism' });
    const regimens = await store.getRegimensByKeys(organism.regimen_keys || []);
    res.render('bugs-drugs/organism', {
      title: `${organism.name} — Bugs & Drugs`,
      activeCategory: 'bugs-drugs',
      organism,
      regimens,
      ackRequired: ackRequired(req)
    });
  } catch (err) { next(err); }
});

// Syndrome page
router.get('/syndrome/:slug', async (req, res, next) => {
  try {
    const syndrome = await store.getSyndrome(req.params.slug);
    if (!syndrome) return res.status(404).render('bugs-drugs/not-found', { title: 'Syndrome not found', activeCategory: 'bugs-drugs', what: 'syndrome' });
    const regimens = await store.getRegimensByKeys(syndrome.regimen_keys || []);
    res.render('bugs-drugs/syndrome', {
      title: `${syndrome.name} — Bugs & Drugs`,
      activeCategory: 'bugs-drugs',
      syndrome,
      regimens,
      ackRequired: ackRequired(req)
    });
  } catch (err) { next(err); }
});

// Drug detail + calculator
router.get('/drug/:slug', async (req, res, next) => {
  try {
    const drug = await store.getDrug(req.params.slug);
    if (!drug) return res.status(404).render('bugs-drugs/not-found', { title: 'Drug not found', activeCategory: 'bugs-drugs', what: 'drug' });
    res.render('bugs-drugs/drug', {
      title: `${drug.generic} — Bugs & Drugs`,
      activeCategory: 'bugs-drugs',
      drug,
      ackRequired: ackRequired(req)
    });
  } catch (err) { next(err); }
});

// Dose calculator API. No PHI persisted.
router.post('/api/calculate', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (ackRequired(req)) return res.status(403).json({ error: 'Disclaimer not acknowledged.' });

  const drug = await store.getDrug(req.body.drug_slug);
  if (!drug) return res.status(404).json({ error: 'Drug not found' });

  const v = dosing.validatePatient({
    age: req.body.age,
    weightKg: req.body.weight_kg,
    heightCm: req.body.height_cm,
    scr: req.body.scr,
    sex: req.body.sex
  });
  if (!v.ok) return res.status(400).json({ error: 'Invalid input', details: v.errors });

  const result = dosing.calculate(drug, v.normalized);
  res.json({ result });
});

// PubMed Recent Evidence proxy. Calls E-utilities, returns lightweight summary.
router.get('/api/pubmed', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  const term = String(req.query.q || '').slice(0, 200);
  if (!term) return res.json({ articles: [] });

  try {
    const axios = require('axios');
    const search = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', {
      params: {
        db: 'pubmed',
        term: `${term} AND ("last 2 years"[PDat])`,
        retmax: 6,
        sort: 'date',
        retmode: 'json'
      },
      timeout: 8000
    });
    const ids = (search.data && search.data.esearchresult && search.data.esearchresult.idlist) || [];
    if (ids.length === 0) return res.json({ articles: [] });

    const summary = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi', {
      params: { db: 'pubmed', id: ids.join(','), retmode: 'json' },
      timeout: 8000
    });
    const result = summary.data && summary.data.result;
    const articles = ids.map(id => {
      const art = result && result[id];
      if (!art) return null;
      return {
        pmid: id,
        title: art.title || '',
        journal: art.fulljournalname || art.source || '',
        pubdate: art.pubdate || '',
        authors: (art.authors || []).slice(0, 3).map(a => a.name).join(', '),
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`
      };
    }).filter(Boolean);

    res.json({ articles });
  } catch (err) {
    res.json({ articles: [], error: 'PubMed unavailable' });
  }
});

module.exports = router;
