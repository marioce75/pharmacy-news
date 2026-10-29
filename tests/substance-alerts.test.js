const test=require('node:test'),assert=require('node:assert/strict'),m=require('../lib/substance-alerts');
function fixture(){return {provenance:{source_id:'unodc'},drug_event:{substance:'Synthetic fixture',category:'adulteration',confirmation:'confirmed_report',report_date:'2026-10-01',event_date:null,checked_at:'2026-10-29',source_url:'https://www.unodc.org/LSS/Announcement/Details/fixture',location:{precision:'unknown',name:null},uncertainty:'Offline schema test; no real event asserted'}};}
test('substance alerts preserve unknown event dates and locations, and reject unsupported metrics and geography',()=>{
 m.validate(fixture());for(const mutate of [a=>a.drug_event.prevalence=12,a=>a.drug_event.location.lat=1,a=>a.drug_event.source_url='https://unapproved.example/alert',a=>a.drug_event.event_date='2099-01-01',a=>a.drug_event.location={precision:'country',name:'Invented'},a=>a.drug_event.category='procurement']){const a=fixture();mutate(a);assert.throws(()=>m.validate(a));}
});
test('substance view escapes malicious report metadata and includes source period and uncertainty',async()=>{
 const html=await require('ejs').renderFile(require('path').join(__dirname,'../views/substance-alerts.ejs'),{events:[{...fixture().drug_event,title:'<script>bad</script>',source:'Fixture',stale:true,reviewed_at:'2026-10-29'}],query:'',category:'',categories:m.CATEGORIES});assert.ok(!html.includes('<script>bad'));assert.match(html,/Unknown/);assert.match(html,/superseded/);assert.match(html,/not population prevalence/);
});
