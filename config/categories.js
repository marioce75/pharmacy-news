const CATEGORIES = {
  'fda-approvals':     { label: 'FDA Approvals',               color: '#f29a48', emoji: '🇺🇸', region: 'US' },
  'industry':          { label: 'Industry News',               color: '#F59E0B', emoji: '💼', region: 'Global' },
  'disease-research':  { label: 'Disease Research',            color: '#af83d5', emoji: '🧬', region: 'Global' },
  'pharmacy-practice': { label: 'Pharmacy Practice',           color: '#d0b4e8', emoji: '💊', region: 'Global' },
  'global-health':     { label: 'Global Health & Policy',      color: '#c296ed', emoji: '🌍', region: 'Global' }
};

function getCategoryInfo(slug) {
  return CATEGORIES[slug] || { label: slug, color: '#888', emoji: '📰', region: 'Global' };
}

module.exports = { CATEGORIES, getCategoryInfo };
