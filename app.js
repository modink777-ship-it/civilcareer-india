
/* ═══════════════════════════════════════════════
   ROLE-BASED CATEGORISATION SYSTEM
═══════════════════════════════════════════════ */
const INDIA_STATES=['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Jammu & Kashmir','Ladakh','Puducherry','Chandigarh','Andaman & Nicobar','Lakshadweep'];

const INDIA_CITIES=['Bengaluru','Mumbai','Delhi','Hyderabad','Chennai','Kolkata','Pune','Ahmedabad','Surat','Jaipur','Lucknow','Kanpur','Nagpur','Visakhapatnam','Indore','Thane','Bhopal','Vadodara','Ludhiana','Agra','Nashik','Faridabad','Meerut','Rajkot','Varanasi','Srinagar','Aurangabad','Dhanbad','Amritsar','Prayagraj','Ranchi','Coimbatore','Jodhpur','Madurai','Raipur','Kochi','Chandigarh','Guwahati','Bhubaneswar','Thiruvananthapuram','Gurugram','Noida','Ghaziabad','Navi Mumbai','Patna','Mysuru','Mangaluru','Hubballi','Belagavi','Vijayapura','Davanagere','Ballari','Shivamogga','Tumakuru','Raichur','Kalaburagi'];

const GULF_CITIES=['Dubai','Abu Dhabi','Sharjah','Doha','Riyadh','Jeddah','Muscat','Kuwait City','Manama','Bahrain'];

const INTL_CITIES=['Singapore','Kuala Lumpur','London','New York','Toronto','Sydney','Melbourne'];

const SALARY_HINTS={
  site:'₹3.5–8 LPA',qs:'₹4–10 LPA',planning:'₹5–12 LPA',
  design:'₹4–9 LPA',bim:'₹5–12 LPA',contracts:'₹6–15 LPA',
  qaqc:'₹3.5–8 LPA',hse:'₹3.5–8 LPA',survey:'₹3–7 LPA',
  infra:'₹4–10 LPA',water:'₹4–9 LPA',govt:'As per pay scale',
  other:'Competitive'
};

const ROLE_HEADS=[
  {id:'site',    label:'Site & Project Engineering',   icon:'🏗', keys:['site engineer','project engineer','project manager','site supervisor','construction engineer','resident engineer','erection engineer','construction manager','civil engineer','civil works']},
  {id:'qs',      label:'Quantity Surveying & Costing', icon:'📐', keys:['quantity surveyor','qs engineer','cost engineer','cost controller','estimation','estimator','billing engineer','commercial engineer','tender engineer','rate analysis','bill of quantities']},
  {id:'planning',label:'Planning & Project Controls',  icon:'📊', keys:['planning engineer','planning manager','project controls','scheduler','planning coordinator','project planner','primavera','ms project','p6 ','schedule engineer']},
  {id:'design',  label:'Design & Structural',          icon:'📏', keys:['design engineer','structural engineer','structural designer','design manager','analysis engineer','detailing engineer','rcc design','steel design','foundation design']},
  {id:'bim',     label:'BIM',                          icon:'💻', keys:['bim ','revit','tekla','navisworks','digital twin','building information','bim engineer','bim coordinator','bim manager']},
  {id:'contracts',label:'Contracts & Procurement',     icon:'📋', keys:['contracts manager','contract engineer','procurement','commercial manager','claims engineer','tendering','bid manager','subcontract']},
  {id:'qaqc',    label:'QA / QC',                      icon:'✅', keys:['quality engineer','qa engineer','qc engineer','quality assurance','quality control','inspection engineer','ndt engineer','quality manager']},
  {id:'hse',     label:'HSE / Safety',                 icon:'🦺', keys:['hse','safety officer','safety engineer','health safety','environment','ehs','fire safety','nebosh','iosh','safety manager']},
  {id:'survey',  label:'Surveying',                    icon:'🔭', keys:['surveyor','survey engineer','geomatics','gis engineer','total station','land survey','topographic survey','quantity survey']},
  {id:'infra',   label:'Infrastructure & Highways',    icon:'🛣', keys:['highway engineer','road engineer','bridge engineer','tunnel engineer','metro','railway','nhai','pavement','transport engineer','infrastructure']},
  {id:'water',   label:'Water & Environment',          icon:'💧', keys:['water supply','sewage','drainage','irrigation','hydraulic','sanitation','wtp','stp','pipeline engineer','water engineer']},
  {id:'govt',    label:'Government / PSU',             icon:'🏛', keys:['psu','municipal corporation','public sector undertaking']},
  {id:'other',   label:'Other / General',              icon:'💼', keys:[]}
];
function classifyJob(j){
  if(j.role_category)return j.role_category;
  const t=((j.role||'')+' '+(j.discipline||'')+' '+(j.description||'')).toLowerCase();
  for(const h of ROLE_HEADS.slice(0,-1))if(h.keys.some(k=>t.includes(k)))return h.id;
  return 'other';
}
const $=id=>document.getElementById(id),$$=s=>[...document.querySelectorAll(s)],esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let jobs=[],exams=[],materials=[],route='home',lang='en';

/* ═══════════════════════════════════════════════════════════
   SHARED NORMALIZATION HELPERS (FIX-2026-09-24)
   Every sector/location/matching comparison in the app goes
   through these functions so records with unexpected values
   ('private', 'PRIVATE', 'Private Sector', 'MNC', missing
   fields…) are handled safely instead of disappearing.
════════════════════════════════════════════════════════════ */
function sectorOf(j){
  if(!j)return'Private';
  const s=String(j.sector||j.category||'').toLowerCase();
  if(/gov|public sector|psu|sarkari/.test(s))return'Government';
  if(/private|mnc|company|corporate|private-sector|private sector/.test(s))return'Private';
  if(s==='')return'Private'; // no sector recorded → default to private listing
  return'Private';
}
function isGovJob(j){return sectorOf(j)==='Government'}
function normText(v){return String(v??'').toLowerCase().replace(/[^a-z0-9+.₹\-\s]/g,' ').replace(/\s+/g,' ').trim()}
function timeAgo(v){
  if(!v)return'';
  const t=new Date(v).getTime();
  if(!Number.isFinite(t))return'';
  const diff=Math.max(0,Date.now()-t),min=Math.floor(diff/60000),hr=Math.floor(diff/3600000),day=Math.floor(diff/86400000),month=Math.floor(day/30),year=Math.floor(day/365);
  if(min<1)return'just now';
  if(min<60)return min+'m ago';
  if(hr<24)return hr+'h ago';
  if(day<30)return day+'d ago';
  if(month<12)return month+'mo ago';
  return year+'y ago';
}
function salaryText(j){
  if(j.salary)return String(j.salary);
  if(j.salary_min&&j.salary_max)return `₹${Number(j.salary_min).toLocaleString('en-IN')} – ₹${Number(j.salary_max).toLocaleString('en-IN')}`;
  if(j.salary_min)return `₹${Number(j.salary_min).toLocaleString('en-IN')}+`;
  if(j.salary_max)return `Up to ₹${Number(j.salary_max).toLocaleString('en-IN')}`;
  return'';
}
/* Parse "2-5 years" / "Fresher" / "0–1 years" → {min,max} in years */
function expRange(j){
  const t=normText([j.experience_level,(j.experience_ranges||[]).join?.(' ')||''].join(' '));
  if(!t)return null;
  if(/fresher|entry|graduate trainee|no experience/.test(t))return{min:0,max:1};
  const nums=(t.match(/\d+(?:\.\d+)?/g)||[]).map(Number);
  if(!nums.length)return null;
  return{min:nums[0],max:nums.length>1?nums[1]:nums[0]+3};
}
function skillsOf(j){
  const raw=j.skills||j.skills_required||'';
  return (Array.isArray(raw)?raw:String(raw).split(/[,;|]/)).map(x=>String(x).trim()).filter(Boolean);
}
function projectTypeOf(j){
  const t=normText([j.project_type,j.discipline,j.description].join(' '));
  const map=[['Residential','residential|housing|apartment'],['Commercial','commercial|office space|retail'],['High-rise','high[- ]?rise|tower'],['Roads','road|highway|pavement'],['Metro','metro|subway'],['Railways','railway|rail'],['Bridges','bridge|flyover'],['Airports','airport|runway|terminal'],['Water','water|sewage|drainage|irrigation|wtp|stp'],['Industrial','industrial|factory|plant'],['Oil & Gas','oil|gas|refinery|pipeline'],['Renewable','solar|wind|renewable'],['Government Infrastructure','government|infra']];
  for(const[label,pat]of map){if(new RegExp(pat).test(t))return label}
  return'';
}
function workTypeOf(j){
  const t=normText([j.work_type,j.employment_type,j.description].join(' '));
  if(/hybrid/.test(t))return'Hybrid';
  if(/remote|work from home|wfh/.test(t))return'Remote';
  if(/site|on[- ]?site|field/.test(t))return'Site';
  if(/office|design office/.test(t))return'Office';
  return'';
}
function getSaved(){return new Set(JSON.parse(localStorage.getItem('cc_saved')||'[]'))}
function toggleSave(id){const s=getSaved();s.has(id)?s.delete(id):s.add(id);localStorage.setItem('cc_saved',JSON.stringify([...s]))}

/* ── VIEWED JOBS (FIX-2026-09-25) ───────────────────────────────
   A job becomes “viewed” only when the user explicitly opens it — never merely
   because it appears in a list, and never because it was the default selection
   in the detail panel. Guests use localStorage; signed-in users reuse the same
   store, so no login is required to track views. Only {jobId: viewedAt} is kept
   — the job object itself is never persisted here. */
function viewedMap(){try{return JSON.parse(localStorage.getItem('cc_viewed')||'{}')}catch{return{}}}
function markViewed(jobId){
  if(!jobId)return;
  try{
    const m=viewedMap();
    if(!m[jobId]){
      m[jobId]=new Date().toISOString();
      const keys=Object.keys(m);
      if(keys.length>400)keys.sort((a,b)=>String(m[a]).localeCompare(String(m[b]))).slice(0,keys.length-400).forEach(k=>delete m[k]);
      localStorage.setItem('cc_viewed',JSON.stringify(m));
    }
  }catch{}
}
function isViewed(jobId){return !!viewedMap()[jobId]}
function viewedLabel(jobId){
  const at=viewedMap()[jobId];if(!at)return'';
  const d=new Date(at);if(isNaN(d.getTime()))return'✓ Viewed';
  const days=Math.floor((Date.now()-d.getTime())/86400000);
  if(days<=0)return'✓ Viewed · Today';
  if(days===1)return'✓ Viewed · Yesterday';
  if(days<30)return`✓ Viewed · ${days} days ago`;
  return'✓ Viewed';
}
window.markViewed=markViewed;window.isViewed=isViewed;window.viewedLabel=viewedLabel;
const pathRoute={'/':'home','/for-you':'foryou','/private-jobs':'private','/government-jobs':'government','/exams':'exams','/study-materials':'materials','/career-paths':'careerpaths','/post-a-job':'post','/submit-resource':'resource','/report':'report','/about':'about','/contact':'contact','/search':'search',};const routePath=Object.fromEntries(Object.entries(pathRoute).map(([a,b])=>[b,a]));
/* English-only (FIX-2026-09-25): the Kannada dictionary, language toggle and
   kn-IN locale switching have been removed. Kept as a no-op so existing
   callers (navigate/renderHome/boot) need no changes. */
function translate(){document.documentElement.lang='en';try{localStorage.removeItem('cc_lang')}catch{}}
function toast(msg){const x=$('toast');x.textContent=msg;x.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>x.classList.remove('show'),2800)}function device(){const w=innerWidth;return w<600?'Mobile':w<1000?'Tablet':'Desktop'}function visitor(){let id=localStorage.getItem('cc_vid');if(!id){id=crypto.randomUUID();localStorage.setItem('cc_vid',id)}return id}async function api(url,opt={}){const started=performance.now();const r=await fetch(url,{...opt,headers:{'content-type':'application/json',...(opt.headers||{})}}),text=await r.text();const duration=performance.now()-started;window.__ccPerfSamples=window.__ccPerfSamples||[];window.__ccPerfSamples.push({url:String(url).split('?')[0],method:opt.method||'GET',status:r.status,duration_ms:Number(duration.toFixed(1)),server_timing:r.headers.get('server-timing')||''});if(window.__ccPerfSamples.length>100)window.__ccPerfSamples.shift();let data={};try{data=text?JSON.parse(text):{}}catch{}if(!r.ok){const e=Error(data.error||data.details||`Request failed (${r.status})`);e.status=r.status;throw e}return data}function track(type='pageview',label=''){api('/api/analytics',{method:'POST',body:JSON.stringify({visitor_id:visitor(),event_type:type,event_label:label,path:location.pathname,referrer:document.referrer,device_type:device()})}).catch(()=>{})}
function navigate(next,push=true){route=next in routePath?next:'home';$$('.page').forEach(p=>p.classList.toggle('active',p.dataset.page===route));$$('[data-route]').forEach(a=>a.classList.toggle('active',a.dataset.route===route));$('mainNav').classList.remove('open');$('menuBtn').setAttribute('aria-expanded','false');if(push&&location.pathname!==routePath[route])history.pushState({},'',routePath[route]);setMeta();scrollTo({top:0,behavior:'smooth'});if(route==='private')renderPrivate();if(route==='government')renderGovernment();if(route==='exams')renderExams();if(route==='materials')renderMaterials();if(route==='foryou')renderForYou();if(route==='careerpaths')renderCareerMapPage?.();translate();track()}
/* Career Paths page (FIX-2026-09-24): the /career-paths section markup lives in
   index.html; navigate() calls this hook so the route activates like any page. */
function renderCareerMapPage(){}
const metas={home:["CivilCareer — Your Civil Engineering Career, in one place","Find the right job. Track government recruitment. Build the skills employers want. India's dedicated civil engineering career platform."],careerpaths:['Civil Engineering Career Paths | CivilCareer','The complete civil engineering career map — Construction, Design, Commercial, Infrastructure and Government paths with live opportunities.'],private:['Civil Engineering Jobs | CivilCareer','Private civil engineering jobs across India, including local employers, Indian companies and Indian MNCs.'],government:['Government Civil Jobs | CivilCareer','Civil-focused Central and State government recruitment across India.'],exams:['Civil Engineering Exams | CivilCareer','Civil-focused government and competitive examinations across India, with official sources and important dates.'],materials:['Free Civil Engineering Study Materials | CivilCareer','Free civil engineering exam, interview, career, course, PDF and professional learning resources.'],post:['Post a Civil Engineering Job | CivilCareer','Submit a legitimate civil engineering job for moderation.'],resource:['Submit a Study Resource | CivilCareer','Submit a study resource you own or have permission to distribute.'],report:['Report a Problem | CivilCareer','Privately report suspicious, incorrect, expired or copyrighted content.'],contact:['Contact CivilCareer','Contact CivilCareer for corrections, accessibility issues, partnerships and feedback.'],about:['About CivilCareer','Learn about CivilCareer’s safety, accuracy and official-source principles.'],search:['Search CivilCareer','Search civil engineering jobs, government civil recruitment, exams and resources.']};function setMeta(){const m=metas[route]||metas.home;document.title=m[0];document.querySelector('meta[name="description"]').content=m[1]}
function date(v){if(!v)return'Check official notification';const d=new Date(v+'T00:00:00');return isNaN(d)?v:d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}function isClosed(j){return j.status==='Expired'||(j.deadline&&new Date(j.deadline+'T23:59:59')<new Date())}function short(v,n=150){v=String(v||'');return v.length>n?v.slice(0,n).trim()+'…':v}
function companyInitials(name){
  const words=String(name||'Company').trim().split(/\s+/).filter(Boolean);
  return (words.length===1?words[0].slice(0,2):words.slice(0,2).map(x=>x[0]).join('')).toUpperCase().slice(0,2);
}
function companyLogoUrl(j){
  if(j.logo_url)return j.logo_url;
  const raw=j.company_website||j.company_url||j.company_domain||'';
  if(!raw)return '';
  try{
    const u=new URL(/^https?:\/\//i.test(raw)?raw:`https://${raw}`);
    const host=u.hostname.toLowerCase().replace(/^www\./,'');
    const blocked=['linkedin.com','indeed.com','naukri.com','glassdoor.com','facebook.com','instagram.com','x.com','twitter.com','youtube.com'];
    if(!host||blocked.some(x=>host===x||host.endsWith('.'+x)))return '';
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
  }catch{return ''}
}
function companyLogoMarkup(j){
  const name=j.company||j.recruitment_authority||'Organization';
  const initials=companyInitials(name),src=companyLogoUrl(j);
  return `<div class="company-logo-wrap" aria-label="${esc(name)} logo">${src?`<img class="company-logo-img" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false">`:''}<span class="company-logo-fallback" ${src?'hidden':''}>${esc(initials)}</span></div>`;
}
function jobCard(j,gov=false){
  gov=gov||isGovJob(j);
  const closed=isClosed(j),verified=j.last_verified&&!closed,employerVerified=j.employer_verification_status==='Verified',saved=getSaved().has(j.id);
  const isNew=j.created_at&&(new Date()-new Date(j.created_at))<3*86400000;
  const initials=companyInitials(j.company||j.recruitment_authority||'CC');
  const proj=projectTypeOf(j),work=workTypeOf(j),sal=salaryText(j);
  return `<article class="job-card cc-compact-card ${closed?'card-closed':''}" data-explorer-job="${j.id}" data-job-id="${j.id}">
    <div class="cc-compact-top">
      <span class="cc-card-logo">${esc(initials)}</span>
      <div class="cc-compact-id">
        <h3 class="cc-compact-title">${esc(j.role||'Opportunity')}</h3>
        <div class="cc-compact-company">${esc(j.company||j.recruitment_authority||'Organization')}</div>
      </div>
    </div>
    <div class="cc-compact-meta">
      <span title="Location">📍 ${esc(j.location||j.location_display||'India')}</span>
      ${sal?`<span title="Salary">₹ ${esc(sal)}</span>`:''}
      ${j.experience_level?`<span title="Experience">⏱ ${esc(j.experience_level)}</span>`:''}
      ${proj?`<span title="Project type">🏗 ${esc(proj)}</span>`:''}
      ${work?`<span title="Work type">🧰 ${esc(work)}</span>`:''}
    </div>
    <div class="cc-compact-actions">
      <button data-job="${j.id}" class="cc-view-btn">View</button>
      ${!closed&&j.application_url||!closed&&j.apply_url||!closed&&j.source_url?`<a class="cc-apply-btn" href="${esc(j.application_url||j.apply_url||j.source_url)}" target="_blank" rel="noopener" data-apply-job="${esc(j.id)}">Apply</a>`:''}
      <button class="btn-save cc-save ${saved?'saved':''}" data-save-job="${j.id}" title="${saved?'Remove bookmark':'Save job'}" aria-label="${saved?'Remove bookmark':'Save job'}">${saved?'★':'☆'}</button>
    </div>
    <div class="cc-compact-status">
      <span class="pill ${closed?'closed':j.featured?'featured':verified?'verified':''}">${closed?'Closed':j.featured?'Featured':verified?'Verified':'Active'}${employerVerified?'<span class="pill employer-verified">Employer verified</span>':''}</span>
      <span class="cc-posted-ago">${j.created_at?esc(timeAgo(j.created_at)):(j.last_verified?'Verified '+esc(date(j.last_verified)):'')}</span>
      ${isNew?'<span class="new-badge">NEW</span>':''}
    </div>
  </article>`
}
function examCard(x){const closed=x.application_end&&new Date(x.application_end+'T23:59:59')<new Date(),title=x.title_en,copy=x.overview||x.eligibility_en;const daysLeft=x.application_end&&!closed?Math.ceil((new Date(x.application_end+'T23:59:59')-new Date())/86400000):null;return `<article class="exam-card"><div class="card-top"><span class="pill ${closed?'closed':x.last_verified?'verified':''}">${closed?'Application Closed':x.status||'Update'}</span>${x.application_end?`<span class="verified-date">Deadline ${date(x.application_end)}</span>`:''}${daysLeft!==null?`<span class="countdown-badge ${daysLeft<=3?'urgent':''}">${daysLeft<=0?'Last day!':daysLeft+'d left'}</span>`:''}</div><h3>${esc(title)}</h3><div class="organization">${esc(x.authority||'Conducting authority')}${x.vacancy_count?` · ${esc(x.vacancy_count)} vacancies`:''}</div><p class="card-copy">${esc(short(copy||'Check the official notification for complete recruitment details.'))}</p><div class="card-actions"><button data-exam="${x.id}">View Complete Details</button>${x.official_notification_url?`<a href="${esc(x.official_notification_url)}" target="_blank" rel="noopener">Official PDF ↗</a>`:''}</div></article>`}
function materialCard(m){const title=m.title_en;return `<article class="material-card"><div class="card-top"><span class="pill verified">${esc(m.access_type||'Free')}</span><span class="verified-date">${m.page_count?m.page_count+' pages':'Resource'}</span></div><h3>${esc(title)}</h3><div class="organization">${esc(m.category||m.exam_code||'Study resource')}</div><p class="card-copy">${esc(short(m.description_en||'Organized learning resource.'))}</p><div class="card-actions"><button data-material-id="${m.id}">Preview</button><a href="${esc(m.file_url)}" target="_blank" rel="noopener">Open Resource ↗</a></div></article>`}
function bindCards(){
  $$('[data-job]').forEach(b=>b.onclick=()=>openJob(jobs.find(x=>x.id===b.dataset.job)||window.__ccSearchJobs?.find(x=>x.id===b.dataset.job)||window.__ccAllJobs?.find(x=>x.id===b.dataset.job)));
  $$('[data-exam]').forEach(b=>b.onclick=()=>openExam(exams.find(x=>x.id===b.dataset.exam)));
  $$('[data-material-id]').forEach(b=>b.onclick=()=>openMaterial(materials.find(x=>x.id===b.dataset.materialId)));
  $$('[data-save-job]').forEach(b=>b.onclick=()=>{
    toggleSave(b.dataset.saveJob);
    const saved=getSaved().has(b.dataset.saveJob);
    b.classList.toggle('saved',saved);
    b.textContent=saved?'★':'☆';
    toast(saved?'Job saved! ★':'Bookmark removed.');
  });
}function empty(title,text){return `<div class="empty-state"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`}
function renderHome(){const live=typeof active==='function'?active:(j=>j.status!=='Expired'&&(!j.expires_at||new Date(j.expires_at)>new Date())&&(!j.deadline||new Date(j.deadline+'T23:59:59')>new Date()));const p=jobs.filter(j=>sectorOf(j)==='Private'&&live(j)).slice(0,3),g=jobs.filter(j=>isGovJob(j)&&live(j)).slice(0,3);$('homePrivate').innerHTML=p.length?p.map(x=>jobCard(x)).join(''):empty('Opportunities are being added','Verified civil engineering jobs will appear here as they are published.');$('homeGovernment').innerHTML=g.length?g.map(x=>jobCard(x,true)).join(''):empty('Recruitment updates are being added','Civil-focused Central and State opportunities will appear here after verification.');const close=jobs.filter(j=>j.deadline&&!isClosed(j)).sort((a,b)=>a.deadline.localeCompare(b.deadline)).slice(0,4);var _cs=document.getElementById('closingSoon');if(_cs)_cs.innerHTML=close.length?close.map(j=>`<div class="compact-item"><div><b>${esc(j.role)}</b><span>${esc(j.company||j.location||'Opportunity')}</span></div><span>${date(j.deadline)}</span></div>`).join(''):'<div class="compact-item"><span>No active deadlines published.</span></div>';var _he=document.getElementById('homeExams');if(_he)_he.innerHTML=exams.slice(0,4).map(x=>`<div class="compact-item"><div><b>${esc(x.code)} — ${esc(x.title_en)}</b><span>${esc(x.authority||'Examination update')}</span></div><span>${x.application_end?date(x.application_end):'Official dates'}</span></div>`).join('')||'<div class="compact-item"><span>Exam updates are being added.</span></div>';$('homeMaterials').innerHTML=materials.slice(0,3).map(materialCard).join('')||empty('Resources are being added','Free civil engineering, exam and working-professional resources will appear here as they are published.');bindCards();translate();renderUrgencyStrip();}

function renderUrgencyStrip(){
  const strip=$('urgencyStrip'),el=$('urgencyJobs');
  if(!strip||!el)return;
  const today=new Date();today.setHours(23,59,59,0);
  const urgent=jobs.filter(j=>j.deadline&&!isClosed(j)&&new Date(j.deadline+'T23:59:59')<=today);
  if(urgent.length===0){strip.style.display='none';return;}
  strip.style.display='block';
  el.innerHTML=urgent.map(j=>`<button class="urgency-job" data-job="${j.id}"><b>${esc(j.role||'Opportunity')}</b><span>${esc(j.company||j.location||'')}</span><span class="urg-tag">Closes today</span></button>`).join('');
  bindCards();
}
/* CANONICAL PRIVATE JOBS (FIX-2026-09-25): the Civil Job Explorer assigned in
   v8.js is the single private-jobs renderer. The former category-tile renderer
   (role tiles → per-category list) has been removed. This stub only covers the
   first paint before v8.js boots, and any case where v8.js fails to load, so the
   Jobs page can never throw. */
function renderPrivate(){}

function renderGovernment(){
  let a=jobs.filter(j=>isGovJob(j));
  if($('govState')&&!$('govState').options.length){
  $('govState').innerHTML='<option value="">All states</option>'+INDIA_STATES.map(s=>`<option>${s}</option>`).join('');
}
const dep=($('govDepartment')&&$('govDepartment').value||'').toLowerCase();
  const loc=($('govLocation')&&$('govLocation').value||'').toLowerCase();
  const qual=($('govQualification')&&$('govQualification').value||'').toLowerCase();
  const dist=($('govDistrict')&&$('govDistrict').value||'').toLowerCase();
  const edu=($('govEdu')&&$('govEdu').value||'').toLowerCase();
  const org=($('govOrgChips')&&$('govOrgChips').querySelector('.active:not([data-org=""])')||{dataset:{org:''}}).dataset.org||'';

  a=a.filter(j=>!dep||[j.company,j.discipline,j.description].join(' ').toLowerCase().includes(dep))
     .filter(j=>!loc||String(j.location).toLowerCase().includes(loc))
     .filter(j=>!dist||String(j.location).toLowerCase().includes(dist))
     .filter(j=>!qual||String(j.qualification).toLowerCase().includes(qual))
     .filter(j=>!edu||String(j.qualification).toLowerCase().includes(edu))
     .filter(j=>!org||[j.company,j.recruitment_authority,j.description].join(' ').toLowerCase().includes(org));

  if($('govStatus')&&$('govStatus').value)a=a.filter(j=>$('govStatus').value==='closed'?isClosed(j):!isClosed(j));
  a.sort($('govSort')&&$('govSort').value==='deadline'?(x,y)=>(x.deadline||'9999').localeCompare(y.deadline||'9999'):(x,y)=>String(y.created_at).localeCompare(String(x.created_at)));

  $('governmentCount').textContent=`${a.length} government civil opportunit${a.length===1?'y':'ies'}`;

  // Group by recruitment authority
  const groups={};
  a.forEach(j=>{const auth=j.recruitment_authority||j.company||'Other';if(!groups[auth])groups[auth]=[];groups[auth].push(j)});

  if(Object.keys(groups).length===0){
    $('governmentJobs').innerHTML=empty('No matching government recruitment','Verified Central and State government opportunities will appear here as they are published.');
  } else if(Object.keys(groups).length===1||dist||dep||edu||org||loc||qual){
    $('governmentJobs').innerHTML=a.map(x=>jobCard(x,true)).join('');
  } else {
    $('governmentJobs').innerHTML=Object.entries(groups).map(([auth,list])=>`
      <div class="auth-group">
        <div class="auth-group-header">
          <span class="auth-badge">${esc(auth)}</span>
          <span>${list.length} notification${list.length>1?'s':''}</span>
        </div>
        ${list.map(x=>jobCard(x,true)).join('')}
      </div>`).join('');
  }
  bindCards();
}

function renderExams(code=''){const a=exams.filter(x=>!code||x.code.toUpperCase().includes(code));$('examCards').innerHTML=a.length?a.map(examCard).join(''):empty('Exam updates are being added','Civil-focused government examination details will appear here after source verification.');bindCards()}
function renderMaterials(cat=''){const a=materials.filter(m=>!cat||String(m.category).includes(cat)||String(m.exam_code).includes(cat));$('materialCards').innerHTML=a.length?a.map(materialCard).join(''):empty('Resources are being added','Free civil engineering, exam and working-professional resources will appear here as they are published.');bindCards()}
function openJob(j){if(!j)return;const gov=isGovJob(j),closed=isClosed(j);$('detailTitle').textContent=j.role;$('detailBody').innerHTML=`<div class="detail-grid"><div class="detail"><b>${gov?'Organization':'Company'}</b>${esc(j.company||'Check original source')}</div><div class="detail"><b>Location</b>${esc(j.location||'Check original source')}</div><div class="detail"><b>Qualification</b>${esc(j.qualification||'Check official notification for the latest details.')}</div><div class="detail"><b>Experience</b>${esc(j.experience_level||'Not specified')}</div><div class="detail"><b>Employment type</b>${esc(j.employment_type||'Not specified')}</div><div class="detail"><b>${gov?'Pay scale':'Salary'}</b>${esc(j.salary||'Not provided')}</div>${gov?`<div class="detail"><b>Vacancies</b>${esc(j.vacancy_count||'Check official notification')}</div><div class="detail"><b>Age limit</b>${esc(j.age_limit||'Check official notification')}</div><div class="detail"><b>Application fee</b>${esc(j.application_fee||'Check official notification')}</div><div class="detail"><b>Application starts</b>${date(j.application_start)}</div>`:''}<div class="detail"><b>Application deadline</b>${j.deadline?date(j.deadline):'Check original source'}</div><div class="detail"><b>Status</b>${closed?'Application Closed':j.status||'Active'}</div><div class="detail full"><b>Description</b>${esc(j.description||'Check the original source for complete details.')}</div><div class="detail full"><b>Application method</b>${esc(j.application_method||'Use the original source')}</div></div><div class="card-actions">${j.source_url?`<a href="${esc(j.source_url)}" target="_blank" rel="noopener">${gov?'View Official Notification':'View Original Job'} ↗</a>`:''}${j.last_verified?`<span class="verified-date">Last verified: ${date(j.last_verified)}</span>`:''}</div>`;navigate('examDetail');}
function richText(v){return esc(v||'').replace(/\n/g,'<br>')}function examSection(title,value){return value?`<section class="exam-detail-section"><h3>${esc(title)}</h3><div class="exam-detail-copy">${richText(value)}</div></section>`:''}
function openExam(x){if(!x)return;const title=x.title_en,closed=x.application_end&&new Date(x.application_end+'T23:59:59')<new Date();$('detailTitle').textContent=title;$('detailBody').innerHTML=`<article class="exam-detail-page"><div class="exam-detail-status"><span class="pill ${closed?'closed':'verified'}">${closed?'Application Closed':esc(x.status||'Open')}</span>${x.last_verified?`<span>Last verified ${date(x.last_verified)}</span>`:''}</div>${x.overview?`<p class="exam-intro">${richText(x.overview)}</p>`:''}<section class="exam-detail-section"><h3>Recruitment Overview</h3><div class="exam-overview"><div><b>Organization</b>${esc(x.authority||'Check official notification')}</div><div><b>Notification number</b>${esc(x.notification_number||'Not stated')}</div><div><b>Post names</b>${esc(x.post_names||x.code||'See official notification')}</div><div><b>Total vacancies</b>${esc(x.vacancy_count||'Not stated')}</div><div><b>Qualification</b>${esc(x.eligibility_en||'See official notification')}</div><div><b>Job location</b>${esc(x.job_location||'Karnataka')}</div><div><b>Application mode</b>${esc(x.application_mode||'See official notification')}</div><div><b>Last date to apply</b>${date(x.application_end)}</div></div></section>${examSection('Important Dates',x.important_dates_details||[['Application start',date(x.application_start)],['Application deadline',date(x.application_end)],['Exam date',date(x.exam_date)]].map(a=>a.join(': ')).join('\n'))}${examSection('Post-wise Vacancy Details',x.vacancy_breakdown)}${examSection('Eligibility and Qualification',x.eligibility_en)}${examSection('Age Limit and Relaxation',x.age_limit)}${examSection('Pay Scale',x.pay_scale)}${examSection('Application Fees',x.application_fee)}${examSection('Selection Procedure',x.selection_process)}${examSection('Exam Pattern',x.exam_pattern)}${examSection('Syllabus',x.syllabus)}${examSection('How to Apply',x.how_to_apply)}${examSection('Attempts',x.attempts)}${examSection('Physical Standards',x.physical_standards)}${examSection('Helpline',x.helpline)}${examSection('Other Important Information',x.other_information)}${examSection('Frequently Asked Questions',x.frequently_asked_questions)}<section class="exam-detail-section official-links"><h3>Important Official Links</h3><div class="card-actions">${x.apply_url?`<a href="${esc(x.apply_url)}" target="_blank" rel="noopener">Apply on Official Portal ↗</a>`:''}${x.official_notification_url?`<a href="${esc(x.official_notification_url)}" target="_blank" rel="noopener">Download Official Notification ↗</a>`:''}${x.official_website_url?`<a href="${esc(x.official_website_url)}" target="_blank" rel="noopener">Official Website ↗</a>`:''}</div></section><div class="callout"><b>We Organize. You Verify.</b><br>CivilCareer is independent and is not a government authority. Read the official notification before applying or paying an official application fee.</div></article>`;navigate('examDetail');}
function openMaterial(m){if(typeof openMaterialDedicated==='function')return openMaterialDedicated(m);$('detailTitle').textContent=m.title_en;$('detailBody').innerHTML=`<p>${esc(m.description_en||'Open the resource to review its contents.')}</p><div class="callout">Only use materials shared by their owner or with appropriate permission.</div><div class="card-actions"><a href="${esc(m.file_url||m.pdf_url||m.preview_url||'#')}" target="_blank" rel="noopener">Open Resource ↗</a></div>`;navigate('examDetail');}
function animateCount(el,target,duration=1500){
  if(!el)return;
  let start=0;const step=target/(duration/16);
  const timer=setInterval(()=>{
    start+=step;
    if(start>=target){el.textContent=target+'+';clearInterval(timer);}
    else el.textContent=Math.floor(start)+'+';
  },16);
}
/* Live statistics: Loading… → real count → “Unable to load”. A genuinely empty
   database still shows a real 0; only a failed request shows a failure state. */
function statUnavailable(id){
  const el=$(id);if(!el)return false;
  const f=window.__ccLoadFailed||{};
  const map={statJobs:f.jobs,statGovt:f.jobs,statExams:f.exams,statRes:f.materials};
  if(map[id]){el.textContent='Unable to load';el.classList.add('stat-error');el.setAttribute('title','Could not reach the statistics API. Refresh to retry.');return true}
  el.classList.remove('stat-error');el.removeAttribute('title');return false;
}
function updateStats(){
  const setStat=(id,val)=>{if(!statUnavailable(id)){const el=$(id);if(el)el.textContent=String(val)}};
  const [priv,govt]=liveCounts();
  const openExams=exams.filter(x=>!(x.application_end&&new Date(x.application_end+'T23:59:59')<new Date())).length;
  setStat('statJobs',priv);setStat('statGovt',govt);
  setStat('statExams',openExams);setStat('statRes',materials.length);
  updateNavCounts();
}
/* Called immediately on boot so stats never sit on a stale value while loading.
   If the request never resolves, the count degrades to an explicit failure state
   rather than a misleading 0. */
function statsLoading(){
  ['statJobs','statGovt','statExams','statRes'].forEach(id=>{const el=$(id);if(el){el.textContent='Loading…';el.classList.remove('stat-error')}});
  clearTimeout(window.__ccStatsTimer);
  window.__ccStatsTimer=setTimeout(()=>{
    ['statJobs','statGovt','statExams','statRes'].forEach(id=>{const el=$(id);if(el&&/^Loading/.test(el.textContent)){el.textContent='Unable to load';el.classList.add('stat-error')}});
  },15000);
}
/* Live-stat counts: prefer the server's real summary counts; fall back to the
   loaded page when the summary is unavailable (never an invented number). */
function liveCounts(){
  const summary=window.__ccJobSummary||{};
  const priv=Number.isFinite(Number(summary.private))?Number(summary.private):jobs.filter(j=>sectorOf(j)==='Private'&&active(j)).length;
  const govt=Number.isFinite(Number(summary.government))?Number(summary.government):jobs.filter(j=>isGovJob(j)&&active(j)).length;
  return [priv,govt];
}
function updateNavCounts(){
  const isLive=typeof active==='function'?active:(j=>j.status!=='Expired'&&(!j.expires_at||new Date(j.expires_at)>new Date())&&(!j.deadline||new Date(j.deadline+'T23:59:59')>new Date()));
  const [priv,govt]=liveCounts();
  $$('a[data-route="private"]').forEach(a=>{if(priv>0)a.setAttribute('data-count',priv)});
  $$('a[data-route="government"]').forEach(a=>{if(govt>0)a.setAttribute('data-count',govt)});
  if(!statUnavailable('statJobs')&&$('statJobs'))$('statJobs').textContent=String(priv);
  if(!statUnavailable('statGovt')&&$('statGovt'))$('statGovt').textContent=String(govt);
  if(!statUnavailable('statExams')&&$('statExams'))$('statExams').textContent=String(exams.filter(x=>!(x.application_end&&new Date(x.application_end+'T23:59:59')<new Date())).length);
  if(!statUnavailable('statRes')&&$('statRes'))$('statRes').textContent=String(materials.length);
}

/* ═══════════════════════════════════════════════════════════
   AI JOB AGENT — STAGE 1
   User Profile + Job Matching + For You Feed
═══════════════════════════════════════════════════════════ */

// ── Anonymous session ID ─────────────────────────────────────────────
function getSessionId(){
  let id=localStorage.getItem('cc_session');
  if(!id){id='cc_'+Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem('cc_session',id);}
  return id;
}

// ── User profile in memory ───────────────────────────────────────────
let userProfile=JSON.parse(localStorage.getItem('cc_profile')||'{}');
let userPrefs=JSON.parse(localStorage.getItem('cc_prefs')||'{}');
let jobInteractions=JSON.parse(localStorage.getItem('cc_interactions')||'{}');

/* ── Civil engineering profile vocabulary (FIX-2026-09-24) ── */
const CC_FORYOU_ROLES=['Civil Site Engineer','Site Engineer','Quantity Surveyor','Estimator','Planning Engineer','Planning Manager','Cost Engineer','Cost Consultant','Cost Controller','Project Controller','Project Control Analyst','Structural Engineer','Billing Engineer','QA/QC Engineer','Project Engineer','BIM Engineer','Highway Engineer','Transportation Engineer','Geotechnical Engineer','Contracts Engineer','Safety Engineer'];
const CC_FORYOU_PROJECTS=['Residential','Commercial','High-rise','Roads','Metro','Railways','Bridges','Airports','Water','Industrial','Oil & Gas','Renewable','Government Infrastructure'];
const CC_FORYOU_SKILLS=['AutoCAD','STAAD.Pro','ETABS','Revit','Civil 3D','Primavera P6','Primavera','MS Project','Power BI','Excel','Quantity Takeoff','BOQ','Billing','Rate Analysis','Estimation','Cost Control','Project Controls','Surveying','QA/QC'];
/* Any For-You role keyword pulls a job into the feed even when the generic
   facet score stays below threshold (planning / QS / cost-control roles). */
const FOR_YOU_ROLES_RE=/(quantity survey|\bqs\b|estimator|estimation|site engineer|planning|cost (engineer|consultant|controller)|project control|billing)/;
const CC_FORYOU_STAGES=['Fresher','0–2 years','2–5 years','5–10 years','10+ years'];
const CC_FORYOU_WORK=['Site','Office','Hybrid','Travel-heavy'];
const CC_FORYOU_ENV=['Construction Site','Design Office','Consultant','Contractor','PMC','EPC','Developer','Government Department'];

function civilProfile(){try{return JSON.parse(localStorage.getItem('cc_civil_profile')||'{}')}catch{return{}}}
function saveCivilProfile(p){try{localStorage.setItem('cc_civil_profile',JSON.stringify({...civilProfile(),...p,updated_at:new Date().toISOString()}))}catch{}}
/* Explainable match: role/location/experience/qualification/skills each ✓ △ or – */
function civilMatch(job){
  const p=civilProfile();
  const jText=normText([job.role,job.role_normalized,job.description,job.skills,job.qualification].join(' '));
  const lText=normText([job.location,job.location_display,(job.locations||[]).join(' '),job.city,job.state].join(' '));
  const facets=[];
  const role=String(p.role||userProfile.job_title||userPrefs.target_roles||'').trim();
  const roleHit=role?(normText(job.role).includes(normText(role))||jText.includes(normText(role))):null;
  facets.push({k:'Role',s:roleHit===null?'–':roleHit?'✓':'△',why:roleHit===null?'Add a target role to your profile':roleHit?'Matches your target role':`Different from your target (${role})`});
  const loc=String(p.location||userPrefs.preferred_locations||'').split(',')[0].trim();
  const locHit=loc?lText.includes(normText(loc)):null;
  facets.push({k:'Location',s:locHit===null?'–':locHit?'✓':'△',why:locHit===null?'Add a preferred location':locHit?`In or near ${loc}`:'Outside your preferred location'});
  const stage=String(p.stage||'').trim();
  const jr=expRange(job);
  let expHit=null,expWhy='Add your career stage to your profile';
  if(stage){
    const wantYears=/fresher/i.test(stage)?0:(parseFloat(stage)||null);
    if(wantYears!=null&&jr){
      if(wantYears>=jr.min-1&&wantYears<=jr.max+1){expHit=true;expWhy=`Experience ${jr.min}–${jr.max} yrs fits your ${stage}`}
      else{expHit=false;expWhy=`Job asks ${jr.min}–${jr.max} yrs; you targeted ${stage}`}
    }else if(wantYears!=null){expHit='△';expWhy='Experience not stated in this listing'}
  }
  facets.push({k:'Experience',s:expHit===null?'–':expHit===true?'✓':'△',why:expWhy});
  const qual=String(p.education||userProfile.education||'').trim();
  const qKey=qual?normText(qual).split(' ')[0]:'';
  const qHit=qKey?(normText(job.qualification||'').includes(qKey)||jText.includes(qKey)):null;
  facets.push({k:'Qualification',s:qHit===null?'–':qHit?'✓':'△',why:qHit===null?'Add your education':qHit?'Your qualification appears in the listing':'Verify qualification details at the source'});
  const mySkills=[...(Array.isArray(p.skills)?p.skills:[]),...String(userPrefs.skills_wanted||userProfile.skills||'').split(',')].map(x=>String(x).trim()).filter(Boolean);
  const skillHits=[],skillMiss=[];
  mySkills.forEach(s=>{(jText.includes(normText(s))?skillHits:skillMiss).push(s)});
  if(mySkills.length)facets.push({k:'Skills',s:skillHits.length?'✓':'△',why:skillHits.length?`Matching skills: ${skillHits.slice(0,3).join(', ')}`:'None of your skills appear in this listing',miss:skillMiss});
  const have=facets.filter(f=>f.s==='✓').length,partial=facets.filter(f=>f.s==='△').length;
  const base=facets.filter(f=>f.s!=='–').length||1;
  const score=Math.max(35,Math.min(96,Math.round(40+(have*18+partial*6)/base*2)));
  return{score,facets,skillMiss};
}

function saveProfileLocal(){
  localStorage.setItem('cc_profile',JSON.stringify(userProfile));
  localStorage.setItem('cc_prefs',JSON.stringify(userPrefs));
}

function saveInteractionLocal(jobId,action){
  jobInteractions[jobId]=action;
  localStorage.setItem('cc_interactions',JSON.stringify(jobInteractions));
}

// ── AI Job Matching Score ────────────────────────────────────────────
function matchScore(job){
  if(!userPrefs.target_roles&&!userPrefs.preferred_locations&&!userPrefs.skills_wanted) return null;
  let score=0,reasons=[],weaknesses=[];

  // Role match (25%)
  const targetRoles=(userPrefs.target_roles||'').toLowerCase().split(',').map(r=>r.trim()).filter(Boolean);
  const jobRole=(job.role||'').toLowerCase();
  if(targetRoles.length){
    const roleMatch=targetRoles.some(r=>jobRole.includes(r)||r.includes(jobRole.split(' ')[0]));
    if(roleMatch){score+=25;reasons.push('Role matches your target');}
    else{const partial=targetRoles.some(r=>jobRole.split(' ').some(w=>r.includes(w)&&w.length>3));
      if(partial){score+=12;reasons.push('Partial role match');}
      else weaknesses.push('Role differs from target');}
  } else score+=25;

  // Skills match (25%)
  const wantedSkills=(userPrefs.skills_wanted||userProfile.skills||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
  const jobText=(job.description||''+job.skills||''+job.qualification||'').toLowerCase();
  if(wantedSkills.length){
    const matched=wantedSkills.filter(s=>jobText.includes(s));
    const skillPct=matched.length/wantedSkills.length;
    score+=Math.round(skillPct*25);
    if(matched.length>0)reasons.push(`${matched.length}/${wantedSkills.length} skills match`);
    const missing=wantedSkills.filter(s=>!jobText.includes(s));
    if(missing.length>0&&missing.length<=3)weaknesses.push('Missing: '+missing.join(', '));
  } else score+=25;

  // Location match (20%)
  const prefLocs=(userPrefs.preferred_locations||'').toLowerCase().split(',').map(l=>l.trim()).filter(Boolean);
  const jobLoc=(job.location||'').toLowerCase();
  if(prefLocs.length){
    const locMatch=prefLocs.some(l=>jobLoc.includes(l)||l.includes(jobLoc));
    if(locMatch){score+=20;reasons.push('Location matches preference');}
    else if(jobLoc.includes('remote')||jobLoc.includes('work from home')){score+=15;reasons.push('Remote option available');}
    else weaknesses.push('Location differs from preference');
  } else score+=20;

  // Experience match (15%)
  const prefExpMin=parseFloat(userPrefs.experience_min)||0;
  const prefExpMax=parseFloat(userPrefs.experience_max)||20;
  const expText=(job.experience_level||'').toLowerCase();
  const expMatch=expText.match(/(\d+)/g);
  if(expMatch){
    const jobExpMin=parseFloat(expMatch[0])||0;
    if(jobExpMin<=prefExpMax&&jobExpMin>=Math.max(0,prefExpMin-2)){
      score+=15;reasons.push('Experience level fits');
    } else weaknesses.push('Experience mismatch');
  } else score+=15;

  // Salary match (10%)
  const prefSalMin=parseFloat(userPrefs.salary_min)||0;
  if(prefSalMin&&job.salary_min){
    if(parseFloat(job.salary_min)>=prefSalMin*0.85){score+=10;reasons.push('Salary meets preference');}
    else weaknesses.push('Salary below preference');
  } else score+=10;

  // Sector match (5%)
  const prefSector=userPrefs.sectors||'Both';
  if(prefSector==='Both'||prefSector===job.sector||(prefSector==='Government'&&['Government','Public Sector'].includes(job.sector))){
    score+=5;
  }

  return {score:Math.min(score,100),reasons,weaknesses};
}

// ── For You Feed ─────────────────────────────────────────────────────
function renderForYou(){
  const container=$('forYouJobs');
  if(!container)return;
  const cp=civilProfile();
  const hasProfile=cp.role||cp.stage||cp.skills?.length||userPrefs.target_roles||userPrefs.preferred_locations||userProfile.job_title;
  if(!hasProfile){
    container.innerHTML=`<div class="foryou-empty">
      <div class="foryou-icon">🎯</div>
      <h3>Set up your civil engineering profile</h3>
      <p>Role, project type, skills, career stage, work type and environment — 2 minutes, completely free, stays in your browser.</p>
      <button class="btn primary" onclick="openProfileSetup()">Set Up Profile — Free</button>
    </div>`;
    return;
  }

  // Signed-in candidates receive a bounded server-generated feed so personalization is not limited to the first browser page of jobs.
  const remote=Array.isArray(window.__ccRecommendations)?window.__ccRecommendations:[];
  if(remote.length){
    container.innerHTML=`<div class="foryou-profile-summary"><span>Personalized from your saved CivilCareer profile</span><button class="btn secondary" onclick="openProfileSetup()">⚙ Update</button></div>`+remote.slice(0,12).map(j=>matchJobCard(j,{facets:(j.reasons||[]).slice(0,4).map(r=>({k:'Fit',s:'✓',why:r}))})).join('');
    bindCards();
    return;
  }

  // Guest/local mode continues to score the jobs currently loaded in the browser.
  const scored=jobs
    .filter(j=>sectorOf(j)==='Private'||isGovJob(j))
    .filter(j=>!jobInteractions[j.id]||jobInteractions[j.id]==='saved')
    .map(j=>({...j,_cm:civilMatch(j),_match:matchScore(j)}))
    .map(j=>({...j,_best:j._cm.score!=null?j._cm:j._match}))
    .filter(j=>j._best&&(j._best.score>=45||FOR_YOU_ROLES_RE.test(normText(j.role||j.role_normalized||''))))
    .sort((a,b)=>b._best.score-a._best.score)
    .slice(0,20);

  if(!scored.length){
    container.innerHTML=`<div class="foryou-empty"><p>No strong matches yet — try adding more skills to your profile, or check back as new jobs are published.</p><button class="btn primary" onclick="openProfileSetup()">Update Profile</button></div>`;
    return;
  }

  container.innerHTML=`<div class="foryou-profile-summary"><span>Profile: <b>${esc(cp.role||userProfile.job_title||'Civil Engineer')}</b>${cp.stage?` · ${esc(cp.stage)}`:''}${cp.skills?.length?` · ${cp.skills.length} skills`:''}</span><button class="btn secondary" onclick="openProfileSetup()">⚙ Update</button></div>`+scored.map(j=>matchJobCard(j,j._best)).join('');
  bindCards();
}

function matchJobCard(j,match){
  const saved=getSaved().has(j.id)||jobInteractions[j.id]==='saved';
  const cm=match.facets?match:null;
  const facets=cm?cm.facets:[];
  const skillMiss=cm?cm.skillMiss:[];
  return `<article class="job-card match-card" data-explorer-job="${j.id}">
    <div class="match-score-row">
      <span class="match-label">Recommended for your profile</span>
    </div>
    <h3>${esc(j.role||'Opportunity')}</h3>
    <div class="organization">${esc(j.company||'Organization')}</div>
    ${salaryText(j)?`<div class="salary-badge">💰 ${esc(salaryText(j))}</div>`:''}
    <div class="card-meta">
      ${j.location?`<span>📍 ${esc(j.location)}</span>`:''}
      ${j.experience_level?`<span>⏱ ${esc(j.experience_level)}</span>`:''}
    </div>
    ${facets.length?`<div class="why-match-box"><b>WHY THIS JOB FITS</b><div class="why-facets">${facets.map(f=>`<span class="why-facet" title="${esc(f.why)}">${f.k} ${f.s==='✓'?'✓':f.s==='△'?'△':'–'}</span>`).join('')}</div>${skillMiss.length?`<div class="why-missing">Skill gap${skillMiss.length>1?'s':''}: ${skillMiss.slice(0,3).map(s=>`<b>${esc(s)}</b>`).join(', ')} — recommended skill${skillMiss.length>1?'s':''} to strengthen this application.</div>`:''}</div>`:''}
    <div class="card-actions">
      <button data-job="${j.id}">View Details</button>
      <button class="btn-save ${saved?'saved':''}" onclick="trackJob('${j.id}','${saved?'unsave':'saved'}',this)">${saved?'★ Saved':'☆ Save'}</button>
      <button class="btn-apply" onclick="trackJob('${j.id}','applied',this);window.open('${esc(j.application_url||j.apply_url||j.source_url||'')}','_blank')">Apply →</button>
    </div>
  </article>`;
}

function trackJob(jobId,action,btn){
  saveInteractionLocal(jobId,action);
  if(action==='ignored'){btn.closest('article').remove();toast('Job hidden. Refresh For You to update.');}
  else if(action==='saved'){btn.textContent='★ Saved';btn.classList.add('saved');toast('Job saved!');}
  else if(action==='applied'){toast('Marked as applied!');}
  else if(action==='unsave'){btn.textContent='☆ Save';btn.classList.remove('saved');saveInteractionLocal(jobId,'');toast('Bookmark removed.');}
}

// ── Profile Setup Modal ──────────────────────────────────────────────
// ── Profile Setup Modal (expanded civil engineering profile) ──────────
function openProfileSetup(){
  let overlay=$('profileOverlay');
  if(!overlay){
    overlay=document.createElement('div');
    overlay.id='profileOverlay';
    overlay.className='profile-overlay';
    overlay.onclick=e=>{if(e.target===overlay)closeProfileModal();};
    document.body.appendChild(overlay);
  }
  const prefs=userPrefs,prof=userProfile,cp=civilProfile();
  const opts=(list,sel)=>list.map(x=>`<option value="${esc(x)}" ${sel===x?'selected':''}>${esc(x)}</option>`).join('');
  overlay.innerHTML=`<div class="profile-modal-inner">
    <div class="profile-modal-header">
      <h2>🎯 Your Civil Engineering Profile</h2>
      <button class="profile-close" onclick="closeProfileModal()">✕</button>
    </div>
    <div class="profile-tabs">
      <button class="ptab active" onclick="showPTab('basics',this)">👤 About Me</button>
      <button class="ptab" onclick="showPTab('civil',this)">🏗 Civil Profile</button>
      <button class="ptab" onclick="showPTab('prefs',this)">🎯 Preferences</button>
    </div>
    <div id="ptab-basics" class="ptab-content">
      <label>Your name<input id="pName" value="${esc(prof.name||'')}" placeholder="e.g. Modin Kumar"></label>
      <label>Current role<input id="pJobTitle" value="${esc(prof.job_title||'')}" placeholder="e.g. Planning Engineer"></label>
      <label>Years of experience<input id="pExp" type="number" value="${prof.experience_years||''}" placeholder="e.g. 5"></label>
      <label>Education<input id="pEdu" value="${esc(prof.education||'')}" placeholder="e.g. B.E. Civil Engineering"></label>
    </div>
    <div id="ptab-civil" class="ptab-content" style="display:none">
      <label>Role<select id="cpRole"><option value="">Select your role</option>${opts(CC_FORYOU_ROLES,cp.role)}</select></label>
      <label>Project type<select id="cpProject"><option value="">Any project type</option>${opts(CC_FORYOU_PROJECTS,cp.project)}</select></label>
      <label>Career stage<select id="cpStage"><option value="">Select career stage</option>${opts(CC_FORYOU_STAGES,cp.stage)}</select></label>
      <label>Work type<select id="cpWork"><option value="">Any work type</option>${opts(CC_FORYOU_WORK,cp.work)}</select></label>
      <label>Project environment<select id="cpEnv"><option value="">Any environment</option>${opts(CC_FORYOU_ENV,cp.env)}</select></label>
      <fieldset class="cp-skills"><legend>Your skills</legend><div class="cp-chips">${CC_FORYOU_SKILLS.map(s=>`<button type="button" class="cp-chip ${((cp.skills||[]).includes(s))?'active':''}" data-skill="${esc(s)}">${esc(s)}</button>`).join('')}</div></fieldset>
      <label>Preferred location<input id="cpLocation" value="${esc(cp.location||prefs.preferred_locations||'')}" placeholder="Bengaluru, Karnataka, India"></label>
    </div>
    <div id="ptab-prefs" class="ptab-content" style="display:none">
      <label>Preferred locations<input id="pLocations" value="${esc(prefs.preferred_locations||'')}" placeholder="Bengaluru, Hyderabad, Mumbai"></label>
      <label>Experience range (years)
        <div style="display:flex;gap:.5rem">
          <input id="pExpMin" type="number" value="${prefs.experience_min||''}" placeholder="Min" style="flex:1">
          <input id="pExpMax" type="number" value="${prefs.experience_max||''}" placeholder="Max" style="flex:1">
        </div>
      </label>
      <label>Min salary (₹/year)<input id="pSalMin" type="number" value="${prefs.salary_min||''}" placeholder="e.g. 500000"></label>
      <label>Sector<select id="pSector">
        <option ${(prefs.sectors||'Both')==='Both'?'selected':''}>Both</option>
        <option ${prefs.sectors==='Private'?'selected':''}>Private</option>
        <option ${prefs.sectors==='Government'?'selected':''}>Government</option>
      </select></label>
    </div>
    <button class="btn primary wide" style="margin-top:1rem;width:100%" onclick="saveProfile()">💾 Save & Find Matches</button>
  </div>`;
  overlay.style.display='flex';
  overlay.querySelectorAll('.cp-chip').forEach(b=>b.onclick=()=>b.classList.toggle('active'));
}

function closeProfileModal(){
  const ov=$('profileOverlay');
  if(ov)ov.style.display='none';
}
function showPTab(tab,btn){
  $$('.ptab-content').forEach(el=>el.style.display='none');
  $$('.ptab').forEach(b=>b.classList.remove('active'));
  $('ptab-'+tab).style.display='block';
  btn.classList.add('active');
}

function saveProfile(){
  userProfile={
    ...userProfile,
    name:$('pName')?.value||userProfile.name||'',
    job_title:$('pJobTitle')?.value||userProfile.job_title||'',
    experience_years:parseFloat($('pExp')?.value)||userProfile.experience_years||null,
    education:$('pEdu')?.value||userProfile.education||''
  };
  userPrefs={
    ...userPrefs,
    preferred_locations:$('pLocations')?.value||userPrefs.preferred_locations||'',
    experience_min:parseFloat($('pExpMin')?.value)||null,
    experience_max:parseFloat($('pExpMax')?.value)||null,
    salary_min:parseFloat($('pSalMin')?.value)||null,
    sectors:$('pSector')?.value||'Both'
  };
  const skills=[...document.querySelectorAll('#profileOverlay .cp-chip.active')].map(b=>b.dataset.skill);
  saveCivilProfile({
    role:$('cpRole')?.value||'',
    project:$('cpProject')?.value||'',
    stage:$('cpStage')?.value||'',
    work:$('cpWork')?.value||'',
    env:$('cpEnv')?.value||'',
    skills,
    location:$('cpLocation')?.value||userPrefs.preferred_locations||''
  });
  saveProfileLocal();
  closeProfileModal();
  toast('Profile saved! Finding your matches…');
  navigate('foryou');
  renderForYou();
}

/* Live statistics (FIX-2026-09-25): a failed endpoint is remembered so the UI can
   show “Unable to load” instead of silently pretending the count is 0. */
async function loadData(){clearTimeout(window.__ccStatsTimer);const [j,e,m,s]=await Promise.allSettled([api('/api/jobs?limit=40&page=1'),api('/api/exams'),api('/api/materials'),api('/api/jobs?summary=1')]);const okJobs=j.status==='fulfilled',okExams=e.status==='fulfilled',okMats=m.status==='fulfilled',okSummary=s.status==='fulfilled';window.__ccLoadFailed={jobs:!okJobs,exams:!okExams,materials:!okMats};jobs=okJobs?j.value.jobs||[]:[];exams=okExams?e.value.exams||[]:[];materials=okMats?m.value.materials||[]:[];window.__ccJobSummary=okSummary?s.value:null;window.__ccAllJobs=jobs;normalizeJobs();renderHome();renderPrivate();renderGovernment();renderExams();renderMaterials();updateStats();updateNavCounts();renderForYou()}
/* Normalize every loaded record in place so inconsistent sector strings, missing
   optional location fields and similar data quirks never break rendering. */
function normalizeJobs(){
  jobs.forEach(j=>{
    if(!j.id)j.id=String(j.source_url||j.role||Math.random());
    if(!j.role&&j.title)j.role=j.title;
    if(!j.role)j.role='Civil Engineering Opportunity';
    if(j.state===undefined&&j.location&&INDIA_STATES.some(s=>String(j.location).toLowerCase().includes(s.toLowerCase())))j.state=j.location;
    if(!j.location&&!j.city&&!j.state)j.location='India';
    if(!j.created_at&&j.posted_date)j.created_at=j.posted_date;
  });
}
function formObject(form){return Object.fromEntries(new FormData(form).entries())}function wireForm(id,url,transform=x=>x){const f=$(id);f.onsubmit=async e=>{e.preventDefault();const st=f.querySelector('.form-status');st.className='form-status show';st.textContent='Submitting securely…';try{let data=formObject(f);data=transform(data);await api(url,{method:'POST',body:JSON.stringify(data)});st.className='form-status show success';st.textContent='Thank you. Your submission is pending administrator review.';f.reset()}catch(err){st.className='form-status show error';st.textContent=err.message}}}
/* Compound search — roles / locations are comma-separated lists (search 2–3
   roles across 2–3 cities in ONE search); experience narrows the results.
   Deliberately NOT named `search`: discovery-v9.js reassigns that global, and
   the header/home search must always hit the server with full filters. */
async function runCompoundSearch(q,loc='',exp=''){
  const splitList=v=>String(v||'').split(',').map(s=>s.trim()).filter(Boolean).slice(0,12);
  const roles=splitList(q),cities=splitList(loc);exp=String(exp||'').trim();
  let jobResults=[];
  try{
    const params=new URLSearchParams({page:'1',limit:'60'});
    if(roles.length)params.set('roles',roles.join(','));
    if(cities.length)params.set('cities',cities.join(','));
    if(exp)params.set('experience',exp);
    if(!roles.length&&!cities.length&&!exp&&q.trim())params.set('q',q.trim());
    const data=await api(`/api/jobs?${params.toString()}`);
    jobResults=data.jobs||[];window.__ccSearchJobs=jobResults;
  }catch(err){window.__ccSearchJobs=[]}
  const results=[];jobResults.forEach(j=>results.push({type:isGovJob(j)?'Government Job':'Civil Job',title:j.role,sub:[j.company,j.location_display||j.location].filter(Boolean).join(' · '),action:`data-job="${j.id}"`}));
  const needle=roles.join(' ').toLowerCase(),place=cities.join(' ').toLowerCase();exams.forEach(x=>{if((!needle||[x.code,x.title_en,x.authority,x.post_names,x.notification_number,x.overview].join(' ').toLowerCase().includes(needle))&&(!place||[x.job_location,x.authority].join(' ').toLowerCase().includes(place)))results.push({type:'Exam',title:`${x.code} — ${x.title_en}`,sub:x.authority,action:`data-exam="${x.id}"`})});materials.forEach(m=>{if(!needle||[m.title_en,m.category,m.exam_code].join(' ').toLowerCase().includes(needle))results.push({type:'Resource',title:m.title_en,sub:m.category,action:`data-material-id="${m.id}"`})});
  const summaryBits=[roles.length?`role${roles.length>1?'s':''} “${roles.join('”, “')}”`:'',cities.length?`in ${cities.join(', ')}`:'',exp?`${exp} experience`:''].filter(Boolean);
  $('searchSummary').textContent=results.length?`${results.length} result${results.length===1?'':'s'}${summaryBits.length?' for '+summaryBits.join(' '):''}`:'No matching results.';$('searchResults').innerHTML=results.length?results.slice(0,60).map(x=>`<article class="job-card"><span class="pill">${esc(x.type)}</span><h3>${esc(x.title)}</h3><p>${esc(x.sub||'')}</p><div class="card-actions"><button ${x.action}>View Details</button></div></article>`).join(''):empty('No results found','Try a different keyword, department or location.');bindCards();navigate('search');track('search','universal')}
window.runCompoundSearch=runCompoundSearch;
async function search(q,loc='',exp=''){return runCompoundSearch(q,loc,exp)}
$('ccSearchInput')&&$('ccSearchInput').addEventListener('input',e=>renderCcSearch(e.target.value));
$$('#ccSearchOverlay .cc-search-hints button')&&$$('#ccSearchOverlay .cc-search-hints button').forEach(b=>b.onclick=()=>{const q=b.dataset.q;const r=$('ccSearchRoles');if(r&&/engineer|surveyor|planning|estimator/i.test(q))r.value=q;closeCcSearch();runCompoundSearch(q,'','');});
const sug=['Civil Site Engineer','Site Engineer','Planning Engineer','Planning Manager','Quantity Surveyor','Estimator','Cost Engineer','Cost Consultant','Cost Controller','Project Controller','Project Control Analyst','BIM Engineer','Structural Engineer','Government Civil Jobs','SSC JE Civil','ESE Civil','Bengaluru','Mumbai','Chennai','Hyderabad','Noida','Gurugram','Pune','Kolkata'];$('globalQuery').oninput=e=>{const q=e.target.value.toLowerCase();const a=sug.filter(x=>x.toLowerCase().includes(q)).slice(0,5);$('suggestions').innerHTML=a.map(x=>`<button type="button">${x}</button>`).join('');$('suggestions').classList.toggle('show',q.length>0&&a.length>0);$$('#suggestions button').forEach(b=>b.onclick=()=>{$('globalQuery').value=b.textContent;$('suggestions').classList.remove('show')})};$('smartSearch').onsubmit=e=>{e.preventDefault();$('suggestions').classList.remove('show');runCompoundSearch($('globalQuery').value,$('globalLocation').value,$('globalExperience')?$('globalExperience').value:'')};
if($('privateScopeChips'))$$('#privateScopeChips button').forEach(b=>b.onclick=()=>{$$('#privateScopeChips button').forEach(x=>x.classList.toggle('active',x===b));renderPrivate()});['privateRole','privateExperience','privateType','privateSort'].forEach(id=>{const el=$(id);if(el)el.onchange=renderPrivate});['privateLocation','privateQualification'].forEach(id=>{const el=$(id);if(el)el.oninput=renderPrivate});['govStatus','govSort'].forEach(id=>$(id)&&$(id).addEventListener('change',renderGovernment));
$('privateSort')&&$('privateSort').addEventListener('change',renderPrivate);
['govState','govLocation','govQualification','govDistrict','govEdu'].forEach(id=>{const el=$(id);if(el){el.addEventListener('change',renderGovernment);el.addEventListener('input',renderGovernment)}});
// Org chips for govt jobs
if($('govScopeChips'))$$('#govScopeChips button').forEach(b=>b.onclick=()=>{$$('#govScopeChips button').forEach(x=>x.classList.toggle('active',x===b));renderGovernment()});
// Edu chips for govt jobs

// Edu chips for private jobs
if($('privEduChips')){$$('#privEduChips button').forEach(b=>b.onclick=()=>{$$('#privEduChips button').forEach(x=>x.classList.toggle('active',x===b));renderPrivate()});}$$('#examChips button').forEach(b=>b.onclick=()=>{$$('#examChips button').forEach(x=>x.classList.toggle('active',x===b));renderExams(b.dataset.code)});$$('.material-tabs button').forEach(b=>b.onclick=()=>{$$('.material-tabs button').forEach(x=>x.classList.toggle('active',x===b));renderMaterials(b.dataset.material)});
wireForm('employerForm','/api/employer-submissions');wireForm('resourceForm','/api/resource-submissions',d=>({...d,permission_confirmed:document.querySelector('#resourceForm [name="permission_confirmed"]').checked}));wireForm('reportForm','/api/reports');wireForm('contactForm','/api/contact');
translate();navigate(pathRoute[location.pathname]||'home',false);statsLoading();loadData();

// Wire featured org tiles
$$('.org-tile[data-route]').forEach(a=>a.onclick=e=>{e.preventDefault();navigate(a.dataset.route)});
if ("serviceWorker" in navigator) {
  window.addEventListener("load",()=>navigator.serviceWorker.getRegistration().then(r=>r&&r.update()).catch(()=>{}));
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .catch(() => {});
  });
}

window.renderForYou=renderForYou;
