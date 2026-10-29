const crypto = require('crypto');
const cheerio = require('cheerio');
const store = require('./store');
const history=require('./history'),policy=require('./review-policy'),intake=require('./editorial-intake');
const locked=require('./article-lock');
const fail = (message, status=409) => Object.assign(new Error(message), {status});
function stable(v) { if(Array.isArray(v)) return v.map(stable); if(v && typeof v==='object') return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])); return v; }
// Approval records are excluded so recording an approval never changes the revision it approves.
const APPROVAL_FIELDS=Object.values(policy.APPROVALS).map(d=>d.field);
const CLEARED=Object.fromEntries(APPROVAL_FIELDS.map(k=>[k,null]));
function content(a) { const data={...a}; for(const k of [...APPROVAL_FIELDS,'status','published_at']) delete data[k]; return stable(data); }
function revision(a){return crypto.createHash('sha256').update(JSON.stringify(content(a))).digest('hex');}
async function capture(a){return history.snapshot(a.id,revision(a),content(a));}
function sanitize(html) {
 const $=cheerio.load(String(html||''),null,false);
 $('script,style,iframe,object,embed,svg,math,template').remove();
 const allowed=new Set(['p','h2','h3','strong','em','ul','ol','li','blockquote','br','a']);
 $('*').each((_,el)=>{ if(!allowed.has(el.tagName)) {$(el).replaceWith($(el).contents());return;} const href=el.attribs.href; for(const k of Object.keys(el.attribs)) $(el).removeAttr(k); if(el.tagName==='a' && /^https?:\/\//i.test(href||'')) $(el).attr('href',href).attr('rel','noopener noreferrer'); });
 return $.html();
}
async function find(id) { for(const status of ['pending','approved','declined']) if(await store.articleExists(status,id)) return store.readArticle(status,id); throw fail('Article not found',404); }
async function preview(id) {return locked(id,async()=>{const article=await find(id); return {article,revision:revision(article),safeBody:sanitize(article.body),clinicalRequired:policy.clinical(article)};});}
async function edit(id, changes, expected, actor='unattributed-local-edit') {return locked(id,async()=>{
 const article=await find(id); if(expected!==revision(article))throw fail('Draft changed; reload before saving');
 await capture(article);
 const approved=await store.articleExists('approved',id)?await store.readArticle('approved',id):null;
 if(approved && !String(changes.correction_reason||'').trim())throw fail('A correction reason is required for a published article',422);
 const draft={...article,...changes,status:'pending',...CLEARED};
 if(policy.clinical(article)||policy.clinical(draft))draft.requires_clinical_review=true;
 // A general edit or refreshed source cannot silently remove a recorded specialist gate.
 if(policy.specialist(article))draft.editorial={...draft.editorial,specialist_review_requirements:policy.specialist(article)};
 draft.body=sanitize(draft.body);await capture(draft);
 await invalidate(id,article,actor,revision(draft),'content_changed');
 await history.append(id,approved?'correction_drafted':'draft_edited',actor,revision(draft),{previous_revision:expected,reason:changes.correction_reason||null});
 await store.writeArticle('pending',id,draft);return draft;
});}
// Records which approvals a content change dropped, so none is carried forward silently.
// Approvals on a published snapshot stay with that snapshot and are not touched here.
async function invalidate(id,article,actor,nextRevision,reason){
 if(article.status==='approved')return null;
 const dropped=Object.entries(policy.APPROVALS).filter(([,d])=>article[d.field]).map(([kind,d])=>({kind,reviewer:article[d.field].reviewer||null,revision:article[d.field].revision||null,event:article[d.field].event||null}));
 if(!dropped.length)return null;
 return history.append(id,'approvals_invalidated',actor||'unattributed-local-edit',revision(article),{reason,next_revision:nextRevision,approvals:dropped});
}
const CONTENT_EVENTS=new Set(['draft_edited','correction_drafted','model_draft_generated','legacy_import']);
// The person whose edit produced this revision cannot give it independent clinical approval.
function revisionAuthor(events,hash){return events.filter(e=>CONTENT_EVENTS.has(e.type)&&e.revision===hash).at(-1)?.actor||null;}
function valid(a,kind,hash,events){
 const d=policy.APPROVALS[kind],r=a[d.field];
 if(!r)return{status:'missing'};
 if(r.revision!==hash)return{status:'stale',reviewer:r.reviewer,revision:r.revision};
 if(!events.some(e=>e.type===d.event&&e.hash===r.event&&e.revision===hash&&e.actor===r.reviewer))return{status:'unlinked',reviewer:r.reviewer};
 return{status:'valid',reviewer:r.reviewer,reviewer_display_name:r.reviewer_display_name||r.reviewer,approved_at:r.approved_at||r.reviewed_at,event:r.event};
}
function clinicalIndependence(a,reviewer,hash,events){
 if(!reviewer)return null;
 if(reviewer===a.author_id)return'the clinician wrote this article';
 if(a.review?.revision===hash&&a.review.reviewer===reviewer)return'the clinician gave the editorial approval for this revision';
 if(revisionAuthor(events,hash)===reviewer)return'the clinician made the edit that produced this revision';
 return null;
}
function approvalStatus(a,events){
 const hash=revision(a),required=policy.requiredApprovals(a),approvals={};
 for(const kind of Object.keys(policy.APPROVALS))approvals[kind]={...valid(a,kind,hash,events),required:required.includes(kind)};
 const blockers=required.filter(k=>approvals[k].status!=='valid').map(k=>`${policy.APPROVALS[k].label} approval for this exact revision is ${approvals[k].status}`);
 const conflict=approvals.clinical.status==='valid'?clinicalIndependence(a,approvals.clinical.reviewer,hash,events):null;
 if(conflict)blockers.push('Clinical approval is not independent: '+conflict);
 if(a.status==='pending'){try{intake.validate(a);if(a.outbreak)require('./outbreaks').validate(a);}catch(e){blockers.push(e.message);}}
 // Conversation evidence is listed for context only and never satisfies an approval.
 const conversation_evidence=events.filter(e=>e.type==='conversation_evidence_noted').map(e=>({revision:e.revision,matches_current_revision:e.revision===hash,recorded_at:e.recorded_at,attestor_display_name:e.details.attestor_display_name,scope:e.details.scope,counts_as_approval:false,technical_identity_verified:false}));
 return{revision:hash,required,approvals,blockers,publishable:blockers.length===0,clinical_requirement:policy.specialist(a)||(policy.clinical(a)?'Clinical content':null),conversation_evidence};
}
async function status(id){return locked(id,async()=>{const a=await find(id);return approvalStatus(a,await history.read(id));});}
function text(v,max=500){return typeof v==='string'?v.trim().slice(0,max):'';}
const fixedStatements={
 editorial:'I reviewed this exact saved revision for accuracy, balance, headline and classification.',
 evidence:'Claims, dates, figures and places in this exact revision match the cited source(s); provenance is recorded.',
 rights:'The recorded rights basis, licence reference and attribution permit this original summary and link.',
 clinical:'I am the clinician named on my account. I clinically reviewed this exact revision and it contains no unsupported clinical claim or advice.'
};
async function approve(id,kind,expected,principal,attestation){return locked(id,async()=>{
 const d=policy.APPROVALS[kind];if(!d)throw fail('Unknown approval type',400);
 const a=await store.readArticle('pending',id),events=await history.read(id),att=attestation&&typeof attestation==='object'?attestation:{};
 if(kind==='clinical'){if(!policy.human(principal,'clinical_reviewer')||principal.clinicalCredentialVerified!==true)throw fail('No independently verified clinician identity is available',403);}
 else if(!policy.human(principal,d.role))throw fail(`Authenticated human ${d.role.replace('_',' ')} required`,401);
 if(expected!==revision(a))throw fail('Draft changed; review the new revision');
 if(a[d.field]?.revision===expected)throw fail(`${d.label} approval is already recorded for this revision`);
 require('./treatments').validate(a);require('./substance-alerts').validate(a);
 const details={kind,statement:fixedStatements[kind],reviewer_display_name:principal.displayName||principal.id,identity_source:principal.source||'unspecified',step_up:principal.stepUp===true};
 const record={kind,revision:expected,reviewer:principal.id,reviewer_display_name:details.reviewer_display_name};
 if(kind==='editorial'){
  const kindExpected=policy.clinical(a)?'clinical':'news';
  if(att.confirmed!==true||att.contentKind!==kindExpected)throw fail('Confirm the editorial review and the content classification',422);
  if(!a.body||a.body.trim().length<100||!/^https?:\/\//.test(a.source_url||''))throw fail('Complete body and source link required',422);
  if(a.body!==sanitize(a.body))throw fail('Save the sanitized draft before review',422);
  if(a.outbreak)require('./outbreaks').validate(a);
  intake.validateContent(a);
  if(a.clinical_review?.revision===expected&&a.clinical_review.reviewer===principal.id)throw fail('An independent clinician is required: the clinical approver cannot also give editorial approval',403);
  record.contentKind=details.content_kind=kindExpected;
 }else if(kind==='evidence'){
  if(att.confirmed!==true)throw fail('Confirm that the evidence matches this exact revision',422);
  if(!/^https:\/\//.test(a.source_url||''))throw fail('An https primary source link is required for evidence approval',422);
  if(policy.clinical(a)&&!policy.evidence(a))throw fail('Versioned primary evidence and jurisdiction required for clinical content',422);
  details.source_url=record.source_url=a.source_url;details.date_verification_url=a.provenance?.date_verification_url||null;
 }else if(kind==='rights'){
  const basis=att.basis;
  if(att.confirmed!==true||!intake.RIGHTS_BASES.includes(basis))throw fail('Choose the rights basis and confirm it applies to this exact revision',422);
  const permission=text(att.permissionReference);
  if(basis==='permission_obtained'&&!permission)throw fail('Record where the written permission is kept',422);
  intake.validateContent(a);intake.validateRights(a,basis);
  Object.assign(details,{basis,permission_reference:permission||null,license_url:a.rights?.license_url||null,attribution:a.rights?.attribution||null});
  Object.assign(record,{basis,permission_reference:permission||null});
 }else{
  if(att.confirmed!==true)throw fail('Explicit clinical review confirmation required',422);
  if(policy.clinical(a)&&!policy.evidence(a))throw fail('Clinical classification and versioned primary evidence required',422);
  const specialist=policy.specialist(a);
  if(specialist&&att.specialistRequirementsMet!==true)throw fail('Confirm the recorded specialist review requirements were completed for this revision',422);
  const conflict=clinicalIndependence(a,principal.id,expected,events);
  if(conflict)throw fail('An independent clinician is required: '+conflict,403);
  Object.assign(details,{specialist_requirement:specialist||null,specialist_requirements_attested:!!specialist,credential:principal.credential||null,credential_digest:principal.credentialDigest||null});
  Object.assign(record,{independent:true,specialistRequirementsAttested:!!specialist,credential_digest:principal.credentialDigest||null});
 }
 await capture(a);const event=await history.append(id,d.event,principal.id,expected,details);
 a[d.field]={...record,approved_at:event.recorded_at,reviewed_at:event.recorded_at,event:event.hash,step_up:details.step_up};
 await store.writeArticle('pending',id,a);return a;
});}
// Editorial approval only. Evidence and rights flags in confirmations are ignored:
// each of those approvals must be recorded separately by its own reviewer.
function review(id,expected,reviewer,confirmations){return approve(id,'editorial',expected,reviewer,confirmations);}
function clinicalReview(id,expected,principal,confirmation){return approve(id,'clinical',expected,principal,typeof confirmation==='object'&&confirmation?confirmation:{confirmed:confirmation===true});}
async function publish(id,actor='local-publication-service') {return locked(id,async()=>{
 const a=await store.readArticle('pending',id),hash=revision(a),events=await history.read(id);
 require('./treatments').validate(a);require('./substance-alerts').validate(a);
 const ok=kind=>valid(a,kind,hash,events).status==='valid';
 if(!ok('editorial'))throw fail('Review this exact draft before publication');
 if(policy.clinicalApprovalRequired(a)&&(!ok('clinical')||clinicalIndependence(a,a.clinical_review.reviewer,hash,events)||(policy.clinical(a)&&!policy.evidence(a))))throw fail('Independent verified clinical review required',422);
 if(!ok('evidence'))throw fail('Evidence approval for this exact revision is required before publication',422);
 if(!ok('rights'))throw fail('Source-rights approval for this exact revision is required before publication',422);
 intake.validate(a);
 if(a.outbreak)require('./outbreaks').validate(a);
 await capture(a);
 if(await store.articleExists('approved',id))await capture(await store.readArticle('approved',id));
 const published={...a,status:'approved',published_at:new Date().toISOString()};
 const intent=await history.append(id,'publication_requested',actor,hash,{review_event:a.review.event,clinical_event:policy.clinicalApprovalRequired(a)?a.clinical_review.event:null,evidence_event:a.evidence_review.event,rights_event:a.rights_review.event});
 await store.writeArticle('approved',id,published,require('./publication-capability'));
 await history.append(id,'published',actor,hash,{request_event:intent.hash});
 await store.deleteArticle('pending',id);return published;
});}
async function unpublish(id,actor,reason){return locked(id,async()=>{if(!String(reason||'').trim())throw fail('Withdrawal reason required',422);const a=await store.readArticle('approved',id);await capture(a);await history.append(id,'withdrawal_requested',actor,revision(a),{reason});if(!await store.articleExists('pending',id))await store.writeArticle('pending',id,{...a,status:'pending',...CLEARED});await store.deleteArticle('approved',id);await history.append(id,'withdrawn',actor,revision(a),{reason});return a;});}
async function generate(id, expected, generator) {return locked(id,async()=>{
 if(process.env.ALLOW_MODEL_CALLS!=='true') throw fail('Model calls disabled',403);
 const a=await store.readArticle('pending',id); if(expected!==revision(a)) throw fail('Draft changed');
 const body=await generator(a); const draft={...a,body:sanitize(body),...CLEARED,generated_by:'model',generated_at:new Date().toISOString()};
 await capture(a);await capture(draft);await invalidate(id,a,'model',revision(draft),'model_draft_generated');await history.append(id,'model_draft_generated','model',revision(draft),{previous_revision:expected});
 await store.writeArticle('pending',id,draft); return draft;
});}
module.exports={locked,content,revision,sanitize,preview,edit,approve,review,clinicalReview,approvalStatus,status,publish,unpublish,generate,APPROVAL_FIELDS};
