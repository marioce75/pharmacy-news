// Machine suggestions for reviewers, derived on read from collected metadata (title, source,
// dates). Nothing here is stored on the article, changes its revision, or appears publicly:
// an editor confirms fields against the linked source before any outbreak or drug_event
// record is written through the normal approval workflow.
const registry=require('../../config/source-registry');
const {COUNTRIES,WHO_REGIONS}=require('../../config/countries');
const METHOD='rule_based_title_v1';
const norm=s=>String(s||'').normalize('NFKC');
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const word=p=>new RegExp('(^|[^\\p{L}\\p{N}])('+p+')(?=$|[^\\p{L}\\p{N}])','iu');

// Diseases: label, title patterns (several languages), and pathogen names that count only
// when the source title itself names them.
const DISEASES=[
 ['ebola','Ebola disease (orthoebolavirus)',['ebola','ébola','ebolavirus','bundibugyo','sudan virus disease','sudan ebolavirus'],[['bundibugyo','Bundibugyo virus (BDBV)'],['sudan virus','Sudan virus (SUDV)'],['zaire','Ebola virus (Zaire, EBOV)'],['tai forest','Taï Forest virus']]],
 ['marburg','Marburg virus disease',['marburg'],[]],
 ['mpox','Mpox',['mpox','monkeypox','viruela símica','viruela del mono','variole du singe','varíola dos macacos'],[['clade ib','MPXV clade Ib'],['clade ia','MPXV clade Ia'],['clade iib','MPXV clade IIb'],['clade i\\b','MPXV clade I'],['clade ii\\b','MPXV clade II']]],
 ['cholera','Cholera',['cholera','cólera','choléra'],[]],
 ['measles','Measles',['measles','sarampión','sarampo','rougeole'],[]],
 ['dengue','Dengue',['dengue'],[]],
 ['chikungunya','Chikungunya',['chikungunya'],[]],
 ['zika','Zika virus disease',['zika'],[]],
 ['oropouche','Oropouche virus disease',['oropouche'],[]],
 ['yellow-fever','Yellow fever',['yellow fever','fiebre amarilla','febre amarela','fièvre jaune'],[]],
 ['avian-influenza','Avian influenza (human or animal; verify host)',['avian influenza','bird flu','influenza aviar','gripe aviar','gripe aviária','grippe aviaire','h5n1','h5n5','h5n6','h7n9','h9n2','h10n3'],[['h5n1','Influenza A(H5N1)'],['h5n5','Influenza A(H5N5)'],['h5n6','Influenza A(H5N6)'],['h7n9','Influenza A(H7N9)'],['h9n2','Influenza A(H9N2)'],['h10n3','Influenza A(H10N3)']]],
 ['novel-influenza','Novel or variant influenza',['swine influenza','variant influenza','h1n2v','h3n2v','h1n1v'],[['h1n2v','Influenza A(H1N2)v'],['h3n2v','Influenza A(H3N2)v'],['h1n1v','Influenza A(H1N1)v']]],
 ['mers','Middle East respiratory syndrome',['mers-cov','mers coronavirus','middle east respiratory syndrome'],[['mers-cov','MERS-CoV']]],
 ['covid-19','COVID-19',['covid-19','sars-cov-2','covid'],[]],
 ['nipah','Nipah virus infection',['nipah'],[]],
 ['lassa','Lassa fever',['lassa'],[]],
 ['cchf','Crimean-Congo haemorrhagic fever',['crimean-congo','cchf','fiebre hemorrágica de crimea-congo'],[]],
 ['rift-valley-fever','Rift Valley fever',['rift valley fever'],[]],
 ['animal-only','Animal disease report (not a human outbreak; verify host)',['african swine fever','peste porcina','peste suina','foot-and-mouth disease','fiebre aftosa','febre aftosa','lumpy skin disease','in poultry','in wild birds','in dairy cattle'],[]],
 ['plague','Plague',['plague','bubonic plague','pneumonic plague','peste bubónica','peste neumónica','peste pulmonar'],[]],
 ['anthrax','Anthrax',['anthrax','ántrax','carbunco','charbon'],[]],
 ['diphtheria','Diphtheria',['diphtheria','difteria','diphtérie'],[]],
 ['pertussis','Pertussis',['pertussis','whooping cough','tos ferina','coqueluche'],[]],
 ['polio','Poliomyelitis',['polio','poliomyelitis','poliovirus','cvdpv','wpv1'],[['cvdpv2','circulating vaccine-derived poliovirus type 2'],['cvdpv1','circulating vaccine-derived poliovirus type 1'],['wpv1','wild poliovirus type 1']]],
 ['meningitis','Meningitis',['meningitis','meningococcal','méningite','meningitis meningocócica'],[]],
 ['west-nile','West Nile virus infection',['west nile','virus del nilo occidental','virus du nil occidental'],[]],
 ['hepatitis','Viral hepatitis outbreak',['hepatitis a','hepatitis e','hépatite'],[]],
 ['typhoid','Typhoid fever',['typhoid','fiebre tifoidea'],[]],
 ['legionellosis','Legionnaires’ disease',['legionnaires','legionella','legionelosis'],[]],
 ['rabies','Rabies',['rabies','rabia','rage humaine'],[]],
 ['leptospirosis','Leptospirosis',['leptospirosis'],[]],
 ['hantavirus','Hantavirus disease',['hantavirus'],[]],
 ['candida-auris','Candida auris',['candida auris','c. auris'],[['candida auris','Candida auris']]],
 ['amr','Antimicrobial-resistant organism',['carbapenem-resistant','carbapenemase','ndm-1','kpc','extensively drug-resistant'],[]],
 ['undiagnosed','Undiagnosed illness under investigation',['undiagnosed','unknown disease','unexplained illness','enfermedad desconocida','maladie inconnue'],[]]
].map(([key,label,patterns,pathogens])=>({key,label,re:word(patterns.map(esc).join('|')),pathogens:pathogens.map(([p,name])=>({re:word(p),name}))}));

// Substances: named only when the title names them. Groups help reviewers; they are not findings.
const SUBSTANCES=[
 ['nitazene',['nitazene','nitazenes','nitaceno','nitacenos','isotonitazene','protonitazene','metonitazene','etonitazene','etodesnitazene','butonitazene','n-pyrrolidino','n-desethyl'],'synthetic opioid (nitazene)'],
 ['fentanyl',['fentanyl','fentanilo','fentanil','carfentanil','acetylfentanyl','para-fluorofentanyl','fluorofentanyl'],'synthetic opioid (fentanyl or analogue)'],
 ['xylazine',['xylazine','xilacina'],'veterinary sedative adulterant'],
 ['medetomidine',['medetomidine','medetomidina','dexmedetomidine'],'veterinary sedative adulterant'],
 ['benzodiazepine',['bromazolam','etizolam','flualprazolam','flubromazolam','desalkylgidazepam','designer benzodiazepine','benzodiazepina de diseño'],'non-prescribed benzodiazepine'],
 ['synthetic-cannabinoid',['synthetic cannabinoid','synthetic cannabinoids','cannabinoides sintéticos','cannabinoïdes de synthèse','mdmb-4en-pinaca','adb-butinaca'],'synthetic cannabinoid receptor agonist'],
 ['cathinone',['synthetic cathinone','cathinone','alpha-pvp','α-pvp','eutylone','dimethylpentylone','n,n-dimethylpentylone','mephedrone'],'synthetic cathinone'],
 ['tryptamine-phenethylamine',['2c-b','tusi','25i-nbome','nbome','dmt'],'hallucinogen'],
 ['stimulant',['methamphetamine','metanfetamina','cocaine','cocaína','mdma','ecstasy','éxtasis','amphetamine'],'stimulant'],
 ['opioid',['heroin','heroína','tramadol','oxycodone','morphine','opioid','opioide','opiáceo'],'opioid'],
 ['dissociative',['ketamine','ketamina','pcp','phencyclidine','nitrous oxide','óxido nitroso'],'dissociative'],
 ['depressant',['ghb','gbl','phenibut','tianeptine','tianeptina'],'depressant'],
 ['kratom',['kratom','7-hydroxymitragynine','7-oh'],'kratom alkaloid'],
 ['methanol',['methanol','metanol','méthanol'],'toxic alcohol contamination'],
 ['glp1-counterfeit',['semaglutide','tirzepatide','ozempic','wegovy','mounjaro'],'medicine named in a product alert'],
 ['levamisole',['levamisole','levamisol'],'adulterant']
].map(([key,terms,group])=>({key,group,terms,re:word(terms.map(esc).join('|'))}));
const CATEGORY_RULES=[
 ['counterfeit_or_falsified',/counterfeit|falsified|falsificad|falsifié|contrefa|fake|fraudulent|substandard|falsos?\b/iu],
 ['contamination_or_adulteration',/contaminat|adulterat|adulterad|contaminad|laced|cut with|detected in|found in|presence of|presencia de/iu],
 ['overdose_cluster',/overdose|overdoses|cluster|spike|surge|poisoning|poisonings|intoxica|sobredosis|surdose|deaths? linked/iu],
 ['new_psychoactive_substance',/new psychoactive|\bnps\b|nuevas? sustancias? psicoactivas?|first (?:detection|time|identified)|newly (?:identified|detected)|novel (?:substance|opioid|drug)|emerging substance/iu],
 ['scheduling_action',/temporary scheduling|schedules? of controlled substances|placement of .* in schedule|scheduling order|control order|controlled drug/iu]
];
const COUNT=/(\d{1,3}(?:[ ,.]\d{3})*|\d+)\s+(new\s+|additional\s+)?(confirmed\s+|suspected\s+|probable\s+|laboratory-confirmed\s+)?(cases?|casos|deaths?|muertes|fallecidos|défunts|décès|óbitos)/giu;
let countryIndex=null;
function countries(){return countryIndex||=COUNTRIES.flatMap(c=>[c.name,...c.aliases].map(n=>({n,c}))).sort((a,b)=>b.n.length-a.n.length).map(x=>({...x,re:new RegExp('(^|[^\\p{L}])'+esc(x.n)+'(?=$|[^\\p{L}])','u'+(x.n.length<=3?'':'i'))}));}
function places(title){let text=norm(title);const found=new Map();
 for(const {n,c,re} of countries()){const m=re.exec(text);if(!m)continue;if(!found.has(c.iso2))found.set(c.iso2,{iso2:c.iso2,name:c.name,who_region:c.who_region,matched_text:n});text=text.replace(re,'$1 ');}
 return[...found.values()];}
function counts(title){const out=[];for(const m of norm(title).matchAll(COUNT)){const value=Number(m[1].replace(/[ ,.]/g,''));if(!Number.isSafeInteger(value))continue;
 out.push({measure:/death|muert|fallec|défunt|décès|óbito/i.test(m[4])?'deaths':'cases',value,qualifier:(m[3]||'').trim()||'unspecified',scope:(m[2]||'').trim()||'unspecified',as_of:null,basis:'source_title',status:'reported_without_as_of_date'});}return out;}
function sourceOf(a){return registry.find(s=>s.id===(a.provenance?.source_id||a.ingestion?.source_id))||null;}
function sourceClass(s){if(!s)return'unknown';if(s.source_type==='media')return'media';if(s.source_type==='research'||s.topic==='research')return'research';if(s.official)return'official_report';return'unknown';}
function day(iso){return typeof iso==='string'&&Number.isFinite(Date.parse(iso))?iso.slice(0,10):null;}
function build(a,now=Date.now()){
 const s=sourceOf(a),title=norm(a.title),p=a.provenance||{},flags=[];
 const disease=DISEASES.find(d=>d.re.test(title))||null,pathogen=disease?.pathogens.find(x=>x.re.test(title))||null;
 const named=SUBSTANCES.filter(x=>x.re.test(title)),categories=CATEGORY_RULES.filter(([,re])=>re.test(title)).map(([k])=>k);
 // Two or more named substance groups joined in one report suggest a mixture; reviewers confirm.
 if(new Set(named.map(x=>x.key)).size>1&&/\b(with|and|mixed|combined|combination|plus|con|y|et|avec)\b|\+/iu.test(title))categories.push('dangerous_mixture');
 // A medicine named by a regulator's general feed is a substance alert only with an alert signal.
 const kind=s?.topic==='toxicology'?'substance':disease?'outbreak':named.length&&categories.length?'substance':['outbreak','official_assessment'].includes(s?.topic)?'outbreak':null;
 if(!kind)return null;
 const reported=places(title),reportDate=day(p.published_at)||day(p.source_updated_at),age=reportDate?(now-Date.parse(p.published_at||p.source_updated_at))/3600000:null;
 if(!reportDate)flags.push('report_date_unknown');
 if(p.date_in_future||(p.published_at&&Date.parse(p.published_at)>now))flags.push('future_dated');
 if(age!=null&&age>(s?.freshness_hours||168)*Math.max(1,(s?.stale_multiplier||1)))flags.push('stale');
 if(a.ingestion?.source_changed)flags.push('source_revised');
 if(a.language&&!['en'].includes(a.language))flags.push('translation_required');
 const location={precision:reported.length>1?'multi_country':reported.length?'country':'unknown',reported_areas:reported,basis:reported.length?'named_in_source_title':'not_stated_in_metadata',
  issuer_jurisdiction:s?.jurisdictions||[],note:reported.length?'Country named by the source title; confirm against the report. No coordinates are derived.':'The issuer’s jurisdiction is not assumed to be the event location.'};
 const base={id:a.id,kind,method:METHOD,review_status:'machine_suggestion_unreviewed',title:a.title,source:a.source,source_id:s?.id||null,source_class:sourceClass(s),source_type:s?.source_type||null,
  source_url:a.source_url,language:a.language||null,report_date:reportDate,source_updated_at:p.source_updated_at||null,retrieved_at:p.retrieved_at||null,date_precision:p.published_at?'as_published_by_source':'unknown',location,flags,
  record_status:a.status||'pending'};
 if(kind==='outbreak'){
  // Programme, coverage and campaign reports name diseases without describing an outbreak.
  if(/vaccine coverage|immunisation|immunization|vaccination (?:campaign|programme|program|schedule)|vacunaci[oó]n|vacina[cç][aã]o|annual report|guidance|guideline|statistics|data tables|research/iu.test(title))flags.push('possibly_not_an_event');
  if(!disease)flags.push('disease_not_identified');if(disease?.key==='animal-only'||disease?.key==='avian-influenza')flags.push('verify_human_or_animal_host');
  return{...base,disease:disease?{key:disease.key,label:disease.label}:null,pathogen:pathogen?{name:pathogen.name,basis:'named_in_source_title',confirmation:'as_reported_by_source'}:{name:null,basis:'not_named',confirmation:'unconfirmed'},
   event_date:{value:null,basis:'not_in_metadata_read_source'},counts:counts(title),counts_note:'Case and death figures must be taken from the report with their as-of date and case definitions.',
   statement:'Aggregated from monitored sources; not comprehensive real-time surveillance and not a forecast.'};}
 if(!named.length)flags.push('substance_not_identified');
 const primary=categories[0]||(named.length?'known_substance_alert':'unclassified');
 return{...base,substances:named.map(x=>({key:x.key,group:x.group,matched:x.terms.find(t=>word(esc(t)).test(title))})),category:primary,categories:categories.length?categories:[primary],
  event_date:{value:null,basis:'not_in_metadata_read_source'},
  statement:{kind:primary==='scheduling_action'?'legal_control_action':'detection_or_warning',prevalence:'not_assessed',note:'A detection, warning or control action does not show how common a substance is or establish clinical effects.'}};
}
// Cross-source check: same disease and country within 14 days with different title counts.
function markConflicts(list){const groups=new Map();
 for(const c of list){if(c.kind!=='outbreak'||!c.disease||!c.counts.length||!c.report_date)continue;for(const area of c.location.reported_areas){const k=c.disease.key+'|'+area.iso2;(groups.get(k)||groups.set(k,[]).get(k)).push(c);}}
 for(const g of groups.values())for(const a of g)for(const b of g){if(a===b||a.source_id===b.source_id)continue;if(Math.abs(Date.parse(a.report_date)-Date.parse(b.report_date))>14*86400000)continue;
  for(const m of ['cases','deaths']){const x=a.counts.find(c=>c.measure===m),y=b.counts.find(c=>c.measure===m);if(x&&y&&x.value!==y.value&&!a.flags.includes('conflicting_counts_across_sources')){a.flags.push('conflicting_counts_across_sources');a.conflicts=[...(a.conflicts||[]),{with:b.id,measure:m,values:[x.value,y.value]}];}}}
 return list;}
async function list({kind='all',q='',country='',region='',sourceClass:cls='',flag='',category='',statuses=['pending']}={},now=Date.now()){
 const store=require('../store');let rows=[];for(const status of statuses)rows.push(...(await store.listArticles(status)));
 let out=markConflicts(rows.map(a=>build(a,now)).filter(Boolean));const query=String(q).toLowerCase();
 out=out.filter(c=>(kind==='all'||c.kind===kind)&&(!query||[c.title,c.source,c.disease?.label,...(c.substances||[]).map(s=>s.matched)].join(' ').toLowerCase().includes(query))
  &&(!country||c.location.reported_areas.some(x=>x.iso2===country))&&(!region||c.location.reported_areas.some(x=>x.who_region===region))
  &&(!cls||c.source_class===cls)&&(!flag||c.flags.includes(flag))&&(!category||c.categories?.includes(category)));
 return out.sort((a,b)=>String(b.report_date||'').localeCompare(String(a.report_date||'')));}
module.exports={build,list,places,counts,markConflicts,DISEASES,SUBSTANCES,WHO_REGIONS,METHOD};
