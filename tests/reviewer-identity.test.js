const {test,after,before}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs/promises'),os=require('os'),path=require('path'),bcrypt=require('bcrypt');
const root=require('fs').mkdtempSync(path.join(os.tmpdir(),'pharmacy-reviewers-'));process.env.CONTENT_DIR=path.join(root,'content');
for(const k of ['RUN_SCHEDULED_JOBS','ALLOW_COLLECTION','ALLOW_MODEL_CALLS','REVIEWER_REGISTRY_FILE'])delete process.env[k];
const store=require('../lib/store'),pub=require('../lib/publication'),history=require('../lib/history'),reviewers=require('../lib/reviewers'),auth=require('../middleware/auth');
// Synthetic fixture accounts only. Passwords and hashes are generated per run and never stored.
const pw={clinician:'fixture-clinician-pass',editor:'fixture-editor-pass',source:'fixture-source-pass',admin:'fixture-admin-pass'};
const hashes=Object.fromEntries(Object.entries(pw).map(([k,v])=>[k,bcrypt.hashSync(v,4)]));
const day=offset=>new Date(Date.now()+offset*864e5).toISOString().slice(0,10);
const credential=(extra={})=>({profession:'Pharmacist',jurisdiction:'Fixture jurisdiction',license_reference:'FIXTURE-0000',verification_url:'https://example.org/fixture-licence-lookup',verified_by:'Fixture verifier',verified_at:day(-1),expires_at:day(365),...extra});
const accounts=()=>[
 {id:'fixture-clinician',display_name:'Fixture Clinician',password_hash:hashes.clinician,roles:['clinical_reviewer'],clinical_credential:credential()},
 {id:'fixture-editor',display_name:'Fixture Editor',password_hash:hashes.editor,roles:['editor']},
 {id:'fixture-source',display_name:'Fixture Source Reviewer',password_hash:hashes.source,roles:['evidence_reviewer','rights_reviewer']}
];
const registryFile=path.join(root,'reviewers.json');
async function writeRegistry(list,mode=0o600){await fs.writeFile(registryFile,JSON.stringify({reviewers:list}),{mode});await fs.chmod(registryFile,mode);}
const body='<p>'+'Synthetic fixture report text; not a real event and not clinical advice. '.repeat(3)+'</p>';
const draft=(id,extra={})=>({id,slug:id,title:'Synthetic fixture news',body,summary:'Synthetic fixture summary that is long enough for intake checks.',source_url:'https://example.org/fixture-source',status:'pending',content_kind:'news',...extra});
// Shaped like an ingested official-source draft: original summary required, rights not yet approved in content.
const ingested=(id,extra={})=>draft(id,{ingestion:{source_id:'ecdc-risk',requires_original_summary:true},editorial:{original_summary:true,specialist_review_requirements:'Synthetic fixture: clinical check of dates and risk wording'},rights:{status:'unreviewed',license_url:'https://example.org/fixture-licence',attribution:'Fixture publisher'},provenance:{published_at:'2026-01-02T00:00:00Z'},...extra});
async function login(id){const login=await auth.authenticate(id,pw[{'fixture-clinician':'clinician','fixture-editor':'editor','fixture-source':'source'}[id]]);assert.ok(login,id);const session={};auth.establish(session,login);return session;}
async function sign(session,kind,id,attestation){const principal=await auth.reauthenticate(session,pw[{'fixture-clinician':'clinician','fixture-editor':'editor','fixture-source':'source'}[session.username]]);assert.ok(principal);return pub.approve(id,kind,(await pub.preview(id)).revision,principal,attestation);}
const att={editorial:{confirmed:true,contentKind:'news'},evidence:{confirmed:true},rights:{confirmed:true,basis:'reviewed_for_original_summary'},clinical:{confirmed:true,specialistRequirementsMet:true}};
before(async()=>{await store.ensureDirectories();await writeRegistry(accounts());process.env.REVIEWER_REGISTRY_FILE=registryFile;});
// The publish route records editorial feedback in the background, so retry cleanup briefly.
after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:50}));

test('registry rejects placeholder hashes, reserved or duplicate ids, admin reuse and writable files without echoing secrets',async()=>{
 const base=accounts()[1];
 for(const bad of [[{...base,password_hash:'REPLACE_ME'}],[base,base],[{...base,id:'codex-assistant'}],[{...base,roles:['owner']}],[{...base,display_name:''}]])assert.throws(()=>reviewers.validate({reviewers:bad}),/Reviewer registry invalid/);
 assert.throws(()=>reviewers.validate({reviewers:[{...base,id:'fixture-admin'}]},'fixture-admin'),/ADMIN_USERNAME/);
 try{reviewers.validate({reviewers:[{...base,roles:['bad']}]});}catch(e){assert.ok(!e.message.includes(hashes.editor));}
 await writeRegistry(accounts(),0o620);assert.throws(()=>reviewers.load(),/writable/);
 const prior=process.env.REVIEWER_REGISTRY_FILE;process.env.REVIEWER_REGISTRY_FILE='relative.json';assert.throws(()=>reviewers.load(),/absolute/);process.env.REVIEWER_REGISTRY_FILE=prior;
 await writeRegistry(accounts());assert.equal(reviewers.load().length,3);
});

test('clinical credential counts only when independently verified, dated and unexpired',()=>{
 const a=accounts()[0],status=extra=>reviewers.credentialStatus({...a,clinical_credential:credential(extra)});
 assert.equal(status({}).verified,true);assert.ok(!JSON.stringify(status({}).summary).includes('FIXTURE-0000'),'licence number stays out of summaries');
 assert.match(status({verified_by:'fixture-clinician'}).reason,/cannot be verified by the reviewer/);
 assert.match(status({verified_by:'Fixture Clinician'}).reason,/cannot be verified by the reviewer/);
 assert.match(status({expires_at:day(-1)}).reason,/expired/);
 assert.match(status({verified_at:day(2)}).reason,/future/);
 assert.match(status({verification_url:'http://example.org/x'}).reason,/https/);
 assert.match(status({license_reference:''}).reason,/license_reference/);
 assert.equal(reviewers.credentialStatus({...a,roles:['editor']}).verified,false);
 assert.notEqual(status({}).digest,status({verified_at:day(-2)}).digest);
});

test('identity comes from server configuration; session claims, disabled accounts and changed passwords do not grant access',async()=>{
 const session=await login('fixture-editor');
 Object.assign(session,{roles:['clinical_reviewer'],clinicalCredentialVerified:true});
 let p=auth.identity(session);assert.deepEqual(p.roles,['editor']);assert.equal(p.clinicalCredentialVerified,false);assert.equal(p.source,'registry');
 assert.equal(auth.identity({...session,username:'fixture-clinician'}),null,'session cannot switch to another account');
 const clinician=auth.identity(await login('fixture-clinician'));assert.equal(clinician.clinicalCredentialVerified,true);assert.equal(clinician.credential.verified_by,'Fixture verifier');
 assert.equal(await auth.authenticate('fixture-editor','wrong-password'),null);assert.equal(await auth.authenticate('nobody','x'),null);
 await writeRegistry(accounts().map(a=>a.id==='fixture-editor'?{...a,disabled:true}:a));assert.equal(auth.identity(session),null);assert.equal(await auth.authenticate('fixture-editor',pw.editor),null);
 await writeRegistry(accounts().map(a=>a.id==='fixture-editor'?{...a,password_hash:bcrypt.hashSync('a-new-fixture-pass',4)}:a));assert.equal(auth.identity(session),null,'password change ends old sessions');
 await fs.writeFile(registryFile,'{broken',{mode:0o600});assert.equal(auth.identity(session),null,'invalid registry fails closed');
 await writeRegistry(accounts());
});

test('shared administrator keeps editorial, evidence and rights roles but is never a clinical identity',async()=>{
 process.env.ADMIN_USERNAME='fixture-admin';process.env.ADMIN_PASSWORD_HASH=hashes.admin;
 try{const login=await auth.authenticate('fixture-admin',pw.admin),session={};auth.establish(session,login);const p=auth.identity(session);
  assert.equal(p.source,'legacy_admin');assert.deepEqual(p.roles,['editor','evidence_reviewer','rights_reviewer']);assert.equal(p.clinicalCredentialVerified,false);
  assert.equal(auth.identity({authenticated:true,username:'fixture-admin'}),null,'sessions without a credential binding are refused');}
 finally{delete process.env.ADMIN_USERNAME;delete process.env.ADMIN_PASSWORD_HASH;}
});

test('approval step-up requires the reviewer\'s own password and locks after repeated failures',async()=>{
 const session=await login('fixture-source');
 assert.equal(await auth.reauthenticate(session,pw.editor),null,'another reviewer\'s password does not sign');
 assert.equal((await auth.reauthenticate(session,pw.source)).stepUp,true);
 for(let i=0;i<5;i++)assert.equal(await auth.reauthenticate(session,'wrong'),null);
 assert.equal(await auth.reauthenticate(session,pw.source),null,'locked until a fresh login');
});

test('approvals are separate, attributable and pinned to one revision; editorial confirmations cannot imply evidence or rights',async()=>{
 const id='separate';await store.writeArticle('pending',id,draft(id));const revision=(await pub.preview(id)).revision;
 const editor=await login('fixture-editor'),source=await login('fixture-source');
 const a=await sign(editor,'editorial',id,{...att.editorial,rightsChecked:true,evidenceChecked:true});
 assert.equal(a.evidence_review,undefined);assert.equal(a.rights_review,undefined);
 let st=await pub.status(id);assert.equal(st.approvals.editorial.status,'valid');assert.equal(st.approvals.evidence.status,'missing');assert.equal(st.approvals.rights.status,'missing');assert.equal(st.publishable,false);
 await sign(source,'evidence',id,att.evidence);await sign(source,'rights',id,att.rights);
 st=await pub.status(id);assert.equal(st.revision,revision,'recording approvals never changes the revision');assert.equal(st.publishable,true);
 const saved=await store.readArticle('pending',id);
 for(const [field,reviewer] of [['review','fixture-editor'],['evidence_review','fixture-source'],['rights_review','fixture-source']]){const r=saved[field];assert.equal(r.reviewer,reviewer);assert.equal(r.revision,revision);assert.ok(Date.parse(r.approved_at));assert.equal(r.step_up,true);}
 const events=(await history.read(id)).filter(e=>/_review$/.test(e.type));
 assert.deepEqual(events.map(e=>[e.type,e.actor,e.revision]),[['editorial_review','fixture-editor',revision],['evidence_review','fixture-source',revision],['rights_review','fixture-source',revision]]);
 assert.ok(events.every(e=>e.details.step_up===true&&e.details.identity_source==='registry'&&e.recorded_at));
 assert.equal(events[2].details.basis,'reviewed_for_original_summary');
 await assert.rejects(sign(source,'evidence',id,att.evidence),/already recorded/);
});

test('each approval requires its own role; clinical approval also needs a verified credential',async()=>{
 const id='roles';await store.writeArticle('pending',id,draft(id,{editorial:{specialist_review_requirements:'Synthetic clinical check'}}));const revision=(await pub.preview(id)).revision;
 const editor=auth.identity(await login('fixture-editor')),source=auth.identity(await login('fixture-source')),clinician=auth.identity(await login('fixture-clinician'));
 for(const kind of ['evidence','rights'])await assert.rejects(pub.approve(id,kind,revision,editor,att[kind]),/required/);
 await assert.rejects(pub.approve(id,'editorial',revision,source,att.editorial),/editor required/);
 await assert.rejects(pub.approve(id,'clinical',revision,editor,att.clinical),/verified clinician/);
 await assert.rejects(pub.approve(id,'editorial',revision,clinician,att.editorial),/editor required/);
 await assert.rejects(pub.approve(id,'clinical',revision,{...clinician,clinicalCredentialVerified:false},att.clinical),/verified clinician/);
 await assert.rejects(pub.approve(id,'clinical',revision,{...clinician,type:'model'},att.clinical),/verified clinician/);
 await assert.rejects(pub.approve(id,'clinical',revision,clinician,{confirmed:true}),/specialist/);
 await assert.rejects(pub.approve(id,'clinical',revision,clinician,{confirmed:'yes',specialistRequirementsMet:true}),/confirmation/);
 await assert.rejects(pub.approve(id,'rights',revision,source,{confirmed:true,basis:'trust-me'}),/rights basis/);
 await assert.rejects(pub.approve(id,'rights',revision,source,{confirmed:true,basis:'permission_obtained'}),/written permission/);
 await assert.rejects(pub.approve(id,'owner',revision,editor,{}),/Unknown approval/);
 const c=await pub.approve(id,'clinical',revision,clinician,att.clinical);
 assert.equal(c.clinical_review.credential_digest,clinician.credentialDigest);
 const event=(await history.read(id)).at(-1);assert.equal(event.details.credential.verified_by,'Fixture verifier');assert.ok(!JSON.stringify(event).includes('FIXTURE-0000'),'licence number never enters history');
});

test('a content change invalidates every approval, records what was dropped and blocks publication',async()=>{
 const id='invalidate';await store.writeArticle('pending',id,draft(id,{editorial:{specialist_review_requirements:'Synthetic clinical check'}}));const first=(await pub.preview(id)).revision;
 const editor=await login('fixture-editor'),source=await login('fixture-source'),clinician=await login('fixture-clinician');
 await sign(editor,'editorial',id,att.editorial);await sign(source,'evidence',id,att.evidence);await sign(source,'rights',id,att.rights);await sign(clinician,'clinical',id,att.clinical);
 assert.equal((await pub.status(id)).publishable,true);
 const before=await history.read(id);
 const next=await pub.edit(id,{title:'Synthetic fixture news, corrected'},first,'fixture-editor');
 for(const f of ['review','evidence_review','rights_review','clinical_review'])assert.equal(next[f],null,f);
 const events=await history.read(id);assert.deepEqual(events.slice(0,before.length),before,'earlier approval events are preserved');
 const dropped=events.find(e=>e.type==='approvals_invalidated');
 assert.equal(dropped.revision,first);assert.equal(dropped.details.next_revision,pub.revision(next));assert.equal(dropped.actor,'fixture-editor');
 assert.deepEqual(dropped.details.approvals.map(x=>[x.kind,x.reviewer]).sort(),[['clinical','fixture-clinician'],['editorial','fixture-editor'],['evidence','fixture-source'],['rights','fixture-source']]);
 const st=await pub.status(id);assert.equal(st.publishable,false);assert.equal(st.blockers.length,4);
 await assert.rejects(pub.publish(id,'fixture-editor'),/Review this exact draft/);
 await assert.rejects(sign(editor,'editorial',id,att.editorial).then(()=>pub.approve(id,'evidence',first,auth.identity(source),att.evidence)),/Draft changed/,'old revision cannot be approved');
});

test('direct writers that change content (scoring, tagging) cannot carry approvals forward',async()=>{
 const id='direct-writer';await store.writeArticle('pending',id,draft(id));const first=(await pub.preview(id)).revision;
 const editor=await login('fixture-editor'),source=await login('fixture-source');
 await sign(editor,'editorial',id,att.editorial);await sign(source,'evidence',id,att.evidence);
 const scored={...await store.readArticle('pending',id),editorial_score:7};await store.writeArticle('pending',id,scored);
 const saved=await store.readArticle('pending',id);assert.equal(saved.review,null);assert.equal(saved.evidence_review,null);assert.equal(saved.editorial_score,7);
 const event=(await history.read(id)).at(-1);assert.equal(event.type,'approvals_invalidated');assert.equal(event.actor,'storage-guard');assert.equal(event.revision,first);assert.deepEqual(event.details.approvals.map(x=>x.kind).sort(),['editorial','evidence']);
 const unchanged=await store.readArticle('pending',id);await store.writeArticle('pending',id,unchanged);assert.equal((await history.read(id)).filter(e=>e.type==='approvals_invalidated').length,1,'rewriting identical content logs nothing');
});

test('clinical approval must be independent of the editorial approver and of the revision\'s author',async()=>{
 const twoRoles=accounts().map(a=>a.id==='fixture-clinician'?{...a,roles:['clinical_reviewer','editor']}:a);await writeRegistry(twoRoles);
 try{
  const id='independence';await store.writeArticle('pending',id,draft(id,{editorial:{specialist_review_requirements:'Synthetic clinical check'}}));
  const both=await login('fixture-clinician'),editor=await login('fixture-editor');
  await sign(both,'editorial',id,att.editorial);await assert.rejects(sign(both,'clinical',id,att.clinical),/independent clinician.*editorial approval/);
  const id2='independence-b';await store.writeArticle('pending',id2,draft(id2,{editorial:{specialist_review_requirements:'Synthetic clinical check'}}));
  await sign(both,'clinical',id2,att.clinical);await assert.rejects(sign(both,'editorial',id2,att.editorial),/independent clinician/);
  await sign(editor,'editorial',id2,att.editorial);
  const id3='independence-c';await store.writeArticle('pending',id3,draft(id3,{editorial:{specialist_review_requirements:'Synthetic clinical check'}}));
  await pub.edit(id3,{title:'Edited by the clinician'},(await pub.preview(id3)).revision,'fixture-clinician');
  await assert.rejects(sign(both,'clinical',id3,att.clinical),/made the edit/);
  const id4='independence-d';await store.writeArticle('pending',id4,draft(id4,{author_id:'fixture-clinician',editorial:{specialist_review_requirements:'Synthetic clinical check'}}));
  await assert.rejects(sign(both,'clinical',id4,att.clinical),/wrote this article/);
 }finally{await writeRegistry(accounts());}
});

test('publication is refused for each missing, stale or tampered required approval',async()=>{
 const id='blocking';await store.writeArticle('pending',id,ingested(id));const revision=(await pub.preview(id)).revision;
 const editor=await login('fixture-editor'),source=await login('fixture-source'),clinician=await login('fixture-clinician');
 assert.deepEqual((await pub.status(id)).required,['editorial','evidence','rights','clinical']);
 await assert.rejects(pub.publish(id),/Review this exact draft/);
 await sign(editor,'editorial',id,att.editorial);await assert.rejects(pub.publish(id),/clinical review/);
 await sign(clinician,'clinical',id,att.clinical);await assert.rejects(pub.publish(id),/Evidence approval/);
 await sign(source,'evidence',id,att.evidence);await assert.rejects(pub.publish(id),/Source-rights approval/);
 assert.match((await pub.status(id)).blockers.join(' '),/rights basis/,'unreviewed rights in content still block until a rights approval exists');
 await sign(source,'rights',id,att.rights);
 assert.equal((await pub.preview(id)).revision,revision,'approving rights did not require editing the draft');
 const file=path.join(store.DIRS.pending,id+'.json'),good=await fs.readFile(file,'utf8'),a=JSON.parse(good);
 for(const [field,tamper] of [['rights_review',{event:'0'.repeat(64)}],['evidence_review',{reviewer:'someone-else'}],['clinical_review',{revision:'f'.repeat(64)}]]){
  await fs.writeFile(file,JSON.stringify({...a,[field]:{...a[field],...tamper}}));await assert.rejects(pub.publish(id),/approval|clinical review/,field);
 }
 await fs.writeFile(file,good);
 const published=await pub.publish(id,'fixture-editor');assert.equal(published.status,'approved');
 const request=(await history.read(id)).find(e=>e.type==='publication_requested');
 for(const k of ['review_event','clinical_event','evidence_event','rights_event'])assert.match(request.details[k],/^[a-f0-9]{64}$/,k);
 const integrity=await require('../scripts/check-content-integrity').check();assert.deepEqual(integrity.findings.filter(f=>f.id===id),[]);
});

test('commercial-permission sources need a written-permission rights approval',async()=>{
 const id='commercial';await store.writeArticle('pending',id,ingested(id,{ingestion:{source_id:'who-afro',requires_original_summary:true}}));const source=await login('fixture-source');
 await assert.rejects(sign(source,'rights',id,att.rights),/commercial permission/);
 const a=await sign(source,'rights',id,{confirmed:true,basis:'permission_obtained',permissionReference:'Fixture permission letter location'});
 assert.equal(a.rights_review.basis,'permission_obtained');assert.equal(a.rights_review.permission_reference,'Fixture permission letter location');
});

test('conversation evidence is kept as audit context and never counts as an approval',async()=>{
 const id='conversation';await store.writeArticle('pending',id,draft(id,{editorial:{specialist_review_requirements:'Synthetic clinical check'}}));const revision=(await pub.preview(id)).revision;
 const {note}=require('../scripts/note-conversation-evidence'),file=path.join(root,'evidence.json');
 const evidence={record_type:'conversation_evidence_only_not_application_approval',recorded_at:'2026-01-01T00:00:00Z',attestor_display_name:'Fixture attestor',attestation_verbatim:'fixture approved',scope:'Synthetic clinical approval of one revision only',article_id:id,revision,application_review_recorded:false,technical_identity_verified:false};
 await fs.writeFile(file,JSON.stringify(evidence));
 await assert.rejects(note(id,file,false),/writers/);
 const articleBefore=await fs.readFile(path.join(store.DIRS.pending,id+'.json'),'utf8');
 assert.equal((await note(id,file,true)).noted,true);assert.equal((await note(id,file,true)).noted,false,'idempotent');
 assert.equal(await fs.readFile(path.join(store.DIRS.pending,id+'.json'),'utf8'),articleBefore,'article file unchanged');
 const st=await pub.status(id);assert.equal(st.conversation_evidence.length,1);assert.equal(st.conversation_evidence[0].counts_as_approval,false);assert.equal(st.conversation_evidence[0].matches_current_revision,true);
 assert.equal(st.approvals.clinical.status,'missing');assert.equal(st.publishable,false);
 await assert.rejects(pub.publish(id),/Review this exact draft/);
 for(const bad of [{...evidence,application_review_recorded:true},{...evidence,technical_identity_verified:true},{...evidence,record_type:'approval'}]){await fs.writeFile(file,JSON.stringify(bad));await assert.rejects(note(id,file,true),/non-approving/);}
});

test('HTTP: login, password step-up and role checks gate every approval; request bodies cannot add roles',async()=>{
 const express=require('express'),session=require('express-session'),app=express();
 app.set('view engine','ejs');app.set('views',path.join(__dirname,'../views'));app.use(express.json());app.use(express.urlencoded({extended:false}));
 app.use(session({secret:'fixture-only-session-secret-0123456789',resave:false,saveUninitialized:false}));
 app.use('/admin',require('../routes/admin'));app.use('/api',require('../routes/api'));
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));}),url='http://127.0.0.1:'+server.address().port;
 try{
  async function signIn(username,password){const r=await fetch(url+'/admin/login',{method:'POST',redirect:'manual',headers:{origin:url,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username,password})});return r.status===302?r.headers.get('set-cookie').split(';')[0]:null;}
  const call=async(cookie,route,body)=>{const r=await fetch(url+'/api/admin/'+route,{method:body?'POST':'GET',headers:{origin:url,cookie,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()};};
  assert.equal(await signIn('fixture-editor','wrong-password'),null);
  const editor=await signIn('fixture-editor',pw.editor),source=await signIn('fixture-source',pw.source),clinician=await signIn('fixture-clinician',pw.clinician);
  for(const cookie of [source,clinician]){
   const denied=await fetch(url+'/api/admin/articles/role-probe',{method:'PUT',headers:{origin:url,cookie,'content-type':'application/json'},body:'{}'});assert.equal(denied.status,403,'reviewer cannot edit');
   assert.equal((await call(cookie,'decline/role-probe',{})).status,403);
   const intake=await fetch(url+'/admin/intake/role-probe',{method:'POST',headers:{origin:url,cookie,'content-type':'application/x-www-form-urlencoded'},body:''});assert.equal(intake.status,403,'reviewer cannot intake');
  }
  const id='http';await store.writeArticle('pending',id,ingested(id));const revision=(await call(editor,'review/'+id)).data.revision;
  let r=await call(editor,'approvals/'+id);assert.equal(r.data.you.id,'fixture-editor');assert.equal(r.data.you.clinical_credential_verified,false);assert.equal(r.data.publishable,false);
  r=await call(editor,`approvals/${id}/clinical`,{revision,password:pw.editor,attestation:att.clinical,roles:['clinical_reviewer'],clinicalCredentialVerified:true,id:'fixture-clinician'});assert.equal(r.status,403);
  r=await call(editor,`approvals/${id}/editorial`,{revision,attestation:att.editorial});assert.equal(r.status,401,'no password, no signature');
  r=await call(editor,`approvals/${id}/editorial`,{revision,password:pw.clinician,attestation:att.editorial});assert.equal(r.status,401,'another person\'s password does not sign');
  r=await call(editor,`approvals/${id}/evidence`,{revision,password:pw.editor,attestation:att.evidence});assert.equal(r.status,403);
  assert.equal((await call(editor,`approvals/${id}/editorial`,{revision,password:pw.editor,attestation:att.editorial})).status,200);
  assert.equal((await call(source,`approvals/${id}/evidence`,{revision,password:pw.source,attestation:att.evidence})).status,200);
  assert.equal((await call(source,`approvals/${id}/rights`,{revision,password:pw.source,attestation:att.rights})).status,200);
  assert.equal((await call(editor,'approve/'+id,{})).status,422,'clinical approval still missing');
  assert.equal((await call(clinician,'clinical-review/'+id,{revision,password:pw.clinician,confirmed:true,specialistRequirementsMet:true})).status,200);
  assert.equal((await call(source,'approve/'+id,{})).status,403,'publishing needs the editor role');
  assert.equal((await call(editor,'approve/'+id,{})).status,200);
  const types=(await call(editor,'history/'+id)).data.map(e=>[e.type,e.actor]);
  assert.deepEqual(types.filter(([t])=>/review$|^publi/.test(t)),[['editorial_review','fixture-editor'],['evidence_review','fixture-source'],['rights_review','fixture-source'],['clinical_review','fixture-clinician'],['publication_requested','fixture-editor'],['published','fixture-editor']]);
 }finally{await new Promise(r=>server.close(r));}
});

test('login persists the session before redirecting, even with a slow session store',async()=>{
 const express=require('express'),session=require('express-session'),app=express();
 class SlowStore extends session.MemoryStore{set(sid,data,cb){setTimeout(()=>super.set(sid,data,cb),150);}}
 app.set('view engine','ejs');app.set('views',path.join(__dirname,'../views'));app.use(express.urlencoded({extended:false}));app.use(express.json());
 app.use(session({store:new SlowStore(),secret:'fixture-only-session-secret-0123456789',resave:false,saveUninitialized:false}));
 app.use('/admin',require('../routes/admin'));app.use('/api',require('../routes/api'));
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));}),url='http://127.0.0.1:'+server.address().port;
 try{
  const login=await fetch(url+'/admin/login',{method:'POST',redirect:'manual',headers:{origin:url,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:'fixture-editor',password:pw.editor})});
  assert.equal(login.status,302);const cookie=login.headers.get('set-cookie').split(';')[0];
  // Follow the redirect as soon as headers arrive, as browsers do, without waiting for the body.
  assert.equal((await fetch(url+'/api/admin/stats',{headers:{cookie}})).status,200);
  await login.text();
 }finally{await new Promise(r=>server.close(r));}
});

test('directory fsync tolerates only unsupported filesystems and surfaces I/O errors',async()=>{
 const fsp=require('fs').promises,{syncDirectory}=require('../lib/fsync'),original=fsp.open;
 // Only directory handles (opened read-only) fail; temporary files are written normally.
 const fake=code=>async(p,flags,...rest)=>flags==='r'?{sync:async()=>{throw Object.assign(new Error(code),{code});},close:async()=>{}}:original(p,flags,...rest);
 try{
  fsp.open=fake('EINVAL');await syncDirectory(root);
  fsp.open=fake('EIO');await assert.rejects(syncDirectory(root),/EIO/);
  fsp.open=async(p,flags,...rest)=>{if(flags==='r')throw Object.assign(new Error('EACCES'),{code:'EACCES'});return original(p,flags,...rest);};await assert.rejects(syncDirectory(root),/EACCES/);
  fsp.open=fake('EIO');await assert.rejects(store.durableReplace(path.join(root,'durable-fail.json'),'{}'),/EIO/,'writer is told the replace may not be durable');
 }finally{fsp.open=original;}
 const opened=[];fsp.open=async(p,...rest)=>{opened.push(path.resolve(String(p)));return original(p,...rest);};
 try{await history.append('fsync-probe','fixture_event','fixture-editor','a'.repeat(64),{});}finally{fsp.open=original;}
 const events=path.resolve(process.env.CONTENT_DIR,'history','fsync-probe','events');
 assert.ok(opened.includes(events),'history flushes its events directory');
 assert.ok(opened.includes(path.dirname(events))&&opened.includes(path.resolve(process.env.CONTENT_DIR,'history')),'newly created parent directories are flushed');
});

test('specialist requirements survive edits and discovery remains unapproved',async()=>{
 const id='sticky-specialist';await store.writeArticle('pending',id,ingested(id));const a=await pub.edit(id,{editorial:{original_summary:true},requires_clinical_review:false},(await pub.preview(id)).revision,'fixture-editor');
 assert.match(a.editorial.specialist_review_requirements,/Synthetic fixture/);assert.ok((await pub.status(id)).required.includes('clinical'));
 const rows=await require('../lib/discovery').list({kind:'disease',query:'Synthetic'});assert.ok(rows.some(r=>r.article.id===id));assert.equal(a.status,'pending');
});
