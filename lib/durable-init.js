const fs=require('node:fs/promises'),path=require('node:path');
const marker='pharmacynews-store.json';
async function initialize(root,{requireMount=true}={}){
 if(!path.isAbsolute(root))throw new Error('Absolute durable root required');
 const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Durable root must be a real directory');
 if(requireMount&&stat.dev===(await fs.stat(path.dirname(root))).dev)throw new Error('Persistent mount not detected; refusing ephemeral storage');
 const destination=path.join(root,'store-v1');
 const entries=await fs.readdir(root);
 if(entries.some(x=>!['store-v1','lost+found'].includes(x)))throw new Error('Unexpected existing storage; explicit recovery review required');
 try{await fs.mkdir(destination,{mode:0o700});await fs.writeFile(path.join(destination,marker),JSON.stringify({schema:1,purpose:'review-store',created_at:new Date().toISOString()})+'\n',{flag:'wx',mode:0o600});}
 catch(e){if(e.code!=='EEXIST')throw e;const st=await fs.lstat(destination);if(!st.isDirectory()||st.isSymbolicLink())throw new Error('Invalid store path');const m=JSON.parse(await fs.readFile(path.join(destination,marker),'utf8'));if(m.schema!==1||m.purpose!=='review-store')throw new Error('Unknown store marker');}
 for(const name of ['pending','approved','declined','history','slates','feedback'])await fs.mkdir(path.join(destination,name),{recursive:true,mode:0o700});
 const {syncDirectory}=require('./fsync');await syncDirectory(destination);await syncDirectory(root);
 return destination;
}
module.exports={initialize};
