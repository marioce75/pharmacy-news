// Worldwide peptide clinical trials feed via ClinicalTrials.gov v2 API
// (free, no key). Returns article objects in the same shape as the RSS
// scrapers so they flow through the existing dedup + store pipeline.

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const slugify = require('slugify');
const { sleep } = require('./base-scraper');
const { getCategoryInfo } = require('../config/categories');

const API = 'https://clinicaltrials.gov/api/v2/studies';
const UA = { 'User-Agent': 'PharmacyNews/1.0 (Dosys Health; news aggregator)' };

const QUERIES = [
  { name: 'peptide-recruiting',     query: { 'query.intr': 'peptide',        'filter.overallStatus': 'RECRUITING' } },
  { name: 'glp1-recruiting',        query: { 'query.intr': 'GLP-1 OR semaglutide OR tirzepatide', 'filter.overallStatus': 'RECRUITING' } },
  { name: 'peptide-active',         query: { 'query.intr': 'peptide',        'filter.overallStatus': 'ACTIVE_NOT_RECRUITING' } },
  { name: 'longevity-peptide',      query: { 'query.intr': 'BPC-157 OR thymosin OR sermorelin OR ipamorelin' } }
];

const PAGE_SIZE = 8;

async function fetchOne(query) {
  const params = {
    pageSize: PAGE_SIZE,
    sort: 'LastUpdatePostDate:desc',
    format: 'json',
    ...query
  };
  const { data } = await axios.get(API, { params, headers: UA, timeout: 15000 });
  return (data && data.studies) || [];
}

function buildArticle(study) {
  const ps = study.protocolSection || {};
  const id = (ps.identificationModule && ps.identificationModule.nctId) || uuidv4();
  const titleRaw = (ps.identificationModule && (ps.identificationModule.briefTitle || ps.identificationModule.officialTitle)) || '';
  const title = titleRaw.slice(0, 200);
  if (!title) return null;

  const summary = (ps.descriptionModule && ps.descriptionModule.briefSummary) || '';
  const status = (ps.statusModule && ps.statusModule.overallStatus) || 'UNKNOWN';
  const phases = (ps.designModule && ps.designModule.phases) || [];
  const conditions = (ps.conditionsModule && ps.conditionsModule.conditions) || [];
  const interventions = (ps.armsInterventionsModule && ps.armsInterventionsModule.interventions) || [];
  const sponsor = ps.sponsorCollaboratorsModule && ps.sponsorCollaboratorsModule.leadSponsor && ps.sponsorCollaboratorsModule.leadSponsor.name;
  const lastUpdate = (ps.statusModule && ps.statusModule.lastUpdatePostDateStruct && ps.statusModule.lastUpdatePostDateStruct.date) || new Date().toISOString().slice(0, 10);
  const startDate = (ps.statusModule && ps.statusModule.startDateStruct && ps.statusModule.startDateStruct.date) || lastUpdate;

  const drugNames = interventions
    .filter((i) => i.type === 'DRUG' || i.type === 'BIOLOGICAL')
    .map((i) => i.name)
    .filter(Boolean)
    .slice(0, 6);

  const summaryShort = summary.replace(/\s+/g, ' ').slice(0, 500);
  const headline = phases.length ? `[${phases.join('/')}] ${title}` : title;

  const slug = slugify(`${id}-${title}`, { lower: true, strict: true }).slice(0, 80);
  const category = 'trials-ongoing';
  const catInfo = getCategoryInfo(category);

  return {
    id: uuidv4(),
    slug,
    title: headline,
    summary: summaryShort,
    body: '',
    source: `ClinicalTrials.gov — ${sponsor || 'NIH'}`,
    source_url: `https://clinicaltrials.gov/study/${id}`,
    category,
    region: catInfo.region || 'Global',
    date_published: parseDate(startDate),
    date_scraped: new Date().toISOString(),
    status: 'pending',
    tags: ['clinicaltrials', 'trial', status.toLowerCase()],
    instagram_caption: '',
    image: '',
    image_prompt: `Clinical trial visualization: ${title}`,
    priority: 'medium',
    drug_names: drugNames,
    companies: sponsor ? [sponsor] : [],
    therapeutic_area: conditions[0] || '',
    nct_id: id,
    phases,
    conditions: conditions.slice(0, 5),
    trial_status: status
  };
}

function parseDate(s) {
  if (!s) return new Date().toISOString().slice(0, 10);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

async function fetchAll() {
  const articles = [];
  const seen = new Set();
  for (const { name, query } of QUERIES) {
    try {
      const studies = await fetchOne(query);
      for (const s of studies) {
        const a = buildArticle(s);
        if (!a) continue;
        if (seen.has(a.nct_id)) continue;
        seen.add(a.nct_id);
        articles.push(a);
      }
      await sleep(500);
    } catch (err) {
      console.error(`  [ct.gov] ${name} failed: ${err.message}`);
    }
  }
  return articles;
}

module.exports = { fetchAll };
