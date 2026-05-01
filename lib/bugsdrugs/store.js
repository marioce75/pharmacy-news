const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'content', 'bugs-drugs');

const cache = { organisms: null, syndromes: null, regimens: null, drugs: null, ts: 0 };
const TTL_MS = 60 * 1000;

async function readJson(name) {
  const p = path.join(DATA_DIR, `${name}.json`);
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw);
}

async function load() {
  if (cache.organisms && Date.now() - cache.ts < TTL_MS) return cache;
  const [organisms, syndromes, regimens, drugs] = await Promise.all([
    readJson('organisms'),
    readJson('syndromes'),
    readJson('regimens'),
    readJson('drugs')
  ]);
  cache.organisms = organisms;
  cache.syndromes = syndromes;
  cache.regimens = regimens;
  cache.drugs = drugs;
  cache.ts = Date.now();
  return cache;
}

async function getOrganism(slug) {
  const { organisms } = await load();
  return organisms.find(o => o.slug === slug) || null;
}

async function getSyndrome(slug) {
  const { syndromes } = await load();
  return syndromes.find(s => s.slug === slug) || null;
}

async function getDrug(slug) {
  const { drugs } = await load();
  return drugs[slug] || null;
}

async function getRegimensByKeys(keys = []) {
  const { regimens } = await load();
  return keys.map(k => ({ key: k, ...regimens[k] })).filter(r => r.title);
}

async function buildSearchIndex() {
  const { organisms, syndromes, drugs } = await load();
  const items = [];
  organisms.forEach(o => {
    items.push({
      kind: 'organism',
      slug: o.slug,
      label: o.name,
      sub: o.full_name || '',
      keywords: [o.name, o.full_name, ...(o.synonyms || [])].filter(Boolean).map(s => s.toLowerCase())
    });
  });
  syndromes.forEach(s => {
    items.push({
      kind: 'syndrome',
      slug: s.slug,
      label: s.name,
      sub: s.category || '',
      keywords: [s.name, ...(s.synonyms || [])].filter(Boolean).map(x => x.toLowerCase())
    });
  });
  Object.values(drugs).forEach(d => {
    items.push({
      kind: 'drug',
      slug: d.slug,
      label: d.generic,
      sub: d.class || '',
      keywords: [d.generic, ...(d.brand || [])].filter(Boolean).map(x => x.toLowerCase())
    });
  });
  return items;
}

function clearCache() {
  cache.organisms = null;
  cache.ts = 0;
}

module.exports = {
  load,
  getOrganism,
  getSyndrome,
  getDrug,
  getRegimensByKeys,
  buildSearchIndex,
  clearCache
};
