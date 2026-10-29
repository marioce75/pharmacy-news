'use strict';
// Interactive presentation of the unreviewed official-source listing: report stream, daily
// timeline and WHO-region totals. All text goes through textContent; nothing is inferred
// beyond what /api/monitor/reports returns, and region bubbles mark regions, not places.
(function(){
const $=id=>document.getElementById(id);
const REGION_ANCHORS={AFR:[20,2],AMR:[-78,8],SEAR:[92,14],EUR:[18,52],EMR:[40,31],WPR:[135,2]};
const state={data:null,failed:false,stream:'',region:'',days:30};
const el=(tag,props={},...kids)=>{const n=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='text')n.textContent=v;else if(k==='class')n.className=v;else if(k.startsWith('on'))n[k]=v;else n.setAttribute(k,v);}for(const k of kids)if(k)n.append(k);return n;};
const day=iso=>iso?iso.slice(0,10):null;
const label=s=>s==='outbreak'?'Outbreak report':'Substance / product alert';
function reports(){if(!state.data)return[];const q=($('query')?.value||'').trim().toLowerCase(),topic=$('topic')?.value||'all';
 return state.data.reports.filter(r=>(!state.stream||r.stream===state.stream)&&(topic!=='toxicology'||r.stream==='substance')&&(!state.region||r.countries.some(c=>c.who_region===state.region)||(!r.countries.length&&r.issuer_region===state.region))
  &&(!q||[r.title,r.issuer,...r.title_mentions,...r.countries.map(c=>c.name)].join(' ').toLowerCase().includes(q)));}
function status(){const d=state.data;if(!d){$('collection-status').textContent=state.failed?'Collection status unavailable':'Loading collection status…';return;}
 const c=d.collection;$('collection-status').textContent=(c.schedule_enabled?'Collection every 6 h':'Collection paused')+(c.last_completed_at?' · last run '+c.last_completed_at.slice(0,16).replace('T',' ')+' UTC':' · no completed run yet');
 $('feed-status').textContent=c.working_sources+' official sources monitored · '+d.totals.all_unfiltered+' unreviewed titles in '+d.window_days+' days';}
function stream(){const box=$('official-stream');if(!box)return;box.replaceChildren();
 if(state.failed){box.append(el('p',{class:'stream-empty',text:'Official listing unavailable. Coverage unknown; this is not an absence of reports.'}));return;}
 if(!state.data){box.append(el('p',{class:'stream-empty',text:'Loading official report titles…'}));return;}
 const rows=reports();$('official-count').textContent=rows.length+' of '+state.data.totals.all_unfiltered+' titles'+(state.region?' · '+state.region:'');
 if(!rows.length){box.append(el('div',{class:'stream-empty'},el('strong',{text:'No titles match'}),el('p',{text:'No listed reports is not zero disease or zero drug harm. Sources may be blocked, slow or not yet collected.'})));return;}
 for(const r of rows.slice(0,60)){
  const meta=el('div',{},el('span',{text:r.issuer}),el('time',{text:day(r.report_date)||('date not given · retrieved '+day(r.retrieved_at))}));
  const link=el('a',{href:r.source_url,target:'_blank',rel:'noopener noreferrer',text:r.title});
  const tags=[label(r.stream),r.countries.map(c=>c.name).join(', ')||'Place not named in title',r.title_mentions.length?'Title mentions: '+r.title_mentions.join(', '):null,r.translation_note,r.possibly_not_an_event?'May be a routine report':null,r.source_revised?'Source revised':null].filter(Boolean).join(' · ');
  box.append(el('article',{class:'news-row official-row','data-stream':r.stream},meta,el('h3',{},link),el('small',{text:tags+' · Unreviewed · Official source ↗'})));}
 if(rows.length>60)box.append(el('p',{class:'stream-more',text:'Showing 60 newest. Narrow by region, stream or keyword.'}));}
function chart(){const box=$('report-chart');if(!box)return;box.replaceChildren();
 if(!state.data){box.append(el('p',{text:state.failed?'Timeline unavailable.':'Loading timeline…'}));return;}
 const n=state.days,end=Date.parse(state.data.generated_at),days=[];for(let i=n-1;i>=0;i--)days.push(new Date(end-i*86400000).toISOString().slice(0,10));
 const counts=Object.fromEntries(days.map(d=>[d,{outbreak:0,substance:0}]));let undated=0;
 for(const r of reports()){const d=day(r.report_date);if(!d){undated++;continue;}if(counts[d])counts[d][r.stream]++;}
 const max=Math.max(1,...days.map(d=>counts[d].outbreak+counts[d].substance)),W=640,H=170,pad=26,bw=(W-pad*2)/n;
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${W} ${H+28}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','Official report titles per day by stream, last '+n+' days');svg.classList.add('report-svg');
 const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text!=null)e.textContent=text;svg.append(e);return e;};
 add('line',{x1:pad,y1:H,x2:W-pad,y2:H,class:'axis'});add('text',{x:pad-4,y:12,class:'tick','text-anchor':'end'},String(max));add('text',{x:pad-4,y:H,class:'tick','text-anchor':'end'},'0');
 days.forEach((d,i)=>{const c=counts[d],x=pad+i*bw+1,w=Math.max(1,bw-2);let y=H;for(const s of ['outbreak','substance']){const h=c[s]/max*(H-16);if(!h)continue;y-=h;const r=add('rect',{x,y,width:w,height:h,class:'bar-'+s,tabindex:0});r.append(Object.assign(document.createElementNS(ns,'title'),{textContent:d+': '+c[s]+' '+label(s).toLowerCase()+(c[s]===1?'':'s')}));}
  if(i===0||i===n-1||(n-1-i>=4&&i>=4&&((n<=31&&i%7===0)||(n>31&&i%15===0))))add('text',{x:x+w/2,y:H+16,class:'tick','text-anchor':'middle'},d.slice(5));});
 box.append(svg);
 const total=days.reduce((a,d)=>a+counts[d].outbreak+counts[d].substance,0);
 box.append(el('p',{class:'chart-note',text:total+' dated titles in this window'+(undated?' · '+undated+' undated not plotted':'')+'. Counts are monitored-source output, not cases, incidence or risk.'}));}
function map(){const markers=$('markers');markers.replaceChildren();const empty=$('map-empty');
 document.querySelector('.map-stamp').textContent='Official report titles / WHO-region totals';
 document.querySelector('.map-note').textContent='Bubbles sit at a fixed label position for each WHO region. They count listed titles that name a country in that region; they are not event locations, case counts or risk.';
 $('event-filters').hidden=true;
 if(!state.data){empty.hidden=false;empty.textContent=state.failed?'Official listing unavailable; coverage unknown.':'Loading official report titles…';return;}
 const rows=reports(),totals={};for(const r of rows){for(const code of new Set(r.countries.length?r.countries.map(c=>c.who_region):[r.issuer_region]))if(REGION_ANCHORS[code])totals[code]=(totals[code]||0)+1;}
 const max=Math.max(1,...Object.values(totals));empty.hidden=Object.keys(totals).length>0;empty.textContent='No titles match. No data is not zero disease.';
 for(const [code,[lon,lat]] of Object.entries(REGION_ANCHORS)){const n=totals[code]||0,g=state.data.coverage_regions.find(x=>x.code===code);const size=n?16+28*Math.sqrt(n/max):12;
  const b=el('button',{class:'region-bubble'+(state.region===code?' selected':'')+(n?'':' zero'),'aria-pressed':String(state.region===code),'aria-label':(g?.name||code)+': '+n+' listed titles. Select to filter.'});
  b.style.left=((lon+180)/3.6)+'%';b.style.top=((90-lat)/1.8)+'%';b.style.width=b.style.height=size+'px';b.append(el('span',{text:(g?.name||code).replace(' Region','')+' · '+n}));
  b.onclick=()=>{state.region=state.region===code?'':code;render();inspectRegion(code);};markers.append(b);}
 $('legend').textContent='WHO-region totals of unreviewed official titles · select a region to filter';$('count').textContent=rows.length+' official titles';
 inspectRegion(state.region);}
function inspectRegion(code){const ins=$('inspector');ins.replaceChildren();if(!state.data)return;
 const g=code?state.data.coverage_regions.find(x=>x.code===code):null,rows=reports();
 ins.append(el('span',{class:'badge',text:'Unreviewed official listing'}),el('h3',{text:g?g.name:'All WHO regions'}),el('p',{text:state.data.label}));
 if(g)ins.append(el('p',{text:'Working sources here: '+g.outbreak_sources+' outbreak, '+g.substance_sources+' substance-alert'+(g.outbreak_gap||g.substance_gap?' · coverage gap: '+[g.outbreak_gap&&'outbreak',g.substance_gap&&'substance'].filter(Boolean).join(', '):'')}));
 const counts={};for(const r of rows)for(const c of r.countries)if(!code||c.who_region===code)counts[c.name]=(counts[c.name]||0)+1;
 const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8);const dl=el('dl');
 dl.append(el('div',{},el('dt',{text:'Titles listed'}),el('dd',{text:String(rows.length)})),el('div',{},el('dt',{text:'Outbreak / substance'}),el('dd',{text:rows.filter(r=>r.stream==='outbreak').length+' / '+rows.filter(r=>r.stream==='substance').length})),
  el('div',{},el('dt',{text:'Countries named most'}),el('dd',{text:top.map(([n,c])=>n+' ('+c+')').join(', ')||'None named'})),el('div',{},el('dt',{text:'Statement'}),el('dd',{text:'Not surveillance; not verified by PharmacyNews.'})));
 ins.append(dl);}
function render(){const sel=$('official-region');if(sel)sel.value=state.region;status();stream();chart();if(window.PNMonitorLayer?.()==='events')map();}
window.PNMonitor={render,map,ready:()=>!!state.data};
document.querySelectorAll('[data-official-stream]').forEach(b=>b.onclick=()=>{state.stream=b.dataset.officialStream;document.querySelectorAll('[data-official-stream]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render();});
document.querySelectorAll('[data-days]').forEach(b=>b.onclick=()=>{state.days=Number(b.dataset.days);document.querySelectorAll('[data-days]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));chart();});
$('official-region')&&($('official-region').onchange=e=>{state.region=e.target.value;render();});
['query','topic'].forEach(id=>$(id)&&$(id).addEventListener('input',()=>{stream();chart();}));
render();
fetch('/api/monitor/reports',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(d=>{state.data=d;const sel=$('official-region');if(sel)for(const g of d.coverage_regions.filter(x=>x.code!=='GLOBAL'))sel.append(el('option',{value:g.code,text:g.name}));render();}).catch(()=>{state.failed=true;render();});
})();
