const registry=require('../config/source-registry');
function validDate(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(v)&&Number.isFinite(Date.parse(v))&&Date.parse(v)<=Date.now();}
function sourceURL(v,source){try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname===new URL(source.url).hostname;}catch{return false;}}
function validate(article){
 const e=article.outbreak;if(!e)return;
 if(['animal_news','measured_dataset','supply_status'].includes(article.data_kind))throw new Error('Animal, measured and supply datasets cannot populate human outbreak maps');
 const source=registry.find(s=>s.id===article.provenance?.source_id);
 if(['animal_news','measured_dataset','supply_status'].includes(source?.data_kind))throw new Error('Source is not a human outbreak report');
 if(!source?.official||source.access==='prohibited'||!sourceURL(e.report_url,source))throw new Error('Official registry report URL required');
 if(!['outbreak','official_assessment'].includes(e.kind)||!['confirmed','suspected','under_investigation'].includes(e.confirmation)||!e.disease||!e.uncertainty||!validDate(e.report_date))throw new Error('Disease, confirmation, report date and uncertainty required');
 for(const key of ['update_date','onset_date'])if(e[key]&&!validDate(e[key]))throw new Error('Invalid event date');
 const g=e.location;if(!g||!g.name||!['country','region'].includes(g.precision)||g.basis!=='reported_area_centroid'||!sourceURL(g.evidence_url,source)||!Number.isFinite(g.lat)||Math.abs(g.lat)>90||!Number.isFinite(g.lon)||Math.abs(g.lon)>180)throw new Error('Source-evidenced country/region centroid required; no publisher or patient locations');
 if(e.kind==='official_assessment'&&(!e.assessment_text||!e.assessment_version||!validDate(e.assessment_date)||!e.cross_border_evidence))throw new Error('Attributed official assessment, date/version and cross-border evidence or explicit unknown required');
 if(e.probability!==undefined||e.incidence!==undefined||e.patient_data!==undefined||e.scenario!==undefined)throw new Error('Unsupported prediction, incidence, scenario or patient data');
}
async function publicEvents(){const store=require('./store'),pub=require('./publication'),history=require('./history');const events=[];for(const a of await store.listArticles('approved')){if(!a.outbreak)continue;try{validate(a);const h=await history.read(a.id),status=pub.approvalStatus(a,h);if(!status.publishable||!status.required.every(k=>status.approvals[k].status==='valid'))continue;require('./editorial-intake').validate(a);events.push({id:a.id,title:a.title,source:a.source,source_url:a.source_url,reviewed_at:a.review.reviewed_at,retrieved_at:a.provenance.retrieved_at,...a.outbreak});}catch{continue;}}
 return{events,coverage:'Reviewed official reports only; no data is not zero disease',generated_at:new Date().toISOString(),live_surveillance:false};}
module.exports={validate,publicEvents};
