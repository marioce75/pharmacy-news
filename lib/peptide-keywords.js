// Curated keyword + drug-name lists used by the peptide tagger and the
// peptide-specific scrapers. Lower-case throughout for case-insensitive matching.
//
// Lanes:
//   A. Clinical/regulatory peptide drugs (FDA-approved, in pipeline)
//   B. Compounding & access (503A/503B, telehealth, shortages)
//   C. Editorial coverage of longevity/biohacking peptides — research news only,
//      not retail listings.

// FDA-approved or late-stage peptide drug INNs and brand names.
const APPROVED_PEPTIDE_DRUGS = [
  // GLP-1 / GIP / glucagon family
  'semaglutide', 'ozempic', 'wegovy', 'rybelsus',
  'tirzepatide', 'mounjaro', 'zepbound',
  'liraglutide', 'saxenda', 'victoza',
  'dulaglutide', 'trulicity',
  'exenatide', 'byetta', 'bydureon',
  'lixisenatide', 'adlyxin',
  'albiglutide', 'tanzeum',
  'retatrutide', 'survodutide', 'mazdutide',
  'danuglipron', 'orforglipron',
  'cagrilintide', 'cagrisema',
  'pramlintide', 'symlin',
  // Bone / parathyroid
  'teriparatide', 'forteo',
  'abaloparatide', 'tymlos',
  'calcitonin', 'miacalcin', 'fortical',
  // Gonadal / reproductive
  'leuprolide', 'lupron', 'eligard',
  'goserelin', 'zoladex',
  'triptorelin', 'trelstar',
  'degarelix', 'firmagon',
  'cetrorelix', 'cetrotide',
  'ganirelix', 'ganirelix acetate',
  'oxytocin', 'pitocin',
  'desmopressin', 'ddavp', 'nocdurna',
  'vasopressin', 'vasostrict',
  'bremelanotide', 'vyleesi',
  // Growth / IGF axis
  'somatropin', 'genotropin', 'humatrope', 'norditropin', 'omnitrope', 'saizen',
  'somapacitan', 'sogroya',
  'tesamorelin', 'egrifta',
  'mecasermin', 'increlex',
  // Somatostatin / acromegaly
  'octreotide', 'sandostatin',
  'lanreotide', 'somatuline',
  'pasireotide', 'signifor',
  // GI
  'linaclotide', 'linzess',
  'plecanatide', 'trulance',
  // Multiple sclerosis
  'glatiramer', 'copaxone', 'glatopa',
  // HIV
  'enfuvirtide', 'fuzeon',
  // Hereditary angioedema
  'icatibant', 'firazyr',
  'ecallantide', 'kalbitor',
  // Cardiovascular / coagulation
  'eptifibatide', 'integrilin',
  'bivalirudin', 'angiomax',
  // Pain
  'ziconotide', 'prialt',
  // Mineral metabolism
  'etelcalcetide', 'parsabiv',
  // Antibiotic peptides
  'colistin', 'polymyxin', 'daptomycin', 'cubicin',
  'vancomycin', 'teicoplanin',
  'gramicidin', 'bacitracin',
  // Oncology peptide-class
  'lutathera', 'lutetium dotatate', 'pluvicto',
  'abarelix', 'plenaxis',
  'thymalfasin', 'zadaxin',
  // Insulin analogs (peptide hormones — borderline; included)
  'insulin glargine', 'lantus', 'basaglar', 'toujeo',
  'insulin lispro', 'humalog',
  'insulin aspart', 'novolog', 'fiasp',
  'insulin degludec', 'tresiba',
  'insulin detemir', 'levemir',
  'insulin icodec'
];

// Class-level keywords (broad, can drive a "peptide therapeutic" tag even when
// no specific drug is named).
const PEPTIDE_CLASS_KEYWORDS = [
  'glp-1', 'glp1', 'glp-1 receptor agonist', 'glp-1ra', 'incretin',
  'gip/glp', 'gip-glp', 'dual agonist', 'triple agonist',
  'amylin analog', 'amylin agonist',
  'peptide therapeutic', 'peptide therapeutics',
  'peptide drug', 'peptide drugs',
  'peptide hormone', 'peptide hormones',
  'peptide vaccine', 'peptide vaccines',
  'antimicrobial peptide', 'amp peptide',
  'cyclic peptide', 'macrocyclic peptide',
  'lipopeptide',
  'somatostatin analog', 'somatostatin analogue',
  'gnrh agonist', 'gnrh antagonist', 'lhrh agonist',
  'pth analog', 'parathyroid hormone analog',
  'guanylate cyclase-c agonist',
  'oligopeptide', 'polypeptide therapeutic'
];

// Compounding / access keywords (lane B).
const COMPOUNDING_KEYWORDS = [
  'compounded semaglutide', 'compounded glp-1', 'compounded peptide',
  '503a', '503b', 'compounding pharmacy',
  'outsourcing facility',
  'mass compounding',
  'glp-1 shortage', 'semaglutide shortage', 'wegovy shortage', 'ozempic shortage',
  'tirzepatide shortage', 'mounjaro shortage'
];

// Longevity / biohacking peptides — used to flag editorial coverage of the
// research/regulatory landscape. NOT used to recommend or link to retailers.
const LONGEVITY_PEPTIDES = [
  'bpc-157', 'bpc 157', 'pentadecapeptide arg-bpc',
  'tb-500', 'tb 500', 'thymosin beta-4', 'thymosin beta 4',
  'cjc-1295', 'cjc 1295',
  'ipamorelin',
  'sermorelin',
  'ghrp-2', 'ghrp 2', 'ghrp-6', 'ghrp 6',
  'mod grf', 'modified grf',
  'epitalon', 'epithalon',
  'thymulin',
  'fragment 176-191', 'aod9604', 'aod 9604',
  'melanotan', 'melanotan ii', 'melanotan 2',
  'pt-141', 'pt 141',
  'kisspeptin',
  'follistatin',
  'humanin',
  'mots-c', 'mots c'
];

const LONGEVITY_KEYWORDS = [
  'peptide longevity', 'longevity peptide', 'anti-aging peptide',
  'peptide therapy aging', 'rejuvenation peptide',
  'senolytic peptide', 'senotherapeutic peptide',
  'biohacking peptide', 'research peptide',
  'peptide enforcement', 'fda warning peptide'
];

// Build a single flattened lookup table for fast matching.
function buildLookup() {
  const all = [
    ...APPROVED_PEPTIDE_DRUGS.map(t => ({ term: t.toLowerCase(), kind: 'drug' })),
    ...PEPTIDE_CLASS_KEYWORDS.map(t => ({ term: t.toLowerCase(), kind: 'class' })),
    ...COMPOUNDING_KEYWORDS.map(t => ({ term: t.toLowerCase(), kind: 'compounding' })),
    ...LONGEVITY_PEPTIDES.map(t => ({ term: t.toLowerCase(), kind: 'longevity-drug' })),
    ...LONGEVITY_KEYWORDS.map(t => ({ term: t.toLowerCase(), kind: 'longevity' }))
  ];
  // Sort by length descending so multi-word terms match before substrings
  all.sort((a, b) => b.term.length - a.term.length);
  return all;
}

const LOOKUP = buildLookup();

module.exports = {
  APPROVED_PEPTIDE_DRUGS,
  PEPTIDE_CLASS_KEYWORDS,
  COMPOUNDING_KEYWORDS,
  LONGEVITY_PEPTIDES,
  LONGEVITY_KEYWORDS,
  LOOKUP
};
