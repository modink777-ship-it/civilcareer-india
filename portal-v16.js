/* CivilCareer — Phases 6 + 14 + 15 + 16
   Free-only portal core, admin intelligence, safe discovery helpers and performance UX.
*/
(function(){
  'use strict';
  const $cc=id=>document.getElementById(id);
  const escCC=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const arrCC=v=>Array.isArray(v)?v:String(v||'').split(',').map(x=>x.trim()).filter(Boolean);
  const expMinCC=j=>Number.isFinite(Number(j.experience_min))?Number(j.experience_min):(
    String((Array.isArray(j.experience_ranges)?j.experience_ranges:j.experience_level||'')).match(/\d+(?:\.\d+)?/)||[0])[0]*1;
  const salMinCC=j=>Number(j.salary_min||j.salary_max||0);
  const activeCC=j=>typeof active==='function'?active(j):(j.status!=='Expired'&&(!j.deadline||new Date(j.deadline+'T23:59:59')>new Date()));

  function enhancePrivate(){
    const host=$cc('privateJobs'); if(!host)return;
    const q=$cc('globalQuery')?.value?.trim().toLowerCase()||'';
    let a=(typeof activePrivate==='function'?activePrivate():jobs.filter(j=>(j.sector||'Private')==='Private'&&activeCC(j)));
    if(q)a=a.filter(j=>[j.role,j.company,j.description,j.skills,j.qualification,j.location,j.city,j.state].join(' ').toLowerCase().includes(q));
    const sort=$cc('privateSort')?.value||'new';
    a.sort((x,y)=>{
      if(sort==='oldest')return new Date(pubDate(x))-new Date(pubDate(y));
      if(sort==='closing_soon')return String(x.deadline||'9999').localeCompare(String(y.deadline||'9999'));
      if(sort==='salary_high')return salMinCC(y)-salMinCC(x);
      return new Date(pubDate(y))-new Date(pubDate(x));
    });
    // Add compact sector/relevance context without replacing existing renderer.
    const count=$cc('privateCount'); if(count)count.textContent=`${a.length} active opportunit${a.length===1?'y':'ies'}`;
    if(a.length && typeof jobCard==='function')host.innerHTML=a.map(x=>jobCard(x,false)).join('');
    if(typeof bindCards==='function')bindCards();
  }

  function injectPortalControls(){
    const privateSort=$cc('privateSort');
    if(privateSort && !privateSort.querySelector('option[value="salary_high"]')){
      privateSort.insertAdjacentHTML('beforeend','<option value="salary_high">Highest salary</option>');
    }
    const govFilters=$cc('govFilters');
    if(govFilters && !$cc('govExperience')){
      const marker=$cc('govQualification');
      if(marker) marker.insertAdjacentHTML('afterend','<label>Experience<select id="govExperience"><option value="">All experience levels</option></select></label><label>Minimum salary<input id="govSalary" type="number" min="0" step="1000" placeholder="Optional"></label>');
    }
    if($cc('privateJobs') && !$cc('privatePortalNote')){
      const head=$cc('privateJobs').parentElement?.querySelector('.results-head');
      if(head){const n=document.createElement('div');n.id='privatePortalNote';n.className='portal-note';n.textContent='Search across role, employer, skills and location. Filters update instantly.';head.after(n)}
    }
  }

  const oldRP=window.renderPrivate;
  window.renderPrivate=function(){
    if(typeof oldRP==='function')oldRP();
    // Preserve the V8 renderer's filtering, then add query/sort improvements only when requested.
    const sort=$cc('privateSort')?.value;
    if(sort==='salary_high') enhancePrivate();
  };
  const oldRG=window.renderGovernment;
  window.renderGovernment=function(){
    if(typeof oldRG==='function')oldRG();
    const ex=$cc('govExperience')?.value, min=Number($cc('govSalary')?.value||0);
    if(!ex&&!min)return;
    const host=$cc('governmentJobs'); if(!host)return;
    let a=jobs.filter(j=>['Government','Public Sector'].includes(j.sector)&& (activeCC(j) || $cc('govStatus')?.value==='closed'));
    const d=$cc('govDepartment')?.value,l=$cc('govLocation')?.value,q=$cc('govQualification')?.value;
    a=a.filter(j=>!d||[j.recruitment_authority,j.company,j.discipline].includes(d))
      .filter(j=>!l||[j.city,j.district,j.location_display,j.location].includes(l))
      .filter(j=>!q||arrCC(j.qualifications||j.qualification).includes(q))
      .filter(j=>!ex||arrCC(j.experience_ranges||j.experience_level).includes(ex))
      .filter(j=>!min||salMinCC(j)>=min);
    host.innerHTML=a.length?a.map(x=>jobCard(x,true)).join(''):`<div class="empty-state"><h3>No matching recruitment found.</h3><p>Try a broader experience or salary filter.</p></div>`;
    if(typeof bindCards==='function')bindCards();
  };

  // Admin intelligence: derive useful zero-cost metrics from data already loaded.
  function renderLocalAdminInsights(){
    const panel=$cc('analyticsPanel'); if(!panel)return;
    const all=Array.isArray(jobs)?jobs:[];
    const pub=all.filter(j=>j.published&&activeCC(j)), gov=pub.filter(j=>['Government','Public Sector'].includes(j.sector)), priv=pub.filter(j=>!['Government','Public Sector'].includes(j.sector));
    const roles={}, locs={}, sources={}, employers={};
    pub.forEach(j=>{
      const role=j.role_normalized||j.role||'Other'; roles[role]=(roles[role]||0)+1;
      const loc=j.city||j.state||j.location_display||j.location||'Unspecified'; locs[loc]=(locs[loc]||0)+1;
      let src='Direct'; try{src=j.source_url?new URL(j.source_url).hostname.replace(/^www\./,''):'Direct'}catch{}
      sources[src]=(sources[src]||0)+1;
      const emp=j.company||j.recruitment_authority||'Unspecified'; employers[emp]=(employers[emp]||0)+1;
    });
    const top=o=>Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,7);
    const block=(title,rows)=>`<div class="dash-card"><h3>${title}</h3>${rows.length?rows.map(([k,v])=>`<div class="bar-row"><span>${escCC(k)}</span><div class="bar"><i style="width:${Math.max(4,v/Math.max(...rows.map(x=>x[1]))*100)}%"></i></div><b>${v}</b></div>`).join(''):'<p>No data yet.</p>'}</div>`;
    const existing=panel.querySelector('.cc-local-insights'); if(existing)existing.remove();
    const wrap=document.createElement('div');wrap.className='cc-local-insights dashboard-grid';
    wrap.innerHTML=`<div class="dash-card"><h3>Live inventory</h3><div class="insight-grid"><div><b>${pub.length}</b><span>Open published</span></div><div><b>${gov.length}</b><span>Government</span></div><div><b>${priv.length}</b><span>Private</span></div><div><b>${all.filter(j=>!j.published).length}</b><span>Draft / review</span></div></div></div>${block('Popular roles',top(roles))}${block('Popular locations',top(locs))}${block('Source coverage',top(sources))}${block('Employers',top(employers))}`;
    panel.appendChild(wrap);
  }

  const oldLoadAdmin=window.loadAdmin;
  if(typeof oldLoadAdmin==='function'){
    window.loadAdmin=async function(){await oldLoadAdmin();renderLocalAdminInsights();};
  }

  // Discovery health card in admin, based on existing jobs only.
  function discoveryHealth(){
    const host=$cc('adminJobs'); if(!host)return;
    if($cc('ccDiscoveryHealth'))return;
    const all=Array.isArray(jobs)?jobs:[];
    const drafts=all.filter(j=>!j.published), dupKeys=new Set(), dup=all.filter(j=>{
      const k=[j.role_normalized||j.role,j.company,j.city||j.location].map(x=>String(x||'').toLowerCase().trim()).join('|');
      if(!k||dupKeys.has(k))return !!k; dupKeys.add(k); return false;
    });
    const box=document.createElement('div');box.id='ccDiscoveryHealth';box.className='smart-import cc-health';
    box.innerHTML=`<p class="eyebrow">Discovery health</p><div class="insight-grid"><div><b>${drafts.length}</b><span>Draft / review</span></div><div><b>${dup.length}</b><span>Potential duplicates</span></div><div><b>${all.filter(j=>j.expires_at&&new Date(j.expires_at)<new Date()).length}</b><span>Past expiry</span></div></div><small>Imported opportunities remain unpublished until reviewed. Duplicate detection is advisory so legitimate multi-location vacancies are not silently discarded.</small>`;
    host.prepend(box);
  }

  // Performance: lazy-load images that may be added by future content and avoid duplicate layout work.
  function performanceUX(){
    document.querySelectorAll('img:not([loading])').forEach(img=>{img.loading='lazy';img.decoding='async'});
    document.querySelectorAll('a[target="_blank"]:not([rel])').forEach(a=>a.rel='noopener');
    if('requestIdleCallback' in window)requestIdleCallback(()=>{try{navigator.storage?.estimate?.()}catch{}},{timeout:1500});
  }

  // Lightweight offline banner; never claims that live job data is current offline.
  function offlineUX(){
    if(!$cc('ccOffline')){const n=document.createElement('div');n.id='ccOffline';n.className='offline-banner';n.textContent='You are offline. Showing saved pages where available; live job data may be out of date.';n.hidden=navigator.onLine;document.body.prepend(n);window.addEventListener('online',()=>n.hidden=true);window.addEventListener('offline',()=>n.hidden=false)}
  }

  injectPortalControls();
  ['govExperience','govSalary'].forEach(id=>{const el=$cc(id);if(el){el.addEventListener('change',window.renderGovernment);el.addEventListener('input',window.renderGovernment)}});
  const ps=$cc('privateSort'); if(ps)ps.addEventListener('change',window.renderPrivate);
  performanceUX();offlineUX();
  setTimeout(()=>{injectPortalControls();if(typeof renderLocalAdminInsights==='function'&&$cc('adminDashboard')&&!$cc('adminDashboard').hidden)renderLocalAdminInsights();discoveryHealth()},900);
  window.addEventListener('load',performanceUX,{once:true});
})();
