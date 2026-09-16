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

let activePrivateCategory='';

const $=id=>document.getElementById(id),$$=s=>[...document.querySelectorAll(s)],esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let jobs=[],exams=[],materials=[],route='home',adminKey='',lang=localStorage.getItem('cc_lang')||'en';

function getSaved(){return new Set(JSON.parse(localStorage.getItem('cc_saved')||'[]'))}

function toggleSave(id){
  const s=getSaved();
  s.has(id)?s.delete(id):s.add(id);
  localStorage.setItem('cc_saved',JSON.stringify([...s]))
}

const pathRoute={'/':'home','/private-jobs':'private','/government-jobs':'government','/exams':'exams','/study-materials':'materials','/post-a-job':'post','/submit-resource':'resource','/report':'report','/about':'about','/search':'search','/admin':'admin'};
const routePath=Object.fromEntries(Object.entries(pathRoute).map(([a,b])=>[b,a]));

const kn={'Private Jobs':'ಖಾಸಗಿ ಉದ್ಯೋಗಗಳು','Karnataka Govt Jobs':'ಕರ್ನಾಟಕ ಸರ್ಕಾರಿ ಉದ್ಯೋಗಗಳು','Exams':'ಪರೀಕ್ಷೆಗಳು','Study Materials':'ಅಧ್ಯಯನ ಸಾಮಗ್ರಿಗಳು','Post a Job':'ಉದ್ಯೋಗ ಪ್ರಕಟಿಸಿ','Submit Resource':'ಸಂಪನ್ಮೂಲ ಸಲ್ಲಿಸಿ','About':'ನಮ್ಮ ಬಗ್ಗೆ','Safety:':'ಸುರಕ್ಷತೆ:','Never pay for a job. Always verify the original notification.':'ಉದ್ಯೋಗಕ್ಕಾಗಿ ಎಂದಿಗೂ ಹಣ ಪಾವತಿಸಬೇಡಿ. ಮೂಲ ಅಧಿಕೃತ ಅಧಿಸೂಚನೆಯನ್ನು ಸದಾ ಪರಿಶೀಲಿಸಿ.','Civil Engineering Careers + Karnataka Government Jobs':'ಸಿವಿಲ್ ಎಂಜಿನಿಯರಿಂಗ್ ವೃತ್ತಿಗಳು + ಕರ್ನಾಟಕ ಸರ್ಕಾರಿ ಉದ್ಯೋಗಗಳು','Build Your Career.':'ನಿಮ್ಮ ವೃತ್ತಿಜೀವನವನ್ನು ರೂಪಿಸಿಕೊಳ್ಳಿ.','Find Your Opportunity.':'ನಿಮ್ಮ ಅವಕಾಶವನ್ನು ಕಂಡುಕೊಳ್ಳಿ.','Civil engineering jobs across India and beyond. Karnataka government jobs and exams across departments. Trusted resources, organized in one place.':'ಭಾರತ ಮತ್ತು ವಿದೇಶಗಳ ಸಿವಿಲ್ ಎಂಜಿನಿಯರಿಂಗ್ ಉದ್ಯೋಗಗಳು, ಕರ್ನಾಟಕ ಸರ್ಕಾರಿ ಉದ್ಯೋಗಗಳು ಮತ್ತು ಪರೀಕ್ಷೆಗಳು ಹಾಗೂ ವಿಶ್ವಾಸಾರ್ಹ ಅಧ್ಯಯನ ಸಂಪನ್ಮೂಲಗಳು — ಒಂದೇ ಸ್ಥಳದಲ್ಲಿ.','Find Civil Engineering Jobs':'ಸಿವಿಲ್ ಎಂಜಿನಿಯರಿಂಗ್ ಉದ್ಯೋಗಗಳನ್ನು ಹುಡುಕಿ','Explore Karnataka Government Jobs':'ಕರ್ನಾಟಕ ಸರ್ಕಾರಿ ಉದ್ಯೋಗಗಳನ್ನು ಅನ್ವೇಷಿಸಿ','Explore CivilCareer':'CivilCareer ಅನ್ವೇಷಿಸಿ','Focused paths. Reliable starting points.':'ಕೇಂದ್ರೀಕೃತ ಮಾರ್ಗಗಳು. ವಿಶ್ವಾಸಾರ್ಹ ಆರಂಭ.','Civil Engineering Jobs':'ಸಿವಿಲ್ ಎಂಜಿನಿಯರಿಂಗ್ ಉದ್ಯೋಗಗಳು','Karnataka Government Jobs':'ಕರ್ನಾಟಕ ಸರ್ಕಾರಿ ಉದ್ಯೋಗಗಳು','Government Exams':'ಸರ್ಕಾರಿ ಪರೀಕ್ಷೆಗಳು','Free Study Materials':'ಉಚಿತ ಅಧ್ಯಯನ ಸಾಮಗ್ರಿಗಳು','We Organize.':'ನಾವು ಕ್ರಮಬದ್ಧಗೊಳಿಸುತ್ತೇವೆ.','You Verify.':'ನೀವು ಪರಿಶೀಲಿಸುತ್ತೀರಿ.','We Organize. You Verify.':'ನಾವು ಕ್ರಮಬದ್ಧಗೊಳಿಸುತ್ತೇವೆ. ನೀವು ಪರಿಶೀಲಿಸುತ್ತೀರಿ.','Latest opportunities':'ಇತ್ತೀಚಿನ ಅವಕಾಶಗಳು','Public recruitment':'ಸರ್ಕಾರಿ ನೇಮಕಾತಿ','Important dates':'ಮುಖ್ಯ ದಿನಾಂಕಗಳು','Closing soon':'ಶೀಘ್ರ ಮುಕ್ತಾಯ','Examination updates':'ಪರೀಕ್ಷಾ ಮಾಹಿತಿ','Learning library':'ಅಧ್ಯಯನ ಗ್ರಂಥಾಲಯ','Trust and safety':'ವಿಶ್ವಾಸ ಮತ್ತು ಸುರಕ್ಷತೆ','Never pay for a job':'ಉದ್ಯೋಗಕ್ಕಾಗಿ ಎಂದಿಗೂ ಹಣ ಪಾವತಿಸಬೇಡಿ','Verify the notification':'ಅಧಿಸೂಚನೆಯನ್ನು ಪರಿಶೀಲಿಸಿ','Protect personal information':'ವೈಯಕ್ತಿಕ ಮಾಹಿತಿಯನ್ನು ರಕ್ಷಿಸಿ','For employers':'ಉದ್ಯೋಗದಾತರಿಗೆ','Reach civil engineering professionals.':'ಸಿವಿಲ್ ಎಂಜಿನಿಯರಿಂಗ್ ವೃತ್ತಿಪರರನ್ನು ತಲುಪಿ.','Post a Civil Engineering Job':'ಸಿವಿಲ್ ಎಂಜಿನಿಯರಿಂಗ್ ಉದ್ಯೋಗ ಪ್ರಕಟಿಸಿ','Private-sector opportunities':'ಖಾಸಗಿ ವಲಯದ ಅವಕಾಶಗಳು','Karnataka public recruitment':'ಕರ್ನಾಟಕ ಸರ್ಕಾರಿ ನೇಮಕಾತಿ','All departments. Multiple qualifications. One place to start.':'ಎಲ್ಲಾ ಇಲಾಖೆಗಳು. ಹಲವು ಅರ್ಹತೆಗಳು. ಒಂದೇ ಆರಂಭಿಕ ಸ್ಥಳ.','Dates, eligibility and official sources':'ದಿನಾಂಕಗಳು, ಅರ್ಹತೆ ಮತ್ತು ಅಧಿಕೃತ ಮೂಲಗಳು','Karnataka Government Exams':'ಕರ್ನಾಟಕ ಸರ್ಕಾರಿ ಪರೀಕ್ಷೆಗಳು','Open learning library':'ಮುಕ್ತ ಅಧ್ಯಯನ ಗ್ರಂಥಾಲಯ','Prepare smarter with organized resources for civil engineering and competitive examinations.':'ಸಿವಿಲ್ ಎಂಜಿನಿಯರಿಂಗ್ ಮತ್ತು ಸ್ಪರ್ಧಾತ್ಮಕ ಪರೀಕ್ಷೆಗಳ ಕ್ರಮಬದ್ಧ ಸಂಪನ್ಮೂಲಗಳೊಂದಿಗೆ ಪರಿಣಾಮಕಾರಿಯಾಗಿ ಸಿದ್ಧರಾಗಿ.','Search':'ಹುಡುಕಿ','Location':'ಸ್ಥಳ','Browse Civil Jobs →':'ಸಿವಿಲ್ ಉದ್ಯೋಗಗಳನ್ನು ನೋಡಿ →','Browse Government Jobs →':'ಸರ್ಕಾರಿ ಉದ್ಯೋಗಗಳನ್ನು ನೋಡಿ →','Explore Exams →':'ಪರೀಕ್ಷೆಗಳನ್ನು ನೋಡಿ →','Start Learning →':'ಅಧ್ಯಯನ ಪ್ರಾರಂಭಿಸಿ →','Report Suspicious Content':'ಶಂಕಿತ ವಿಷಯವನ್ನು ವರದಿ ಮಾಡಿ','Submit for Review':'ಪರಿಶೀಲನೆಗೆ ಸಲ್ಲಿಸಿ','Report a Problem':'ಸಮಸ್ಯೆಯನ್ನು ವರದಿ ಮಾಡಿ','Submit a Study Resource':'ಅಧ್ಯಯನ ಸಂಪನ್ಮೂಲ ಸಲ್ಲಿಸಿ'};

function translate(root=document){
  root.querySelectorAll('*').forEach(el=>{
    if(el.id==='language'||el.children.length)return;
    if(!el.dataset.en)el.dataset.en=el.textContent.trim();
    if(kn[el.dataset.en])el.textContent=lang==='kn'?kn[el.dataset.en]:el.dataset.en
  });
  $('language').textContent=lang==='kn'?'EN':'KN';
  document.documentElement.lang=lang==='kn'?'kn':'en'
}

function toast(msg){
  const x=$('toast');
  x.textContent=msg;
  x.classList.add('show');
  clearTimeout(toast.t);
  toast.t=setTimeout(()=>x.classList.remove('show'),2800)
}

function device(){
  const w=innerWidth;
  return w<600?'Mobile':w<1000?'Tablet':'Desktop'
}

function visitor(){
  let id=localStorage.getItem('cc_vid');
  if(!id){
    id=crypto.randomUUID();
    localStorage.setItem('cc_vid',id)
  }
  return id
}

async function api(url,opt={}){
  const r=await fetch(url,{...opt,headers:{'content-type':'application/json',...(opt.key?{'x-owner-key':opt.key}:{}),...(opt.headers||{})}}),
  text=await r.text();
  let data={};
  try{data=text?JSON.parse(text):{}}catch{}
  if(!r.ok)throw Error(data.error||`Request failed (${r.status})`);
  return data
}

function track(type='pageview',label=''){
  api('/api/analytics',{method:'POST',body:JSON.stringify({visitor_id:visitor(),event_type:type,event_label:label,path:location.pathname,referrer:document.referrer,device_type:device()})}).catch(()=>{})
}

function navigate(next,push=true){
  route=next in routePath?next:'home';
  $$('.page').forEach(p=>p.classList.toggle('active',p.dataset.page===route));
  $$('[data-route]').forEach(a=>a.classList.toggle('active',a.dataset.route===route));
  $('mainNav').classList.remove('open');
  $('menuBtn').setAttribute('aria-expanded','false');
  if(push&&location.pathname!==routePath[route])history.pushState({},'',routePath[route]);
  setMeta();
  scrollTo({top:0,behavior:'smooth'});
  if(route==='private')renderPrivate();
  if(route==='government')renderGovernment();
  if(route==='exams')renderExams();
  if(route==='materials')renderMaterials();
  if(route==='admin')showAdmin();
  translate();
  track()
}

const metas={home:['CivilCareer — Civil Engineering Careers & Karnataka Government Jobs','Civil engineering jobs across India and beyond, Karnataka government jobs, exams and trusted resources.'],private:['Civil Engineering Jobs | CivilCareer','Private-sector civil engineering jobs across Karnataka, India, Gulf and international markets.'],government:['Karnataka Government Jobs | CivilCareer','Government recruitment across Karnataka departments, organizations and qualifications.'],exams:['Karnataka Government Exams | CivilCareer','KPSC, KAS, FDA, SDA, KARTET, GPSTR, HSTR, AE and JE examination updates.'],materials:['Free Civil Engineering & Exam Study Materials | CivilCareer','Free organized civil engineering and Karnataka competitive-exam resources.'],post:['Post a Civil Engineering Job | CivilCareer','Submit a legitimate civil engineering job for moderation.'],resource:['Submit a Study Resource | CivilCareer','Submit a study resource you own or have permission to distribute.'],report:['Report a Problem | CivilCareer','Privately report suspicious, incorrect, expired or copyrighted content.'],about:['About CivilCareer','Learn about CivilCareer’s safety, accuracy and official-source principles.'],search:['Search CivilCareer','Search civil engineering jobs, Karnataka government recruitment, exams and resources.'],admin:['CivilCareer Admin','Protected CivilCareer administration.']};

function setMeta(){
  const m=metas[route]||metas.home;
  document.title=m[0];
  document.querySelector('meta[name="description"]').content=m[1]
}

function date(v){
  if(!v)return'Check official notification';
  const d=new Date(v+'T00:00:00');
  return isNaN(d)?v:d.toLocaleDateString(lang==='kn'?'kn-IN':'en-IN',{day:'numeric',month:'short',year:'numeric'})
}

function isClosed(j){
  return j.status==='Expired'||(j.deadline&&new Date(j.deadline+'T23:59:59')<new Date())
}

function short(v,n=150){
  v=String(v||'');
  return v.length>n?v.slice(0,n).trim()+'…':v
}

function jobCard(j,gov=false){
  const closed=isClosed(j),verified=j.last_verified&&!closed,saved=getSaved().has(j.id);
  const isNew=j.created_at&&(new Date()-new Date(j.created_at))<3*86400000;
  const urgClass=closed?'card-closed':daysLeft!==null&&daysLeft<=3?'card-urgent':daysLeft!==null&&daysLeft<=7?'card-soon':'card-fresh';
  const daysLeft=j.deadline&&!closed?Math.ceil((new Date(j.deadline+'T23:59:59')-new Date())/86400000):null;
  const waText=encodeURIComponent((j.role||'Job')+' at '+(j.company||'Organization')+'\n'+(j.location?j.location+'\n':'')+(j.source_url?'Apply: '+j.source_url:''));
  return `<article class="job-card ${urgClass}">
    <div class="card-top">
      <span class="pill ${closed?'closed':j.featured?'featured':verified?'verified':''}">${closed?'Application Closed':j.featured?'Featured':verified?'Verified':gov?'Government':'Civil Engineering'}</span>
      ${j.deadline?`<span class="verified-date">${closed?'Closed':'Deadline'} ${date(j.deadline)}</span>`:''}
      ${isNew?'<span class="new-badge">NEW</span>':''}
      ${daysLeft!==null&&daysLeft<=7?`<span class="countdown-badge ${daysLeft<=3?'urgent':''}">${daysLeft<=0?'Last day!':daysLeft+'d left'}</span>`:''}
    </div>
    <h3>${esc(j.role||'Opportunity')}</h3>
    <div class="organization">${esc(j.company||'Organization')}${j.created_at?'<span class="post-age">'+timeAgo(j.created_at)+'</span>':''}</div>
    ${(j.salary||SALARY_HINTS[classifyJob(j)])?`<div class="salary-badge">💰 ${esc(j.salary||SALARY_HINTS[classifyJob(j)])}</div>`:''}
    ${j.vacancy_count?`<span class="vacancy-badge">📋 ${esc(j.vacancy_count)} Posts</span>`:''}
    <div class="card-meta">
      ${j.location?`<span>${esc(j.location)}</span>`:''}
      ${j.experience_level?`<span>${esc(j.experience_level)}</span>`:''}
      ${j.qualification?`<span>${esc(j.qualification)}</span>`:''}
      ${j.employment_type?`<span>${esc(j.employment_type)}</span>`:''}
    </div>
    <p class="card-copy">${esc(short(j.description||'Check the official source for the latest details.'))}</p>
    <div class="card-actions">
      <button data-job="${j.id}">View Details</button>
      <a class="btn-wa" href="https://wa.me/?text=${waText}" target="_blank" rel="noopener">📲 Share</a>
      <button class="btn-save ${saved?'saved':''}" data-save-job="${j.id}" title="${saved?'Remove bookmark':'Save job'}">${saved?'★':'☆'}</button>
      ${verified?`<span class="verified-date">Last verified: ${date(j.last_verified)}</span>`:''}
    </div>
  </article>`
}

function examCard(x){
  const closed=x.application_end&&new Date(x.application_end+'T23:59:59')<new Date(),
  title=lang==='kn'&&x.title_kn?x.title_kn:x.title_en,
  copy=x.overview||(lang==='kn'&&x.eligibility_kn?x.eligibility_kn:x.eligibility_en);
  const daysLeft=x.application_end&&!closed?Math.ceil((new Date(x.application_end+'T23:59:59')-new Date())/86400000):null;
  return `<article class="exam-card"><div class="card-top"><span class="pill ${closed?'closed':x.last_verified?'verified':''}">${closed?'Application Closed':x.status||'Update'}</span>${x.application_end?`<span class="verified-date">Deadline ${date(x.application_end)}</span>`:''}${daysLeft!==null?`<span class="countdown-badge ${daysLeft<=3?'urgent':''}">${daysLeft<=0?'Last day!':daysLeft+'d left'}</span>`:''}</div><h3>${esc(title)}</h3><div class="organization">${esc(x.authority||'Conducting authority')}${x.vacancy_count?` · ${esc(x.vacancy_count)} vacancies`:''}</div><p class="card-copy">${esc(short(copy||'Check the official notification for complete recruitment details.'))}</p><div class="card-actions"><button data-exam="${x.id}">View Complete Details</button>${x.official_notification_url?`<a href="${esc(x.official_notification_url)}" target="_blank" rel="noopener">Official PDF ↗</a>`:''}</div></article>`
}

function materialCard(m){
  const title=lang==='kn'&&m.title_kn?m.title_kn:m.title_en;
  return `<article class="material-card"><div class="card-top"><span class="pill verified">${esc(m.access_type||'Free')}</span><span class="verified-date">${m.page_count?m.page_count+' pages':'Resource'}</span></div><h3>${esc(title)}</h3><div class="organization">${esc(m.category||m.exam_code||'Study resource')}</div><p class="card-copy">${esc(short(m.description_en||'Organized learning resource.'))}</p><div class="card-actions"><button data-material-id="${m.id}">Preview</button><a href="${esc(m.file_url)}" target="_blank" rel="noopener">Open Resource ↗</a></div></article>`
}

function bindCards(){
  $$('[data-job]').forEach(b=>b.onclick=()=>openJob(jobs.find(x=>x.id===b.dataset.job)));
  $$('[data-exam]').forEach(b=>b.onclick=()=>openExam(exams.find(x=>x.id===b.dataset.exam)));
  $$('[data-material-id]').forEach(b=>b.onclick=()=>openMaterial(materials.find(x=>x.id===b.dataset.materialId)));
  $$('[data-save-job]').forEach(b=>b.onclick=()=>{
    toggleSave(b.dataset.saveJob);
    const saved=getSaved().has(b.dataset.saveJob);
    b.classList.toggle('saved',saved);
    b.textContent=saved?'★':'☆';
    toast(saved?'Job saved! ★':'Bookmark removed.');
  });
}

function empty(title,text){
  return `<div class="empty-state"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`
}

function renderHome(){
  const p=jobs.filter(j=>(j.sector||'Private')==='Private').slice(0,3),
  g=jobs.filter(j=>['Government','Public Sector'].includes(j.sector)).slice(0,3);
  $('homePrivate').innerHTML=p.length?p.map(x=>jobCard(x)).join(''):empty('Opportunities are being added','Verified civil engineering jobs will appear here as they are published.');
  $('homeGovernment').innerHTML=g.length?g.map(x=>jobCard(x,true)).join(''):empty('Recruitment updates are being added','Karnataka government opportunities will appear here after verification.');
  const close=jobs.filter(j=>j.deadline&&!isClosed(j)).sort((a,b)=>a.deadline.localeCompare(b.deadline)).slice(0,4);
  $('closingSoon').innerHTML=close.length?close.map(j=>`<div class="compact-item"><div><b>${esc(j.role)}</b><span>${esc(j.company||j.location||'Opportunity')}</span></div><span>${date(j.deadline)}</span></div>`).join(''):'<div class="compact-item"><span>No active deadlines published.</span></div>';
  $('homeExams').innerHTML=exams.slice(0,4).map(x=>`<div class="compact-item"><div><b>${esc(x.code)} — ${esc(x.title_en)}</b><span>${esc(x.authority||'Examination update')}</span></div><span>${x.application_end?date(x.application_end):'Official dates'}</span></div>`).join('')||'<div class="compact-item"><span>Exam updates are being added.</span></div>';
  $('homeMaterials').innerHTML=materials.slice(0,3).map(materialCard).join('')||empty('Resources are being added','Free civil engineering and Karnataka competitive-exam materials will appear here as they are published.');
  bindCards();
  translate();
  renderUrgencyStrip();
}

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

function renderPrivate(){
  let a=jobs.filter(j=>(j.sector||'Private')==='Private');

  // Populate location dropdowns if empty
  if($('privateState')&&!$('privateState').options.length){
    $('privateState').innerHTML='<option value="">All states</option>'+INDIA_STATES.map(s=>`<option>${s}</option>`).join('');
  }

  if($('privateCity')&&!$('privateCity').options.length){
    $('privateCity').innerHTML='<option value="">All cities</option>'+[...INDIA_CITIES,...GULF_CITIES,...INTL_CITIES].map(c=>`<option>${c}</option>`).join('');
  }

  const role=($('privateRole')&&$('privateRole').value||'').toLowerCase();
  const loc=($('privateLocation')&&$('privateLocation').value||'').toLowerCase();
  const exp=($('privateExperience')&&$('privateExperience').value||'').toLowerCase();
  const qual=($('privateQualification')&&$('privateQualification').value||'').toLowerCase();
  const timePeriod=$('privateSort')&&$('privateSort').value||'';
  const now=new Date();

  // Time filter
  if(['24h','3d','7d','14d','30d','week','month'].includes(timePeriod)){
    const days={'24h':1,'3d':3,'7d':7,'14d':14,'30d':30,'week':7,'month':30};
    const cut=new Date(now.getTime()-days[timePeriod]*86400000);
    a=a.filter(j=>j.created_at&&new Date(j.created_at)>=cut);
  } else if(timePeriod==='closing_soon'){
    a=a.filter(j=>j.deadline&&!isClosed(j));
    a.sort((x,y)=>(x.deadline||'9999').localeCompare(y.deadline||'9999'));
  } else if(timePeriod==='oldest'){
    a.sort((x,y)=>String(x.created_at).localeCompare(String(y.created_at)));
  } else {
    a.sort((x,y)=>String(y.created_at).localeCompare(String(x.created_at)));
  }

  a=a.filter(j=>!role||String(j.role).toLowerCase().includes(role))
     .filter(j=>!loc||String(j.location).toLowerCase().includes(loc))
     .filter(j=>!exp||String(j.experience_level).toLowerCase()===exp)
     .filter(j=>!qual||String(j.qualification).toLowerCase().includes(qual));

  if($('privateType')&&$('privateType').value)a=a.filter(j=>j.employment_type===$('privateType').value);

  // Category view
  if(!activePrivateCategory){
    // Show category tiles
    const counts={};
    jobs.filter(j=>(j.sector||'Private')==='Private').forEach(j=>{const c=classifyJob(j);counts[c]=(counts[c]||0)+1});
    const tiles=ROLE_HEADS.filter(h=>counts[h.id]).map(h=>`
      <button class="role-tile" onclick="activePrivateCategory='${h.id}';renderPrivate()">
        <span class="role-tile-icon">${h.icon}</span>
        <span class="role-tile-label">${h.label}</span>
        <span class="role-tile-count">${counts[h.id]} job${counts[h.id]>1?'s':''}</span>
      </button>`).join('');
    $('privateJobs').innerHTML=`<div class="role-heads-grid">${tiles||empty('No civil engineering jobs yet','Verified opportunities will appear here.')}</div>`;
    $('privateCount').textContent='Select a category to browse jobs';
    bindCards();
    return;
  }

  // Filter by selected category
  const head=ROLE_HEADS.find(h=>h.id===activePrivateCategory)||ROLE_HEADS.at(-1);
  a=a.filter(j=>classifyJob(j)===activePrivateCategory);

  $('privateCount').textContent=`${a.length} ${head.label} job${a.length===1?'':'s'}`;

  const backBtn=`<button class="category-back" onclick="activePrivateCategory='';renderPrivate()">← All Categories</button>`;
  $('privateJobs').innerHTML=backBtn+(a.length?a.map(x=>jobCard(x)).join(''):empty('No jobs in this category','Check back soon or browse another category.'));
  bindCards();
}

function renderGovernment(){
  let a=jobs.filter(j=>['Government','Public Sector'].includes(j.sector));

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

  $('governmentCount').textContent=`${a.length} Karnataka government opportunit${a.length===1?'y':'ies'}`;

  // Group by recruitment authority
  const groups={};
  a.forEach(j=>{
    const auth=j.recruitment_authority||j.company||'Other';
    if(!groups[auth])groups[auth]=[];
    groups[auth].push(j)
  });

  if(Object.keys(groups).length===0){
    $('governmentJobs').innerHTML=empty('No matching government recruitment','Verified Karnataka government opportunities will appear here as they are published.');
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
function renderExams(code=''){
  const a=exams.filter(x=>!code||x.code.toUpperCase().includes(code));
  $('examCards').innerHTML=a.length?a.map(examCard).join(''):empty('Exam updates are being added','Karnataka government examination details will appear here after source verification.');
  bindCards()
}
function renderMaterials(cat=''){
  const a=materials.filter(m=>!cat||String(m.category).includes(cat)||String(m.exam_code).includes(cat));
  $('materialCards').innerHTML=a.length?a.map(materialCard).join(''):empty('Resources are being added','Free civil engineering and Karnataka competitive-exam materials will appear here as they are published.');
  bindCards()
}
function openJob(j){
  if(!j)return;
  const gov=['Government','Public Sector'].includes(j.sector),closed=isClosed(j);
  $('detailTitle').textContent=j.role;
  $('detailBody').innerHTML=`<div class="detail-grid"><div class="detail"><b>${gov?'Organization':'Company'}</b>${esc(j.company||'Check original source')}</div><div class="detail"><b>Location</b>${esc(j.location||'Check original source')}</div><div class="detail"><b>Qualification</b>${esc(j.qualification||'Check official notification for the latest details.')}</div><div class="detail"><b>Experience</b>${esc(j.experience_level||'Not specified')}</div><div class="detail"><b>Employment type</b>${esc(j.employment_type||'Not specified')}</div><div class="detail"><b>${gov?'Pay scale':'Salary'}</b>${esc(j.salary||'Not provided')}</div>${gov?`<div class="detail"><b>Vacancies</b>${esc(j.vacancy_count||'Check official notification')}</div><div class="detail"><b>Age limit</b>${esc(j.age_limit||'Check official notification')}</div><div class="detail"><b>Application fee</b>${esc(j.application_fee||'Check official notification')}</div><div class="detail"><b>Application starts</b>${date(j.application_start)}</div>`:''}<div class="detail"><b>Application deadline</b>${j.deadline?date(j.deadline):'Check original source'}</div><div class="detail"><b>Status</b>${closed?'Application Closed':j.status||'Active'}</div><div class="detail full"><b>Description</b>${esc(j.description||'Check the original source for complete details.')}</div><div class="detail full"><b>Application method</b>${esc(j.application_method||'Use the original source')}</div></div><div class="card-actions">${j.source_url?`<a href="${esc(j.source_url)}" target="_blank" rel="noopener">${gov?'View Official Notification':'View Original Job'} ↗</a>`:''}${j.last_verified?`<span class="verified-date">Last verified: ${date(j.last_verified)}</span>`:''}</div>`;
  navigate('examDetail');
}
function richText(v){return esc(v||'').replace(/\n/g,'<br>')}
function examSection(title,value){return value?`<section class="exam-detail-section"><h3>${esc(title)}</h3><div class="exam-detail-copy">${richText(value)}</div></section>`:''}
function openExam(x){
  if(!x)return;
  const title=lang==='kn'&&x.title_kn?x.title_kn:x.title_en,closed=x.application_end&&new Date(x.application_end+'T23:59:59')<new Date();
  $('detailTitle').textContent=title;
  $('detailBody').innerHTML=`<article class="exam-detail-page"><div class="exam-detail-status"><span class="pill ${closed?'closed':'verified'}">${closed?'Application Closed':esc(x.status||'Open')}</span>${x.last_verified?`<span>Last verified ${date(x.last_verified)}</span>`:''}</div>${x.overview?`<p class="exam-intro">${richText(x.overview)}</p>`:''}<section class="exam-detail-section"><h3>Recruitment Overview</h3><div class="exam-overview"><div><b>Organization</b>${esc(x.authority||'Check official notification')}</div><div><b>Notification number</b>${esc(x.notification_number||'Not stated')}</div><div><b>Post names</b>${esc(x.post_names||x.code||'See official notification')}</div><div><b>Total vacancies</b>${esc(x.vacancy_count||'Not stated')}</div><div><b>Qualification</b>${esc(lang==='kn'&&x.eligibility_kn?x.eligibility_kn:x.eligibility_en||'See official notification')}</div><div><b>Job location</b>${esc(x.job_location||'Karnataka')}</div><div><b>Application mode</b>${esc(x.application_mode||'See official notification')}</div><div><b>Last date to apply</b>${date(x.application_end)}</div></div></section>${examSection('Important Dates',x.important_dates_details||[['Application start',date(x.application_start)],['Application deadline',date(x.application_end)],['Exam date',date(x.exam_date)]].map(a=>a.join(': ')).join('\n'))}${examSection('Post-wise Vacancy Details',x.vacancy_breakdown)}${examSection('Eligibility and Qualification',lang==='kn'&&x.eligibility_kn?x.eligibility_kn:x.eligibility_en)}${examSection('Age Limit and Relaxation',x.age_limit)}${examSection('Pay Scale',x.pay_scale)}${examSection('Application Fees',x.application_fee)}${examSection('Selection Procedure',x.selection_process)}${examSection('Exam Pattern',x.exam_pattern)}${examSection('Syllabus',x.syllabus)}${examSection('How to Apply',x.how_to_apply)}${examSection('Attempts',x.attempts)}${examSection('Physical Standards',x.physical_standards)}${examSection('Helpline',x.helpline)}${examSection('Other Important Information',x.other_information)}${examSection('Frequently Asked Questions',x.frequently_asked_questions)}<section class="exam-detail-section official-links"><h3>Important Official Links</h3><div class="card-actions">${x.apply_url?`<a href="${esc(x.apply_url)}" target="_blank" rel="noopener">Apply on Official Portal ↗</a>`:''}${x.official_notification_url?`<a href="${esc(x.official_notification_url)}" target="_blank" rel="noopener">Download Official Notification ↗</a>`:''}${x.official_website_url?`<a href="${esc(x.official_website_url)}" target="_blank" rel="noopener">Official Website ↗</a>`:''}</div></section><div class="callout"><b>We Organize. You Verify.</b><br>CivilCareer is independent and is not a government authority. Read the official notification before applying or paying an official application fee.</div></article>`;
  navigate('examDetail');
}
function openMaterial(m){
  $('detailTitle').textContent=lang==='kn'&&m.title_kn?m.title_kn:m.title_en;
  $('detailBody').innerHTML=`<p>${esc(m.description_en||'Open the resource to review its contents.')}</p><div class="callout">Only use materials shared by their owner or with appropriate permission.</div><div class="card-actions"><a href="${esc(m.file_url)}" target="_blank" rel="noopener">Open Resource ↗</a></div>`;
  navigate('examDetail');
}
function animateCount(el,target,duration=1500){
  if(!el)return;
  let start=0;const step=target/(duration/16);
  const timer=setInterval(()=>{
    start+=step;
    if(start>=target){el.textContent=target+'+';clearInterval(timer);}
    else el.textContent=Math.floor(start)+'+';
  },16);
}
function updateStats(){
  const priv=jobs.filter(j=>(j.sector||'Private')==='Private').length;
  const govt=jobs.filter(j=>['Government','Public Sector'].includes(j.sector)).length;
  if(priv>0)animateCount($('statJobs'),priv);
  if(govt>0)animateCount($('statGovt'),govt);
  if(exams.length>0)animateCount($('statExams'),exams.length);
  if(materials.length>0)animateCount($('statRes'),materials.length);
  updateNavCounts();
}
function updateNavCounts(){
  const priv=jobs.filter(j=>(j.sector||'Private')==='Private').length;
  const govt=jobs.filter(j=>['Government','Public Sector'].includes(j.sector)).length;
  $$('a[data-route="private"]').forEach(a=>{if(priv>0)a.setAttribute('data-count',priv)});
  $$('a[data-route="government"]').forEach(a=>{if(govt>0)a.setAttribute('data-count',govt)});
  if($('statJobs'))$('statJobs').textContent=priv+'+';
  if($('statGovt'))$('statGovt').textContent=govt+'+';
  if($('statExams'))$('statExams').textContent=exams.length+'+';
  if($('statRes'))$('statRes').textContent=materials.length+'+';
}

/* ═══════════════════════════════════════════════════════════
   AI JOB AGENT — STAGE 1
   User Profile + Job Matching + For You Feed
══════════════════════════════════════════════════════════ */

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
  if(!userPrefs.target_roles&&!userPrefs.preferred_locations&&!userPrefs.skills_wanted)return null;
  let score=0,reasons=[],weaknesses=[];

  // Role match (25%)
  const targetRoles=(userPrefs.target_roles||'').toLowerCase().split(',').map(r=>r.trim()).filter(Boolean);
  const jobRole=(job.role||'').toLowerCase();
  if(targetRoles.length){
    const roleMatch=targetRoles.some(r=>jobRole.includes(r)||r.includes(jobRole.split(' ')[0]));
    if(roleMatch){score+=25;reasons.push('Role matches your target');}
    else{
      const partial=targetRoles.some(r=>jobRole.split(' ').some(w=>r.includes(w)&&w.length>3));
      if(partial){score+=12;reasons.push('Partial role match');}
      else weaknesses.push('Role differs from target');
    }
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
  const hasProfile=userPrefs.target_roles||userPrefs.preferred_locations;
  if(!hasProfile){
    container.innerHTML=`<div class="foryou-empty">
      <div class="foryou-icon">🎯</div>
      <h3>Set up your job profile</h3>
      <p>Tell us what you're looking for and we'll find the best matches for you.</p>
      <button class="btn primary" onclick="openProfileSetup()">Set Up Profile — Free</button>
    </div>`;
    return;
  }

  // Score all jobs
  const scored=jobs
    .filter(j=>!jobInteractions[j.id]||jobInteractions[j.id]==='saved')
    .map(j=>({...j,_match:matchScore(j)}))
    .filter(j=>j._match&&j._match.score>=50)
    .sort((a,b)=>b._match.score-a._match.score)
    .slice(0,20);

  if(!scored.length){
    container.innerHTML=`<div class="foryou-empty"><p>No strong matches yet. Add more jobs or update your profile.</p><button class="btn primary" onclick="openProfileSetup()">Update Profile</button></div>`;
    return;
  }

  container.innerHTML=scored.map(j=>matchJobCard(j,j._match)).join('');
  bindCards();
}

function matchJobCard(j,match){
  const color=match.score>=80?'#10b981':match.score>=60?'#f59e0b':'#6b7280';
  const saved=jobInteractions[j.id]==='saved';
  const ignored=jobInteractions[j.id]==='ignored';
  return `<article class="job-card match-card" style="border-top:3px solid ${color}">
    <div class="match-score-row">
      <span class="match-pct" style="color:${color}">${match.score}% Match</span>
      <span class="match-label">${match.score>=80?'🔥 Strong match':match.score>=60?'✅ Good match':'🔶 Partial match'}</span>
    </div>
    <h3>${esc(j.role||'Opportunity')}</h3>
    <div class="organization">${esc(j.company||'Organization')}</div>
    ${j.salary?`<div class="salary-badge">💰 ${esc(j.salary)}</div>`:''}
    <div class="card-meta">
      ${j.location?`<span>📍 ${esc(j.location)}</span>`:''}
      ${j.experience_level?`<span>⏱ ${esc(j.experience_level)}</span>`:''}
    </div>
    <div class="match-reasons">
      ${match.reasons.slice(0,3).map(r=>`<span class="reason-tag">✓ ${r}</span>`).join('')}
      ${match.weaknesses.slice(0,1).map(w=>`<span class="reason-tag weak">⚠ ${w}</span>`).join('')}
    </div>
    <div class="card-actions">
      <button data-job="${j.id}">View Details</button>
      <button class="btn-save ${saved?'saved':''}" onclick="trackJob('${j.id}','${saved?'unsave':'saved'}',this)">${saved?'★ Saved':'☆ Save'}</button>
      <button class="btn-apply" onclick="trackJob('${j.id}','applied',this);window.open('${esc(j.apply_url||j.source_url||'')}','_blank')">Apply →</button>
      <button class="btn-ignore" onclick="trackJob('${j.id}','ignored',this)">✕</button>
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
function openProfileSetup(){
  let overlay=$('profileOverlay');
  if(!overlay){
    overlay=document.createElement('div');
    overlay.id='profileOverlay';
    overlay.className='profile-overlay';
    overlay.onclick=e=>{if(e.target===overlay)closeProfileModal();};
    document.body.appendChild(overlay);
  }
  const prefs=userPrefs,prof=userProfile;
  overlay.innerHTML=`<div class="profile-modal-inner">
    <div class="profile-modal-header">
      <h2>🎯 Your Job Profile</h2>
      <button class="profile-close" onclick="document.getElementById('profileModal').close()">✕</button>
    </div>
    <div class="profile-tabs">
      <button class="ptab active" onclick="showPTab('basics',this)">👤 About Me</button>
      <button class="ptab" onclick="showPTab('prefs',this)">🎯 Preferences</button>
    </div>
    <div id="ptab-basics" class="ptab-content">
      <label>Your name<input id="pName" value="${esc(prof.name||'')}" placeholder="e.g. Modin Kumar"></label>
      <label>Current role<input id="pJobTitle" value="${esc(prof.job_title||'')}" placeholder="e.g. Planning Engineer"></label>
      <label>Years of experience<input id="pExp" type="number" value="${prof.experience_years||''}" placeholder="e.g. 5"></label>
      <label>Education<input id="pEdu" value="${esc(prof.education||'')}" placeholder="e.g. B.E. Civil Engineering"></label>
      <label>Your skills (comma separated)<textarea id="pSkills" placeholder="Primavera P6, AutoCAD, MS Project">${esc(prof.skills||'')}</textarea></label>
    </div>
    <div id="ptab-prefs" class="ptab-content" style="display:none">
      <label>Target job roles<input id="pTargetRoles" value="${esc(prefs.target_roles||'')}" placeholder="Planning Engineer, Site Engineer"></label>
      <label>Skills to match<input id="pSkillsWanted" value="${esc(prefs.skills_wanted||'')}" placeholder="Primavera, AutoCAD, MS Project"></label>
      <label>Preferred locations<input id="pLocations" value="${esc(prefs.preferred_locations||'')}" placeholder="Bengaluru, Hyderabad, Gulf"></label>
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
}
      <label>Years of experience<input id="pExp" type="number" min="0" max="50" value="${esc(prof.experience||'')}" placeholder="e.g. 2"></label>
      <label>Skills<textarea id="pSkills" placeholder="e.g. AutoCAD, Quantity Surveying, Estimation">${esc(prof.skills||'')}</textarea></label>
      <label>Qualification<input id="pQual" value="${esc(prof.qualification||'')}" placeholder="e.g. B.E. Civil Engineering"></label>
    </div>
    <div id="ptab-prefs" class="ptab-content" style="display:none">
      <label>Target roles<input id="pRoles" value="${esc(prefs.target_roles||'')}" placeholder="e.g. Site Engineer, Planning Engineer, QS"></label>
      <label>Preferred locations<input id="pLocations" value="${esc(prefs.preferred_locations||'')}" placeholder="e.g. Bengaluru, Mysuru, Karnataka"></label>
      <label>Preferred sector
        <select id="pSector">
          <option ${prefs.sectors==='Both'||!prefs.sectors?'selected':''}>Both</option>
          <option ${prefs.sectors==='Private'?'selected':''}>Private</option>
          <option ${prefs.sectors==='Government'?'selected':''}>Government</option>
        </select>
      </label>
      <label>Minimum experience<input id="pExpMin" type="number" min="0" value="${esc(prefs.experience_min||'')}" placeholder="0"></label>
      <label>Maximum experience<input id="pExpMax" type="number" min="0" value="${esc(prefs.experience_max||'')}" placeholder="20"></label>
      <label>Minimum salary<input id="pSalMin" type="number" min="0" value="${esc(prefs.salary_min||'')}" placeholder="e.g. 30000"></label>
      <p class="form-note">Your profile is stored locally in your browser. CivilCareer does not require payment to create a job profile.</p>
    </div>
    <div class="profile-modal-actions">
      <button class="btn secondary" onclick="closeProfileModal()">Cancel</button>
      <button class="btn primary" onclick="saveProfile()">Save Profile</button>
    </div>
  </div>`;
    overlay.style.display='flex';
    overlay.querySelector('.profile-modal-inner').id='profileModal';
  }
}

function closeProfileModal(){
  const overlay=$('profileOverlay');
  if(overlay)overlay.style.display='none';
}

function showPTab(tab,btn){
  $$('.ptab').forEach(x=>x.classList.remove('active'));
  $$('.ptab-content').forEach(x=>x.style.display='none');
  if(btn)btn.classList.add('active');
  const el=$('ptab-'+tab);
  if(el)el.style.display='block';
}

function saveProfile(){
  userProfile={
    name:$('pName')?.value.trim()||'',
    job_title:$('pJobTitle')?.value.trim()||'',
    experience:$('pExp')?.value||'',
    skills:$('pSkills')?.value.trim()||'',
    qualification:$('pQual')?.value.trim()||''
  };

  userPrefs={
    target_roles:$('pRoles')?.value.trim()||'',
    preferred_locations:$('pLocations')?.value.trim()||'',
    sectors:$('pSector')?.value||'Both',
    experience_min:$('pExpMin')?.value||'',
    experience_max:$('pExpMax')?.value||'',
    salary_min:$('pSalMin')?.value||'',
    skills_wanted:userProfile.skills
  };

  saveProfileLocal();
  closeProfileModal();
  renderForYou();
  toast('Your job profile has been saved.');
}

function renderProfileButton(){
  const el=$('profileButton');
  if(!el)return;

  if(userProfile.name||userPrefs.target_roles){
    el.textContent='🎯 My Job Profile';
  }else{
    el.textContent='🎯 Find Jobs For Me';
  }
}

function getMatchLabel(score){
  if(score>=80)return 'Strong match';
  if(score>=60)return 'Good match';
  if(score>=50)return 'Partial match';
  return 'Low match';
}

/* ═══════════════════════════════════════════════════════════
   ADMIN
══════════════════════════════════════════════════════════ */

function showAdmin(){
  const app=$('app');
  if(!app)return;

  app.innerHTML=`
    <section class="admin-page">
      <div class="admin-header">
        <div>
          <span class="eyebrow">CIVILCAREER ADMIN</span>
          <h1>Manage Opportunities</h1>
          <p>Add, verify and manage CivilCareer jobs and examination information.</p>
        </div>
        <div class="admin-actions">
          <button class="btn secondary" onclick="navigate('home')">← Back to Site</button>
          <button class="btn primary" onclick="adminAddJob()">＋ Add Job</button>
        </div>
      </div>

      <div class="admin-tabs">
        <button class="admin-tab active" onclick="adminTab('jobs',this)">Jobs</button>
        <button class="admin-tab" onclick="adminTab('exams',this)">Exams</button>
        <button class="admin-tab" onclick="adminTab('materials',this)">Materials</button>
      </div>

      <div id="adminContent"></div>
    </section>
  `;

  adminTab('jobs',$$('.admin-tab')[0]);
}

function adminTab(tab,btn){
  $$('.admin-tab').forEach(x=>x.classList.remove('active'));
  if(btn)btn.classList.add('active');

  const el=$('adminContent');
  if(!el)return;

  if(tab==='jobs'){
    el.innerHTML=`
      <div class="admin-toolbar">
        <input id="adminJobSearch" placeholder="Search jobs..." oninput="renderAdminJobs()">
        <select id="adminSectorFilter" onchange="renderAdminJobs()">
          <option value="">All sectors</option>
          <option value="Private">Private</option>
          <option value="Government">Government</option>
          <option value="Public Sector">Public Sector</option>
        </select>
      </div>
      <div id="adminJobList"></div>
    `;
    renderAdminJobs();
  }else if(tab==='exams'){
    el.innerHTML=`
      <div class="admin-toolbar">
        <button class="btn primary" onclick="adminAddExam()">＋ Add Exam</button>
      </div>
      <div id="adminExamList"></div>
    `;
    renderAdminExams();
  }else{
    el.innerHTML=`
      <div class="admin-toolbar">
        <button class="btn primary" onclick="adminAddMaterial()">＋ Add Material</button>
      </div>
      <div id="adminMaterialList"></div>
    `;
    renderAdminMaterials();
  }
}

function renderAdminJobs(){
  const el=$('adminJobList');
  if(!el)return;

  const q=($('adminJobSearch')?.value||'').toLowerCase();
  const sector=$('adminSectorFilter')?.value||'';

  const list=jobs.filter(j=>{
    const text=JSON.stringify(j).toLowerCase();
    return (!q||text.includes(q))&&(!sector||j.sector===sector);
  });

  if(!list.length){
    el.innerHTML=empty('No jobs found','Add a verified opportunity to begin.');
    return;
  }

  el.innerHTML=list.map(j=>`
    <article class="admin-row">
      <div class="admin-row-main">
        <h3>${esc(j.role||'Untitled Job')}</h3>
        <p>${esc(j.company||'Organization')} · ${esc(j.location||'Location not specified')}</p>
        <div class="admin-row-meta">
          <span>${esc(j.sector||'Private')}</span>
          <span>${esc(j.status||'Active')}</span>
          ${j.deadline?`<span>Deadline: ${date(j.deadline)}</span>`:''}
        </div>
      </div>
      <div class="admin-row-actions">
        <button onclick="adminEditJob('${esc(j.id)}')">Edit</button>
        <button onclick="adminDeleteJob('${esc(j.id)}')">Delete</button>
      </div>
    </article>
  `).join('');
}

function renderAdminExams(){
  const el=$('adminExamList');
  if(!el)return;

  if(!exams.length){
    el.innerHTML=empty('No exams found','Add a verified Karnataka examination.');
    return;
  }

  el.innerHTML=exams.map(x=>`
    <article class="admin-row">
      <div class="admin-row-main">
        <h3>${esc(x.title_en||x.code||'Exam')}</h3>
        <p>${esc(x.authority||'Authority not specified')} · ${esc(x.code||'')}</p>
        <div class="admin-row-meta">
          <span>${esc(x.status||'Open')}</span>
          ${x.application_end?`<span>Last date: ${date(x.application_end)}</span>`:''}
        </div>
      </div>
      <div class="admin-row-actions">
        <button onclick="adminEditExam('${esc(x.id||x.code||'')}')">Edit</button>
      </div>
    </article>
  `).join('');
}

function renderAdminMaterials(){
  const el=$('adminMaterialList');
  if(!el)return;

  if(!materials.length){
    el.innerHTML=empty('No materials found','Add a study resource when you have a verified source.');
    return;
  }

  el.innerHTML=materials.map(m=>`
    <article class="admin-row">
      <div class="admin-row-main">
        <h3>${esc(m.title_en||'Study Material')}</h3>
        <p>${esc(m.category||'General')} · ${esc(m.exam_code||'')}</p>
      </div>
      <div class="admin-row-actions">
        <button onclick="adminEditMaterial('${esc(m.id||'')}')">Edit</button>
      </div>
    </article>
  `).join('');
}

function adminAddJob(){
  jobEditor({
    sector:'Private',
    role_category:'',
    role:'',
    company:'',
    recruitment_authority:'',
    location:'',
    state:'',
    discipline:'Civil Engineering',
    qualification:'',
    experience_level:'',
    employment_type:'',
    salary:'',
    salary_min:'',
    salary_max:'',
    vacancy_count:'',
    application_start:'',
    deadline:'',
    age_limit:'',
    application_fee:'',
    status:'Active',
    last_verified:new Date().toISOString().slice(0,10),
    featured:false,
    description:'',
    skills:'',
    application_method:'',
    apply_url:'',
    source_url:''
  });
}

function adminEditJob(id){
  const j=jobs.find(x=>String(x.id)===String(id));
  if(!j){
    toast('Job not found.');
    return;
  }
  jobEditor(j);
}

async function adminDeleteJob(id){
  if(!confirm('Delete this job?'))return;

  try{
    await api('/api/jobs',{
      method:'DELETE',
      key:adminKey,
      body:JSON.stringify({id})
    });

    jobs=jobs.filter(j=>String(j.id)!==String(id));
    renderAdminJobs();
    updateStats();
    toast('Job deleted.');
  }catch(err){
    console.error(err);
    toast(err.message||'Could not delete job.');
  }
}

function adminAddExam(){
  examEditor({
    code:'',
    title_en:'',
    title_kn:'',
    authority:'',
    notification_number:'',
    post_names:'',
    vacancy_count:'',
    eligibility_en:'',
    eligibility_kn:'',
    job_location:'Karnataka',
    application_mode:'',
    application_start:'',
    application_end:'',
    exam_date:'',
    status:'Open',
    overview:'',
    vacancy_breakdown:'',
    age_limit:'',
    pay_scale:'',
    application_fee:'',
    selection_process:'',
    exam_pattern:'',
    syllabus:'',
    how_to_apply:'',
    attempts:'',
    physical_standards:'',
    helpline:'',
    other_information:'',
    frequently_asked_questions:'',
    apply_url:'',
    official_notification_url:'',
    official_website_url:'',
    last_verified:new Date().toISOString().slice(0,10)
  });
}

function adminEditExam(id){
  const x=exams.find(e=>String(e.id||e.code)===String(id));
  if(!x){
    toast('Exam not found.');
    return;
  }
  examEditor(x);
}

function adminAddMaterial(){
  materialEditor({
    title_en:'',
    title_kn:'',
    category:'Civil Engineering',
    exam_code:'',
    description_en:'',
    file_url:'',
    last_verified:new Date().toISOString().slice(0,10)
  });
}

function adminEditMaterial(id){
  const m=materials.find(x=>String(x.id)===String(id));
  if(!m){
    toast('Material not found.');
    return;
  }
  materialEditor(m);
}

/* ═══════════════════════════════════════════════════════════
   JOB IMPORTER
══════════════════════════════════════════════════════════ */

async function importJobLink(){
  const url=$('importUrl')?.value.trim()||'';
  const text=$('importText')?.value.trim()||'';
  const btn=$('importBtn');

  if(!url&&!text){
    toast('Paste a job URL or vacancy text first.');
    return;
  }

  if(btn){
    btn.disabled=true;
    btn.textContent='Extracting…';
  }

  try{
    const data=await api('/api/extract',{
      method:'POST',
      key:adminKey,
      body:JSON.stringify({url,text})
    });

    // /api/extract now returns { extracted: {...}, source: "groq" }.
    // Keep data.job as a backward-compatible fallback.
    const ai=data.extracted||data.job||{};

    if(!Object.keys(ai).length){
      throw new Error('AI returned no extracted fields.');
    }

    // Normalize the AI response to the exact fields used by the live job editor.
    const x={
      role:ai.role||'',
      role_category:ai.role_category||'',
      company:ai.company||'',
      recruitment_authority:ai.recruitment_authority||'',
      location:ai.location||'',
      state:ai.state||'',
      discipline:ai.discipline||'',
      qualification:ai.qualification||'',
      experience_level:ai.experience_level||'',
      employment_type:ai.employment_type||'',
      salary:ai.salary||'',
      salary_min:ai.salary_min??'',
      salary_max:ai.salary_max??'',
      vacancy_count:ai.vacancy_count??'',
      application_start:ai.application_start||'',
      deadline:ai.deadline||'',
      age_limit:ai.age_limit||'',
      application_fee:ai.application_fee||'',
      description:ai.description||'',
      skills:ai.skills||'',
      application_method:ai.application_method||'',
      apply_url:ai.apply_url||ai.application_url||'',
      source_url:ai.source_url||url||'',
      last_verified:new Date().toISOString().slice(0,10),
      status:'Active'
    };

    x.application_start=(x.application_start||'').slice(0,10);
    x.deadline=(x.deadline||'').slice(0,10);

    const mode=
      data.source==='groq'
        ?'Groq AI extraction complete.'
        :data.mode==='ai'
          ?'AI-assisted extraction complete.'
          :data.mode==='structured'
            ?'Public page data extracted.'
            :'Vacancy data organized.';

    toast(mode);
    jobEditor(x);

  }catch(err){
    console.error('CivilCareer job extraction failed:',err);
    toast(err.message||'Could not extract job information.');
  }finally{
    if(btn){
      btn.disabled=false;
      btn.textContent='✨ Import & Extract';
    }
  }
}
       source_url:ai.source_url||url||'',
       last_verified:new Date().toISOString().slice(0,10),
       status:'Active'
     };

     x.application_start=(x.application_start||'').slice(0,10);
     x.deadline=(x.deadline||'').slice(0,10);

     const mode=
       data.source==='groq'
         ?'Groq AI extraction complete.'
         :data.mode==='ai'
           ?'AI-assisted extraction complete.'
           :data.mode==='structured'
             ?'Public page data extracted.'
             :'Vacancy data organized.';

     importStatus('importJobStatus',mode,'success');
     jobEditor(x);

   }catch(err){
     console.error('CivilCareer job extraction failed:',err);
     importStatus(
       'importJobStatus',
       err.message||'Could not extract job information.',
       'error'
     );
   }finally{
     btn.disabled=false;
     btn.textContent='✨ Import & Extract';
   }
 }
