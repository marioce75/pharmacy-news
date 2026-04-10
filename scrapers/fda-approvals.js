const base = require('./base-scraper');
const sources = require('../config/sources');

const CATEGORY = 'fda-approvals';

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
        article.therapeutic_area = inferTherapeuticArea(item.title + ' ' + item.summary);
        articles.push(article);
      }

      await base.sleep(2000);
    } catch (err) {
      console.error(`  [${CATEGORY}] ${source.name}: ${err.message}`);
    }
  }

  return articles;
}

function inferTherapeuticArea(text) {
  const lower = text.toLowerCase();
  const areas = {
    'oncology': ['cancer', 'tumor', 'oncolog', 'leukemia', 'lymphoma', 'carcinoma', 'melanoma'],
    'cardiology': ['heart', 'cardiac', 'cardiovascular', 'hypertension', 'cholesterol', 'atrial'],
    'endocrinology': ['diabetes', 'insulin', 'glp-1', 'thyroid', 'obesity', 'weight'],
    'neurology': ['alzheimer', 'parkinson', 'neurolog', 'migraine', 'seizure', 'epilep'],
    'infectious disease': ['antibiotic', 'antiviral', 'hiv', 'hepatitis', 'infection', 'mrsa', 'fungal'],
    'immunology': ['autoimmune', 'rheumatoid', 'psoriasis', 'lupus', 'immunolog'],
    'hematology': ['hemophilia', 'sickle cell', 'anemia', 'thrombocyt', 'blood'],
    'pulmonology': ['asthma', 'copd', 'pulmonary', 'lung', 'respiratory'],
    'gastroenterology': ['crohn', 'colitis', 'ibd', 'liver', 'hepatic', 'gi ']
  };
  for (const [area, keywords] of Object.entries(areas)) {
    if (keywords.some(kw => lower.includes(kw))) return area;
  }
  return '';
}

module.exports = { scrape };
