'use strict';
// Production entry point (`npm start`, and the Render start command).
//
// What happens on startup, in order:
//  1. The Node version is checked against package.json (exact match) — refuses otherwise.
//  2. Model calls and the antibiotic watcher are forced OFF regardless of environment.
//  3. Collection is OFF unless the service environment sets COLLECTION_PAUSED=false
//     explicitly. An unset or any other value means paused. (Before 2026-11-09 an unset
//     value meant "on"; the default is now the safe one.)
//  4. The persistent disk at ./content is verified to be a separate mounted filesystem and
//     the versioned store ./content/store-v1 is opened (created only if the disk is empty).
//     Unknown files at the disk root make startup refuse rather than guess.
//  5. A read-only integrity check of articles, approvals and history runs; any finding
//     refuses public startup. Nothing is seeded, imported, migrated or repaired here.
//  6. The web server binds 0.0.0.0. If collection is enabled, the hourly due-based schedule
//     starts and one bounded catch-up run is made 90 seconds later if the last successful
//     run is more than one tick old.
require('../scripts/check-runtime').checkRuntime();
const policy = require('../lib/collection/startup-policy');
const decided = policy.decide(process.env);
Object.assign(process.env, decided.env);
process.env.TZ = 'UTC';
const path = require('node:path');
const root = path.resolve(__dirname, '../content');
require('../lib/durable-init').initialize(root).then(async dir => {
  process.env.CONTENT_DIR = dir;
  const result = await require('./check-content-integrity').check();
  if (!result.ok) throw new Error('Content integrity check failed; refuse public startup');
  process.env.HOST = '0.0.0.0';
  process.env.PN_ENTRY = 'start-review';
  console.log('Durable review store ready; models disabled; collection ' + decided.summary);
  require('../server');
}).catch(e => { console.error('Review startup refused:', e.message); process.exitCode = 1; });
