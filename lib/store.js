const fs = require('fs').promises;
const path = require('path');

const CONTENT_DIR = path.join(__dirname, '..', 'content');
const DIRS = {
  pending: path.join(CONTENT_DIR, 'pending'),
  approved: path.join(CONTENT_DIR, 'approved'),
  declined: path.join(CONTENT_DIR, 'declined'),
  slates: path.join(CONTENT_DIR, 'slates'),
  feedback: path.join(CONTENT_DIR, 'feedback')
};

async function ensureDirectories() {
  for (const dir of Object.values(DIRS)) {
    await fs.mkdir(dir, { recursive: true });
  }
}

function dirPath(status) {
  return DIRS[status] || DIRS.pending;
}

async function readArticle(status, id) {
  const filePath = path.join(dirPath(status), `${id}.json`);
  const data = await fs.readFile(filePath, 'utf8');
  return JSON.parse(data);
}

async function writeArticle(status, id, data) {
  const filePath = path.join(dirPath(status), `${id}.json`);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function deleteArticle(status, id) {
  const filePath = path.join(dirPath(status), `${id}.json`);
  await fs.unlink(filePath);
}

async function moveArticle(fromStatus, toStatus, id) {
  const article = await readArticle(fromStatus, id);
  article.status = toStatus;
  await writeArticle(toStatus, id, article);
  await deleteArticle(fromStatus, id);
  return article;
}

async function listArticles(status, options = {}) {
  const dir = dirPath(status);
  let files;
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }

  files = files.filter(f => f.endsWith('.json'));

  const articles = await Promise.all(
    files.map(async (f) => {
      try {
        const data = await fs.readFile(path.join(dir, f), 'utf8');
        return JSON.parse(data);
      } catch {
        return null;
      }
    })
  );

  let result = articles.filter(Boolean);

  // Filter by category
  if (options.category) {
    result = result.filter(a => a.category === options.category);
  }

  // Sort by date (newest first by default)
  const sortField = options.sortBy || 'date_published';
  const sortDir = options.sortDir === 'asc' ? 1 : -1;
  result.sort((a, b) => {
    const da = a[sortField] || '';
    const db = b[sortField] || '';
    return da < db ? sortDir : da > db ? -sortDir : 0;
  });

  // Pagination
  if (options.limit) {
    const offset = options.offset || 0;
    result = result.slice(offset, offset + options.limit);
  }

  return result;
}

async function findBySlug(status, slug) {
  const articles = await listArticles(status);
  return articles.find(a => a.slug === slug) || null;
}

async function articleExists(status, id) {
  try {
    await fs.access(path.join(dirPath(status), `${id}.json`));
    return true;
  } catch {
    return false;
  }
}

async function countByCategory(status) {
  const articles = await listArticles(status);
  const counts = {};
  for (const a of articles) {
    counts[a.category] = (counts[a.category] || 0) + 1;
  }
  return counts;
}

async function getStats() {
  const [pending, approved, declined] = await Promise.all([
    listArticles('pending'),
    listArticles('approved'),
    listArticles('declined')
  ]);

  const all = [...pending, ...approved, ...declined];

  // Count by category across all statuses
  const byCategory = {};
  for (const a of all) {
    if (!byCategory[a.category]) byCategory[a.category] = { pending: 0, approved: 0, declined: 0 };
    byCategory[a.category][a.status]++;
  }

  // Top sources
  const sourceCounts = {};
  for (const a of all) {
    sourceCounts[a.source] = (sourceCounts[a.source] || 0) + 1;
  }
  const topSources = Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([source, count]) => ({ source, count }));

  // Top therapeutic areas
  const areaCounts = {};
  for (const a of all) {
    if (a.therapeutic_area) {
      areaCounts[a.therapeutic_area] = (areaCounts[a.therapeutic_area] || 0) + 1;
    }
  }
  const topAreas = Object.entries(areaCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([area, count]) => ({ area, count }));

  // This week
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekStr = weekAgo.toISOString().slice(0, 10);
  const thisWeek = {
    scraped: all.filter(a => (a.date_scraped || '') >= weekStr).length,
    approved: approved.filter(a => (a.date_scraped || '') >= weekStr).length,
    declined: declined.filter(a => (a.date_scraped || '') >= weekStr).length
  };

  const totalReviewed = approved.length + declined.length;
  const approvalRate = totalReviewed > 0 ? approved.length / totalReviewed : 0;

  return {
    counts: { pending: pending.length, approved: approved.length, declined: declined.length },
    byCategory,
    topSources,
    topAreas,
    thisWeek,
    approvalRate
  };
}

// === Slate helpers ===
async function readSlate(dateStr) {
  const filePath = path.join(DIRS.slates, `${dateStr}.json`);
  const data = await fs.readFile(filePath, 'utf8');
  return JSON.parse(data);
}

async function writeSlate(dateStr, data) {
  const filePath = path.join(DIRS.slates, `${dateStr}.json`);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// === Feedback helpers ===
async function readFeedback(dateStr) {
  const filePath = path.join(DIRS.feedback, `${dateStr}.json`);
  const data = await fs.readFile(filePath, 'utf8');
  return JSON.parse(data);
}

async function appendFeedback(dateStr, entry) {
  const filePath = path.join(DIRS.feedback, `${dateStr}.json`);
  let entries = [];
  try {
    const data = await fs.readFile(filePath, 'utf8');
    entries = JSON.parse(data);
  } catch {
    // File doesn't exist yet
  }
  entries.push(entry);
  await fs.writeFile(filePath, JSON.stringify(entries, null, 2), 'utf8');
}

module.exports = {
  ensureDirectories,
  readArticle,
  writeArticle,
  deleteArticle,
  moveArticle,
  listArticles,
  findBySlug,
  articleExists,
  countByCategory,
  getStats,
  readSlate,
  writeSlate,
  readFeedback,
  appendFeedback,
  DIRS
};
