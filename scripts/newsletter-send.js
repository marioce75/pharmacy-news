#!/usr/bin/env node
'use strict';
// Sends one queued newsletter issue. This is the ONLY way newsletter email goes out;
// nothing in the application schedules it.
//
//   node scripts/newsletter-send.js 2026-11-09            show what would be sent, send nothing
//   node scripts/newsletter-send.js 2026-11-09 --confirm  send what is due now
//
// The issue must first be queued by an editor at /admin/newsletter. Run the script again
// later to retry failures (it only retries those whose waiting time has passed). Do not
// run two copies at the same time.

try { require('dotenv').config(); } catch { /* dotenv is optional here */ }
const newsletter = require('../lib/newsletter');

async function main(argv) {
  const day = argv.find(a => !a.startsWith('--'));
  const confirmed = argv.includes('--confirm');
  const unknown = argv.filter(a => a.startsWith('--') && a !== '--confirm');
  if (!day || !newsletter.validDay(day) || unknown.length) {
    console.error('Usage: node scripts/newsletter-send.js <YYYY-MM-DD> [--confirm]');
    return 2;
  }

  const cfg = newsletter.config();
  console.log(`Newsletter issue ${day}`);
  console.log(`  sending switch : ${cfg.sendingFlag ? 'on' : 'off'}`);
  console.log(`  transport      : ${cfg.transport}${cfg.transport === 'dry-run' ? ' (writes files, sends no email)' : ''}`);

  const outboxes = (await newsletter.listOutboxes()).filter(o => o.day === day);
  if (!outboxes.length) {
    console.error(`Not queued. An editor must queue the ${day} issue at /admin/newsletter first.`);
    return 1;
  }
  const o = outboxes[0];
  const issue = await newsletter.buildIssue(day);
  console.log(`  queued         : ${o.queued_at} by ${o.queued_by}`);
  console.log(`  subject        : ${issue ? issue.subject : '(edition no longer has available articles)'}`);
  console.log(`  items          : ${issue ? issue.items.length : 0}${issue && issue.unavailable ? ` (${issue.unavailable} left out)` : ''}`);
  console.log(`  recipients     : ${o.total} total | sent ${o.states.sent} | waiting ${o.states.pending} | retrying ${o.states.failed} | gave up ${o.states.gave_up} | skipped ${o.states.skipped}`);
  console.log(`  due now        : ${o.due}`);

  if (!cfg.sendingOpen) {
    console.error('Sending is not enabled: ' + cfg.sendingClosedReasons.join('; '));
    return 1;
  }
  if (!issue) { console.error('Nothing can be sent: the edition has no currently available articles.'); return 1; }
  if (!confirmed) {
    console.log(`\nNothing was sent. ${o.due} message(s) would be attempted. Add --confirm to send.`);
    return 0;
  }

  const result = await newsletter.processOutbox({ day });
  console.log(`\nDone via "${result.transport}": attempted ${result.attempted} | sent ${result.sent} | failed (will retry) ${result.failed} | gave up ${result.gave_up} | skipped ${result.skipped}`);
  for (const b of result.blocked) console.log(`  blocked: ${b.day} (${b.reason})`);
  const after = result.days[0];
  if (after) console.log(`  remaining: waiting ${after.states.pending} | retrying ${after.states.failed}`);
  return result.failed || result.gave_up || result.blocked.length ? 1 : 0;
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; }, e => {
  // Message only: never print a stack that could include message contents.
  console.error('Newsletter send stopped: ' + (e && e.message ? e.message : 'unexpected error'));
  process.exitCode = 1;
});
