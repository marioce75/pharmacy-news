// Worldwide peptide research feed via NCBI PubMed E-utilities (free, no key).
// Returns article objects in the same shape as the RSS scrapers so they can
// flow through the existing dedup + store pipeline.
//
// Strategy:
//   1. esearch.fcgi   — get the most recent N PMIDs matching peptide queries
//   2. esummary.fcgi  — fetch title + abstract + journal for each PMID

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const slugify = require('slugify');
const { sleep } = require('./base-scraper');
const { getCategoryInfo } = require('../config/categories');

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const UA = { 'User-Agent': 'PharmacyNews/1.0 (Dosys Health; news aggregator)' };

const QUERIES = [
  // Lane A — clinical/regulatory
  '("peptide therapeutic"[Title/Abstract] OR "peptide drug"[Title/Abstract] OR "peptide hormone"[Title/Abstract])',
  '("GLP-1 receptor agonist"[Title/Abstract] OR semaglutide[Title/Abstract] OR tirzepatide[Title/Abstract] OR retatrutide[Title/Abstract])',
  '("antimicrobial peptide"[Title/Abstract] OR "peptide vaccine"[Title/Abstract])',
  // Lane C — longevity research
  '("peptide longevity"[Title/Abstract] OR "anti-aging peptide"[Title/Abstract] OR "senolytic peptide"[Title/Abstract])'
];

const RETMAX_PER_QUERY = 8;

async function searchPmids(query) {
  const url = `${EUTILS}/esearch.fcgi`;
  const params = {
    db: 'pubmed',
    term: query,
    sort: 'date',
    retmax: RETMAX_PER_QUERY,
    retmode: 'json'
  };
  const { data } = await axios.get(url, { params, headers: UA, timeout: 15000 });
  return (data && data.esearchresult && data.esearchresult.idlist) || [];
}

async function fetchSummaries(pmids) {
  if (pmids.length === 0) return [];
  const url = `${EUTILS}/esummary.fcgi`;
  const params = {
    db: 'pubmed',
    id: pmids.join(','),
    retmode: 'json'
  };
  const { data } = await axios.get(url, { params, headers: UA, timeout: 15000 });
  const result = data && data.result;
  if (!result) return [];
  return pmids
    .map((pmid) => result[pmid])
    .filter(Boolean)
    .map((r) => ({
      pmid: r.uid,
      title: (r.title || '').trim(),
      summary: buildSummary(r),
      link: `https://pubmed.ncbi.nlm.nih.gov/${r.uid}/`,
      date: r.pubdate || r.epubdate || new Date().toISOString(),
      journal: (r.fulljournalname || r.source || '').trim(),
      authors: (r.authors || []).slice(0, 3).map((a) => a.name).filter(Boolean)
    }));
}

function buildSummary(r) {
  const journal = (r.fulljournalname || r.source || '').trim();
  const date = r.pubdate || r.epubdate || '';
  const authors = (r.authors || []).slice(0, 3).map((a) => a.name).join(', ');
  const more = (r.authors || []).length > 3 ? ' et al.' : '';
  const parts = [];
  if (authors) parts.push(`${authors}${more}.`);
  if (journal) parts.push(journal + '.');
  if (date) parts.push(date + '.');
  return parts.join(' ').slice(0, 500);
}

function buildArticle(item) {
  const id = uuidv4();
  const slug = slugify(item.title, { lower: true, strict: true }).slice(0, 80);
  const datePublished = parseDate(item.date);
  const category = 'disease-research';
  const catInfo = getCategoryInfo(category);

  return {
    id,
    slug,
    title: item.title,
    summary: item.summary,
    body: '',
    source: `PubMed — ${item.journal || 'NCBI'}`,
    source_url: item.link,
    category,
    region: catInfo.region || 'Global',
    date_published: datePublished,
    date_scraped: new Date().toISOString(),
    status: 'pending',
    tags: ['pubmed', 'research'],
    instagram_caption: '',
    image: '',
    image_prompt: `Scientific illustration: ${item.title}`,
    priority: 'medium',
    drug_names: [],
    companies: [],
    therapeutic_area: '',
    pmid: item.pmid,
    authors: item.authors || []
  };
}

function parseDate(s) {
  if (!s) return new Date().toISOString().slice(0, 10);
  // PubMed dates can be "2026 Apr 15" or "2026 Apr" or "2026"
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

async function fetchAll() {
  const allPmids = new Set();
  for (const q of QUERIES) {
    try {
      const ids = await searchPmids(q);
      ids.forEach((id) => allPmids.add(id));
      await sleep(400); // NCBI courtesy: <=3 req/sec without API key
    } catch (err) {
      console.error(`  [pubmed] esearch failed for "${q.slice(0, 50)}…": ${err.message}`);
    }
  }
  const pmids = Array.from(allPmids);
  if (pmids.length === 0) return [];

  // esummary in batches of 50 PMIDs (well under the 200 cap)
  const batches = [];
  for (let i = 0; i < pmids.length; i += 50) batches.push(pmids.slice(i, i + 50));

  const articles = [];
  for (const batch of batches) {
    try {
      const summaries = await fetchSummaries(batch);
      for (const s of summaries) {
        if (!s.title || !s.link) continue;
        articles.push(buildArticle(s));
      }
      await sleep(400);
    } catch (err) {
      console.error(`  [pubmed] esummary failed: ${err.message}`);
    }
  }
  return articles;
}

module.exports = { fetchAll };
