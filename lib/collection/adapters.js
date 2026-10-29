const Parser=require('rss-parser'),cheerio=require('cheerio');
function date(raw){return raw&&/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(raw)&&Number.isFinite(Date.parse(raw))?new Date(raw).toISOString():null;}
function url(value,base){try{const u=new URL(value,base);if(u.protocol!=='https:'||u.username||u.password)return null;u.hash='';for(const k of [...u.searchParams.keys()])if(k.startsWith('utm_')||k==='fbclid')u.searchParams.delete(k);return u.toString();}catch{return null;}}
async function parse(source,body){

 if(source.adapter==='fda-applications'||source.adapter==='fda-shortages'){
  const data=JSON.parse(body);if(!Array.isArray(data.results))throw new Error('Missing FDA results array');
  const exact=d=>/^\d{8}$/.test(d||'')?date(d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6)):null;
  const us=d=>{const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d||'');return m?date(m[3]+'-'+m[1]+'-'+m[2]):null;};
  const items=data.results.map(x=>{if(source.adapter==='fda-applications'){
   const latest=[...(x.submissions||[])].sort((a,b)=>String(b.submission_status_date).localeCompare(String(a.submission_status_date)))[0]||{};
   return{external_id:x.application_number,title:[x.application_number,x.products?.[0]?.brand_name||'',latest.submission_type||'',latest.submission_status||''].filter(Boolean).join(' — '),url:'https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo='+String(x.application_number||'').replace(/\D/g,''),published_at:null,updated_at:exact(latest.submission_status_date),publication_raw:null,source_period:data.meta?.last_updated||null,fingerprint_text:JSON.stringify(x)};
  }return{external_id:x.package_ndc,title:[x.generic_name,x.presentation,x.status].filter(Boolean).join(' — '),url:'https://api.fda.gov/drug/shortages.json?search='+encodeURIComponent('package_ndc:"'+x.package_ndc+'"'),published_at:us(x.initial_posting_date),updated_at:us(x.update_date),publication_raw:x.initial_posting_date||null,source_period:data.meta?.last_updated||null,fingerprint_text:JSON.stringify(x)};});
  return{items,backlog:false};
 }
 if(source.adapter==='pubmed'){
  const data=JSON.parse(body).result;if(!Array.isArray(data?.uids))throw new Error('Missing PubMed summary IDs');
  return{items:data.uids.map(id=>{const x=data[id];if(!x||x.error)throw new Error('Incomplete PubMed summary');return{external_id:id,title:x.title,url:'https://pubmed.ncbi.nlm.nih.gov/'+id+'/',published_at:null,publication_raw:x.pubdate||null,fingerprint_text:JSON.stringify(x)};}),backlog:false};
 }
 if(source.adapter==='europe-pmc'){
  const data=JSON.parse(body);if(!Array.isArray(data.resultList?.result))throw new Error('Missing Europe PMC result list');
  return{items:data.resultList.result.map(x=>({external_id:x.source+':'+x.id,title:x.title,url:'https://europepmc.org/article/'+encodeURIComponent(x.source)+'/'+encodeURIComponent(x.id),indexed_at:date(x.firstIndexDate),published_at:date(x.firstPublicationDate),publication_raw:x.firstPublicationDate||x.pubYear||null,fingerprint_text:JSON.stringify(x)})),backlog:false};
 }
 if(source.adapter==='rss'){
  if(/<!DOCTYPE|<!ENTITY/i.test(body))throw new Error('XML entities are not allowed');
  const feed=await new Parser().parseString(body);
  return {items:(feed.items||[]).map(x=>({external_id:x.guid||x.id||x.link,title:x.title||'',url:url(x.link,source.url),published_at:date(x.isoDate),publication_raw:x.pubDate||x.isoDate||null,updated_at:date(x.updated),fingerprint_text:[x.contentSnippet||x.content||'',x.updated||''].join('|')})),backlog:false};
 }
 if(source.adapter==='trials'){
  const data=JSON.parse(body);if(!Array.isArray(data.studies))throw new Error('Missing studies array');
  return {items:data.studies.map(x=>{const p=x.protocolSection||{},id=p.identificationModule?.nctId,s=p.statusModule||{};return{external_id:id,title:p.identificationModule?.briefTitle||'',url:id?'https://clinicaltrials.gov/study/'+id:null,published_at:date(s.studyFirstPostDateStruct?.date),updated_at:date(s.lastUpdatePostDateStruct?.date),publication_raw:s.studyFirstPostDateStruct?.date||null,study_start:s.startDateStruct?.date||null,trial_status:s.overallStatus||'UNKNOWN',fingerprint_text:JSON.stringify(p)};}),backlog:!!data.nextPageToken,next_page:data.nextPageToken||null};
 }
 if(source.adapter==='pmda-index'){
  const $=cheerio.load(body),items=[],seen=new Set();$('table tr').each((_,el)=>{const row=$(el),cells=row.find('td');if(cells.length<3)return;const raw=cells.first().text().replace(/\s+/g,' ').trim(),number=cells.eq(1).text().replace(/\s+/g,' ').trim();const a=cells.eq(2).find('a[href$=".pdf"]').first(),link=url(a.attr('href'),source.url);if(!a.length||!link||new URL(link).hostname!==new URL(source.url).hostname||seen.has(link))return;seen.add(link);const title=a.text().replace(/\s*\[[^\]]*(?:KB|MB)\]\s*$/i,'').trim();if(!title)return;items.push({external_id:link,title,url:link,published_at:null,updated_at:null,publication_raw:raw,fingerprint_text:[raw,number,title].join('|')});});
  if(!items.length)throw Object.assign(new Error('PMDA notice table absent; cannot establish empty coverage'),{code:'SELECTOR_EMPTY'});return{items,backlog:false};
 }
 if(source.adapter==='fda-recalls'){
  const $=cheerio.load(body),items=[];const rows=$('table tbody tr');if(!rows.length)throw new Error('Recall table absent');
  rows.each((_,el)=>{const tr=$(el),td=tr.find('td'),type=td.eq(3).text().trim();if(!/drug|biologic|device|supplement/i.test(type))return;const link=url(td.eq(1).find('a').attr('href'),source.url);if(!link||new URL(link).hostname!==new URL(source.url).hostname)return;const raw=td.eq(0).text().trim(),updated=date(tr.find('time').attr('datetime'));items.push({external_id:link,data_kind:/veterinar|animal/i.test(td.eq(2).text())?'animal_news':'news_metadata',title:[td.eq(1).text().trim(),td.eq(2).text().trim(),td.eq(5).text().trim()].filter(Boolean).join(' — '),url:link,published_at:null,updated_at:updated,publication_raw:null,fingerprint_text:[raw,type,td.eq(4).text().trim(),td.eq(6).text().trim()].join('|')});});return{items,backlog:false};
 }
 if(source.adapter==='euda-news'){
  const $=cheerio.load(body),items=[];$('a[href]').each((_,el)=>{const a=$(el),link=url(a.attr('href'),source.url);if(!link||new URL(link).hostname!==new URL(source.url).hostname||!/^\/news\/\d{4}\//.test(new URL(link).pathname)||items.some(x=>x.url===link))return;const title=(a.find('h2,h3,h4').first().text()||a.clone().children().remove().end().text()).replace(/\s+/g,' ').trim();if(!title||title==='News')return;items.push({external_id:link,title,url:link,published_at:null,publication_raw:null,fingerprint_text:title});});if(!items.length)throw new Error('EUDA news links absent');return{items,backlog:false};
 }
 if(source.adapter==='page'){
  const $=cheerio.load(body);const items=[];$(source.selector).each((_,el)=>{const a=$(el),link=url(a.attr('href'),source.url);if(link&&new URL(link).hostname===new URL(source.url).hostname&&a.text().trim()&&!items.some(x=>x.url===link))items.push({external_id:link,title:a.text().trim(),url:link,published_at:null,updated_at:null,publication_raw:null,fingerprint_text:a.text().trim()});});
  if(!items.length)throw Object.assign(new Error('Page selector matched no records; cannot establish empty coverage'),{code:'SELECTOR_EMPTY'});return {items,backlog:false};
 }
 throw new Error('Adapter unavailable');
}
module.exports={parse,date,url};
