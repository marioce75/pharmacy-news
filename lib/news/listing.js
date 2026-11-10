'use strict';
// The public news index across every topic desk.
//
// Three kinds of row, always labelled and never mixed up:
//   reviewed_summary  – a published article that passed editorial, evidence, rights (and,
//                       where required, clinical) review. Shows an original summary.
//   official_title    – the title, issuer, date and link of a report from an official source,
//                       collected automatically. NOT reviewed or summarised by PharmacyNews.
//   research_index    – the title and link of a record from a literature index or trial
//                       registry (for example PubMed). A bibliographic listing only: not
//                       appraised, not an official alert, not a recommendation.
// Unreviewed rows carry no summary, no counts and no clinical content. Drafts in review
// (anything with an editorial summary or body) stay private until published.
const registry = require('../../config/source-registry');
const desks = require('./desks');
const publicArticle = require('./public-article');
const coverage = require('../collection/coverage');
const { WHO_REGIONS } = require('../../config/countries');

const WINDOW_DAYS = 90, DAY = 86400000, PAGE_SIZE = 40, CACHE_MS = 60000;
const KINDS = Object.freeze({
  reviewed_summary: 'Reviewed summary',
  official_title: 'Official title (unreviewed)',
  research_index: 'Research index title (unreviewed)'
});
const LABELS = Object.freeze({
  official_title: 'Unreviewed title from an official source. Not verified or summarised by PharmacyNews; read the linked source.',
  research_index: 'Bibliographic listing from a research index or trial registry. Not appraised by PharmacyNews; a listing is not a finding or a recommendation.',
  reviewed_summary: 'Original summary published after editorial, evidence and source-rights review.'
});
const RESEARCH_ADAPTERS = new Set(['pubmed', 'europe-pmc', 'trials']);

function eligibleSource(s) {
  return !!s && s.access === 'public_metadata' && s.adapter !== 'unavailable' && s.rights?.status !== 'prohibited' && s.rights?.full_text === false
    && s.data_kind !== 'animal_news' && s.data_kind !== 'measured_dataset' && !!desks.forSource(s);
}
function kindOf(s) {
  return s.official !== true || s.source_type === 'research' || s.source_type === 'media' || RESEARCH_ADAPTERS.has(s.adapter) ? 'research_index' : 'official_title';
}
function safeURL(u, s) {
  try {
    const x = new URL(u), hosts = [new URL(s.url).hostname, ...(s.link_hosts || []), ...(s.link_base ? [new URL(s.link_base).hostname] : []), ...(s.adapter === 'pubmed' ? ['pubmed.ncbi.nlm.nih.gov'] : []), ...(s.adapter === 'europe-pmc' ? ['europepmc.org'] : []), ...(s.adapter === 'fda-applications' ? ['www.accessdata.fda.gov'] : [])];
    return x.protocol === 'https:' && !x.username && !x.password && hosts.includes(x.hostname) ? x.toString() : null;
  } catch { return null; }
}
// A collector lead has no editorial text at all; anything else pending is a private draft.
function collectorLead(a) {
  return !!a?.ingestion && !!a.provenance?.source_id && !String(a.summary || '').trim() && !String(a.body || '').trim() && !a.treatment && !a.drug_event && !a.outbreak;
}

function titleRow(a, now) {
  const s = registry.find(x => x.id === a.provenance.source_id);
  if (!eligibleSource(s) || a.data_kind === 'animal_news') return null;
  const url = safeURL(a.source_url, s);
  if (!url) return null;
  const reported = Date.parse(a.provenance.published_at || a.provenance.source_updated_at || ''), retrieved = Date.parse(a.provenance.retrieved_at || '');
  const future = Number.isFinite(reported) && reported > now;
  const basis = Number.isFinite(reported) && !future ? reported : retrieved;
  if (!Number.isFinite(basis) || now - basis > WINDOW_DAYS * DAY) return null;
  const desk = desks.forSource(s), kind = kindOf(s);
  return {
    id: a.id, kind, kind_label: KINDS[kind], desk, desk_label: desks.DESKS[desk].label,
    title: String(a.title).slice(0, 300), source: s.issuer || s.name, source_id: s.id, source_url: url,
    date_published: Number.isFinite(reported) && !future ? new Date(reported).toISOString() : null,
    date_note: future ? 'Source date is later than retrieval; shown as unknown' : Number.isFinite(reported) ? null : 'Source gave no publication date',
    retrieved_at: Number.isFinite(retrieved) ? new Date(retrieved).toISOString() : null,
    language: a.language && a.language !== 'und' ? a.language : null,
    region: coverage.region(s), data_kind: a.data_kind || s.data_kind || 'news_metadata',
    source_revised: !!a.ingestion?.source_changed, sort: basis
  };
}
function reviewedRow(a) {
  const p = publicArticle.summary(a), basis = Date.parse(p.date_published || p.reviewed_at || p.retrieved_at || '');
  return { ...p, kind: 'reviewed_summary', kind_label: KINDS.reviewed_summary, region: null, date_published: p.date_published, sort: Number.isFinite(basis) ? basis : 0 };
}

let cache = null;
async function base(now) {
  const dir = process.env.CONTENT_DIR || '';
  if (cache && cache.dir === dir && now - cache.at < CACHE_MS && now >= cache.at) return cache.rows;
  const store = require('../store'), rows = [], seen = new Set();
  for (const a of await store.listArticles('approved')) {
    if (collectorLead(a)) { const r = titleRow(a, now); if (r && !seen.has(r.source_url)) { seen.add(r.source_url); rows.push(r); } }
    else rows.push(reviewedRow(a));
  }
  for (const a of await store.listArticles('pending')) {
    if (!collectorLead(a)) continue; // private draft
    const r = titleRow(a, now);
    // One row per source URL even if two registry entries saw the same report.
    if (r && !seen.has(r.source_url)) { seen.add(r.source_url); rows.push(r); }
  }
  rows.sort((x, y) => y.sort - x.sort || String(x.id).localeCompare(String(y.id)));
  cache = { dir, at: now, rows };
  return rows;
}
function clearCache() { cache = null; }

function clean(q) { return typeof q === 'string' ? q.trim().toLowerCase().slice(0, 120) : ''; }

async function listing({ desk = '', kind = '', region = '', q = '', since = '', page = 1, pageSize = PAGE_SIZE, now = Date.now() } = {}) {
  const all = await base(now), query = clean(q);
  const f = {
    desk: desks.valid(desk) ? desk : '', kind: KINDS[kind] ? kind : '', region: region in WHO_REGIONS || region === 'GLOBAL' ? region : '',
    since: /^\d{4}-\d{2}-\d{2}$/.test(since) && Number.isFinite(Date.parse(since)) ? since : '', q: query
  };
  const sinceMs = f.since ? Date.parse(f.since) : null;
  const rows = all.filter(r => (!f.desk || r.desk === f.desk) && (!f.kind || r.kind === f.kind) && (!f.region || r.region === f.region)
    && (sinceMs == null || r.sort >= sinceMs) && (!query || [r.title, r.source, r.desk_label, r.summary || ''].join(' ').toLowerCase().includes(query)));
  const pages = Math.max(1, Math.ceil(rows.length / pageSize)), current = Math.min(pages, Math.max(1, Number.parseInt(page, 10) || 1));
  const counts = k => Object.fromEntries(Object.keys(k).map(key => [key, 0]));
  const byKind = counts(KINDS), byDesk = counts(desks.DESKS);
  for (const r of rows) byKind[r.kind]++;
  for (const r of all) byDesk[r.desk]++;
  const cov = await coverage.report({ now });
  return {
    generated_at: new Date(now).toISOString(), window_days: WINDOW_DAYS, filters: f, labels: LABELS, kinds: KINDS,
    statement: 'Aggregated from monitored public sources. Counts describe what these sources published and what was collected — not cases, incidence, prevalence, risk or the importance of a topic. Missing coverage is not zero.',
    collection: { schedule_enabled: cov.schedule_enabled, last_completed_at: cov.runs.last_completed_success_at, working_sources: cov.totals.working, tick_hours: cov.schedule.tickHours },
    totals: { matching: rows.length, all: all.length, by_kind: byKind, all_by_desk: byDesk },
    page: current, pages, page_size: pageSize,
    items: rows.slice((current - 1) * pageSize, current * pageSize).map(({ sort, ...r }) => r)
  };
}

module.exports = { listing, eligibleSource, kindOf, collectorLead, titleRow, clearCache, KINDS, LABELS, WINDOW_DAYS, PAGE_SIZE };
