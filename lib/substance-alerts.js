const CATEGORIES=['new_substance','adulteration','toxicity','known_substance','market_detection'];
function validate(a){const e=a.drug_event;if(!e)return;
 // Alerts report detections and warnings only; treatment for an alerted substance is never inferred here.
 if(a.treatment||['treatment','antidote','dosing','clinical_advice','management'].some(k=>k in e))throw Error('Substance alerts cannot carry treatment or clinical advice; use a separately reviewed treatment guide');
 const sources=require('../config/source-registry'),s=sources.find(x=>x.id===a.provenance?.source_id);
 if(!s?.official||['prohibited','restricted','validation_blocked'].includes(s.access))throw Error('Permitted official substance-alert source required');
 let u;try{u=new URL(e.source_url);}catch{throw Error('Alert source URL required');}
 if(u.protocol!=='https:'||u.username||u.password||u.hostname!==new URL(s.url).hostname)throw Error('Alert source must match official issuer');
 if(!e.substance||!CATEGORIES.includes(e.category)||!['confirmed_report','suspected','under_investigation'].includes(e.confirmation)||!e.uncertainty)throw Error('Substance, category, confirmation and uncertainty required');
 for(const k of ['report_date','checked_at'])if(!/^\d{4}-\d{2}-\d{2}$/.test(e[k]||'')||!Number.isFinite(Date.parse(e[k]))||Date.parse(e[k])>Date.now())throw Error('Valid report/check dates required');
 if(e.event_date!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(e.event_date||'')||!Number.isFinite(Date.parse(e.event_date))||Date.parse(e.event_date)>Date.now()))throw Error('Event date must be supported or null');
 if(!e.location||!['unknown','country','region'].includes(e.location.precision))throw Error('Geographic precision required');
 if(e.location.precision!=='unknown'&&(!e.location.name||e.location.evidence_url!==e.source_url))throw Error('Reported area needs source evidence');
 if(['lat','lon','publisher_location','patient_data','prevalence','incidence','procurement','synthesis'].some(k=>k in e||k in e.location))throw Error('Unsupported patient location, metric or actionable drug detail');
}
async function approved(){const store=require('./store'),pub=require('./publication'),history=require('./history'),intake=require('./editorial-intake');const out=[];
 for(const a of await store.listArticles('approved')){if(!a.drug_event)continue;try{validate(a);const st=pub.approvalStatus(a,await history.read(a.id));if(!st.publishable||!st.required.every(k=>st.approvals[k].status==='valid'))continue;intake.validate(a);out.push({id:a.id,title:a.title,source:a.source,...a.drug_event,reviewed_at:a.review.approved_at||a.review.reviewed_at,stale:Date.now()-Date.parse(a.drug_event.checked_at)>7*86400000});}catch{}}
 return out;
}
module.exports={CATEGORIES,validate,approved};
