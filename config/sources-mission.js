'use strict';
// Topic-specific research index sources that extend coverage beyond outbreaks and substance
// alerts to the rest of the pharmacy-news mission: antimicrobial resistance, AI in drug
// discovery, drug repurposing and autoimmune-disease therapy.
//
// All four use the public NCBI E-utilities search API (the same adapter and bounded, resumable
// day-window pagination as the existing `pubmed` source). Only bibliographic metadata is kept:
// PMID, title, dates and a link to PubMed. Abstracts and full text are never imported.
//
// These are *bounded samples of a literature index*, not complete coverage and not appraised
// evidence. Titles from them are listed publicly under a separate "research index" label and
// are never presented as official alerts or reviewed summaries.
const term = t => 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=' + encodeURIComponent(t) + '&retmode=json&sort=pub_date&retmax=10';
const base = {
  adapter: 'pubmed',
  languages: ['und'],
  jurisdictions: ['global'],
  topic: 'research',
  official: true, // U.S. National Library of Medicine index; the indexed papers are third-party research
  source_type: 'research',
  publisher_country: null,
  access: 'public_metadata',
  status: 'adapter_checked',
  freshness_hours: 72,
  poll_hours: 6,
  rights: {
    status: 'item_review_required',
    permitted_use: 'metadata_link_only',
    full_text: false,
    policy_url: 'https://www.nlm.nih.gov/databases/download/terms_and_conditions.html',
    policy: 'Bibliographic metadata and links only; abstracts and full text may be copyrighted by publishers and are not imported'
  },
  pagination: { page_size: 25, max_pages_per_run: 3, max_pages_per_scan: 400, max_queue: 2000, bootstrap_days: 2, overlap_days: 2 },
  coverage_note: 'Bounded resumable sample of a PubMed title search. Not exhaustive, not peer-review appraisal, and newly added records may lack indexing terms.'
};
module.exports = [
  { ...base, id: 'pubmed-amr', desk: 'amr', name: 'PubMed — antimicrobial resistance and stewardship (title search)',
    url: term('"antimicrobial resistance"[Title] OR "antibiotic resistance"[Title] OR "antimicrobial stewardship"[Title] OR "antibiotic consumption"[Title]') },
  { ...base, id: 'pubmed-ai-drug-discovery', desk: 'ai', name: 'PubMed — AI and machine learning in drug discovery (title search)',
    url: term('("artificial intelligence"[Title] OR "machine learning"[Title] OR "deep learning"[Title] OR "large language model"[Title]) AND ("drug discovery"[Title] OR "drug design"[Title] OR "drug development"[Title] OR pharmacy[Title] OR pharmacist[Title])') },
  { ...base, id: 'pubmed-repurposing', desk: 'repurposing', name: 'PubMed — drug repurposing and repositioning (title search)',
    url: term('"drug repurposing"[Title] OR "drug repositioning"[Title] OR repurposed[Title] OR repurposing[Title]') },
  { ...base, id: 'pubmed-autoimmune-trials', desk: 'autoimmune', name: 'PubMed — autoimmune disease treatment trials (title search)',
    url: term('(autoimmune[Title] OR "rheumatoid arthritis"[Title] OR "lupus"[Title] OR "multiple sclerosis"[Title] OR psoriasis[Title] OR "psoriatic arthritis"[Title] OR "inflammatory bowel disease"[Title] OR "ulcerative colitis"[Title] OR "Crohn"[Title]) AND (randomized[Title] OR randomised[Title] OR "phase 2"[Title] OR "phase 3"[Title] OR "phase II"[Title] OR "phase III"[Title] OR trial[Title])') }
];
