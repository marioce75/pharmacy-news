const { getCategoryInfo } = require('../config/categories');

function generateCaption(article) {
  const cat = getCategoryInfo(article.category);
  const emoji = cat.emoji || '📰';

  // Build hashtags from tags, category, and drug names
  const hashtagParts = [
    '#PharmacyNews',
    '#PharmaceuticalIndustry'
  ];

  if (article.tags) {
    article.tags.forEach(t => {
      hashtagParts.push('#' + t.replace(/[\s'-]/g, ''));
    });
  }
  if (article.drug_names) {
    article.drug_names.forEach(d => {
      hashtagParts.push('#' + d.replace(/[\s'-]/g, ''));
    });
  }
  if (article.therapeutic_area) {
    hashtagParts.push('#' + article.therapeutic_area.replace(/[\s'-]/g, ''));
  }

  hashtagParts.push('#DosysHealth', '#Healthcare');

  // Deduplicate and limit
  const hashtags = [...new Set(hashtagParts)].slice(0, 20).join(' ');

  const caption = `${emoji} ${article.title}\n\n${article.summary}\n\nSource: ${article.source}\n\n${hashtags}`;

  // Instagram caption limit is 2200 characters
  return caption.slice(0, 2200);
}

module.exports = { generateCaption };
