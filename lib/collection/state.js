const fs=require('fs/promises'),path=require('path'),crypto=require('crypto');
const root=()=>path.join(process.env.CONTENT_DIR||path.join(__dirname,'../../content'),'collection');
async function read(name,fallback){try{return JSON.parse(await fs.readFile(path.join(root(),name+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
async function write(name,data){await require('../fsync').ensureDirectory(root());await require('../store').durableReplace(path.join(root(),name+'.json'),JSON.stringify(data,null,2)+'\n');}
async function exclusive(fn){await fs.mkdir(root(),{recursive:true});const lock=path.join(root(),'run.lock');try{await fs.mkdir(lock);}catch(e){if(e.code==='EEXIST')throw Object.assign(new Error('Collection ownership lock exists; verify owner before manual recovery'),{code:'RUN_LOCKED'});throw e;}
 try{await fs.writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,started_at:new Date().toISOString(),token:crypto.randomUUID(),host:require('os').hostname()}));return await fn();}finally{await fs.rm(lock,{recursive:true,force:true});}}
// Who holds the run lock, if anyone. A lock without owner.json was taken by a process that
// stopped before recording itself; its directory time is the best available start time.
async function lockOwner(){const lock=path.join(root(),'run.lock');let st;try{st=await fs.stat(lock);}catch(e){if(e.code==='ENOENT')return null;throw e;}
 try{return JSON.parse(await fs.readFile(path.join(lock,'owner.json'),'utf8'));}catch{return{pid:null,host:null,started_at:st.mtime.toISOString(),owner_record:'missing'};}}
// Operator recovery after a crash: a lock is released only when it is older than the maximum
// run time and its owner process is not alive on this host. The lock is moved aside, not deleted.
async function releaseStaleLock({now=Date.now(),maxAgeMs=30*60000,alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}}={}){
 const owner=await lockOwner();if(!owner)return{released:false,reason:'no_lock'};
 const age=now-Date.parse(owner.started_at);if(!(age>maxAgeMs))return{released:false,reason:'lock_not_old_enough',owner};
 if(owner.pid&&owner.host===require('os').hostname()&&alive(owner.pid))return{released:false,reason:'owner_process_alive',owner};
 const dest=path.join(root(),'recovered-locks','run.lock-'+new Date(now).toISOString().replace(/[:.]/g,'-'));await fs.mkdir(path.dirname(dest),{recursive:true});await fs.rename(path.join(root(),'run.lock'),dest);
 await require('../fsync').syncDirectory(root());return{released:true,moved_to:path.relative(root(),dest),owner};}
module.exports={root,read,write,exclusive,lockOwner,releaseStaleLock};
