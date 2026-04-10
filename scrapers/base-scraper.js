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
    date: item.pubDate || item.isoDate || new Date().toISOString()
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
        date: new Date().toISOString()
      });
    }
  });

  return items.slice(0, 20); // Limit per source
}

async function extractArticleBody(url) {
  try {
    await rateLimitDomain(url);
    const { data } = await httpClient.get(url);
    const $ = cheerio.load(data);

    // Remove unwanted elements
    $('script, style, nav, footer, header, .ad, .advertisement, .sidebar, .related').remove();

    // Try common article selectors
    const selectors = ['article', '[role="main"]', '.article-body', '.entry-content', '.post-content', 'main'];
    let body = '';
    for (const sel of selectors) {
      const el = $(sel).first();
      if (el.length) {
        body = el.html();
        break;
      }
    }

    if (!body) {
      // Fallback: try the largest text block
      body = $('body').html();
    }

    // Clean up the HTML
    const $body = cheerio.load(body || '');
    $body('script, style, img, iframe, video, .ad').remove();

    // Extract paragraphs
    const paragraphs = [];
    $body('p').each((i, el) => {
      const text = $body(el).text().trim();
      if (text.length > 30) {
        paragraphs.push(`<p>${text}</p>`);
      }
    });

    return paragraphs.slice(0, 15).join('\n');
  } catch {
    return '';
  }
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
  const datePublished = item.date ? new Date(item.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

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
    region: catInfo.region || 'Global',
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
