const {test,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('fs/promises'),path=require('path'),os=require('os');
const {spawnSync}=require('node:child_process');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const root=require('fs').mkdtempSync(path.join(os.tmpdir(),'pharmacy-migration-validation-'));
process.env.CONTENT_DIR=root;
const store=require('../lib/store'),pub=require('../lib/publication'),history=require('../lib/history');
const {migrate}=require('../lib/migrate');
const {checkRuntime}=require('../scripts/check-runtime');
const cwd=path.resolve(__dirname,'..');
const cli=(args=[],content=root)=>spawnSync(process.execPath,['lib/migrate.js',...args],{cwd,encoding:'utf8',env:{PATH:process.env.PATH,CONTENT_DIR:content,ALLOW_COLLECTION:'false',ALLOW_MODEL_CALLS:'false',RUN_SCHEDULED_JOBS:'false'}});
after(()=>fs.rm(root,{recursive:true,force:true}));
async function files(dir){const result={};for(const entry of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory()){for(const [k,v]of Object.entries(await files(p)))result[entry.name+'/'+k]=v;}else result[entry.name]=await fs.readFile(p,'utf8');}return result;}
test('runtime pins agree and mismatched runtime is rejected before build',async()=>{
 const p=require('../package.json'),lock=require('../package-lock.json');
 assert.equal(p.engines.node,'24.22.1');assert.equal(lock.packages[''].engines.node,p.engines.node);
 assert.equal((await fs.readFile(path.join(cwd,'.node-version'),'utf8')).trim(),p.engines.node);
 assert.equal(checkRuntime('24.22.1'),'24.22.1');assert.throws(()=>checkRuntime('25.8.0'),/NODE_VERSION/);
 const yaml=await fs.readFile(path.join(cwd,'render.yaml'),'utf8');assert.match(yaml,/buildCommand: node scripts\/check-runtime.js && npm ci/);assert.doesNotMatch(yaml,/migrate/);
});
test('empty migration CLI is non-seeding and apply requires explicit target',async()=>{
 assert.equal(cli().status,0);assert.deepEqual(await files(root),{});
 assert.equal(cli(['--apply']).status,0);assert.deepEqual(await files(root),{});
 assert.notEqual(cli(['--apply'],'').status,0);assert.notEqual(cli(['--apply'],'relative').status,0);
 assert.notEqual(cli(['--apply','--dry-run']).status,0);assert.notEqual(cli(['--aply']).status,0);
});
test('migration preserves published revision, approval and all existing history; repeat is byte-idempotent',async()=>{
 const a={id:'reviewed-migration-fixture',title:'Synthetic news',content_kind:'news',body:'<p>'+('Synthetic fixture only. '.repeat(15))+'</p>',source_url:'https://example.org/fixture',status:'pending'};
 const editor={id:'fixture-editor',type:'human',authenticated:true,roles:['editor']};
 await store.writeArticle('pending',a.id,a);await pub.review(a.id,pub.revision(a),editor,{confirmed:true,evidenceChecked:true,rightsChecked:true,contentKind:'news'});await require('./approval-fixture').sourceApprovals(pub,a.id);await pub.publish(a.id,editor.id);
 const before=await files(root),events=await history.read(a.id);
 assert.equal(cli(['--dry-run']).status,0);assert.deepEqual(await files(root),before);
 assert.equal(cli(['--apply']).status,0);const imported=await files(root);
 for(const [name,bytes]of Object.entries(before))assert.equal(imported[name],bytes,name);
 assert.deepEqual((await history.read(a.id)).slice(0,events.length),events);
 assert.equal(cli(['--apply']).status,0);assert.deepEqual(await files(root),imported);
});
test('corrupt history aborts migration before any import writes',async()=>{
 const p=path.join(root,'history','reviewed-migration-fixture','events','00000001.json');await fs.writeFile(p,'{}');
 const before=await files(root);await assert.rejects(migrate({apply:true}),/integrity/);assert.deepEqual(await files(root),before);
});
test('empty production-mode fixture starts without seeds or migration and serves public pages',async()=>{
 const empty=await fs.mkdtemp(path.join(os.tmpdir(),'pharmacy-empty-start-'));
 const child=spawn(process.execPath,['server.js'],{cwd,env:{PATH:process.env.PATH,CONTENT_DIR:empty,PORT:'0',NODE_ENV:'production',SESSION_SECRET:'synthetic-fixture-only-not-a-real-secret',ALLOW_COLLECTION:'false',ALLOW_MODEL_CALLS:'false',RUN_SCHEDULED_JOBS:'false'},stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit');let output='';child.stderr.on('data',()=>{});
 try {
  const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Fixture startup timeout')),10000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Fixture exited before listening'));});child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});});
  assert.equal((await fetch(url+'/health')).status,200);
  const response=await fetch(url+'/');assert.equal(response.status,200);assert.match(await response.text(),/Global pharmacy monitor/);
  for(const status of ['pending','approved','declined'])assert.deepEqual(await fs.readdir(path.join(empty,status)),[]);
  await assert.rejects(fs.access(path.join(empty,'history')));
 } finally {child.kill('SIGTERM');await exited;await fs.rm(empty,{recursive:true,force:true});}
});
