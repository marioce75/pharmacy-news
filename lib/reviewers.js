// Per-person reviewer accounts, read from an owner-managed JSON file named by
// REVIEWER_REGISTRY_FILE. The file is configuration, not content: the app never
// writes it, never returns it from an API and never logs hashes or licence data.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROLES=new Set(['editor','evidence_reviewer','rights_reviewer','clinical_reviewer']);
const RESERVED=new Set(['codex-assistant','model','local-publication-service','legacy-import','evidence-archive','unattributed-local-edit','admin']);
const ID=/^[a-z0-9][a-z0-9._-]{1,63}$/,DAY=/^\d{4}-\d{2}-\d{2}$/;
const BCRYPT=/^\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/;
let cache=null;
const fail=m=>Object.assign(new Error('Reviewer registry invalid: '+m),{status:500,code:'REVIEWER_REGISTRY_INVALID'});
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
function stable(v){if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));return v;}
const text=(v,max=200)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
function validate(data,legacyAdmin=process.env.ADMIN_USERNAME){
 if(!data||!Array.isArray(data.reviewers))throw fail('expected {"reviewers":[...]}');
 const ids=new Set();
 return data.reviewers.map((r,i)=>{
  const at=`entry ${i+1}`;
  if(!r||typeof r!=='object')throw fail(at+' is not an object');
  if(!ID.test(r.id||'')||RESERVED.has(r.id))throw fail(at+' has an invalid or reserved id');
  if(r.id===legacyAdmin)throw fail(at+' reuses ADMIN_USERNAME; give each person a distinct id');
  if(ids.has(r.id))throw fail(at+' duplicates an id');ids.add(r.id);
  if(!text(r.display_name,100))throw fail(at+' needs display_name');
  if(!BCRYPT.test(r.password_hash||''))throw fail(at+' needs a bcrypt password_hash');
  if(!Array.isArray(r.roles)||!r.roles.length||r.roles.some(x=>!ROLES.has(x))||new Set(r.roles).size!==r.roles.length)throw fail(at+' has invalid roles');
  if(r.disabled!==undefined&&typeof r.disabled!=='boolean')throw fail(at+' disabled must be true or false');
  if(r.clinical_credential!==undefined&&(typeof r.clinical_credential!=='object'||r.clinical_credential===null))throw fail(at+' clinical_credential must be an object');
  return Object.freeze({id:r.id,display_name:r.display_name.trim(),password_hash:r.password_hash,roles:Object.freeze([...r.roles]),disabled:r.disabled===true,clinical_credential:r.clinical_credential?Object.freeze({...r.clinical_credential}):null});
 });
}
function load(){
 const file=process.env.REVIEWER_REGISTRY_FILE;
 if(!file)return[];
 if(!path.isAbsolute(file))throw fail('REVIEWER_REGISTRY_FILE must be an absolute path');
 const st=fs.statSync(file);
 if(!st.isFile())throw fail('registry path is not a regular file');
 // Anyone who can write this file can grant roles, so refuse group/other-writable files.
 if(st.mode&0o022)throw fail('registry file must not be writable by group or others');
 const key=[file,st.ino,st.size,st.mtimeMs,process.env.ADMIN_USERNAME||''].join(':');
 if(cache?.key===key)return cache.accounts;
 const accounts=validate(JSON.parse(fs.readFileSync(file,'utf8')));
 cache={key,accounts};return accounts;
}
function find(id){return typeof id==='string'?load().find(a=>a.id===id)||null:null;}
// Binds a session to the password hash it was issued under; changing the hash ends old sessions.
function credentialDigest(hash){return sha('pharmacynews-session-binding:'+String(hash||''));}
function today(now=new Date()){return now.toISOString().slice(0,10);}
// A clinical credential counts only when someone other than the reviewer recorded
// an official licence lookup that is dated, not in the future and not expired.
function credentialStatus(account,now=new Date()){
 const c=account?.clinical_credential;
 if(!account?.roles?.includes('clinical_reviewer'))return{verified:false,reason:'Account does not hold the clinical_reviewer role'};
 if(!c)return{verified:false,reason:'No clinical credential verification is recorded for this account'};
 const missing=['profession','jurisdiction','license_reference','verified_by'].filter(k=>!text(c[k]));
 if(missing.length)return{verified:false,reason:'Credential record is missing '+missing.join(', ')};
 if(!/^https:\/\//.test(c.verification_url||''))return{verified:false,reason:'Credential record needs an https verification_url for the official licence lookup'};
 if(c.verified_by.trim()===account.id||c.verified_by.trim()===account.display_name)return{verified:false,reason:'A credential cannot be verified by the reviewer it belongs to'};
 for(const k of ['verified_at','expires_at'])if(!DAY.test(c[k]||'')||!Number.isFinite(Date.parse(c[k])))return{verified:false,reason:`Credential record needs ${k} as YYYY-MM-DD`};
 if(c.verified_at>today(now))return{verified:false,reason:'Credential verification date is in the future'};
 if(c.expires_at<=today(now))return{verified:false,reason:'Clinical credential has expired or verification lapsed'};
 const summary={profession:c.profession.trim(),jurisdiction:c.jurisdiction.trim(),verification_url:c.verification_url,verified_by:c.verified_by.trim(),verified_at:c.verified_at,expires_at:c.expires_at};
 // The digest ties approvals to the exact credential record without copying the licence number into history.
 return{verified:true,summary,digest:sha(JSON.stringify(stable(c)))};
}
module.exports={ROLES,validate,load,find,credentialDigest,credentialStatus};
