// Configuration-driven adapters for verified worldwide outbreak and substance-alert sources.
// They return source metadata only (identity, title, link, dates, a change fingerprint);
// no report text is stored. Filters narrow general feeds and are reported, never hidden.
const cheerio=require('cheerio');
const {parseSourceDate}=require('./dates');
const ADAPTERS=new Set(['json-api','html-index','rss-filtered']);
const handles=source=>ADAPTERS.has(source?.adapter);
const pick=(obj,path)=>String(path||'').split('.').filter(Boolean).reduce((o,k)=>o==null?undefined:o[k],obj);
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
function link(value,source,{keepHash=false}={}){
 try{const u=new URL(value,source.link_base||source.url),hosts=[new URL(source.url).hostname,...(source.link_hosts||[])];
  if(u.protocol!=='https:'||u.username||u.password||!hosts.includes(u.hostname))return null;if(!keepHash)u.hash='';
  for(const k of [...u.searchParams.keys()])if(k.startsWith('utm_')||k==='fbclid')u.searchParams.delete(k);return u.toString();}catch{return null;}
}
function when(raw,source){const p=parseSourceDate(raw,{timezone:source.timezone||'UTC',format:source.date_format||'auto'});return p;}
// Keyword filter for general feeds; matching is on the title only, because summaries are not kept.
function relevant(source,title){const f=source.filter;if(!f)return true;const t=title.toLowerCase();
 return(f.include||[]).some(k=>t.includes(k.toLowerCase()))&&!(f.exclude||[]).some(k=>t.includes(k.toLowerCase()));}
function item(source,{id,title,url,published,updated,extra=[]}){
 const p=when(published,source),u=when(updated,source);
 return{external_id:clean(id||url),title:clean(title),url,published_at:p?.iso||null,updated_at:u?.iso||null,publication_raw:published==null?null:clean(published),
  date_precision:p?.precision||null,fingerprint_text:[clean(title),clean(published),clean(updated),...extra.map(clean)].join('|')};
}
function nextURL(source,body,current,$){
 const p=source.page;if(!p)return null;let next=null;
 if(p.type==='next_field')next=pick(body,p.field);
 else if(p.type==='offset'){const u=new URL(current),size=Number(p.size),at=u.searchParams.has(p.param)?Number(u.searchParams.get(p.param)):(p.start??0);u.searchParams.set(p.param,String(at+size));next=u.toString();}
 else if(p.type==='page_param'){const u=new URL(current),at=u.searchParams.has(p.param)?Number(u.searchParams.get(p.param)):(p.start??1);u.searchParams.set(p.param,String(at+1));next=u.toString();}
 else if(p.type==='next_link'&&$)next=$(p.selector).first().attr('href')||null;
 if(!next)return null;
 // A continuation must stay on the same endpoint and only change the paging parameter(s).
 const n=new URL(next,current),b=new URL(source.url);
 if(n.protocol!=='https:'||n.hostname!==b.hostname||n.pathname!==b.pathname||n.username||n.password)throw Object.assign(new Error('Unapproved continuation URL'),{code:'CONTINUATION_REJECTED'});
 return n.toString();
}
async function parse(source,body,{url=source.url,now=Date.now()}={}){
 let items=[],next=null,filtered=0;
 if(source.adapter==='json-api'){
  const data=JSON.parse(body),j=source.json,list=pick(data,j.items);
  if(!Array.isArray(list))throw Object.assign(new Error('Source JSON item list absent'),{code:'SCHEMA_CHANGED'});
  for(const x of list){const title=j.title_join?j.title_join.map(f=>pick(x,f)).filter(Boolean).join(' — '):j.title_html?cheerio.load('<p>'+String(pick(x,j.title)??'')+'</p>').text():pick(x,j.title);const href=link(j.url_template?j.url_template.replace(/\{([\w.]+)\}/g,(_,k)=>encodeURIComponent(pick(x,k)??'')):pick(x,j.url),source);if(!href)continue;
   // Some datasets have no single stable key; a joined key (hashed when long) keeps identities distinct.
   const parts=(j.id_join||[j.id]).map(f=>String(pick(x,f)??'')),joined=parts.join('|'),id=joined.length>120?parts[0]+':'+require('crypto').createHash('sha256').update(joined).digest('hex').slice(0,16):joined;
   items.push(item(source,{id,title,url:href,published:pick(x,j.published),updated:pick(x,j.updated),extra:(j.fingerprint||[]).map(f=>JSON.stringify(pick(x,f)??null))}));}
  next=list.length?nextURL(source,data,url):null;
 }else if(source.adapter==='html-index'){
  if(/<!ENTITY/i.test(body))throw new Error('Entities are not allowed');
  const $=cheerio.load(body),h=source.html,seen=new Set();
  $(h.item).each((_,el)=>{const row=$(el),a=h.link?row.find(h.link).first():row.is('a')?row:row.find('a[href]').first(),href=link(a.attr('href'),source,{keepHash:!!h.keep_hash});if(!href||seen.has(href))return;
   if(h.path&&!new RegExp(h.path).test(new URL(href).pathname))return;seen.add(href);
   // Titles may sit in an attribute or share an element with a date that is dropped first.
   const t=h.title?row.find(h.title).first().clone():a.clone();if(h.title_drop)t.find(h.title_drop).remove();let title=clean(h.title_attr?(a.attr(h.title_attr)||t.text()):t.text());
   // Generic listing labels (for example "Week 34") get the source label and the year from the link path.
   if(h.title_prefix){const y=h.title_year_regex?new RegExp(h.title_year_regex).exec(href)?.[1]:null;title=h.title_prefix+title+(y?' '+y:'');}
   const d=h.date?row.find(h.date).first():null;let raw=d&&d.length?(d.attr('datetime')||d.text()):null;
   // Some indexes give the date only inside row text or the document file name.
   if(h.date_regex){const m=new RegExp(h.date_regex,'iu').exec(h.date_source==='href'?a.attr('href')||'':row.text());raw=m?m[1]:null;}
   if(title)items.push(item(source,{id:href,title,url:href,published:raw?clean(raw).replace(new RegExp(h.date_strip||'^$'),'').trim():null}));});
  if(!items.length)throw Object.assign(new Error('Index selector matched no records; cannot establish empty coverage'),{code:'SELECTOR_EMPTY'});
  next=nextURL(source,null,url,$);
 }else if(source.adapter==='rss-filtered'){
  const parsed=await require('./adapters').parse({...source,adapter:'rss'},body);
  items=parsed.items.map(x=>({...x,date_precision:x.published_at?'instant':null}));
 }else throw new Error('Adapter unavailable');
 let kept=items.filter(x=>x.title&&relevant(source,x.title));filtered=items.length-kept.length;
 // Long archive pages are not backfilled: dated items older than the source's window are counted, not queued.
 const cutoff=source.max_age_days?now-source.max_age_days*86400000:null,before=kept.length;
 if(cutoff)kept=kept.filter(x=>{const d=Date.parse(x.updated_at||x.published_at);return!Number.isFinite(d)||d>=cutoff;});
 return{items:kept,backlog:false,next_url:next,filtered_out:filtered,older_than_window:before-kept.length,listed:items.length};
}
module.exports={handles,parse,relevant,link,nextURL,ADAPTERS};
