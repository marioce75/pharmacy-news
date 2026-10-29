// Production startup: models, the antibiotic watcher and any inherited legacy flags stay off;
// collection follows the explicit owner-approved policy below.
require('../scripts/check-runtime').checkRuntime();
for(const key of ['ALLOW_MODEL_CALLS','RUN_ANTIBIOTIC_SCHEDULE','ALLOW_ANTIBIOTIC_WATCH'])process.env[key]='false';
// Owner-approved 2026-10-29: bounded official-source metadata collection every six hours (UTC),
// rotating through verified sources into pending only. Models and publishing stay off.
// Set COLLECTION_PAUSED=true in the service environment to stop collection without a code change.
const paused=process.env.COLLECTION_PAUSED==='true';
Object.assign(process.env,{ALLOW_COLLECTION:String(!paused),RUN_SCHEDULED_JOBS:String(!paused),RUN_NEWS_SCHEDULE:String(!paused),NEWS_SOURCE_IDS:'rotation:worldwide'});
process.env.TZ='UTC';
const path=require('node:path');
const root=path.resolve(__dirname,'../content');
require('../lib/durable-init').initialize(root).then(async dir=>{
 process.env.CONTENT_DIR=dir;
 const result=await require('./check-content-integrity').check();
 if(!result.ok)throw new Error('Content integrity check failed; refuse public startup');
 process.env.HOST='0.0.0.0';
 console.log('Durable review store ready; models disabled; collection',paused?'paused':'every 6 hours (rotation:worldwide)');
 require('../server');
}).catch(e=>{console.error('Review startup refused:',e.message);process.exitCode=1;});
