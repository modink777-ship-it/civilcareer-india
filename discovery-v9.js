/* CivilCareer V9 — free job discovery, relevance search, saved jobs and related opportunities */
(function(){
  const DISCOVERY_VERSION='v9';
  const norm=v=>String(v||'').toLowerCase().replace(/[^a-z0-9+.#\-\s]/g,' ').replace(/\s+/g,' ').trim();
  const words=v=>norm(v).split(' ').filter(x=>x.length>1);
  const list=v=>Array.isArray(v)?v:String(v||'').split(',').map(x=>x.trim()).filter(Boolean);
  const jobText=j=>norm([
    j.role,j.role_normalized,j.company,j.recruitment_authority,j.discipline,j.description,j.responsibilities,
    j.skills,j.qualifications,j.qualification,j.experience_level,j.experience_ranges,j.employment_type,
    j.employment_types,j.location,j.location_display,j.locations,j.city,j.state,j.country
  ].flatMap(v=>Array.isArray(v)?v:[v]).join(' '));
  const titleText=j=>norm([j.role,j.role_normalized].join(' '));
  const locationText=j=>norm([j.location,j.location_display,j.locations,j.city,j.district,j.state,j.country].flatMap(v=>Array.isArray(v)?v:[v]).join(' '));
  const tokenMatch=(q,text)=>words(q).filter(t=>text.includes(t));
  const aliases={
    qs:['quantity surveyor','quantity surveying','qs','estimator','estimation'],
    site:['site engineer','site supervisor','civil engineer','construction engineer'],
    planning:['planning engineer','planner','planning'],
    structural:['structural engineer','structural'],
    qaqc:['qa qc','quality engineer','quality control','qaqc'],
    bim:['bim','building information modelling','revit'],
    autocad:['autocad','cad'],
    pm:['project manager','project engineer','project coordinator'],
    kpsc:['kpsc','karnataka public service commission'],
    govt:['government','govt','public sector','recruitment']
  };
  function expandedTokens(q){
    const base=words(q),out=new Set(base);
    Object.entries(aliases).forEach(([k,vals])=>{if(base.includes(k)||vals.some(v=>norm(q).includes(v)))vals.forEach(v=>out.add(v));});
    return [...out];
  }
  function scoreJob(j,q,loc){
    const query=norm(q),location=norm(loc),text=jobText(j),title=titleText(j),lt=locationText(j);
    let score=0, reasons=[];
    if(query){
      const qt=expandedTokens(query), exact=qt.filter(t=>text.includes(t));
      if(title.includes(query)){score+=55;reasons.push('Title match');}
      else if(title.split(' ').some(w=>qt.includes(w))){score+=38;reasons.push('Role match');}
      else score+=Math.min(30,exact.length*7);
      if(norm(j.company).includes(query)||norm(j.recruitment_authority).includes(query)){score+=20;reasons.push('Organization match');}
      if(norm(j.discipline).includes(query)){score+=12;reasons.push('Discipline match');}
      if(exact.length)reasons.push(`${exact.length} keyword${exact.length===1?'':'s'} match`);
    } else score+=20;
    if(location){
      const ltokens=words(location),matches=ltokens.filter(t=>lt.includes(t));
      if(lt.includes(location)){score+=35;reasons.push('Location match');}
      else if(matches.length){score+=22;reasons.push('Location match');}
      else if(lt.includes('remote')||lt.includes('work from home')){score+=8;reasons.push('Remote option');}
      else score-=8;
    } else score+=10;
    if(active(j))score+=12; else score-=30;
    const age=Date.now()-new Date(pubDate(j)||0).getTime();
    if(Number.isFinite(age)&&age>=0){if(age<2*86400000)score+=10;else if(age<7*86400000)score+=6;else if(age<30*86400000)score+=2;}
    if(j.featured)score+=2;
    return {score,reasons:[...new Set(reasons)].slice(0,3)};
  }
  function saveRecentSearch(q,loc){
    if(!q&&!loc)return;
    let a=[];try{a=JSON.parse(localStorage.getItem('cc_recent_searches')||'[]')}catch{}
    const item={q:String(q||'').trim(),loc:String(loc||'').trim()};
    a=[item,...a.filter(x=>norm(x.q)!==norm(item.q)||norm(x.loc)!==norm(item.loc))].slice(0,6);
    localStorage.setItem('cc_recent_searches',JSON.stringify(a));
  }
  function recentSearches(){try{return JSON.parse(localStorage.getItem('cc_recent_searches')||'[]')}catch{return[]}}
  function updateSavedCount(){
    const count=Object.values(jobInteractions||{}).filter(v=>v==='saved').length;
    $$('[data-saved-count]').forEach(el=>el.textContent=count?String(count):'');
  }
  function enhancedJobCard(j,gov=false){
    const closed=!active(j),saved=getSaved().has(j.id),loc=jobLocs(j).join(' · ')||j.location_display||j.location||'Location in source';
    const apply=j.application_url||j.apply_url||j.source_url||'';
    return `<article class="job-card discovery-job-card ${closed?'is-closed':''}">
      <div class="card-top"><span class="pill ${closed?'closed':j.featured?'featured':'verified'}">${closed?'Expired':j.featured?'Featured':'Active'}</span><span class="verified-date">${ago(pubDate(j))}</span></div>
      <h3>${esc(j.role||'Civil Engineering Opportunity')}</h3>
      <div class="organization">${esc(j.company||j.recruitment_authority||'Organization')}</div>
      <div class="card-meta"><span>📍 ${esc(loc)}</span>${jobQuals(j).slice(0,2).map(x=>`<span>${esc(x)}</span>`).join('')}${jobExps(j).slice(0,1).map(x=>`<span>${esc(x)}</span>`).join('')}</div>
      <p class="card-copy">${esc(short(j.description||'Verify the complete details at the original source.'))}</p>
      <div class="card-actions"><a class="detail-link" href="${esc(jobPath(j))}" data-dynamic-route="true">View Details</a>${!closed&&apply?`<a class="btn-apply" href="${esc(apply)}" target="_blank" rel="noopener" data-apply-job="${esc(j.id)}">Apply ↗</a>`:''}<button class="btn-save ${saved?'saved':''}" data-save-job="${esc(j.id)}" title="${saved?'Remove saved job':'Save job'}">${saved?'★ Saved':'☆ Save'}</button></div>
    </article>`;
  }
  jobCard=enhancedJobCard;

  const oldBindCards=bindCards;
  bindCards=function(){
    oldBindCards();
    $$('[data-save-job]').forEach(b=>b.onclick=e=>{
      e.preventDefault();e.stopPropagation();
      toggleSave(b.dataset.saveJob);
      const saved=getSaved().has(b.dataset.saveJob);
      b.classList.toggle('saved',saved);b.textContent=saved?'★ Saved':'☆ Save';b.title=saved?'Remove saved job':'Save job';
      updateSavedCount();toast(saved?'Job saved!':'Bookmark removed.');
      if(route==='foryou')renderForYou();
    });
    $$('[data-apply-job]').forEach(a=>a.onclick=()=>{saveInteractionLocal(a.dataset.applyJob,'applied');track('job_apply',a.dataset.applyJob)});
    updateSavedCount();
  };

  function renderSearchV9(q='',loc='',type='all',sort='relevance'){
    const root=$('searchResults');if(!root)return;
    q=String(q||'').trim();loc=String(loc||'').trim();
    const rows=[];
    jobs.forEach(j=>{const s=scoreJob(j,q,loc);if((!q&&!loc)||s.score>0)rows.push({kind:['Government','Public Sector'].includes(j.sector)?'Government Job':'Civil Job',title:j.role||'Civil Engineering Opportunity',sub:j.company||j.recruitment_authority||j.location,job:j,score:s.score,reasons:s.reasons,url:jobPath(j)});});
    exams.forEach(x=>{const text=norm([x.code,x.title_en,x.title_kn,x.authority,x.post_names,x.notification_number,x.overview,x.eligibility_en].join(' '));const qt=expandedTokens(q);const hit=!q||qt.some(t=>text.includes(t));if(hit&&!loc)rows.push({kind:'Exam',title:`${x.code||''}${x.code?' — ':''}${x.title_en||'Government Exam'}`,sub:x.authority||'Examination update',exam:x,score:q?(qt.filter(t=>text.includes(t)).length*12+20):20,url:`/exams/${x.slug||String(x.code||x.title_en||'exam').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')}`});});
    materials.forEach(m=>{const text=norm([m.title_en,m.title_kn,m.category,m.exam_code,m.subject,m.description_en].join(' '));const qt=expandedTokens(q);const hit=!q||qt.some(t=>text.includes(t));if(hit&&!loc)rows.push({kind:'Resource',title:m.title_en||m.title||'Study resource',sub:m.category||m.exam_code||'Free resource',material:m,score:q?(qt.filter(t=>text.includes(t)).length*10+15):15,url:materialPath(m)});});
    const filtered=rows.filter(r=>type==='all'||(type==='jobs'&&/Job$/.test(r.kind))||(type==='exams'&&r.kind==='Exam')||(type==='resources'&&r.kind==='Resource'));
    filtered.sort((a,b)=>sort==='newest'?(new Date(pubDate(b.job)||b.exam?.created_at||b.material?.created_at||0)-new Date(pubDate(a.job)||a.exam?.created_at||a.material?.created_at||0)):b.score-a.score);
    saveRecentSearch(q,loc);
    const count=filtered.length;
    $('searchSummary').textContent=count?`${count} result${count===1?'':'s'}${q?` for “${esc(q)}”`:''}${loc?` near “${esc(loc)}”`:''}`:'No matching results.';
    root.innerHTML=count?filtered.slice(0,80).map(r=>`<article class="job-card discovery-result"><div class="card-top"><span class="pill">${esc(r.kind)}</span>${r.score>45&&q?'<span class="match-label">Relevant match</span>':''}</div><h3>${esc(r.title)}</h3><div class="organization">${esc(r.sub||'')}</div>${r.job?`<div class="card-meta"><span>📍 ${esc(jobLocs(r.job).join(' · ')||r.job.location||'Location in source')}</span>${jobExps(r.job).slice(0,1).map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:''}<p class="card-copy">${esc(r.job?short(r.job.description||'Verify details at the original source.'):r.exam?short(r.exam.overview||'Government examination information.'):short(r.material?.description_en||'Free study resource.'))}</p><div class="card-actions"><a class="detail-link" href="${esc(r.url)}" data-dynamic-route="true">View Details</a></div></article>`).join(''):empty('No results found','Try a broader role, skill, organization or location.');
    bindCards();
  }

  function installSearchPanel(){
    const page=document.querySelector('[data-page="search"]');if(!page||page.dataset.v9Search)return;
    page.dataset.v9Search='1';
    const hero=page.querySelector('.page-hero');
    if(hero)hero.insertAdjacentHTML('afterend',`<div class="container discovery-search-panel"><form id="advancedSearchForm" class="advanced-search-form"><label><span>What are you looking for?</span><input id="advancedQuery" autocomplete="off" placeholder="Civil Engineer, QS, KPSC, AutoCAD…"></label><label><span>Location</span><input id="advancedLocation" placeholder="Bengaluru, Karnataka, India, Gulf…"></label><label><span>Type</span><select id="advancedType"><option value="all">Everything</option><option value="jobs">Jobs</option><option value="exams">Exams</option><option value="resources">Resources</option></select></label><label><span>Sort</span><select id="advancedSort"><option value="relevance">Most relevant</option><option value="newest">Newest first</option></select></label><button class="btn primary">Search</button></form><div class="recent-searches" id="recentSearches"></div></div>`);
    $('advancedSearchForm').onsubmit=e=>{e.preventDefault();const q=$('advancedQuery').value.trim(),l=$('advancedLocation').value.trim(),t=$('advancedType').value,s=$('advancedSort').value;history.replaceState({},'',`/search${q||l?`?${new URLSearchParams({...(q?{q}:{}),...(l?{location:l}:{})})}`:''}`);renderSearchV9(q,l,t,s);track('search','advanced');};
    renderRecentSearches();
  }
  function renderRecentSearches(){
    const el=$('recentSearches');if(!el)return;const a=recentSearches();el.innerHTML=a.length?`<span>Recent:</span>`+a.map(x=>`<button type="button" data-recent-q="${esc(x.q)}" data-recent-l="${esc(x.loc)}">${esc(x.q||'All jobs')}${x.loc?` · ${esc(x.loc)}`:''}</button>`).join(''):'<span>Search tips: try a role, skill, company, exam code or city.</span>';
    $$('[data-recent-q]').forEach(b=>b.onclick=()=>{$('advancedQuery').value=b.dataset.recentQ||'';$('advancedLocation').value=b.dataset.recentL||'';renderSearchV9(b.dataset.recentQ,b.dataset.recentL,$('advancedType').value,$('advancedSort').value)});
  }

  const oldSearch=search;
  search=function(q,loc=''){
    navigate('search');
    installSearchPanel();
    if($('advancedQuery'))$('advancedQuery').value=q||'';
    if($('advancedLocation'))$('advancedLocation').value=loc||'';
    renderSearchV9(q,loc,'all','relevance');
    renderRecentSearches();
    track('search','universal');
  };

  function relatedJobs(current){
    const base=jobs.filter(j=>j.id!==current.id&&active(j));
    const ctext=jobText(current),cloc=locationText(current),crole=titleText(current),skills=list(current.skills||current.qualifications);
    return base.map(j=>{
      const jt=jobText(j),jl=locationText(j),jr=titleText(j);let s=0;
      if(crole&&jr&&crole.split(' ').some(w=>w.length>3&&jr.includes(w)))s+=35;
      const common=skills.filter(x=>jt.includes(norm(x))).length;s+=Math.min(30,common*10);
      if(cloc&&jl&&cloc.split(' ').some(w=>w.length>3&&jl.includes(w)))s+=20;
      if(j.sector===current.sector)s+=8;
      if(j.featured)s+=2;
      return {...j,_relatedScore:s};
    }).filter(j=>j._relatedScore>=25).sort((a,b)=>b._relatedScore-a._relatedScore).slice(0,4);
  }

  const currentOpenJob=openJob;
  openJob=function(j,push=true){
    if(!j)return;
    saveRecentJob(j.id);
    const result=currentOpenJob(j,push);
    const page=$('jobDetailPage');if(page){
      const related=relatedJobs(j);
      const apply=j.application_url||j.apply_url||j.source_url||'';
      const share=`${location.origin}${jobPath(j)}`;
      const extras=`<div class="job-discovery-tools"><button type="button" class="btn secondary" data-copy-job-url="${esc(share)}">Copy job link</button><button type="button" class="btn secondary" data-share-job="${esc(share)}">Share</button>${!active(j)?'':`<button type="button" class="btn-save ${getSaved().has(j.id)?'saved':''}" data-save-job="${esc(j.id)}">${getSaved().has(j.id)?'★ Saved':'☆ Save'}</button>`}</div>${related.length?`<section class="related-jobs"><div class="section-head"><div><p class="eyebrow">More opportunities</p><h2>Related civil engineering jobs</h2></div><a class="text-link" href="/private-jobs" data-route="private">View all →</a></div><div class="cards two">${related.map(x=>enhancedJobCard(x,['Government','Public Sector'].includes(x.sector))).join('')}</div></section>`:''}`;
      page.insertAdjacentHTML('beforeend',extras);
      bindCards();
      $$('[data-copy-job-url]').forEach(b=>b.onclick=()=>navigator.clipboard?.writeText(b.dataset.copyJobUrl).then(()=>toast('Job link copied.')));
      $$('[data-share-job]').forEach(b=>b.onclick=async()=>{const data={title:j.role||'CivilCareer job',text:`${j.role||'Civil engineering opportunity'} at ${j.company||'CivilCareer'}`,url:b.dataset.shareJob};if(navigator.share){try{await navigator.share(data)}catch{}}else{await navigator.clipboard?.writeText(data.url);toast('Job link copied.')}});
    }
    return result;
  };

  function saveRecentJob(id){
    let a=[];try{a=JSON.parse(localStorage.getItem('cc_recent_jobs')||'[]')}catch{}
    a=[String(id),...a.map(String).filter(x=>x!==String(id))].slice(0,8);localStorage.setItem('cc_recent_jobs',JSON.stringify(a));
  }
  function recentJobs(){let a=[];try{a=JSON.parse(localStorage.getItem('cc_recent_jobs')||'[]')}catch{};return a.map(id=>jobs.find(j=>String(j.id)===String(id))).filter(Boolean)}

  const oldForYou=renderForYou;
  renderForYou=function(){
    const c=$('forYouJobs');if(!c)return;
    const saved=jobs.filter(j=>getSaved().has(j.id));
    const recent=recentJobs().filter(j=>!getSaved().has(j.id));
    oldForYou();
    const existing=c.innerHTML;
    const sections=[];
    if(saved.length)sections.push(`<section class="saved-section"><div class="section-head"><div><p class="eyebrow">Your shortlist</p><h2>Saved jobs <span class="count-badge">${saved.length}</span></h2></div></div><div class="cards two">${saved.slice(0,4).map(j=>enhancedJobCard(j,['Government','Public Sector'].includes(j.sector))).join('')}</div>${saved.length>4?'<p class="muted-note">Your remaining saved jobs stay in your browser on this device.</p>':''}</section>`);
    if(recent.length)sections.push(`<section class="recent-section"><div class="section-head"><div><p class="eyebrow">Recently viewed</p><h2>Pick up where you left off</h2></div></div><div class="cards two">${recent.slice(0,4).map(j=>enhancedJobCard(j,['Government','Public Sector'].includes(j.sector))).join('')}</div></section>`);
    if(sections.length)c.innerHTML=sections.join('')+`<section class="match-section"><div class="section-head"><div><p class="eyebrow">Personalized</p><h2>Recommended for you</h2></div></div>${existing}</section>`;
    bindCards();updateSavedCount();
  };

  // Fix the profile form fields/close behavior while keeping the existing local-only model.
  const oldSaveProfile=saveProfile;
  saveProfile=function(){
    userProfile={...userProfile,name:$('pName')?.value||'',job_title:$('pJobTitle')?.value||'',experience_years:parseFloat($('pExp')?.value)||null,education:$('pEdu')?.value||'',skills:$('pSkills')?.value||''};
    userPrefs={...userPrefs,target_roles:$('pTargetRoles')?.value||'',skills_wanted:$('pSkillsWanted')?.value||'',preferred_locations:$('pLocations')?.value||'',experience_min:parseFloat($('pExpMin')?.value)||null,experience_max:parseFloat($('pExpMax')?.value)||null,salary_min:parseFloat($('pSalMin')?.value)||null,sectors:$('pSector')?.value||'Both'};
    saveProfileLocal();closeProfileModal();toast('Profile saved! Finding your matches…');navigate('foryou');renderForYou();
  };

  // Improve the matching text and include structured V8 fields.
  const oldMatchScore=matchScore;
  matchScore=function(job){
    const base=oldMatchScore(job);if(!base)return base;
    const all=jobText(job);const wanted=list(userPrefs.skills_wanted||userProfile.skills);const matched=wanted.filter(s=>all.includes(norm(s)));
    if(wanted.length){base.reasons=base.reasons.filter(x=>!/^\d+\/\d+ skills match$/.test(x));if(matched.length)base.reasons.unshift(`${matched.length}/${wanted.length} skills match`);}
    return base;
  };

  // Search controls can also be opened directly by /search?q=...&location=...
  const oldRouteV9=routeV8;
  routeV8=async function(){
    await oldRouteV9();
    if(location.pathname==='/search'){
      installSearchPanel();
      const p=new URLSearchParams(location.search);const q=p.get('q')||'';const l=p.get('location')||'';
      if($('advancedQuery'))$('advancedQuery').value=q;if($('advancedLocation'))$('advancedLocation').value=l;
      renderSearchV9(q,l,'all','relevance');renderRecentSearches();
    }
  };

  setTimeout(()=>{installSearchPanel();updateSavedCount();},250);
})();
