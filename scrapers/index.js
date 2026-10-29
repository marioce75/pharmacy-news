const sources = require('../config/sources');
const base = require('./base-scraper');
const store = require('../lib/store');
const dedup = require('../lib/dedup');
const {tagArticle}=require('../lib/peptide-tagger');
function sourceURL(url){try{const u=new URL(url);return u.origin+u.pathname;}catch{return null;}}
async function collectSource(source, fetcher) {
 const run={source:source.name,url:sourceURL(source.url),started_at:new Date().toISOString(),count:0};
 try {const articles=await fetcher();run.count=articles.length;run.failed_queries=articles.sourceFailures||0;run.status=run.failed_queries?(articles.length?'partial':'failed'):(articles.length?'success':'empty');return {articles,run};}
 catch(e){run.status='failed';run.error_class=/^[A-Za-z]+Error$/.test(e.name)?e.name:'Error';run.error_message='Source retrieval or normalization failed';return {articles:[],run};}
 finally{run.completed_at=new Date().toISOString();}
}
async function runCategory(category, config, deps=base) {
 const articles=[],sourceRuns=[];
 for(const source of config){const result=await collectSource(source,async()=>{
 const items=source.type==='rss'?await deps.fetchRSS(source.url,source.keywords):await deps.fetchWeb(source.url,source.selector);
 return items.map(item=>{const a=deps.buildArticleObject(item,category,source.name);tagArticle(a);return a;});});articles.push(...result.articles);sourceRuns.push(result.run);}
 return {articles,sourceRuns};
}
function runStatus(runs, otherErrors=0){const failed=runs.filter(r=>r.status==='failed').length;const partial=runs.some(r=>r.status==='partial');return runs.length&&failed===runs.length?'failed':failed||partial||otherErrors?'completed_with_errors':'success';}
async function runAll(deps={}) {
 if(!Object.keys(deps).length)return require('../lib/collection/runner').run();
 if(process.env.ALLOW_COLLECTION!=='true')throw Object.assign(new Error('Collection disabled'),{status:403});
 const sourceRuns=[],articles=[],newIds=[],seen=new Set();let duplicates=0,validationErrors=0,processingErrors=0;
 const catalog=deps.sources||sources;
 for(const [category,config] of Object.entries(catalog)){const r=await runCategory(category,config,deps.base||base);articles.push(...r.articles);sourceRuns.push(...r.sourceRuns);}
 const specialty=deps.specialty||[
 {name:'PubMed peptide search',url:'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/',fetch:()=>require('./peptide-pubmed').fetchAll()},
 {name:'ClinicalTrials.gov peptide search',url:'https://clinicaltrials.gov/api/v2/studies',fetch:()=>require('./peptide-trials').fetchAll()}];
 for(const s of specialty){const r=await collectSource(s,s.fetch);sourceRuns.push(r.run);articles.push(...r.articles);}
 for(const a of articles){
 if(!/^https?:\/\//.test(a.source_url||'')){validationErrors++;continue;}
 if(a.provenance?.publication_date_status==='invalid')validationErrors++;
 try{
 const u=new URL(a.source_url);u.hash='';for(const key of [...u.searchParams.keys()])if(key.startsWith('utm_')||key==='fbclid')u.searchParams.delete(key);const canonical=u.toString();
 if(seen.has(canonical)||await (deps.dedup||dedup).isDuplicate(a)){duplicates++;continue;}seen.add(canonical);
 if(!a.provenance){const normalized=base.buildArticleObject({title:a.title,link:a.source_url,date:a.date_published},a.category,a.source);for(const k of ['schema_version','provenance','geography','rights','evidence','content_kind'])a[k]=normalized[k];}
 a.provenance.canonical_url=canonical;
 await (deps.store||store).writeArticle('pending',a.id,a);newIds.push(a.id);dedup.clearCache();
 }catch{processingErrors++;}
 }
 let model={scored:0,errors:0,slateGenerated:false};
 if(newIds.length&&process.env.ALLOW_MODEL_CALLS==='true'){try{model=await (deps.editor||require('../lib/pharmeditor')).analyze(newIds);}catch{model.errors=1;}}
 const sourceErrors=sourceRuns.filter(r=>['failed','partial'].includes(r.status)).length;const errors=sourceErrors+validationErrors+processingErrors+model.errors;
 return {newArticles:newIds.length,duplicates,newIds,sourceRuns,sourceErrors,validationErrors,processingErrors,errors,pharmeditor_scored:model.scored,pharmeditor_errors:model.errors,slate_generated:model.slateGenerated,status:runStatus(sourceRuns,validationErrors+processingErrors+model.errors)};
}
module.exports={runAll,runCategory,collectSource,runStatus};
