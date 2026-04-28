// Cross-cutting peptide tagger.
//
// Runs after an article is built (via buildArticleObject) and before it is
// stored. Inspects the article's title + summary against the curated keyword
// lists in peptide-keywords.js and, on match, mutates the article to:
//   - set is_peptide: true
//   - record the lane(s) it matched (clinical | compounding | longevity)
//   - append peptide-specific tags
//   - append matched drug names to drug_names (preserving existing entries)
//
// Non-matching articles are returned unchanged. The tagger is intentionally
// pure (no I/O) so it can run inline in the scrape pipeline.

const { LOOKUP } = require('./peptide-keywords');

function tagArticle(article) {
  if (!article) return article;
  const haystack = `${article.title || ''} ${article.summary || ''}`.toLowerCase();
  if (!haystack.trim()) return article;

  const matches = [];
  const seen = new Set();
  for (const entry of LOOKUP) {
    if (seen.has(entry.term)) continue;
    // Word-boundary check for short terms (3 chars or fewer would be too greedy)
    const term = entry.term;
    if (term.length < 4) {
      const re = new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}([^a-z0-9]|$)`, 'i');
      if (re.test(haystack)) {
        matches.push(entry);
        seen.add(term);
      }
    } else if (haystack.includes(term)) {
      matches.push(entry);
      seen.add(term);
    }
  }

  if (matches.length === 0) return article;

  // Determine lanes
  const lanes = new Set();
  const drugMatches = [];
  for (const m of matches) {
    if (m.kind === 'drug') {
      lanes.add('clinical');
      drugMatches.push(m.term);
    } else if (m.kind === 'class') {
      lanes.add('clinical');
    } else if (m.kind === 'compounding') {
      lanes.add('compounding');
    } else if (m.kind === 'longevity-drug') {
      lanes.add('longevity');
      drugMatches.push(m.term);
    } else if (m.kind === 'longevity') {
      lanes.add('longevity');
    }
  }

  article.is_peptide = true;
  article.peptide_lanes = Array.from(lanes);

  // Tags — use existing tags array, dedup, cap at 25
  const tagsToAdd = ['peptide', ...Array.from(lanes).map(l => `peptide-${l}`)];
  article.tags = dedupCap([...(article.tags || []), ...tagsToAdd], 25);

  // Drug names — preserve existing, append matched, dedup, cap at 12
  if (drugMatches.length) {
    article.drug_names = dedupCap([...(article.drug_names || []), ...drugMatches], 12);
  }

  return article;
}

function isPeptide(article) {
  return !!(article && article.is_peptide);
}

function dedupCap(arr, cap) {
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    if (!v) continue;
    const k = String(v).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { tagArticle, isPeptide };
