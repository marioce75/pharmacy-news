// Read-only operational signals. Never sends notifications or changes scheduler state.
function evaluate({health={},last_run=null,now=Date.now(),newsEnabled=false}={}){
 const issues=[];const completed=Date.parse(last_run?.completed_at||'');
 if(newsEnabled&&(!Number.isFinite(completed)||now-completed>8*3600000))issues.push({kind:'collection_overdue',severity:'error',detail:'No completed collection within eight hours; six-hour schedule expected'});
 for(const [source_id,row]of Object.entries(health)){
  if(['failed','deferred','unavailable'].includes(row.status))issues.push({source_id,kind:'source_failure',severity:'warning',code:row.error_code||row.status});
  if(row.stale)issues.push({source_id,kind:'stale_reports',severity:'warning',latest_report_at:row.latest_report_at||null});
  if(row.date_anomalies)issues.push({source_id,kind:'source_date_anomalies',severity:'warning',count:row.date_anomalies});
  if(row.report_date_unknown)issues.push({source_id,kind:'unknown_report_dates',severity:'warning'});
  if(row.backlog||row.status==='incomplete')issues.push({source_id,kind:'incomplete_coverage',severity:'warning',queued:row.backlog||0});
 }
 return{checked_at:new Date(now).toISOString(),collection_schedule_enabled:newsEnabled,status:issues.some(x=>x.severity==='error')?'attention_required':issues.length?'degraded':newsEnabled?'ok':'disabled',issues,notification_delivery:'not_configured',publication:'human_exact_revision_approvals_required'};
}
async function report(){const s=await require('./collection/runner').status();return evaluate({...s,newsEnabled:['RUN_SCHEDULED_JOBS','RUN_NEWS_SCHEDULE','ALLOW_COLLECTION'].every(k=>process.env[k]==='true')});}
module.exports={evaluate,report};
