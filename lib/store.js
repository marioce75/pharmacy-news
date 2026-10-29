const fs = require('fs').promises;
const path = require('path');
const { syncDirectory, ensureDirectory } = require('./fsync');

const CONTENT_DIR = process.env.CONTENT_DIR || path.join(__dirname, '..', 'content');
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
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid article ID');
  const filePath = path.join(dirPath(status), `${id}.json`);
  const data = await fs.readFile(filePath, 'utf8');
  return JSON.parse(data);
}

async function writeArticle(status, id, data, authorization) {
 if(status==='approved' && authorization!==require('./publication-capability'))throw Object.assign(new Error('Approved snapshots can only be written by publication service'),{status:403});
 return require('./article-lock')(id, async()=>{
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid article ID');
  const filePath = path.join(dirPath(status), `${id}.json`);
  await ensureDirectory(path.dirname(filePath));
  const pub = require('./publication');
  const history = require('./history');
  data = await dropStaleApprovals(id, status, data, pub, history);
  try {
    const existing = JSON.parse(await fs.readFile(filePath,'utf8'));
    await history.snapshot(id,pub.revision(existing),pub.content(existing));
  } catch(e) { if(e.code!=='ENOENT')throw e; }
  await history.snapshot(id,pub.revision(data),pub.content(data));
  await durableReplace(filePath, JSON.stringify(data, null, 2));
 });
}

// Never carry an approval onto different content. Writers such as scoring or tagging
// change the revision without going through the editor, so drop and record here.
async function dropStaleApprovals(id, status, data, pub, history) {
 if (status === 'approved') return data;
 const kinds = Object.entries(require('./review-policy').APPROVALS), next = pub.revision(data);
 const stale = kinds.filter(([, d]) => data[d.field] && data[d.field].revision !== next);
 if (!stale.length) return data;
 const dropped = stale.map(([kind, d]) => ({ kind, reviewer: data[d.field].reviewer || null, revision: data[d.field].revision || null, event: data[d.field].event || null }));
 const previous = dropped.find(x => /^[a-f0-9]{64}$/.test(x.revision || ''))?.revision || next;
 await history.append(id, 'approvals_invalidated', 'storage-guard', previous, { reason: 'content_changed_outside_editor', next_revision: next, approvals: dropped });
 return { ...data, ...Object.fromEntries(stale.map(([, d]) => [d.field, null])) };
}

// Flush the temporary file before rename, then the directory after it, so a crash
// leaves either the old or the new complete record.
async function durableReplace(filePath, text) {
 const tmp = filePath + '.' + require('crypto').randomUUID() + '.tmp';
 const h = await fs.open(tmp, 'wx', 0o600);
 try { await h.writeFile(text, 'utf8'); await h.sync(); } catch (e) { await h.close().catch(()=>{}); await fs.unlink(tmp).catch(()=>{}); throw e; }
 await h.close();
 try { await fs.rename(tmp, filePath); } catch (e) { await fs.unlink(tmp).catch(()=>{}); throw e; }
 await syncDirectory(path.dirname(filePath));
}

async function deleteArticle(status, id) {
 return require('./article-lock')(id,async()=>{
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid article ID');
  const filePath = path.join(dirPath(status), `${id}.json`);
  await fs.unlink(filePath);
 });
}

async function moveArticle(fromStatus, toStatus, id) {
 return require('./article-lock')(id,async()=>{
  const article = await readArticle(fromStatus, id);
  article.status = toStatus;
  for (const field of ['review', 'clinical_review', 'evidence_review', 'rights_review']) article[field] = null;
  await writeArticle(toStatus, id, article);
  await deleteArticle(fromStatus, id);
  return article;
 });
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
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) return false;
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
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dateStr))throw new Error('Invalid date key');
  const filePath = path.join(DIRS.slates, `${dateStr}.json`);
  const data = await fs.readFile(filePath, 'utf8');
  return JSON.parse(data);
}

async function writeSlate(dateStr, data) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dateStr))throw new Error('Invalid date key');
  const filePath = path.join(DIRS.slates, `${dateStr}.json`);
  await ensureDirectory(path.dirname(filePath));
  await durableReplace(filePath, JSON.stringify(data, null, 2));
}

// === Feedback helpers ===
async function readFeedback(dateStr) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dateStr))throw new Error('Invalid date key');
  const filePath = path.join(DIRS.feedback, `${dateStr}.json`);
  const data = await fs.readFile(filePath, 'utf8');
  return JSON.parse(data);
}

async function appendFeedback(dateStr, entry) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dateStr))throw new Error('Invalid date key');
  const filePath = path.join(DIRS.feedback, `${dateStr}.json`);
  // Serialized read-modify-write; a corrupt file is an error rather than silently replaced.
  return require('./article-lock')('feedback-' + dateStr, async () => {
    let entries = [];
    try {
      entries = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    entries.push(entry);
    await ensureDirectory(path.dirname(filePath));
    await durableReplace(filePath, JSON.stringify(entries, null, 2));
  });
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
  durableReplace,
  countByCategory,
  getStats,
  readSlate,
  writeSlate,
  readFeedback,
  appendFeedback,
  DIRS
};
