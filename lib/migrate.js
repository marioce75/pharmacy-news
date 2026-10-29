#!/usr/bin/env node
const fs=require('fs/promises'),path=require('path');
const store=require('./store'),pub=require('./publication'),history=require('./history');
async function migrate({apply=false}={}) {
 const entries=[];
 for(const status of ['pending','approved','declined']) {
  let names;try{names=await fs.readdir(store.DIRS[status]);}catch(e){if(e.code==='ENOENT')continue;throw e;}
  for(const name of names.filter(n=>n.endsWith('.json'))){const article=JSON.parse(await fs.readFile(path.join(store.DIRS[status],name),'utf8'));if(!/^[a-zA-Z0-9_-]+$/.test(article.id)||name!==article.id+'.json')throw new Error('Migration preflight: article ID mismatch');entries.push({status,article});}
 }
 // Validate every existing audit chain before writing any import.
 for(const {article} of entries)await history.read(article.id);
 if(!apply)return {dry_run:true,articles:entries.length,seeded:0};
 let seeded=0;
 for(const {status,article} of entries)await pub.locked(article.id,async()=>{
  const hash=pub.revision(article),events=await history.read(article.id);
  if(events.some(e=>e.type==='legacy_import'&&e.revision===hash&&e.details.status===status))return;
  await history.snapshot(article.id,hash,pub.content(article));
  await history.append(article.id,'legacy_import','migration:v3',hash,{status,review_status:'not_verified_by_migration'});seeded++;
 });
 return {dry_run:false,articles:entries.length,seeded};
}
async function cli(args=process.argv.slice(2)) {
 if(args.some(a=>!['--apply','--dry-run'].includes(a)) || (args.includes('--apply') && args.includes('--dry-run')))throw new Error('Usage: node lib/migrate.js [--dry-run | --apply]');
 if(args.includes('--apply') && (!process.env.CONTENT_DIR || !path.isAbsolute(process.env.CONTENT_DIR)))throw new Error('--apply requires an explicit absolute CONTENT_DIR; stop writers and back up that directory first');
 return migrate({apply:args.includes('--apply')});
}
if(require.main===module)cli().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error('Migration failed:',e.message);process.exitCode=1;});
module.exports={migrate};
