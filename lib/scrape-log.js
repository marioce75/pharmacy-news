const fs = require('fs').promises;
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'content', 'logs');
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
  all.unshift(entry);
  if (all.length > MAX_ENTRIES) all.length = MAX_ENTRIES;
  await fs.writeFile(LOG_FILE, JSON.stringify(all, null, 2), 'utf8');
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
