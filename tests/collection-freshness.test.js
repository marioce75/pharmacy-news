const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs/promises'),os=require('os'),path=require('path');
const root=require('fs').mkdtempSync(path.join(os.tmpdir(),'pn-freshness-'));process.env.CONTENT_DIR=root;process.env.ALLOW_COLLECTION='true';
const runner=require('../lib/collection/runner'),state=require('../lib/collection/state'),store=require('../lib/store');
after(()=>fs.rm(root,{recursive:true,force:true}));
const source={id:'freshness-fixture',name:'Fixture official feed',url:'https://www.ecdc.europa.eu/feed',adapter:'rss',access:'public_metadata',languages:['en'],jurisdictions:['EU'],rights:{full_text:false},topic:'outbreak',freshness_hours:48};
const body='<rss version="2.0"><channel><title>Fixture</title>'+[['future','2026-11-30'],['current','2026-10-28']].map(([id,date])=>`<item><guid>${id}</guid><title>${id}</title><link>https://www.ecdc.europa.eu/${id}</link><pubDate>${new Date(date).toUTCString()}</pubDate></item>`).join('')+'</channel></rss>';
test('future watermark repaired; future record flagged and excluded from freshness/cursor',async()=>{
 await state.write('source-'+source.id,{cursor:'2026-12-01T00:00:00Z',pending_cursor:'2026-12-01T00:00:00Z',queue:[]});
 const r=await runner.run({sources:[source],now:Date.parse('2026-10-29T00:00:00Z'),client:async()=>({status:200,headers:{},body})});const row=r.sourceRuns[0];
 assert.equal(row.cursor_repaired,true);assert.equal(row.date_anomalies,1);assert.equal(row.cursor,'2026-10-28T00:00:00.000Z');assert.equal(row.freshness_status,'current');assert.equal(r.newArticles,2);
 const a=await store.readArticle('pending',r.newIds[0]);assert.equal(a.provenance.date_in_future,true);assert.equal(a.summary,'');assert.equal((await store.listArticles('approved')).length,0);
});
test('bounded feed backlog is incomplete, not a retrieval error; queue drains durably',async()=>{
 const s={...source,id:'bounded-fixture'};const r=await runner.run({sources:[s],maxItems:1,client:async()=>({status:200,headers:{},body})});assert.equal(r.status,'incomplete');assert.equal(r.errors,0);assert.equal(r.sourceRuns[0].backlog,1);
 const q=await state.read('source-'+s.id);assert.equal(q.queue.length,1);
 const next=await runner.run({sources:[s],client:async()=>{throw Error('unexpected fetch');}});assert.equal(next.newArticles,1);assert.equal(next.errors,0);assert.equal((await state.read('source-'+s.id)).queue.length,0);
});
