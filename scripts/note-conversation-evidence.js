// Adds a read-only pointer to conversation evidence (for example a clinician's chat
// message) to an article's audit history. It never records an approval, never edits
// the article, and the publication service ignores it. Stop all writers first.
// Usage: node scripts/note-conversation-evidence.js ARTICLE_ID EVIDENCE.json --writers-stopped
const fs=require('fs/promises'),crypto=require('crypto'),history=require('../lib/history');
async function note(id,file,stopped){
 if(stopped!==true)throw new Error('Stop all writers and attest explicitly');
 const raw=await fs.readFile(file),e=JSON.parse(raw.toString('utf8')),sha=crypto.createHash('sha256').update(raw).digest('hex');
 if(e.record_type!=='conversation_evidence_only_not_application_approval'||e.application_review_recorded!==false||e.technical_identity_verified!==false)throw new Error('Only explicitly non-approving conversation evidence can be noted');
 const entry=e.article_id===id?{revision:e.revision}:(e.revisions||[]).find(r=>r.id===id);
 if(!entry||!/^[a-f0-9]{64}$/.test(entry.revision||''))throw new Error('Evidence does not name a revision for this article');
 await history.revisionRecord(id,entry.revision);
 const events=await history.read(id);
 if(events.some(x=>x.type==='conversation_evidence_noted'&&x.details.evidence_sha256===sha))return{id,noted:false,reason:'already noted'};
 const event=await history.append(id,'conversation_evidence_noted','evidence-archive',entry.revision,{evidence_sha256:sha,record_type:e.record_type,attestor_display_name:String(e.attestor_display_name||'').slice(0,100),attestation_verbatim:String(e.attestation_verbatim||'').slice(0,500),scope:String(e.scope||'').slice(0,500),evidence_recorded_at:e.recorded_at||null,counts_as_approval:false,technical_identity_verified:false});
 return{id,noted:true,revision:entry.revision,event:event.hash};
}
if(require.main===module){const [id,file,flag]=process.argv.slice(2);note(id,file,flag==='--writers-stopped').then(r=>console.log(JSON.stringify(r))).catch(err=>{console.error(err.message);process.exitCode=1;});}
module.exports={note};
