// Country names for matching places that a source names in its own title. A match is a
// reported area at country precision only; it never yields coordinates or patient locations.
// WHO region codes: AFR, AMR, SEAR, EUR, EMR, WPR (Indonesia moved to WPR in 2025).
const rows=`DZ|Algeria|AFR|Argelia|Algérie|Argélia
AO|Angola|AFR
BJ|Benin|AFR|Bénin
BW|Botswana|AFR
BF|Burkina Faso|AFR
BI|Burundi|AFR
CV|Cabo Verde|AFR|Cape Verde
CM|Cameroon|AFR|Camerún|Cameroun|Camarões
CF|Central African Republic|AFR|República Centroafricana|République centrafricaine
TD|Chad|AFR|Tchad
KM|Comoros|AFR|Comores
CD|Democratic Republic of the Congo|AFR|DR Congo|DRC|República Democrática del Congo|République démocratique du Congo|RD Congo|RDC|Congo-Kinshasa
CG|Republic of the Congo|AFR|Congo-Brazzaville|République du Congo
CI|Côte d'Ivoire|AFR|Cote d'Ivoire|Ivory Coast|Costa de Marfil
GQ|Equatorial Guinea|AFR|Guinea Ecuatorial|Guinée équatoriale
ER|Eritrea|AFR|Érythrée
SZ|Eswatini|AFR|Swaziland
ET|Ethiopia|AFR|Etiopía|Éthiopie
GA|Gabon|AFR|Gabón
GM|Gambia|AFR|The Gambia|Gambie
GH|Ghana|AFR
GW|Guinea-Bissau|AFR|Guinée-Bissau
GN|Guinea|AFR|Guinée
KE|Kenya|AFR|Kenia
LS|Lesotho|AFR
LR|Liberia|AFR|Libéria
MG|Madagascar|AFR
MW|Malawi|AFR
ML|Mali|AFR
MR|Mauritania|AFR|Mauritanie
MU|Mauritius|AFR|Mauricio|Maurice
MZ|Mozambique|AFR|Moçambique
NA|Namibia|AFR|Namibie
NE|Niger|AFR
NG|Nigeria|AFR|Nigéria
RW|Rwanda|AFR|Ruanda
ST|Sao Tome and Principe|AFR|São Tomé and Príncipe|Santo Tomé y Príncipe
SN|Senegal|AFR|Sénégal
SC|Seychelles|AFR
SL|Sierra Leone|AFR|Sierra Leona
ZA|South Africa|AFR|Sudáfrica|Afrique du Sud|África do Sul
SS|South Sudan|AFR|Sudán del Sur|Soudan du Sud
TG|Togo|AFR
UG|Uganda|AFR|Ouganda
TZ|United Republic of Tanzania|AFR|Tanzania|Tanzanie
ZM|Zambia|AFR|Zambie
ZW|Zimbabwe|AFR
AG|Antigua and Barbuda|AMR|Antigua y Barbuda
AR|Argentina|AMR|Argentine
BS|Bahamas|AMR
BB|Barbados|AMR
BZ|Belize|AMR|Belice
BO|Bolivia|AMR|Plurinational State of Bolivia|Bolivie
BR|Brazil|AMR|Brasil|Brésil
CA|Canada|AMR|Canadá
CL|Chile|AMR|Chili
CO|Colombia|AMR|Colombie
CR|Costa Rica|AMR
CU|Cuba|AMR
DM|Dominica|AMR
DO|Dominican Republic|AMR|República Dominicana|République dominicaine
EC|Ecuador|AMR|Équateur
SV|El Salvador|AMR
GD|Grenada|AMR|Granada
GT|Guatemala|AMR
GY|Guyana|AMR
HT|Haiti|AMR|Haití|Haïti
HN|Honduras|AMR
JM|Jamaica|AMR|Jamaïque
MX|Mexico|AMR|México|Mexique
NI|Nicaragua|AMR
PA|Panama|AMR|Panamá
PY|Paraguay|AMR
PE|Peru|AMR|Perú|Pérou
KN|Saint Kitts and Nevis|AMR
LC|Saint Lucia|AMR|Santa Lucía
VC|Saint Vincent and the Grenadines|AMR
SR|Suriname|AMR|Surinam
TT|Trinidad and Tobago|AMR|Trinidad y Tobago
US|United States|AMR|United States of America|USA|U.S.|Estados Unidos|États-Unis
UY|Uruguay|AMR
VE|Venezuela|AMR|Bolivarian Republic of Venezuela
BD|Bangladesh|SEAR
BT|Bhutan|SEAR|Bhoutan
KP|Democratic People's Republic of Korea|SEAR|North Korea|DPRK
IN|India|SEAR|Inde
MV|Maldives|SEAR|Maldivas
MM|Myanmar|SEAR|Burma
NP|Nepal|SEAR|Népal
LK|Sri Lanka|SEAR
TH|Thailand|SEAR|Tailandia|Thaïlande
TL|Timor-Leste|SEAR|East Timor
AL|Albania|EUR|Albanie
AD|Andorra|EUR|Andorre
AM|Armenia|EUR|Arménie
AT|Austria|EUR|Autriche
AZ|Azerbaijan|EUR|Azerbaïdjan
BY|Belarus|EUR|Bielorrusia
BE|Belgium|EUR|Bélgica|Belgique
BA|Bosnia and Herzegovina|EUR|Bosnia
BG|Bulgaria|EUR|Bulgarie
HR|Croatia|EUR|Croacia|Croatie
CY|Cyprus|EUR|Chipre|Chypre
CZ|Czechia|EUR|Czech Republic|Chequia|Tchéquie
DK|Denmark|EUR|Dinamarca|Danemark
EE|Estonia|EUR|Estonie
FI|Finland|EUR|Finlandia|Finlande
FR|France|EUR|Francia|França
GE|Georgia|EUR|Géorgie
DE|Germany|EUR|Alemania|Allemagne|Alemanha|Deutschland
GR|Greece|EUR|Grecia|Grèce
HU|Hungary|EUR|Hungría|Hongrie
IS|Iceland|EUR|Islandia|Islande
IE|Ireland|EUR|Irlanda|Irlande
IL|Israel|EUR|Israël
IT|Italy|EUR|Italia|Italie|Itália
KZ|Kazakhstan|EUR|Kazajistán
KG|Kyrgyzstan|EUR|Kirguistán
LV|Latvia|EUR|Letonia|Lettonie
LT|Lithuania|EUR|Lituania|Lituanie
LU|Luxembourg|EUR|Luxemburgo
MT|Malta|EUR|Malte
MC|Monaco|EUR|Mónaco
ME|Montenegro|EUR|Monténégro
NL|Netherlands|EUR|Países Bajos|Pays-Bas|Holanda
MK|North Macedonia|EUR|Macedonia del Norte
NO|Norway|EUR|Noruega|Norvège
PL|Poland|EUR|Polonia|Pologne
PT|Portugal|EUR
MD|Republic of Moldova|EUR|Moldova|Moldavia
RO|Romania|EUR|Rumania|Roumanie
RU|Russian Federation|EUR|Russia|Rusia|Russie
SM|San Marino|EUR
RS|Serbia|EUR|Serbie
SK|Slovakia|EUR|Eslovaquia|Slovaquie
SI|Slovenia|EUR|Eslovenia|Slovénie
ES|Spain|EUR|España|Espagne|Espanha
SE|Sweden|EUR|Suecia|Suède
CH|Switzerland|EUR|Suiza|Suisse|Schweiz
TJ|Tajikistan|EUR|Tayikistán
TR|Türkiye|EUR|Turkey|Turquía|Turquie
TM|Turkmenistan|EUR
UA|Ukraine|EUR|Ucrania
GB|United Kingdom|EUR|UK|Great Britain|England|Scotland|Wales|Northern Ireland|Reino Unido|Royaume-Uni
UZ|Uzbekistan|EUR|Uzbekistán
AF|Afghanistan|EMR|Afganistán
BH|Bahrain|EMR|Bahréin
DJ|Djibouti|EMR|Yibuti
EG|Egypt|EMR|Egipto|Égypte
IR|Iran|EMR|Islamic Republic of Iran|Irán
IQ|Iraq|EMR|Irak
JO|Jordan|EMR|Jordania|Jordanie
KW|Kuwait|EMR|Koweït
LB|Lebanon|EMR|Líbano|Liban
LY|Libya|EMR|Libia|Libye
MA|Morocco|EMR|Marruecos|Maroc
OM|Oman|EMR|Omán
PK|Pakistan|EMR|Pakistán
PS|occupied Palestinian territory|EMR|Palestine|Gaza|West Bank
QA|Qatar|EMR
SA|Saudi Arabia|EMR|Kingdom of Saudi Arabia|Arabia Saudita|Arabie saoudite
SO|Somalia|EMR|Somalie
SD|Sudan|EMR|Sudán|Soudan
SY|Syrian Arab Republic|EMR|Syria|Siria|Syrie
TN|Tunisia|EMR|Túnez|Tunisie
AE|United Arab Emirates|EMR|UAE|Emiratos Árabes Unidos|Émirats arabes unis
YE|Yemen|EMR|Yémen
AU|Australia|WPR|Australie
BN|Brunei Darussalam|WPR|Brunei
KH|Cambodia|WPR|Camboya|Cambodge
CN|China|WPR|People's Republic of China|Chine
HK|Hong Kong SAR, China|WPR|Hong Kong
MO|Macao SAR, China|WPR|Macao|Macau
CK|Cook Islands|WPR
FJ|Fiji|WPR|Fiyi|Fidji
ID|Indonesia|WPR|Indonésie
JP|Japan|WPR|Japón|Japon|Japão
KI|Kiribati|WPR
LA|Lao People's Democratic Republic|WPR|Laos|Lao PDR
MY|Malaysia|WPR|Malasia|Malaisie
MH|Marshall Islands|WPR
FM|Micronesia|WPR|Federated States of Micronesia
MN|Mongolia|WPR|Mongolie
NR|Nauru|WPR
NZ|New Zealand|WPR|Nueva Zelanda|Nouvelle-Zélande|Aotearoa
NU|Niue|WPR
PW|Palau|WPR
PG|Papua New Guinea|WPR|Papúa Nueva Guinea|Papouasie-Nouvelle-Guinée
PH|Philippines|WPR|Filipinas
KR|Republic of Korea|WPR|South Korea|Korea|Corea del Sur|Corée du Sud
WS|Samoa|WPR
SG|Singapore|WPR|Singapur|Singapour
SB|Solomon Islands|WPR|Islas Salomón
TO|Tonga|WPR
TV|Tuvalu|WPR
VU|Vanuatu|WPR
VN|Viet Nam|WPR|Vietnam`;
const COUNTRIES=rows.split('\n').map(line=>{const [iso2,name,who_region,...aliases]=line.split('|');return Object.freeze({iso2,name,who_region,aliases:Object.freeze(aliases)});});
const WHO_REGIONS=Object.freeze({AFR:'African Region',AMR:'Region of the Americas',SEAR:'South-East Asia Region',EUR:'European Region',EMR:'Eastern Mediterranean Region',WPR:'Western Pacific Region'});
module.exports={COUNTRIES,WHO_REGIONS};
