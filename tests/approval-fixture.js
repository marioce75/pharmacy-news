// Records the separate evidence and source-rights approvals a fixture needs before
// publication, by a fixture reviewer distinct from the editor.
const sourceReviewer={id:'fixture-source-reviewer',type:'human',authenticated:true,roles:['evidence_reviewer','rights_reviewer']};
async function sourceApprovals(pub,id,basis='reviewed_for_original_summary'){const {revision}=await pub.preview(id);await pub.approve(id,'evidence',revision,sourceReviewer,{confirmed:true});await pub.approve(id,'rights',revision,sourceReviewer,{confirmed:true,basis});return revision;}
module.exports={sourceReviewer,sourceApprovals};
