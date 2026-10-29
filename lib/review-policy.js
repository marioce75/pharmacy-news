const clinicalKinds=new Set(['clinical','treatment','dosing','guidance']);
function clinical(a){return a.requires_clinical_review===true||clinicalKinds.has(a.content_kind)||/\b(dos(?:e|ing|age)|treatment (?:protocol|guidance)|mg\s*\/\s*kg|administer\s+\d)/i.test([a.title,a.summary,a.body].join(' '));}
function human(principal,role='editor'){return principal&&principal.type==='human'&&typeof principal.id==='string'&&principal.id.length>0&&principal.roles?.includes(role)&&principal.authenticated===true;}
function evidence(a){const e=a.evidence;if(!e||!['guideline','systematic_review','primary_trial'].includes(e.level)||!e.jurisdiction||!Array.isArray(e.primary_guidelines)||!e.primary_guidelines.length)return false;return e.primary_guidelines.every(g=>/^https:\/\//.test(g.url||'')&&g.issuer&&g.version&&/^\d{4}-\d{2}-\d{2}$/.test(g.published_at||'')&&Number.isFinite(Date.parse(g.published_at))&&Date.parse(g.published_at)<=Date.now());}
// Four separate approvals, each held by a role and pinned to one content revision.
const APPROVALS=Object.freeze({
 editorial:{field:'review',event:'editorial_review',role:'editor',label:'Editorial'},
 evidence:{field:'evidence_review',event:'evidence_review',role:'evidence_reviewer',label:'Evidence'},
 rights:{field:'rights_review',event:'rights_review',role:'rights_reviewer',label:'Source rights'},
 clinical:{field:'clinical_review',event:'clinical_review',role:'clinical_reviewer',label:'Clinical'}
});
function specialist(a){return String(a.editorial?.specialist_review_requirements||'').trim();}
// Clinical content, and any draft whose recorded specialist requirement must be met,
// needs a credential-verified clinical reviewer rather than an editor's self-attestation.
function clinicalApprovalRequired(a){return clinical(a)||!!specialist(a);}
function requiredApprovals(a){return['editorial','evidence','rights',...(clinicalApprovalRequired(a)?['clinical']:[])];}
module.exports={clinical,human,evidence,APPROVALS,specialist,clinicalApprovalRequired,requiredApprovals};
