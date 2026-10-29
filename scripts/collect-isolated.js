// Bounded collection into an isolated store for adapter verification. It refuses any directory
// it did not create (including the production review store), never calls models, never
// schedules, and writes pending metadata only. Repeat runs reuse the same isolated store so
// incremental cursors, queues and checkpoints can be checked.
// Usage: node scripts/collect-isolated.js <absolute-dir> <source-id,...> [--requests N] [--items N] [--seconds N]
const fs=require('fs'),path=require('path');
const MARKER='.isolated-collection-store';
const [dir,ids,...rest]=process.argv.slice(2);
const opt=k=>{const i=rest.indexOf('--'+k);return i>=0?Number(rest[i+1]):null;};
if(!dir||!path.isAbsolute(dir)||!ids)throw new Error('Usage: collect-isolated.js <absolute-dir> <source-id,...> [--requests N] [--items N] [--seconds N]');
if(fs.existsSync(dir)){if(!fs.existsSync(path.join(dir,MARKER))||fs.existsSync(path.join(dir,'pharmacynews-store.json')))throw new Error('Refusing a directory this script did not create');}
else{fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(path.join(dir,MARKER),JSON.stringify({created_at:new Date().toISOString(),purpose:'isolated adapter verification; not production'})+'\n');}
const requests=Math.min(opt('requests')||12,60),items=Math.min(opt('items')||30,200),seconds=Math.min(opt('seconds')||180,900);
process.env.CONTENT_DIR=dir;process.env.ALLOW_COLLECTION='true';for(const k of ['ALLOW_MODEL_CALLS','RUN_SCHEDULED_JOBS','RUN_NEWS_SCHEDULE','RUN_ANTIBIOTIC_SCHEDULE','ALLOW_ANTIBIOTIC_WATCH'])process.env[k]='false';
const registry=require('../config/source-registry');
const sources=ids.split(',').map(id=>{const s=registry.find(x=>x.id===id.trim());if(!s||s.adapter==='unavailable'||s.access!=='public_metadata'||s.rights?.status==='prohibited')throw new Error('Source unavailable, blocked or prohibited: '+id);return s;});
const state=require('../lib/collection/state'),{createClient}=require('../lib/collection/http'),runner=require('../lib/collection/runner');
(async()=>{
 const budget={day:new Date().toISOString().slice(0,10),requests:0,hosts:{}};
 const client=createClient({budget,saveBudget:b=>state.write('isolated-http-budget',b),limit:requests,perHost:Math.max(2,Math.ceil(requests/sources.length)+1),maxMs:seconds*1000});
 const r=await runner.run({sources,client,maxItems:items,maxItemsPerSource:Math.max(1,Math.ceil(items/sources.length)),trigger:'isolated'});
 const out={status:r.status,requests:budget.requests,new:r.newArticles,updated:r.updatedArticles,unchanged:r.duplicates,sources:r.sourceRuns.map(s=>({id:s.source_id,state:s.status,count:s.count,error:s.error_code||null,latest_report_at:s.latest_report_at||null,freshness:s.freshness_status||null,backlog:s.backlog,pagination:s.pagination||null,date_anomalies:s.date_anomalies||0}))};
 console.log(JSON.stringify(out,null,2));
})().catch(e=>{console.error(e.code||'',e.message);process.exitCode=1;});
