// Weekly Bugs & Drugs watcher.
// Scans FDA novel-drug-approvals + an antibiotic-relevant PubMed query, compares
// against the local drugs.json, and writes findings to content/bugs-drugs/watch-log.json.
// Designed to be safe (no live writes to drugs.json) — humans review the log entries.

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

const LOG_DIR = path.join(__dirname, '..', '..', 'content', 'bugs-drugs');
const LOG_FILE = path.join(LOG_DIR, 'watch-log.json');
const DRUGS_FILE = path.join(LOG_DIR, 'drugs.json');
const MAX_ENTRIES = 200;

// PubMed search terms suggesting a new antibiotic mention worth reviewing.
const PUBMED_QUERIES = [
  'novel antibiotic FDA approval',
  'multidrug resistant gram negative new antibiotic',
  'IDSA guideline update antimicrobial',
  'new beta-lactamase inhibitor combination'
];

async function readLog() {
  try {
    const raw = await fs.readFile(LOG_FILE, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function writeLog(entries) {
  await fs.mkdir(LOG_DIR, { recursive: true });
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  await fs.writeFile(LOG_FILE, JSON.stringify(entries, null, 2), 'utf8');
}

async function loadKnownDrugs() {
  const raw = await fs.readFile(DRUGS_FILE, 'utf8');
  const drugs = JSON.parse(raw);
  const names = new Set();
  for (const d of Object.values(drugs)) {
    if (d.generic) names.add(d.generic.toLowerCase());
    for (const b of (d.brand || [])) names.add(b.toLowerCase());
    if (d.slug) names.add(d.slug.toLowerCase());
  }
  return names;
}

async function pubmedSearch(query) {
  const search = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', {
    params: { db: 'pubmed', term: `${query} AND ("last 14 days"[PDat])`, retmax: 8, sort: 'date', retmode: 'json' },
    timeout: 10000
  });
  const ids = (search.data && search.data.esearchresult && search.data.esearchresult.idlist) || [];
  if (ids.length === 0) return [];
  const sum = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi', {
    params: { db: 'pubmed', id: ids.join(','), retmode: 'json' },
    timeout: 10000
  });
  const result = sum.data && sum.data.result;
  return ids.map(id => {
    const a = result && result[id];
    if (!a) return null;
    return { pmid: id, title: a.title || '', journal: a.fulljournalname || a.source || '', pubdate: a.pubdate || '', url: `https://pubmed.ncbi.nlm.nih.gov/${id}/` };
  }).filter(Boolean);
}

// FDA Drugs@FDA recent approvals via the openFDA drug/drugsfda endpoint.
// Filter for antibiotic-suggestive submission types or product names.
const ANTIBIOTIC_HINT_PATTERN = /(cillin|cef|carbapenem|penem|cycline|mycin|floxacin|oxazolid|azole|fungin|ampho|aztreonam|sulbactam|tazobactam|avibactam|durlobactam|relebactam|vaborbactam|ridocacin|antibiotic|antibacterial|antifungal|antimicrobial)/i;

async function fdaRecentApprovals() {
  // FDA "drugsatfda" via openFDA — search recent original NDA/BLA approvals.
  // This is a best-effort; the API can rate-limit unauthenticated requests.
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const url = `https://api.fda.gov/drug/drugsfda.json?search=submissions.submission_status_date:[${since}+TO+${today}]+AND+submissions.submission_type:ORIG&limit=50`;
    const res = await axios.get(url, { timeout: 12000 });
    const records = res.data && res.data.results ? res.data.results : [];
    const hits = [];
    for (const r of records) {
      const productNames = (r.products || []).map(p => p.brand_name || p.active_ingredients && p.active_ingredients.map(a => a.name).join(' / ')).filter(Boolean);
      const allText = productNames.join(' ');
      if (ANTIBIOTIC_HINT_PATTERN.test(allText)) {
        hits.push({
          application_number: r.application_number,
          sponsor: r.sponsor_name,
          products: productNames,
          submission_dates: (r.submissions || []).slice(0, 3).map(s => s.submission_status_date)
        });
      }
    }
    return hits;
  } catch (err) {
    return { error: err.message || 'openFDA query failed' };
  }
}

async function runWatch() {
  const startedAt = new Date().toISOString();
  const known = await loadKnownDrugs();
  const findings = { run_at: startedAt, new_or_unmatched_fda: [], pubmed_signals: [], errors: [] };

  // FDA scan
  try {
    const fdaHits = await fdaRecentApprovals();
    if (Array.isArray(fdaHits)) {
      for (const h of fdaHits) {
        const hay = (h.products.join(' ') + ' ' + (h.sponsor || '')).toLowerCase();
        const matchesKnown = [...known].some(name => hay.includes(name));
        if (!matchesKnown) findings.new_or_unmatched_fda.push(h);
      }
    } else if (fdaHits && fdaHits.error) {
      findings.errors.push(`openFDA: ${fdaHits.error}`);
    }
  } catch (err) {
    findings.errors.push(`fdaRecentApprovals: ${err.message}`);
  }

  // PubMed scan
  for (const q of PUBMED_QUERIES) {
    try {
      const articles = await pubmedSearch(q);
      if (articles.length) findings.pubmed_signals.push({ query: q, articles });
    } catch (err) {
      findings.errors.push(`pubmed "${q}": ${err.message}`);
    }
  }

  // Surface non-empty results to admin via the watch log.
  const total = findings.new_or_unmatched_fda.length + findings.pubmed_signals.length;
  findings.summary = total === 0
    ? 'No new antibiotic signals this run.'
    : `${findings.new_or_unmatched_fda.length} unmatched FDA approval(s), ${findings.pubmed_signals.length} PubMed signal cluster(s).`;

  const log = await readLog();
  log.unshift(findings);
  await writeLog(log);
  return findings;
}

module.exports = { runWatch };
