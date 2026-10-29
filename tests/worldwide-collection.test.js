const {test,after,before}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs/promises'),os=require('os'),path=require('path');
const root=require('fs').mkdtempSync(path.join(os.tmpdir(),'pn-worldwide-'));process.env.CONTENT_DIR=root;process.env.ALLOW_COLLECTION='true';process.env.ALLOW_MODEL_CALLS='false';
for(const k of ['RUN_SCHEDULED_JOBS','RUN_NEWS_SCHEDULE'])delete process.env[k];
const registry=require('../config/source-registry'),runner=require('../lib/collection/runner'),state=require('../lib/collection/state'),store=require('../lib/store');
const dates=require('../lib/collection/dates'),worldwide=require('../lib/collection/adapters-worldwide'),listing=require('../lib/collection/listing');
const journal=require('../lib/collection/run-journal'),coverage=require('../lib/collection/coverage'),candidates=require('../lib/events/candidates');
const NOW=Date.parse('2026-10-29T14:00:00Z');
// Synthetic fixture sources; added to the registry only for this process.
const base={official:true,access:'public_metadata',languages:['en'],rights:{status:'item_review_required',permitted_use:'metadata_link_only',full_text:false},freshness_hours:72,cadence_hours:24};
const listSource={...base,id:'fixture-listing',name:'Fixture ministry outbreak notices',url:'https://health.example.gov/api/notices?page=1',adapter:'json-api',topic:'outbreak',streams:['outbreak'],who_region:'AFR',jurisdictions:['KE'],source_type:'official_public_health',timezone:'Africa/Nairobi',
 json:{items:'results',id:'id',title:'title',url:'link',published:'date'},page:{type:'page_param',param:'page',start:1,max_pages_per_run:2,max_pages_per_scan:10,bootstrap_pages:2,overlap_hours:24,min_interval_hours:0}};
const htmlSource={...base,id:'fixture-drug-alerts',name:'Fixture state drug warnings',url:'https://alerts.example.gov.au/warnings',adapter:'html-index',topic:'toxicology',streams:['substance'],who_region:'WPR',jurisdictions:['AU'],source_type:'official_drug_early_warning',timezone:'Australia/Sydney',
 html:{item:'li.alert',link:'a',date:'time'}};
const filteredSource={...base,id:'fixture-general-feed',name:'Fixture general ministry feed',url:'https://news.example.gov.br/rss',adapter:'rss-filtered',topic:'outbreak',streams:['outbreak'],who_region:'AMR',jurisdictions:['BR'],languages:['pt'],source_type:'official_public_health',filter:{include:['surto','sarampo','dengue']}};
registry.push(listSource,htmlSource,filteredSource);
const page=(n,rows)=>JSON.stringify({results:rows.map(([id,title,date])=>({id,title,link:'https://health.example.gov/notices/'+id,date}))});
const respond=body=>({status:200,headers:{},body});
after(async()=>{registry.splice(registry.indexOf(listSource),3);await fs.rm(root,{recursive:true,force:true});});

test('time zones: a local calendar day is not future-dated in UTC, numeric dates need a declared order, languages parse',()=>{
 const sydney=dates.parseSourceDate('30 October 2026',{timezone:'Australia/Sydney'});assert.equal(sydney.day,'2026-10-30');assert.equal(sydney.iso,'2026-10-29T13:00:00.000Z');assert.equal(dates.isFuture(sydney,NOW),false);
 assert.equal(dates.isFuture(dates.parseSourceDate('2026-10-30',{timezone:'UTC'}),NOW),true);
 assert.equal(dates.parseSourceDate('10/03/2026'),null);assert.equal(dates.parseSourceDate('10/03/2026',{format:'dmy'}).day,'2026-03-10');assert.equal(dates.parseSourceDate('10/03/2026',{format:'mdy'}).day,'2026-10-03');
 assert.equal(dates.parseSourceDate('31/02/2026',{format:'dmy'}),null);
 for(const [raw,zone,day] of [['29 de octubre de 2026','America/Bogota','2026-10-29'],['28 de outubro de 2026','America/Sao_Paulo','2026-10-28'],['27 octobre 2026','Europe/Paris','2026-10-27'],['29. Oktober 2026','Europe/Berlin','2026-10-29'],['October 29, 2026','America/New_York','2026-10-29']])assert.equal(dates.parseSourceDate(raw,{timezone:zone}).day,day,raw);
 assert.equal(dates.parseSourceDate('2026-10-29T10:00:00+08:00').iso,'2026-10-29T02:00:00.000Z');
 assert.equal(dates.parseSourceDate('2026-07-01 09:00',{timezone:'Europe/London'}).iso,'2026-07-01T08:00:00.000Z');
 assert.throws(()=>dates.parseSourceDate('2026-01-01',{timezone:'Mars/Olympus'}),/time zone/);
});
test('pagination: bootstrap reads bounded pages, checkpoints at the cap, resumes, and stops at the previous watermark',async()=>{
 const pages={1:[['a','Cholera outbreak in Kenya','2026-10-28'],['b','Measles update','2026-10-27']],2:[['c','Dengue notice','2026-10-20'],['d','Mpox notice','2026-10-19']],3:[['e','Old notice','2026-09-01']]},calls=[];
 const client=async url=>{calls.push(url);const n=Number(new URL(url).searchParams.get('page'));return respond(page(n,pages[n]||[]));};
 const first=await runner.run({sources:[listSource],client,now:NOW,maxItems:10});assert.equal(calls.length,2);assert.equal(first.newArticles,4);
 let saved=await state.read('source-fixture-listing');assert.equal(saved.listing.complete,true);assert.equal(saved.listing.mode,'bootstrap_recent_pages');assert.equal(saved.sync_through,'2026-10-27T21:00:00.000Z');
 // New reports push older ones down; the next scan walks until it passes the watermark minus overlap.
 pages[1]=[['f','Lassa fever, Kenya','2026-10-29'],['g','Rift Valley fever, Kenya','2026-10-29']];pages[2]=[['a','Cholera outbreak in Kenya','2026-10-28'],['b','Measles update','2026-10-27'],['c','Dengue notice','2026-10-20']];pages[3]=[['d','Mpox notice','2026-10-19']];calls.length=0;
 const second=await runner.run({sources:[listSource],client,now:NOW+3600000,maxItems:10});assert.equal(second.newArticles,2);assert.equal(calls.length,2);
 saved=await state.read('source-fixture-listing');assert.equal(saved.listing.complete,true);assert.equal(saved.listing.mode,'incremental_overlap');
 // A long gap: page cap reached before the watermark; checkpoint saved and reported incomplete.
 for(const n of [1,2,3,4])pages[n]=[['n'+n+'x','Notice '+n+'x','2026-11-0'+n],['n'+n+'y','Notice '+n+'y','2026-11-0'+n]];pages[5]=[['old','Older','2026-10-01']];calls.length=0;
 const later=Date.parse('2026-11-06T00:00:00Z'),third=await runner.run({sources:[listSource],client,now:later,maxItems:20});
 assert.equal(third.sourceRuns[0].status,'incomplete');assert.equal(third.sourceRuns[0].pagination.incomplete_reason,'page_cap_checkpoint_saved');saved=await state.read('source-fixture-listing');assert.match(saved.listing.next_url,/page=3/);
 calls.length=0;const fourth=await runner.run({sources:[listSource],client,now:later+60000,maxItems:20});assert.match(calls[0],/page=3/);assert.equal(fourth.sourceRuns[0].pagination.scan_complete,false);
 const fifth=await runner.run({sources:[listSource],client,now:later+120000,maxItems:20});assert.equal(fifth.sourceRuns[0].pagination.scan_complete,true);assert.equal((await state.read('source-fixture-listing')).sync_through,'2026-11-03T21:00:00.000Z');
});
test('duplicate identities: repeats across shifted pages are counted once; unchanged records are not rewritten; revisions are flagged',async()=>{
 const s={...listSource,id:'fixture-dupes',page:{...listSource.page,bootstrap_pages:3}};registry.push(s);
 try{const rows=[['x1','Plague notice, Madagascar','2026-10-25'],['x2','Anthrax notice, Kenya','2026-10-24']];
  const client=async url=>{const n=Number(new URL(url).searchParams.get('page'));return respond(page(n,n===1?rows:n===2?[rows[1],['x3','Cholera notice','2026-10-23']]:[]));};
  const r=await runner.run({sources:[s],client,now:NOW});assert.equal(r.newArticles,3);assert.equal(r.sourceRuns[0].pagination.duplicates_across_pages,1);
  const ids=new Set((await store.listArticles('pending')).filter(a=>a.provenance?.source_id==='fixture-dupes').map(a=>a.provenance.source_item_id));assert.deepEqual([...ids].sort(),['x1','x2','x3']);
  const before=await store.listArticles('pending');await state.write('source-fixture-dupes',{queue:[]});
  const again=await runner.run({sources:[s],client,now:NOW+86400000});assert.equal(again.newArticles,0);assert.equal(again.updatedArticles,0);
  rows[0]=['x1','Plague notice, Madagascar (updated)','2026-10-26'];await state.write('source-fixture-dupes',{queue:[]});
  const revised=await runner.run({sources:[s],client,now:NOW+2*86400000});assert.equal(revised.updatedArticles,1);
  const a=(await store.listArticles('pending')).find(x=>x.provenance?.source_item_id==='x1');assert.equal(a.ingestion.source_changed,true);assert.equal(a.summary,'');assert.ok(before.length>0);
 }finally{registry.splice(registry.indexOf(s),1);}
});
test('continuations that leave the endpoint are rejected rather than followed',()=>{
 assert.throws(()=>worldwide.nextURL({...listSource,page:{type:'next_field',field:'next'}},{next:'https://evil.example/api/notices?page=2'},listSource.url),/Unapproved continuation/);
 assert.throws(()=>worldwide.nextURL({...listSource,page:{type:'next_field',field:'next'}},{next:'https://health.example.gov/other?page=2'},listSource.url),/Unapproved continuation/);
 assert.match(worldwide.nextURL({...listSource,page:{type:'next_field',field:'next'}},{next:'/api/notices?page=2'},listSource.url),/page=2/);
});
test('html index keeps local-day dates, rejects off-site links and treats an empty selector as failure, not "no alerts"',async()=>{
 const html='<ul><li class="alert"><a href="/warnings/nitazene-oxycodone">Nitazenes detected in counterfeit oxycodone tablets</a><time datetime="2026-10-30">30 October 2026</time></li><li class="alert"><a href="https://elsewhere.example/x">Off-site</a><time>29 October 2026</time></li></ul>';
 const parsed=await worldwide.parse(htmlSource,html);assert.equal(parsed.items.length,1);assert.equal(parsed.items[0].published_at,'2026-10-29T13:00:00.000Z');assert.equal(parsed.items[0].date_precision,'day');
 await assert.rejects(worldwide.parse(htmlSource,'<ul></ul>'),e=>e.code==='SELECTOR_EMPTY');
 const r=await runner.run({sources:[htmlSource],client:async()=>respond('<html><body>Maintenance</body></html>'),now:NOW});assert.equal(r.sourceRuns[0].status,'failed');assert.equal(r.sourceRuns[0].error_code,'SELECTOR_EMPTY');
});
test('general feeds are filtered by title keywords and the filtered count is reported',async()=>{
 const rss='<rss version="2.0"><channel><title>F</title>'+[['1','Ministério confirma surto de sarampo no Pará'],['2','Campanha de vacinação nas escolas'],['3','Boletim de dengue semana 43']].map(([id,t])=>`<item><guid>${id}</guid><title>${t}</title><link>https://news.example.gov.br/n/${id}</link><pubDate>Tue, 28 Oct 2026 12:00:00 -0300</pubDate></item>`).join('')+'</channel></rss>';
 const parsed=await worldwide.parse(filteredSource,rss);assert.equal(parsed.items.length,2);assert.equal(parsed.filtered_out,1);assert.equal(parsed.items[0].published_at,'2026-10-28T15:00:00.000Z');
});
test('source failures keep last success, mark the source failing in coverage and never read as zero reports',async()=>{
 const s={...listSource,id:'fixture-failing',page:undefined,adapter:'json-api'};registry.push(s);
 try{await runner.run({sources:[s],client:async()=>respond(page(1,[['z','Cholera notice','2026-10-28']])),now:NOW});
  const ok=(await state.read('health'))['fixture-failing'];assert.ok(ok.last_success_at);
  const failed=await runner.run({sources:[s],client:async()=>({status:503,headers:{},body:'down'}),now:NOW+7*3600000});assert.equal(failed.sourceRuns[0].status,'failed');assert.equal(failed.sourceRuns[0].last_success_at,ok.last_success_at);
  const schema=await runner.run({sources:[s],client:async()=>respond('{"unexpected":[]}'),now:NOW+14*3600000});assert.equal(schema.sourceRuns[0].error_code,'SCHEMA_CHANGED');
  const r=await coverage.report({now:NOW+15*3600000});const row=r.sources.find(x=>x.id==='fixture-failing');assert.equal(row.state,'failing');assert.equal(row.last_success_at,ok.last_success_at);
  assert.ok(r.issues.some(i=>i.source_id==='fixture-failing'&&i.kind==='source_failing'));assert.match(r.statement,/does not mean there are no outbreaks or drug hazards/);
 }finally{registry.splice(registry.indexOf(s),1);}
});
test('stale reports and regional gaps are visible; blocked sources are never requested',async()=>{
 const s={...listSource,id:'fixture-stale',page:undefined,freshness_hours:48};registry.push(s);
 try{const r=await runner.run({sources:[s],client:async()=>respond(page(1,[['old1','Yellow fever notice','2026-09-01']])),now:NOW});assert.equal(r.sourceRuns[0].stale,true);assert.equal(r.sourceRuns[0].freshness_status,'stale');
  const rep=await coverage.report({now:NOW});assert.ok(rep.sources.find(x=>x.id==='fixture-stale').flags.includes('latest_report_stale'));
  assert.ok(rep.regions.some(g=>g.code!=='GLOBAL'&&g.substance.gap));
  const c=candidates.build({id:'c1',title:'Yellow fever notice',source:'S',source_url:'https://health.example.gov/n',provenance:{source_id:'fixture-stale',published_at:'2026-09-01T00:00:00Z'}},NOW);assert.ok(c.flags.includes('stale'));
  let calls=0;const blocked=registry.filter(x=>['validation_blocked','prohibited','restricted','registration_required'].includes(x.access));assert.ok(blocked.length>0);
  await runner.run({sources:blocked,client:async()=>{calls++;return respond('');}});assert.equal(calls,0);
 }finally{registry.splice(registry.indexOf(s),1);}
});
test('geographic precision: only areas named by the source, longest name first, no coordinates, issuer is not the location',()=>{
 const mk=(title,source_id='fixture-listing')=>candidates.build({id:'g'+title.length,title,source:'S',source_url:'https://health.example.gov/x',provenance:{source_id,published_at:'2026-10-28T00:00:00Z'}},NOW);
 let c=mk('Ebola (Bundibugyo virus) – Democratic Republic of the Congo and Uganda');assert.deepEqual(c.location.reported_areas.map(x=>x.iso2).sort(),['CD','UG']);assert.equal(c.location.precision,'multi_country');assert.equal(c.pathogen.name,'Bundibugyo virus (BDBV)');
 c=mk('Measles in Guinea-Bissau');assert.deepEqual(c.location.reported_areas.map(x=>x.iso2),['GW']);
 c=mk('Weekly bulletin');assert.equal(c.location.precision,'unknown');assert.deepEqual(c.location.issuer_jurisdiction,['KE']);assert.equal(c.location.reported_areas.length,0);assert.ok(c.flags.includes('disease_not_identified'));
 c=mk('Cholera outbreak in Haiti: 1 250 suspected cases and 40 deaths');assert.deepEqual(c.counts.map(x=>[x.measure,x.value,x.as_of]),[['cases',1250,null],['deaths',40,null]]);
 const text=JSON.stringify(c);assert.ok(!/"lat"|"lon"|coordinates"\s*:\s*\[/.test(text));assert.equal(c.event_date.value,null);
 c=mk('Pertussis immunisation in pregnancy: vaccine coverage (England)');assert.ok(c.flags.includes('possibly_not_an_event'));
 c=mk('Avian influenza A(H5N1) in poultry, Cambodia');assert.ok(c.flags.includes('verify_human_or_animal_host'));
});
test('substance candidates separate detection from prevalence and never carry treatment advice',()=>{
 const mk=title=>candidates.build({id:'s'+title.length,title,source:'S',source_url:'https://alerts.example.gov.au/w',provenance:{source_id:'fixture-drug-alerts',published_at:'2026-10-28T00:00:00Z'}},NOW);
 let c=mk('Fentanyl mixed with xylazine linked to overdose cluster in Victoria');assert.equal(c.kind,'substance');assert.deepEqual(c.substances.map(x=>x.key).sort(),['fentanyl','xylazine']);assert.ok(c.categories.includes('overdose_cluster'));assert.ok(c.categories.includes('dangerous_mixture'));
 assert.equal(c.statement.prevalence,'not_assessed');assert.ok(!/\btreat|antidote|naloxone|\bdos(e|ing)\b/i.test(JSON.stringify(c)));
 c=mk('Temporary scheduling order: placement of N-pyrrolidino protonitazene in schedule I');assert.equal(c.category,'scheduling_action');assert.equal(c.statement.kind,'legal_control_action');assert.equal(c.substances[0].key,'nitazene');
 c=mk('First detection of a new psychoactive substance, bromazolam, in Queensland');assert.equal(c.category,'new_psychoactive_substance');
 c=mk('Public warning issued');assert.ok(c.flags.includes('substance_not_identified'));
 const regulator=candidates.build({id:'r',title:'FDA approves new semaglutide dose',source:'S',source_url:'https://x',provenance:{source_id:'health-canada',published_at:'2026-10-28T00:00:00Z'}},NOW);assert.equal(regulator,null);
 const sa=require('../lib/substance-alerts');
 assert.throws(()=>sa.validate({provenance:{source_id:'unodc'},treatment:{},drug_event:{source_url:'https://www.unodc.org/LSS/Announcement/Details/x',substance:'x',category:'new_substance',confirmation:'suspected',uncertainty:'u',report_date:'2026-10-01',checked_at:'2026-10-02',event_date:null,location:{precision:'unknown'}}}),/treatment/);
});
test('conflicting counts across sources for the same disease and country are flagged for review',()=>{
 const a=candidates.build({id:'k1',title:'Cholera in Haiti: 120 cases',source:'A',source_url:'https://x',provenance:{source_id:'fixture-listing',published_at:'2026-10-25T00:00:00Z'}},NOW);
 const b=candidates.build({id:'k2',title:'Cholera in Haiti: 150 cases',source:'B',source_url:'https://y',provenance:{source_id:'fixture-general-feed',published_at:'2026-10-27T00:00:00Z'}},NOW);
 candidates.markConflicts([a,b]);assert.ok(a.flags.includes('conflicting_counts_across_sources'));assert.deepEqual(a.conflicts[0].values,[120,150]);
});
test('review gates: collected records are pending metadata only and never reach public outbreak or substance lists',async()=>{
 const pending=await store.listArticles('pending');assert.ok(pending.length>0);for(const a of pending){assert.equal(a.status,'pending');assert.equal(a.summary,'');assert.equal(a.outbreak,null);assert.equal(a.drug_event,undefined);}
 assert.equal((await store.listArticles('approved')).length,0);assert.deepEqual((await require('../lib/outbreaks').publicEvents()).events,[]);assert.deepEqual(await require('../lib/substance-alerts').approved(),[]);
 const list=await candidates.list({});assert.ok(list.length>0);for(const c of list)assert.equal(c.review_status,'machine_suggestion_unreviewed');
 // Deriving candidates must not change any stored revision.
 const pub=require('../lib/publication'),before=pending.map(a=>pub.revision(a));await candidates.list({});assert.deepEqual((await store.listArticles('pending')).map(a=>pub.revision(a)),before);
});
test('restart recovery: a crash mid-drain keeps the unprocessed queue, the run is reported interrupted, and a stale lock is moved aside safely',async()=>{
 const s={...listSource,id:'fixture-crash',page:undefined};registry.push(s);
 const rows=[['q1','Cholera notice one','2026-10-28'],['q2','Cholera notice two','2026-10-27'],['q3','Cholera notice three','2026-10-26']];
 const original=store.writeArticle;let writes=0;
 try{store.writeArticle=async(...args)=>{if(args[0]==='pending'&&String(args[2]?.provenance?.source_id)==='fixture-crash'&&++writes===2)throw Object.assign(new Error('simulated power loss'),{code:'EIO'});return original(...args);};
  await runner.run({sources:[s],client:async()=>respond(page(1,rows)),now:NOW});
  store.writeArticle=original;
  const saved=await state.read('source-fixture-crash');assert.equal(saved.queue.length,2,'unprocessed records are preserved');
  // Simulate a process that died while holding the journal entry and the lock.
  const j=await journal.read();j.runs.unshift({run_id:'dead-run',trigger:'cron',status:'running',started_at:new Date(NOW-3600000).toISOString()});await state.write('run-journal',j);
  await fs.mkdir(path.join(state.root(),'run.lock'));await fs.writeFile(path.join(state.root(),'run.lock','owner.json'),JSON.stringify({pid:999999,host:os.hostname(),started_at:new Date(NOW-3600000).toISOString()}));
  await assert.rejects(runner.run({sources:[s],client:async()=>respond(page(1,rows))}),e=>e.code==='RUN_LOCKED');
  const inspect=await journal.inspect({now:NOW});assert.ok(inspect.lock.stale);assert.ok(inspect.interrupted.some(r=>r.run_id==='dead-run'));
  assert.equal((await state.releaseStaleLock({now:NOW,alive:()=>true})).reason,'owner_process_alive');
  assert.equal((await state.releaseStaleLock({now:NOW-3600000+60000})).reason,'lock_not_old_enough');
  const released=await state.releaseStaleLock({now:NOW,alive:()=>false});assert.equal(released.released,true);assert.ok(require('fs').existsSync(path.join(state.root(),released.moved_to,'owner.json')));
  const resumed=await runner.run({sources:[s],client:async()=>{throw new Error('queue should drain before refetch');},now:NOW+60000});assert.equal(resumed.newArticles,2);assert.equal((await state.read('source-fixture-crash')).queue.length,0);
  assert.equal((await journal.read()).runs.find(r=>r.run_id==='dead-run').status,'interrupted');
 }finally{store.writeArticle=original;registry.splice(registry.indexOf(s),1);}
});
test('scheduling: missed six-hour slots, consecutive failures and bounded isolated runs are reported',async()=>{
 const runs=[{trigger:'cron',status:'success',started_at:'2026-10-28T00:01:00Z'},{trigger:'cron',status:'success',started_at:'2026-10-28T06:02:00Z'},{trigger:'cron',status:'failed',started_at:'2026-10-28T18:05:00Z'}];
 assert.deepEqual(journal.missedSlots(runs,{everyHours:6,now:Date.parse('2026-10-29T01:00:00Z')}),['2026-10-28T12:00:00.000Z']);
 assert.deepEqual(journal.missedSlots(runs,{everyHours:6,now:Date.parse('2026-10-29T02:00:00Z')}),['2026-10-28T12:00:00.000Z','2026-10-29T00:00:00.000Z']);
 assert.deepEqual(journal.missedSlots([{trigger:'manual',started_at:'2026-10-28T00:00:00Z'}],{now:NOW}),[],'no schedule, no missed-slot claims');
 const j=await journal.read();j.runs=[{run_id:'f2',trigger:'cron',status:'failed',started_at:'2026-10-29T06:00:00Z',completed_at:'2026-10-29T06:01:00Z'},{run_id:'f1',trigger:'cron',status:'failed',started_at:'2026-10-29T00:00:00Z',completed_at:'2026-10-29T00:01:00Z'},...j.runs];await state.write('run-journal',j);
 const r=await coverage.report({now:NOW+12*3600000,scheduleEnabled:true});assert.ok(r.issues.some(i=>i.kind==='consecutive_run_failures'));assert.deepEqual(r.issues.filter(i=>i.kind==='scheduled_run_missed').map(i=>i.slot),['2026-10-30T00:00:00.000Z','2026-10-29T18:00:00.000Z'].reverse());assert.equal(r.notification_delivery,'not_configured');
 // The isolated runner refuses directories it did not create, including a review store.
 const {execFileSync}=require('child_process'),store1=await fs.mkdtemp(path.join(os.tmpdir(),'pn-prod-like-'));await fs.writeFile(path.join(store1,'pharmacynews-store.json'),'{}');
 assert.throws(()=>execFileSync(process.execPath,[path.join(__dirname,'../scripts/collect-isolated.js'),store1,'ecdc-threats'],{stdio:'pipe'}),/did not create/);await fs.rm(store1,{recursive:true,force:true});
});
test('permissions: monitoring and candidate views require sign-in, are read-only, and are not public',async()=>{
 const express=require('express'),hash=require('bcrypt').hashSync('fixture-monitor-password',4);process.env.ADMIN_USERNAME='fixture-monitor';process.env.ADMIN_PASSWORD_HASH=hash;delete process.env.REVIEWER_REGISTRY_FILE;
 const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../views'));
 app.use((req,res,next)=>{req.session=req.get('x-fixture-auth')==='yes'?{authenticated:true,username:'fixture-monitor',account_source:'legacy_admin',credential:require('../lib/reviewers').credentialDigest(hash)}:{};next();});
 app.use('/',require('../routes/public'));app.use('/admin',require('../routes/monitoring'));
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));}),url='http://127.0.0.1:'+server.address().port;
 try{for(const p of ['/admin/monitoring','/admin/events','/admin/monitoring.json']){const r=await fetch(url+p,{redirect:'manual'});assert.equal(r.status,302,p);assert.match(r.headers.get('location'),/login/);}
  const signed={headers:{'x-fixture-auth':'yes'}};
  const mon=await fetch(url+'/admin/monitoring',signed);assert.equal(mon.status,200);const html=await mon.text();assert.match(html,/not comprehensive or real-time surveillance/);assert.match(html,/Coverage by WHO region/);
  const ev=await fetch(url+'/admin/events?kind=outbreak&country=KE',signed);assert.equal(ev.status,200);const evh=await ev.text();assert.match(evh,/not verified events/);
  const id=(await candidates.list({kind:'outbreak'}))[0].id,detail=await (await fetch(url+'/admin/events/'+encodeURIComponent(id),signed)).text();assert.match(detail,/Open the draft to confirm/);assert.match(detail,/target="_blank" rel="noopener noreferrer"/);
  const xss=await fetch(url+'/admin/events?q=%3Cscript%3Ealert(1)%3C/script%3E',signed);assert.ok(!(await xss.text()).includes('<script>alert(1)'));
  assert.equal((await fetch(url+'/admin/events',{method:'POST',...signed})).status,405);
  const pub=await (await fetch(url+'/api/outbreaks')).json();assert.deepEqual(pub.events,[]);assert.equal(pub.live_surveillance,false);
 }finally{await new Promise(r=>server.close(r));}
});
test('registry: every worldwide source records region, stream, verification date, rights and metadata-only use',()=>{
 const ww=require('../config/sources-worldwide');assert.ok(ww.length>40);const ids=registry.map(s=>s.id);assert.equal(new Set(ids).size,ids.length);
 for(const s of ww){assert.ok(['AFR','AMR','SEAR','EUR','EMR','WPR','GLOBAL'].includes(s.who_region),s.id);assert.ok(s.streams?.length,s.id);assert.equal(s.validation?.checked_at,'2026-10-29',s.id);assert.equal(s.rights.full_text,false,s.id);
  if(s.adapter==='unavailable'){assert.notEqual(s.access,'public_metadata',s.id);assert.ok(s.reason,s.id);continue;}
  assert.match(s.url,/^https:\/\//,s.id);assert.ok(['permitted_with_attribution','non_commercial_only','permission_required','unknown'].includes(s.rights.commercial_reuse),s.id);assert.equal(s.rights.permitted_use,'metadata_link_only',s.id);}
 for(const code of ['AFR','AMR','SEAR','EUR','EMR','WPR'])assert.ok(ww.some(s=>s.who_region===code),'every WHO region has at least a listed source or a recorded gap: '+code);
 assert.equal(registry.find(s=>s.id==='mhlw-rss').access,'prohibited');assert.ok(!ww.some(s=>/mhlw\.go\.jp/.test(s.url||'')),'MHLW feeds stay excluded');
});
test('adapter options: archive window, joined identities, dates from file names, attribute titles and anchor links',async()=>{
 const json={...base,id:'fx-json',url:'https://api.example.gov/recalls.json',adapter:'json-api',max_age_days:30,json:{items:'results',id_join:['event','recall'],title_join:['product','reason'],url_template:'https://api.example.gov/recalls.json?search=event:%22{event}%22',published:'date'}};
 const r=await worldwide.parse(json,JSON.stringify({results:[{event:'1',recall:'N/A',product:'A',reason:'counterfeit',date:'20261020'},{event:'1',recall:'N/A',product:'B',reason:'counterfeit',date:'20261021'},{event:'2',recall:'X',product:'C',reason:'old',date:'20250101'}]}),{now:NOW});
 assert.equal(r.items.length,2);assert.equal(r.older_than_window,1);assert.equal(r.items[0].title,'A — counterfeit');assert.match(r.items[0].url,/event:%221%22/);
 const pdf={...base,id:'fx-pdf',url:'https://alerts.example.gov.es/home.htm',adapter:'html-index',timezone:'Europe/Madrid',html:{item:'li',link:'a',date_regex:'(\\d{8})_',date_source:'href'}};
 const p=await worldwide.parse(pdf,'<ul><li><a href="pdf/20260922_Alerta.pdf">Alerta pastillas</a></li></ul>');assert.equal(p.items[0].published_at,'2026-09-21T22:00:00.000Z');
 const attr={...base,id:'fx-attr',url:'https://who.example.int/list',adapter:'html-index',html:{item:'div.i',link:'a',title_attr:'aria-label',date:'span'}};
 const q=await worldwide.parse(attr,'<div class="i"><a href="/a" aria-label="Medical Product Alert N°1: Falsified X"><p>card</p></a><span>3 July 2026</span></div>');assert.equal(q.items[0].title,'Medical Product Alert N°1: Falsified X');
 const hash={...base,id:'fx-hash',url:'https://heart.example.ca/alerts',adapter:'html-index',timezone:'America/Vancouver',html:{item:'li',link:'a',keep_hash:true,title:'h3',title_drop:'small',date:'h3 > small',date_strip:'\\s*•.*$'}};
 const k=await worldwide.parse(hash,'<ul><li><a href="#one"><h3>Drug Alert - Cranbrook <small>October 27, 2026 • Posted by IH</small></h3></a></li><li><a href="#two"><h3>Drug Alert - Kelowna <small>October 20, 2026 • Posted by IH</small></h3></a></li></ul>');
 assert.deepEqual(k.items.map(x=>[x.title,x.url.split('#')[1],x.published_at]),[['Drug Alert - Cranbrook','one','2026-10-27T07:00:00.000Z'],['Drug Alert - Kelowna','two','2026-10-20T07:00:00.000Z']]);
});
