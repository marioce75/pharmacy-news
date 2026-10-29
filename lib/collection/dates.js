// Source dates keep their stated precision. A date without a time is a calendar day in the
// publisher's declared time zone, never midnight UTC, so a Sydney "30 Oct" is not "future"
// while it is still 29 Oct in UTC. Unparseable or ambiguous dates stay unknown.
const MONTHS={january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,
 jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12,
 enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12,
 janeiro:1,fevereiro:2,'março':3,marco:3,maio:5,junho:6,julho:7,setembro:9,outubro:10,novembro:11,dezembro:12,
 janvier:1,'février':2,fevrier:2,mars:3,avril:4,mai:5,juin:6,juillet:7,'août':8,aout:8,septembre:9,octobre:10,novembre:11,'décembre':12,decembre:12,
 januar:1,februar:2,'märz':3,maerz:3,juni:6,juli:7,oktober:10,dezember:12};
const pad=n=>String(n).padStart(2,'0');
function validDay(y,m,d){const t=new Date(Date.UTC(y,m-1,d));return y>=1990&&y<=2100&&t.getUTCFullYear()===y&&t.getUTCMonth()===m-1&&t.getUTCDate()===d;}
// Offset in minutes of an IANA zone at a UTC instant, via Intl (no extra dependency).
function zoneOffset(zone,ms){const f=new Intl.DateTimeFormat('en-US',{timeZone:zone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
 const p=Object.fromEntries(f.formatToParts(new Date(ms)).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
 return(Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-Math.floor(ms/1000)*1000)/60000;}
// UTC instant of a wall-clock time in a zone; two passes settle DST transitions.
function wallToUTC(zone,y,m,d,h=0,mi=0,s=0){const wall=Date.UTC(y,m-1,d,h,mi,s);let t=wall-zoneOffset(zone,wall)*60000;t=wall-zoneOffset(zone,t)*60000;return t;}
function checkZone(zone){try{new Intl.DateTimeFormat('en-US',{timeZone:zone});return true;}catch{return false;}}
function result(raw,ms,precision,extra={}){return{iso:new Date(ms).toISOString(),day:precision==='day'?extra.day:null,precision,raw,...extra};}
// format: 'auto' | 'dmy' | 'mdy' (numeric slashes are ambiguous and need a declared order).
function parseSourceDate(raw,{timezone='UTC',format='auto'}={}){
 if(raw==null)return null;const text=String(raw).replace(/\s+/g,' ').trim();if(!text||text.length>80)return null;
 if(!checkZone(timezone))throw new Error('Invalid source time zone');
 let m=/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(text);
 if(m){const [y,mo,d,h,mi,s]=[1,2,3,4,5,6].map(i=>Number(m[i]||0));if(!validDay(y,mo,d)||h>23||mi>59||s>59)return null;
  if(m[7]){const ms=Date.parse(text.replace(' ','T'));return Number.isFinite(ms)?result(text,ms,'instant',{zone_basis:'stated_offset'}):null;}
  return result(text,wallToUTC(timezone,y,mo,d,h,mi,s),'instant',{zone_basis:'declared_source_zone',timezone});}
 m=/^(\d{4})-?(\d{2})-?(\d{2})$/.exec(text);
 if(m){const [y,mo,d]=[1,2,3].map(i=>Number(m[i]));return validDay(y,mo,d)?result(text,wallToUTC(timezone,y,mo,d),'day',{day:`${y}-${pad(mo)}-${pad(d)}`,timezone}):null;}
 // East Asian forms: 2026年10月29日 (ja/zh) and 2026.10.29 (ko) are unambiguous year-first dates.
 m=/^(\d{4})(?:年|\.)\s*(\d{1,2})(?:月|\.)\s*(\d{1,2})日?$/.exec(text);
 if(m){const [y,mo,d]=[1,2,3].map(i=>Number(m[i]));return validDay(y,mo,d)?result(text,wallToUTC(timezone,y,mo,d),'day',{day:`${y}-${pad(mo)}-${pad(d)}`,timezone}):null;}
 m=/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(text);
 if(m){if(format!=='dmy'&&format!=='mdy')return null;const [a,b,y]=[1,2,3].map(i=>Number(m[i])),d=format==='dmy'?a:b,mo=format==='dmy'?b:a;
  return validDay(y,mo,d)?result(text,wallToUTC(timezone,y,mo,d),'day',{day:`${y}-${pad(mo)}-${pad(d)}`,timezone}):null;}
 const words=text.toLowerCase().replace(/,/g,' ').replace(/\b(de|del|le|the)\b/g,' ').replace(/(\d)(st|nd|rd|th)\b/g,'$1').replace(/\./g,' ').replace(/\s+/g,' ').trim();
 m=/^(?:[a-zà-ÿ]+ )?(\d{1,2}) ([a-zà-ÿ]+) (\d{4})$/.exec(words)||null;let d,mo,y;
 if(m&&MONTHS[m[2]]){d=Number(m[1]);mo=MONTHS[m[2]];y=Number(m[3]);}
 else{m=/^(?:[a-zà-ÿ]+ )?([a-zà-ÿ]+) (\d{1,2}) (\d{4})$/.exec(words);if(m&&MONTHS[m[1]]){mo=MONTHS[m[1]];d=Number(m[2]);y=Number(m[3]);}}
 if(mo&&validDay(y,mo,d))return result(text,wallToUTC(timezone,y,mo,d),'day',{day:`${y}-${pad(mo)}-${pad(d)}`,timezone});
 // RFC 2822 and similar strings that state their own zone.
 if(/(GMT|UTC|[+-]\d{4}|\b[A-Z]{3}\b)$/.test(text)&&/\d{4}/.test(text)){const ms=Date.parse(text);if(Number.isFinite(ms))return result(text,ms,'instant',{zone_basis:'stated_offset'});}
 return null;
}
// A day-precision date is in the future only once the whole local day has not begun yet.
function isFuture(parsed,now=Date.now()){return !!parsed&&Date.parse(parsed.iso)>now;}
function ageHours(parsed,now=Date.now()){return parsed?(now-Date.parse(parsed.iso))/3600000:null;}
module.exports={parseSourceDate,isFuture,ageHours,wallToUTC,zoneOffset,MONTHS};
