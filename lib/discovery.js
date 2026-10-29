// Discovery is metadata triage, never a verified clinical event or geographic inference.
const registry=require('../config/source-registry');
function classify(a){const s=registry.find(s=>s.id===(a.provenance?.source_id||a.ingestion?.source_id));if(a.treatment)return'treatment';if(a.drug_event||s?.topic==='toxicology')return'substance';if(a.outbreak||['outbreak','official_assessment'].includes(s?.topic))return'disease';return'news';}
async function list({kind='all',query=''}={}){const rows=await require('./store').listArticles('pending');const q=String(query).toLowerCase();return rows.map(a=>({article:a,kind:classify(a),source:registry.find(s=>s.id===(a.provenance?.source_id||a.ingestion?.source_id)),structured:!!(a.treatment||a.drug_event||a.outbreak)})).filter(r=>(kind==='all'||r.kind===kind)&&(!q||[r.article.title,r.article.source,r.article.summary].join(' ').toLowerCase().includes(q)));}
module.exports={classify,list};
