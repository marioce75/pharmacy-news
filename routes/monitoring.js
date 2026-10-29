// Read-only admin views: feed health, coverage gaps and machine-suggested event candidates.
// Nothing here collects, edits, approves or publishes.
const express=require('express');
const router=express.Router();
const {requireAdmin}=require('../middleware/auth');
const coverage=require('../lib/collection/coverage'),candidates=require('../lib/events/candidates');
const {COUNTRIES,WHO_REGIONS}=require('../config/countries');
const FLAGS=['stale','future_dated','report_date_unknown','source_revised','translation_required','disease_not_identified','substance_not_identified','verify_human_or_animal_host','possibly_not_an_event','conflicting_counts_across_sources'];
const CATEGORIES=['new_psychoactive_substance','counterfeit_or_falsified','contamination_or_adulteration','dangerous_mixture','overdose_cluster','known_substance_alert','scheduling_action','unclassified'];
const one=(v,allowed)=>typeof v==='string'&&allowed.includes(v)?v:'';
router.use(['/monitoring','/monitoring.json','/events'],requireAdmin,(req,res,next)=>['GET','HEAD'].includes(req.method)?next():res.status(405).send('Read-only view'));
router.get('/monitoring.json',async(req,res,next)=>{try{res.set('Cache-Control','no-store').json(await coverage.report());}catch(e){next(e);}});
router.get('/monitoring',async(req,res,next)=>{try{res.set('Cache-Control','no-store').render('admin/monitoring',{r:await coverage.report()});}catch(e){next(e);}});
function filters(q){return{kind:one(q.kind,['outbreak','substance'])||'all',q:typeof q.q==='string'?q.q.slice(0,120):'',country:one(q.country,COUNTRIES.map(c=>c.iso2)),region:one(q.region,Object.keys(WHO_REGIONS)),
 sourceClass:one(q.source_class,['official_report','research','media']),flag:one(q.flag,FLAGS),category:one(q.category,CATEGORIES),statuses:q.include_approved==='yes'?['pending','approved']:['pending']};}
router.get('/events',async(req,res,next)=>{try{const f=filters(req.query);res.set('Cache-Control','no-store').render('admin/events',{rows:await candidates.list(f),f,flags:FLAGS,categories:CATEGORIES,countries:COUNTRIES,regions:WHO_REGIONS,detail:null});}catch(e){next(e);}});
router.get('/events/:id',async(req,res,next)=>{try{const all=await candidates.list({statuses:['pending','approved']}),detail=all.find(c=>c.id===req.params.id);if(!detail)return res.status(404).send('No event candidate for this record');
 res.set('Cache-Control','no-store').render('admin/events',{rows:[],f:filters({}),flags:FLAGS,categories:CATEGORIES,countries:COUNTRIES,regions:WHO_REGIONS,detail});}catch(e){next(e);}});
module.exports=router;
