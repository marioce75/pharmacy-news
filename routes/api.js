const express = require('express');
const router = express.Router();
const store = require('../lib/store');
const { requireAdminApi, identity, reauthenticate } = require('../middleware/auth');
const policy = require('../lib/review-policy');

router.use('/admin', requireAdminApi);

const publication = require('../lib/publication');
router.use('/admin', (req,res,next)=>{
 if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.get('origin') !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({error:'Same-origin request required'});
 next();
});
router.get('/admin/operations',async(req,res,next)=>{try{res.json(await require('../lib/operations').report());}catch(e){next(e);}});
router.get('/admin/collection',async(req,res,next)=>{try{res.json(await require('../lib/collection/runner').status());}catch(e){next(e);}});
router.get('/admin/review/:id', async(req,res,next)=>{try{res.json(await publication.preview(req.params.id));}catch(e){next(e);}});
// Each approval is signed by the signed-in reviewer: role and clinical credential come
// from server configuration only, and the reviewer re-enters their own password.
async function signApproval(req,res,kind,attestation){
 const principal=identity(req.session),role=policy.APPROVALS[kind]?.role;
 if(!role)return res.status(404).json({error:'Unknown approval type'});
 if(!policy.human(principal,role))return res.status(403).json({error:kind==='clinical'?'No independently verified clinician identity is available':`Your account does not hold the ${role} role`});
 if(kind==='clinical'&&principal.clinicalCredentialVerified!==true)return res.status(403).json({error:'No independently verified clinician identity is available: '+(principal.credentialIssue||'credential not verified')});
 const signed=await reauthenticate(req.session,req.body?.password);
 if(!signed)return res.status(401).json({error:'Re-enter your own password to sign this approval'});
 res.json(await publication.approve(req.params.id,kind,req.body.revision,signed,attestation));
}
router.get('/admin/approvals/:id',async(req,res,next)=>{try{const p=identity(req.session);res.json({...await publication.status(req.params.id),you:{id:p.id,display_name:p.displayName,identity_source:p.source,roles:p.roles,clinical_credential_verified:p.clinicalCredentialVerified,clinical_credential_issue:p.credentialIssue}});}catch(e){next(e);}});
router.post('/admin/approvals/:id/:kind',async(req,res,next)=>{try{await signApproval(req,res,req.params.kind,req.body?.attestation);}catch(e){next(e);}});
router.post('/admin/review/:id', async(req,res,next)=>{try{await signApproval(req,res,'editorial',req.body?.confirmations);}catch(e){next(e);}});
router.get('/admin/history/:id',async(req,res,next)=>{try{res.json(await require('../lib/history').read(req.params.id));}catch(e){next(e);}});
router.get('/admin/history/:id/revisions/:revision',async(req,res,next)=>{try{res.json(await require('../lib/history').revisionRecord(req.params.id,req.params.revision));}catch(e){next(e);}});
router.post('/admin/clinical-review/:id',async(req,res,next)=>{try{await signApproval(req,res,'clinical',{confirmed:req.body?.confirmed===true,specialistRequirementsMet:req.body?.specialistRequirementsMet===true});}catch(e){next(e);}});
// Publishing actions need an editor; the publication service itself checks every approval.
const requireEditor=(req,res,next)=>policy.human(identity(req.session),'editor')?next():res.status(403).json({error:'Editor role required'});
// Non-approval mutations are editorial operations; reviewer roles cannot edit drafts.
router.use('/admin',(req,res,next)=>{if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!/^\/(?:approvals|review|clinical-review)\//.test(req.path))return requireEditor(req,res,next);next();});
router.post(['/admin/approve/:id','/admin/bulk-approve','/admin/approve-slate','/admin/unpublish/:id'],requireEditor);
router.post('/admin/generate/:id', async(req,res,next)=>{try{const editor=require('../lib/pharmeditor');res.json(await publication.generate(req.params.id,req.body.revision,editor.generateDraft));}catch(e){next(e);}});

// Publish only an exact, independently reviewed revision
router.post('/admin/approve/:id', async (req, res, next) => {
  try {
    const article = await publication.publish(req.params.id,identity(req.session)?.id);
    const pharmeditor = require('../lib/pharmeditor');
    pharmeditor.recordFeedback(req.params.id, article.editorial_score || null, 'approved');
    res.json({ success: true, article });
  } catch (err) {
    if (err.message && err.message.includes('Body generation')) {
      return res.status(502).json({ error: err.message, code: 'BODY_GEN_FAILED' });
    }
    next(err);
  }
});

// Decline article
router.post('/admin/decline/:id', async (req, res, next) => {
  try {
    const article = await store.moveArticle('pending', 'declined', req.params.id);
    const pharmeditor = require('../lib/pharmeditor');
    pharmeditor.recordFeedback(req.params.id, article.editorial_score || null, 'declined');
    res.json({ success: true, article });
  } catch (err) {
    next(err);
  }
});

// Unpublish article (move from approved back to pending)
router.post('/admin/unpublish/:id', async (req, res, next) => {
  try {
    const article = await publication.unpublish(req.params.id,identity(req.session)?.id,req.body.reason);
    res.json({ success: true, article });
  } catch (err) {
    next(err);
  }
});

// Update article
router.put('/admin/articles/:id', async (req, res, next) => {
  try {
    // Find article in any directory
    let article = null;
    let status = null;
    for (const s of ['pending', 'approved', 'declined']) {
      if (await store.articleExists(s, req.params.id)) {
        article = await store.readArticle(s, req.params.id);
        status = s;
        break;
      }
    }
    if (!article) return res.status(404).json({ error: 'Article not found' });

    const allowedFields = ['title','summary','body','category','source','source_url','tags','drug_names','companies','therapeutic_area','region','instagram_caption','image','image_prompt','priority','slug','content_kind','provenance','geography','rights','evidence','correction_reason','editorial','translation','language','outbreak','treatment','drug_event','requires_clinical_review'];
    const changes = Object.fromEntries(allowedFields.filter(k=>req.body[k]!==undefined).map(k=>[k,req.body[k]]));
    article = await publication.edit(req.params.id, changes, req.body.revision, identity(req.session)?.id);
    res.json({ success: true, article });
  } catch (err) {
    next(err);
  }
});

// Stats
router.get('/admin/stats', async (req, res, next) => {
  try {
    const stats = await store.getStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// Trigger scrape
router.post('/admin/scrape', async (req, res, next) => {
  if(process.env.ALLOW_COLLECTION!=='true')return res.status(403).json({error:'Collection disabled'});
  try {
    const scraper = { runAll: () => require('../lib/scheduler').triggerManualScrape() };
    // Run in background, respond immediately
    scraper.runAll()
      .then(result => console.log(`[SCRAPE] Manual: ${result.newArticles} new, ${result.duplicates} dupes`))
      .catch(err => console.error('[SCRAPE] Manual failed:', err.message));
    res.json({ success: true, message: 'Scraping started in background' });
  } catch (err) {
    next(err);
  }
});

// Bulk approve
router.post('/admin/bulk-approve', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
    const pharmeditor = require('../lib/pharmeditor');
    const results = [];
    for (const id of ids) {
      try {
        const article = await publication.publish(id,identity(req.session)?.id);
        pharmeditor.recordFeedback(id, article.editorial_score || null, 'approved');
        results.push({ id, success: true });
      } catch (err) {
        results.push({ id, success: false, error: err.message });
      }
    }
    res.json({ success: true, results });
  } catch (err) {
    next(err);
  }
});

// Bulk decline
router.post('/admin/bulk-decline', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
    const pharmeditor = require('../lib/pharmeditor');
    const results = [];
    for (const id of ids) {
      try {
        const article = await store.moveArticle('pending', 'declined', id);
        pharmeditor.recordFeedback(id, article.editorial_score || null, 'declined');
        results.push({ id, success: true });
      } catch {
        results.push({ id, success: false });
      }
    }
    res.json({ success: true, results });
  } catch (err) {
    next(err);
  }
});

// === PharmEditor Endpoints ===

// Get daily slate
router.get('/admin/slate/:date', async (req, res, next) => {
  try {
    const slate = await store.readSlate(req.params.date);
    res.json(slate);
  } catch {
    res.status(404).json({ error: 'No slate found for this date' });
  }
});

// Approve entire recommended slate
router.post('/admin/approve-slate', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const slate = await store.readSlate(today);
    if (!slate || !slate.recommended_slate) {
      return res.status(404).json({ error: 'No slate found for today' });
    }

    const pharmeditor = require('../lib/pharmeditor');
    const results = [];
    for (const item of slate.recommended_slate) {
      try {
        const article = await publication.publish(item.id,identity(req.session)?.id);
        pharmeditor.recordFeedback(item.id, item.score || null, 'approved');
        results.push({ id: item.id, success: true });
      } catch (err) {
        results.push({ id: item.id, success: false, error: err.message });
      }
    }
    res.json({ success: true, results, approved: results.filter(r => r.success).length });
  } catch (err) {
    next(err);
  }
});

// Manual PharmEditor trigger
router.post('/admin/run-pharmeditor', async (req, res, next) => {
  if(process.env.ALLOW_MODEL_CALLS!=='true')return res.status(403).json({error:'Model calls disabled'});
  try {
    const pharmeditor = require('../lib/pharmeditor');
    // Get all pending article IDs
    const pending = await store.listArticles('pending');
    const ids = pending.map(a => a.id);

    if (ids.length === 0) {
      return res.json({ success: true, message: 'No pending articles to analyze' });
    }

    // Run in background
    pharmeditor.analyze(ids)
      .then(result => console.log(`[PHARMEDITOR] Manual: ${result.scored} scored, ${result.errors} errors, slate: ${result.slateGenerated}`))
      .catch(err => console.error('[PHARMEDITOR] Manual failed:', err.message));

    res.json({ success: true, message: `PharmEditor analyzing ${ids.length} articles in background` });
  } catch (err) {
    next(err);
  }
});

router.use((err,req,res,next)=>res.status(err.status || 500).json({error:err.status ? err.message : 'Operation failed'}));
module.exports = router;
