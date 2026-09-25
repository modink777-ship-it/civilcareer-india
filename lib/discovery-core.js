/**
 * CivilCareer — Discovery Validation Core (pure functions, no network, no DB)
 *
 * ARCHITECTURE (source-specific validation — the deliberate fix):
 *
 *   NEWS SOURCES (google_news, bing_news)
 *     News feeds are NOT job feeds. A result is only a vacancy when BOTH hold:
 *       a) strong hiring/vacancy language AND absence of news/project noise, AND
 *       b) strong India evidence from the item itself (title/location/body).
 *     The user's search query or requested location is NEVER used as India
 *     evidence, and a missing location is never defaulted to "India".
 *
 *   JOB BOARDS (jobicy, arbeitnow, and any worldwide board)
 *     Structured validation: explicit India city/state/country tokens are
 *     accepted, explicit foreign-only locations are rejected, and records with
 *     NO location evidence at all are rejected (a worldwide board cannot
 *     prove India).
 *
 *   INDIA-SPECIFIC SOURCES (hopin, onjob)
 *     These platforms are demonstrably India-focused (Hopin is an Indian
 *     hiring platform; OnJob documents itself as "India's AI job search
 *     platform"). For these sources only, a record whose location fields are
 *     empty is accepted as India — while records that EXPLICITLY name a
 *     foreign country/location (including Gulf countries) are still rejected.
 *
 * FRESHNESS (exact milliseconds, never rounded before classification):
 *     fresh24h  : ageMs <= 24 h              (23h59m stays fresh)
 *     backup30d : 24 h < ageMs <= 30 days    (24h01m is backup)
 *     too_old   : ageMs > 30 days            (30d + 1 minute is rejected)
 *     future    : posted more than 2 h in the future (clock tolerance)
 *     unknown   : unparseable/missing date — tracked separately, excluded
 *                 from fresh24h and backup30d counts.
 */

'use strict';

/* ── Freshness constants (exact ms) ─────────────────────────────────── */
const FRESH_24H_MS = 24 * 60 * 60 * 1000;          // 86,400,000
const BACKUP_30D_MS = 30 * 24 * 60 * 60 * 1000;    // 2,592,000,000
const FUTURE_TOL_MS = 2 * 60 * 60 * 1000;          // 2-hour clock tolerance

/* ── Source classification ──────────────────────────────────────────── */
const NEWS_SOURCES = new Set(['google_news', 'bing_news', 'news.google.com', 'bing.com']);

// Demonstrably India-focused platforms (verified from the source's own
// documentation/product): Hopin is an India hiring platform, OnJob documents
// itself as "India's AI job search platform".
// Sources whose platform itself is India-specific (documented by the source):
// a missing optional location field may be tolerated, but an explicit foreign
// location on any record is still rejected.
//
// 'company_careers' qualifies by construction: it is the career page of a
// company on the curated Indian construction/EPC/real-estate list in
// lib/company-careers.js, so an omitted location is India by establishment
// while a posting that explicitly names Dubai/London/etc. is still rejected.
const TRUSTED_INDIA_SOURCES = new Set([
  'hopin', 'hopinjobs.com', 'onjob', 'onjob.io', 'adzuna', 'company_careers',
]);

function isNewsSource(src) {
  return NEWS_SOURCES.has(String(src || '').toLowerCase());
}

function isTrustedIndiaSource(src) {
  return TRUSTED_INDIA_SOURCES.has(String(src || '').toLowerCase());
}

/* ── Text helpers ───────────────────────────────────────────────────── */
function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (m, d) => {
      try { return String.fromCharCode(Number(d)); } catch (_) { return m; }
    })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function cleanText(value) {
  return decodeXmlEntities(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Normalized token space: lowercase, only a-z0-9 and single spaces.
function normText(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/* ── India geography vocabulary ─────────────────────────────────────── */
const INDIA_CITY_WORDS = [
  'bengaluru','bangalore','mumbai','navi mumbai','delhi','new delhi','hyderabad','chennai',
  'pune','ahmedabad','kolkata','kochi','cochin','jaipur','gurugram','gurgaon','noida',
  'greater noida','lucknow','indore','nagpur','surat','bhubaneswar','patna','thiruvananthapuram',
  'trivandrum','visakhapatnam','vizag','vadodara','baroda','coimbatore','madurai','agra','kanpur',
  'nashik','nasik','aurangabad','rajkot','meerut','faridabad','thane','pimpri','chinchwad',
  'chandigarh','ranchi','guwahati','bhopal','dehradun','mysuru','mysore','hubli','hubballi',
  'belgaum','belagavi','mangalore','mangaluru','kozhikode','calicut','thrissur','ernakulam',
  'solapur','kolhapur','amravati','nanded','raipur','bilaspur','durg','bhilai','dhanbad',
  'bokaro','jamshedpur','durgapur','asansol','siliguri','jodhpur','kota','ujjain','gwalior',
  'jabalpur','gorakhpur','varanasi','banaras','prayagraj','allahabad','bareilly','moradabad',
  'aligarh','mathura','jhansi','saharanpur','muzaffarnagar','ambala','panipat','sonipat','sonepat',
  'karnal','rohtak','hisar','bathinda','ludhiana','patiala','mohali','shimla','srinagar',
  'trichy','tiruchirappalli','salem','thanjavur','tanjore','tirunelveli','vellore','pondicherry',
  'puducherry','udupi','shimoga','kollam','kannur','palakkad','warangal','guntur','nellore',
  'tirupati','vijayawada','cuttack','sambalpur','berhampur','muzaffarpur','darbhanga','gaya',
  'bhagalpur','purnia','haridwar','roorkee','haldwani','gandhinagar','bhavnagar','jamnagar',
  'junagadh','vapi','valsad','bharuch','ankleshwar','mehsana','morbi','anand','nadiad','ratlam',
  'sagar','satna','katni','chhindwara','shivpuri','vidisha','hoshangabad','khandwa','burhanpur',
  'rishikesh','kotdwar','pathankot','batala','phagwara','moga','firozpur','amritsar','jalandhar',
  'rohtas','balasore','baripada','angul','jajpur','kharagpur','digha','haldia','darjeeling',
  'dooars','jalpaiguri','berhampore','krishnanagar','durgapur-1','purnea','katihar','araria',
  'kishanganj','sitamarhi','begusarai','samastipur','saharsa','supaul','madhubani','deoghar',
  'giridih','hazaribagh','ramgarh','medininagar','daltonganj','chatra','gumla','simdega',
];

// States + union territories (aliases included). NOTE: 'jharkhand' listed once.
const INDIA_STATES = [
  'karnataka','maharashtra','telangana','tamil nadu','tamilnadu','delhi','new delhi',
  'uttar pradesh','up','rajasthan','gujarat','west bengal','kerala','andhra pradesh',
  'madhya pradesh','mp','bihar','odisha','orissa','chhattisgarh','jharkhand','assam','punjab',
  'haryana','himachal pradesh','uttarakhand','uttaranchal','goa','tripura','meghalaya',
  'manipur','nagaland','arunachal pradesh','mizoram','sikkim','jammu','kashmir','ladakh',
  'chandigarh','puducherry','pondicherry','andaman','nicobar','dadra','nagar haveli','daman','diu','lakshadweep',
];

// Explicitly foreign country / city markers. Used to REJECT foreign-only
// listings — never to reject a listing that carries real India evidence.
const FOREIGN_LOCATION_MARKERS = [
  'uk','u k','united kingdom','britain','great britain','england','scotland','wales',
  'northern ireland','ireland','london','manchester','birmingham uk','leeds','glasgow',
  'liverpool','bristol','sheffield','edinburgh','cardiff','belfast','pudsey','leicester',
  'nottingham','newcastle','southampton','plymouth','aberdeen','dublin','cork',
  'usa','u s','united states','united states of america','america','new york','boston',
  'chicago','san francisco','los angeles','seattle','austin','dallas','houston','denver',
  'atlanta','miami','washington dc','canada','toronto','vancouver','montreal','calgary','ottawa',
  'australia','sydney','melbourne','brisbane','perth','adelaide','canberra','new south wales',
  'germany','deutschland','berlin','munich','hamburg','frankfurt','stuttgart','cologne',
  'france','paris','lyon','marseille','netherlands','amsterdam','rotterdam','belgium',
  'brussels','antwerp','switzerland','zurich','geneva','austria','vienna','spain','madrid',
  'barcelona','italy','rome','milan','turin','portugal','lisbon','porto','poland','warsaw',
  'krakow','czech republic','prague','hungary','budapest','romania','bucharest','bulgaria',
  'croatia','serbia','ukraine','kyiv','russia','moscow','denmark','copenhagen','sweden',
  'stockholm','norway','oslo','finland','helsinki','iceland','europe','european union',
  'singapore','malaysia','kuala lumpur','indonesia','jakarta','philippines','manila',
  'thailand','bangkok','vietnam','ho chi minh','hanoi','china','beijing','shanghai','shenzhen',
  'japan','tokyo','osaka','south korea','seoul','taiwan','taipei','hong kong','macau',
  'pakistan','karachi','lahore','islamabad','bangladesh','dhaka','sri lanka','colombo',
  'nepal','kathmandu','bhutan','maldives','afghanistan','kabul','myanmar','yangon',
  'nigeria','lagos','kenya','nairobi','ethiopia','addis ababa','ghana','accra','egypt','cairo',
  'south africa','johannesburg','cape town','durban','tanzania','uganda','morocco','casablanca',
  'mexico','mexico city','brazil','sao paulo','rio de janeiro','argentina','buenos aires',
  'chile','santiago','colombia','bogota','peru','lima','panama','costa rica','caribbean',
  'new zealand','auckland','wellington','fiji',
];

// Gulf region markers. Listings targeting Gulf/abroad roles ("Gulf vacancy for
// Indian candidates") are NOT India vacancies even on India-focused sources.
const GULF_LOCATION_MARKERS = [
  'uae','united arab emirates','dubai','abu dhabi','sharjah','ajman','ras al khaimah',
  'fujairah','umm al quwain','saudi arabia','ksa','riyadh','jeddah','dammam','mecca','medina',
  'qatar','doha','kuwait','bahrain','manama','oman','muscat','salalah','gulf countries',
  'middle east','gcc countries',
];

function markerRegex(markers) {
  const escaped = markers
    .map(m => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
    .join('|');
  return new RegExp(`(?:^|[^a-z0-9])(?:${escaped})(?:[^a-z0-9]|$)`, 'i');
}

const INDIA_TOKEN_REGEX = new RegExp(
  '(?:^|[^a-z0-9])(?:' +
  [
    'india','indian','bharat','pan india','pan-india','all india','across india',
    'india remote','remote india','india based','india-based','india remote',
    'anywhere in india',
    // National infrastructure / recruiting institutions that prove India:
    'nhai','nhidcl','cpwd','pwd','morth','pmgsy','nbcc','npcil','ntpc','pgcil','dfccil',
    'rvnl','ircon','mes','railway','public works department',
  ].join('|') +
  ')(?:[^a-z0-9]|$)',
  'i'
);

const INDIA_CITY_REGEX = markerRegex(INDIA_CITY_WORDS);
const INDIA_STATE_REGEX = markerRegex(INDIA_STATES);
const FOREIGN_REGEX = markerRegex(FOREIGN_LOCATION_MARKERS);
const GULF_REGEX = markerRegex(GULF_LOCATION_MARKERS);

function hasIndiaToken(text) {
  const t = String(text || '');
  return INDIA_TOKEN_REGEX.test(t) || INDIA_CITY_REGEX.test(t) || INDIA_STATE_REGEX.test(t);
}

function hasForeignToken(text) {
  return FOREIGN_REGEX.test(String(text || ''));
}

function hasGulfToken(text) {
  return GULF_REGEX.test(String(text || ''));
}

/* ── Country-field classification ───────────────────────────────────── */
function countryIsIndia(country) {
  const s = String(country || '').toLowerCase().trim().replace(/\./g, ' ').replace(/\s+/g, ' ');
  if (!s) return false;
  if (/^(in|ind|india)$/.test(s)) return true;
  return /\bindia\b/.test(s);
}

const FOREIGN_COUNTRY_CODES = /\b(us|usa|u s|uk|gb|united kingdom|britain|england|ca|canada|au|australia|de|germany|fr|france|nl|netherlands|be|belgium|es|spain|it|italy|ch|switzerland|se|sweden|no|norway|dk|denmark|fi|finland|pl|poland|pt|portugal|ie|ireland|sg|singapore|nz|new zealand|jp|japan|kr|south korea|cn|china|hk|hong kong|my|malaysia|th|thailand|vn|vietnam|ph|philippines|id|indonesia|pk|pakistan|bd|bangladesh|lk|sri lanka|np|nepal|za|south africa|ae|united arab emirates|uae|sa|saudi arabia|qa|qatar|kw|kuwait|bh|bahrain|om|oman|eu|europe)\b/;

function countryIsForeign(country) {
  const s = String(country || '').toLowerCase().trim().replace(/\./g, ' ').replace(/\s+/g, ' ');
  if (!s) return false;
  if (/\bindia\b/.test(s)) return false; // e.g. "Remote, India" never foreign
  return FOREIGN_COUNTRY_CODES.test(s);
}

/* ── CIVIL ROLE CLASSIFICATION ──────────────────────────────────────── */

// Strong accept: the title/body explicitly names a civil/construction role.
const CIVIL_ROLE_REGEX = new RegExp(
  '\\b(?:' + [
    'civil engineer','civil engineering','civil site engineer','civil site',
    'junior civil engineer','graduate civil engineer','graduate engineer civil',
    'civil graduate','diploma civil','civil draughtsman','civil draftsman','civil draftman',
    'site engineer','site civil','site execution','execution engineer','site incharge',
    'site supervisor','construction supervisor','construction engineer','construction manager',
    'assistant engineer','junior engineer','je civil','ae civil',
    'structural engineer','structural design','structural designer',
    'geotechnical engineer','geotechnical','soil engineer',
    'highway engineer','road engineer','roads engineer','bridge engineer','rail engineer',
    'railway engineer','metro engineer','tunnel engineer',
    'transportation engineer','traffic engineer','transport engineer',
    'water resources engineer','water resource engineer','irrigation engineer','hydraulic engineer',
    'hydro power engineer','sanitary engineer','public health engineer','environmental engineer',
    'planning engineer','execution planning','pmc engineer',
    'estimation engineer','estimation','estimator','billing engineer','billing',
    'quantity surveyor','quantity survey','qs engineer','contract manager','contracts engineer',
    'qa qc','qa/qc','quality control engineer','quality assurance engineer',
    'bim engineer','bim modeler','bim modeller','bim coordinator','bim civil','bim',
    'civil designer','design engineer civil','autocad civil','cad engineer civil',
    'resident engineer','infrastructure engineer','civil works','civil work',
    'land surveyor','survey engineer','site surveyor','surveyor',
    'project engineer civil','project engineer','graduate engineer trainee',
    'engineer trainee civil','trainee civil','get civil','pwd','nhai','cpwd',
  ].join('|') + ')\\b'
);

// Broad civil/construction domain context (used to allow descriptions that
// prove the work is civil even when the title alone is generic).
const CIVIL_CONTEXT_REGEX = /\b(civil|construction|structural|geotechnical|highway|road|bridge|infrastructure|irrigation|hydraulic|water resources|quantity survey|estimat|billing|planning engineer|bim|autocad|rebar|bar bending|shuttering|centering|concreting|concrete|rcc|pcc|excavation|earthwork|pile|foundation|formwork|scaffold|survey|levelling|leveling|tender|boq|measurement|drawing|draft|draught|pwd|nhai|cpwd|railway|metro|port|dam|canal|building|housing|urban|sanitary|water supply|drainage|sewer|pipeline|site execution|mason|barbender|bar bender)\b/;

// Non-civil roles. If one of these appears WITHOUT genuine civil/construction
// work context, the record is rejected — even when the description merely
// MENTIONS civil engineering (e.g. "software for civil infrastructure").
const NON_CIVIL_REGEX = /\b(software engineer|software developer|software|developer|full ?stack|frontend|front end|back end|backend|devops|sre|site reliability|data engineer|data scientist|data analyst|database administrator|business analyst|machine learning|deep learning|artificial intelligence|ai engineer|ml engineer|prompt engineer|android developer|ios developer|mobile app developer|game developer|game designer|graphic designer|ux designer|ui designer|web designer|digital marketing|marketing executive|marketing manager|marketing|sales executive|sales manager|sales engineer|sales representative|inside sales|business development|bd executive|hr executive|hr manager|human resources|recruiter|talent acquisition|accountant|accounts executive|accounting|finance manager|financial analyst|finance|chartered accountant|company secretary|mechanical engineer|mechanical design|mechanical|electrical engineer|electrical design|electrician|electronics engineer|instrumentation|embedded engineer|embedded|firmware|vlsi|fpga|network engineer|network administrator|system administrator|sysadmin|cloud engineer|cloud architect|cybersecurity|security analyst|qa automation|test automation|automation test|test engineer|sdet|product manager|product designer|product owner|program manager|scrum master|content writer|copywriter|technical writer|customer support|customer success|telecaller|telemarketing|call center|operations manager|supply chain|logistics|warehouse|store keeper|purchase officer|procurement executive|administration executive|office administrator|receptionist|teacher|faculty|nurse|pharmacist|architect interior|interior designer|fashion designer|chef|cook|driver|security guard)\b/;

// Concrete civil/construction work practices — evidence that the actual work
// of the role is civil engineering, not merely that the posting mentions the
// word "civil" or "infrastructure".
const CIVIL_PRACTICE_REGEX = /\b(bar bending|bbs|bar bending schedule|shuttering|centering and shuttering|formwork|reinforced cement concrete|reinforced concrete|rcc works|rcc|concreting|concrete pouring|pouring concrete|pile foundation|bored pile|pile cap|pile driving|footing|raft foundation|isolated footing|column|beam|slab|plinth|plinth beam|earthwork|earth work|excavation|backfilling|back filling|dewatering|compaction|levelling|leveling|grouting|rebar|reinforcement|reinforcement detailing|autocad drawings|gad drawing|ga drawing|structural drawing|as built drawing|surveying|total station|auto level|dumpy level|theodolite|quantity takeoff|quantity take off|boq|measurement book|ra bill|running account bill|rate analysis|soq|soil testing|soil investigation|cube test|concrete cube|slump test|fdd|field density test|core cutter|plate load test|material reconciliation|reconciliation|site diary|daily progress report|setting out|marking layout|laying out|pipeline laying|road marking|carpeting|bituminous|bm bc|dbm|wmm|gsb|embankment|culvert|retaining wall|box pushing|concreting works|manhole|sewer line|water supply line|pumping main|raising main|centering|shuttering carpenter|bar bender|mason work|plastering|brickwork|blockwork|tile work|waterproofing|expansion joint|bearing fixing|prestressing|post tensioning|segment launching|girder launching|viaduct|flyover|underpass|rob|rub|culvert construction)\b/;

/**
 * Decide whether a record is a genuine civil/construction role.
 * @returns {{accept:boolean, reason:string}}
 */
function classifyCivilRole(title, description) {
  const titleText = cleanText(title);
  const bodyText = cleanText(description || '');
  const titleNorm = normText(titleText);
  const bodyNorm = normText(bodyText);
  const combined = `${titleNorm} ${bodyNorm}`;

  // 1. Strong accept — explicit civil/construction role wording.
  if (CIVIL_ROLE_REGEX.test(titleNorm) || CIVIL_ROLE_REGEX.test(combined)) {
    return { accept: true, reason: 'civil role keywords' };
  }

  const nonCivil = NON_CIVIL_REGEX.test(combined);
  const civilContext = CIVIL_CONTEXT_REGEX.test(combined);
  const civilPractice = CIVIL_PRACTICE_REGEX.test(combined);

  // 2. Non-civil roles are rejected unless the record clearly establishes
  //    hands-on civil/construction engineering responsibility.
  if (nonCivil) {
    if (civilPractice) return { accept: true, reason: 'civil work practices in description' };
    return { accept: false, reason: 'non-civil role without civil work evidence' };
  }

  // 3. Generic title + civil/construction context + concrete work practices.
  if (civilContext && civilPractice) {
    return { accept: true, reason: 'civil context with work practices' };
  }

  // 4. Otherwise not a civil role.
  return {
    accept: false,
    reason: civilContext ? 'generic role, no concrete civil work evidence' : 'not a civil/construction role',
  };
}

/* ── NEWS VACANCY GATE (strict) ─────────────────────────────────────── */

// Hiring/vacancy wording directly in the headline — the strongest news signal.
const NEWS_VACANCY_TITLE_REGEX = /\b(job|jobs|vacanc\w*|recruit\w*|hiring|hire|career\w*|opening\w*|apply|walk[\s-]?in|interview|notification|job alert|employment)\b/i;

// Hiring/vacancy language anywhere in title + summary.
const NEWS_VACANCY_TEXT_REGEX = /\b(application[s]? (?:are |have )?(?:invited|open)|invites? applications?|apply (?:now|online|before|by|latest)|last date(?: to apply)?|notification (?:out|released)|vacant posts?|\d+\s*(?:\+\s*)?(?:vacanc\w+|posts?\b|openings?)|hiring (?:for|now|drive)|walk[\s-]?in interview|recruitment (?:of|for|drive|notification)|wants? to hire|seeks? to hire|is hiring|job opening|job alert|looking for (?:a |an )?(?:civil|site|structural|quantity|planning|estimation|bim))\b/i;

// News/project/research noise — never a vacancy even if hiring words appear
// elsewhere in the article text.
const NEWS_NOISE_REGEX = /\b(what (?:is|are)\b|history of|importance of|advantages? of|scope of|how to (?:become|prepare|apply for exam)|top \d+ (?:universities|colleges|courses|companies)|salary guide|career guide|tender (?:floated|awarded|opened)|contract (?:awarded|signed|won)|foundation stone|inaugurat\w*|laying of (?:foundation|stone)|commissioned|groundbreaking|breaks? ground|inaugurated|project (?:update|progress|status|completed|inaugurated)|construction (?:update|progress|begins|starts|started|completed|complete)|milestone|upcoming project|plan[s]? to (?:build|construct|develop)|set to (?:build|construct|open)|to be (?:built|constructed)|aquifer|groundwater|research\w*|study (?:finds|shows|suggests|reveals)|report (?:finds|says|shows)|survey (?:finds|says|shows)|conference|summit|seminar|workshop|award\w*|honou?red|moa|partnership (?:signed|announced)|launches new (?:product|service|app|feature)|results? (?:announced|declared)|admit card|answer key|syllabus|admission|exam date|exam result|climate|pollution|flood\w*|drought|monsoon|rainfall|earthquake|landslide|weather|aqueduct restoration)\b/i;

/**
 * STRICT gate for news results: a news article enters the job queue only when
 * it is genuinely advertising/recruiting a vacancy. Location is handled
 * separately by resolveIndiaEligibility().
 * @returns {{isVacancy:boolean, reason:string}}
 */
function newsVacancyCheck(title, description) {
  const titleText = cleanText(title);
  const text = normText(`${titleText} ${cleanText(description || '')}`);

  if (NEWS_NOISE_REGEX.test(titleText)) {
    return { isVacancy: false, reason: 'news/project/research wording in headline' };
  }

  const headlineVacancy = NEWS_VACANCY_TITLE_REGEX.test(titleText);
  const bodyVacancy = NEWS_VACANCY_TEXT_REGEX.test(text);

  if (!headlineVacancy && !bodyVacancy) {
    return { isVacancy: false, reason: 'no hiring/vacancy language (news, not a job ad)' };
  }

  return { isVacancy: true, reason: 'explicit vacancy wording' };
}

/* ── LOCATION RESOLUTION ────────────────────────────────────────────── */

/**
 * Extract and classify the structured location of a record.
 * countryStatus: 'india' | 'foreign' | 'unknown' — derived ONLY from the
 * record's own fields, never from the user's search query.
 */
function extractStructuredLocation(item) {
  const city = cleanText(item.city || item.town || '');
  const state = cleanText(item.state || item.region || '');
  const country = cleanText(item.country || item.country_name || item.countryCode || item.country_code || '');
  const rawLocation = cleanText(
    item.location || item.jobGeo || item.job_location || item.location_display || item.place || ''
  );
  const locationCombo = `${rawLocation} ${state} ${city}`.trim();

  let countryStatus = 'unknown';
  if (countryIsIndia(country) || /\bindia\b|pan[\s-]?india|all[\s-]?india/i.test(locationCombo)) {
    countryStatus = 'india';
  } else if (countryIsForeign(country)) {
    countryStatus = 'foreign';
  } else if (hasIndiaToken(locationCombo)) {
    countryStatus = 'india';
  } else if (hasForeignToken(locationCombo) || hasGulfToken(locationCombo)) {
    countryStatus = 'foreign';
  }

  return { city, state, country, rawLocation, countryStatus };
}

/**
 * Decide whether a record is an India vacancy, per its SOURCE class.
 * @returns {{eligible:boolean, reason:string}}
 */
function resolveIndiaEligibility(structured, title, description, sourceName) {
  const src = String(sourceName || '').toLowerCase();
  const locationCombo = `${structured.rawLocation} ${structured.state} ${structured.city} ${structured.country}`.trim();
  const all = `${locationCombo} ${title} ${description || ''}`;

  // Explicit foreign location in the record's location fields → reject
  // regardless of source (CASE H / CASE K). Mentions of foreign countries in
  // a description (company history, client work) do NOT reject.
  if (structured.countryStatus === 'foreign') {
    return { eligible: false, reason: 'explicit foreign location in source fields' };
  }

  const indiaEvidence =
    structured.countryStatus === 'india' ||
    hasIndiaToken(locationCombo) ||
    hasIndiaToken(`${title} ${description || ''}`);

  if (indiaEvidence) {
    return { eligible: true, reason: 'India evidence from record fields' };
  }

  // Gulf/abroad targeting with no India evidence → not an India vacancy.
  if (hasGulfToken(all)) {
    return { eligible: false, reason: 'Gulf/abroad-targeted listing without India location' };
  }

  // Trusted India-specific platform: a record with NO location information at
  // all is accepted at source level (the platform's corpus is India).
  if (isTrustedIndiaSource(src)) {
    return { eligible: true, reason: 'India-specific source, no explicit location given' };
  }

  // News and worldwide boards must prove India on the record itself (CASE L).
  return { eligible: false, reason: 'no India location evidence for a non-India-specific source' };
}

/* ── FRESHNESS (exact milliseconds) ─────────────────────────────────── */

/**
 * Parse a posting date and bucket it using exact milliseconds.
 * @returns {{bucket:'fresh24h'|'backup30d'|'too_old'|'future'|'unknown',
 *            ageMs:number|null, postedMs:number|null, postedIso:string}}
 */
function classifyFreshness(dateRaw, nowMs) {
  const raw = cleanText(dateRaw || (typeof dateRaw === 'number' ? String(dateRaw) : ''));
  if (!raw) {
    return { bucket: 'unknown', ageMs: null, postedMs: null, postedIso: '' };
  }

  let ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    // Date-only strings (e.g. "2026-09-11") are parsed as UTC midnight.
    const m = String(raw).match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
    if (m) {
      const mm = String(Number(m[2])).padStart(2, '0');
      const dd = String(Number(m[3])).padStart(2, '0');
      ms = Date.parse(`${m[1]}-${mm}-${dd}T00:00:00Z`);
    }
  }

  if (!Number.isFinite(ms)) {
    return { bucket: 'unknown', ageMs: null, postedMs: null, postedIso: '' };
  }

  const ageMs = nowMs - ms;

  if (ageMs < -FUTURE_TOL_MS) {
    return { bucket: 'future', ageMs, postedMs: ms, postedIso: new Date(ms).toISOString() };
  }
  if (ageMs <= FRESH_24H_MS) {
    return { bucket: 'fresh24h', ageMs, postedMs: ms, postedIso: new Date(ms).toISOString() };
  }
  if (ageMs <= BACKUP_30D_MS) {
    return { bucket: 'backup30d', ageMs, postedMs: ms, postedIso: new Date(ms).toISOString() };
  }
  return { bucket: 'too_old', ageMs, postedMs: ms, postedIso: new Date(ms).toISOString() };
}

/** Age display: minutes → hours → days → weeks → months. */
function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(ms / 3600000);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(ms / 86400000);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

/* ── DEDUPLICATION ──────────────────────────────────────────────────── */

/** Normalize a URL for dedup comparison. Never invents a URL. */
function normalizeJobUrl(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    // Strip tracking params — but never rewrite Hopin's documented API routes.
    if (!/api\.hopinjobs\.com$/i.test(u.hostname)) {
      for (const k of [...u.searchParams.keys()]) {
        if (/^(utm_\w+|fbclid|gclid|msclkid|ref|source|mc_cid|mc_eid|igshid)$/i.test(k)) {
          u.searchParams.delete(k);
        }
      }
    }
    u.hash = '';
    let out = u.toString();
    if (out.endsWith('/') && u.pathname !== '/') out = out.slice(0, -1);
    return out;
  } catch (_) {
    return s.replace(/[?#].*$/, '');
  }
}

/**
 * Dedup key = normalized URL + normalized title (spec). Returns '' when both
 * parts are empty — callers must not dedupe on an empty key.
 */
function dedupeKey(url, title) {
  const nu = normalizeJobUrl(url);
  const nt = normText(title);
  if (!nu && !nt) return '';
  if (!nu) return `title-only:${nt}`;
  return `${nu}|${nt}`;
}

/* ── RSS / ATOM PARSING ─────────────────────────────────────────────── */

/**
 * Parse an RSS or Atom document into plain records.
 * Handles CDATA, HTML entities and both `<item><link>url</link>` and
 * Atom's `<link href="…">` form. Items without a title or a link are dropped
 * — a record with no real URL is never kept.
 * @returns {Array<{title:string, link:string, description:string, pubDate:string, source:string}>}
 */
function parseRssItems(xml) {
  const items = [];
  const blocks = String(xml || '').match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];

  for (const block of blocks) {
    const get = tag => {
      const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? cleanText(m[1]) : '';
    };

    const title = get('title');
    if (!title) continue;

    let link = get('link');
    if (!link) {
      const m = block.match(/<link\b[^>]*href=["']([^"']+)["']/i);
      link = m ? cleanText(m[1]) : '';
    }
    if (!link) continue;

    items.push({
      title,
      link,
      description: get('description') || get('summary') || get('content'),
      pubDate: get('pubDate') || get('published') || get('updated') || get('dc:date'),
      source: get('source'),
    });
  }

  return items;
}

/* ── SOURCE STATS ───────────────────────────────────────────────────── */

/** Fresh counter object for one discovery source track. */
function newSourceStat(name, configured = true) {
  return {
    name,
    configured,
    ok: true,
    items: 0,             // raw items received
    accepted: 0,          // passed all gates
    rejectedCivil: 0,
    rejectedIndia: 0,
    rejectedAge: 0,       // future (beyond tolerance) or older than 30 days
    rejectedFuture: 0,
    rejectedDupe: 0,
    unknownDate: 0,       // tracked separately; excluded from both queues
    error: null,
    remaining: null,
    reset: null,
  };
}

/* ── SHARED TEXT EXTRACTORS (draft building) ────────────────────────── */

/** Extract a clean role from a listing title ("Civil Engineer at L&T" → "Civil Engineer"). */
function extractRole(title) {
  const t = cleanText(title);
  return t.replace(/\s+(?:-|–|—|at|@|\|)\s+[^|–—-]{2,100}$/i, '').trim() || t;
}

/** Extract a company name from title/description when no structured company exists. */
function extractCompany(title, description) {
  const t = cleanText(title);
  let m = t.match(/\s+(?:-|–|—|at|@|\|)\s+([^|–—-]{2,100})$/i);
  if (m) return m[1].trim();
  m = cleanText(description).match(/(?:company|employer)\s*[:\-]\s*([^.|]{2,100})/i);
  return m ? m[1].trim() : '';
}

/** Government vs Private sector from text (used for the dashboard type filter). */
function classifySector(text) {
  return /\b(government|govt|psu|public sector|recruitment|commission|authority|department|board|pwd|nhai|cpwd|railway|metro|corporation|municipal|smart city|jal|nigam|vikas)\b/i.test(
    cleanText(text)
  ) ? 'Government' : 'Private';
}

/* ── QUERY PLAN (news search helpers) ───────────────────────────────── */

const NEWS_SITE_TARGETS = [
  'linkedin.com/jobs', 'naukri.com', 'indeed.com', 'foundit.in', 'timesjobs.com',
  'shine.com', 'apna.co', 'workindia.in', 'freshersworld.com', 'gov.in', 'nic.in',
];

const ROLE_QUERY_KEYWORDS = [
  'civil engineer','site engineer','planning engineer','quantity surveyor',
  'structural engineer','construction engineer','project engineer',
  'estimation engineer','billing engineer','qa qc civil','bim engineer',
  'junior civil engineer','assistant engineer','civil engineering vacancy',
  'civil recruitment','pwd engineer','nhai engineer','civil supervisor',
  'graduate civil engineer','resident engineer','highway engineer',
  'road engineer','bridge engineer','geotechnical engineer',
  'water resources engineer','irrigation engineer','civil designer',
  'civil draftsman','infrastructure engineer','civil works',
];

/** Build the news query plan for a search (used by the news fetchers). */
function buildNewsQueryPlan(q, location) {
  const base = cleanText(q || 'civil engineering jobs');
  const loc = cleanText(location || 'India');
  const queries = [`${base} ${loc}`];
  for (const role of ROLE_QUERY_KEYWORDS.slice(0, 7)) queries.push(`${role} ${loc}`);
  const siteQueries = NEWS_SITE_TARGETS.slice(0, 7).map(site => `site:${site} ${base} ${loc}`);
  return [...queries, ...siteQueries].slice(0, 14);
}

module.exports = {
  // constants
  FRESH_24H_MS,
  BACKUP_30D_MS,
  FUTURE_TOL_MS,
  NEWS_SOURCES,
  TRUSTED_INDIA_SOURCES,
  // source classification
  isNewsSource,
  isTrustedIndiaSource,
  // text
  cleanText,
  normText,
  // civil
  classifyCivilRole,
  CIVIL_ROLE_REGEX,
  NON_CIVIL_REGEX,
  // rss
  parseRssItems,
  // news gate
  newsVacancyCheck,
  // location
  extractStructuredLocation,
  resolveIndiaEligibility,
  countryIsIndia,
  countryIsForeign,
  hasIndiaToken,
  hasForeignToken,
  hasGulfToken,
  // freshness
  classifyFreshness,
  formatAge,
  // dedup
  normalizeJobUrl,
  dedupeKey,
  // stats
  newSourceStat,
  // draft helpers
  extractRole,
  extractCompany,
  classifySector,
  // queries
  buildNewsQueryPlan,
  ROLE_QUERY_KEYWORDS,
};
