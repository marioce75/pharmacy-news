'use strict';
// Local production-like preview. Safe by construction:
//  - binds 127.0.0.1 only;
//  - collection, schedules, model calls and the antibiotic watcher are forced OFF;
//  - newsletter sending, sponsor display and alert webhooks are forced OFF;
//  - uses its own store under .preview-store/ (git-ignored), never ./content and never a
//    path supplied from outside, so it cannot touch production data or a restored backup.
// Usage: npm run preview            (port 4010)
//        PORT=4020 npm run preview
require('../scripts/check-runtime').checkRuntime();
const path = require('node:path'), fs = require('node:fs');
for (const k of ['ALLOW_COLLECTION', 'RUN_SCHEDULED_JOBS', 'RUN_NEWS_SCHEDULE', 'ALLOW_MODEL_CALLS', 'RUN_ANTIBIOTIC_SCHEDULE', 'ALLOW_ANTIBIOTIC_WATCH', 'NEWSLETTER_SENDING_ENABLED', 'SPONSOR_DISPLAY_ENABLED']) process.env[k] = 'false';
for (const k of ['ALERT_WEBHOOK_URL', 'ANTHROPIC_API_KEY', 'NEWS_SOURCE_IDS']) delete process.env[k];
process.env.COLLECTION_PAUSED = 'true';
process.env.NODE_ENV = 'development';
process.env.TZ = 'UTC';
process.env.HOST = '127.0.0.1';
process.env.PORT = process.env.PORT || '4010';
const root = path.resolve(__dirname, '../.preview-store');
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
require('../lib/durable-init').initialize(root, { requireMount: false }).then(async dir => {
  process.env.CONTENT_DIR = dir;
  const result = await require('./check-content-integrity').check();
  if (!result.ok) throw new Error('Preview store failed its integrity check');
  process.env.PN_ENTRY = 'start-preview';
  console.log('Preview store:', dir, '— collection, models, sending and sponsor display are off');
  require('../server');
}).catch(e => { console.error('Preview startup refused:', e.message); process.exitCode = 1; });
