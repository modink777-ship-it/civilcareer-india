/* CivilCareer V8: structured lifecycle, dynamic filters, dedicated pages */
const CC_ROLES=['Civil Engineer','Site Engineer','Planning Engineer','Quantity Surveyor','Structural Engineer','Project Engineer','Estimation Engineer','Billing Engineer','QA/QC Engineer','Design Engineer','Construction Engineer','Project Coordinator','Other Civil/Construction Role'];
const CC_QUALS=['10th / SSLC','12th / PUC','ITI','Diploma','BE / BTech','ME / MTech','BSc','MSc','BA','MA','BCom','MCom','BBA','MBA','LLB','LLM','MBBS','Nursing','PhD','Any Graduate','Any Post Graduate','Other'];
const CC_EXP=['Fresher','0–1 years','1–3 years','3–5 years','5–8 years','8–10 years','10+ years'];
const CC_TYPES=['Full-time','Part-time','Contract','Internship','Apprenticeship','Freelance','Temporary'];
const CC_LOC={India:{Karnataka:['Bengaluru','Mysuru','Mangaluru','Hubballi','Belagavi','Shivamogga','Tumakuru','Hassan','Ballari'],Maharashtra:['Mumbai','Pune','Nagpur'],Telangana:['Hyderabad'],'Tamil Nadu':['Chennai','Coimbatore'],Kerala:['Kochi','Thiruvananthapuram'],'Andhra Pradesh':['Visakhapatnam','Vijayawada'],Delhi:['New Delhi'],Gujarat:['Ahmedabad','Surat']},UAE:{Dubai:['Dubai'],'Abu Dhabi':['Abu Dhabi'],Sharjah:['Sharjah']},'Saudi Arabia':{Riyadh:['Riyadh'],Makkah:['Jeddah']},Qatar:{Doha:['Doha']},Kuwait:{Kuwait:['Kuwait City']},Oman:{Muscat:['Muscat']},Bahrain:{Capital:['Manama']},Other:{Other:['Other']}};
const arr=(v,f='')=>Array.isArray(v)?v:(v?String(v).split(',').map(x=>x.trim()).filter(Boolean):(f?[f]:[]));
const pubDate=j=>j.published_at||j.posted_at||j.created_at||j.posted_date||'';
const active=j=>j.status!=='Expired'&&(!j.expires_at||new Date(j.expires_at)>new Date())&&(!j.deadline||new Date(j.deadline+'T23:59:59')>new Date());
function ago(v){if(!v)return'';const d=Math.max(0,Math.floor((Date.now()-new Date(v))/86400000));return d===0?'Posted today':d===1?'Posted yesterday':`Posted ${d} days ago`}
function emailList(t){return[...new Set((String(t||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}/gi)||[]).filter(e=>/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,63}$/.test(e)))]}
function setOpts(id,vals,label){const el=$(id),keep=el.value,counts={};vals.filter(Boolean).forEach(v=>counts[v]=(counts[v]||0)+1);el.innerHTML=`<option value="">${label}</option>`+Object.keys(counts).sort().map(v=>`<option value="${esc(v)}">${esc(v)} (${counts[v]})</option>`).join('');if([...el.options].some(o=>o.value===keep))el.value=keep}
function jobLocs(j){return arr(j.locations,j.location_display||j.location)}function jobQuals(j){return arr(j.qualifications,j.qualification)}function jobExps(j){return arr(j.experience_ranges,j.experience_level)}function jobTypes(j){return arr(j.employment_types,j.employment_type)}
function activePrivate(){return jobs.filter(j=>(j.sector||'Private')==='Private'&&active(j))}
function refreshPrivateOptions(){const a=activePrivate(),country=$('privateCountry').value,state=$('privateState').value;setOpts('privateCountry',a.map(j=>j.country||'India'),'All countries');setOpts('privateState',a.filter(j=>!country||(j.country||'India')===country).map(j=>j.state),'All states / regions');setOpts('privateCity',a.filter(j=>(!country||(j.country||'India')===country)&&(!state||j.state===state)).flatMap(j=>[j.city,j.district]),'All cities / districts');setOpts('privateRole',a.map(j=>j.role_normalized||j.role),'All roles');setOpts('privateQualification',a.flatMap(jobQuals),'All qualifications');setOpts('privateExperience',a.flatMap(jobExps),'All experience levels');setOpts('privateType',a.flatMap(jobTypes),'All employment types')}
function chipBox(ids,target,render){const a=ids.map(id=>$(id)).filter(x=>x&&x.value);$(target).innerHTML=a.map(x=>`<button data-clear-filter="${x.id}">${esc(x.options?.[x.selectedIndex]?.text.replace(/ \(\d+\)$/,'')||x.value)} ×</button>`).join('');$$(`#${target} [data-clear-filter]`).forEach(b=>b.onclick=()=>{$(b.dataset.clearFilter).value='';render()})}
renderPrivate=function(){refreshPrivateOptions();let a=activePrivate();const c=$('privateCountry').value,s=$('privateState').value,city=$('privateCity').value,r=$('privateRole').value,q=$('privateQualification').value,e=$('privateExperience').value,t=$('privateType').value,days=+$('privatePosted').value,min=+$('privateSalary').value;a=a.filter(j=>!c||(j.country||'India')===c).filter(j=>!s||j.state===s).filter(j=>!city||j.city===city||j.district===city||jobLocs(j).some(x=>x.includes(city))).filter(j=>!r||(j.role_normalized||j.role)===r).filter(j=>!q||jobQuals(j).includes(q)).filter(j=>!e||jobExps(j).includes(e)).filter(j=>!t||jobTypes(j).includes(t)).filter(j=>!days||Date.now()-new Date(pubDate(j))<=days*86400000).filter(j=>!min||Number(j.salary_max||j.salary_min||0)>=min);a.sort($('privateSort').value==='deadline'?(x,y)=>(x.deadline||'9999').localeCompare(y.deadline||'9999'):(x,y)=>new Date(pubDate(y))-new Date(pubDate(x)));$('privateCount').textContent=`${a.length} active opportunit${a.length===1?'y':'ies'}`;$('privateJobs').innerHTML=a.length?a.map(x=>jobCard(x)).join(''):`<div class="empty-state"><h3>No matching opportunities found.</h3><p>Remove one filter, clear all filters, or view all active jobs.</p><button class="btn secondary" id="emptyClear">Clear all filters</button></div>`;chipBox(['privateCountry','privateState','privateCity','privateRole','privateQualification','privateExperience','privateType'],'privateFilterChips',renderPrivate);if($('emptyClear'))$('emptyClear').onclick=clearPrivate;bindCards();updateFilterUrl()}
function clearPrivate(){['privateCountry','privateState','privateCity','privateRole','privateQualification','privateExperience','privateType','privatePosted','privateSalary'].forEach(id=>$(id).value='');renderPrivate()}
renderGovernment=function(){let a=jobs.filter(j=>['Government','Public Sector'].includes(j.sector)),status=$('govStatus').value;const activeSet=a.filter(active);setOpts('govDepartment',activeSet.map(j=>j.recruitment_authority||j.company||j.discipline),'All departments');setOpts('govLocation',activeSet.flatMap(j=>[j.city,j.district,j.location_display||j.location]),'All locations');setOpts('govQualification',activeSet.flatMap(jobQuals),'All qualifications');const d=$('govDepartment').value,l=$('govLocation').value,q=$('govQualification').value;a=a.filter(j=>status==='closed'?!active(j):status==='active'?active(j):true).filter(j=>!d||[j.recruitment_authority,j.company,j.discipline].includes(d)).filter(j=>!l||[j.city,j.district,j.location_display,j.location].includes(l)).filter(j=>!q||jobQuals(j).includes(q));a.sort($('govSort').value==='deadline'?(x,y)=>(x.deadline||'9999').localeCompare(y.deadline||'9999'):(x,y)=>new Date(pubDate(y))-new Date(pubDate(x)));$('governmentCount').textContent=`${a.length} recruitment opportunit${a.length===1?'y':'ies'}`;$('governmentJobs').innerHTML=a.length?a.map(x=>jobCard(x,true)).join(''):empty('No matching opportunities found.','Remove one filter or clear all filters.');chipBox(['govDepartment','govLocation','govQualification','govStatus'],'govFilterChips',renderGovernment);bindCards()}
jobCard=function(j,gov=false){const closed=!active(j),loc=jobLocs(j).join(' · ')||j.location_display||j.location;return`<article class="job-card"><div class="card-top"><span class="pill ${closed?'closed':j.featured?'featured':'verified'}">${closed?'Expired':j.featured?'Featured':'Active'}</span><span class="verified-date">${ago(pubDate(j))}</span></div><h3>${esc(j.role)}</h3><div class="organization">${esc(j.company||j.recruitment_authority||'Organization')}</div><div class="card-meta"><span>${esc(loc||'Location in source')}</span>${jobQuals(j).slice(0,2).map(x=>`<span>${esc(x)}</span>`).join('')}${jobExps(j).slice(0,1).map(x=>`<span>${esc(x)}</span>`).join('')}</div><p class="card-copy">${esc(short(j.description||'Verify details at the original source.'))}</p><div class="card-actions"><button data-job="${j.id}">View Details</button></div></article>`}
function activateDynamic(name,path,push=true){route=name;$$('.page').forEach(p=>p.classList.toggle('active',p.dataset.page===name));if(push)history.pushState({},'',path);scrollTo(0,0)}
function jobPath(j){return`/jobs/${j.slug||String(j.role||'job').toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+j.id}`}
function materialPath(m){return`/study-materials/${String(m.slug||m.title_en||'resource').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120)}-${m.id}`}
function openMaterialDedicated(m,push=true){
  if(!m)return;
  const title=lang==='kn'&&m.title_kn?m.title_kn:(m.title_en||m.title||'Study resource');
  const url=m.file_url||m.pdf_url||m.preview_url||'';
  $('materialDetailPage').innerHTML=`<article class="dedicated-card"><div class="detail-kicker">Study material · ${esc(m.category||'Civil Engineering')}</div><h1>${esc(title)}</h1>${m.author?`<p class="detail-lead">By ${esc(m.author)}</p>`:''}<div class="detail-grid"><div class="detail"><b>Category</b>${esc(m.category||'Study resource')}</div>${m.subject?`<div class="detail"><b>Subject / Topic</b>${esc(m.subject)}</div>`:''}${m.page_count?`<div class="detail"><b>Pages</b>${esc(m.page_count)}</div>`:''}<div class="detail full"><b>Description</b>${richText(m.description_en||m.description||'Open the resource to review its contents.')}</div></div><div class="card-actions">${url?`<a href="${esc(url)}" target="_blank" rel="noopener">OPEN RESOURCE ↗</a>`:''}${m.preview_url&&m.preview_url!==url?`<a href="${esc(m.preview_url)}" target="_blank" rel="noopener">Preview ↗</a>`:''}</div><div class="callout">Only use materials shared by their owner or with appropriate permission.</div></article>`;
  activateDynamic('materialDetail',materialPath(m),push);document.title=`${title} | CivilCareer`;
}
openJob=function(j,push=true){if(!j)return;const closed=!active(j),email=!j.application_email_private&&j.application_email,loc=jobLocs(j).join(' · ')||j.location_display||j.location;$('jobDetailPage').innerHTML=`<article class="dedicated-card"><div class="detail-kicker">${closed?'Expired opportunity':'Verified opportunity'} · ${ago(pubDate(j))}</div><h1>${esc(j.role)}</h1><p class="detail-lead">${esc(j.company||'Organization')} · ${esc(loc||'Location in source')}</p>${closed?'<div class="expired-banner">This opportunity has expired and is retained for transparency. Do not treat it as open.</div>':''}<div class="detail-grid"><div class="detail"><b>Qualifications</b>${esc(jobQuals(j).join(' · ')||'Check source')}</div><div class="detail"><b>Experience</b>${esc(jobExps(j).join(' · ')||'Not stated')}</div><div class="detail"><b>Employment</b>${esc(jobTypes(j).join(' · ')||'Not stated')}</div><div class="detail"><b>Published</b>${date(String(pubDate(j)).slice(0,10))}</div><div class="detail full"><b>Description</b>${richText(j.description)}</div>${j.responsibilities?`<div class="detail full"><b>Responsibilities</b>${richText(j.responsibilities)}</div>`:''}${j.skills?`<div class="detail full"><b>Skills</b>${richText(j.skills)}</div>`:''}</div>${email?`<div class="email-apply"><b>Apply via Email</b><span>${esc(email)}</span><button data-copy-email="${esc(email)}">Copy email</button><a href="mailto:${esc(email)}">Email Application</a></div>`:''}<div class="card-actions"><a href="${esc(j.application_url || j.source_url)}" target="_blank" rel="noopener">APPLY NOW ↗</a><a href="${esc(j.source_url)}" target="_blank" rel="noopener">View original source ↗</a></div><div class="callout">Always verify the job, deadline and application instructions at the original source. Never pay for a job.</div></article>`;activateDynamic('jobDetail',jobPath(j),push);document.title=`${j.role} — ${j.company||'CivilCareer'}`;$$('[data-copy-email]').forEach(b=>b.onclick=()=>navigator.clipboard.writeText(b.dataset.copyEmail).then(()=>toast('Email copied.')))}
openExam=function(x,push=true){if(!x)return;const title=lang==='kn'&&x.title_kn?x.title_kn:x.title_en,closed=x.application_end&&new Date(x.application_end+'T23:59:59')<new Date();$('examDetailPage').innerHTML=`<article class="dedicated-card exam-detail-page"><div class="detail-kicker">${closed?'Application Closed':esc(x.status||'Active')} · Last verified ${date(x.last_verified)}</div><h1>${esc(title)}</h1><p class="detail-lead">${esc(x.authority||'Authority in notification')}</p>${x.overview?`<p class="exam-intro">${richText(x.overview)}</p>`:''}<section class="exam-detail-section"><h3>Quick Information</h3><div class="exam-overview"><div><b>Authority</b>${esc(x.authority||'Check source')}</div><div><b>Vacancies</b>${esc(x.vacancy_count||'Not stated')}</div><div><b>Qualification</b>${richText(x.eligibility_en)}</div><div><b>Application fee</b>${richText(x.application_fee)}</div></div></section>${examSection('Important Dates',x.important_dates_details)}${examSection('Eligibility',x.eligibility_en)}${examSection('Vacancies',x.vacancy_breakdown)}${examSection('Exam Pattern',x.exam_pattern)}${examSection('Syllabus',x.syllabus)}${examSection('Application Process',x.how_to_apply)}<section class="exam-detail-section"><h3>Official Links</h3><div class="card-actions">${x.official_website_url?`<a href="${esc(x.official_website_url)}" target="_blank">Official Website ↗</a>`:''}${x.official_notification_url?`<a href="${esc(x.official_notification_url)}" target="_blank">Official Notification ↗</a>`:''}${x.apply_url?`<a href="${esc(x.apply_url)}" target="_blank">Apply Online ↗</a>`:''}</div></section><div class="callout">Always verify dates, eligibility and application instructions in the official notification before applying.</div></article>`;const p=`/exams/${x.slug||String(x.code||title).toLowerCase().replace(/[^a-z0-9]+/g,'-')}`;activateDynamic('examDetail',p,push);document.title=`${title} | CivilCareer`}
function scanEmails(){const found=emailList($('importJobText').value),sel=$('detectedEmailSelect'),manual=$('importApplicationEmail');sel.innerHTML=found.length?found.map(e=>`<option value="${esc(e)}">${esc(e)}</option>`).join(''):'<option value="">No valid email detected</option>';if(found.length&&!manual.value)manual.value=found[0]}
const oldImport=importJobLink;importJobLink=async function(){scanEmails();await oldImport()};$('importJobText').addEventListener('input',scanEmails);$('useDetectedEmail').onclick=()=>{if($('detectedEmailSelect').value)$('importApplicationEmail').value=$('detectedEmailSelect').value};$('importJobBtn').onclick=async()=>{const url=$('importJobUrl').value.trim(),text=$('importJobText').value.trim();if(!url&&!text)return importStatus('importJobStatus','Paste a URL or source text.','error');const b=$('importJobBtn');b.disabled=true;try{const data=await api('/api/extract',{method:'POST',key:adminKey,body:JSON.stringify({url,text})}),x=data.job||{};x.application_email=$('importApplicationEmail').value||x.application_email;x.application_emails=emailList(text);jobEditor(x)}catch(e){importStatus('importJobStatus',e.message,'error')}finally{b.disabled=false}};
function multi(name,items,selected=[]){return`<input name="${name}" placeholder="Type ${name} (comma-separated)" value="${selected.join(', ')}">`}

jobEditor = function(j = {}) {
  $('editorTitle').textContent = j.id ? 'Edit opportunity' : 'Add opportunity';
  $('editorBody').innerHTML = `
    <form class="panel-form" id="jobEdit">
      <div class="field-grid">
        <label>Sector (Private / Government)
          <input name="sector" value="${val(j.sector || 'Private')}" placeholder="Private or Government">
        </label>
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
        <label>Application Deadline
          <input type="date" name="deadline" value="${val(j.deadline)}">
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

  $('jobEdit').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const d = formObject(f);

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
      if (/similar active job/i.test(err.message) && confirm(err.message + ' Publish anyway?')) {
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
  [['country', 'privateCountry'], ['state', 'privateState'], ['city', 'privateCity'], ['role', 'privateRole'], ['qualification', 'privateQualification'], ['experience', 'privateExperience']].forEach(([k, id]) => {
    if ($(id).value) p.set(k, $(id).value);
  });
  history.replaceState({}, '', `/private-jobs${p.toString() ? '?' + p : ''}`);
}

['privateCountry', 'privateState', 'privateCity', 'privateRole', 'privateQualification', 'privateExperience', 'privateType', 'privatePosted', 'privateSalary'].forEach(id => $(id).onchange = renderPrivate);
$('clearPrivateFilters').onclick = clearPrivate;
$('clearGovFilters').onclick = () => {
  ['govDepartment', 'govLocation', 'govQualification'].forEach(id => $(id).value = '');
  $('govStatus').value = 'active';
  renderGovernment();
};
$('privateFilterBtn').onclick = () => $('privateFilters').classList.add('drawer-open');
$('closePrivateFilters').onclick = () => $('privateFilters').classList.remove('drawer-open');
$('govFilterBtn').onclick = () => $('govFilters').classList.add('drawer-open');
$('closeGovFilters').onclick = () => $('govFilters').classList.remove('drawer-open');
$('showExpiredAdmin').onchange = () => loadAdmin();

const oldRenderAdmin = renderAdminLists;
renderAdminLists = function(emp, res, reports) {
  oldRenderAdmin(emp, res, reports);
  if (!$('showExpiredAdmin').checked) $$('#adminJobs .admin-list-item').forEach((el, i) => {
    if (jobs[i]?.status === 'Expired') el.remove();
  });
};


/* National portal SEO + crawlable content enhancements */
function ccSeoMeta({title,description,type='website',image='',published='',modified='',breadcrumbs=[]}={}){
  const base='https://civilcareer-india-two.vercel.app';
  const canonical=base+location.pathname+location.search;
  document.title=title||'CivilCareer';
  const set=(sel,attr,val)=>{let el=document.querySelector(sel);if(!el){el=document.createElement('meta');if(sel.includes('property=')){el.setAttribute('property',attr)}else{el.setAttribute('name',attr)}document.head.appendChild(el)}else{el.setAttribute(attr,val)}};
  let desc=document.querySelector('meta[name="description"]'); if(!desc){desc=document.createElement('meta');desc.name='description';document.head.appendChild(desc)} desc.content=description||'';
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
  return html.replace(`<button data-job="${j.id}">View Details</button>`,`<a class="detail-link" href="${esc(path)}" data-dynamic-route="true">View Details</a>`);
};

const oldExamCardV8=examCard;
examCard=function(x){
  const html=oldExamCardV8(x);
  const title=lang==='kn'&&x.title_kn?x.title_kn:x.title_en;
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
  ccSeoMeta({title,description,type:'JobPosting',published:pubDate(j),modified:j.updated_at||j.last_verified||pubDate(j),breadcrumbs:[{name:'Home',path:'/'},{name:govJob(j)?'Government Jobs':'Civil Jobs',path:govJob(j)?'/government-jobs':'/private-jobs'},{name:j.role||'Job',path:jobPath(j)}]});
  return result;
};
function govJob(j){return ['Government','Public Sector'].includes(j.sector)}

const oldOpenExamSeo=openExam;
openExam=function(x,push=true){
  const result=oldOpenExamSeo(x,push);
  const title0=lang==='kn'&&x.title_kn?x.title_kn:x.title_en||x.code||'Government Exam';
  ccSeoMeta({title:`${title0} | CivilCareer`,description:short(String(x.overview||x.eligibility_en||`Government recruitment exam information for ${title0}.`),300),type:'Article',published:x.created_at||x.published_at||'',modified:x.updated_at||x.last_verified||x.created_at||'',breadcrumbs:[{name:'Home',path:'/'},{name:'Government Exams',path:'/exams'},{name:title0,path:`/exams/${x.slug||String(x.code||title0).toLowerCase().replace(/[^a-z0-9]+/g,'-')}`} ]});
  return result;
};

const oldOpenMaterialSeo=openMaterialDedicated;
openMaterialDedicated=function(m,push=true){
  const result=oldOpenMaterialSeo(m,push);
  const title0=lang==='kn'&&m.title_kn?m.title_kn:(m.title_en||m.title||'Study resource');
  ccSeoMeta({title:`${title0} | CivilCareer`,description:short(String(m.description_en||m.description||`Free study material on ${m.category||'civil engineering and competitive exams'}.`),300),type:'Article',published:m.created_at||'',modified:m.updated_at||m.created_at||'',breadcrumbs:[{name:'Home',path:'/'},{name:'Study Materials',path:'/study-materials'},{name:title0,path:materialPath(m)}]});
  return result;
};

async function routeV8() {
  const p=location.pathname;
  if(p.startsWith('/jobs/')){
    const slug=decodeURIComponent(p.slice('/jobs/'.length));
    let j=jobs.find(x=>x.slug===slug);
    if(!j){try{j=(await api('/api/jobs?slug='+encodeURIComponent(slug))).job}catch{}}
    if(j)return openJob(j,false);
    $('jobDetailPage').innerHTML='<article class="dedicated-card"><h1>Job not found</h1><p>This opportunity may have been removed or the link is incorrect.</p><div class="card-actions"><a href="/private-jobs" class="route" data-route="private">Browse active jobs</a></div></article>';
    return activateDynamic('jobDetail',p,false);
  }
  if(p.startsWith('/exams/')){
    const slug=decodeURIComponent(p.slice('/exams/'.length));
    let x=exams.find(e=>(e.slug||String(e.code||e.title_en).toLowerCase().replace(/[^a-z0-9]+/g,'-'))===slug);
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

onpopstate = routeV8;
setTimeout(() => {
  refreshPrivateOptions();
  renderPrivate();
  renderGovernment();
  routeV8();
}, 600);
