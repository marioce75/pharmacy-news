const test=require('node:test'),assert=require('node:assert/strict');
test('future and invalid source dates fail publication intake even with recorded rights',()=>{
 const {validate}=require('../lib/editorial-intake');const a={ingestion:{requires_original_summary:true,source_id:'ema-news'},provenance:{published_at:'2999-01-01'},editorial:{original_summary:true},summary:'An original summary of the source with sufficient descriptive context.',rights:{status:'reviewed_for_original_summary',license_url:'https://www.ema.europa.eu/en/legal-notice',attribution:'EMA'}};
 assert.throws(()=>validate(a),/publication date/);a.provenance.published_at='invalid';assert.throws(()=>validate(a),/publication date/);a.provenance.published_at='2026-01-01';assert.doesNotThrow(()=>validate(a));
});
test('malformed and oversized credentials fail closed without bcrypt or credential diagnostics',async()=>{
 const {verifyCredentials}=require('../middleware/auth');for(const [u,p] of [[{},'x'],['x',[]],['x'.repeat(129),'x'],['x','a'.repeat(73)]])assert.equal(await verifyCredentials(u,p),false);
});
