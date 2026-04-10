const base = require('./base-scraper');
const sources = require('../config/sources');

const CATEGORY = 'pharmacy-practice';

async function scrape() {
  const config = sources[CATEGORY] || [];
  const articles = [];

  for (const source of config) {
    try {
      let items = [];
      if (source.type === 'rss') {
        items = await base.fetchRSS(source.url, source.keywords);
      } else if (source.type === 'web') {
        items = await base.fetchWeb(source.url, source.selector);
      }

      for (const item of items) {
        const article = base.buildArticleObject(item, CATEGORY, source.name);
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
