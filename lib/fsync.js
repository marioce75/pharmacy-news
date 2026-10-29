const fs=require('fs').promises,path=require('path');
// A rename or link is durable only after its directory is flushed. Only "not supported
// on this filesystem" results are tolerated; real I/O errors propagate because the
// change may not survive a crash and the caller must not report success.
const UNSUPPORTED=new Set(['EINVAL','ENOTSUP','EOPNOTSUPP','EISDIR']);
let warned=false;
function tolerated(e){return UNSUPPORTED.has(e?.code)||(process.platform==='win32'&&e?.code==='EPERM');}
function note(e){if(warned)return;warned=true;console.warn(`[STORE] Directory fsync unsupported here (${e.code}); renames may not survive power loss`);}
async function syncDirectory(dir){
 let h;
 try{h=await fs.open(dir,'r');}catch(e){if(tolerated(e))return note(e);throw e;}
 try{await h.sync();}catch(e){if(!tolerated(e))throw e;note(e);}finally{await h.close();}
}
// Creates missing directories and flushes each new entry into its parent.
async function ensureDirectory(dir){
 const first=await fs.mkdir(dir,{recursive:true});
 if(!first)return;
 for(let d=path.resolve(dir);;d=path.dirname(d)){await syncDirectory(path.dirname(d));if(d===path.resolve(first))break;}
}
module.exports={syncDirectory,ensureDirectory,tolerated};
