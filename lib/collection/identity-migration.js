const crypto=require('crypto'),state=require('./state');
// Explicit operator migration only. Never invoked by collection or startup.
async function prepare({apply=false}={}){
 return state.exclusive(async()=>{const key='source-fda-shortages',saved=await state.read(key,null);if(!saved?.scan)return{needed:false};if(saved.scan.identity_version===2)return{needed:false,archive:saved.identity_archive||null};
 const hash=crypto.createHash('sha256').update(JSON.stringify(saved)).digest('hex'),archive='identity-v1-fda-shortages-'+hash;
 const report={needed:true,old_queued:saved.queue?.length||0,archive,sha256:hash,action:'archive exact old state; replay original bounded window with v2 identities',applied:false};if(!apply)return report;
 const old=await state.read(archive,null);if(old&&JSON.stringify(old)!==JSON.stringify(saved))throw Error('Migration archive conflict');if(!old)await state.write(archive,saved);
 const reread=await state.read(archive);if(crypto.createHash('sha256').update(JSON.stringify(reread)).digest('hex')!==hash)throw Error('Archive verification failed');
 const source=require('../../config/source-registry').find(s=>s.id==='fda-shortages'),scan=require('./pagination').begin(source,{},Date.parse(saved.scan.to));scan.from=saved.scan.from;scan.to=saved.scan.to;scan.day=saved.scan.to;
 await state.write(key,{queue:[],scan,identity_archive:archive,identity_archive_count:saved.queue?.length||0,identity_migration:'v1_queued_records_preserved_in_archive_replay_required'});
 return{...report,applied:true};});
}
module.exports={prepare};
