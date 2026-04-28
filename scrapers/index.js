const sources = require('../config/sources');
const baseScraper = require('./base-scraper');
const dedup = require('../lib/dedup');
const store = require('../lib/store');
const { tagArticle } = require('../lib/peptide-tagger');

async function runCategory(category, categoryConfig) {
  const articles = [];
  for (const source of categoryConfig) {
    try {
      let items = [];
      if (source.type === 'rss') {
        items = await baseScraper.fetchRSS(source.url, source.keywords);
      } else if (source.type === 'web') {
        items = await baseScraper.fetchWeb(source.url, source.selector);
      }

      for (const item of items) {
        const article = baseScraper.buildArticleObject(item, category, source.name);
        tagArticle(article);
        articles.push(article);
      }

      // Rate limit between sources
      await baseScraper.sleep(2000);
    } catch (err) {
      console.error(`  [ERROR] ${source.name}: ${err.message}`);
    }
  }
  return articles;
}

async function runPeptideSpecialty() {
  // Custom JSON-API scrapers that produce already-built article objects.
  // Tagger still runs to ensure is_peptide = true on every record.
  const out = [];
  try {
    console.log('  Scraping: peptide-pubmed...');
    const pubmed = require('./peptide-pubmed');
    const items = await pubmed.fetchAll();
    for (const a of items) { tagArticle(a); out.push(a); }
    console.log(`  peptide-pubmed: ${items.length} found`);
  } catch (err) {
    console.error(`  [ERROR] peptide-pubmed: ${err.message}`);
  }
  try {
    console.log('  Scraping: peptide-trials...');
    const trials = require('./peptide-trials');
    const items = await trials.fetchAll();
    for (const a of items) { tagArticle(a); out.push(a); }
    console.log(`  peptide-trials: ${items.length} found`);
  } catch (err) {
    console.error(`  [ERROR] peptide-trials: ${err.message}`);
  }
  return out;
}

async function runAll() {
  console.log('[SCRAPE] Starting full scrape...');
  let newArticles = 0;
  let duplicates = 0;
  let errors = 0;
  let peptideArticles = 0;
  const newIds = [];

  for (const [category, categoryConfig] of Object.entries(sources)) {
    try {
      console.log(`  Scraping: ${category}...`);
      const articles = await runCategory(category, categoryConfig);

      let catNew = 0, catDup = 0;
      for (const article of articles) {
        const isDup = await dedup.isDuplicate(article);
        if (isDup) {
          duplicates++;
          catDup++;
          continue;
        }
        await store.writeArticle('pending', article.id, article);
        newIds.push(article.id);
        newArticles++;
        catNew++;
        if (article.is_peptide) peptideArticles++;
      }

      console.log(`  ${category}: ${articles.length} found, new: ${catNew}, dup: ${catDup}`);
    } catch (err) {
      console.error(`  [ERROR] Category ${category}: ${err.message}`);
      errors++;
    }
  }

  // Peptide specialty scrapers (PubMed, ClinicalTrials.gov)
  try {
    const peptideItems = await runPeptideSpecialty();
    for (const article of peptideItems) {
      const isDup = await dedup.isDuplicate(article);
      if (isDup) {
        duplicates++;
        continue;
      }
      await store.writeArticle('pending', article.id, article);
      newIds.push(article.id);
      newArticles++;
      if (article.is_peptide) peptideArticles++;
    }
  } catch (err) {
    console.error(`  [ERROR] peptide-specialty: ${err.message}`);
    errors++;
  }

  console.log(`[SCRAPE] Complete: ${newArticles} new (${peptideArticles} peptide), ${duplicates} dupes, ${errors} errors`);

  // Run PharmEditor analysis on new articles
  if (newIds.length > 0) {
    try {
      const pharmeditor = require('../lib/pharmeditor');
      const result = await pharmeditor.analyze(newIds);
      console.log(`[PHARMEDITOR] Scored: ${result.scored}, Errors: ${result.errors}, Slate: ${result.slateGenerated}`);
    } catch (err) {
      console.error('[PHARMEDITOR] Analysis failed:', err.message);
      // Graceful degradation — articles remain in pending without scores
    }
  }

  return { newArticles, duplicates, errors, newIds, peptideArticles };
}

module.exports = { runAll, runCategory, runPeptideSpecialty };
