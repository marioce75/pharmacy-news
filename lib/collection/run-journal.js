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
function missedSlots(runs,{everyHours=6,now=Date.now(),lookbackHours=48}={}){
 const cron=runs.filter(r=>r.trigger==='cron').map(r=>Date.parse(r.started_at)).filter(Number.isFinite);if(!cron.length)return[];
 const step=everyHours*3600000,first=Math.min(...cron),from=Math.max(first,now-lookbackHours*3600000),out=[];
 for(let slot=Math.ceil(from/step)*step;slot+SLOT_GRACE_MS<=now;slot+=step)if(!cron.some(t=>t>=slot&&t<=slot+SLOT_GRACE_MS))out.push(new Date(slot).toISOString());
 return out;}
async function inspect({now=Date.now(),scheduleEnabled=false,everyHours=6}={}){
 const {runs}=await read(),lock=await state.lockOwner();
 const interrupted=runs.filter(r=>r.status==='interrupted'||(r.status==='running'&&(now-Date.parse(r.started_at)>MAX_RUN_MS||!lock)));
 let consecutive=0;for(const r of runs){if(r.status==='running')continue;if(['failed','interrupted'].includes(r.status))consecutive++;else break;}
 const last=runs.find(r=>r.status!=='running')||null,success=runs.find(r=>['success','incomplete','completed_with_errors'].includes(r.status))||null;
 const lockAge=lock?now-Date.parse(lock.started_at):null;
 return{last_run:last,last_completed_success_at:success?.completed_at||null,running:runs.find(r=>r.status==='running'&&now-Date.parse(r.started_at)<=MAX_RUN_MS)||null,interrupted:interrupted.slice(0,10),consecutive_failures:consecutive,
  missed_slots:scheduleEnabled?missedSlots(runs,{everyHours,now}):[],lock:lock?{...lock,token:undefined,age_minutes:Math.round(lockAge/60000),stale:lockAge>MAX_RUN_MS}:null,recent:runs.slice(0,20)};}
module.exports={start,finish,inspect,missedSlots,read,MAX_RUN_MS};
