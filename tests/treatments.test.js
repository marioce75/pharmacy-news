const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs/promises'),os=require('os'),path=require('path');
const fixture=require('./treatment-fixture.json'),t=require('../lib/treatments');
const root=require('fs').mkdtempSync(path.join(os.tmpdir(),'pharmacy-treatment-test-'));process.env.CONTENT_DIR=root;
const store=require('../lib/store'),pub=require('../lib/publication');
test.after(()=>fs.rm(root,{recursive:true,force:true}));
test('treatment validation enforces species scope, clinical classification, source attribution and review dates',()=>{
 t.validate(fixture);for(const mutate of [a=>a.content_kind='news',a=>a.treatment.pathogen='',a=>a.treatment.sections.first_line.source_ids=['invented'],a=>a.treatment.sources[0].url='javascript:alert(1)',a=>a.treatment.checked_at='2099-01-01',a=>a.rights.license_url=null]){const a=structuredClone(fixture);mutate(a);assert.throws(()=>t.validate(a));}
 assert.equal(t.stale(fixture.treatment,Date.parse('2026-11-05')),true);
});
test('pending and forged approved treatment records never become public, and publication cannot skip reviews',async()=>{
 await store.ensureDirectories();await store.writeArticle('pending',fixture.id,fixture);assert.deepEqual(await t.approved(),[]);
 await assert.rejects(pub.publish(fixture.id,'test'),/Review this exact draft/);
 await fs.mkdir(path.join(root,'approved'),{recursive:true});await fs.writeFile(path.join(root,'approved',fixture.id+'.json'),JSON.stringify({...fixture,status:'approved'}));assert.deepEqual(await t.approved(),[]);
});
test('changing treatment evidence changes revision; unknown disease has no automatic therapy mapping',()=>{
 const a=structuredClone(fixture),hash=pub.revision(a);a.treatment.sections.first_line.text='Changed guidance';assert.notEqual(pub.revision(a),hash);
 assert.notEqual(fixture.treatment.disease.toLowerCase(),'ebola');
});
test('accessible view escapes text and withholds stale therapy sections',async()=>{
 const ejs=require('ejs'),a=structuredClone(fixture);a.treatment.disease='<script>alert(1)</script>';a.treatment.review_due='2026-10-28';
 const html=await ejs.renderFile(path.join(__dirname,'../views/treatments.ejs'),{guides:[a],query:'',preview:true,keys:t.KEYS,labels:t.LABELS,stale:t.stale});
 assert.match(html,/Guidance review overdue/);assert.ok(!html.includes('Inmazeb'));assert.ok(!html.includes('<script>alert'));assert.match(html,/NOT APPROVED/);
});
test('structured treatment completes isolated review/publication and correction preserves approved snapshot',async()=>{
 const a=structuredClone(fixture);a.id='fixture-treatment-e2e';a.slug=a.id;a.rights.status='reviewed_for_original_summary';await store.writeArticle('pending',a.id,a);
 const editor={id:'fixture-editor',type:'human',authenticated:true,roles:['editor']},sources={id:'fixture-evidence',type:'human',authenticated:true,roles:['evidence_reviewer','rights_reviewer']},clinician={id:'fixture-independent-clinician',type:'human',authenticated:true,roles:['clinical_reviewer'],clinicalCredentialVerified:true};
 const revision=pub.revision(a);await pub.approve(a.id,'editorial',revision,editor,{confirmed:true,contentKind:'clinical'});await pub.approve(a.id,'evidence',revision,sources,{confirmed:true});await pub.approve(a.id,'rights',revision,sources,{confirmed:true,basis:'reviewed_for_original_summary'});await assert.rejects(pub.publish(a.id),/clinical/);
 await pub.approve(a.id,'clinical',revision,clinician,{confirmed:true,specialistRequirementsMet:true});await pub.publish(a.id,editor.id);assert.ok((await t.approved()).some(x=>x.id===a.id));
 await pub.edit(a.id,{title:'Fixture correction',correction_reason:'Test revised evidence'},revision,editor.id);assert.ok((await t.approved()).some(x=>x.id===a.id&&x.title===a.title));assert.equal((await pub.status(a.id)).publishable,false);
});
