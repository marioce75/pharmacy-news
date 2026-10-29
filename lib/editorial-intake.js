const registry=require('../config/source-registry');
const RIGHTS_BASES=['reviewed_for_original_summary','permission_obtained'];
// The rights decision lives in the authenticated rights approval, so a reviewer can
// approve rights without editing the draft (which would invalidate other approvals).
// Content written before separate approvals may still carry the basis in rights.status.
function rightsBasis(a){return a.rights_review?.basis||a.rights?.status;}
function validate(a){validateContent(a);validateRights(a,rightsBasis(a));}
function validateContent(a){
 if(!a.ingestion?.requires_original_summary)return;
 const published=a.provenance?.published_at;
 if(published&&(!Number.isFinite(Date.parse(published))||Date.parse(published)>Date.now()))throw new Error('Verify source publication date: invalid or future issue dates cannot be published as current news');
 const source=registry.find(s=>s.id===a.ingestion.source_id);
 if(!source||source.access==='prohibited')throw new Error('Source is not permitted for publication');
 if(!a.editorial?.original_summary||a.summary?.trim().length<40||!a.rights?.license_url||!a.rights?.attribution)throw new Error('Original summary, recorded source rights reference and attribution required');
 if(a.translation?.required&&(!a.editorial.translation_reviewed||!a.translation.original_language||!a.translation.target_language))throw new Error('Human translation review and both languages required');
 if(!/^https:\/\//.test(a.rights.license_url))throw new Error('HTTPS rights reference required');
 require('./outbreaks').validate(a);
}
function validateRights(a,basis){
 if(!a.ingestion?.requires_original_summary)return;
 const source=registry.find(s=>s.id===a.ingestion.source_id);
 if(!RIGHTS_BASES.includes(basis))throw new Error('Original summary, recorded source rights basis and attribution required');
 if(source?.rights?.status==='commercial_permission_review'&&basis!=='permission_obtained')throw new Error('Document source-specific commercial permission before publication');
}
module.exports={validate,validateContent,validateRights,rightsBasis,RIGHTS_BASES};
