'use strict';
// Single place that decides what a production start may switch on. Pure function so the
// behaviour is unit-tested without starting a server.
const due = require('./due-schedule');

function decide(env = process.env) {
  // Collection runs only on an explicit opt-in; anything else (unset, "true", typos) is paused.
  const enabled = env.COLLECTION_PAUSED === 'false';
  const out = {
    ALLOW_MODEL_CALLS: 'false',
    RUN_ANTIBIOTIC_SCHEDULE: 'false',
    ALLOW_ANTIBIOTIC_WATCH: 'false',
    ALLOW_COLLECTION: String(enabled),
    RUN_SCHEDULED_JOBS: String(enabled),
    RUN_NEWS_SCHEDULE: String(enabled),
    NEWS_SOURCE_IDS: due.NAME
  };
  return {
    collection_enabled: enabled,
    env: out,
    summary: enabled
      ? `ENABLED: hourly due-based schedule (${due.NAME}), up to ${due.PER_RUN} sources per run, pending metadata only`
      : 'PAUSED (set COLLECTION_PAUSED=false in the service environment to enable)'
  };
}

module.exports = { decide };
