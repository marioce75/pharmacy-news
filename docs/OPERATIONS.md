# PharmacyNews.ai — operations guide

Written 2026-11-09 for branch `finish/platform-completion-20261109`. Nothing in this guide has
been executed against Render; the service was paused when this was written and the Render
dashboard settings could not be inspected from the development machine.

## 1. Start paths (what actually runs)

| Command | Use | Behaviour |
|---|---|---|
| `npm start` → `scripts/start-review.js` | Production (Render start command) | Checks Node 24.22.1; forces model calls and the antibiotic watcher off; **collection off unless `COLLECTION_PAUSED=false`**; requires `./content` to be a mounted disk; opens `./content/store-v1`; read-only integrity check (refuses to start on any finding); binds `0.0.0.0`. No seeding, import, migration or repair. |
| `npm run preview` → `scripts/start-preview.js` | Local production-like preview | Binds `127.0.0.1:4010`; collection, schedules, models, newsletter sending, sponsor display and alert webhooks forced off; uses `.preview-store/` (git-ignored). Cannot touch `./content`. |
| `node server.js` | Development only | In `NODE_ENV=production` it now **refuses to start** unless launched by `start-review.js`. Previously `render.yaml` used this command with the disk root as the content directory, which did not match the `store-v1` layout used by `npm start`. |
| `npm test` | Test suite | 220 tests; no network; temp directories only. |

`render.yaml` now uses `node scripts/start-review.js`, pins `NODE_VERSION=24.22.1`, sets
`COLLECTION_PAUSED="true"` and no longer sets `CONTENT_DIR` or the legacy flag variables.
A blueprint applies only if the service is synced from it — compare the dashboard first.

**Behaviour change to be aware of:** before this branch, an *unset* `COLLECTION_PAUSED` meant
collection ON. Now only the exact value `false` turns it on.

## 2. Scheduled collection (when enabled)

- Policy `schedule:due`: a tick at minute 7 of every hour (UTC). Each tick collects the sources
  whose own interval has elapsed, most overdue first, at most 20 per tick.
- 54 eligible sources: 11 hourly (RSS/Atom), 9 every 6 h (APIs), 3 every 12 h (HTML pages),
  31 daily (publishers with weekly-or-slower cadence). Needs ~14 polls per tick → 70 % of capacity.
- Budgets: 60 requests and 10 minutes per tick; 8 records per source and 60 per tick; 1,500
  requests and 800 records per UTC day; 120 requests per host per day (api.fda.gov 400,
  eutils.ncbi.nlm.nih.gov 300). Worst-case demand is ~480 requests/day.
- Failures back off 1 h, 2 h, 4 h … up to 24 h per source. Queues and scan checkpoints persist,
  so a restart resumes. 90 s after start, one catch-up run happens if the last successful run
  is more than an hour old. A lock left by a dead process is moved aside, never deleted.
- Everything collected is **pending metadata** (title, link, dates). Nothing is published
  automatically; unreviewed titles appear publicly only as labelled title-and-link listings.
- Blocked, restricted, prohibited and unbuilt sources are never requested.
- Limits: the old six-hour rotation (`rotation:worldwide`) is still supported by setting
  `NEWS_SOURCE_IDS` manually in development, but production always uses `schedule:due`.

## 3. Monitoring and alerts

- `/health` — liveness only.
- `/admin/monitoring` and `/admin/monitoring.json` — per-source state, last success, newest
  item date, stale/incomplete flags, interrupted runs, missed hourly slots, stale lock,
  consecutive failures, schedule capacity.
- `/api/admin/operations` — overall status (`ok` / `degraded` / `attention_required` / `disabled`).
- `/sources` — the public, honest version of the same coverage.
- Alerts: after every scheduled run, error-level issues are written to the alert log
  (`collection/alerts.json`). If `ALERT_WEBHOOK_URL` (https) is set, a short JSON summary is
  POSTed there (issue kinds and source IDs only; 6-hour cooldown per issue; failed deliveries
  retried). **No webhook is configured; choosing a destination is an owner decision.**
- `node scripts/collection-recover.js status` — read-only lock/queue report.

## 4. Backup and restore

The store is plain files under `content/store-v1`. Backups are offline copies with a SHA-256
manifest (`scripts/content-recovery.js`); sessions are excluded.

```
node scripts/content-recovery.js snapshot /abs/content/store-v1 /abs/new-backup-dir --writers-stopped
node scripts/content-recovery.js verify   /abs/new-backup-dir
node scripts/content-recovery.js restore  /abs/new-backup-dir /abs/new-empty-target --writers-stopped
```

- Stop the web service first (the flag is an attestation, not a lock). Targets must not exist.
- Drilled on 2026-11-09 on a disposable store (73 files): snapshot, verify, restore, identical
  `diff -r`, and a tampered file was detected. Not drilled on the Render disk.
- New private data now inside the store and therefore inside backups: `newsletter/`
  (subscriber emails, `secret.key`), `sponsors/` (business contacts), `clinical-tools/`
  (approvals, audit log). Treat backups as containing personal data.
- No recurring off-host backup exists. Render disk snapshots, if enabled on the plan, are a
  separate owner decision.

## 5. Limits of the one-process file store

- One web process owns the disk. Locks (article lock, collection run lock, the in-module
  queues in newsletter/sponsors/clinical-tools) are per process. **Do not scale to more than
  one instance or run a second writer** (including `scripts/newsletter-send.js` while a send
  is in progress elsewhere). Rate limits and login throttles are in memory and reset on restart.
- Public listings read the pending/approved directories; the news index caches for 60 s.
  This is adequate for thousands of records, not hundreds of thousands.
- A Render deploy restarts the process; in-flight collection is reported as interrupted and
  resumes from its checkpoints.

## 6. Safe activation on Render (do not run until approved)

1. **Back up first.** With the service still paused, confirm the existing off-host export
   (`pharmacynews-production-export-20261029`) is still the latest state, or take a new one.
2. **Compare settings** in the dashboard: Start Command must be `node scripts/start-review.js`
   (or `npm start`); Node 24.22.1; disk mounted at `/opt/render/project/src/content`; one
   instance; `SESSION_SECRET` (≥ 32 chars), `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` present.
3. **Set `COLLECTION_PAUSED=true` explicitly** before the first deploy of this branch.
4. Merge to `main` only after review, then resume/deploy. Expected log line:
   `Durable review store ready; models disabled; collection PAUSED …`.
5. Check `/health`, `/`, `/news`, `/sources`, `/tools`, `/admin/monitoring`. Existing pending
   drafts and history must be unchanged (startup never writes articles).
6. **To start collection:** set `COLLECTION_PAUSED=false` and restart. Within ~90 s a catch-up
   run starts; the first three hourly ticks reach every source once (cold start), then steady
   state. Watch `/admin/monitoring` for failing sources and missed slots.
7. **To stop collection:** set `COLLECTION_PAUSED=true` (or remove it) and restart.

Rollback: redeploy commit `1cd86fe` (previous `main`). Important: on `1cd86fe` an unset
`COLLECTION_PAUSED` means collection ON with the old six-hour rotation, so keep
`COLLECTION_PAUSED=true` set if you roll back and want it off. The disk is not touched by a
rollback; the new directories (`newsletter/`, `sponsors/`, `clinical-tools/`,
`collection/alerts.json`) are ignored by the old code. Never roll back to `7bccbf4`.

## 7. Feature flags (all default off)

| Variable | Effect when set |
|---|---|
| `COLLECTION_PAUSED=false` | Hourly due-based collection on |
| `PUBLIC_SITE_URL` (https) | Canonical links, sitemap, newsletter links |
| `ALERT_WEBHOOK_URL` (https) | Collection alerts delivered to that URL |
| `NEWSLETTER_SIGNUP_ENABLED`, `NEWSLETTER_SENDING_ENABLED`, `NEWSLETTER_TRANSPORT`, `NEWSLETTER_POSTAL_ADDRESS` | See docs/NEWSLETTER.md — no real email provider exists yet |
| `SPONSOR_SUBMISSIONS_ENABLED`, `SPONSOR_DISPLAY_ENABLED` | See docs/SPONSORSHIP.md |
| `REVIEWER_REGISTRY_FILE` | Per-person reviewer accounts incl. verified clinical reviewer |

## 8. Release-blocker corrections (2026-11-10, after review of 3e41396)

Each item was reproduced on `3e41396`, has a regression test in
`tests/release-blockers.test.js` (plus one in `tests/newsletter.test.js`) that fails there,
and passes now.

1. **Clinical approval digest.** The digest now includes a fingerprint of the full source of
   every file that can change a calculator result (`IMPLEMENTATION_FILES`, currently
   `lib/clinical/calculators.js`, which has no imports — a test fails if it gains one that is
   not listed). The fingerprint is taken at process start, i.e. of the code actually running.
   Changing a shared helper (rounding, parsing, bounds, display) invalidates approvals.
   Consequence: any edit to that file returns *all four* calculators to "awaiting clinical
   review". No approvals existed, so nothing was invalidated by this change.
2. **Zero displayed for a positive result.** Calculators return raw values; one `display`
   step rounds them. A positive result below one display unit is refused with an input error
   instead of being shown as 0 (or rounded up to the smallest unit). Infusion rates under
   1 mL/h show three decimals; rates under 0.01 mL/h are refused.
3. **90-day freshness.** One rule (`lib/news/freshness.js`): current for 90 days from the
   source publication date, or from the collection date when the source gave no usable date.
   The review date is never used. Applied to `/news`, `/news/:desk`, `/api/news`, the homepage
   stream, `/api/articles`, `/peptides`, the sitemap, `/edition/:day` and the newsletter issue.
   A reviewed story's own URL (`/article/:slug`, `/api/articles/:slug`) still resolves so
   links do not break, but is labelled **Archive**, marked `noindex`, and flagged
   `archived: true`. This last point is a product decision the owner can change to a 404/410.
4. **Schedule migration.** The journal records a schedule epoch
   (`collection/schedule-epoch.json`: policy, cadence, enabled, since). Missed-slot reporting
   only covers slots after the current epoch began. A new epoch starts when the cadence or
   policy changes, when collection is enabled after being off, or on the first start after
   upgrading. A restart with the same enabled schedule keeps the epoch, so real downtime is
   still reported. Run history is never rewritten.
5. **Idle runs and failures.** A run with nothing due, or in which nothing was retrieved, is
   recorded as `idle`: it does not count as a success, does not reset the consecutive-failure
   count, and does not overwrite the last real outcome. A source poll that made no retrieval
   keeps the earlier failure on record (`failure_carried_forward`); only a completed
   retrieval for that same source clears it.

**Correction to item 5 (2026-11-10, after retest of `9a970f8`).** The first fix only carried a
failure forward for the *same* source. A healthy source that merely drained an already-fetched
queue (zero HTTP requests) was still counted as a successful run, which reset the run-level
failure streak and overwrote the last failed outcome. Every request now goes through a
per-source wrapper that sets `attempted` (and counts `requests`); `retrieved` is set only when
a retrieval completes. A run is judged only on rows with a completed retrieval or a failed
attempt; with neither it is `idle`. Queue-only work never updates `last_success_at`, the
failure streak, `last_completed_success_at` or `last-run`. A real retrieval for any source ends
the run-level streak (the collector demonstrably works) but each source's own failure is
cleared only by that source's own retrieval. Regression tests: `tests/idle-recovery.test.js`.
Behaviour note: a mixed run where one source fails and the others are queue-only is now
`failed` (previously `completed_with_errors`).

Remaining limitations: `/api/admin/operations` can show `collection_overdue` for up to about
90 seconds after collection is re-enabled following a long pause, until the catch-up run
finishes (alerts are only evaluated after a run, so no alert is sent for it). Not run on
Linux x86-64. The archive behaviour in item 3 was verified by automated HTTP tests, not with
real published stories (none exist).

## 9. Security hotfix, 10 November 2026

Two defects in the clinical tool review routes were corrected. Regression tests: `tests/security-hotfix.test.js`.

1. **Calculator id validation.** The withdrawal route built a file path from the id in the address without checking it, so a signed-in editor could send an encoded traversal id and rewrite a JSON file outside the clinical-tools directory. Every id is now matched against the exact `CALCULATORS` list before a path is built or a file is read or written, in the library (`status`, `approve`, `withdraw`) and again in the routes before the password check. The approval file name is taken from the matched catalogue entry, never from the request.
2. **Review forms post.** The four approval forms and four withdrawal forms had no `method`, so with the page script disabled, blocked or failed a browser would submit them by GET with the password in the address. Each form now declares `method="post"` and its own action, and the routes accept that plain form post with the same gates (same-origin, sign-in, password re-entry, verified clinical credential, exact digest, three attestations).
3. **Access log.** Request logging goes through `lib/log-redaction.js`, which masks the value of credential-like query parameters (`password`, `token`, `secret`, `key`, `code`, `session`, `signature` and similar) and keeps method, path, parameter names, status and timing. Request bodies are not logged.

If the review page was ever submitted with the script not running before this fix, the password used is in that request's address and may be in Render's request logs and browser history; treat it as exposed.
