const base = require('./base-scraper');
const sources = require('../config/sources');

const CATEGORY = 'drug-safety';

async function scrape() {
  const config = sources[CATEGORY] || [];
  const articles = [];

  for (const source of config) {
    try {
      const items = await base.fetchRSS(source.url, source.keywords);
      for (const item of items) {
        const article = base.buildArticleObject(item, CATEGORY, source.name);
        article.priority = 'high'; // Safety alerts default to high priority
        article.region = 'US';
        articles.push(article);
      }
      await base.sleep(2000);
    } catch (err) {
      console.error(`  [${CATEGORY}] ${source.name}: ${err.message}`);
    }
  }

  return articles;
}

module.exports = { scrape };
