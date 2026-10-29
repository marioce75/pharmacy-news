// Operator recovery for collection state. `status` is read-only. `release-stale-lock --confirm`
// moves an abandoned run lock aside (never deletes it) after the safety checks in state.js.
// Queues, checkpoints and drafts are never reset by this script.
const [cmd='status',flag]=process.argv.slice(2);
(async()=>{
 const state=require('../lib/collection/state'),journal=require('../lib/collection/run-journal');
 if(cmd==='status'){
  const runs=await journal.inspect({}),health=await state.read('health',{}),queues={};
  for(const id of Object.keys(health)){const saved=await state.read('source-'+id,null);if(saved)queues[id]={queued:(saved.queue||[]).length,checkpoint:saved.listing&&!saved.listing.complete?'listing scan in progress':saved.scan&&!saved.scan.complete?'pagination scan in progress':null,sync_through:saved.sync_through||null,cursor:saved.cursor||null};}
  console.log(JSON.stringify({content_root:state.root(),lock:runs.lock,interrupted_runs:runs.interrupted.map(r=>({run_id:r.run_id,started_at:r.started_at,trigger:r.trigger})),consecutive_failures:runs.consecutive_failures,last_run:runs.last_run&&{status:runs.last_run.status,started_at:runs.last_run.started_at,completed_at:runs.last_run.completed_at},queues},null,2));
  return;}
 if(cmd==='release-stale-lock'){
  if(flag!=='--confirm')throw new Error('Add --confirm after checking that no collector process is running');
  const r=await state.releaseStaleLock();console.log(JSON.stringify(r,null,2));if(!r.released)process.exitCode=2;return;}
 throw new Error('Usage: collection-recover.js status | release-stale-lock --confirm');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
