const https=require('https'),dns=require('dns/promises'),net=require('net');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function bounded(promise,ms){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Source DNS timeout')),ms);})]);}finally{clearTimeout(timer);}}
function publicIPv4(ip){if(net.isIP(ip)!==4)return false;const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&[0,168].includes(b))||(a===100&&b>=64&&b<=127)||(a===198&&[18,19,51].includes(b))||(a===203&&b===0));}
function allowed(url,source){const u=new URL(url),base=new URL(source.url);if(u.protocol!=='https:'||u.username||u.password||u.port||net.isIP(u.hostname)||u.hostname!==base.hostname)throw new Error('Unapproved source host or URL');return u;}
function createClient({budget,saveBudget,limit=120,perHost=24,maxMs=900000,maxBytes=2*1024*1024,spacing=2000,lookup=dns.lookup,request=https.request,sleep=wait}={}){
 const started=Date.now(),last=new Map();let calls=0;budget.hosts||={};
 return async function get(url,source,headers={}){
  const u=allowed(url,source);let attempt=0;
  while(true){
   if(++calls>limit||budget.requests>=500||(budget.hosts[u.hostname]||0)>=perHost||Date.now()-started>=maxMs)throw Object.assign(new Error('Collection budget reached'),{code:'BUDGET'});
   await sleep(Math.max(0,spacing-(Date.now()-(last.get(u.hostname)||0))));
   // Pin a validated public IPv4 address into the connection; no proxy, redirects or DNS rebinding.
   const remaining=maxMs-(Date.now()-started);if(remaining<=0)throw Object.assign(new Error('Collection budget reached'),{code:'BUDGET'});
   const addresses=await bounded(lookup(u.hostname,{family:4,all:true}),Math.min(15000,remaining));if(!addresses.length||addresses.some(x=>!publicIPv4(x.address)))throw new Error('Non-public source address rejected');
   budget.requests++;budget.hosts[u.hostname]=(budget.hosts[u.hostname]||0)+1;await saveBudget(budget);last.set(u.hostname,Date.now());
   let response;
   try{response=await new Promise((resolve,reject)=>{let deadline;const done=(fn,value)=>{clearTimeout(deadline);fn(value);};const req=request(u,{method:'GET',headers:{'User-Agent':'PharmacyNews/1.0 metadata collector',Accept:'application/rss+xml, application/atom+xml, application/json, text/html',...headers},lookup:(host,opts,cb)=>opts.all?cb(null,[addresses[0]]):cb(null,addresses[0].address,4)},res=>{const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){res.destroy(new Error('Source response too large'));return;}chunks.push(chunk);});res.on('error',e=>done(reject,e));res.on('end',()=>done(resolve,{status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')}));});req.setTimeout(15000,()=>req.destroy(new Error('Source timeout')));req.on('error',e=>done(reject,e));deadline=setTimeout(()=>req.destroy(new Error('Source absolute timeout')),Math.max(1,Math.min(15000,maxMs-(Date.now()-started))));req.end();});}
   catch(e){if(attempt++<1){await sleep(1000);continue;}throw e;}
   if([429,500,502,503,504].includes(response.status)&&attempt++<1){const value=response.headers['retry-after'];const seconds=/^\d+$/.test(value||'')?Number(value):value?Math.max(0,(Date.parse(value)-Date.now())/1000):1;if(!Number.isFinite(seconds)||seconds>30)throw Object.assign(new Error('Source requested later retry'),{code:'DEFERRED'});await sleep(seconds*1000);continue;}
   let emptyFDA=false;if(response.status===404&&source.pagination&&['fda-applications','fda-shortages'].includes(source.adapter)){try{const e=JSON.parse(response.body).error;emptyFDA=e?.code==='NOT_FOUND'&&e?.message==='No matches found!';}catch{}}
   if(response.status!==200&&response.status!==304&&!emptyFDA)throw Object.assign(new Error('Source HTTP '+response.status),{code:'HTTP_'+response.status});return response;
  }
 };
}
module.exports={publicIPv4,allowed,createClient};
