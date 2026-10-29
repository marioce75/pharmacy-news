// Treatment content is a separately reviewed article, never inferred from outbreak news.
const KEYS=['first_line','alternatives','supportive','uncertainty'];
const LABELS={first_line:'First-line medicines',alternatives:'Alternatives and investigational options',supportive:'Supportive care',uncertainty:'Limits and uncertainty'};
const safeURL=u=>{try{const p=new URL(u);return p.protocol==='https:'&&!p.username&&!p.password;}catch{return false;}};
function validate(a,now=Date.now()){
 const g=a.treatment;if(!g)return;
 const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(s).toISOString().slice(0,10)===s;
 if(a.content_kind!=='guidance'||a.requires_clinical_review!==true)throw Error('Treatment guide requires clinical classification');
 if(!/^[a-z0-9-]{3,80}$/.test(g.disease_key||'')||!g.disease||!g.pathogen||!g.region||!g.population)throw Error('Disease, pathogen, region and population required');
 if(!date(g.checked_at)||Date.parse(g.checked_at)>now||!date(g.review_due)||g.review_due<=g.checked_at)throw Error('Valid treatment review dates required');
 if(!Array.isArray(g.sources)||!g.sources.length||g.sources.some(s=>!s.id||!s.issuer||!s.version||!date(s.published_at)||Date.parse(s.published_at)>now||!safeURL(s.url)))throw Error('Versioned primary sources required');
 if(new Set(g.sources.map(s=>s.id)).size!==g.sources.length)throw Error('Duplicate treatment source IDs');
 for(const k of KEYS){const s=g.sections?.[k];if(!s||!['supported','none_approved','insufficient_evidence','not_applicable'].includes(s.status)||!s.text||!Array.isArray(s.source_ids)||!s.source_ids.length||s.source_ids.some(id=>!g.sources.some(x=>x.id===id)))throw Error('Every treatment section requires evidence and an explicit status');}
 if(!a.rights?.license_url||!safeURL(a.rights.license_url)||!a.rights.attribution)throw Error('Treatment rights reference and attribution required');
}
function stale(g,now=Date.now()){return !g?.review_due||Date.parse(g.review_due)<=now;}
async function approved(){
 const store=require('./store'),pub=require('./publication'),history=require('./history'),intake=require('./editorial-intake');const out=[];
 for(const a of await store.listArticles('approved')){if(!a.treatment)continue;try{
  validate(a);const s=pub.approvalStatus(a,await history.read(a.id));
  if(!['editorial','evidence','rights','clinical'].every(k=>s.approvals[k]?.status==='valid')||!s.publishable)continue;
  intake.validate(a);out.push({...a,treatment_stale:stale(a.treatment)});
 }catch{/* Invalid/changed/unsigned records never expose clinical text. */}}
 return out;
}
module.exports={KEYS,LABELS,validate,stale,approved};
