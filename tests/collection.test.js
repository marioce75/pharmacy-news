const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs/promises'),path=require('path'),os=require('os');
const root=require('fs').mkdtempSync(path.join(os.tmpdir(),'pharmacy-registry-test-'));process.env.CONTENT_DIR=root;process.env.ALLOW_COLLECTION='true';process.env.ALLOW_MODEL_CALLS='false';
const registry=require('../config/source-registry'),runner=require('../lib/collection/runner'),state=require('../lib/collection/state'),store=require('../lib/store'),pub=require('../lib/publication'),adapters=require('../lib/collection/adapters'),outbreaks=require('../lib/outbreaks'),editions=require('../lib/editions');
const {sourceApprovals}=require('./approval-fixture');
const editor={id:'fixture-editor',type:'human',authenticated:true,roles:['editor']},confirm={contentKind:'news',confirmed:true,evidenceChecked:true,rightsChecked:true};
const source=registry.find(s=>s.id==='ema-news');
const rss=(title='Official fixture',update='2026-01-02',id='fixture')=>`<rss version="2.0"><channel><title>Fixture</title><link>https://www.ema.europa.eu</link><item><guid>${id}</guid><title>${title}</title><link>https://www.ema.europa.eu/en/news/${id}</link><pubDate>${new Date(update).toUTCString()}</pubDate><description>Copyrighted snippet must not be stored or published.</description></item></channel></rss>`;
const response=body=>({status:200,headers:{etag:'fixture-etag'},body});
async function editorial(id){const a=(await pub.preview(id)).article;return pub.edit(id,{summary:'An original synthetic editorial summary, independently written for this local fixture.',body:'<p>'+('Original synthetic editorial text with no clinical advice. '.repeat(4))+'</p>',content_kind:'news',editorial:{original_summary:true},rights:{status:'reviewed_for_original_summary',license_url:'https://www.ema.europa.eu/en/about-us/legal-notice',attribution:'EMA'},correction_reason:'Synthetic correction'},pub.revision(a),editor.id);}
after(()=>fs.rm(root,{recursive:true,force:true}));
test('production RSS adapter preserves IDs/dates; import excludes copied snippets and requires original editorial review',async()=>{
 const r=await runner.run({sources:[source],client:async()=>response(rss())});assert.equal(r.newArticles,1);const a=await store.readArticle('pending',r.newIds[0]);assert.equal(a.provenance.source_updated_at,null);assert.equal(a.summary,'');assert.equal(a.body,'');assert.equal(a.geography.publisher_country,null);assert.deepEqual(a.geography.event_locations,[]);assert.ok(!JSON.stringify(a).includes('Copyrighted'));await assert.rejects(pub.review(a.id,pub.revision(a),editor,confirm));
 const d=await editorial(a.id);await pub.review(d.id,pub.revision(d),editor,confirm);await sourceApprovals(pub,d.id);await pub.publish(d.id,editor.id);
 const before=await fs.readFile(path.join(store.DIRS.approved,d.id+'.json'),'utf8');
 const updated=await runner.run({sources:[source],client:async()=>response(rss('Revised official fixture','2026-01-03'))});assert.equal(updated.updatedArticles,1);assert.equal(await fs.readFile(path.join(store.DIRS.approved,d.id+'.json'),'utf8'),before);const pending=await store.readArticle('pending',d.id);assert.equal(pending.review,null);assert.equal(pending.summary,'');assert.equal(pending.ingestion.source_changed,true);
});
test('conditional retrieval, duplicate identity, failure and empty are distinct and last success survives',async()=>{
 let headers;const r=await runner.run({sources:[source],client:async(u,s,h)=>{headers=h;return{status:304,headers:{},body:''};}});assert.equal(headers['If-None-Match'],'fixture-etag');assert.equal(r.sourceRuns[0].status,'not_modified');
 const last=r.sourceRuns[0].last_success_at;const failed=await runner.run({sources:[source],client:async()=>{throw new Error('Private details');}});assert.equal(failed.status,'failed');assert.equal(failed.sourceRuns[0].last_success_at,last);assert.ok(!JSON.stringify(failed).includes('Private'));
 const empty=await runner.run({sources:[source],client:async()=>response('<rss version="2.0"><channel><title>Empty</title></channel></rss>')});assert.equal(empty.sourceRuns[0].status,'empty');
});
test('bounded backlog persists and drains without skipping items; original normalized-title cluster retained',async()=>{
 const s=registry.find(x=>x.id==='ema-medicines');const xml='<rss version="2.0"><channel><title>Batch</title>'+[1,2].map(n=>`<item><guid>${n}</guid><title>Shared event headline</title><link>https://www.ema.europa.eu/${n}</link></item>`).join('')+'</channel></rss>';
 const r=await runner.run({sources:[s],client:async()=>response(xml),maxItems:1});assert.equal(r.sourceRuns[0].status,'backlog');assert.equal(r.sourceRuns[0].backlog,1);
 const next=await runner.run({sources:[s],client:async()=>{throw new Error('Queue should be drained without network');}});assert.equal(next.newArticles,1);const a=await store.readArticle('pending',r.newIds[0]),b=await store.readArticle('pending',next.newIds[0]);assert.equal(a.ingestion.cluster_id,b.ingestion.cluster_id);assert.notEqual(a.id,b.id);
});
test('unavailable and prohibited registry sources never request; disabled collection and ownership lock fail closed',async()=>{
 let calls=0;const r=await runner.run({sources:registry.filter(s=>s.adapter==='unavailable'),client:async()=>{calls++;}});assert.equal(calls,0);assert.equal(r.status,'unavailable');
 await state.exclusive(async()=>{await assert.rejects(runner.run({sources:[]}),/ownership lock/);});
 process.env.ALLOW_COLLECTION='false';await assert.rejects(runner.run(),/disabled/);process.env.ALLOW_COLLECTION='true';
});
test('page and trial adapters parse source metadata without treating headquarters as events or start as publication',async()=>{
 const who=registry.find(x=>x.id==='who-don');const page=await adapters.parse(who,'<a href="/emergencies/disease-outbreak-news/item/fixture">Fixture outbreak report</a>');assert.equal(page.items.length,1);assert.equal(page.items[0].published_at,null);await assert.rejects(adapters.parse(who,'<h1>Access denied</h1>'),/matched no records/);
 const ct=await adapters.parse(registry.find(x=>x.id==='clinicaltrials'),JSON.stringify({studies:[{protocolSection:{identificationModule:{nctId:'NCT123',briefTitle:'Trial fixture'},statusModule:{studyFirstPostDateStruct:{date:'2025-01-01'},lastUpdatePostDateStruct:{date:'2026-01-01'},startDateStruct:{date:'2024-01'}}}}],nextPageToken:'page2'}));assert.equal(ct.backlog,true);assert.equal(ct.items[0].published_at,'2025-01-01T00:00:00.000Z');assert.equal(ct.items[0].study_start,'2024-01');
});
test('source rights, translation and event geography gate review; only reviewed official event revisions reach public map',async()=>{
 const s=registry.find(x=>x.id==='ecdc-risk');const r=await runner.run({sources:[s],client:async()=>response(rss('Official risk fixture','2026-01-02','risk'))});let a=await editorial(r.newIds[0]);
 const event={kind:'official_assessment',disease:'Synthetic disease',confirmation:'suspected',report_url:'https://www.ecdc.europa.eu/en/fixture',report_date:'2026-01-02',uncertainty:'Synthetic fixture; no real event',location:{name:'Fixture region',precision:'region',basis:'publisher_headquarters',lat:40,lon:20,evidence_url:'https://www.ecdc.europa.eu/en/fixture'},assessment_text:'Synthetic official wording',assessment_version:'fixture-v1',assessment_date:'2026-01-02',cross_border_evidence:'Unknown in fixture'};
 a=await pub.edit(a.id,{outbreak:event},pub.revision(a),editor.id);await assert.rejects(pub.review(a.id,pub.revision(a),editor,confirm),/centroid/);assert.equal((await outbreaks.publicEvents()).events.length,0);
 const expected=pub.revision(a);event.location.basis='reported_area_centroid';a=await pub.edit(a.id,{outbreak:event,translation:{required:true,original_language:'fr',target_language:'en'}},expected,editor.id);await assert.rejects(pub.review(a.id,pub.revision(a),editor,confirm),/translation/);
 a=await pub.edit(a.id,{editorial:{original_summary:true,translation_reviewed:true}},pub.revision(a),editor.id);await pub.review(a.id,pub.revision(a),editor,confirm);await sourceApprovals(pub,a.id);await pub.publish(a.id,editor.id);const result=await outbreaks.publicEvents();assert.equal(result.events[0].confirmation,'suspected');assert.equal(result.live_surveillance,false);
 const e=await editions.draft('2026-01-04',[a.id],'Synthetic edition',editor);await assert.rejects(editions.release(e.day,'stale',editor,true),/changed/);await editions.release(e.day,editions.revision(e),editor,true);await assert.rejects(editions.draft(e.day,[],'overwrite',editor),/immutable/);
});
test('SSRF URL/DNS predicates reject private, credential and unapproved hosts; source extraction disabled',async()=>{
 const {allowed,publicIPv4}=require('../lib/collection/http');for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','::1','100.64.1.1'])assert.equal(publicIPv4(ip),false);assert.equal(publicIPv4('8.8.8.8'),true);
 for(const url of ['http://www.ema.europa.eu/','https://user:pass@www.ema.europa.eu/','https://127.0.0.1/','https://www.ema.europa.eu.evil.test/'])assert.throws(()=>allowed(url,source));
 await assert.rejects(require('../scrapers/base-scraper').extractArticleBody('https://www.ema.europa.eu/'),/disabled/);
});
test('antibiotic direct gate and independent schedules remain off unless explicitly selected',async()=>{
 await assert.rejects(require('../lib/bugsdrugs/watcher').runWatch(),/disabled/);const scheduler=require('../lib/scheduler'),calls=[];const fake={schedule:(spec,fn,opt)=>{calls.push({spec,opt});return{stop(){}};}};process.env.RUN_SCHEDULED_JOBS='true';assert.equal(scheduler.startScheduledJobs(fake).length,0);process.env.RUN_NEWS_SCHEDULE='true';scheduler.startScheduledJobs(fake);assert.deepEqual(calls.map(x=>x.spec),['0 */6 * * *']);scheduler.stopScheduledJobs();delete process.env.RUN_SCHEDULED_JOBS;delete process.env.RUN_NEWS_SCHEDULE;
});
test('watcher uses fixture CONTENT_DIR and reports failed coverage instead of no signals',async()=>{
 const axios=require('axios'),old=axios.get;await fs.mkdir(path.join(root,'bugs-drugs'),{recursive:true});await fs.writeFile(path.join(root,'bugs-drugs','drugs.json'),'{}');process.env.ALLOW_ANTIBIOTIC_WATCH='true';axios.get=async()=>{throw new Error('fixture offline');};try{const r=await require('../lib/bugsdrugs/watcher').runWatch();assert.equal(r.status,'failed');assert.match(r.summary,/Coverage incomplete/);assert.ok(await fs.readFile(path.join(root,'bugs-drugs','watch-log.json'),'utf8'));}finally{axios.get=old;delete process.env.ALLOW_ANTIBIOTIC_WATCH;}
});
test('transport pins public DNS, respects retry limit and budgets, rejects private DNS before request',async()=>{
 const {EventEmitter}=require('events'),{createClient}=require('../lib/collection/http');let requests=0;
 function request(u,options,done){requests++;assert.equal(u.hostname,'www.ema.europa.eu');options.lookup(u.hostname,{},(err,address)=>assert.equal(address,'8.8.8.8'));const req=new EventEmitter();req.setTimeout=()=>{};req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=requests===1?503:200;res.headers={};done(res);res.emit('data',Buffer.from('fixture'));res.emit('end');});return req;}
 const budget={requests:0,hosts:{}};const get=createClient({budget,saveBudget:async()=>{},lookup:async()=>[{address:'8.8.8.8',family:4}],request,sleep:async()=>{},spacing:0,limit:2});assert.equal((await get(source.url,source)).body,'fixture');assert.equal(requests,2);await assert.rejects(get(source.url,source),/budget/);
 const bad=createClient({budget:{requests:0,hosts:{}},saveBudget:async()=>{},lookup:async()=>[{address:'127.0.0.1',family:4}],request,sleep:async()=>{}});await assert.rejects(bad(source.url,source),/Non-public/);assert.equal(requests,2);
});
test('ClinicalTrials pagination persists bounded continuation and holds cursor until pages drained',async()=>{
 const ct=registry.find(s=>s.id==='clinicaltrials');const study=(n)=>({protocolSection:{identificationModule:{nctId:'NCT-FIX-'+n,briefTitle:'Trial '+n},statusModule:{studyFirstPostDateStruct:{date:'2026-01-01'},lastUpdatePostDateStruct:{date:'2026-01-0'+n}}}});
 let calls=0;const client=async url=>{calls++;return response(JSON.stringify(url.includes('pageToken')?{studies:[study(2)]}:{studies:[study(1)],nextPageToken:'fixture-next'}));};
 const first=await runner.run({sources:[ct],client});assert.equal(first.sourceRuns[0].status,'backlog');assert.equal(first.sourceRuns[0].cursor,null);
 const second=await runner.run({sources:[ct],client});assert.equal(second.sourceRuns[0].cursor,'2026-01-02T00:00:00.000Z');assert.equal(calls,2);
});

test('transport absolute deadline aborts a stalled response rather than holding run ownership',async()=>{
 const {EventEmitter}=require('events'),{createClient}=require('../lib/collection/http');let destroyed=false;
 const request=()=>{const req=new EventEmitter();req.setTimeout=()=>{};req.end=()=>{};req.destroy=e=>{destroyed=true;req.emit('error',e);};return req;};
 const get=createClient({budget:{requests:0,hosts:{}},saveBudget:async()=>{},lookup:async()=>[{address:'8.8.8.8',family:4}],request,sleep:async()=>{},spacing:0,maxMs:20});
 await assert.rejects(get(source.url,source),/budget|timeout/);assert.equal(destroyed,true);
});
test('source ordering rotates across runs so a bounded queue cannot permanently starve the last source',async()=>{
 const sources=[{...source,id:'rotate-a'},{...source,id:'rotate-b'}];await state.write('rotation',{offset:0});const client=async()=>response('<rss version="2.0"><channel><title>Empty</title></channel></rss>');
 const first=await runner.run({sources,client}),second=await runner.run({sources,client});assert.deepEqual(first.sourceRuns.map(x=>x.source_id),['rotate-a','rotate-b']);assert.deepEqual(second.sourceRuns.map(x=>x.source_id),['rotate-b','rotate-a']);
});
test('PMDA regional adapter retains partial/revision dates without fabricated days and excludes unrelated links',async()=>{
 const s=registry.find(s=>s.id==='pmda'),html='<table><tr><td>May 2026 (Revised) April 2025</td><td>73</td><td><a href="/files/fixture.pdf">Synthetic safety notice [444 KB]</a><a href="https://other.test/checklist.pdf">Other organization</a></td></tr></table><a href="/files/navigation.pdf">Navigation</a>';
 const p=await adapters.parse(s,html);assert.equal(p.items.length,1);assert.equal(p.items[0].title,'Synthetic safety notice');assert.equal(p.items[0].publication_raw,'May 2026 (Revised) April 2025');assert.equal(p.items[0].published_at,null);assert.equal(p.items[0].updated_at,null);await assert.rejects(adapters.parse(s,'<h1>Unavailable</h1>'),/table absent/);
 const r=await runner.run({sources:[s],client:async()=>response(html)});const a=await store.readArticle('pending',r.newIds[0]);assert.deepEqual(a.geography.jurisdiction,['JP']);assert.equal(a.language,'en');assert.equal(a.body,'');assert.equal(a.provenance.published_at,null);assert.equal(a.rights.full_text,false);
});
test('directory consumes the complete registry instead of a divergent fixed list',async()=>{
 const code=await fs.readFile(path.join(__dirname,'../public/atlas/app.js'),'utf8');assert.match(code,/sources=data.sources.map/);assert.doesNotMatch(code,/const sources=\[/);assert.equal(new Set(registry.map(s=>s.id)).size,registry.length);assert.equal(registry.find(s=>s.id==='cdc').access,'validation_blocked');assert.equal(registry.find(s=>s.id==='cofepris').access,'validation_blocked');
});
test('FDA actions preserve action dates and shortages preserve update dates without inventing publication dates',async()=>{
 const a=await adapters.parse(registry.find(s=>s.id==='fda-approvals'),JSON.stringify({meta:{last_updated:'2026-10-26'},results:[{application_number:'NDA123456',products:[{brand_name:'Fixture'}],submissions:[{submission_type:'SUPPL',submission_status:'AP',submission_status_date:'20261023'}]}]}));assert.equal(a.items[0].published_at,null);assert.equal(a.items[0].updated_at,'2026-10-23T00:00:00.000Z');assert.match(a.items[0].title,/SUPPL/);assert.equal(a.items[0].source_period,'2026-10-26');
 const b=await adapters.parse(registry.find(s=>s.id==='fda-shortages'),JSON.stringify({results:[{package_ndc:'123',generic_name:'Fixture',status:'Current',initial_posting_date:'10/01/2026',update_date:'10/23/2026'}]}));assert.equal(b.items[0].updated_at,'2026-10-23T00:00:00.000Z');await assert.rejects(adapters.parse(registry.find(s=>s.id==='fda-approvals'),'{}'));
});
test('PubMed two-step production integration retains metadata and partial dates only',async()=>{
 const original=registry.find(s=>s.id==='pubmed'),s={...original,pagination:{...original.pagination,max_pages_per_run:1}};let calls=0;const r=await runner.run({sources:[s],client:async u=>{calls++;return response(JSON.stringify(u.includes('esearch')?{esearchresult:{count:'1',idlist:['123']}}:{result:{uids:['123'],'123':{title:'Synthetic broad pharmacy research',pubdate:'2026 Oct'}}}));}});assert.equal(calls,2);const a=await store.readArticle('pending',r.newIds[0]);assert.equal(a.provenance.publication_raw,'2026 Oct');assert.equal(a.provenance.published_at,null);assert.equal(a.summary,'');await assert.rejects(pub.review(a.id,pub.revision(a),editor,confirm));
});
test('page metadata excludes foreign hosts, empty navigation and duplicate links',async()=>{
 const s=registry.find(s=>s.id==='unodc');const a=await adapters.parse(s,'<a href="/LSS/Announcement/Details/abc">Fixture</a><a href="/LSS/Announcement/Details/abc">Fixture</a><a href="https://evil.test/LSS/Announcement/Details/x">Foreign</a>');assert.equal(a.items.length,1);assert.equal(a.items[0].published_at,null);
});
test('FDA recall adapter excludes navigation and food-only notices and separates animal products',async()=>{
 const row=(type,product)=>'<tr><td><time datetime="2026-10-27T04:00:00Z">10/27/2026</time></td><td><a href="/safety/recalls-market-withdrawals-safety-alerts/fixture">Brand</a></td><td>'+product+'</td><td>'+type+'</td><td>Reason</td><td>Issuer</td><td></td></tr>';
 const a=await adapters.parse(registry.find(s=>s.id==='fda-recalls'),'<a href="/safety/recalls-market-withdrawals-safety-alerts/resources">Resources</a><table><tbody>'+row('Food','Fish')+row('Drugs','Compounded veterinary medication')+'</tbody></table>');assert.equal(a.items.length,1);assert.equal(a.items[0].data_kind,'animal_news');assert.equal(a.items[0].published_at,null);assert.equal(a.items[0].updated_at,'2026-10-27T04:00:00.000Z');assert.throws(()=>outbreaks.validate({data_kind:'animal_news',outbreak:{}}),/cannot populate/);
});
test('Europe PMC metadata retains supplied dates and does not copy abstract content',async()=>{
 const original=registry.find(s=>s.id==='europe-pmc'),s={...original,pagination:{...original.pagination,max_pages_per_run:1}};const r=await runner.run({sources:[s],client:async()=>response(JSON.stringify({hitCount:1,resultList:{result:[{source:'MED',id:'fixture-epmc',title:'Fixture <script>not markup</script>',firstPublicationDate:'2027-01-01',abstractText:'Never retain this abstract'}]}}))});const a=await store.readArticle('pending',r.newIds[0]);assert.equal(a.provenance.date_in_future,true);assert.equal(a.language,'und');assert.equal(a.translation.required,true);assert.ok(!JSON.stringify(a).includes('Never retain'));assert.equal(a.summary,'');
});

test('a persisted snapshot backlog refreshes after six hours so new reports are not hidden behind history',async()=>{
 const s={...source,id:'refresh-history'};const xml=n=>'<rss version="2.0"><channel><title>Fixture</title>'+Array.from({length:n},(_,i)=>'<item><guid>'+i+'</guid><title>Refresh fixture '+i+'</title><link>https://www.ema.europa.eu/refresh/'+i+'</link><pubDate>'+new Date(Date.UTC(2026,0,i+1)).toUTCString()+'</pubDate></item>').join('')+'</channel></rss>';
 const now=Date.now();await runner.run({sources:[s],client:async()=>response(xml(2)),maxItems:1,now});let calls=0;const r=await runner.run({sources:[s],client:async()=>{calls++;return response(xml(3));},maxItems:1,now:now+7*3600000});assert.equal(calls,1);assert.equal(r.newArticles,1);const a=await store.readArticle('pending',r.newIds[0]);assert.equal(a.title,'Refresh fixture 2');assert.equal(r.sourceRuns[0].backlog,1);
});
