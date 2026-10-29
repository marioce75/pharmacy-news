// Validates the reviewer registry named by REVIEWER_REGISTRY_FILE (or the path given)
// and reports each account's roles and clinical-credential status. Never prints
// password hashes or licence numbers.
// Usage: node scripts/check-reviewers.js [/absolute/path/reviewers.json]
require('dotenv').config();
const reviewers=require('../lib/reviewers');
if(process.argv[2])process.env.REVIEWER_REGISTRY_FILE=process.argv[2];
try{
 const accounts=reviewers.load();
 if(!accounts.length)console.log('No reviewer registry configured; only the shared administrator login (no clinical role) is available.');
 for(const a of accounts){const c=reviewers.credentialStatus(a);console.log(JSON.stringify({id:a.id,display_name:a.display_name,roles:a.roles,disabled:a.disabled,clinical_credential_verified:c.verified,clinical_credential_issue:c.verified?null:c.reason,credential:c.verified?{profession:c.summary.profession,jurisdiction:c.summary.jurisdiction,verified_by:c.summary.verified_by,verified_at:c.summary.verified_at,expires_at:c.summary.expires_at}:null}));}
}catch(e){console.error(e.code==='REVIEWER_REGISTRY_INVALID'?e.message:'Reviewer registry could not be read: '+(e.code||'error'));process.exitCode=1;}
