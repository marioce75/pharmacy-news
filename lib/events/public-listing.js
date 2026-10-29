// Public, owner-approved (2026-10-29) listing of OFFICIAL-source report titles collected by
// the metadata collector. Only the title, issuer, dates, a link out and the countries a title
// names are exposed: never summaries, case counts, editorial drafts, treatment content or
// research/media items. Everything is labelled as unreviewed and not verified by PharmacyNews.
const registry=require('../../config/source-registry');
const {COUNTRIES,WHO_REGIONS}=require('../../config/countries');
const candidates=require('./candidates'),coverage=require('../collection/coverage');
const LABEL='Unreviewed listing of report titles from official sources. Not verified or summarised by PharmacyNews; read the linked source.';
const STATEMENT='Aggregated from monitored public sources; not comprehensive or real-time surveillance. No reports from a place does not mean no outbreaks or drug hazards. A detection or warning does not measure prevalence.';
const WINDOW_DAYS=90,DAY=86400000;
function eligibleSource(s){return!!s&&s.official===true&&!['research','media'].includes(s.source_type)&&s.access==='public_metadata'&&s.adapter!=='unavailable'&&s.rights?.status!=='prohibited'&&s.rights?.full_text===false;}
function safeURL(u,s){try{const x=new URL(u),hosts=[new URL(s.url).hostname,...(s.link_hosts||[]),...(s.link_base?[new URL(s.link_base).hostname]:[])];return x.protocol==='https:'&&!x.username&&!x.password&&hosts.includes(x.hostname)?x.toString():null;}catch{return null;}}
// Collector leads only: an article with an editorial summary or body is a draft in review and stays private.
function collectorLead(a){return!!a?.ingestion&&a.provenance?.source_id&&!String(a.summary||'').trim()&&!String(a.body||'').trim()&&!a.treatment&&!a.drug_event&&!a.outbreak;}
function toReport(a,now){
 const s=registry.find(x=>x.id===a.provenance.source_id);if(!eligibleSource(s))return null;
 const streams=coverage.streams(s).filter(x=>['outbreak','substance'].includes(x));const c=candidates.build(a,now);
 const stream=c?.kind||streams[0];if(!['outbreak','substance'].includes(stream))return null;
 const url=safeURL(a.source_url,s);if(!url)return null;
 const reported=Date.parse(a.provenance.published_at||a.provenance.source_updated_at||''),retrieved=Date.parse(a.provenance.retrieved_at||'');
 const basis=Number.isFinite(reported)?reported:retrieved;if(!Number.isFinite(basis)||now-basis>WINDOW_DAYS*DAY)return null;
 const future=Number.isFinite(reported)&&reported>now;
 return{id:a.id,title:String(a.title).slice(0,300),issuer:s.issuer||s.name,source_id:s.id,source_name:s.name,source_url:url,stream,
  report_date:Number.isFinite(reported)&&!future?new Date(reported).toISOString():null,report_date_note:future?'Source date is later than retrieval; shown as unknown':Number.isFinite(reported)?null:'Source gave no date',
  retrieved_at:Number.isFinite(retrieved)?new Date(retrieved).toISOString():null,language:a.language||null,translation_note:a.language&&a.language!=='en'?'Title in source language':null,
  countries:(c?.location.reported_areas||[]).map(x=>({iso2:x.iso2,name:x.name,who_region:x.who_region})),issuer_region:coverage.region(s),
  title_mentions:c?(c.kind==='outbreak'?(c.disease?[c.disease.label]:[]):(c.substances||[]).map(x=>x.matched)):[],
  alert_category:c?.kind==='substance'?c.category:null,possibly_not_an_event:!!c?.flags.includes('possibly_not_an_event'),source_revised:!!a.ingestion?.source_changed,
  status:'unreviewed_official_listing'};}
function isoWeek(ms){const d=new Date(ms);const t=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())),n=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+4-n);const y=new Date(Date.UTC(t.getUTCFullYear(),0,1));return t.getUTCFullYear()+'-W'+String(Math.ceil(((t-y)/DAY+1)/7)).padStart(2,'0');}
async function listing({stream='',region='',country='',q='',since='',now=Date.now()}={}){
 const store=require('../store'),all=[];
 for(const status of ['pending','approved'])for(const a of await store.listArticles(status))if(collectorLead(a)){const r=toReport(a,now);if(r)all.push(r);}
 // One listing row per source URL even if two registry entries saw the same report.
 const byURL=new Map();for(const r of all)if(!byURL.has(r.source_url)||(byURL.get(r.source_url).retrieved_at||'')>(r.retrieved_at||''))byURL.set(r.source_url,r);
 let reports=[...byURL.values()].sort((a,b)=>String(b.report_date||b.retrieved_at).localeCompare(String(a.report_date||a.retrieved_at)));
 const query=String(q).toLowerCase().slice(0,120);
 const filtered=reports.filter(r=>(!stream||r.stream===stream)&&(!region||r.countries.some(c=>c.who_region===region)||(!r.countries.length&&r.issuer_region===region))&&(!country||r.countries.some(c=>c.iso2===country))
  &&(!since||(r.report_date||r.retrieved_at||'')>=since)&&(!query||[r.title,r.issuer,...r.title_mentions,...r.countries.map(c=>c.name)].join(' ').toLowerCase().includes(query)));
 const regions=Object.keys(WHO_REGIONS).map(code=>({code,name:WHO_REGIONS[code],outbreak:0,substance:0}));
 const countries=new Map(),weeks=new Map();
 for(const r of filtered){
  // Region totals count reports by the regions their titles name; untitled-place reports count under the issuer's region.
  const codes=new Set(r.countries.length?r.countries.map(c=>c.who_region):[r.issuer_region]);for(const code of codes){const g=regions.find(x=>x.code===code);if(g)g[r.stream]++;}
  for(const c of r.countries){const row=countries.get(c.iso2)||{...c,outbreak:0,substance:0};row[r.stream]++;countries.set(c.iso2,row);}
  const basis=Date.parse(r.report_date||r.retrieved_at);if(Number.isFinite(basis)){const w=isoWeek(basis),row=weeks.get(w)||{week:w,outbreak:0,substance:0};row[r.stream]++;weeks.set(w,row);}
 }
 const cov=await coverage.report({now});
 return{generated_at:new Date(now).toISOString(),label:LABEL,statement:STATEMENT,window_days:WINDOW_DAYS,live_surveillance:false,
  collection:{schedule_enabled:cov.schedule_enabled,last_completed_at:cov.runs.last_completed_success_at,last_status:cov.runs.last_run?.status||null,working_sources:cov.totals.working},
  totals:{reports:filtered.length,outbreak:filtered.filter(r=>r.stream==='outbreak').length,substance:filtered.filter(r=>r.stream==='substance').length,all_unfiltered:reports.length},
  regions,countries:[...countries.values()].sort((a,b)=>(b.outbreak+b.substance)-(a.outbreak+a.substance)),weeks:[...weeks.values()].sort((a,b)=>a.week.localeCompare(b.week)),
  coverage_regions:cov.regions.map(g=>({code:g.code,name:g.name,outbreak_sources:g.outbreak.working.length,substance_sources:g.substance.working.length,outbreak_gap:g.outbreak.gap,substance_gap:g.substance.gap})),
  reports:filtered.slice(0,300)};
}
module.exports={listing,toReport,eligibleSource,collectorLead,isoWeek,LABEL,STATEMENT,WINDOW_DAYS};
