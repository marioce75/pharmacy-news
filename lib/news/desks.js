'use strict';
// Public topic desks. A desk is a reader-facing grouping; it never changes review status.
const DESKS = Object.freeze({
  approvals:   { label: 'Drug approvals & regulation', blurb: 'Regulator decisions, new medicines and regulatory news.' },
  safety:      { label: 'Drug safety, recalls & shortages', blurb: 'Safety communications, recalls and supply notices from regulators.' },
  infectious:  { label: 'Infectious diseases & outbreaks', blurb: 'Outbreak reports and risk assessments from public-health agencies.' },
  amr:         { label: 'Antimicrobial resistance & use', blurb: 'Resistance, stewardship and antimicrobial consumption.' },
  research:    { label: 'Clinical research & drug development', blurb: 'Research index and trial-registry listings.' },
  autoimmune:  { label: 'Autoimmune diseases', blurb: 'Treatment research in autoimmune and inflammatory disease.' },
  ai:          { label: 'AI in drug discovery & pharmacy', blurb: 'Artificial intelligence in drug discovery, development and practice.' },
  repurposing: { label: 'New uses for existing drugs', blurb: 'Drug repurposing and repositioning research.' },
  substances:  { label: 'Emerging substances & drug alerts', blurb: 'Drug early-warning notices, adulterants and scheduling actions. Not treatment guidance.' },
  guidance:    { label: 'Public-health guidance', blurb: 'Guidance documents published by official bodies.' },
  industry:    { label: 'Pharmaceutical industry & market', blurb: 'Industry and market developments.' },
  practice:    { label: 'Pharmacy practice', blurb: 'Practice news for pharmacists and pharmacy teams.' }
});

const BY_TOPIC = { regulation: 'approvals', safety: 'safety', outbreak: 'infectious', official_assessment: 'infectious', amr: 'amr', research: 'research', toxicology: 'substances', clinical: 'guidance' };
const BY_CATEGORY = { 'fda-approvals': 'approvals', industry: 'industry', 'disease-research': 'research', 'pharmacy-practice': 'practice', 'global-health': 'infectious' };

// Desk of a registry source: an explicit `desk` wins, otherwise it follows the source topic.
function forSource(s) {
  if (s?.desk && DESKS[s.desk]) return s.desk;
  return BY_TOPIC[s?.topic] || null;
}
// Desk of a reviewed article: its collecting source if known, otherwise its editorial category.
function forArticle(a, source) {
  return (source && forSource(source)) || BY_CATEGORY[a?.category] || 'research';
}
const valid = key => typeof key === 'string' && Object.prototype.hasOwnProperty.call(DESKS, key);

module.exports = { DESKS, forSource, forArticle, valid };
