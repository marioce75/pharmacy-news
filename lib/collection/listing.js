// Newest-first listing pagination with a persisted checkpoint. A scan walks pages until it
// passes the previous watermark minus an overlap, runs out of pages, or hits a cap; a capped
// scan resumes from its saved continuation on the next run and reports itself incomplete.
const worldwide=require('./adapters-worldwide');
const VERSION=1;
const enabled=s=>worldwide.handles(s)&&!!s.page;
const bound=(n,min,max,d)=>Number.isInteger(n)&&n>=min&&n<=max?n:d;
function options(s){const p=s.page||{};return{pages:bound(p.max_pages_per_run,1,10,3),scanCap:bound(p.max_pages_per_scan,1,200,20),bootstrap:bound(p.bootstrap_pages,1,10,1),overlapHours:bound(p.overlap_hours,1,24*30,72),queueCap:bound(p.max_queue,1,5000,1000),idCap:5000,minIntervalHours:bound(p.min_interval_hours,0,168,6)};}
function begin(source,saved,now){const o=options(source),through=saved.sync_through&&Date.parse(saved.sync_through)<=now?Date.parse(saved.sync_through):null;
 return{version:VERSION,adapter:source.adapter,base_url:source.url,started_at:new Date(now).toISOString(),next_url:source.url,pages:0,listed:0,filtered_out:0,duplicates_across_pages:0,undated:0,newest:null,oldest:null,
  boundary:through==null?null:new Date(through-o.overlapHours*3600000).toISOString(),mode:through==null?'bootstrap_recent_pages':'incremental_overlap',seen_ids:[],complete:false,blocked_reason:null};}
function view(scan,queue,reason){scan=scan||{};return{mode:scan.mode||null,pages_fetched:scan.pages||0,records_listed:scan.listed||0,filtered_out:scan.filtered_out||0,duplicates_across_pages:scan.duplicates_across_pages||0,undated_records:scan.undated||0,
 newest_listed:scan.newest||null,oldest_listed:scan.oldest||null,boundary:scan.boundary||null,scan_complete:!!scan.complete,queue_remaining:queue,complete:!!scan.complete&&!queue,
 incomplete_reason:scan.complete&&!queue?null:scan.blocked_reason||reason||(!scan.complete?'page_cap_checkpoint_saved':queue?'intake_cap':null),
 coverage:scan.mode==='bootstrap_recent_pages'?'recent_pages_only_not_historical_backfill':'bounded_listing_since_previous_watermark'};}
async function collect({source,saved,get,normalize,persist,now,isUnchanged=async()=>false}){
 const o=options(source);saved.queue||=[];
 if(saved.listing&&(saved.listing.version!==VERSION||saved.listing.adapter!==source.adapter||saved.listing.base_url!==source.url))throw Object.assign(new Error('Listing configuration changed; inspect and explicitly reset saved scan'),{code:'SCAN_CONFIG_CHANGED'});
 if(saved.listing?.complete&&now-Date.parse(saved.fetched_at||0)<o.minIntervalHours*3600000)return{retrieved:false,view:view(saved.listing,saved.queue.length,null)};
 if(!saved.listing||saved.listing.complete){saved.listing=begin(source,saved,now);await persist(saved);}
 let scan=saved.listing,pages=0,reason=null,retrieved=false;
 while(!scan.complete&&!scan.blocked_reason&&pages<o.pages){
  if(scan.pages>=o.scanCap){scan.blocked_reason='scan_page_cap_requires_review';break;}
  if(saved.queue.length>=o.queueCap){reason='queue_cap';break;}
  const response=await get(scan.next_url,source,{});retrieved=true;
  const parsed=await worldwide.parse(source,response.body,{url:scan.next_url}),next=structuredClone(scan);
  next.pages++;next.listed+=parsed.listed;next.filtered_out+=parsed.filtered_out;let passed=false;const incoming=[];
  for(const raw of parsed.items){const item=normalize(raw);
   // Offset listings shift when new reports arrive; a repeat is counted, never treated as new.
   if(next.seen_ids.includes(item.external_id)){next.duplicates_across_pages++;continue;}next.seen_ids.push(item.external_id);
   const d=Date.parse(item.updated_at||item.published_at);
   if(!Number.isFinite(d))next.undated++;else{if(d<=now&&(!next.newest||d>Date.parse(next.newest)))next.newest=new Date(d).toISOString();if(!next.oldest||d<Date.parse(next.oldest))next.oldest=new Date(d).toISOString();if(next.boundary&&d<Date.parse(next.boundary))passed=true;}
   if(!await isUnchanged(item))incoming.push(item);}
  const merged=new Map(saved.queue.map(x=>[x.external_id,x]));for(const x of incoming)merged.set(x.external_id,x);saved.queue=[...merged.values()];
  if(next.seen_ids.length>o.idCap)next.blocked_reason='record_cap_requires_review';
  else if(!parsed.listed||passed||!parsed.next_url||(next.mode==='bootstrap_recent_pages'&&next.pages>=o.bootstrap)||(next.undated&&next.undated===next.seen_ids.length&&next.pages>=o.bootstrap&&(next.undated_listing=true))){next.complete=true;next.next_url=null;}
  else next.next_url=parsed.next_url;
  if(next.complete&&next.newest)saved.sync_through=next.newest;
  saved.listing=next;scan=next;pages++;saved.fetched_at=new Date(now).toISOString();await persist(saved);
 }
 await persist(saved);return{retrieved,view:view(scan,saved.queue.length,reason)};
}
module.exports={enabled,options,begin,collect,view};
