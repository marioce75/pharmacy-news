const fs=require('fs/promises'),path=require('path'),crypto=require('crypto');
const root=()=>path.join(process.env.CONTENT_DIR||path.join(__dirname,'../../content'),'collection');
async function read(name,fallback){try{return JSON.parse(await fs.readFile(path.join(root(),name+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
async function write(name,data){await require('../fsync').ensureDirectory(root());await require('../store').durableReplace(path.join(root(),name+'.json'),JSON.stringify(data,null,2)+'\n');}
async function exclusive(fn){await fs.mkdir(root(),{recursive:true});const lock=path.join(root(),'run.lock');try{await fs.mkdir(lock);}catch(e){if(e.code==='EEXIST')throw Object.assign(new Error('Collection ownership lock exists; verify owner before manual recovery'),{code:'RUN_LOCKED'});throw e;}
 try{await fs.writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,started_at:new Date().toISOString(),token:crypto.randomUUID()}));return await fn();}finally{await fs.rm(lock,{recursive:true,force:true});}}
module.exports={root,read,write,exclusive};
