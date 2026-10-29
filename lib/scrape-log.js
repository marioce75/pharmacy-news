const fs = require('fs').promises;
const path = require('path');

const LOG_DIR = path.join(process.env.CONTENT_DIR || path.join(__dirname, '..', 'content'), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'scrape-runs.json');
const MAX_ENTRIES = 500;

async function ensureDir() {
  await fs.mkdir(LOG_DIR, { recursive: true });
}

async function readAll() {
  try {
    const raw = await fs.readFile(LOG_FILE, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function append(entry) {
  await ensureDir();
  const all = await readAll();
  const lastSuccess={};
  for(const old of [...all].reverse())for(const run of old.sourceRuns||[])if(['success','empty'].includes(run.status))lastSuccess[run.source]=run.completed_at;
  for(const run of entry.sourceRuns||[]){run.last_success_at=run.last_success_at||(!['success','empty','not_modified'].includes(run.status)?(lastSuccess[run.source]||null):run.completed_at);}
  all.unshift(entry);
  if (all.length > MAX_ENTRIES) all.length = MAX_ENTRIES;
  await require('./store').durableReplace(LOG_FILE, JSON.stringify(all, null, 2));
}

async function listRecent(limit = 50) {
  const all = await readAll();
  return all.slice(0, limit);
}

async function getLastRun() {
  const all = await readAll();
  return all[0] || null;
}

module.exports = { append, listRecent, getLastRun };
