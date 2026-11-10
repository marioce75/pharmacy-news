'use strict';
// The single freshness rule for everything presented as current news.
//
// An item is current for WINDOW_DAYS after its source publication date. When the source gave
// no usable date (missing, unparseable or in the future) the date it was collected is used.
// The review date is deliberately NOT used: reviewing an old story today does not make it new.
// The same rule applies to unreviewed titles and to reviewed summaries on every listing path
// (news index and API, homepage stream, article API list, peptide listing, sitemap, daily
// edition page, newsletter issue). A reviewed story's own page stays reachable so links do
// not break, but is labelled as archive and marked noindex once it leaves the window.
const WINDOW_DAYS = 90, DAY = 86400000;
function basis(a, now = Date.now()) {
  const published = Date.parse(a?.provenance?.published_at || a?.provenance?.source_updated_at || a?.date_published || '');
  if (Number.isFinite(published) && published <= now) return published;
  const collected = Date.parse(a?.provenance?.retrieved_at || a?.date_scraped || '');
  return Number.isFinite(collected) && collected <= now ? collected : null;
}
// No usable date at all means the item cannot be shown as current.
function current(a, now = Date.now()) { const b = basis(a, now); return b != null && now - b <= WINDOW_DAYS * DAY; }
module.exports = { WINDOW_DAYS, basis, current };
