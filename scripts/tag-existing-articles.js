// Retroactively run the peptide tagger across every stored article.
// Idempotent — safe to run repeatedly. Only writes back when something changed.
//
// Usage: node scripts/tag-existing-articles.js

const store = require('../lib/store');
const { tagArticle } = require('../lib/peptide-tagger');

async function tagDir(status) {
  const articles = await store.listArticles(status);
  let scanned = 0, tagged = 0, untouched = 0;
  for (const a of articles) {
    scanned++;
    const before = JSON.stringify({
      is_peptide: a.is_peptide || false,
      lanes: a.peptide_lanes || [],
      tags: a.tags || [],
      drug_names: a.drug_names || []
    });
    tagArticle(a);
    const after = JSON.stringify({
      is_peptide: a.is_peptide || false,
      lanes: a.peptide_lanes || [],
      tags: a.tags || [],
      drug_names: a.drug_names || []
    });
    if (before !== after) {
      await store.writeArticle(status, a.id, a);
      if (a.is_peptide) tagged++;
    } else {
      untouched++;
    }
  }
  return { scanned, tagged };
}

(async () => {
  let totalScanned = 0;
  let totalTagged = 0;
  for (const status of ['pending', 'approved', 'declined']) {
    const r = await tagDir(status);
    console.log(`${status.padEnd(10)} scanned=${r.scanned} now-tagged-as-peptide=${r.tagged}`);
    totalScanned += r.scanned;
    totalTagged += r.tagged;
  }
  console.log(`\nTotal: scanned ${totalScanned} articles, ${totalTagged} flagged as peptide.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
