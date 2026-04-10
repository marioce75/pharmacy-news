const stringSimilarity = require('string-similarity');
const store = require('./store');

// Cache of existing article metadata for dedup checks
let cache = null;
let cacheTime = 0;
const CACHE_TTL = 60000; // 1 minute

async function loadAllMeta() {
  const now = Date.now();
  if (cache && (now - cacheTime) < CACHE_TTL) return cache;

  const [pending, approved, declined] = await Promise.all([
    store.listArticles('pending'),
    store.listArticles('approved'),
    store.listArticles('declined')
  ]);

  cache = [...pending, ...approved, ...declined].map(a => ({
    title: a.title,
    source_url: a.source_url
  }));
  cacheTime = now;
  return cache;
}

async function isDuplicate(article) {
  const existing = await loadAllMeta();

  // Check exact URL match
  if (article.source_url) {
    const urlMatch = existing.some(e => e.source_url && e.source_url === article.source_url);
    if (urlMatch) return true;
  }

  // Check title similarity
  if (article.title && existing.length > 0) {
    const titles = existing.map(e => e.title).filter(Boolean);
    if (titles.length > 0) {
      const best = stringSimilarity.findBestMatch(article.title, titles);
      if (best.bestMatch.rating > 0.85) return true;
    }
  }

  return false;
}

function clearCache() {
  cache = null;
  cacheTime = 0;
}

module.exports = { isDuplicate, clearCache };
