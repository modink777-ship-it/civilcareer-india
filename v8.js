/* CivilCareer V8: structured lifecycle, dynamic filters, dedicated pages */
const CC_ROLES=['Civil Engineer','Site Engineer','Planning Engineer','Quantity Surveyor','Structural Engineer','Project Engineer','Estimation Engineer','Billing Engineer','QA/QC Engineer','Design Engineer','Construction Engineer','Project Coordinator','Other Civil/Construction Role'];
const CC_QUALS=['10th / SSLC','12th / PUC','ITI','Diploma','BE / BTech','ME / MTech','BSc','MSc','BA','MA','BCom','MCom','BBA','MBA','LLB','LLM','MBBS','Nursing','PhD','Any Graduate','Any Post Graduate','Other'];
const CC_EXP=['Fresher','0–1 years','1–3 years','3–5 years','5–8 years','8–10 years','10+ years'];
const CC_TYPES=['Full-time','Part-time','Contract','Internship','Apprenticeship','Freelance','Temporary'];
const CC_LOC={India:{Karnataka:['Bengaluru','Mysuru','Mangaluru','Hubballi','Belagavi','Shivamogga','Tumakuru','Hassan','Ballari'],Maharashtra:['Mumbai','Pune','Nagpur'],Telangana:['Hyderabad'],'Tamil Nadu':['Chennai','Coimbatore'],Kerala:['Kochi','Thiruvananthapuram'],'Andhra Pradesh':['Visakhapatnam','Vijayawada'],Delhi:['New Delhi'],Gujarat:['Ahmedabad','Surat']}};
const arr=(v,f='')=>{const a=Array.isArray(v)?v:(v?String(v).split(',').map(x=>x.trim()).filter(Boolean):[]);if(a.length)return a;const fb=Array.isArray(f)?f:(f?[f]:[]);return fb.filter(Boolean)};
const pubDate=j=>j.published_at||j.posted_at||j.created_at||j.posted_date||'';
const active=j=>{if(j.status==='Expired')return false;if(j.expires_at&&new Date(j.expires_at)<=new Date())return false;if(j.deadline){const raw=String(j.deadline),d=/T/.test(raw)?new Date(raw):new Date(raw+'T23:59:59');if(Number.isFinite(d.getTime())&&d<=new Date())return false;}return true};
function ago(v){if(!v)return'';const t=new Date(v).getTime();if(!Number.isFinite(t))return'';const diff=Math.max(0,Date.now()-t),min=Math.floor(diff/60000),hr=Math.floor(diff/3600000),day=Math.floor(diff/86400000),month=Math.floor(day/30),year=Math.floor(day/365);if(min<1)return'Posted just now';if(min<60)return`Posted ${min} minute${min===1?'':'s'} ago`;if(hr<24)return`Posted ${hr} hour${hr===1?'':'s'} ago`;if(day<30)return`Posted ${day} day${day===1?'':'s'} ago`;if(month<12)return`Posted ${month} month${month===1?'':'s'} ago`;return`Posted ${year} year${year===1?'':'s'} ago`}
function emailList(t){return[...new Set((String(t||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}/gi)||[]).filter(e=>/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,63}$/.test(e)))]}
function setOpts(id,vals,label){const el=$(id),keep=el.value,counts={};vals.filter(Boolean).forEach(v=>counts[v]=(counts[v]||0)+1);el.innerHTML=`<option value="">${label}</option>`+Object.keys(counts).sort().map(v=>`<option value="${esc(v)}">${esc(v)} (${counts[v]})</option>`).join('');if([...el.options].some(o=>o.value===keep))el.value=keep}
function jobLocs(j){return arr(j.locations,j.location_display||j.location)}function jobQuals(j){return arr(j.qualifications,j.qualification)}function jobExps(j){return arr(j.experience_ranges,j.experience_level)}function jobTypes(j){return arr(j.employment_types,j.employment_type)}
/* Sector is normalized (fixes 'private','PRIVATE','Private Sector','MNC' records
   disappearing). Missing sector defaults to Private so records never vanish. */
function activePrivate(){return jobs.filter(j=>(typeof sectorOf==='function'?sectorOf(j)==='Private':(String(j.sector||'Private').toLowerCase().includes('private')||String(j.sector||'Private').toLowerCase().includes('mnc')||!String(j.sector||'').trim()))&&!jobExpired(j))}
function jobExpired(j){if(j.status==='Expired')return true;if(j.expires_at&&new Date(j.expires_at)<=new Date())return true;if(j.deadline){const raw=String(j.deadline),d=/T/.test(raw)?new Date(raw):new Date(raw+'T23:59:59');if(Number.isFinite(d.getTime())&&d<=new Date())return true}return false}
function refreshPrivateOptions(){/* Options now live in the cc-filterbar (renderPrivateFilterBar). Kept as no-op for older callers. */}

/* ═══════════════════════════════════════════════════════════════════
   ONE-LINE HORIZONTAL FILTER BAR (LinkedIn-style)
   Major Indian cities first, then every city present in the loaded job
   data, then States. Posted date, Experience, Work mode and Employment
   type complete the row. Everything filters server-side.
   ═══════════════════════════════════════════════════════════════════ */
const CC_MAJOR_CITIES=['Bengaluru','Mumbai','Chennai','Hyderabad','Noida','Gurugram','Pune','Ahmedabad','Kolkata','Delhi','New Delhi','Jaipur','Lucknow','Indore','Nagpur','Surat','Vadodara','Coimbatore','Kochi','Thiruvananthapuram','Visakhapatnam','Vijayawada','Bhopal','Chandigarh','Bhubaneswar','Guwahati','Patna','Raipur','Nashik','Thane','Mangaluru','Mysuru'];
function ccCityKey(c){return String(c||'').toLowerCase().replace(/[^a-z]/g,'').replace('bangalore','bengaluru').replace('gurgaon','gurugram').replace('newdelhi','delhi')}
const ccFacetState={private:{},gov:{}};
window.ccFacetState=ccFacetState;
function ccSeenCities(){const out=new Map();for(const j of window.__ccPrivateJobs||[]){for(const c of [j.city,j.district])for(const part of String(c||'').split(/[,;]/).map(s=>s.trim()).filter(Boolean)){if(!out.has(ccCityKey(part)))out.set(ccCityKey(part),part)}for(const c of String(j.location_display||j.location||'').split(/[,·]/).map(s=>s.trim().replace(/ Area$/i,''))){if(out.size&&out.has(ccCityKey(c)))continue;if(c&&c.length>2&&!/india|ind$|remote|multiple|across/i.test(c)&&!out.has(ccCityKey(c)))out.set(ccCityKey(c),c)}}for(const j of window.__ccAllJobs||[]){for(const c of String(j.city||'').split(/[,;]/).map(s=>s.trim()).filter(Boolean)){if(!out.has(ccCityKey(c)))out.set(ccCityKey(c),c)}}return out}
function ccCityChoices(){
  const seen=ccSeenCities();const chosen=[];const used=new Set();
  for(const m of CC_MAJOR_CITIES){if(seen.has(ccCityKey(m))&&!used.has(ccCityKey(m))){chosen.push(m);used.add(ccCityKey(m))}}
  for(const [,name] of seen){if(!used.has(ccCityKey(name))){chosen.push(name);used.add(ccCityKey(name))}}
  return chosen;
}
function ccStateChoices(){const s=new Set();for(const j of window.__ccPrivateJobs||[])for(const part of String(j.state||'').split(/[,;]/).map(x=>x.trim().replace(/,$/,'')).filter(Boolean)){if(/^[A-Z]/.test(part)&&!/^india$/i.test(part))s.add(part)}return [...s].sort()}
function ccSelect(id,label,vals,allLabel,extra){return `<label class="xff" data-xf="${id}"><span>${label}</span><select id="${id}"><option value="">${allLabel}</option>${(extra||[]).map(([v,t])=>`<option value="${esc(v)}">${esc(t)}</option>`).join('')}${vals.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select></label>`}
function ccActiveChipCount(st){return Object.keys(st).filter(k=>st[k]).length}
function ccBindBar(containerId,st,onApply){
  const bar=$(containerId);if(!bar)return;
  bar.querySelectorAll('select').forEach(sel=>{sel.onchange=()=>{const k=sel.id;st[k]=sel.value;onApply()}});
  const clear=bar.querySelector('[data-cc-clear]');if(clear)clear.onclick=()=>{for(const k of Object.keys(st))st[k]='';bar.querySelectorAll('select').forEach(s=>s.value='');onApply()};
}
function ccRenderBar(containerId,st){
  const bar=$(containerId);if(!bar)return;
  const cities=ccCityChoices(),states=ccStateChoices();
  const n=ccActiveChipCount(st);
  bar.classList.toggle('has-active',n>0);
  bar.innerHTML=ccSelect('role','Role',[],'All roles',CC_ROLES.map(r=>[r,r]))
    +ccSelect('location',`Location (${cities.length})`,cities,'All locations')
    +ccSelect('state','State',states,'All states')
    +ccSelect('posted','Posted date',[],'Any time',[['1','Last 24 hours'],['2','Last 2 days'],['3','Last 3 days'],['7','Last 7 days'],['15','Last 15 days'],['30','Last 30 days']])
    +ccSelect('experience','Experience',[],'All experience',[['Fresher','Fresher'],['1','1+ years'],['3','3+ years'],['5','5+ years'],['8','8+ years'],['10','10+ years']])
    +ccSelect('work_mode','Work mode',[],'Any work mode',[['remote','Remote'],['hybrid','Hybrid'],['onsite','On-site']])
    +ccSelect('employment_type','Employment type',[],'All types',[['Full-time','Full-time'],['Part-time','Part-time'],['Contract','Contract'],['Internship','Internship'],['Apprenticeship','Apprenticeship']])
    +ccSelect('qualification','Qualification',[],'Any qualification',[['Diploma','Diploma'],['BE / BTech','BE / BTech'],['ME / MTech','ME / MTech'],['ITI','ITI'],['10th / SSLC','10th'],['12th / PUC','12th'],['Any Graduate','Any Graduate']])
    +`<div class="xff-actions"><button class="btn secondary" data-cc-clear type="button">Clear${n?` (${n})`:''}</button></div>`;
  for(const sel of bar.querySelectorAll('select')){const k=sel.id;if(st[k])sel.value=st[k]}
}
function renderPrivateFilterBar(){ccRenderBar('ccPrivateFilterBar',ccFacetState.private);ccBindBar('ccPrivateFilterBar',ccFacetState.private,()=>renderPrivate(1))}
function renderGovFilterBar(){ccRenderBar('ccGovFilterBar',ccFacetState.gov);ccBindBar('ccGovFilterBar',ccFacetState.gov,()=>renderGovernment(1))}
function chipBox(ids,target,render){const a=ids.map(id=>$(id)).filter(x=>x&&x.value);$(target).innerHTML=a.map(x=>`<button data-clear-filter="${x.id}">${esc(x.options?.[x.selectedIndex]?.text.replace(/ \(\d+\)$/,'')||x.value)} ×</button>`).join('');$$(`#${target} [data-clear-filter]`).forEach(b=>b.onclick=()=>{$(b.dataset.clearFilter).value='';render()})}

/* ── Explorer wiring (FIX-2026-09-24): quick filters, mirrors, salary select,
   sort and the LEFT list / RIGHT detail panel. State lives in ccQuick so quick
   chips compose with (instead of fight) the dropdown filters. ── */
const ccQuick={key:'',val:''};
window.ccQuick=ccQuick;
/* FIX-2026-09-25: every quick chip now owns exactly one piece of state and can be
   toggled off. Previously “Freshers” wrote to the experience dropdown and could
   never be cleared, and “₹30K+” multiplied the monthly threshold by 12. */
const CC_QUICK_MAP={
  fresher:{apply:()=>{ccQuick.key='fresher';ccQuick.val=''}},
  '30k':{apply:()=>{ccQuick.key='30k';ccQuick.val='';const sel=$('privateSalaryMinSel');if(sel)sel.value='30000';syncPrivateSalary()}},
  site:{apply:()=>{ccQuick.key='site';ccQuick.val='site'}},
  design:{apply:()=>{ccQuick.key='design';ccQuick.val='design'}},
  govt:{apply:()=>{}},
  mnc:{apply:()=>{ccQuick.key='mnc';ccQuick.val='mnc'}},
  blr:{apply:()=>{ccQuick.key='blr';ccQuick.val='blr'}},
  remote:{apply:()=>{ccQuick.key='remote';ccQuick.val='remote'}}
};
/* Reset every piece of state a quick chip can set. */
function clearQuick(){
  ccQuick.key='';ccQuick.val='';
  $$('#explorerQuick button').forEach(x=>x.classList.remove('active'));
  if($('privateExperience'))$('privateExperience').value='';
  if($('privateSalaryMinSel'))$('privateSalaryMinSel').value='';
  if($('privateSalary'))$('privateSalary').value='';
}
/* SALARY NORMALISATION: the database stores a mix of monthly and annual figures
   while the filter UI is expressed per month. Values under ₹1,200 are treated as
   thousands, under ₹1,20,000 as monthly, and larger values as annual (÷12).
   A job with no salary information is never removed by the salary filter. */
function salaryMonthly(j){
  const raw=Number(j&&(j.salary_max||j.salary_min||0));
  if(!raw||!Number.isFinite(raw))return null;
  if(raw<1000)return Math.round(raw*1000);
  if(raw<120000)return Math.round(raw);
  return Math.round(raw/12);
}
function ccQuickFilter(j){
  if(!ccQuick.key)return true;
  const k=ccQuick.key;
  /* Freshers: keep jobs that advertise fresher/0–1 yrs, keep jobs with NO stated
     experience, but drop jobs explicitly asking for 3+ years. */
  if(k==='fresher'){
    const et=ccLo([j.experience_level,(jobExps(j)||[]).join(' ')].join(' '));
    if(/fresher|entry[ -]level|\b0\s*[-–]\s*1\b/.test(et))return true;
    const m=et.match(/(\d+)\s*[-–]?\s*\+?\s*year/);
    return m?+m[1]<=2:true;
  }
  if(k==='30k')return true; /* handled via the real hidden salary filter */
  const text=normText([j.role,j.role_normalized,j.company,j.recruitment_authority,j.description,j.skills,j.location,j.location_display,(j.locations||[]).join(' '),j.city,j.state,j.discipline].flat().filter(Boolean).join(' '));
  if(k==='site')return /\bsite\b|construction site|on[- ]?site|\bfield\b/.test(text);
  if(k==='design')return /\bdesign\b|design office|design engineer|structural|geotech|bim|autocad|staad|etabs|revit|civil 3d/.test(text);
  if(k==='mnc')return /\bmnc\b|multinational/.test(text)||/\bmnc\b|multinational/.test(ccLo(j.company||''));
  if(k==='remote')return /remote|work from home|wfh/.test(text);
  if(k==='blr')return /bengaluru|bangalore/.test(text);
  return true;
}
function ccLo(v){return String(v||'').toLowerCase()}
/* FIX-2026-09-25: `$sel` was an undefined variable, so the ₹30K+ quick chip and
   the salary dropdown threw a ReferenceError and the salary filter never applied. */
/* The select is already expressed per month, so the hidden filter stores the
   monthly threshold unchanged (the old ×12 made every monthly-paid job vanish). */
function syncPrivateSalary(){const sel=$('privateSalaryMinSel'),hid=$('privateSalary');if(!sel||!hid)return;hid.value=sel.value||''}
function syncPrivateMirrors(){const s=$('privateState'),m=$('privateStateMirror'),c=$('privateCity'),cm=$('privateCityMirror');if(m&&s&&m.value!==s.value)m.value=s.value;if(cm&&c&&cm.value!==c.value)cm.value=c.value}
function wireExplorer(){
  if(window.__ccExplorerWired)return;window.__ccExplorerWired=true;
  /* Filter bars are re-bound after each render (renderPrivateFilterBar / renderGovFilterBar). */
}
function wireExplorer2(){
  if(window.__ccExplorerWired2)return;window.__ccExplorerWired2=true;
  $('privateSort')&&($('privateSort').onchange=()=>renderPrivate(1));
  /* Government explorer controls re-fetch server-side (Phase I/J). */
  ['govSort'].forEach(id=>{const el=$(id);if(el&&!el.dataset.ccGovWired){el.dataset.ccGovWired='1';el.onchange=()=>renderGovernment(1)}});
  $$('#govScopeChips button').forEach(b=>{if(!b.dataset.ccGovScopeWired){b.dataset.ccGovScopeWired='1';b.onclick=()=>{$$('#govScopeChips button').forEach(x=>x.classList.toggle('active',x===b));renderGovernment(1)}}});
  /* LEFT card View action → RIGHT detail panel. The card itself is not a link. */
  document.addEventListener('click',e=>{
    const trigger=e.target.closest('[data-open-explorer]');
    if(!trigger)return;
    e.preventDefault();
    renderJobDetailPanel(trigger.dataset.openExplorer, trigger.dataset.explorerKind||'private');
  });
  document.addEventListener('click',e=>{const c=e.target.closest('[data-panel-close]');if(c){const panel=c.closest('.job-detail-panel');if(panel)panel.hidden=true;}});
  window.renderJobDetailPanel=renderJobDetailPanel;
}
function renderJobDetailPanel(jobId,kind='private'){
  const panel=$(kind==='government'?'governmentJobDetailPanel':'jobDetailPanel');if(!panel)return;
  $$('.jobs-column [data-explorer-job]').forEach(c=>c.classList.toggle('cc-selected',String(c.dataset.explorerJob)===String(jobId))); /* highlight selected card */
  const j=jobs.find(x=>String(x.id)===String(jobId))||window.__ccPrivateJobs?.find(x=>String(x.id)===String(jobId))||window.__ccGovernmentJobs?.find(x=>String(x.id)===String(jobId))||window.__ccSearchJobs?.find(x=>String(x.id)===String(jobId))||window.__ccAllJobs?.find(x=>String(x.id)===String(jobId));
  if(!j)return;
  const cm=typeof civilMatch==='function'?civilMatch(j):null;
  const loc=jobLocs(j).join(' · ')||j.location_display||j.location||j.city||j.state||'Not specified in the listing.';
  const apply=j.application_url||j.apply_url||j.source_url||'';
  /* Only an explicit open counts as “viewed” — the panel never opens on its own. */
  if(typeof markViewed==='function')markViewed(jobId);
  if(typeof viewedLabel==='function'){
    const card=$$('.jobs-column [data-explorer-job]').find(c=>String(c.dataset.explorerJob)===String(jobId));
    const st=card&&card.querySelector('.cc-compact-status');
    if(st&&!st.querySelector('.cc-viewed-badge')){
      const b=document.createElement('span');b.className='cc-viewed-badge';b.textContent=viewedLabel(jobId);st.appendChild(b);
    }
  }
  const skillLinks=s=>{const raw=skillsOf(s);return raw.length?raw.map(s2=>{const hasMat=(typeof materials!=='undefined')&&materials.some(m=>normText([m.title_en,m.category,m.subject,m.description_en].join(' ')).includes(normText(s2)));return hasMat?`<a href="/study-materials" data-route="materials" class="cc-skill-link" title="Free ${esc(s2)} resources in Study Materials">${esc(s2)}</a>`:`<span>${esc(s2)}</span>`}).join(', '):''};
  const facet=(f)=>`<span class="why-facet ${f.s==='✓'?'hit':f.s==='△'?'part':''}" title="${esc(f.why)}">${f.k} ${f.s}</span>`;
  panel.innerHTML=`
    <div class="cc-panel-head">
      <div class="cc-panel-kicker">JOB DETAILS ${closedOf(j)?' · EXPIRED':''}</div>
      <button class="cc-panel-close" data-panel-close aria-label="Close details">×</button>
    </div>
    <h2 class="cc-panel-title">${esc(j.role||j.role_normalized||'Opportunity')}</h2>
    <div class="cc-panel-company">${esc(j.company||j.recruitment_authority||'Organization')}</div>
    <div class="cc-panel-meta">
      <span>📍 ${esc(loc)}</span>
    </div>
    ${cm?`<div class="why-match-box"><b>WHY THIS JOB FITS</b><div class="why-facets">${cm.facets.map(facet).join('')}</div>${cm.skillMiss.length?`<div class="why-missing">Missing skill${cm.skillMiss.length>1?'s':''}: ${cm.skillMiss.slice(0,3).map(s=>`<b>${esc(s)}</b>`).join(', ')}${materials&&materials.length?' — matching free resources are linked in Skills below.':''}</div>`:''}</div>`:''}
    <div class="cc-detail-grid">
      ${kind==='government'?`<div><b>RECRUITMENT AUTHORITY</b>${esc(j.recruitment_authority||j.company||'Not specified')}</div><div><b>VACANCIES</b>${esc(j.vacancy_count||'Not specified')}</div><div><b>APPLICATION START</b>${j.application_start?date(j.application_start):'Not specified'}</div><div><b>DEADLINE</b>${j.deadline?date(j.deadline):'Not specified'}</div><div><b>AGE LIMIT</b>${esc(j.age_limit||'Not specified')}</div><div><b>APPLICATION FEE</b>${esc(j.application_fee||'Not specified')}</div>`:''}
      ${j.project_type||projectTypeOf(j)?`<div><b>PROJECT</b>${esc(j.project_type||projectTypeOf(j))}</div>`:''}
      ${j.work_type||workTypeOf(j)?`<div><b>WORK TYPE</b>${esc(j.work_type||workTypeOf(j))}</div>`:''}
      <div><b>RESPONSIBILITIES</b>${j.responsibilities?richText(j.responsibilities):'Not specified in the listing.'}</div>
      <div><b>REQUIREMENTS</b>${j.requirements?richText(j.requirements):j.description?richText(short(j.description,300)):'Not specified in the listing.'}</div>
      <div><b>QUALIFICATION</b>${esc(jobQuals(j).join(' · ')||'Not specified in the listing.')}</div>
      ${salaryText(j)?`<div><b>SALARY</b>${esc(salaryText(j))}</div>`:''}
      <div class="full"><b>SKILLS</b>${skillLinks(j.skills||j.skills_required||'')||esc(jobQuals(j).join(' · '))||'Not specified in the listing.'}</div>
      <div class="full"><b>SOURCE / VERIFICATION</b>${j.source_url?`<a href="${esc(j.source_url)}" target="_blank" rel="noopener">Open original source ↗</a>`:'Not specified'}${j.last_verified?`<span class="cc-verified-note">Last verified ${esc(date(j.last_verified))}</span>`:''}</div>
    </div>
    ${j.last_verified?`<p class="cc-verified-note">Last verified: ${esc(date(j.last_verified))}</p>`:''}
    ${apply?`<a class="btn primary cc-panel-apply" href="${esc(apply)}" target="_blank" rel="noopener" data-apply-job="${esc(j.id)}">${kind==='government'?'APPLY ON OFFICIAL PORTAL':'APPLY NOW'} ↗</a>`:`<p class="cc-panel-apply-note">No application link was published with this listing — check the original source.</p>`}
    <div class="cc-panel-actions"><a class="btn secondary" href="${esc(jobPath(j))}" data-full-job>Open full job page ↗</a><div class="cc-panel-save"><button class="btn-save ${getSaved().has(j.id)?'saved':''}" data-save-job="${esc(j.id)}">${getSaved().has(j.id)?'★ Saved':'☆ Save'}</button></div></div>
  `;
  panel.hidden=false;
  bindCards();
  $$('[data-apply-job]').forEach(a=>a.onclick=()=>{saveInteractionLocal(a.dataset.applyJob,'applied');track('job_apply',a.dataset.applyJob)});
  /* In-panel route links must go through the SPA router */
  panel.querySelectorAll('a[data-route]').forEach(a=>a.onclick=e2=>{e2.preventDefault();navigate(a.dataset.route)});
  window.__ccPanelJobId=jobId;
}
function closedOf(j){return typeof jobExpired==='function'?jobExpired(j):isClosed(j)}
/* ── SERVER-SIDE PAGINATED EXPLORERS (Phase I/J) ──────────────────────
   Filters, search and paging run against /api/jobs; the browser holds one
   bounded page (40). window.__ccPrivateJobs / window.__ccGovernmentJobs are
   SEPARATE caches so Private and Government can never overwrite each other's
   selected-job data. Kept from the previous build: honest loading/empty/failed
   states, filter chips and the two-way drawer mirrors. */
let ccPrivatePage=1;
let ccGovernmentPage=1;
async function fetchExplorerJobs(kind,page=1){
  const params=new URLSearchParams({page:String(page),limit:'40',sector:kind==='government'?'Government':'Private'});
  const st=ccFacetState[kind==='government'?'gov':'private'];
  const add=(k,v)=>{if(v)params.set(k,v)};
  add('roles',st.role);add('cities',st.location);add('state',st.state);add('posted_days',st.posted);add('experience',st.experience);
  add('work_mode',st.work_mode);add('employment_type',st.employment_type);add('qualification',st.qualification);
  if(kind==='private'){
    const sort=$('privateSort')?.value||'new';
    if(sort)params.set('sort',sort);
  }else{
    const scope=document.querySelector('#govScopeChips .active')?.dataset.scope||'all';
    const sort=$('govSort')?.value||'new';
    if(scope!=='all')params.set('gov_scope',scope);
    if(sort)params.set('sort',sort);
  }
  return api(`/api/jobs?${params.toString()}`);
}
function renderExplorerPager(id,meta,loadPage){
  const root=$(id); if(!root)return;
  if(!meta||meta.pages<=1){root.innerHTML='';return;}
  root.innerHTML=`<div class="cc-pagination"><button class="btn secondary" data-page-prev ${meta.page<=1?'disabled':''}>Previous</button><span>Page ${meta.page} of ${meta.pages} · ${Number(meta.total||0).toLocaleString('en-IN')} jobs</span><button class="btn secondary" data-page-next ${!meta.has_next?'disabled':''}>Next</button></div>`;
  root.querySelector('[data-page-prev]')?.addEventListener('click',()=>loadPage(meta.page-1));
  root.querySelector('[data-page-next]')?.addEventListener('click',()=>loadPage(meta.page+1));
}
function ensurePager(id,afterId){
  let el=$(id); if(el)return el;
  const anchor=$(afterId); if(!anchor?.parentElement)return null;
  el=document.createElement('div');el.id=id;el.className='cc-explorer-pager';anchor.parentElement.appendChild(el);return el;
}async function renderPrivate(page=1){
  wireExplorer();wireExplorer2();renderPrivateFilterBar();
  const root=$('privateJobs'); if(!root)return;
  if(page===1)root.innerHTML='<div class="empty-state"><p>Loading private civil opportunities…</p></div>';
  try{
    const data=await fetchExplorerJobs('private',page); ccPrivatePage=page;
    const list=data.jobs||[]; window.__ccPrivateJobs=list;
    /* Re-render the filter bar now that real data exists — the first render
       ran before any jobs were loaded, so city/state options would be empty. */
    renderPrivateFilterBar();
    list.forEach(j=>{if(!j.id)j.id=String(j.source_url||j.role||'job')});
    const meta=data.meta||{page,total:list.length,pages:1,has_next:false};
    const total=Number(meta.total||list.length);
    $('privateCount').textContent=`${total.toLocaleString('en-IN')} active opportunit${total===1?'y':'ies'}`;
    root.innerHTML=list.length?list.map(x=>jobCard(x)).join(''):`<div class="empty-state"><h3>${total?'No jobs match these filters':'No private jobs are currently available'}</h3><p>${total?`${total} private job${total===1?' exists':'s exist'} but none pass the selected filters. Remove one filter or clear all.`:'Verified private-sector opportunities will appear here as they are published.'}</p><button class="btn secondary" id="emptyClear">Clear all filters</button></div>`;
    ensurePager('privateJobsPager','privateJobs');renderExplorerPager('privateJobsPager',meta,renderPrivate);
    if($('emptyClear'))$('emptyClear').onclick=()=>{for(const k of Object.keys(ccFacetState.private))ccFacetState.private[k]='';renderPrivateFilterBar();renderPrivate(1)};
    bindCards();updateFilterUrl();
  }catch(err){
    $('privateCount').textContent='Unable to load opportunities';
    root.innerHTML=`<div class="empty-state"><h3>Unable to load private jobs</h3><p>The jobs service could not be reached, so this list is empty because the data failed to load — not because there are no private jobs.</p><button class="btn secondary" id="emptyRetry">Retry</button></div>`;
    if($('emptyRetry'))$('emptyRetry').onclick=()=>renderPrivate(1);
  }
}
async function renderGovernment(page=1){
  wireExplorer();wireExplorer2();renderGovFilterBar();
  const root=$('governmentJobs'); if(!root)return;
  if(page===1)root.innerHTML='<div class="empty-state"><p>Loading government civil recruitment…</p></div>';
  try{
    const data=await fetchExplorerJobs('government',page); ccGovernmentPage=page;
    const list=data.jobs||[]; window.__ccGovernmentJobs=list;
    renderGovFilterBar();
    list.forEach(j=>{if(!j.id)j.id=String(j.source_url||j.role||'job')});
    const meta=data.meta||{page,total:list.length,pages:1,has_next:false};
    const total=Number(meta.total||list.length);
    $('governmentCount').textContent=`${total.toLocaleString('en-IN')} government civil opportunit${total===1?'y':'ies'}`;
    root.innerHTML=list.length?list.map(x=>jobCard(x,true)).join(''):empty('No matching government civil recruitment','Remove one filter or switch between Central and State recruitment.');
    ensurePager('governmentJobsPager','governmentJobs');renderExplorerPager('governmentJobsPager',meta,renderGovernment);
    bindCards();
  }catch(err){
    $('governmentCount').textContent='Unable to load opportunities';
    root.innerHTML=`<div class="empty-state"><h3>Unable to load government jobs</h3><p>${esc(err.message||'The jobs service could not be reached.')}</p><button class="btn secondary" id="govRetry">Retry</button></div>`;
    if($('govRetry'))$('govRetry').onclick=()=>renderGovernment(1);
  }
}
function clearPrivate(){for(const k of Object.keys(ccFacetState.private))ccFacetState.private[k]='';renderPrivateFilterBar();renderPrivate(1)}
function govScopeOf(j){const level=String(j.government_level||j.gov_level||'').toLowerCase();if(level==='central'||level==='state')return level;const t=[j.recruitment_authority,j.company,j.discipline,j.description].join(' ').toLowerCase();const central=['upsc','ssc','cpwd','cwc','nhai','bro','mes','indian railways','railway board','central government','central public works','border roads','national highways','ministry of','central water'].some(x=>t.includes(x));if(central)return'central';if(j.state||j.state_region||j.region)return'state';return'central'}

jobCard=function(j,gov=false){gov=gov||(typeof isGovJob==='function'?isGovJob(j):['Government','Public Sector'].includes(j.sector));const closed=!active(j),loc=jobLocs(j).join(' · ')||j.location_display||j.location;return`<article class="job-card cc-compact-card" data-explorer-job="${esc(j.id)}" data-explorer-kind="${gov?'government':'private'}"><div class="card-top"><span class="pill ${closed?'closed':j.featured?'featured':'verified'}">${closed?'Expired':j.featured?'Featured':'Active'}</span><span class="verified-date">${ago(pubDate(j))}</span></div><div class="cc-compact-status">${typeof viewedLabel==='function'&&viewedLabel(j.id)?`<span class="cc-viewed-badge">${esc(viewedLabel(j.id))}</span>`:``}</div><h3>${esc(j.role)}</h3><div class="organization">${esc(j.company||j.recruitment_authority||'Organization')}</div><div class="card-meta"><span>${esc(loc||'Location in source')}</span>${jobQuals(j).slice(0,2).map(x=>`<span>${esc(x)}</span>`).join('')}${jobExps(j).slice(0,1).map(x=>`<span>${esc(x)}</span>`).join('')}</div><div class="card-actions"><button type="button" data-open-explorer="${esc(j.id)}" data-explorer-kind="${gov?'government':'private'}">View Details</button><a class="cc-full-job-link" href="${esc(jobPath(j))}">Open full page ↗</a></div></article>`}
function activateDynamic(name,path,push=true){route=name;$$('.page').forEach(p=>p.classList.toggle('active',p.dataset.page===name));if(push)history.pushState({},'',path);scrollTo(0,0)}
function jobPath(j){return`/jobs/${j.slug||String(j.role||'job').toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+j.id}`}
function materialPath(m){return`/study-materials/${String(m.slug||m.title_en||'resource').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120)}-${m.id}`}
function openMaterialDedicated(m,push=true){
  if(!m)return;
  const title=m.title_en||m.title||'Study resource';
  const url=m.file_url||m.pdf_url||m.preview_url||'';
  $('materialDetailPage').innerHTML=`<article class="dedicated-card"><div class="detail-kicker">Study material · ${esc(m.category||'Civil Engineering')}</div><h1>${esc(title)}</h1>${m.author?`<p class="detail-lead">By ${esc(m.author)}</p>`:''}<div class="detail-grid"><div class="detail"><b>Category</b>${esc(m.category||'Study resource')}</div>${m.subject?`<div class="detail"><b>Subject / Topic</b>${esc(m.subject)}</div>`:''}${m.page_count?`<div class="detail"><b>Pages</b>${esc(m.page_count)}</div>`:''}<div class="detail full"><b>Description</b>${richText(m.description_en||m.description||'Open the resource to review its contents.')}</div></div><div class="card-actions">${url?`<a href="${esc(url)}" target="_blank" rel="noopener">OPEN RESOURCE ↗</a>`:''}${m.preview_url&&m.preview_url!==url?`<a href="${esc(m.preview_url)}" target="_blank" rel="noopener">Preview ↗</a>`:''}</div><div class="callout">Only use materials shared by their owner or with appropriate permission.</div></article>`;
  activateDynamic('materialDetail',materialPath(m),push);document.title=`${title} | CivilCareer`;
}
openJob=function(j,push=true){if(!j)return;if(typeof markViewed==='function')markViewed(j.id);window.__ccCurrentJob=j;const closed=!active(j),email=!j.application_email_private&&j.application_email,loc=jobLocs(j).join(' · ')||j.location_display||j.location;$('jobDetailPage').innerHTML=`<article class="dedicated-card"><div class="detail-kicker">${closed?'Expired opportunity':'Verified opportunity'} · ${ago(pubDate(j))}</div><h1>${esc(j.role)}</h1><p class="detail-lead">${esc(j.company||'Organization')} · ${esc(loc||'Location in source')}</p>${closed?'<div class="expired-banner">This opportunity has expired and is retained for transparency. Do not treat it as open.</div>':''}<div class="card-actions job-apply-top"><a href="${esc(j.application_url || j.source_url)}" target="_blank" rel="noopener">APPLY NOW ↗</a><a href="${esc(j.source_url)}" target="_blank" rel="noopener">View original source ↗</a></div><div class="detail-grid"><div class="detail"><b>Qualifications</b>${esc(jobQuals(j).join(' · ')||'Not specified by the employer/source.')}</div><div class="detail"><b>Experience</b>${esc(jobExps(j).join(' · ')||'Not specified by the employer/source.')}</div><div class="detail"><b>Employment</b>${esc(jobTypes(j).join(' · ')||'Not specified by the employer/source.')}</div><div class="detail"><b>Published</b>${date(String(pubDate(j)).slice(0,10))}</div>${j.salary||j.salary_min||j.salary_max?`<div class="detail"><b>Salary / Pay</b>${esc(j.salary||[j.salary_min,j.salary_max].filter(Boolean).join(' – '))}</div>`:''}${j.deadline?`<div class="detail"><b>Apply By</b>${esc(date(j.deadline))}</div>`:''}${(j.vacancy_count||j.vacancies)?`<div class="detail"><b>Vacancies</b>${esc(String(j.vacancy_count||j.vacancies))}</div>`:''}${j.application_fee?`<div class="detail"><b>Application Fee</b>${esc(j.application_fee)}</div>`:''}${j.age_limit?`<div class="detail"><b>Age Limit</b>${esc(j.age_limit)}</div>`:''}${(j.state||j.country)?`<div class="detail"><b>Region</b>${esc([j.state,j.country].filter(Boolean).join(', '))}</div>`:''}<div class="detail full"><b>Description</b>${richText(j.description)}</div>${j.responsibilities?`<div class="detail full"><b>Responsibilities</b>${richText(j.responsibilities)}</div>`:''}${j.skills?`<div class="detail full"><b>Skills</b>${richText(j.skills)}</div>`:''}</div>${email?`<div class="email-apply"><b>Apply via Email</b><span>${esc(email)}</span><button data-copy-email="${esc(email)}">Copy email</button><a href="mailto:${esc(email)}">Email Application</a></div>`:''}<div class="card-actions"><a href="${esc(j.application_url || j.source_url)}" target="_blank" rel="noopener">APPLY NOW ↗</a><a href="${esc(j.source_url)}" target="_blank" rel="noopener">View original source ↗</a></div><div class="callout">Always verify the job, deadline and application instructions at the original source. Never pay for a job.</div></article>`;activateDynamic('jobDetail',jobPath(j),push);document.title=`${j.role} — ${j.company||'CivilCareer'}`;$$('[data-copy-email]').forEach(b=>b.onclick=()=>navigator.clipboard.writeText(b.dataset.copyEmail).then(()=>toast('Email copied.')))}
openExam=function(x,push=true){if(!x)return;const title=x.title_en,closed=x.application_end&&new Date(x.application_end+'T23:59:59')<new Date();$('examDetailPage').innerHTML=`<article class="dedicated-card exam-detail-page"><div class="detail-kicker">${closed?'Application Closed':esc(x.status||'Active')} · Last verified ${date(x.last_verified)}</div><h1>${esc(title)}</h1><p class="detail-lead">${esc(x.authority||'Authority in notification')}</p>${x.overview?`<p class="exam-intro">${richText(x.overview)}</p>`:''}<section class="exam-detail-section"><h3>Quick Information</h3><div class="exam-overview"><div><b>Authority</b>${esc(x.authority||'Check source')}</div><div><b>Vacancies</b>${esc(x.vacancy_count||x.vacancies||'Not specified in the notification.')}</div><div><b>Qualification</b>${richText(x.eligibility_en)}</div><div><b>Application fee</b>${richText(x.application_fee)}</div></div></section>${examSection('Important Dates',x.important_dates_details)}${examSection('Eligibility',x.eligibility_en)}${examSection('Vacancies',x.vacancy_breakdown)}${examSection('Exam Pattern',x.exam_pattern)}${examSection('Syllabus',x.syllabus)}${examSection('Application Process',x.how_to_apply)}<section class="exam-detail-section"><h3>Official Links</h3><div class="card-actions">${x.official_website_url?`<a href="${esc(x.official_website_url)}" target="_blank">Official Website ↗</a>`:''}${x.official_notification_url?`<a href="${esc(x.official_notification_url)}" target="_blank">Official Notification ↗</a>`:''}${x.apply_url?`<a href="${esc(x.apply_url)}" target="_blank">Apply Online ↗</a>`:''}</div></section><div class="callout">Always verify dates, eligibility and application instructions in the official notification before applying.</div></article>`;const p=`/exams/${x.slug||String(x.code||title).toLowerCase().replace(/[^a-z0-9]+/g,'-')}`;activateDynamic('examDetail',p,push);document.title=`${title} | CivilCareer`}
function scanEmails(){const found=emailList($('importJobText').value),sel=$('detectedEmailSelect'),manual=$('importApplicationEmail');sel.innerHTML=found.length?found.map(e=>`<option value="${esc(e)}">${esc(e)}</option>`).join(''):'<option value="">No valid email detected</option>';if(found.length&&!manual.value)manual.value=found[0]}
const oldImport=importJobLink;importJobLink=async function(){scanEmails();await oldImport()};$('importJobText').addEventListener('input',scanEmails);$('useDetectedEmail').onclick=()=>{if($('detectedEmailSelect').value)$('importApplicationEmail').value=$('detectedEmailSelect').value};$('importJobBtn').onclick=async()=>{const url=$('importJobUrl').value.trim(),text=$('importJobText').value.trim();if(!url&&!text)return importStatus('importJobStatus','Paste a URL or source text.','error');const b=$('importJobBtn');b.disabled=true;try{const data=await api('/api/extract',{method:'POST',key:adminKey,body:JSON.stringify({url,text})}),x={...(data.extracted||data.job||{})};x.source_url=x.source_url||url;x.application_email=$('importApplicationEmail').value||x.application_email;x.application_emails=emailList(text);x.last_verified=new Date().toISOString().slice(0,10);x.status='Active';importStatus('importJobStatus',data.warning||`Extraction complete using ${data.source||'AI'}. Verify every field before saving.`,'success');jobEditor(x)}catch(e){importStatus('importJobStatus',e.message,'error')}finally{b.disabled=false}};
function multi(name,items,selected=[]){return`<input name="${name}" placeholder="Type ${name} (comma-separated)" value="${selected.join(', ')}">`}

jobEditor = function(j = {}) {
  $('editorTitle').textContent = j.id ? 'Edit opportunity' : 'Add opportunity';
  $('editorBody').innerHTML = `
    <form class="panel-form" id="jobEdit">
      <div class="field-grid">
        <label>Sector (Private / Government)
          <select name="sector" id="v8SectorSelect">
            <option ${(j.sector||'Private')==='Private'?'selected':''}>Private</option>
            <option ${j.sector==='Government'?'selected':''}>Government</option>
            <option ${j.sector==='Public Sector'?'selected':''}>Public Sector</option>
          </select>
        </label>
        <p class="field-note wide" id="sectorFieldNote"></p>
        <label>Job Title / Role
          <input name="role" value="${val(j.role_normalized || j.role)}" placeholder="e.g. Civil Site Engineer">
        </label>
        <label>Company / Department
          <input name="company" value="${val(j.company || j.recruitment_authority)}" placeholder="e.g. KPWD, L&T, Metro">
        </label>

        <label>Country
          <input name="country" value="${val(j.country || 'India')}" placeholder="e.g. India">
        </label>
        <label>State / Region
          <input name="state" value="${val(j.state)}" placeholder="e.g. Karnataka">
        </label>
        <label>District
          <input name="district" value="${val(j.district)}" placeholder="e.g. Dharwad, Hassan">
        </label>
        <label>City / Town
          <input name="city" value="${val(j.city)}" placeholder="e.g. Bengaluru">
        </label>
        <label class="wide">Locations (Type freely, comma-separated)
          <input name="locations" value="${val(jobLocs(j).join(', '))}" placeholder="e.g. Bengaluru, Mysuru, Hubballi">
        </label>

        <label class="wide">Qualifications (Type freely, comma-separated)
          <input name="qualifications" value="${val(jobQuals(j).join(', '))}" placeholder="e.g. BE / BTech Civil, Diploma, ITI">
        </label>
        <label class="wide">Qualification Notes / Requirements
          <input name="qualification_notes" value="${val(j.qualification_notes)}" placeholder="e.g. Min 60% aggregate, valid GATE score">
        </label>
        <label>Experience
          <input name="experience_level" value="${val(j.experience_level || jobExps(j).join(', '))}" placeholder="e.g. 0-2 years, Fresher">
        </label>
        <label>Employment Type
          <input name="employment_type" value="${val(j.employment_type || 'Full-time')}" placeholder="e.g. Full-time, Contract">
        </label>

        <label>Salary / Pay Scale
          <input name="salary" value="${val(j.salary)}" placeholder="e.g. ₹40,000 - ₹60,000 / month">
        </label>
        <label>Application Email
          <input type="email" name="application_email" value="${val(j.application_email)}" placeholder="hr@company.com">
        </label>
        <label class="check">
          <input type="checkbox" name="application_email_private" ${j.application_email_private ? 'checked' : ''}> Keep email private
        </label>
        <label class="wide">Application Portal URL (Optional)
          <input type="url" name="application_url" value="${val(j.application_url)}" placeholder="https://example.com/apply">
        </label>
        <label class="wide">Official Notification PDF URL or Source Website (Optional)
          <input type="url" name="source_url" value="${val(j.source_url)}" placeholder="https://kpsc.kar.nic.in/notification.pdf">
        </label>

        <label data-gov-only>Recruitment Authority
          <input name="recruitment_authority" value="${val(j.recruitment_authority || j.company)}" placeholder="e.g. Karnataka PWD, KPSC, NHAI">
        </label>
        <label data-gov-only>Vacancies
          <input type="number" name="vacancy_count" value="${val(j.vacancy_count)}" placeholder="e.g. 319">
        </label>
        <label data-gov-only>Application Start Date
          <input type="date" name="application_start" value="${val(j.application_start)}">
        </label>
        <label data-gov-only>Application End Date
          <input type="date" name="deadline" value="${val(j.deadline)}">
        </label>
        <label data-gov-only>Age Limit
          <input name="age_limit" value="${val(j.age_limit)}" placeholder="e.g. 18-35 years, relaxations apply">
        </label>
        <label data-gov-only>Application Fee
          <input name="application_fee" value="${val(j.application_fee)}" placeholder="e.g. ₹250 (SC/ST exempt)">
        </label>
        <label data-gov-only>Last Verified
          <input type="date" name="last_verified" value="${val(j.last_verified)}">
        </label>
        <label data-gov-only class="wide">Online Apply URL (Official Portal)
          <input type="url" name="apply_url" value="${val(j.apply_url)}" placeholder="https://kpsc.kar.nic.in/apply">
        </label>

        <label class="wide">Description
          <textarea name="description" placeholder="Paste job overview or exam notification text">${val(j.description)}</textarea>
        </label>
        <label class="wide">Responsibilities
          <textarea name="responsibilities" placeholder="Key responsibilities">${val(j.responsibilities)}</textarea>
        </label>
        <label class="wide">Skills
          <textarea name="skills" placeholder="AutoCAD, Revit, Surveying, etc.">${val(j.skills)}</textarea>
        </label>

        <button type="submit" class="btn primary wide" style="margin-top:16px;">Save & Publish Opportunity</button>
      </div>
    </form>`;

  openEditor();

  /* Government-only fields disappear for Private jobs and return when the
     sector is switched back — the form dynamically matches the sector.
     FIX-2026-09-25: the old version used $(...) = getElementById with a CSS
     selector, so it always returned null and nothing was ever hidden. */
  const GOV_ONLY_FIELDS=['recruitment_authority','vacancy_count','application_start','deadline','age_limit','application_fee','last_verified','apply_url'];
  function syncV8SectorFields(){
    const sec=$('v8SectorSelect');if(!sec)return;
    const isGov=/gov|public/i.test(sec.value);
    const form=$('jobEdit');if(!form)return;
    form.querySelectorAll('[data-gov-only]').forEach(el=>el.classList.toggle('cc-gov-only-hidden',!isGov));
    const note=$('sectorFieldNote');
    if(note)note.textContent=isGov?'Government recruitment fields are shown below.':'Government recruitment fields are hidden for private jobs.';
  }
  window.syncV8SectorFields=syncV8SectorFields;
  $('v8SectorSelect')?.addEventListener('change',syncV8SectorFields);
  syncV8SectorFields();

  $('jobEdit').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const d = formObject(f);
    /* Hide (not delete) government fields for private jobs so their values are
       simply not sent rather than wiping data on an existing record. The list
       matches the fields the form hides for the Private sector. */
    const secSel=f.querySelector('[name="sector"]');
    if(secSel && !/gov|public/i.test(secSel.value)){
      GOV_ONLY_FIELDS.forEach(n=>{delete d[n];});
    }

    d.qualifications = arr(f.qualifications.value);
    d.locations = arr(f.locations.value);
    d.experience_ranges = arr(f.experience_level.value);
    d.employment_types = [d.employment_type || 'Full-time'];
    d.location_display = d.locations.join(' · ') || [d.city, d.state, d.country].filter(Boolean).join(', ');
    d.role_normalized = d.role || 'Civil Opportunity';
    d.role = d.role || 'Civil Opportunity';
    d.application_email_private = f.application_email_private.checked;
    d.application_emails = emailList([d.application_email, ...arr(j.application_emails)].join(' '));
    d.published = true;
    if (j.id) d.id = j.id;

    try {
      await api('/api/jobs', {
        method: j.id ? 'PATCH' : 'POST',
        key: adminKey,
        body: JSON.stringify(d)
      });
      $('editorDialog').close();
      await loadData();
      loadAdmin();
      toast('Opportunity saved successfully.');
    } catch (err) {
      if (/similar active job|already exists/i.test(err.message) && confirm(err.message + ' Publish anyway?')) {
        d.confirm_duplicate = true;
        await api('/api/jobs', {
          method: 'POST',
          key: adminKey,
          body: JSON.stringify(d)
        });
        $('editorDialog').close();
        await loadData();
        loadAdmin();
      } else {
        toast(err.message);
      }
    }
  };
};

function updateFilterUrl() {
  if (route !== 'private') return;
  const p = new URLSearchParams();
  [['cities', 'location'], ['roles', 'role'], ['state', 'state'], ['posted_days', 'posted'], ['experience', 'experience'], ['work_mode', 'work_mode'], ['employment_type', 'employment_type'], ['qualification', 'qualification']].forEach(([param, k]) => {
    if (ccFacetState.private[k]) p.set(param, ccFacetState.private[k]);
  });
  history.replaceState({}, '', `/private-jobs${p.toString() ? '?' + p : ''}`);
}

/* Restore filter state from the URL on first private render. */
if (typeof location!=='undefined'&&/private-jobs/.test(location.pathname)) {
  try{const q0=new URLSearchParams(location.search);const map0={cities:'location',roles:'role',state:'state',posted_days:'posted',experience:'experience',work_mode:'work_mode',employment_type:'employment_type',qualification:'qualification',role:'role'};for(const [param,key] of Object.entries(map0)){const v=q0.get(param);if(v)ccFacetState.private[key]=v}}catch{}
}
$('clearPrivateFilters')&&($('clearPrivateFilters').onclick = clearPrivate);
$('clearGovFilters')&&($('clearGovFilters').onclick = () => {
  for(const k of Object.keys(ccFacetState.gov))ccFacetState.gov[k]='';
  $$('#govScopeChips button').forEach((x,i)=>x.classList.toggle('active',i===0));
  renderGovFilterBar();
  renderGovernment(1);
});
$('privateFilterBtn')&&($('privateFilterBtn').onclick = () => $('privateFilters').classList.add('drawer-open'));
$('closePrivateFilters')&&($('closePrivateFilters').onclick = () => $('privateFilters').classList.remove('drawer-open'));
$('govFilterBtn')&&($('govFilterBtn').onclick = () => $('govFilters').classList.add('drawer-open'));
$('closeGovFilters')&&($('closeGovFilters').onclick = () => $('govFilters').classList.remove('drawer-open'));
$('showExpiredAdmin')&&($('showExpiredAdmin').onchange = () => loadAdmin());

const oldRenderAdmin = renderAdminLists;
renderAdminLists = function(emp, res, reports) {
  oldRenderAdmin(emp, res, reports);
  if (!$('showExpiredAdmin').checked) $$('#adminJobs .admin-list-item').forEach((el, i) => {
    if (jobs[i]?.status === 'Expired') el.remove();
  });
};


/* National portal SEO + crawlable content enhancements */
function ccSeoMeta({title,description,type='website',image='',published='',modified='',breadcrumbs=[],robots='index,follow'}={}){
  const base='https://civilcareer-india-two.vercel.app';
  const canonical=base+location.pathname;
  document.title=title||'CivilCareer';
  const set=(sel,attr,val)=>{let el=document.querySelector(sel);if(!el){el=document.createElement('meta');if(sel.includes('property=')){el.setAttribute('property',attr)}else{el.setAttribute('name',attr)}document.head.appendChild(el)}else{el.setAttribute(attr,val)}};
  let desc=document.querySelector('meta[name="description"]'); if(!desc){desc=document.createElement('meta');desc.name='description';document.head.appendChild(desc)} desc.content=description||'';
  let robotsMeta=document.querySelector('meta[name="robots"]'); if(!robotsMeta){robotsMeta=document.createElement('meta');robotsMeta.name='robots';document.head.appendChild(robotsMeta)} robotsMeta.content=robots||'index,follow';
  let can=document.querySelector('link[rel="canonical"]');if(!can){can=document.createElement('link');can.rel='canonical';document.head.appendChild(can)}can.href=canonical;
  const og=(name,val)=>{let el=document.querySelector(`meta[property="${name}"]`);if(!el){el=document.createElement('meta');el.setAttribute('property',name);document.head.appendChild(el)}el.content=val||''};
  og('og:title',title||'CivilCareer');og('og:description',description||'');og('og:url',canonical);og('og:type',type);if(image)og('og:image',image);
  const tw=(name,val)=>{let el=document.querySelector(`meta[name="${name}"]`);if(!el){el=document.createElement('meta');el.name=name;document.head.appendChild(el)}el.content=val||''};tw('twitter:title',title||'CivilCareer');tw('twitter:description',description||'');if(image)tw('twitter:image',image);
  let old=document.getElementById('cc-dynamic-jsonld');if(old)old.remove();
  const graph=[];
  if(breadcrumbs.length){graph.push({'@context':'https://schema.org','@type':'BreadcrumbList','itemListElement':breadcrumbs.map((b,i)=>({'@type':'ListItem','position':i+1,'name':b.name,'item':base+b.path}))})}
  if(type==='JobPosting'){
    const data=window.__ccJobSeo||{};
    graph.push(Object.assign({'@context':'https://schema.org','@type':'JobPosting','title':title,'description':description,'url':canonical,'datePosted':published||undefined,'dateModified':modified||published||undefined,'hiringOrganization':{'@type':'Organization','name':data.company||'Employer','sameAs':data.companyUrl||undefined},'jobLocation':data.location?{'@type':'Place','address':{'@type':'PostalAddress','addressLocality':data.location}}:undefined,'employmentType':data.employmentType||undefined},data.validThrough?{'validThrough':data.validThrough}:{}));
  } else if(type==='Article'){
    graph.push({'@context':'https://schema.org','@type':'Article','headline':title,'description':description,'url':canonical,'datePublished':published||undefined,'dateModified':modified||published||undefined,'publisher':{'@type':'Organization','name':'CivilCareer','url':base}});
  }
  if(graph.length){const sc=document.createElement('script');sc.type='application/ld+json';sc.id='cc-dynamic-jsonld';sc.textContent=JSON.stringify(graph.length===1?graph[0]:{'@context':'https://schema.org','@graph':graph});document.head.appendChild(sc)}
}

const oldJobCardV8=jobCard;
jobCard=function(j,gov=false){
  const html=oldJobCardV8(j,gov);
  const path=jobPath(j);
  return html.replace(`<button data-job="${j.id}">View Details</button>`,`<a class="detail-link" href="${esc(path)}" data-dynamic-route="true">View Job</a>`);
};

const oldExamCardV8=examCard;
examCard=function(x){
  const html=oldExamCardV8(x);
  const title=x.title_en;
  const slug=x.slug||String(x.code||title||'exam').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  return html.replace(`<button data-exam="${x.id}">View Complete Details</button>`,`<a class="detail-link" href="/exams/${esc(slug)}" data-dynamic-route="true">View Complete Details</a>`);
};

const oldMaterialCardV8=materialCard;
materialCard=function(m){
  const html=oldMaterialCardV8(m);
  const path=materialPath(m);
  return html.replace(`<button data-material-id="${m.id}">Preview</button>`,`<a class="detail-link" href="${esc(path)}" data-dynamic-route="true">Preview</a>`);
};

const oldOpenJobSeo=openJob;
openJob=function(j,push=true){
  const result=oldOpenJobSeo(j,push);
  const title=`${j.role||'Civil Engineering Job'} | CivilCareer`;
  const location=jobLocs(j).join(', ')||j.location_display||j.location||'';
  const description=short(String(j.description||`${j.role||'Civil engineering opportunity'} at ${j.company||'an employer'}. ${location}`),300);
  window.__ccJobSeo={company:j.company||j.recruitment_authority||'Employer',companyUrl:j.company_url||j.company_website||'',location,employmentType:j.employment_type||'',validThrough:j.deadline||j.expires_at||''};
  ccSeoMeta({title,description,type:closed?'Article':'JobPosting',published:pubDate(j),modified:j.updated_at||j.last_verified||pubDate(j),robots:closed?'noindex,follow':'index,follow',breadcrumbs:[{name:'Home',path:'/'},{name:govJob(j)?'Government Jobs':'Civil Jobs',path:govJob(j)?'/government-jobs':'/private-jobs'},{name:j.role||'Job',path:jobPath(j)}]});
  return result;
};
function govJob(j){return typeof isGovJob==='function'?isGovJob(j):['Government','Public Sector'].includes(j.sector)}

const oldOpenExamSeo=openExam;
openExam=function(x,push=true){
  const result=oldOpenExamSeo(x,push);
  const title0=x.title_en||x.code||'Government Exam';
  ccSeoMeta({title:`${title0} | CivilCareer`,description:short(String(x.overview||x.eligibility_en||`Government recruitment exam information for ${title0}.`),300),type:'Article',published:x.created_at||x.published_at||'',modified:x.updated_at||x.last_verified||x.created_at||'',breadcrumbs:[{name:'Home',path:'/'},{name:'Government Exams',path:'/exams'},{name:title0,path:`/exams/${x.slug||String(x.code||title0).toLowerCase().replace(/[^a-z0-9]+/g,'-')}`} ]});
  return result;
};

const oldOpenMaterialSeo=openMaterialDedicated;
openMaterialDedicated=function(m,push=true){
  const result=oldOpenMaterialSeo(m,push);
  const title0=m.title_en||m.title||'Study resource';
  ccSeoMeta({title:`${title0} | CivilCareer`,description:short(String(m.description_en||m.description||`Free study material on ${m.category||'civil engineering and competitive exams'}.`),300),type:'Article',published:m.created_at||'',modified:m.updated_at||m.created_at||'',breadcrumbs:[{name:'Home',path:'/'},{name:'Study Materials',path:'/study-materials'},{name:title0,path:materialPath(m)}]});
  return result;
};

async function routeV8() {
  if(await routeNationalLanding()) return;
  const p=location.pathname;
  if(p.startsWith('/jobs/')){
    const slug=decodeURIComponent(p.slice('/jobs/'.length));
    let j=jobs.find(x=>x.slug===slug || jobPath(x).split('/').pop()===slug);
    if(!j){
      try{j=(await api('/api/jobs?slug='+encodeURIComponent(slug))).job}catch{}
    }
    // Older jobs may not have a stored slug. Our generated URLs end with the
    // database id, so use that as a durable fallback for existing links.
    if(!j){
      const last=slug.split('-').pop();
      if(last) { try{j=(await api('/api/jobs?id='+encodeURIComponent(last))).job}catch{} }
    }
    if(j)return openJob(j,false);
    $('jobDetailPage').innerHTML='<article class="dedicated-card"><h1>Job not found</h1><p>This opportunity may have been removed or the link is incorrect.</p><div class="card-actions"><a href="/private-jobs" class="route" data-route="private">Browse active jobs</a></div></article>';
    return activateDynamic('jobDetail',p,false);
  }
  if(p.startsWith('/exams/')){
    const slug=decodeURIComponent(p.slice('/exams/'.length));
    let x=exams.find(e=>(e.slug||String(e.code||e.title_en).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''))===slug);
    if(!x){try{x=(await api('/api/exams?slug='+encodeURIComponent(slug))).exam}catch{}}
    if(x)return openExam(x,false);
    $('examDetailPage').innerHTML='<article class="dedicated-card"><h1>Exam not found</h1><p>This recruitment page may have been removed or the link is incorrect.</p><div class="card-actions"><a href="/exams" class="route" data-route="exams">Browse exams</a></div></article>';
    return activateDynamic('examDetail',p,false);
  }
  if(p.startsWith('/study-materials/')){
    const slug=decodeURIComponent(p.slice('/study-materials/'.length));
    const m=materials.find(x=>materialPath(x).split('/').pop()===slug || `${String(x.title_en||x.title||'resource').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120)}-${x.id}`===slug);
    if(m)return openMaterialDedicated(m,false);
    $('materialDetailPage').innerHTML='<article class="dedicated-card"><h1>Resource not found</h1><p>This study resource may have been removed or the link is incorrect.</p><div class="card-actions"><a href="/study-materials" class="route" data-route="materials">Browse study materials</a></div></article>';
    return activateDynamic('materialDetail',p,false);
  }
  navigate(pathRoute[p]||'home',false);
}

openMaterial=function(m,push=true){return openMaterialDedicated(m,push)};

document.addEventListener('click',e=>{
  const a=e.target.closest('a[data-dynamic-route]');
  if(!a || e.defaultPrevented || e.button!==0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target==='_blank') return;
  const href=a.getAttribute('href');
  if(!href || !href.startsWith('/')) return;
  e.preventDefault();
  history.pushState({},'',href);
  routeV8();
});

onpopstate = routeV8;
wireExplorer();wireExplorer2();
setTimeout(() => {
  refreshPrivateOptions();syncPrivateMirrors();
  renderPrivate();
  renderGovernment();
  routeV8();
}, 600);
