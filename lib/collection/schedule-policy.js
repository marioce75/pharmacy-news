const registry=require('../../config/source-registry');
function select(ids=process.env.NEWS_SOURCE_IDS){
 const wanted=String(ids||'').split(',').map(x=>x.trim()).filter(Boolean);
 if(!wanted.length||wanted.length>6||new Set(wanted).size!==wanted.length)throw new Error('Scheduled news requires one to six explicit unique source IDs');
 return wanted.map(id=>{const s=registry.find(s=>s.id===id);if(!s||s.adapter==='unavailable'||s.access!=='public_metadata'||s.rights?.status==='prohibited')throw new Error('Scheduled source unavailable or prohibited: '+id);return s;});
}
async function run(){
 const sources=select(),state=require('./state'),{createClient}=require('./http');
 const day=new Date().toISOString().slice(0,10);let budget=await state.read('scheduled-http-budget',{day,requests:0,hosts:{}});if(budget.day!==day)budget={day,requests:0,hosts:{}};
 const client=createClient({budget,saveBudget:b=>state.write('scheduled-http-budget',b),limit:12,perHost:24,maxMs:120000});
 return require('./runner').run({sources,client,maxItems:24,maxItemsPerSource:8});
}
module.exports={select,run};
