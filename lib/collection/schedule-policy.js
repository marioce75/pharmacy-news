const registry=require('../../config/source-registry');
// Owner-approved rotation (2026-10-29): every verified worldwide outbreak and substance-alert
// source, a bounded batch per run, so each source is visited about daily on a six-hour schedule.
const ROTATION='rotation:worldwide',PER_RUN=8,EXTRA=['ecdc-threats','ecdc-updates','ecdc-risk','unodc'];
function eligible(s){return!!s&&s.adapter!=='unavailable'&&s.access==='public_metadata'&&s.rights?.status!=='prohibited';}
function pool(){const ww=new Set(require('../../config/sources-worldwide').map(s=>s.id));return registry.filter(s=>(ww.has(s.id)||EXTRA.includes(s.id))&&eligible(s));}
function select(ids=process.env.NEWS_SOURCE_IDS){
 if(String(ids||'').trim()===ROTATION){const p=pool();if(!p.length)throw new Error('Rotation has no eligible sources');return p;}
 const wanted=String(ids||'').split(',').map(x=>x.trim()).filter(Boolean);
 if(!wanted.length||wanted.length>6||new Set(wanted).size!==wanted.length)throw new Error('Scheduled news requires one to six explicit unique source IDs');
 return wanted.map(id=>{const s=registry.find(s=>s.id===id);if(!eligible(s))throw new Error('Scheduled source unavailable or prohibited: '+id);return s;});
}
// Next batch of the rotation; the offset is saved before collection so a crash moves on.
async function batch(sources,state){if(sources.length<=PER_RUN)return sources;const saved=await state.read('schedule-rotation',{offset:0}),start=(Number(saved.offset)||0)%sources.length;
 const picked=Array.from({length:PER_RUN},(_,i)=>sources[(start+i)%sources.length]);await state.write('schedule-rotation',{offset:(start+PER_RUN)%sources.length,updated_at:new Date().toISOString(),pool_size:sources.length});return picked;}
async function run({trigger='cron'}={}){
 const state=require('./state'),{createClient}=require('./http'),rotating=String(process.env.NEWS_SOURCE_IDS||'').trim()===ROTATION;
 const sources=rotating?await batch(select(),state):select();
 const day=new Date().toISOString().slice(0,10);let budget=await state.read('scheduled-http-budget',{day,requests:0,hosts:{}});if(budget.day!==day)budget={day,requests:0,hosts:{}};
 const client=createClient({budget,saveBudget:b=>state.write('scheduled-http-budget',b),limit:rotating?18:12,perHost:rotating?4:24,maxMs:rotating?180000:120000});
 return require('./runner').run({sources,client,maxItems:rotating?40:24,maxItemsPerSource:8,trigger});
}
module.exports={select,run,pool,batch,ROTATION,PER_RUN};
