// Feed health and coverage by WHO region. Read-only: it never collects, retries or notifies.
// "No reports" from a source or region is shown as a gap, never as an absence of events.
const registry=require('../../config/source-registry');
const {COUNTRIES,WHO_REGIONS}=require('../../config/countries');
const state=require('./state'),journal=require('./run-journal');
const STATEMENT='PharmacyNews aggregates monitored public sources. It is not comprehensive or real-time surveillance; no reports from a source or region does not mean there are no outbreaks or drug hazards.';
const ALIASES={'eu/eea':'EUR','eu':'EUR','who african region':'AFR','americas':'AMR','global':'GLOBAL','international':'GLOBAL'};
function region(s){if(s.who_region)return s.who_region;const out=new Set();for(const j of s.jurisdictions||[]){const k=String(j).toLowerCase();if(ALIASES[k]){out.add(ALIASES[k]);continue;}const c=COUNTRIES.find(c=>c.iso2===j);if(c)out.add(c.who_region);}
 return out.size===1?[...out][0]:out.size?'MULTI':'UNKNOWN';}
function streams(s){if(s.streams)return s.streams;if(['outbreak','official_assessment'].includes(s.topic))return['outbreak'];if(s.topic==='toxicology')return['substance'];if(s.topic==='animal_health')return['animal_context'];return['other'];}
const BLOCKED=new Set(['validation_blocked','prohibited','restricted','registration_required']);
function classify(s,h,now){
 if(BLOCKED.has(s.access))return'blocked';if(s.adapter==='unavailable')return'not_built';
 if(!h||!h.status)return s.validation?'checked_once_not_scheduled':'untested';
 const window=Math.max(48,2*(s.cadence_hours||24))*3600000,last=Date.parse(h.last_success_at||'');
 if(['failed','deferred'].includes(h.status))return'failing';
 if(!Number.isFinite(last)||now-last>window)return'not_recently_retrieved';
 return'working';}
function row(s,h={},now){
 const flags=[];if(h.stale)flags.push('latest_report_stale');if(h.date_anomalies)flags.push('future_or_invalid_dates');if(h.report_date_unknown)flags.push('report_dates_unknown');
 if(h.backlog||h.status==='incomplete')flags.push('incomplete_queue_or_scan');if(h.pagination?.duplicates_across_pages)flags.push('listing_shifted_during_scan');if(h.pagination?.filtered_out)flags.push('general_feed_filtered');
 return{id:s.id,name:s.name,issuer:s.issuer||s.name,who_region:region(s),streams:streams(s),source_type:s.source_type||(s.official?'official':'unknown'),languages:s.languages,endpoint:s.url,adapter:s.adapter,
  state:classify(s,h,now),access:s.access,reason:s.reason||null,last_attempt_at:h.completed_at||null,last_success_at:h.last_success_at||null,latest_report_at:h.latest_report_at||null,
  last_status:h.status||null,error_code:h.error_code||null,queued:h.backlog||0,flags,cadence_hours:s.cadence_hours||null,freshness_hours:s.freshness_hours||null,
  rights:{status:s.rights?.status||'unknown',permitted_use:s.rights?.permitted_use||'metadata_link_only',commercial_reuse:s.rights?.commercial_reuse||'unknown',full_text:false,policy_url:s.rights?.policy_url||null},
  verification:s.validation||null};}
async function report({now=Date.now(),scheduleEnabled=['RUN_SCHEDULED_JOBS','RUN_NEWS_SCHEDULE','ALLOW_COLLECTION'].every(k=>process.env[k]==='true')}={}){
 const health=await state.read('health',{}),rows=registry.map(s=>row(s,health[s.id],now)),runs=await journal.inspect({now,scheduleEnabled});
 const regions=[...Object.keys(WHO_REGIONS),'GLOBAL'].map(code=>{const r={code,name:WHO_REGIONS[code]||'Global and multi-region publishers'};
  for(const stream of ['outbreak','substance']){const mine=rows.filter(x=>x.who_region===code&&x.streams.includes(stream));const by=k=>mine.filter(x=>x.state===k).map(x=>x.id);
   r[stream]={working:by('working'),checked_once:by('checked_once_not_scheduled'),failing:[...by('failing'),...by('not_recently_retrieved')],blocked:by('blocked'),untested:[...by('untested'),...by('not_built')]};
   r[stream].gap=!r[stream].working.length?(r[stream].checked_once.length?'no_scheduled_source':'no_working_source'):null;}
  return r;});
 const issues=[];
 for(const x of rows){if(x.state==='failing')issues.push({severity:'warning',source_id:x.id,kind:'source_failing',code:x.error_code||x.last_status});
  if(x.state==='not_recently_retrieved')issues.push({severity:'warning',source_id:x.id,kind:'no_recent_successful_retrieval',last_success_at:x.last_success_at});
  for(const f of x.flags)issues.push({severity:'info',source_id:x.id,kind:f});}
 for(const r of runs.interrupted)issues.push({severity:'error',kind:'run_interrupted',run_id:r.run_id,started_at:r.started_at});
 for(const slot of runs.missed_slots)issues.push({severity:'error',kind:'scheduled_run_missed',slot});
 if(runs.lock?.stale)issues.push({severity:'error',kind:'stale_run_lock',age_minutes:runs.lock.age_minutes,recovery:'node scripts/collection-recover.js status'});
 if(runs.consecutive_failures>=2)issues.push({severity:'error',kind:'consecutive_run_failures',count:runs.consecutive_failures});
 for(const r of regions)for(const stream of ['outbreak','substance'])if(r.code!=='GLOBAL'&&r[stream].gap)issues.push({severity:'info',kind:'coverage_gap',who_region:r.code,stream,gap:r[stream].gap});
 return{generated_at:new Date(now).toISOString(),statement:STATEMENT,schedule_enabled:scheduleEnabled,notification_delivery:'not_configured',sources:rows,regions,runs,issues,
  totals:Object.fromEntries(['working','checked_once_not_scheduled','failing','not_recently_retrieved','blocked','untested','not_built'].map(k=>[k,rows.filter(x=>x.state===k).length]))};}
module.exports={report,region,streams,classify,row,STATEMENT};
