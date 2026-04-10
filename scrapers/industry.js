const base = require('./base-scraper');
const sources = require('../config/sources');

const CATEGORY = 'industry';

async function scrape() {
  const config = sources[CATEGORY] || [];
  const articles = [];

  for (const source of config) {
    try {
      const items = await base.fetchRSS(source.url, source.keywords);
      for (const item of items) {
        const article = base.buildArticleObject(item, CATEGORY, source.name);
        article.region = 'Global';
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
