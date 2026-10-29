// Deliberate first production rollout: no collection/models/schedulers, even if
// inherited legacy configuration contains enabled flags. Activation needs a later release.
require('../scripts/check-runtime').checkRuntime();
for(const key of ['RUN_SCHEDULED_JOBS','RUN_NEWS_SCHEDULE','ALLOW_COLLECTION','ALLOW_MODEL_CALLS','RUN_ANTIBIOTIC_SCHEDULE','ALLOW_ANTIBIOTIC_WATCH'])process.env[key]='false';
process.env.TZ='UTC';
const path=require('node:path');
const root=path.resolve(__dirname,'../content');
require('../lib/durable-init').initialize(root).then(async dir=>{
 process.env.CONTENT_DIR=dir;
 const result=await require('./check-content-integrity').check();
 if(!result.ok)throw new Error('Content integrity check failed; refuse public startup');
 process.env.HOST='0.0.0.0';
 console.log('Durable review store ready; collection and models disabled');
 require('../server');
}).catch(e=>{console.error('Review startup refused:',e.message);process.exitCode=1;});
