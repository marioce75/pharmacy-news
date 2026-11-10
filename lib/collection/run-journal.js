// Durable run journal: every collection run is written as "running" before any request and
// closed afterwards. A run still marked running after a restart was interrupted; scheduled
// slots with no run are reported as missed. Reporting only: nothing here retries or resumes.
const crypto=require('crypto'),os=require('os'),state=require('./state');
const KEEP=200,SLOT_GRACE_MS=90*60000,MAX_RUN_MS=30*60000;
async function read(){const j=await state.read('run-journal',{runs:[]});return Array.isArray(j.runs)?j:{runs:[]};}
async function save(j){j.runs=j.runs.slice(0,KEEP);await state.write('run-journal',j);}
async function start({trigger='manual',sources=[],limits={}}={},now=Date.now()){
 const j=await read();
 for(const r of j.runs)if(r.status==='running')Object.assign(r,{status:'interrupted',detected_at:new Date(now).toISOString(),note:'Process ended before this run was closed; per-source queues and checkpoints were preserved'});
 const run={run_id:crypto.randomUUID(),trigger,status:'running',started_at:new Date(now).toISOString(),host:os.hostname(),pid:process.pid,sources:sources.map(s=>s.id||s),limits};
 j.runs.unshift(run);await save(j);return run.run_id;}
async function finish(runId,outcome,now=Date.now()){
 const j=await read(),r=j.runs.find(x=>x.run_id===runId);if(!r)return;
 Object.assign(r,{status:outcome.status||'failed',completed_at:new Date(now).toISOString(),duration_ms:now-Date.parse(r.started_at),new_records:outcome.newArticles||0,updated_records:outcome.updatedArticles||0,errors:outcome.errors||0,
  failed_sources:(outcome.sourceRuns||[]).filter(x=>['failed','deferred'].includes(x.status)).map(x=>({source_id:x.source_id,code:x.error_code||x.status})),error_code:outcome.error_code||null});
 await save(j);}
// Expected scheduled slots (UTC, every N hours) since the first scheduled run in the journal.
// `since` is the start of the current schedule epoch (see activateSchedule). With it, only
// slots after that moment are expected, so history written under a different cadence, or
// hours when collection was paused, are never reported as missed.
function missedSlots(runs,{everyHours=6,now=Date.now(),lookbackHours=48,since=null}={}){
 const cron=runs.filter(r=>r.trigger==='cron').map(r=>Date.parse(r.started_at)).filter(Number.isFinite);
 if(since!=null){const step=everyHours*3600000,grace=Math.min(SLOT_GRACE_MS,step/2),from=Math.max(since,now-lookbackHours*3600000),out=[];
  for(let slot=Math.floor(from/step)*step+step;slot+grace<=now;slot+=step)if(!cron.some(t=>t>=slot&&t<=slot+grace))out.push(new Date(slot).toISOString());return out;}
 if(!cron.length)return[];
 const step=everyHours*3600000,grace=Math.min(SLOT_GRACE_MS,step/2),first=Math.min(...cron),from=Math.max(first,now-lookbackHours*3600000),out=[];
 for(let slot=Math.ceil(from/step)*step;slot+grace<=now;slot+=step)if(!cron.some(t=>t>=slot&&t<=slot+grace))out.push(new Date(slot).toISOString());
 return out;}
// Records which schedule is in force and since when. A new epoch starts when the cadence or
// policy changes, or when collection is enabled after being off (or was never recorded, as on
// the first start after upgrading from the six-hour rotation). A restart with the same enabled
// schedule keeps the epoch, so real downtime is still reported. Run history is never rewritten.
async function activateSchedule({name,tickHours,enabled},now=Date.now()){
 const prev=await state.read('schedule-epoch',null),at=new Date(now).toISOString();
 const same=prev&&prev.name===name&&prev.tick_hours===tickHours&&prev.enabled===true&&enabled===true;
 const next=same?{...prev,last_started_at:at}:{name,tick_hours:tickHours,enabled:enabled===true,since:at,last_started_at:at,previous:prev?{name:prev.name,tick_hours:prev.tick_hours,enabled:prev.enabled,since:prev.since,ended_at:at}:null};
 await state.write('schedule-epoch',next);return next;}
async function inspect({now=Date.now(),scheduleEnabled=false,everyHours=6}={}){
 const {runs}=await read(),lock=await state.lockOwner(),epoch=await state.read('schedule-epoch',null);
 const interrupted=runs.filter(r=>r.status==='interrupted'||(r.status==='running'&&(now-Date.parse(r.started_at)>MAX_RUN_MS||!lock)));
 let consecutive=0;for(const r of runs){if(r.status==='running'||r.status==='idle')continue;if(['failed','interrupted'].includes(r.status))consecutive++;else break;}
 const last=runs.find(r=>r.status!=='running')||null,success=runs.find(r=>['success','incomplete','completed_with_errors'].includes(r.status))||null;
 const lockAge=lock?now-Date.parse(lock.started_at):null;
 return{last_run:last,last_completed_success_at:success?.completed_at||null,running:runs.find(r=>r.status==='running'&&now-Date.parse(r.started_at)<=MAX_RUN_MS)||null,interrupted:interrupted.slice(0,10),consecutive_failures:consecutive,
  schedule_epoch:epoch,missed_slots:!scheduleEnabled?[]:epoch?(epoch.enabled?missedSlots(runs,{everyHours:epoch.tick_hours,now,since:Date.parse(epoch.since)}):[]):missedSlots(runs,{everyHours,now}),lock:lock?{...lock,token:undefined,age_minutes:Math.round(lockAge/60000),stale:lockAge>MAX_RUN_MS}:null,recent:runs.slice(0,20)};}
module.exports={start,finish,inspect,missedSlots,activateSchedule,read,MAX_RUN_MS};
