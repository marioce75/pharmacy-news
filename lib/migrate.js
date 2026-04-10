#!/usr/bin/env node
/**
 * One-time migration: converts hardcoded articles from js/articles.js
 * into JSON files in content/approved/
 */
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const store = require('./store');

// The 10 original articles, mapped to the new schema
const originalArticles = [
  {
    slug: 'fda-approves-glp1-weight-management',
    title: 'FDA Approves New GLP-1 Receptor Agonist for Weight Management',
    summary: 'The agency granted approval for a once-weekly injectable targeting obesity in adults with BMI ≥30, marking the fourth GLP-1 RA to enter the weight-loss market.',
    category: 'fda-approvals',
    source: 'FDA.gov',
    region: 'US',
    date_published: '2026-04-07',
    tags: ['GLP-1', 'obesity', 'weight management', 'surzetide'],
    drug_names: ['surzetide'],
    companies: [],
    therapeutic_area: 'endocrinology',
    priority: 'high'
  },
  {
    slug: 'phase-iii-novel-antibiotic-cre',
    title: 'Phase III Trial Shows Promise for Novel Antibiotic Against CRE Infections',
    summary: 'A carbapenem-resistant Enterobacterales-targeted cephalosporin achieved primary endpoints in a pivotal trial, with clinical cure rates of 72% vs. 52% for best available therapy.',
    category: 'trials-results',
    source: 'NEJM',
    region: 'Global',
    date_published: '2026-04-05',
    tags: ['CRE', 'antibiotic resistance', 'cephalosporin', 'infectious disease'],
    drug_names: ['cefiderocol-sulbactam'],
    companies: [],
    therapeutic_area: 'infectious disease',
    priority: 'high'
  },
  {
    slug: 'fda-safety-alert-sglt2-fournier-gangrene',
    title: "FDA Strengthens Warning on SGLT2 Inhibitors After New Fournier's Gangrene Cases",
    summary: 'Twelve additional cases of necrotizing fasciitis of the perineum have been reported, prompting the agency to require enhanced label warnings and a new patient medication guide.',
    category: 'drug-safety',
    source: 'FDA MedWatch',
    region: 'US',
    date_published: '2026-04-06',
    tags: ['SGLT2', 'drug safety', 'label change', 'diabetes'],
    drug_names: ['empagliflozin', 'canagliflozin', 'dapagliflozin', 'ertugliflozin'],
    companies: [],
    therapeutic_area: 'endocrinology',
    priority: 'high'
  },
  {
    slug: 'cms-pharmacist-part-b-coverage',
    title: 'CMS Proposes Expanded Part B Coverage for Pharmacist-Led Services',
    summary: 'The proposed rule would allow clinical pharmacists to bill directly for chronic disease management, medication therapy management, and transitions of care under Medicare Part B.',
    category: 'industry',
    source: 'CMS.gov',
    region: 'US',
    date_published: '2026-04-04',
    tags: ['CMS', 'pharmacist provider status', 'Medicare', 'reimbursement'],
    drug_names: [],
    companies: [],
    therapeutic_area: 'pharmacy practice',
    priority: 'high'
  },
  {
    slug: 'crispr-sickle-cell-two-year-followup',
    title: 'CRISPR Gene Therapy for Sickle Cell Disease Shows Durable Response at Two Years',
    summary: 'Long-term follow-up data from the pivotal exa-cel trial demonstrate sustained fetal hemoglobin production and freedom from vaso-occlusive crises in 94% of patients.',
    category: 'disease-research',
    source: 'Blood',
    region: 'Global',
    date_published: '2026-04-03',
    tags: ['CRISPR', 'sickle cell', 'gene therapy', 'exa-cel', 'Casgevy'],
    drug_names: ['exagamglogene autotemcel', 'Casgevy'],
    companies: ['Vertex Pharmaceuticals', 'CRISPR Therapeutics'],
    therapeutic_area: 'hematology',
    priority: 'high'
  },
  {
    slug: 'ai-dosing-software-hospital-pharmacies',
    title: 'AI-Guided Dosing Software Gains Traction in Hospital Pharmacies',
    summary: 'A growing number of health systems are adopting Bayesian dosing platforms for aminoglycosides and vancomycin, citing improved AUC target attainment and reduced nephrotoxicity.',
    category: 'industry',
    source: 'AJHP',
    region: 'US',
    date_published: '2026-04-02',
    tags: ['Bayesian dosing', 'vancomycin', 'clinical pharmacy', 'AI'],
    drug_names: ['vancomycin'],
    companies: ['DoseMeRx', 'InsightRx', 'Vancomyzer'],
    therapeutic_area: 'infectious disease',
    priority: 'medium'
  },
  {
    slug: 'who-essential-medicines-2026',
    title: 'WHO Updates Essential Medicines List With 26 New Additions',
    summary: 'The 2026 update adds treatments for drug-resistant tuberculosis, hepatitis D, and pediatric cancers. Several off-patent biologics also make the list for the first time.',
    category: 'global-health',
    source: 'WHO',
    region: 'Global',
    date_published: '2026-04-01',
    tags: ['WHO', 'essential medicines', 'drug access', 'global health'],
    drug_names: ['bulevirtide', 'pretomanid', 'bedaquiline', 'linezolid'],
    companies: [],
    therapeutic_area: 'global health',
    priority: 'medium'
  },
  {
    slug: 'fda-approves-bispecific-antibody-nsclc',
    title: 'FDA Grants Accelerated Approval to Bispecific Antibody for EGFR-Mutant NSCLC',
    summary: 'The first-in-class bispecific targeting EGFR and MET receives breakthrough designation for patients who progressed on osimertinib, addressing a critical unmet need in lung cancer.',
    category: 'fda-approvals',
    source: 'FDA.gov',
    region: 'US',
    date_published: '2026-03-30',
    tags: ['bispecific antibody', 'NSCLC', 'EGFR', 'MET', 'lung cancer'],
    drug_names: ['amivantamab', 'lazertinib'],
    companies: ['Janssen'],
    therapeutic_area: 'oncology',
    priority: 'high'
  },
  {
    slug: 'vancomycin-shortage-q3-2026',
    title: 'Drug Shortage Alert: IV Vancomycin Supply Disruption Expected Through Q3',
    summary: 'Two major manufacturers reported production delays affecting vancomycin injection supply. ASHP recommends therapeutic drug monitoring optimization and AUC-based dosing to conserve stock.',
    category: 'drug-safety',
    source: 'ASHP',
    region: 'US',
    date_published: '2026-04-03',
    tags: ['drug shortage', 'vancomycin', 'MRSA', 'supply chain'],
    drug_names: ['vancomycin'],
    companies: ['Pfizer', 'Fresenius Kabi', 'Hikma'],
    therapeutic_area: 'infectious disease',
    priority: 'high'
  },
  {
    slug: 'alzheimers-blood-test-phospho-tau',
    title: "Blood Test for Alzheimer's Achieves 92% Accuracy in Multi-Ethnic Validation Study",
    summary: 'A plasma phospho-tau 217 assay validated across diverse populations could replace costly PET scans and invasive lumbar punctures for Alzheimer\'s diagnosis.',
    category: 'disease-research',
    source: 'Nature Medicine',
    region: 'Global',
    date_published: '2026-03-28',
    tags: ['Alzheimer\'s', 'biomarker', 'p-tau217', 'diagnostics'],
    drug_names: [],
    companies: [],
    therapeutic_area: 'neurology',
    priority: 'high'
  }
];

// Image URLs from the original articles.js
const images = {
  'fda-approves-glp1-weight-management': 'https://images.unsplash.com/photo-1585435557343-3b092031a831?w=600&h=340&fit=crop',
  'phase-iii-novel-antibiotic-cre': 'https://images.unsplash.com/photo-1579165466741-7f35e4755660?w=600&h=340&fit=crop',
  'fda-safety-alert-sglt2-fournier-gangrene': 'https://images.unsplash.com/photo-1631549916768-4119b2e5f926?w=600&h=340&fit=crop',
  'cms-pharmacist-part-b-coverage': 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=600&h=340&fit=crop',
  'crispr-sickle-cell-two-year-followup': 'https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?w=600&h=340&fit=crop',
  'ai-dosing-software-hospital-pharmacies': 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&h=340&fit=crop',
  'who-essential-medicines-2026': 'https://images.unsplash.com/photo-1587854692152-cbe660dbde88?w=600&h=340&fit=crop',
  'fda-approves-bispecific-antibody-nsclc': 'https://images.unsplash.com/photo-1559757175-5700dde675bc?w=600&h=340&fit=crop',
  'vancomycin-shortage-q3-2026': 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=600&h=340&fit=crop',
  'alzheimers-blood-test-phospho-tau': 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=600&h=340&fit=crop'
};

// Body content from the original articles (loaded from js/articles.js)
// We'll read these from the existing file
const bodies = {};

async function loadBodies() {
  const content = await fs.readFile(path.join(__dirname, '..', 'js', 'articles.js'), 'utf8');
  // Extract body content for each article by slug
  const bodyRegex = /slug:\s*["']([^"']+)["'][\s\S]*?body:\s*`([\s\S]*?)`/g;
  let match;
  while ((match = bodyRegex.exec(content)) !== null) {
    bodies[match[1]] = match[2].trim();
  }
}

function generateInstagramCaption(article) {
  const { CATEGORIES } = require('../config/categories');
  const cat = CATEGORIES[article.category] || {};
  const emoji = cat.emoji || '📰';
  const hashtags = [
    '#PharmacyNews',
    '#PharmaceuticalIndustry',
    ...article.tags.map(t => '#' + t.replace(/[\s'-]/g, '')),
    '#DosysHealth'
  ].slice(0, 15).join(' ');

  return `${emoji} ${article.title}\n\n${article.summary}\n\nSource: ${article.source}\n\n${hashtags}`;
}

async function migrate() {
  await store.ensureDirectories();
  await loadBodies();

  let count = 0;
  for (const article of originalArticles) {
    const id = uuidv4();
    const full = {
      id,
      ...article,
      source_url: '',
      body: bodies[article.slug] || '<p>Article body not available.</p>',
      image: images[article.slug] || '',
      image_prompt: '',
      date_scraped: new Date().toISOString(),
      status: 'approved',
      instagram_caption: generateInstagramCaption(article)
    };

    await store.writeArticle('approved', id, full);
    count++;
    console.log(`  ✓ Migrated: ${article.title.slice(0, 60)}...`);
  }

  console.log(`\nMigration complete: ${count} articles written to content/approved/`);
}

if (require.main === module) {
  migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = { migrate };
