const RSSParser = require('rss-parser');
const axios = require('axios');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const slugify = require('slugify');
const { getCategoryInfo } = require('../config/categories');

const rssParser = new RSSParser({
  timeout: 15000,
  headers: { 'User-Agent': 'PharmacyNews/1.0 (Dosys Health; news aggregator)' }
});

const httpClient = axios.create({
  timeout: 15000,
  headers: { 'User-Agent': 'PharmacyNews/1.0 (Dosys Health; news aggregator)' }
});

// Rate limiting
const domainTimestamps = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function rateLimitDomain(url) {
  try {
    const domain = new URL(url).hostname;
    const last = domainTimestamps.get(domain) || 0;
    const elapsed = Date.now() - last;
    if (elapsed < 2000) {
      await sleep(2000 - elapsed);
    }
    domainTimestamps.set(domain, Date.now());
  } catch {
    // Invalid URL, skip rate limit
  }
}

async function fetchRSS(url, keywords) {
  await rateLimitDomain(url);
  const feed = await rssParser.parseURL(url);
  let items = (feed.items || []).map(item => ({
    title: (item.title || '').trim(),
    link: item.link || '',
    summary: (item.contentSnippet || item.content || '').trim().slice(0, 500),
    date: item.pubDate || item.isoDate || null,
    source_item_id: item.guid || item.id || item.link || null
  }));

  // Filter by keywords if provided
  if (keywords && keywords.length > 0) {
    items = items.filter(item => {
      const text = `${item.title} ${item.summary}`.toLowerCase();
      return keywords.some(kw => text.includes(kw.toLowerCase()));
    });
  }

  return items;
}

async function fetchWeb(url, selector) {
  await rateLimitDomain(url);
  const { data } = await httpClient.get(url);
  const $ = cheerio.load(data);
  const items = [];

  $(selector).each((i, el) => {
    const $el = $(el);
    const link = $el.find('a').first();
    const title = link.text().trim() || $el.find('h2, h3, h4').first().text().trim();
    let href = link.attr('href') || '';

    // Make relative URLs absolute
    if (href && !href.startsWith('http')) {
      const base = new URL(url);
      href = new URL(href, base.origin).toString();
    }

    if (title && href) {
      items.push({
        title,
        link: href,
        summary: $el.find('p, .summary, .description').first().text().trim().slice(0, 500),
        date: null
      });
    }
  });

  return items.slice(0, 20); // Limit per source
}

async function extractArticleBody(url) {
  // No source currently has approved full-text extraction rights. Fail closed, including direct calls.
  throw new Error('Source-body extraction disabled pending source-specific rights and access review');
}

function generateInstagramCaption(article) {
  const cat = getCategoryInfo(article.category);
  const emoji = cat.emoji || '📰';
  const tags = (article.tags || [])
    .map(t => '#' + t.replace(/[\s'-]/g, ''))
    .slice(0, 10);

  const hashtags = [
    '#PharmacyNews', '#PharmaceuticalIndustry',
    ...tags,
    '#DosysHealth', '#Healthcare'
  ].join(' ');

  return `${emoji} ${article.title}\n\n${article.summary}\n\nSource: ${article.source}\n\n${hashtags}`;
}

function buildArticleObject(item, category, sourceName) {
  const id = uuidv4();
  const slug = slugify(item.title, { lower: true, strict: true }).slice(0, 80);
  const parsedDate = item.date ? new Date(item.date) : null;
  const publicationDate = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null;
  const datePublished = publicationDate ? publicationDate.slice(0,10) : null;

  const catInfo = getCategoryInfo(category);

  const article = {
    id,
    slug,
    title: item.title,
    summary: item.summary || '',
    body: '',
    source: sourceName,
    source_url: item.link || '',
    category,
    region: 'Unknown',
    schema_version: 2,
    content_kind: 'unclassified',
    provenance: { source_id: sourceName, source_item_id: item.source_item_id || null, canonical_url: item.link || null, published_at: publicationDate, publication_date_status: !item.date ? 'missing' : publicationDate ? 'provided' : 'invalid', retrieved_at: new Date().toISOString(), event_at: null },
    geography: { publisher_country: null, jurisdiction: null, mentioned_places: [], study_locations: [], event_locations: [], confidence: 'unassessed' },
    rights: { status: 'unreviewed', license_url: null, attribution: sourceName, permitted_use: 'metadata_and_link_pending_review' },
    evidence: { type: 'unclassified', primary_source_url: null, guideline_version: null, review_status: 'unreviewed' },
    date_published: datePublished,
    date_scraped: new Date().toISOString(),
    status: 'pending',
    tags: [],
    instagram_caption: '',
    image: '',
    image_prompt: `News illustration for: ${item.title}`,
    priority: 'medium',
    drug_names: [],
    companies: [],
    therapeutic_area: ''
  };

  article.instagram_caption = generateInstagramCaption(article);
  return article;
}

module.exports = {
  fetchRSS,
  fetchWeb,
  extractArticleBody,
  buildArticleObject,
  generateInstagramCaption,
  sleep,
  rateLimitDomain
};
