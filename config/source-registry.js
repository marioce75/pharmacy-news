// Research directory: adapter availability is not live validation or reuse permission.
const make=(id,name,url,adapter,languages,jurisdictions,topic,extra={})=>({id,name,url,adapter,languages,jurisdictions,topic,official:true,publisher_country:null,status:adapter==='unavailable'?'unavailable':'awaiting_validation',access:'public_metadata',rights:{status:'item_review_required',permitted_use:'original_summary_and_link_only',full_text:false},freshness_hours:48,...extra});
module.exports=[
 make('who-afro','WHO AFRO emergencies','https://www.afro.who.int/rss/emergencies.xml','rss',['en'],['WHO African Region'],'outbreak',{rights:{status:'commercial_permission_review',permitted_use:'metadata_link_only',full_text:false}}),
 make('health-canada','Health Canada health product recalls','https://recalls-rappels.canada.ca/en/feed/health-products-alerts-recalls','rss',['en'],['CA'],'safety'),
 make('tga','TGA safety alerts','https://www.tga.gov.au/feeds/alert/safety-alerts.xml','rss',['en'],['AU'],'safety',{status:'unavailable',access:'validation_blocked',reason:'Official www route corrected; 2026-10-27 validation timed out twice at 15 seconds; no access denial established'}),
 make('ema-news','EMA news','https://www.ema.europa.eu/en/news.xml','rss',['en'],['EU'],'regulation'),
 make('ema-medicines','EMA new human medicines','https://www.ema.europa.eu/en/new-human-medicine-new.xml','rss',['en'],['EU'],'regulation'),
 make('ecdc-updates','ECDC epidemiological updates','https://www.ecdc.europa.eu/en/taxonomy/term/1310/feed','rss',['en'],['EU/EEA'],'outbreak'),
 make('ecdc-risk','ECDC risk assessments','https://www.ecdc.europa.eu/en/taxonomy/term/1295/feed','rss',['en'],['EU/EEA'],'official_assessment'),
 make('mhra-safety','MHRA drug safety','https://www.gov.uk/drug-safety-update.atom','rss',['en'],['GB'],'safety'),
 make('mhra-alerts','MHRA drug/device alerts','https://www.gov.uk/drug-device-alerts.atom','rss',['en'],['GB'],'safety'),
 make('who-don','WHO Disease Outbreak News','https://www.who.int/emergencies/disease-outbreak-news','page',['en'],['global'],'outbreak',{selector:'a[href*="/disease-outbreak-news/item/"]',status:'unavailable',access:'validation_blocked',reason:'2026-10-27 adapter found no report links; JavaScript HubListing response has no report anchors; needs supported data route, not a network denial',rights:{status:'commercial_permission_review',permitted_use:'metadata_link_only',full_text:false}}),
 make('clinicaltrials','ClinicalTrials.gov recent updates','https://clinicaltrials.gov/api/v2/studies?format=json&pageSize=50&sort=LastUpdatePostDate:desc','trials',['en'],['global'],'research',{freshness_hours:72}),
 make('pmda','PMDA selected English medical safety notices','https://www.pmda.go.jp/english/safety/info-services/safety-information/0001.html','pmda-index',['en'],['JP'],'clinical',{coverage_note:'Selected English translations only; not all Japanese alerts',rights:{status:'item_review_required',permitted_use:'original_summary_and_link_only',full_text:false,policy_url:'https://www.pmda.go.jp/english/0013.html',policy:'PDL 1.0 with attribution, edited-content notice and item exceptions'},freshness_hours:2160}),
 ...[
 ['cdc','CDC health alerts','https://www.cdc.gov/han/php/about/',['en'],['US'],'outbreak'],



 ['anvisa','ANVISA','https://www.gov.br/anvisa/pt-br',['pt'],['BR'],'safety'],
 ['sahpra','SAHPRA','https://www.sahpra.org.za/',['en'],['ZA'],'safety'],
 ['sfda','Saudi SFDA','https://www.sfda.gov.sa/',['ar','en'],['SA'],'safety'],
 ['cdsco','CDSCO','https://cdsco.gov.in/',['en'],['IN'],'safety'],

 ['hsa','Singapore HSA','https://www.hsa.gov.sg/',['en'],['SG'],'safety'],
 ['escmid','ESCMID','https://www.escmid.org/',['en'],['international'],'clinical'],
 ['paho','PAHO','https://www.paho.org/',['en','es','pt'],['Americas'],'outbreak']
 ].map(([id,name,url,languages,jurisdictions,topic])=>make(id,name,url,'unavailable',languages,jurisdictions,topic,{reason:id==='paho'?'Access returned 403; no bypass':id==='cdc'?'Planned HAN alerts, advisories and updates; collector endpoint/selector not validated. MMWR weekly feed is separately planned, not connected.':'Endpoint/selector and rights validation required'})),
 make('mhlw-rss','MHLW RSS — excluded',null,'unavailable',['ja'],['JP'],'safety',{access:'prohibited',reason:'RSS redistribution prohibited; excluded',rights:{status:'prohibited',full_text:false}})
];

// Bounded endpoint checks only; no recurring ingestion or reuse permission implied.
for(const s of module.exports)if(['ema-news','ecdc-risk','health-canada','who-afro','pmda'].includes(s.id)){s.status='adapter_checked';s.validation={checked_at:'2026-10-27',http_status:200,parser:'production',rights_cleared:false};}

// Additional explicit inventory: no name implies live coverage or permission.
module.exports.push(
 make('cdc-mmwr','CDC MMWR','https://www.cdc.gov/mmwr/index.html','unavailable',['en'],['US'],'research',{access:'validation_blocked',reason:'Direct official page returned HTTP 403 on 2026-10-28; syndication route still requires confirmed validation'}),
 make('fda-safety','FDA drug safety communications','https://www.fda.gov/drugs/drug-safety-and-availability/drug-safety-communications','page',['en'],['US'],'safety',{selector:'a[href^="/drugs/drug-safety-communications/"]'}),
 make('fda-approvals','FDA application and supplement actions','https://api.fda.gov/drug/drugsfda.json?limit=10&sort=submissions.submission_status_date:desc','fda-applications',['en'],['US'],'regulation',{coverage_note:'Latest bounded application snapshot, including supplemental actions; not all actions are new drug approvals'}),
 make('fda-shortages','FDA drug shortages','https://api.fda.gov/drug/shortages.json?limit=10','fda-shortages',['en'],['US'],'safety',{data_kind:'supply_status',coverage_note:'Bounded snapshot; availability is product/presentation specific, not patient-level availability'}),
 make('fda-recalls','FDA recall public notices','https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts','page',['en'],['US'],'safety',{selector:'a[href*="/safety/recalls-market-withdrawals-safety-alerts/"]'}),
 make('pubmed','PubMed broad pharmacy research','https://pubmed.ncbi.nlm.nih.gov/','unavailable',['en'],['global'],'research',{reason:'Legacy narrow collectors exist separately; broad registry E-utilities adapter not yet validated',rights:{status:'item_review_required',permitted_use:'metadata_link_only',full_text:false}}),
 make('europe-pmc','Europe PMC','https://europepmc.org/','unavailable',['en'],['global'],'research',{reason:'Public API integration and item rights validation pending'}),
 make('cofepris','COFEPRIS sanitary alerts','https://www.gob.mx/cofepris/acciones-y-programas/alertas-sanitarias','unavailable',['es'],['MX'],'safety',{access:'validation_blocked',reason:'Official route returned HTTP 403; no bypass'}),
 make('euda','EUDA public news','https://www.euda.europa.eu/news_en','page',['en'],['EU'],'toxicology',{selector:'a[href*="/news/"]',coverage_note:'Public news only; restricted early-warning networks are excluded'}),
 make('unodc','UNODC public NPS announcements','https://www.unodc.org/LSS/Home/NPS','page',['en'],['global'],'toxicology',{selector:'a[href*="/LSS/Announcement/Details/"]',coverage_note:'Public announcements only; restricted substance dashboards excluded'}),
 make('glass','WHO GLASS antimicrobial use','https://data.who.int/dashboards/amr/antimicrobial-use','unavailable',['en'],['global'],'amr',{data_kind:'measured_dataset',observation_period:'2023 (source research; refresh must be verified)',reason:'Annual measured dataset, not daily news; download/schema/rights validation pending'}),
 make('woah','WOAH animal health news','https://www.woah.org/en/media/news/','page',['en'],['global'],'animal_health',{selector:'a[href*="/en/"]',data_kind:'animal_news',access:'validation_blocked',reason:'News-specific selector needs validation; animal events must remain separate from human outbreaks'}),
 make('promed','ProMED — restricted reuse','https://promedmail.org/','unavailable',['en'],['global'],'outbreak',{access:'restricted',reason:'No redistribution permission established; no restricted access or republication'})
);
Object.assign(module.exports.find(s=>s.id==='cdc'),{access:'validation_blocked',reason:'HAN archive returned HTTP 403 on 2026-10-28; no bypass. Supported syndication route remains unvalidated'});

Object.assign(module.exports.find(s=>s.id==='pubmed'),{url:'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term='+encodeURIComponent('pharmacology OR drug therapy OR drug discovery OR antimicrobial resistance')+'&retmode=json&sort=pub_date&retmax=10',adapter:'pubmed',status:'awaiting_validation',reason:'Broad metadata only; abstracts not imported'});
Object.assign(module.exports.find(s=>s.id==='europe-pmc'),{url:'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=pharmacology&format=json&pageSize=10&sort_date=y',adapter:'europe-pmc',status:'awaiting_validation',reason:'Bounded bibliographic search; no full-text or abstracts imported'});

Object.assign(module.exports.find(s=>s.id==='fda-recalls'),{adapter:'fda-recalls',coverage_note:'Drug, biologic, device and supplement public notices only; excludes food-only notices and enforcement datasets'});
Object.assign(module.exports.find(s=>s.id==='euda'),{adapter:'euda-news'});
Object.assign(module.exports.find(s=>s.id==='unodc'),{languages:['en','es'],coverage_note:'Mixed-language public announcements; individual language requires editorial confirmation; no restricted dashboards'});
Object.assign(module.exports.find(s=>s.id==='cdc-mmwr'),{url:'https://tools.cdc.gov/api/v2/resources/media/342778.rss',adapter:'rss',access:'public_metadata',status:'awaiting_validation',reason:'Official separately documented syndication feed; validation pending, no retry of denied CDC pages',rights:{status:'commercial_permission_review',permitted_use:'metadata_link_only',full_text:false}});

for(const id of ['cdc-mmwr','fda-safety','fda-approvals','fda-shortages','fda-recalls','pubmed','europe-pmc','euda','unodc']){
 const source=module.exports.find(s=>s.id===id);source.status='manual_metadata_collected';source.validation={checked_at:'2026-10-28',http_status:200,parser:'production',rights_cleared:false,recurring:false};
 if(['cdc-mmwr','pubmed','europe-pmc'].includes(id))source.reason='Bounded manual metadata collection passed; original summaries and rights review still required';
}
for(const id of ['pubmed','europe-pmc'])module.exports.find(s=>s.id===id).languages=['und'];

for(const id of ['pubmed','europe-pmc','fda-approvals','fda-shortages']){
 const source=module.exports.find(s=>s.id===id);source.pagination={page_size:25,max_pages_per_run:2,max_pages_per_scan:1000,max_queue:5000,bootstrap_days:7,overlap_days:7};source.coverage_note='Bounded resumable query windows; incomplete status persists when caps stop scanning or intake. Not exhaustive worldwide coverage.';
}

Object.assign(module.exports.find(s=>s.id==='fda-shortages').pagination,{page_size:100,max_pages_per_run:20});
module.exports.find(s=>s.id==='fda-shortages').coverage_note='Newest-first full snapshot pagination with a locally parsed update-date overlap; known records are rechecked for revisions. No unsupported server date filter. Caps remain explicit.';
// Official feed-directory additions. Availability and content rights are separate checks.
module.exports.push(
 make('ecdc-threats','ECDC communicable disease threats','https://www.ecdc.europa.eu/en/taxonomy/term/1505/feed','rss',['en'],['EU/EEA'],'outbreak',{coverage_note:'Weekly threats reports, not exhaustive global surveillance',rights:{status:'item_review_required',permitted_use:'original_summary_and_link_only',full_text:false,policy_url:'https://www.ecdc.europa.eu/en/ecdc-intellectual-property-notices',policy:'Default CC BY 4.0; attribution, licence and modification notice; verify third-party exceptions'}}),
 make('ecdc-guidance','ECDC guidance','https://www.ecdc.europa.eu/en/taxonomy/term/1301/feed','rss',['en'],['EU/EEA'],'clinical'),
 make('euda-rss','EUDA public news RSS','https://www.euda.europa.eu/news/home/rss.xml','rss',['en'],['EU'],'toxicology',{coverage_note:'Alternate public discovery feed; cross-source story linkage is a candidate, not automatic verified deduplication'})
);

for(const id of ['ecdc-threats','ecdc-guidance']){const s=module.exports.find(s=>s.id===id);s.status='adapter_checked';s.validation={checked_at:'2026-10-29',http_status:200,parser:'production',rights_cleared:false};}
Object.assign(module.exports.find(s=>s.id==='euda-rss'),{status:'unavailable',access:'validation_blocked',reason:'Official advertised RSS route returned HTTP 301 on 2026-10-29; redirect not followed by restricted-host collector. Existing EUDA public page adapter remains working.'});

// Worldwide outbreak and substance-alert sources verified 2026-10-29 (see config/sources-worldwide.js).
module.exports.push(...require('./sources-worldwide'));
Object.assign(module.exports.find(s=>s.id==='who-don'),{reason:'HTML hub has no server-rendered report links; superseded by the official who-don-api JSON endpoint'});
// 2026-10-29 verification: the EUDA news page now returns HTTP 403; it is not retried or bypassed.
Object.assign(module.exports.find(s=>s.id==='euda'),{access:'validation_blocked',reason:'EUDA news page returned HTTP 403 on 2026-10-29 (bot protection); no bypass. Earlier manual metadata collection on 2026-10-28 is retained.'});
Object.assign(module.exports.find(s=>s.id==='paho'),{reason:'Generic PAHO entry superseded by paho-epi-alerts and paho-news-filtered (HTTP 200 on 2026-10-29); earlier 403 recorded'});
