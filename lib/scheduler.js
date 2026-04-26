const cron = require('node-cron');
const scrapeLog = require('./scrape-log');

let isRunning = false;

async function runScrapeJob(trigger) {
  if (isRunning) {
    console.log(`[SCRAPE] ${trigger} run skipped — already running`);
    return { skipped: true };
  }
  isRunning = true;

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const entry = {
    run_at: startedAt,
    trigger,
    articles_found: 0,
    articles_selected: 0,
    duplicates: 0,
    errors: 0,
    duration_ms: 0,
    status: 'running',
    error_message: null,
    pharmeditor_scored: 0,
    pharmeditor_errors: 0,
    slate_generated: false
  };

  try {
    console.log(`[SCRAPE] ${trigger} run starting at ${startedAt}`);
    const scraper = require('../scrapers');
    const result = await scraper.runAll();

    entry.articles_found = (result.newArticles || 0) + (result.duplicates || 0);
    entry.articles_selected = result.newArticles || 0;
    entry.duplicates = result.duplicates || 0;
    entry.errors = result.errors || 0;
    entry.status = entry.errors > 0 ? 'completed_with_errors' : 'success';

    // scrapers/index.js already invokes pharmeditor.analyze on newIds
    // Surface its outcome by re-reading it here is awkward; instead we
    // check whether a slate was generated for today.
    try {
      const store = require('./store');
      const todayStr = new Date().toISOString().slice(0, 10);
      try {
        await store.readSlate(todayStr);
        entry.slate_generated = true;
      } catch {}
    } catch {}

    entry.pharmeditor_scored = result.newArticles || 0;
  } catch (err) {
    entry.status = 'failed';
    entry.error_message = err && err.message ? err.message : String(err);
    console.error(`[SCRAPE] ${trigger} run failed:`, entry.error_message);
  } finally {
    entry.duration_ms = Date.now() - startMs;
    try {
      await scrapeLog.append(entry);
    } catch (err) {
      console.error('[SCRAPE] Failed to write scrape log:', err.message);
    }
    isRunning = false;
    console.log(`[SCRAPE] ${trigger} run finished: ${entry.status} (${entry.articles_selected} new, ${entry.duplicates} dup, ${entry.errors} err) in ${entry.duration_ms}ms`);
  }

  return entry;
}

function startScheduledJobs() {
  // Daily at 10:00 UTC = 4 AM CST / 5 AM CDT — preserves existing schedule.
  cron.schedule('0 10 * * *', () => {
    runScrapeJob('cron').catch((err) => {
      console.error('[CRON] Scheduled scrape error:', err.message);
    });
  });
}

function triggerManualScrape() {
  return runScrapeJob('manual');
}

module.exports = { startScheduledJobs, triggerManualScrape, runScrapeJob };
