
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
const $=id=>document.getElementById(id),$$=s=>[...document.querySelectorAll(s)],esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let jobs=[],exams=[],materials=[],route='home',adminKey='',lang=localStorage.getItem('cc_lang')||'en';
function getSaved(){return new Set(JSON.parse(localStorage.getItem('cc_saved')||'[]'))}
function toggleSave(id){const s=getSaved();s.has(id)?s.delete(id):s.add(id);localStorage.setItem('cc_saved',JSON.stringify([...s]))}
const pathRoute={'/':'home','/for-you':'foryou','/private-jobs':'private','/government-jobs':'government','/exams':'exams','/study-materials':'materials','/post-a-job':'post','/submit-resource':'resource','/report':'report','/about':'about','/search':'search','/admin':'admin'};const routePath=Object.fromEntries(Object.entries(pathRoute).map(([a,b])=>[b,a]));
const kn={'Private Jobs':'ಖಾಸಗಿ ಉದ್ಯೋಗಗಳು','Govt Civil Jobs':'ಸರ್ಕಾರಿ ಸಿವಿಲ್ ಉದ್ಯೋಗಗಳು','Exams':'ಪರೀಕ್ಷೆಗಳು','Study Materials':'ಅಧ್ಯಯನ ಸಾಮಗ್ರಿಗಳು','Post a Job':'ಉದ್ಯೋಗ ಪ್ರಕಟಿಸಿ','Submit Resource':'ಸಂಪನ್ಮೂಲ ಸಲ್ಲಿಸಿ','About':'ನಮ್ಮ ಬಗ್ಗೆ','Safety:':'ಸುರಕ್ಷತೆ:','Never pay for a job. Always verify the original notification.':'ಉದ್ಯೋಗಕ್ಕಾಗಿ ಎಂದಿಗೂ ಹಣ ಪಾವತಿಸಬೇಡಿ. ಮೂಲ ಅಧಿಕೃತ ಅಧಿಸೂಚನೆಯನ್ನು ಸದಾ ಪರಿಶೀಲಿಸಿ.','Civil Engineering Careers + Karnataka Government Jobs':'ಸಿವಿಲ್ ಎಂಜಿನಿಯರಿಂಗ್ ವೃತ್ತಿಗಳು + ಕರ್ನಾಟಕ ಸರ್ಕಾರಿ ಉದ್ಯೋಗಗಳು','Build Your Career.':'ನಿಮ್ಮ ವೃತ್ತಿಜೀವನವನ್ನು ರೂಪಿಸಿಕೊಳ್ಳಿ.','Find Your Opportunity.':'ನಿಮ್ಮ ಅವಕಾಶವನ್ನು ಕಂಡುಕೊಳ್ಳಿ.','Civil engineering jobs across India and beyond. Karnataka government jobs and exams across departments. Trusted resources, organized in one place.':'ಭಾರತ ಮತ್ತು ವಿದೇಶಗಳ ಸಿವಿಲ್ ಎಂಜಿನಿಯರಿಂಗ್ ಉದ್ಯೋಗಗಳು, ಕರ್ನಾಟಕ ಸರ್ಕಾರಿ ಉದ್ಯೋಗಗಳು ಮತ್ತು ಪರೀಕ್ಷೆಗಳು ಹಾಗೂ ವಿಶ್ವಾಸಾರ್ಹ ಅಧ್ಯಯನ ಸಂಪನ್ಮೂಲಗಳು — ಒಂದೇ ಸ್ಥಳದಲ್ಲಿ.','Find Civil Engineering Jobs':'ಸಿವಿಲ್ ಎಂಜಿನಿಯರಿಂಗ್ ಉದ್ಯೋಗಗಳನ್ನು ಹುಡುಕಿ','Explore Govt Civil Jobs':'ಸರ್ಕಾರಿ ಸಿವಿಲ್ ಉದ್ಯೋಗಗಳನ್ನು ಅನ್ವೇಷಿಸಿ','Explore CivilCareer':'CivilCareer ಅನ್ವೇಷಿಸಿ','Focused paths. Reliable starting points.':'ಕೇಂದ್ರೀಕೃತ ಮಾರ್ಗಗಳು. ವಿಶ್ವಾಸಾರ್ಹ ಆರಂಭ.','Civil Engineering Jobs':'ಸಿವಿಲ್ ಎಂಜಿನಿಯರಿಂಗ್ ಉದ್ಯೋಗಗಳು','Government Civil Jobs':'ಸರ್ಕಾರಿ ಸಿವಿಲ್ ಉದ್ಯೋಗಗಳು','Government Exams':'ಸರ್ಕಾರಿ ಪರೀಕ್ಷೆಗಳು','Free Study Materials':'ಉಚಿತ ಅಧ್ಯಯನ ಸಾಮಗ್ರಿಗಳು','We Organize.':'ನಾವು ಕ್ರಮಬದ್ಧಗೊಳಿಸುತ್ತೇವೆ.','You Verify.':'ನೀವು ಪರಿಶೀಲಿಸುತ್ತೀರಿ.','We Organize. You Verify.':'ನಾವು ಕ್ರಮಬದ್ಧಗೊಳಿಸುತ್ತೇವೆ. ನೀವು ಪರಿಶೀಲಿಸುತ್ತೀರಿ.','Latest opportunities':'ಇತ್ತೀಚಿನ ಅವಕಾಶಗಳು','Public recruitment':'ಸರ್ಕಾರಿ ನೇಮಕಾತಿ','Important dates':'ಮುಖ್ಯ ದಿನಾಂಕಗಳು','Closing soon':'ಶೀಘ್ರ ಮುಕ್ತಾಯ','Examination updates':'ಪರೀಕ್ಷಾ ಮಾಹಿತಿ','Learning library':'ಅಧ್ಯಯನ ಗ್ರಂಥಾಲಯ','Trust and safety':'ವಿಶ್ವಾಸ ಮತ್ತು ಸುರಕ್ಷತೆ','Never pay for a job':'ಉದ್ಯೋಗಕ್ಕಾಗಿ ಎಂದಿಗೂ ಹಣ ಪಾವತಿಸಬೇಡಿ','Verify the notification':'ಅಧಿಸೂಚನೆಯನ್ನು ಪರಿಶೀಲಿಸಿ','Protect personal information':'ವೈಯಕ್ತಿಕ ಮಾಹಿತಿಯನ್ನು ರಕ್ಷಿಸಿ','For employers':'ಉದ್ಯೋಗದಾತರಿಗೆ','Reach civil engineering professionals.':'ಸಿವಿಲ್ ಎಂಜಿನಿಯರಿಂಗ್ ವೃತ್ತಿಪರರನ್ನು ತಲುಪಿ.','Post a Civil Engineering Job':'ಸಿವಿಲ್ ಎಂಜಿನಿಯರಿಂಗ್ ಉದ್ಯೋಗ ಪ್ರಕಟಿಸಿ','Private-sector opportunities':'ಖಾಸಗಿ ವಲಯದ ಅವಕಾಶಗಳು','Government civil recruitment':'ಸರ್ಕಾರಿ ಸಿವಿಲ್ ನೇಮಕಾತಿ','All departments. Multiple qualifications. One place to start.':'ಎಲ್ಲಾ ಇಲಾಖೆಗಳು. ಹಲವು ಅರ್ಹತೆಗಳು. ಒಂದೇ ಆರಂಭಿಕ ಸ್ಥಳ.','Dates, eligibility and official sources':'ದಿನಾಂಕಗಳು, ಅರ್ಹತೆ ಮತ್ತು ಅಧಿಕೃತ ಮೂಲಗಳು','Civil Engineering Exams':'ಸಿವಿಲ್ ಎಂಜಿನಿಯರಿಂಗ್ ಪರೀಕ್ಷೆಗಳು','Open learning library':'ಮುಕ್ತ ಅಧ್ಯಯನ ಗ್ರಂಥಾಲಯ','Prepare smarter with organized resources for civil engineering and competitive examinations.':'ಸಿವಿಲ್ ಎಂಜಿನಿಯರಿಂಗ್ ಮತ್ತು ಸ್ಪರ್ಧಾತ್ಮಕ ಪರೀಕ್ಷೆಗಳ ಕ್ರಮಬದ್ಧ ಸಂಪನ್ಮೂಲಗಳೊಂದಿಗೆ ಪರಿಣಾಮಕಾರಿಯಾಗಿ ಸಿದ್ಧರಾಗಿ.','Search':'ಹುಡುಕಿ','Location':'ಸ್ಥಳ','Browse Civil Jobs →':'ಸಿವಿಲ್ ಉದ್ಯೋಗಗಳನ್ನು ನೋಡಿ →','Browse Government Jobs →':'ಸರ್ಕಾರಿ ಉದ್ಯೋಗಗಳನ್ನು ನೋಡಿ →','Explore Exams →':'ಪರೀಕ್ಷೆಗಳನ್ನು ನೋಡಿ →','Start Learning →':'ಅಧ್ಯಯನ ಪ್ರಾರಂಭಿಸಿ →','Report Suspicious Content':'ಶಂಕಿತ ವಿಷಯವನ್ನು ವರದಿ ಮಾಡಿ','Submit for Review':'ಪರಿಶೀಲನೆಗೆ ಸಲ್ಲಿಸಿ','Report a Problem':'ಸಮಸ್ಯೆಯನ್ನು ವರದಿ ಮಾಡಿ','Submit a Study Resource':'ಅಧ್ಯಯನ ಸಂಪನ್ಮೂಲ ಸಲ್ಲಿಸಿ'};
function translate(root=document){root.querySelectorAll('*').forEach(el=>{if(el.id==='language'||el.children.length)return;if(!el.dataset.en)el.dataset.en=el.textContent.trim();if(kn[el.dataset.en])el.textContent=lang==='kn'?kn[el.dataset.en]:el.dataset.en});$('language').textContent=lang==='kn'?'EN':'KN';document.documentElement.lang=lang==='kn'?'kn':'en'}
function toast(msg){const x=$('toast');x.textContent=msg;x.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>x.classList.remove('show'),2800)}function device(){const w=innerWidth;return w<600?'Mobile':w<1000?'Tablet':'Desktop'}function visitor(){let id=localStorage.getItem('cc_vid');if(!id){id=crypto.randomUUID();localStorage.setItem('cc_vid',id)}return id}async function api(url,opt={}){const r=await fetch(url,{...opt,headers:{'content-type':'application/json',...(opt.key?{'x-owner-key':opt.key}:{}),...(opt.headers||{})}}),text=await r.text();let data={};try{data=text?JSON.parse(text):{}}catch{}if(!r.ok)throw Error(data.error||`Request failed (${r.status})`);return data}function track(type='pageview',label=''){api('/api/analytics',{method:'POST',body:JSON.stringify({visitor_id:visitor(),event_type:type,event_label:label,path:location.pathname,referrer:document.referrer,device_type:device()})}).catch(()=>{})}
function navigate(next,push=true){route=next in routePath?next:'home';$$('.page').forEach(p=>p.classList.toggle('active',p.dataset.page===route));$$('[data-route]').forEach(a=>a.classList.toggle('active',a.dataset.route===route));$('mainNav').classList.remove('open');$('menuBtn').setAttribute('aria-expanded','false');if(push&&location.pathname!==routePath[route])history.pushState({},'',routePath[route]);setMeta();scrollTo({top:0,behavior:'smooth'});if(route==='private')renderPrivate();if(route==='government')renderGovernment();if(route==='exams')renderExams();if(route==='materials')renderMaterials();if(route==='foryou')renderForYou();if(route==='admin')showAdmin();translate();track()}
const metas={home:["CivilCareer — India's Civil Engineering Career Platform","Civil engineering jobs, civil-focused Central and State government recruitment, MNC careers, competitive examinations and free study resources across India."],private:['Civil Engineering Jobs | CivilCareer','Private civil engineering jobs across India, including local employers, Indian companies, Indian MNCs and global engineering firms.'],government:['Government Civil Jobs | CivilCareer','Civil-focused Central and State government recruitment across India.'],exams:['Civil Engineering Exams | CivilCareer','Civil-focused government and competitive examinations across India, with official sources and important dates.'],materials:['Free Civil Engineering Study Materials | CivilCareer','Free civil engineering exam, interview, career, course, PDF and professional learning resources.'],post:['Post a Civil Engineering Job | CivilCareer','Submit a legitimate civil engineering job for moderation.'],resource:['Submit a Study Resource | CivilCareer','Submit a study resource you own or have permission to distribute.'],report:['Report a Problem | CivilCareer','Privately report suspicious, incorrect, expired or copyrighted content.'],about:['About CivilCareer','Learn about CivilCareer’s safety, accuracy and official-source principles.'],search:['Search CivilCareer','Search civil engineering jobs, Karnataka government recruitment, exams and resources.'],admin:['CivilCareer Admin','Protected CivilCareer administration.']};function setMeta(){const m=metas[route]||metas.home;document.title=m[0];document.querySelector('meta[name="description"]').content=m[1]}
function date(v){if(!v)return'Check official notification';const d=new Date(v+'T00:00:00');return isNaN(d)?v:d.toLocaleDateString(lang==='kn'?'kn-IN':'en-IN',{day:'numeric',month:'short',year:'numeric'})}function isClosed(j){return j.status==='Expired'||(j.deadline&&new Date(j.deadline+'T23:59:59')<new Date())}function short(v,n=150){v=String(v||'');return v.length>n?v.slice(0,n).trim()+'…':v}
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
function examCard(x){const closed=x.application_end&&new Date(x.application_end+'T23:59:59')<new Date(),title=lang==='kn'&&x.title_kn?x.title_kn:x.title_en,copy=x.overview||(lang==='kn'&&x.eligibility_kn?x.eligibility_kn:x.eligibility_en);const daysLeft=x.application_end&&!closed?Math.ceil((new Date(x.application_end+'T23:59:59')-new Date())/86400000):null;return `<article class="exam-card"><div class="card-top"><span class="pill ${closed?'closed':x.last_verified?'verified':''}">${closed?'Application Closed':x.status||'Update'}</span>${x.application_end?`<span class="verified-date">Deadline ${date(x.application_end)}</span>`:''}${daysLeft!==null?`<span class="countdown-badge ${daysLeft<=3?'urgent':''}">${daysLeft<=0?'Last day!':daysLeft+'d left'}</span>`:''}</div><h3>${esc(title)}</h3><div class="organization">${esc(x.authority||'Conducting authority')}${x.vacancy_count?` · ${esc(x.vacancy_count)} vacancies`:''}</div><p class="card-copy">${esc(short(copy||'Check the official notification for complete recruitment details.'))}</p><div class="card-actions"><button data-exam="${x.id}">View Complete Details</button>${x.official_notification_url?`<a href="${esc(x.official_notification_url)}" target="_blank" rel="noopener">Official PDF ↗</a>`:''}</div></article>`}
function materialCard(m){const title=lang==='kn'&&m.title_kn?m.title_kn:m.title_en;return `<article class="material-card"><div class="card-top"><span class="pill verified">${esc(m.access_type||'Free')}</span><span class="verified-date">${m.page_count?m.page_count+' pages':'Resource'}</span></div><h3>${esc(title)}</h3><div class="organization">${esc(m.category||m.exam_code||'Study resource')}</div><p class="card-copy">${esc(short(m.description_en||'Organized learning resource.'))}</p><div class="card-actions"><button data-material-id="${m.id}">Preview</button><a href="${esc(m.file_url)}" target="_blank" rel="noopener">Open Resource ↗</a></div></article>`}
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
}function empty(title,text){return `<div class="empty-state"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`}
function renderHome(){const live=typeof active==='function'?active:(j=>j.status!=='Expired'&&(!j.expires_at||new Date(j.expires_at)>new Date())&&(!j.deadline||new Date(j.deadline+'T23:59:59')>new Date()));const p=jobs.filter(j=>(j.sector||'Private')==='Private'&&live(j)).slice(0,3),g=jobs.filter(j=>['Government','Public Sector'].includes(j.sector)&&live(j)).slice(0,3);$('homePrivate').innerHTML=p.length?p.map(x=>jobCard(x)).join(''):empty('Opportunities are being added','Verified civil engineering jobs will appear here as they are published.');$('homeGovernment').innerHTML=g.length?g.map(x=>jobCard(x,true)).join(''):empty('Recruitment updates are being added','Civil-focused Central and State opportunities will appear here after verification.');const close=jobs.filter(j=>j.deadline&&!isClosed(j)).sort((a,b)=>a.deadline.localeCompare(b.deadline)).slice(0,4);$('closingSoon').innerHTML=close.length?close.map(j=>`<div class="compact-item"><div><b>${esc(j.role)}</b><span>${esc(j.company||j.location||'Opportunity')}</span></div><span>${date(j.deadline)}</span></div>`).join(''):'<div class="compact-item"><span>No active deadlines published.</span></div>';$('homeExams').innerHTML=exams.slice(0,4).map(x=>`<div class="compact-item"><div><b>${esc(x.code)} — ${esc(x.title_en)}</b><span>${esc(x.authority||'Examination update')}</span></div><span>${x.application_end?date(x.application_end):'Official dates'}</span></div>`).join('')||'<div class="compact-item"><span>Exam updates are being added.</span></div>';$('homeMaterials').innerHTML=materials.slice(0,3).map(materialCard).join('')||empty('Resources are being added','Free civil engineering, exam and working-professional resources will appear here as they are published.');bindCards();translate();renderUrgencyStrip();}

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
  a.forEach(j=>{const auth=j.recruitment_authority||j.company||'Other';if(!groups[auth])groups[auth]=[];groups[auth].push(j)});

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

function renderExams(code=''){const a=exams.filter(x=>!code||x.code.toUpperCase().includes(code));$('examCards').innerHTML=a.length?a.map(examCard).join(''):empty('Exam updates are being added','Karnataka government examination details will appear here after source verification.');bindCards()}
function renderMaterials(cat=''){const a=materials.filter(m=>!cat||String(m.category).includes(cat)||String(m.exam_code).includes(cat));$('materialCards').innerHTML=a.length?a.map(materialCard).join(''):empty('Resources are being added','Free civil engineering, exam and working-professional resources will appear here as they are published.');bindCards()}
function openJob(j){if(!j)return;const gov=['Government','Public Sector'].includes(j.sector),closed=isClosed(j);$('detailTitle').textContent=j.role;$('detailBody').innerHTML=`<div class="detail-grid"><div class="detail"><b>${gov?'Organization':'Company'}</b>${esc(j.company||'Check original source')}</div><div class="detail"><b>Location</b>${esc(j.location||'Check original source')}</div><div class="detail"><b>Qualification</b>${esc(j.qualification||'Check official notification for the latest details.')}</div><div class="detail"><b>Experience</b>${esc(j.experience_level||'Not specified')}</div><div class="detail"><b>Employment type</b>${esc(j.employment_type||'Not specified')}</div><div class="detail"><b>${gov?'Pay scale':'Salary'}</b>${esc(j.salary||'Not provided')}</div>${gov?`<div class="detail"><b>Vacancies</b>${esc(j.vacancy_count||'Check official notification')}</div><div class="detail"><b>Age limit</b>${esc(j.age_limit||'Check official notification')}</div><div class="detail"><b>Application fee</b>${esc(j.application_fee||'Check official notification')}</div><div class="detail"><b>Application starts</b>${date(j.application_start)}</div>`:''}<div class="detail"><b>Application deadline</b>${j.deadline?date(j.deadline):'Check original source'}</div><div class="detail"><b>Status</b>${closed?'Application Closed':j.status||'Active'}</div><div class="detail full"><b>Description</b>${esc(j.description||'Check the original source for complete details.')}</div><div class="detail full"><b>Application method</b>${esc(j.application_method||'Use the original source')}</div></div><div class="card-actions">${j.source_url?`<a href="${esc(j.source_url)}" target="_blank" rel="noopener">${gov?'View Official Notification':'View Original Job'} ↗</a>`:''}${j.last_verified?`<span class="verified-date">Last verified: ${date(j.last_verified)}</span>`:''}</div>`;navigate('examDetail');}
function richText(v){return esc(v||'').replace(/\n/g,'<br>')}function examSection(title,value){return value?`<section class="exam-detail-section"><h3>${esc(title)}</h3><div class="exam-detail-copy">${richText(value)}</div></section>`:''}
function openExam(x){if(!x)return;const title=lang==='kn'&&x.title_kn?x.title_kn:x.title_en,closed=x.application_end&&new Date(x.application_end+'T23:59:59')<new Date();$('detailTitle').textContent=title;$('detailBody').innerHTML=`<article class="exam-detail-page"><div class="exam-detail-status"><span class="pill ${closed?'closed':'verified'}">${closed?'Application Closed':esc(x.status||'Open')}</span>${x.last_verified?`<span>Last verified ${date(x.last_verified)}</span>`:''}</div>${x.overview?`<p class="exam-intro">${richText(x.overview)}</p>`:''}<section class="exam-detail-section"><h3>Recruitment Overview</h3><div class="exam-overview"><div><b>Organization</b>${esc(x.authority||'Check official notification')}</div><div><b>Notification number</b>${esc(x.notification_number||'Not stated')}</div><div><b>Post names</b>${esc(x.post_names||x.code||'See official notification')}</div><div><b>Total vacancies</b>${esc(x.vacancy_count||'Not stated')}</div><div><b>Qualification</b>${esc(lang==='kn'&&x.eligibility_kn?x.eligibility_kn:x.eligibility_en||'See official notification')}</div><div><b>Job location</b>${esc(x.job_location||'Karnataka')}</div><div><b>Application mode</b>${esc(x.application_mode||'See official notification')}</div><div><b>Last date to apply</b>${date(x.application_end)}</div></div></section>${examSection('Important Dates',x.important_dates_details||[['Application start',date(x.application_start)],['Application deadline',date(x.application_end)],['Exam date',date(x.exam_date)]].map(a=>a.join(': ')).join('\n'))}${examSection('Post-wise Vacancy Details',x.vacancy_breakdown)}${examSection('Eligibility and Qualification',lang==='kn'&&x.eligibility_kn?x.eligibility_kn:x.eligibility_en)}${examSection('Age Limit and Relaxation',x.age_limit)}${examSection('Pay Scale',x.pay_scale)}${examSection('Application Fees',x.application_fee)}${examSection('Selection Procedure',x.selection_process)}${examSection('Exam Pattern',x.exam_pattern)}${examSection('Syllabus',x.syllabus)}${examSection('How to Apply',x.how_to_apply)}${examSection('Attempts',x.attempts)}${examSection('Physical Standards',x.physical_standards)}${examSection('Helpline',x.helpline)}${examSection('Other Important Information',x.other_information)}${examSection('Frequently Asked Questions',x.frequently_asked_questions)}<section class="exam-detail-section official-links"><h3>Important Official Links</h3><div class="card-actions">${x.apply_url?`<a href="${esc(x.apply_url)}" target="_blank" rel="noopener">Apply on Official Portal ↗</a>`:''}${x.official_notification_url?`<a href="${esc(x.official_notification_url)}" target="_blank" rel="noopener">Download Official Notification ↗</a>`:''}${x.official_website_url?`<a href="${esc(x.official_website_url)}" target="_blank" rel="noopener">Official Website ↗</a>`:''}</div></section><div class="callout"><b>We Organize. You Verify.</b><br>CivilCareer is independent and is not a government authority. Read the official notification before applying or paying an official application fee.</div></article>`;navigate('examDetail');}
function openMaterial(m){if(typeof openMaterialDedicated==='function')return openMaterialDedicated(m);$('detailTitle').textContent=lang==='kn'&&m.title_kn?m.title_kn:m.title_en;$('detailBody').innerHTML=`<p>${esc(m.description_en||'Open the resource to review its contents.')}</p><div class="callout">Only use materials shared by their owner or with appropriate permission.</div><div class="card-actions"><a href="${esc(m.file_url||m.pdf_url||m.preview_url||'#')}" target="_blank" rel="noopener">Open Resource ↗</a></div>`;navigate('examDetail');}
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
  const isLive=typeof active==='function'?active:(j=>j.status!=='Expired'&&(!j.expires_at||new Date(j.expires_at)>new Date())&&(!j.deadline||new Date(j.deadline+'T23:59:59')>new Date()));
  const priv=jobs.filter(j=>(j.sector||'Private')==='Private'&&isLive(j)).length;
  const govt=jobs.filter(j=>['Government','Public Sector'].includes(j.sector)&&isLive(j)).length;
  $$('a[data-route="private"]').forEach(a=>{if(priv>0)a.setAttribute('data-count',priv)});
  $$('a[data-route="government"]').forEach(a=>{if(govt>0)a.setAttribute('data-count',govt)});
  if($('statJobs'))$('statJobs').textContent=String(priv);
  if($('statGovt'))$('statGovt').textContent=String(govt);
  if($('statExams'))$('statExams').textContent=String(exams.filter(x=>!(x.application_end&&new Date(x.application_end+'T23:59:59')<new Date())).length);
  if($('statRes'))$('statRes').textContent=String(materials.length);
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

async function handleMatFile(input){
  const file=input.files[0];
  if(!file)return;
  if(file.size>10*1024*1024){toast('File too large. Max 10MB.');input.value='';return;}
  $('matFileName').textContent=file.name;
  $('matUploadProgress').style.display='block';
  $('matUploadProgress').textContent='Reading file…';
  try{
    const base64=await new Promise((res,rej)=>{
      const r=new FileReader();
      r.onload=e=>res(e.target.result.split(',')[1]);
      r.onerror=rej;
      r.readAsDataURL(file);
    });
    $('matUploadProgress').textContent='Uploading to storage…';
    const resp=await api('/api/materials',{
      method:'POST',
      key:adminKey,
      body:JSON.stringify({_upload:true,file_name:file.name,file_data:base64,file_type:file.type})
    });
    if(resp.url){
      $('matFileUrl').value=resp.url;
      $('matUrlInput').value=resp.url;
      $('matUploadProgress').textContent='✅ Uploaded: '+file.name;
      $('matUploadProgress').style.color='#10b981';
    }
  }catch(e){
    $('matUploadProgress').textContent='Upload failed: '+e.message;
    $('matUploadProgress').style.color='#ef4444';
  }
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
    name:$('pName')?.value||'',
    job_title:$('pRole')?.value||'',
    experience_years:parseFloat($('pExp')?.value)||null,
    education:$('pEdu')?.value||'',
    skills:$('pSkills')?.value||''
  };
  userPrefs={
    ...userPrefs,
    target_roles:$('pTargetRoles')?.value||'',
    skills_wanted:$('pSkillsWanted')?.value||'',
    preferred_locations:$('pLocations')?.value||'',
    experience_min:parseFloat($('pExpMin')?.value)||null,
    experience_max:parseFloat($('pExpMax')?.value)||null,
    salary_min:parseFloat($('pSalMin')?.value)||null,
    sectors:$('pSector')?.value||'Both',
    keywords_exclude:$('pExclude')?.value||''
  };
  saveProfileLocal();
  $('editorDialog').close();
  toast('Profile saved! Finding your matches…');
  navigate('foryou');
  renderForYou();
}

async function loadData(){const [j,e,m]=await Promise.allSettled([api('/api/jobs'),api('/api/exams'),api('/api/materials')]);jobs=j.status==='fulfilled'?j.value.jobs||[]:[];exams=e.status==='fulfilled'?e.value.exams||[]:[];materials=m.status==='fulfilled'?m.value.materials||[]:[];renderHome();renderPrivate();renderGovernment();renderExams();renderMaterials();updateStats();updateNavCounts();renderForYou()}
function formObject(form){return Object.fromEntries(new FormData(form).entries())}function wireForm(id,url,transform=x=>x){const f=$(id);f.onsubmit=async e=>{e.preventDefault();const st=f.querySelector('.form-status');st.className='form-status show';st.textContent='Submitting securely…';try{let data=formObject(f);data=transform(data);await api(url,{method:'POST',body:JSON.stringify(data)});st.className='form-status show success';st.textContent='Thank you. Your submission is pending administrator review.';f.reset()}catch(err){st.className='form-status show error';st.textContent=err.message}}}
function search(q,loc=''){q=q.toLowerCase();loc=loc.toLowerCase();const results=[];jobs.forEach(j=>{if((!q||[j.role,j.company,j.description,j.discipline,j.qualification].join(' ').toLowerCase().includes(q))&&(!loc||String(j.location).toLowerCase().includes(loc)))results.push({type:['Government','Public Sector'].includes(j.sector)?'Government Job':'Civil Job',title:j.role,sub:j.company||j.location,action:`data-job="${j.id}"`})});exams.forEach(x=>{if(!q||[x.code,x.title_en,x.authority,x.post_names,x.notification_number,x.overview].join(' ').toLowerCase().includes(q))results.push({type:'Exam',title:`${x.code} — ${x.title_en}`,sub:x.authority,action:`data-exam="${x.id}"`})});materials.forEach(m=>{if(!q||[m.title_en,m.category,m.exam_code].join(' ').toLowerCase().includes(q))results.push({type:'Resource',title:m.title_en,sub:m.category,action:`data-material-id="${m.id}"`})});$('searchSummary').textContent=results.length?`${results.length} result${results.length===1?'':'s'} for “${q||'all content'}”`:'No matching results.';$('searchResults').innerHTML=results.length?results.slice(0,60).map(x=>`<article class="job-card"><span class="pill">${esc(x.type)}</span><h3>${esc(x.title)}</h3><p>${esc(x.sub||'')}</p><div class="card-actions"><button ${x.action}>View Details</button></div></article>`).join(''):empty('No results found','Try a different keyword, department or location.');bindCards();navigate('search');track('search','universal')}
async function showAdmin(){adminKey=sessionStorage.getItem('cc_admin')||'';$('adminGate').hidden=!!adminKey;$('adminDashboard').hidden=!adminKey;if(adminKey)await loadAdmin()}
async function loadAdmin(){
  try{
    // Use allSettled so a failing analytics/reports API never blocks the jobs list
    const [j,a,es,rs,re]=await Promise.allSettled([
      api('/api/jobs',{key:adminKey}),
      api('/api/analytics',{key:adminKey}),
      api('/api/employer-submissions',{key:adminKey}),
      api('/api/resource-submissions',{key:adminKey}),
      api('/api/reports',{key:adminKey})
    ]);

    // Jobs — always try to load these
    const jobsData = j.status==='fulfilled'?j.value:{};
    if(jobsData.jobs) jobs=jobsData.jobs;

    // Analytics — optional, don't crash if missing
    const an=(a.status==='fulfilled'?a.value.analytics:null)||{};
    if($('metrics'))$('metrics').innerHTML=[
      ['Visitors today',an.visitors_today],
      ['Unique visitors',an.unique_visitors],
      ['This week',an.visitors_week],
      ['This month',an.visitors_month],
      ['Page views',an.total_page_views],
      ['Open reports',(re.status==='fulfilled'?(re.value.reports||[]):[]).filter(x=>x.status==='Open').length]
    ].map(x=>`<div class="metric"><span>${x[0]}</span><b>${Number(x[1]||0).toLocaleString('en-IN')}</b></div>`).join('');
    if(typeof renderAnalytics==='function')renderAnalytics(an);

    // Submissions and reports — optional
    const empSubs  = es.status==='fulfilled'?es.value.submissions||[]:[];
    const resSubs  = rs.status==='fulfilled'?rs.value.submissions||[]:[];
    const reports  = re.status==='fulfilled'?re.value.reports||[]:[];
    renderAdminLists(empSubs,resSubs,reports);

  }catch(err){
    if($('adminLoginStatus')){
      $('adminLoginStatus').className='form-status show error';
      $('adminLoginStatus').textContent=err.message;
    }
    if(/owner key/i.test(err.message)){
      sessionStorage.removeItem('cc_admin');
      adminKey='';
      if($('adminGate'))$('adminGate').hidden=false;
      if($('adminDashboard'))$('adminDashboard').hidden=true;
    }
  }
}
function bars(rows,labelKey,valueKey){const max=Math.max(1,...rows.map(x=>Number(x[valueKey]||0)));return rows.length?rows.map(x=>`<div class="bar-row"><span>${esc(x[labelKey])}</span><div class="bar"><i style="width:${Math.max(3,Number(x[valueKey]||0)/max*100)}%"></i></div><b>${Number(x[valueKey]||0)}</b></div>`).join(''):'<p>No analytics data collected yet.</p>'}function renderAnalytics(a){$('analyticsPanel').innerHTML=`<div class="dash-card"><h3>Page views — last 7 days</h3>${bars(a.daily||[],'view_date','views')}</div><div class="dash-card"><h3>Devices</h3>${bars(a.devices||[],'device','visits')}</div><div class="dash-card"><h3>Top pages</h3>${bars(a.top_pages||[],'path','views')}</div><div class="dash-card"><h3>Traffic sources</h3>${bars(a.traffic_sources||[],'source','visits')}</div><div class="dash-card"><h3>Countries</h3>${bars(a.countries||[],'country','visits')}</div><div class="dash-card"><h3>Search activity</h3><p><strong>${Number(a.searches_month||0).toLocaleString('en-IN')}</strong> searches this month. Raw search terms are not stored for privacy.</p></div>`}
function adminRow(title,sub,actions){return `<div class="admin-list-item"><div><h4>${esc(title)}</h4><p>${esc(sub||'')}</p></div><div class="mini-actions">${actions}</div></div>`}function renderAdminLists(emp,res,reports){$('adminJobs').innerHTML=jobs.map(j=>adminRow(j.role,`${j.company||''} · ${j.sector||'Private'} · ${j.published?'Published':'Unpublished'}`,`<button data-edit-job="${j.id}">Edit</button><button data-toggle-job="${j.id}">${j.published?'Unpublish':'Publish'}</button><button data-delete-job="${j.id}">Delete</button>`)).join('')||empty('No jobs','Add the first verified opportunity.');$('adminExams').innerHTML=exams.map(x=>adminRow(`${x.code} — ${x.title_en}`,x.authority,`<button data-edit-exam="${x.id}">Edit</button><button data-delete-exam="${x.id}">Delete</button>`)).join('')||empty('No exams','Add an examination update.');$('adminMaterials').innerHTML=materials.map(m=>adminRow(m.title_en,m.category,`<button data-edit-material="${m.id}">Edit</button><button data-delete-material="${m.id}">Delete</button>`)).join('')||empty('No materials','Add a permitted resource.');$('adminSubmissions').innerHTML=`<h3>Employer submissions</h3>${emp.map(x=>adminRow(x.job_title,`${x.company_name} · ${x.status}`,`<button data-use-sub="${x.id}">Review</button><button data-sub-status="${x.id}" data-status="Rejected">Reject</button>`)).join('')||'<p>No employer submissions.</p>'}<h3>Resource submissions</h3>${res.map(x=>adminRow(x.title,`${x.category} · ${x.status}`,`<a href="${esc(x.resource_url)}" target="_blank">Open</a><button data-res-status="${x.id}" data-status="Approved">Approve</button><button data-res-status="${x.id}" data-status="Rejected">Reject</button>`)).join('')||'<p>No resource submissions.</p>'}`;$('adminReports').innerHTML=reports.map(x=>adminRow(x.report_type,`${x.status} · ${short(x.details,100)}`,`<button data-report-status="${x.id}" data-status="Resolved">Resolve</button><button data-report-status="${x.id}" data-status="Dismissed">Dismiss</button>`)).join('')||'<p>No reports.</p>';bindAdmin(emp)}
function bindAdmin(emp){$$('[data-edit-job]').forEach(b=>b.onclick=()=>jobEditor(jobs.find(x=>x.id===b.dataset.editJob)));$$('[data-toggle-job]').forEach(b=>b.onclick=async()=>{const j=jobs.find(x=>x.id===b.dataset.toggleJob);await api('/api/jobs',{method:'PATCH',key:adminKey,body:JSON.stringify({id:j.id,published:!j.published})});loadAdmin()});$$('[data-delete-job]').forEach(b=>b.onclick=()=>confirmDelete('/api/jobs',b.dataset.deleteJob));$$('[data-edit-exam]').forEach(b=>b.onclick=()=>examEditor(exams.find(x=>x.id===b.dataset.editExam)));$$('[data-delete-exam]').forEach(b=>b.onclick=()=>confirmDelete('/api/exams',b.dataset.deleteExam));$$('[data-edit-material]').forEach(b=>b.onclick=()=>materialEditor(materials.find(x=>x.id===b.dataset.editMaterial)));$$('[data-delete-material]').forEach(b=>b.onclick=()=>confirmDelete('/api/materials',b.dataset.deleteMaterial));$$('[data-use-sub]').forEach(b=>b.onclick=()=>{const x=emp.find(y=>y.id===b.dataset.useSub);jobEditor({role:x.job_title,company:x.company_name,location:x.location,description:x.description,experience_level:x.experience,qualification:x.qualification,employment_type:x.employment_type,salary:x.salary,application_method:x.application_method,source_url:x.official_url,contact_info:x.contact_info,sector:'Private',_submission:x.id})});$$('[data-sub-status]').forEach(b=>b.onclick=()=>status('/api/employer-submissions',b.dataset.subStatus,b.dataset.status));$$('[data-res-status]').forEach(b=>b.onclick=()=>status('/api/resource-submissions',b.dataset.resStatus,b.dataset.status));$$('[data-report-status]').forEach(b=>b.onclick=()=>status('/api/reports',b.dataset.reportStatus,b.dataset.status))}
async function status(url,id,status){await api(url,{method:'PATCH',key:adminKey,body:JSON.stringify({id,status})});toast('Status updated.');loadAdmin()}async function confirmDelete(url,id){if(!confirm('Delete this item permanently?'))return;await api(url,{method:'DELETE',key:adminKey,body:JSON.stringify({id})});toast('Item deleted.');await loadData();loadAdmin()}
function val(v){return esc(v||'')}function importStatus(id,message,type=''){const el=$(id);el.textContent=message;el.className=`form-status show ${type}`}
async function importJobLink(){const url=$('importJobUrl').value.trim(),text=$('importJobText').value.trim();if(!url&&!text)return importStatus('importJobStatus','Paste a vacancy URL, vacancy text, or both.','error');if(text&&text.length<8)return importStatus('importJobStatus','Please paste a longer vacancy sentence or description.','error');const btn=$('importJobBtn');btn.disabled=true;btn.textContent='Extracting…';importStatus('importJobStatus',text?'Analyzing the pasted vacancy text…':'Reading the public vacancy page…');try{const data=await api('/api/extract',{method:'POST',key:adminKey,body:JSON.stringify({url,text})}),x=data.job||{};x.source_url=x.source_url||url;x.posted_date=(x.posted_date||x.date_posted||'').slice(0,10);x.deadline=(x.deadline||x.valid_through||'').slice(0,10);x.last_verified=new Date().toISOString().slice(0,10);x.status='Active';delete x.date_posted;delete x.valid_through;const mode=data.mode==='ai'?'AI-assisted extraction complete.':data.mode==='structured'?'Public page data extracted.':'Pasted text organized with the free fallback extractor.';importStatus('importJobStatus',data.warning||`${mode} Verify every field before saving.`,'success');jobEditor(x)}catch(err){importStatus('importJobStatus',err.message,'error')}finally{btn.disabled=false;btn.textContent='Extract & fill fields'}}
async function pdfText(file){
  if(!window.pdfjsLib)throw Error('The PDF reader did not load. Refresh the page and try again.');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const bytes=new Uint8Array(await file.arrayBuffer()),doc=await window.pdfjsLib.getDocument({data:bytes}).promise;
  let text='';
  for(let pageNo=1;pageNo<=Math.min(doc.numPages,160);pageNo++){
    const page=await doc.getPage(pageNo),content=await page.getTextContent();
    text+=content.items.map(x=>x.str).join(' ')+'\n';
  }
  // If text is too short, it may be a scanned PDF — try OCR via Tesseract
  if(text.replace(/\s/g,'').length<100&&window.Tesseract){
    importStatus('importExamStatus','Scanned PDF detected. Running OCR — this may take 30–60 seconds…');
    let ocrText='';
    for(let pageNo=1;pageNo<=Math.min(doc.numPages,10);pageNo++){
      const page=await doc.getPage(pageNo),vp=page.getViewport({scale:2});
      const canvas=document.createElement('canvas');canvas.width=vp.width;canvas.height=vp.height;
      await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
      const result=await Tesseract.recognize(canvas,'eng');
      ocrText+=result.data.text+'\n';
    }
    return ocrText;
  }
  return text;
}
async function importExamPdf(){const file=$('importExamPdf').files[0];if(!file)return importStatus('importExamStatus','Select an official PDF first.','error');if(file.size>20*1024*1024)return importStatus('importExamStatus','Please use a PDF smaller than 20 MB.','error');const btn=$('importExamBtn');btn.disabled=true;btn.textContent='Reading…';importStatus('importExamStatus','Extracting text from the PDF…');try{const text=await pdfText(file);importStatus('importExamStatus','Organizing notification fields…');const data=await api('/api/exam-extract',{method:'POST',key:adminKey,body:JSON.stringify({text})});const x=data.exam||{};x.last_verified=new Date().toISOString().slice(0,10);importStatus('importExamStatus',data.warning||'Extraction complete. Verify every field.','success');examEditor(x)}catch(err){importStatus('importExamStatus',err.message,'error')}finally{btn.disabled=false;btn.textContent='Read PDF'}}
function jobEditor(j={}){
  const catOptions=ROLE_HEADS.map(h=>`<option value="${h.id}" ${classifyJob(j)===h.id?'selected':''}>${h.icon} ${h.label}</option>`).join('');
  $('editorTitle').textContent=j.id?'Edit opportunity':'Add opportunity';
  $('editorBody').innerHTML=`<form class="panel-form" id="jobEdit"><div class="field-grid">
    <label>Type<select name="sector"><option ${j.sector==='Private'?'selected':''}>Private</option><option ${j.sector==='Government'?'selected':''}>Government</option><option ${j.sector==='Public Sector'?'selected':''}>Public Sector</option></select></label>
    <label>Role category<select name="role_category">${catOptions}</select></label>
    <label>Job title<input name="role" value="${val(j.role)}" placeholder="e.g. Senior Planning Engineer"></label>
    <label>Company / organization<input name="company" value="${val(j.company)}"></label>
    <label>Recruitment authority<input name="recruitment_authority" value="${val(j.recruitment_authority)}" placeholder="e.g. KPSC, NHAI"></label>
    <label>Location<input name="location" value="${val(j.location)}"></label>
    <label>State<input name="state" value="${val(j.state)}"></label>
    <label>Department / civil discipline<input name="discipline" value="${val(j.discipline)}"></label>
    <label>Qualification<input name="qualification" value="${val(j.qualification)}"></label>
    <label>Experience<input name="experience_level" value="${val(j.experience_level)}" placeholder="e.g. 3-5 years"></label>
    <label>Employment type<input name="employment_type" value="${val(j.employment_type)}" placeholder="Full-time / Contract"></label>
    <label>Salary (text)<input name="salary" value="${val(j.salary)}" placeholder="e.g. ₹8-12 LPA"></label>
    <label>Min salary (₹)<input type="number" name="salary_min" value="${val(j.salary_min)}" placeholder="e.g. 800000"></label>
    <label>Max salary (₹)<input type="number" name="salary_max" value="${val(j.salary_max)}" placeholder="e.g. 1200000"></label>
    <label>Vacancy count<input type="number" name="vacancy_count" value="${val(j.vacancy_count)}"></label>
    <label>Application starts<input type="date" name="application_start" value="${val(j.application_start)}"></label>
    <label>Application deadline<input type="date" name="deadline" value="${val(j.deadline)}"></label>
    <label>Age limit<input name="age_limit" value="${val(j.age_limit)}"></label>
    <label>Application fee<input name="application_fee" value="${val(j.application_fee)}"></label>
    <label>Status<select name="status"><option value="Active" ${(j.status||'Active')==='Active'?'selected':''}>Active</option><option value="Draft" ${j.status==='Draft'?'selected':''}>Draft</option><option value="Closed" ${j.status==='Closed'?'selected':''}>Closed</option><option value="Expired" ${j.status==='Expired'?'selected':''}>Expired</option></select></label>
    <label>Last verified<input type="date" name="last_verified" value="${val(j.last_verified||new Date().toISOString().slice(0,10))}"></label>
    <label class="check"><input type="checkbox" name="featured" ${j.featured?'checked':''}> Featured</label>
    <label class="wide">Description<textarea name="description">${val(j.description)}</textarea></label>
    <label class="wide">Skills<input name="skills" value="${val(j.skills)}" placeholder="e.g. Primavera P6, AutoCAD, MS Project"></label>
    <label class="wide">Application method<input name="application_method" value="${val(j.application_method)}"></label>
    <label class="wide">Apply link (direct application URL)<input type="url" name="apply_url" value="${val(j.apply_url)}" placeholder="https://company.com/apply"></label>
    <label class="wide">Official source URL (for reference)<input type="url" name="source_url" value="${val(j.source_url)}" placeholder="https://..."></label>
    <button class="btn primary wide">Save opportunity</button>
  </div><div class="form-status"></div></form>`;
  openEditor();
  $('jobEdit').onsubmit=async e=>{
    e.preventDefault();
    const d=formObject(e.target);
    d.featured=e.target.featured.checked;
    d.published=true;
    if(!d.status)d.status='Active';
    if(j.id)d.id=j.id;
    try{
      await api('/api/jobs',{method:j.id?'PATCH':'POST',key:adminKey,body:JSON.stringify(d)});
      if(j._submission)await api('/api/employer-submissions',{method:'PATCH',key:adminKey,body:JSON.stringify({id:j._submission,status:'Approved'})});
      // Auto-post to Telegram for NEW jobs only (not edits)
      if(!j.id){
        try{
          const tgRes=await api('/api/telegram',{method:'POST',key:adminKey,body:JSON.stringify({job:d})});
          toast('✅ Job saved and posted to Telegram!');
        }catch(tgErr){
          toast('✅ Job saved. Telegram error: '+tgErr.message);
          console.error('Telegram error:',tgErr);
        }
      } else {
        toast('Opportunity updated.');
      }
      await loadData();loadAdmin();
    }catch(err){toast(err.message)}
  }
}
function examEditor(x={}){$('editorTitle').textContent=x.id?'Edit recruitment':'Review AI recruitment draft';$('editorBody').innerHTML=`<form class="panel-form" id="examEdit"><div class="field-grid"><label>Exam / recruitment code *<input name="code" value="${val(x.code)}" required></label><label>Authority / organization<input name="authority" value="${val(x.authority)}"></label><label class="wide">Professional listing title *<input name="title_en" value="${val(x.title_en)}" placeholder="KPSC KAS Recruitment 2026 — Apply Online for 319 Group A & B Posts" required></label><label class="wide">Kannada title<input name="title_kn" value="${val(x.title_kn)}"></label><label>Notification number<input name="notification_number" value="${val(x.notification_number)}"></label><label>Category<input name="category" value="${val(x.category)}"></label><label>Vacancies<input type="number" name="vacancy_count" value="${val(x.vacancy_count)}"></label><label>Status<input name="status" value="${val(x.status||'Open')}"></label><label>Notification date<input type="date" name="notification_date" value="${val(x.notification_date)}"></label><label>Application starts<input type="date" name="application_start" value="${val(x.application_start)}"></label><label>Application deadline<input type="date" name="application_end" value="${val(x.application_end)}"></label><label>Exam date<input type="date" name="exam_date" value="${val(x.exam_date)}"></label><label>Last verified<input type="date" name="last_verified" value="${val(x.last_verified||new Date().toISOString().slice(0,10))}"></label><label>Job location<input name="job_location" value="${val(x.job_location)}"></label><label>Application mode<input name="application_mode" value="${val(x.application_mode)}"></label><label class="wide">Post names<input name="post_names" value="${val(x.post_names)}"></label><label class="wide">Overview<textarea name="overview">${val(x.overview)}</textarea></label><label class="wide">Eligibility and qualification<textarea name="eligibility_en">${val(x.eligibility_en)}</textarea></label><label class="wide">Kannada eligibility<textarea name="eligibility_kn">${val(x.eligibility_kn)}</textarea></label><label class="wide">Post-wise vacancy details<textarea name="vacancy_breakdown">${val(x.vacancy_breakdown)}</textarea></label><label class="wide">Important dates details<textarea name="important_dates_details">${val(x.important_dates_details)}</textarea></label><label class="wide">Age limit and relaxation<textarea name="age_limit">${val(x.age_limit)}</textarea></label><label class="wide">Pay scale<textarea name="pay_scale">${val(x.pay_scale)}</textarea></label><label class="wide">Application fee<textarea name="application_fee">${val(x.application_fee)}</textarea></label><label class="wide">Selection process<textarea name="selection_process">${val(x.selection_process)}</textarea></label><label class="wide">Exam pattern<textarea name="exam_pattern">${val(x.exam_pattern)}</textarea></label><label class="wide">Syllabus<textarea name="syllabus">${val(x.syllabus)}</textarea></label><label class="wide">How to apply<textarea name="how_to_apply">${val(x.how_to_apply)}</textarea></label><label class="wide">Attempts<textarea name="attempts">${val(x.attempts)}</textarea></label><label class="wide">Physical standards<textarea name="physical_standards">${val(x.physical_standards)}</textarea></label><label class="wide">Helpline<input name="helpline" value="${val(x.helpline)}"></label><label class="wide">Other important information<textarea name="other_information">${val(x.other_information)}</textarea></label><label class="wide">Frequently asked questions<textarea name="frequently_asked_questions">${val(x.frequently_asked_questions)}</textarea></label><label class="wide">Official notification PDF URL<input type="url" name="official_notification_url" value="${val(x.official_notification_url)}"></label><label class="wide">Official application URL<input type="url" name="apply_url" value="${val(x.apply_url)}"></label><label class="wide">Official website URL<input type="url" name="official_website_url" value="${val(x.official_website_url)}"></label><button class="btn primary wide">Verify and publish recruitment</button></div><div class="form-status"></div></form>`;openEditor();$('examEdit').onsubmit=async e=>{e.preventDefault();const d=formObject(e.target);if(x.id)d.id=x.id;try{await api('/api/exams',{method:x.id?'PATCH':'POST',key:adminKey,body:JSON.stringify(d)});$('editorDialog').close();toast('Recruitment published.');await loadData();loadAdmin()}catch(err){toast(err.message)}}}
function materialEditor(m={}){$('editorTitle').textContent=m.id?'Edit material':'Add material';$('editorBody').innerHTML=`<form class="panel-form" id="materialEdit"><label>Title *<input name="title_en" value="${val(m.title_en)}" required></label><label>Kannada title<input name="title_kn" value="${val(m.title_kn)}"></label><label>Category<input name="category" value="${val(m.category)}"></label><label>Description<textarea name="description_en">${val(m.description_en)}</textarea></label><label>Author<input name="author" value="${val(m.author)}"></label><label>Upload PDF file<div class="upload-area"><input type="file" id="matFileInput" accept=".pdf,application/pdf" onchange="handleMatFile(this)"><label for="matFileInput" class="upload-btn">📂 Choose PDF file</label><span id="matFileName" class="file-chosen">No file chosen</span></div></label>
    <div id="matUploadProgress" style="display:none;font-size:.8rem;color:#10b981;padding:.5rem;background:#ecfdf5;border-radius:6px;margin:.5rem 0">Uploading…</div>
    <input type="hidden" id="matFileUrl" name="mat_file_url" value="${val(m.file_url||m.pdf_url||'')}">
    <label>Or paste a public file URL<input type="url" name="file_url" id="matUrlInput" value="${val(m.file_url||'')}" placeholder="https://drive.google.com/... or Dropbox link"></label>
    <label>PDF direct URL (if you have direct link)<input type="url" name="pdf_url" value="${val(m.pdf_url)}" placeholder="https://example.com/file.pdf"></label>
    <label>Subject / Topic<input name="subject" value="${val(m.subject)}" placeholder="e.g. Structural Engineering, Interview Questions, GATE Civil"></label><label>Preview URL<input type="url" name="preview_url" value="${val(m.preview_url)}"></label><label>Page count<input type="number" name="page_count" value="${val(m.page_count)}"></label><button class="btn primary">Save material</button></form>`;openEditor();$('materialEdit').onsubmit=async e=>{e.preventDefault();const d=formObject(e.target);d.access_type='Free';if(m.id)d.id=m.id;await api('/api/materials',{method:m.id?'PATCH':'POST',key:adminKey,body:JSON.stringify(d)});$('editorDialog').close();toast('Material saved.');await loadData();loadAdmin()}}
function openEditor(){$('editorDialog').showModal()}
$$('.route').forEach(a=>a.onclick=e=>{e.preventDefault();navigate(a.dataset.route)});onpopstate=()=>navigate(pathRoute[location.pathname]||'home',false);$('menuBtn').onclick=()=>{const n=$('mainNav'),open=n.classList.toggle('open');$('menuBtn').setAttribute('aria-expanded',open)};$('language').onclick=()=>{lang=lang==='en'?'kn':'en';localStorage.setItem('cc_lang',lang);translate();renderHome();renderPrivate();renderGovernment();renderExams();renderMaterials();updateStats();updateNavCounts();renderForYou()};$$('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());$('searchOpen').onclick=()=>{$('globalQuery').focus();scrollTo({top:document.querySelector('.search-wrap').offsetTop-90,behavior:'smooth'})};
const sug=['Civil Engineer','Site Engineer','Planning Engineer','Quantity Surveyor','BIM Engineer','Structural Engineer','Government Civil Jobs','SSC JE Civil','ESE Civil','Bengaluru','Mumbai','Hyderabad'];$('globalQuery').oninput=e=>{const q=e.target.value.toLowerCase();const a=sug.filter(x=>x.toLowerCase().includes(q)).slice(0,5);$('suggestions').innerHTML=a.map(x=>`<button type="button">${x}</button>`).join('');$('suggestions').classList.toggle('show',q.length>0&&a.length>0);$$('#suggestions button').forEach(b=>b.onclick=()=>{$('globalQuery').value=b.textContent;$('suggestions').classList.remove('show')})};$('smartSearch').onsubmit=e=>{e.preventDefault();$('suggestions').classList.remove('show');search($('globalQuery').value,$('globalLocation').value)};
if($('privateScopeChips'))$$('#privateScopeChips button').forEach(b=>b.onclick=()=>{$$('#privateScopeChips button').forEach(x=>x.classList.toggle('active',x===b));renderPrivate()});['privateRole','privateExperience','privateType','privateSort'].forEach(id=>$(id).onchange=renderPrivate);['privateLocation','privateQualification'].forEach(id=>$(id).oninput=renderPrivate);['govStatus','govSort'].forEach(id=>$(id)&&$(id).addEventListener('change',renderGovernment));
$('privateSort')&&$('privateSort').addEventListener('change',renderPrivate);
['govState','govLocation','govQualification','govDistrict','govEdu'].forEach(id=>{const el=$(id);if(el)el.addEventListener('change',renderGovernment);el&&el.addEventListener('input',renderGovernment)});
// Org chips for govt jobs
if($('govScopeChips'))$$('#govScopeChips button').forEach(b=>b.onclick=()=>{$$('#govScopeChips button').forEach(x=>x.classList.toggle('active',x===b));renderGovernment()});
// Edu chips for govt jobs

// Edu chips for private jobs
if($('privEduChips')){$$('#privEduChips button').forEach(b=>b.onclick=()=>{$$('#privEduChips button').forEach(x=>x.classList.toggle('active',x===b));renderPrivate()});}$$('#examChips button').forEach(b=>b.onclick=()=>{$$('#examChips button').forEach(x=>x.classList.toggle('active',x===b));renderExams(b.dataset.code)});$$('.material-tabs button').forEach(b=>b.onclick=()=>{$$('.material-tabs button').forEach(x=>x.classList.toggle('active',x===b));renderMaterials(b.dataset.material)});
wireForm('employerForm','/api/employer-submissions');wireForm('resourceForm','/api/resource-submissions',d=>({...d,permission_confirmed:document.querySelector('#resourceForm [name="permission_confirmed"]').checked}));wireForm('reportForm','/api/reports');$('adminLogin').onclick=async()=>{adminKey=$('adminKey').value;sessionStorage.setItem('cc_admin',adminKey);await showAdmin()};$('adminLogout').onclick=()=>{sessionStorage.removeItem('cc_admin');adminKey='';showAdmin()};$$('#adminTabs button').forEach(b=>b.onclick=()=>{$$('#adminTabs button').forEach(x=>x.classList.toggle('active',x===b));$$('[data-admin-panel]').forEach(x=>x.classList.toggle('active',x.dataset.adminPanel===b.dataset.admin))});$('addJob').onclick=()=>jobEditor();$('addExam').onclick=()=>examEditor();$('addMaterial').onclick=()=>materialEditor();$('importJobBtn').onclick=importJobLink;$('importJobUrl').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();importJobLink()}};$('importExamBtn').onclick=importExamPdf;$('clearJobImport').onclick=()=>{$('importJobUrl').value='';$('importJobText').value='';$('importJobStatus').className='form-status';$('importJobStatus').textContent=''};
translate();navigate(pathRoute[location.pathname]||'home',false);loadData();
// Hide admin link from public
const adminFooterLink=document.querySelector('.admin-footer-link');
if(adminFooterLink){
  const storedKey=sessionStorage.getItem('cc_admin');
  if(!storedKey)adminFooterLink.style.display='none';
}
// Wire search button
const searchBtn=document.querySelector('[data-action="search"],#searchBtn,.search-btn,button[aria-label="Search"]');
if(searchBtn)searchBtn.onclick=()=>{
  const q=document.querySelector('#globalQuery,#searchQuery,input[name="q"]');
  if(q){q.focus();q.select();}
  const overlay=document.querySelector('#searchOverlay,.search-overlay');
  if(overlay)overlay.hidden=!overlay.hidden;
};
// Wire featured org tiles
$$('.org-tile[data-route]').forEach(a=>a.onclick=e=>{e.preventDefault();navigate(a.dataset.route)});
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then(() => console.log("SW registered"))
      .catch((err) => console.error("SW error:", err));
  });
}
