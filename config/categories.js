const CATEGORIES = {
  'fda-approvals':     { label: 'FDA Approvals',               color: '#00d4aa', emoji: '🇺🇸', region: 'US' },
  'ema-approvals':     { label: 'EMA Approvals',               color: '#4A90D9', emoji: '🇪🇺', region: 'EU' },
  'apac-approvals':    { label: 'APAC Approvals',              color: '#E8593C', emoji: '🌏', region: 'Asia' },
  'trials-ongoing':    { label: 'Clinical Trials — Ongoing',   color: '#A78BFA', emoji: '🔬', region: 'Global' },
  'trials-results':    { label: 'Clinical Trials — Results',   color: '#7C3AED', emoji: '📊', region: 'Global' },
  'drug-safety':       { label: 'Drug Safety',                 color: '#EF4444', emoji: '⚠️', region: 'Global' },
  'industry':          { label: 'Industry News',               color: '#F59E0B', emoji: '💼', region: 'Global' },
  'disease-research':  { label: 'Disease Research',            color: '#10B981', emoji: '🧬', region: 'Global' },
  'pharmacy-practice': { label: 'Pharmacy Practice',           color: '#06B6D4', emoji: '💊', region: 'Global' },
  'global-health':     { label: 'Global Health & Policy',      color: '#3B82F6', emoji: '🌍', region: 'Global' }
};

function getCategoryInfo(slug) {
  return CATEGORIES[slug] || { label: slug, color: '#888', emoji: '📰', region: 'Global' };
}

module.exports = { CATEGORIES, getCategoryInfo };
