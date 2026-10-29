const cron = require('node-cron');
const scrapeLog = require('./scrape-log');

let isRunning = false;
let scheduledTasks = [];
function collectionAllowed(){if(process.env.ALLOW_COLLECTION!=='true')throw Object.assign(new Error('Collection disabled'),{status:403});}

async function runScrapeJob(trigger) {
  collectionAllowed();
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
    const result = trigger==='cron'?await require('./collection/schedule-policy').run():await scraper.runAll();

    entry.articles_found = (result.newArticles || 0) + (result.duplicates || 0);
    entry.articles_selected = result.newArticles || 0;
    entry.duplicates = result.duplicates || 0;
    entry.errors = result.errors || 0;
    Object.assign(entry,{status:result.status, sourceRuns:result.sourceRuns, sourceErrors:result.sourceErrors, validationErrors:result.validationErrors, processingErrors:result.processingErrors, pharmeditor_scored:result.pharmeditor_scored, pharmeditor_errors:result.pharmeditor_errors, slate_generated:result.slate_generated});
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

async function runBugsDrugsWatch(trigger) {
  if(process.env.ALLOW_ANTIBIOTIC_WATCH!=='true')throw new Error('Antibiotic watch disabled');
  console.log(`[BD-WATCH] ${trigger} run starting`);
  try {
    const watcher = require('./bugsdrugs/watcher');
    const result = await watcher.runWatch();
    console.log(`[BD-WATCH] ${trigger} run finished: ${result.summary}`);
    return result;
  } catch (err) {
    console.error(`[BD-WATCH] ${trigger} run failed:`, err.message);
    return { error: err.message };
  }
}

function startScheduledJobs(cronClient=cron) {
 if(process.env.RUN_SCHEDULED_JOBS!=='true'||scheduledTasks.length)return scheduledTasks;
 if(process.env.RUN_NEWS_SCHEDULE==='true'&&process.env.ALLOW_COLLECTION==='true'){require('./collection/schedule-policy').select();scheduledTasks.push(cronClient.schedule('0 */6 * * *',()=>runScrapeJob('cron').catch(e=>console.error('[SCRAPE] Scheduled failure',e.code||e.name)),{timezone:'UTC'}));}
 if(process.env.RUN_ANTIBIOTIC_SCHEDULE==='true'&&process.env.ALLOW_ANTIBIOTIC_WATCH==='true')scheduledTasks.push(cronClient.schedule('0 11 * * 1',()=>runBugsDrugsWatch('cron').catch(()=>{}),{timezone:'UTC'}));
 return scheduledTasks;
}
function stopScheduledJobs(){scheduledTasks.forEach(t=>t.stop());scheduledTasks=[];}

function triggerManualScrape() {
  return runScrapeJob('manual');
}

function triggerManualBugsDrugsWatch() {
  return runBugsDrugsWatch('manual');
}

module.exports = { stopScheduledJobs, startScheduledJobs, triggerManualScrape, runScrapeJob, triggerManualBugsDrugsWatch, runBugsDrugsWatch };
