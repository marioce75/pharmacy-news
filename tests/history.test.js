const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs/promises'),path=require('path'),os=require('os');
const root=require('fs').mkdtempSync(path.join(os.tmpdir(),'pharmacy-history-'));process.env.CONTENT_DIR=root;process.env.ALLOW_MODEL_CALLS='false';
const store=require('../lib/store'),pub=require('../lib/publication'),history=require('../lib/history'),{migrate}=require('../lib/migrate'),{identity}=require('../middleware/auth');
const {sourceApprovals}=require('./approval-fixture');
const editor={id:'editor',type:'human',authenticated:true,roles:['editor']};
const clinician={id:'independent-clinician-fixture',type:'human',authenticated:true,roles:['clinical_reviewer'],clinicalCredentialVerified:true,credentialVerificationReference:'synthetic-test-only'};
const checks={confirmed:true,evidenceChecked:true,rightsChecked:true,contentKind:'news'};
const draft=id=>({id,title:'Synthetic news',content_kind:'news',body:'<p>'+('Synthetic test text; not a real news report. '.repeat(5))+'</p>',source_url:'https://example.org/fixture',date_published:null,rights:{status:'fixture-only'},status:'pending'});
after(()=>fs.rm(root,{recursive:true,force:true}));
test('migration dry run and empty apply never seed stories; legacy imports preserve bytes and are idempotent',async()=>{
 assert.deepEqual(await migrate(),{dry_run:true,articles:0,seeded:0});await assert.rejects(fs.access(path.join(root,'history')));
 assert.equal((await migrate({apply:true})).seeded,0);await store.ensureDirectories();
 const a=draft('legacy'),file=path.join(store.DIRS.approved,'legacy.json'),raw=JSON.stringify({...a,status:'approved',review:{reviewer:'old'}});await fs.writeFile(file,raw);
 assert.equal((await migrate()).articles,1);await assert.rejects(fs.access(path.join(root,'history')));
 await migrate({apply:true});const first=await history.read(a.id);await migrate({apply:true});assert.deepEqual(await history.read(a.id),first);assert.equal(await fs.readFile(file,'utf8'),raw);assert.equal(first[0].details.review_status,'not_verified_by_migration');
 await fs.writeFile(path.join(store.DIRS.pending,'legacy.json'),raw);await assert.rejects(pub.publish('legacy'),/Review/);
});
test('migration preflight rejects malformed records before any import event',async()=>{
 const a=draft('preflight');await fs.writeFile(path.join(store.DIRS.pending,a.id+'.json'),JSON.stringify(a));const bad=path.join(store.DIRS.pending,'invalid.json');await fs.writeFile(bad,'{broken');await assert.rejects(migrate({apply:true}));assert.deepEqual(await history.read(a.id),[]);await fs.unlink(bad);
});
test('immutable revisions survive corrections and withdrawal; direct approval writes rejected',async()=>{
 const a=draft('archive');await store.writeArticle('pending',a.id,a);await assert.rejects(store.writeArticle('approved',a.id,a),/publication/i);
 const hash=pub.revision(a);await pub.review(a.id,hash,editor,checks);await sourceApprovals(pub,a.id);await pub.publish(a.id,editor.id);
 await assert.rejects(pub.edit(a.id,{title:'Correction'},hash,editor.id),/reason/);
 await pub.edit(a.id,{title:'Correction',correction_reason:'Synthetic correction'},hash,editor.id);assert.equal((await store.readArticle('approved',a.id)).title,a.title);assert.equal((await history.revisionRecord(a.id,hash)).title,a.title);
 await pub.unpublish(a.id,editor.id,'Synthetic withdrawal');assert.equal(await store.articleExists('approved',a.id),false);assert.equal((await store.readArticle('pending',a.id)).title,'Correction');
 assert.ok((await history.read(a.id)).some(e=>e.type==='withdrawn'));await assert.rejects(history.snapshot(a.id,hash,{altered:true}),/collision/);
});
test('clinical publication requires distinct verified clinician and exact evidence revision; AI cannot approve',async()=>{
 const a={...draft('clinical-history'),content_kind:'dosing',author_id:'author',evidence:{level:'guideline',jurisdiction:'Fixture jurisdiction',primary_guidelines:[{url:'https://example.org/synthetic-guideline',issuer:'Fixture only',version:'1',published_at:'2025-01-01'}]}};await store.writeArticle('pending',a.id,a);const hash=pub.revision(a);
 await assert.rejects(pub.review(a.id,hash,{...editor,type:'model'},checks),/human/);
 await pub.review(a.id,hash,editor,{...checks,contentKind:'clinical'});await assert.rejects(pub.publish(a.id),/clinical review/);
 await assert.rejects(pub.clinicalReview(a.id,hash,identity({authenticated:true,username:'admin'}),true),/verified clinician/);
 await assert.rejects(pub.clinicalReview(a.id,hash,{...clinician,id:editor.id},true),/independent/);
 await assert.rejects(pub.clinicalReview(a.id,hash,{...clinician,type:'model'},true),/verified clinician/);
 await pub.clinicalReview(a.id,hash,clinician,true);await assert.rejects(pub.publish(a.id),/Evidence approval/);await sourceApprovals(pub,a.id);await pub.publish(a.id,editor.id);
 await pub.edit(a.id,{content_kind:'news',evidence:{...a.evidence,jurisdiction:'Changed'},correction_reason:'Evidence correction'},hash,editor.id);
 const next=await store.readArticle('pending',a.id);assert.equal(next.requires_clinical_review,true);assert.equal(next.clinical_review,null);assert.equal(next.review,null);assert.equal(next.evidence_review,null);assert.equal(next.rights_review,null);await assert.rejects(pub.publish(a.id),/Review/);
});
test('history and revision tampering are detected',async()=>{
 const a=draft('tamper-history');await store.writeArticle('pending',a.id,a);await pub.review(a.id,pub.revision(a),editor,checks);
 const dir=path.join(root,'history',a.id);await fs.writeFile(path.join(dir,'events','00000001.json'),'{}');await assert.rejects(pub.publish(a.id),/integrity/);
 await fs.writeFile(path.join(dir,'revisions',pub.revision(a)+'.json'),'{}');await assert.rejects(history.revisionRecord(a.id,pub.revision(a)),/integrity/);
});
test('date keys reject traversal and source HTML is sanitized',async()=>{await assert.rejects(store.writeSlate('../../outside',{}),/date/i);assert.equal(pub.sanitize('<script>x()</script><p onclick="x()">Safe</p>'),'<p>Safe</p>');});
