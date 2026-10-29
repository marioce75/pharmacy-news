const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const page=fs.readFileSync(path.join(__dirname,'maintenance.html'));
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});return res.end();}
 if(url.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(req.method==='HEAD'?'':JSON.stringify({status:'ok',mode:'maintenance',collection:false,publication:false}));}
 if(url.pathname.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json','Retry-After':'3600'});return res.end(req.method==='HEAD'?'':JSON.stringify({error:'Editorial review in progress',articles:[]}));}
 res.writeHead(url.pathname==='/'?200:503,{'Content-Type':'text/html; charset=utf-8','Retry-After':'3600'});res.end(req.method==='HEAD'?'':page);
});
server.listen(Number(process.env.PORT||3456),process.env.HOST||'0.0.0.0',()=>console.log('PharmacyNews maintenance listening '+JSON.stringify(server.address())));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
