const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {initialize}=require('../lib/durable-init');
test('durable initialization is empty, repeatable, preserves drafts and refuses unreviewed adoption',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pn-durable-'));
 try{
  await assert.rejects(initialize(root),/Persistent mount/);
  const dir=await initialize(root,{requireMount:false});
  assert.deepEqual(await fs.readdir(path.join(dir,'approved')),[]);
  await fs.writeFile(path.join(dir,'pending','fixture.json'),'preserve exactly');
  const marker=await fs.readFile(path.join(dir,'pharmacynews-store.json'),'utf8');
  assert.equal(await initialize(root,{requireMount:false}),dir);
  assert.equal(await fs.readFile(path.join(dir,'pending','fixture.json'),'utf8'),'preserve exactly');
  assert.equal(await fs.readFile(path.join(dir,'pharmacynews-store.json'),'utf8'),marker);
  await fs.writeFile(path.join(root,'unexpected.json'),'legacy');
  await assert.rejects(initialize(root,{requireMount:false}),/Unexpected existing/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('backup and restoration preserve exact bytes in new targets without approving legacy content',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pn-recovery-'));const recovery=require('../scripts/content-recovery');
 try{
  const source=path.join(root,'source');await fs.mkdir(path.join(source,'pending'),{recursive:true});await fs.writeFile(path.join(source,'pending','example.json'),'{"id":"example","status":"pending"}');
  const backup=path.join(root,'backup'),restored=path.join(root,'restored');await recovery.snapshot(source,backup,true);await recovery.restore(backup,restored,true);
  assert.deepEqual(await recovery.inventory(source),await recovery.inventory(restored));
  await assert.rejects(recovery.restore(backup,restored,true));
  await assert.rejects(fs.access(path.join(restored,'approved')));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
