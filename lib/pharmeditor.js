const Anthropic = require('@anthropic-ai/sdk').default;
const store = require('./store');
const prompts = require('./pharmeditor-prompts');
const path = require('path');

const BATCH_SIZE = 6;
const MAX_CALLS_PER_MINUTE = 10;
const callTimestamps = [];
let isRunning = false;

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForRateLimit() {
  const now = Date.now();
  // Remove timestamps older than 60s
  while (callTimestamps.length && callTimestamps[0] < now - 60000) {
    callTimestamps.shift();
  }
  if (callTimestamps.length >= MAX_CALLS_PER_MINUTE) {
    const waitMs = 60000 - (now - callTimestamps[0]) + 100;
    console.log(`  [PHARMEDITOR] Rate limit — waiting ${Math.ceil(waitMs / 1000)}s`);
    await sleep(waitMs);
  }
  callTimestamps.push(Date.now());
}

function parseJSON(text) {
  // Try direct parse
  try {
    return JSON.parse(text);
  } catch {}

  // Try extracting JSON array from markdown fences or surrounding text
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try { return JSON.parse(arrayMatch[0]); } catch {}
  }

  // Try extracting JSON object
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}
  }

  return null;
}

async function scoreBatch(client, articles) {
  await waitForRateLimit();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    temperature: 0.3,
    system: prompts.SCORING_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: prompts.SCORING_USER_PROMPT(articles)
    }]
  });

  const text = response.content[0].text;
  const results = parseJSON(text);

  if (!results) {
    console.error('  [PHARMEDITOR] Failed to parse scoring response');
    return [];
  }

  // Normalize: ensure we have an array
  const arr = Array.isArray(results) ? results : [results];
  return arr;
}

function mergeEnrichment(article, enrichment) {
  if (!enrichment || enrichment.id !== article.id) return article;

  article.editorial_score = enrichment.editorial_score || 0;
  article.score_breakdown = enrichment.score_breakdown || {};
  article.editorial_reasoning = enrichment.editorial_reasoning || '';
  article.recommended_angle = enrichment.recommended_angle || '';
  article.headline_options = enrichment.headline_options || [];
  article.optimized_summary = enrichment.optimized_summary || '';
  article.best_posting_time = enrichment.best_posting_time || '';
  article.content_type_recommendation = enrichment.content_type_recommendation || '';
  article.follow_up_angle = enrichment.follow_up_angle || '';
  article.instagram_hook_options = enrichment.instagram_hook_options || [];

  // Overwrite caption if AI produced one
  if (enrichment.instagram_caption) {
    article.instagram_caption = enrichment.instagram_caption;
  }

  // Enrich empty fields
  if (enrichment.tags && enrichment.tags.length) article.tags = enrichment.tags;
  if (enrichment.drug_names && enrichment.drug_names.length) article.drug_names = enrichment.drug_names;
  if (enrichment.companies && enrichment.companies.length) article.companies = enrichment.companies;
  if (enrichment.therapeutic_area) article.therapeutic_area = enrichment.therapeutic_area;

  // Set priority based on score
  const score = article.editorial_score;
  article.priority = score >= 80 ? 'high' : score >= 40 ? 'medium' : 'low';

  return article;
}

async function analyze(articleIds) {
  if (isRunning) {
    console.log('[PHARMEDITOR] Already running, skipping');
    return { scored: 0, errors: 0, slateGenerated: false };
  }

  const client = getClient();
  if (!client) {
    console.warn('[PHARMEDITOR] No ANTHROPIC_API_KEY — skipping analysis');
    return { scored: 0, errors: 0, slateGenerated: false };
  }

  if (!articleIds || articleIds.length === 0) {
    console.log('[PHARMEDITOR] No articles to analyze');
    return { scored: 0, errors: 0, slateGenerated: false };
  }

  isRunning = true;
  let scored = 0;
  let errors = 0;

  try {
    console.log(`[PHARMEDITOR] Analyzing ${articleIds.length} articles...`);

    // Read all articles
    const articles = [];
    for (const id of articleIds) {
      try {
        const article = await store.readArticle('pending', id);
        articles.push(article);
      } catch {
        // Article may have been moved/deleted since scrape
      }
    }

    if (articles.length === 0) {
      console.log('[PHARMEDITOR] No readable articles found');
      return { scored: 0, errors: 0, slateGenerated: false };
    }

    // Process in batches
    for (let i = 0; i < articles.length; i += BATCH_SIZE) {
      const batch = articles.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(articles.length / BATCH_SIZE);

      try {
        console.log(`  [PHARMEDITOR] Scoring batch ${batchNum}/${totalBatches} (${batch.length} articles)...`);
        const results = await scoreBatch(client, batch);

        // Match results to articles by id
        for (const article of batch) {
          const enrichment = results.find(r => r.id === article.id);
          if (enrichment) {
            mergeEnrichment(article, enrichment);
            await store.writeArticle('pending', article.id, article);
            scored++;
          } else {
            console.warn(`  [PHARMEDITOR] No result for article ${article.id}`);
          }
        }
      } catch (err) {
        console.error(`  [PHARMEDITOR] Batch ${batchNum} failed: ${err.message}`);
        errors++;
      }
    }

    // Assign editorial_rank across all scored articles
    const allScored = articles
      .filter(a => typeof a.editorial_score === 'number')
      .sort((a, b) => b.editorial_score - a.editorial_score);

    for (let i = 0; i < allScored.length; i++) {
      allScored[i].editorial_rank = i + 1;
      await store.writeArticle('pending', allScored[i].id, allScored[i]);
    }

    // Generate daily slate
    let slateGenerated = false;
    if (allScored.length > 0) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        await generateSlate(client, today, allScored);
        slateGenerated = true;
      } catch (err) {
        console.error(`  [PHARMEDITOR] Slate generation failed: ${err.message}`);
      }
    }

    console.log(`[PHARMEDITOR] Complete: ${scored} scored, ${errors} errors, slate: ${slateGenerated}`);
    return { scored, errors, slateGenerated };

  } finally {
    isRunning = false;
  }
}

async function generateSlate(client, dateStr, scoredArticles) {
  console.log(`  [PHARMEDITOR] Generating daily slate for ${dateStr}...`);

  // Get feedback history for calibration
  let feedbackHistory = null;
  try {
    feedbackHistory = await getFeedbackHistory(30);
  } catch {}

  await waitForRateLimit();

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    temperature: 0.5,
    system: prompts.SLATE_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: prompts.SLATE_USER_PROMPT(scoredArticles, feedbackHistory)
    }]
  });

  const text = response.content[0].text;
  const slate = parseJSON(text);

  if (!slate) {
    throw new Error('Failed to parse slate response');
  }

  // Ensure required fields
  slate.date = dateStr;
  slate.total_scraped = slate.total_scraped || scoredArticles.length;
  slate.total_scored = slate.total_scored || scoredArticles.length;

  await store.writeSlate(dateStr, slate);
  console.log(`  [PHARMEDITOR] Slate saved: ${(slate.recommended_slate || []).length} recommended`);
}

async function recordFeedback(articleId, editorialScore, action) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const entry = {
      article_id: articleId,
      editorial_score: editorialScore || null,
      action,
      timestamp: new Date().toISOString()
    };
    await store.appendFeedback(today, entry);
  } catch (err) {
    console.error('[PHARMEDITOR] Failed to record feedback:', err.message);
  }
}

async function getFeedbackHistory(days = 30) {
  const entries = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    try {
      const dayFeedback = await store.readFeedback(dateStr);
      if (Array.isArray(dayFeedback)) {
        entries.push(...dayFeedback);
      }
    } catch {
      // No feedback for this day
    }
  }

  if (entries.length === 0) return null;

  // Aggregate by score decile
  const deciles = {};
  for (let d = 0; d < 10; d++) {
    const low = d * 10;
    const high = low + 10;
    const label = `${low}-${high}`;
    const inRange = entries.filter(e =>
      e.editorial_score !== null &&
      e.editorial_score >= low &&
      e.editorial_score < high
    );
    const approved = inRange.filter(e => e.action === 'approved').length;
    deciles[label] = {
      total: inRange.length,
      approved,
      approval_rate: inRange.length > 0 ? (approved / inRange.length).toFixed(2) : null
    };
  }

  const totalReviewed = entries.length;
  const totalApproved = entries.filter(e => e.action === 'approved').length;

  return {
    period_days: days,
    total_reviewed: totalReviewed,
    overall_approval_rate: (totalApproved / totalReviewed).toFixed(2),
    by_score_decile: deciles
  };
}

module.exports = {
  analyze,
  generateSlate,
  recordFeedback,
  getFeedbackHistory
};
