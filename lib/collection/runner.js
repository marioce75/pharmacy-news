const pagination=require('./pagination');
const crypto=require('crypto'),state=require('./state'),{createClient}=require('./http'),adapters=require('./adapters');
const registry=require('../../config/source-registry'),store=require('../store'),pub=require('../publication');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const stamp=()=>new Date().toISOString();
const usableDate=(date,now)=>Number.isFinite(Date.parse(date))&&Date.parse(date)<=now;
function aggregateStatus(active,errors){if(!active.length)return 'unavailable';if(active.every(x=>['failed','deferred'].includes(x.status)))return 'failed';if(errors)return 'completed_with_errors';if(active.some(x=>['incomplete','backlog'].includes(x.status)))return 'incomplete';return 'success';}
function normalize(item){const {source_period,...revisionFields}=item;if(!item.external_id||!item.title?.trim()||!item.url)throw new Error('Missing source identity/title/link');return{external_id:String(item.external_id),source_family_id:item.source_family_id||null,identity_basis:item.identity_basis||null,title:item.title.trim().slice(0,500),url:item.url,published_at:item.published_at||null,updated_at:item.updated_at||null,publication_raw:item.publication_raw||null,study_start:item.study_start||null,trial_status:item.trial_status||null,indexed_at:item.indexed_at||null,data_kind:item.data_kind||null,source_period:item.source_period||null,source_hash:digest(revisionFields)};}
async function existing(id){for(const status of ['pending','approved','declined'])if(await store.articleExists(status,id))return store.readArticle(status,id);return null;}
async function accept(source,item){
 const id='source-'+digest([source.id,item.external_id]).slice(0,32),old=await existing(id);
 if(old?.ingestion?.source_hash===item.source_hash)return{status:'unchanged',id};
 const now=stamp(),cluster='cluster-'+digest(item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()).slice(0,24);
 const metadata={title:item.title,source:source.name,source_url:item.url,summary:'',body:'',content_kind:'unclassified',language:source.languages.length===1?source.languages[0]:'und',translation:{required:source.languages.length>1||source.languages.includes('und'),review_status:'not_requested'},rights:{...source.rights,attribution:source.name,license_url:null},evidence:{type:source.topic==='official_assessment'?'official_assessment':'unclassified',review_status:'unreviewed'},data_kind:item.data_kind||source.data_kind||'news_metadata',provenance:{source_id:source.id,source_period:item.source_period||source.observation_period||null,source_item_id:item.external_id,source_family_id:item.source_family_id||null,identity_basis:item.identity_basis||null,indexed_at:item.indexed_at||null,canonical_url:item.url,published_at:item.published_at,publication_raw:item.publication_raw,source_updated_at:item.updated_at,date_in_future:!!item.published_at&&Date.parse(item.published_at)>Date.now(),retrieved_at:now,event_at:null},geography:{publisher_country:source.publisher_country,jurisdiction:source.jurisdictions,mentioned_places:[],study_locations:[],event_locations:[],confidence:'unassessed'},ingestion:{source_hash:item.source_hash,source_id:source.id,requires_original_summary:true,cluster_id:cluster,cluster_method:'exact_normalized_title_candidate_not_verified',source_changed:!!old,previous_source_hash:old?.ingestion?.source_hash||null},editorial:{original_summary:false,translation_reviewed:false},date_published:item.published_at?.slice(0,10)||null,date_scraped:now,source_dates:{study_start:item.study_start,last_updated:item.updated_at},trial_status:item.trial_status,region:'Unknown',outbreak:null};
 if(old){await pub.edit(id,{...metadata,correction_reason:'Source metadata revision detected; original summary and evidence require renewed review'},pub.revision(old),'collector');return{status:'updated',id};}
 await store.writeArticle('pending',id,{id,slug:id,category:source.topic==='research'?'disease-research':'global-health',...metadata,status:'pending',tags:[],drug_names:[],companies:[]});return{status:'new',id};
}
async function run({sources=registry,client,now=Date.now(),maxItems=100,maxItemsPerSource=100,reconcile=false}={}){
 if(process.env.ALLOW_COLLECTION!=='true')throw Object.assign(new Error('Collection disabled'),{status:403});
 return state.exclusive(async()=>{
 const day=new Date(now).toISOString().slice(0,10);let budget=await state.read('budget',{day,requests:0,hosts:{},items:0});if(budget.day!==day)budget={day,requests:0,hosts:{},items:0};
 const get=client||createClient({budget,saveBudget:b=>state.write('budget',b)}),health=await state.read('health',{});const result={newArticles:0,updatedArticles:0,duplicates:0,errors:0,newIds:[],sourceRuns:[],pharmeditor_scored:0,pharmeditor_errors:0,slate_generated:false};let used=0;
 const rotation=await state.read('rotation',{offset:0});const offset=sources.length?rotation.offset%sources.length:0;const ordered=[...sources.slice(offset),...sources.slice(0,offset)];
 await state.write('rotation',{offset:sources.length?(offset+1)%sources.length:0});
 for(const source of ordered){
 const previous=health[source.id]||{},row={source:source.name,source_id:source.id,url:source.url,started_at:stamp(),last_success_at:previous.last_success_at||null,count:0,updated:0};
 if(source.adapter==='unavailable'||source.access!=='public_metadata'){Object.assign(row,{status:'unavailable',reason:source.reason});result.sourceRuns.push(row);continue;}
 const key='source-'+source.id;const saved=await state.read(key,{cursor:null,queue:[],etag:null,modified:null});
 try{
  // Legacy feed timestamps in the future must not advance the incremental watermark.
  for(const k of ['cursor','pending_cursor'])if(saved[k]&&!usableDate(saved[k],now)){saved[k]=null;row.cursor_repaired=true;}
  let items=saved.queue||[],truncated=false,notModified=false,retrieved=false,paging=null;const paged=pagination.enabled(source);
  if(paged){const scan=await pagination.collect({source,saved,get,normalize,now,reconcile,persist:s=>state.write(key,s),isKnown:async item=>!!await existing('source-'+digest([source.id,item.external_id]).slice(0,32)),isUnchanged:async item=>(await existing('source-'+digest([source.id,item.external_id]).slice(0,32)))?.ingestion?.source_hash===item.source_hash});paging=scan.view;items=saved.queue;retrieved=scan.retrieved;truncated=!paging.scan_complete;}
  else {
  if(!items.length||(source.adapter!=='trials'&&now-Date.parse(saved.fetched_at||'1970-01-01')>=6*3600000)){
   const headers={};if(source.adapter!=='pubmed'&&saved.etag)headers['If-None-Match']=saved.etag;if(source.adapter!=='pubmed'&&saved.modified)headers['If-Modified-Since']=saved.modified;
   let url=source.url;
   if(source.adapter==='trials'&&saved.cursor){const u=new URL(url);u.searchParams.set('filter.advanced','AREA[LastUpdatePostDate]RANGE['+new Date(Date.parse(saved.cursor)-72*3600000).toISOString().slice(0,10)+',MAX]');url=u.toString();}
   let response=await get(url,source,headers);retrieved=true;
   if(source.adapter==='pubmed'&&response.status!==304){const ids=JSON.parse(response.body).esearchresult?.idlist;if(!Array.isArray(ids)||ids.some(id=>!/^\d+$/.test(id)))throw new Error('Invalid PubMed search');response=ids.length?await get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id='+ids.join(','),source,{}):{status:200,headers:{},body:JSON.stringify({result:{uids:[]}})};}

   if(response.status===304){notModified=true;}else{
    const parsed=await adapters.parse(source,response.body);const incoming=parsed.items.map(normalize);if(items.length&&source.adapter!=='trials'){
     const fresh=[];for(const item of incoming){const known=await existing('source-'+digest([source.id,item.external_id]).slice(0,32));if(known?.ingestion?.source_hash!==item.source_hash)fresh.push(item);}
     const merged=new Map([...fresh,...items].map(x=>[x.external_id,x]));for(const item of fresh)merged.set(item.external_id,item);items=[...merged.values()];
    }else items=incoming;
    items.sort((a,b)=>(Date.parse(b.updated_at||b.published_at)||0)-(Date.parse(a.updated_at||a.published_at)||0));truncated=parsed.backlog;
    // Feed snapshots are checked for revisions even older than the cursor. Lookback only filters unseen records.
    saved.etag=response.headers.etag||null;saved.modified=response.headers['last-modified']||null;
    if(source.adapter==='trials'&&parsed.next_page){saved.next_page=parsed.next_page;saved.next_url=url;}
   }
   saved.fetched_at=new Date(now).toISOString();saved.queue=items;await state.write(key,saved);
  }
  }
  let newest=saved.pending_cursor||saved.cursor;
  while(items.length&&row.count<maxItemsPerSource&&used<maxItems&&budget.items<100){const item=items[0],date=item.updated_at||item.published_at;
   const id='source-'+digest([source.id,item.external_id]).slice(0,32);const known=await existing(id);
   if(paged||known||!date||!saved.cursor||Date.parse(date)>=Date.parse(saved.cursor)-72*3600000){const r=await accept(source,item);used++;if(r.status!=='unchanged')budget.items++;await state.write('budget',budget);row.count++;if(r.status==='new'){result.newArticles++;result.newIds.push(r.id);}else if(r.status==='updated'){result.updatedArticles++;row.updated++;}else result.duplicates++;}
   if(date&&!usableDate(date,now))row.date_anomalies=(row.date_anomalies||0)+1;
   if(usableDate(date,now)&&(!newest||Date.parse(date)>Date.parse(newest)))newest=date;items.shift();saved.queue=items;saved.pending_cursor=newest;await state.write(key,saved);
  }
  // A saved next page is fetched on a later run, preserving bounded work and avoiding skipped pages.
  if(!items.length&&saved.next_page){const u=new URL(saved.next_url);u.searchParams.set('pageToken',saved.next_page);const response=await get(u.toString(),source,{});retrieved=true;const parsed=await adapters.parse(source,response.body);saved.queue=parsed.items.map(normalize);saved.next_page=parsed.next_page;truncated=!!saved.next_page||saved.queue.length>0;}
  const backlog=saved.queue.length>0||!!saved.next_page||truncated;
  if(!backlog){saved.cursor=saved.pending_cursor||newest;saved.pending_cursor=null;}await state.write(key,saved);
  if(paged)paging=pagination.view(saved.scan,saved.queue.length,paging.incomplete_reason);
  Object.assign(row,{...(paged?{pagination:paging}:{}),status:paged&&backlog?'incomplete':backlog?'backlog':notModified?'not_modified':row.count?'success':'empty',backlog:saved.queue.length,next_page_pending:!!saved.next_page,cursor:saved.cursor,last_success_at:retrieved?stamp():previous.last_success_at||null,latest_report_at:newest,freshness_status:!newest?'unknown':now-Date.parse(newest)>source.freshness_hours*3600000?'stale':'current',report_date_unknown:!newest,stale:!!newest&&now-Date.parse(newest)>source.freshness_hours*3600000,coverage:'bounded_source_snapshot_not_complete'});
 }catch(e){row.status=e.code==='BUDGET'||e.code==='DEFERRED'?'deferred':'failed';if(pagination.enabled(source)&&saved.scan)row.pagination=pagination.view(saved.scan,(saved.queue||[]).length,e.code||'retrieval_failure');row.error_code=e.code||'RETRIEVAL_OR_VALIDATION';row.error_message='Source retrieval or normalization did not complete';result.errors++;}
 row.completed_at=stamp();health[source.id]=row;await state.write('health',health);result.sourceRuns.push(row);
 }
 const active=result.sourceRuns.filter(x=>x.status!=='unavailable');result.status=aggregateStatus(active,result.errors);result.sourceErrors=result.errors;await state.write('last-run',{...result,completed_at:stamp()});return result;
 });
}
async function status(){return{sources:registry,health:await state.read('health',{}),last_run:await state.read('last-run',null),coverage_gaps:['Mainland China','Korea','Many national jurisdictions'],models_enabled:false};}
module.exports={run,status,accept,normalize};
