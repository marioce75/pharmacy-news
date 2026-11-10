'use strict';
// Public projection of a published (approved) article. Only these fields ever leave the
// server through public pages or the public JSON API. Reviewer identities, approval records,
// scoring, ingestion state, internal notes and draft fields are never included.
const registry = require('../../config/source-registry');
const desks = require('./desks');

const httpsUrl = u => { try { const p = new URL(u); return p.protocol === 'https:' && !p.username && !p.password ? p.toString() : null; } catch { return null; } };
const day = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const list = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 20).map(x => x.slice(0, 80)) : []);

function summary(a) {
  const source = registry.find(s => s.id === a.provenance?.source_id) || null;
  const desk = desks.forArticle(a, source);
  return {
    id: a.id,
    slug: a.slug,
    title: text(a.title, 300),
    summary: text(a.summary, 1200),
    category: a.category || null,
    desk,
    desk_label: desks.DESKS[desk].label,
    source: text(a.source, 160),
    source_url: httpsUrl(a.source_url),
    date_published: day(a.provenance?.published_at) || day(a.date_published),
    retrieved_at: a.provenance?.retrieved_at || a.date_scraped || null,
    reviewed_at: a.review?.reviewed_at || null,
    content_kind: a.content_kind || null,
    region: text(a.region, 80) || null,
    tags: list(a.tags),
    image: typeof a.image === 'string' && (a.image.startsWith('/') || httpsUrl(a.image)) ? a.image : null,
    status: 'reviewed_summary'
  };
}

// The article page additionally shows the reviewed body and public provenance.
function detail(a, sanitize) {
  return {
    ...summary(a),
    body_html: sanitize(a.body || ''),
    evidence_type: text(a.evidence?.type, 60) || null,
    rights_attribution: text(a.rights?.attribution, 200) || null,
    jurisdiction: Array.isArray(a.geography?.jurisdiction) ? list(a.geography.jurisdiction) : [],
    correction_note: text(a.correction_reason, 400) || null
  };
}

module.exports = { summary, detail, httpsUrl };
