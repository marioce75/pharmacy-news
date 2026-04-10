const sources = require('../config/sources');
const baseScraper = require('./base-scraper');
const dedup = require('../lib/dedup');
const store = require('../lib/store');

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

async function runAll() {
  console.log('[SCRAPE] Starting full scrape...');
  let newArticles = 0;
  let duplicates = 0;
  let errors = 0;
  const newIds = [];

  for (const [category, categoryConfig] of Object.entries(sources)) {
    try {
      console.log(`  Scraping: ${category}...`);
      const articles = await runCategory(category, categoryConfig);

      for (const article of articles) {
        const isDup = await dedup.isDuplicate(article);
        if (isDup) {
          duplicates++;
          continue;
        }
        await store.writeArticle('pending', article.id, article);
        newIds.push(article.id);
        newArticles++;
      }

      console.log(`  ${category}: ${articles.length} found, new: ${articles.length - duplicates}`);
    } catch (err) {
      console.error(`  [ERROR] Category ${category}: ${err.message}`);
      errors++;
    }
  }

  console.log(`[SCRAPE] Complete: ${newArticles} new, ${duplicates} dupes, ${errors} errors`);

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

  return { newArticles, duplicates, errors, newIds };
}

module.exports = { runAll, runCategory };
