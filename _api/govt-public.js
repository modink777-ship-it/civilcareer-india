'use strict';

const { isOfficialGovtUrl: official, OFFICIAL_GOVT_HOSTS } = require('./govt-jobs');

const SUPA=String(process.env.SUPABASE_URL||'').replace(/\/+$/,'');
const KEY=String(process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY||'');
const SITE=String(process.env.SITE_URL||'https://civilcareer-india-two.vercel.app').replace(/\/+$/,'');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const db=async path=>fetch(`${SUPA}/rest/v1/${path}`,{headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,Accept:'application/json'}});
const dbWithHeaders=async(path,headers)=>fetch(`${SUPA}/rest/v1/${path}`,{headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json',...headers}});
const slug=v=>String(v||'government-job').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,90)||'government-job';
const days=d=>d?Math.floor((Date.parse(d+'T00:00:00Z')-Date.parse(new Date().toISOString().slice(0,10)+'T00:00:00Z'))/86400000):null;
const sourceHost=u=>{try{return official(u)?new URL(u).hostname.toLowerCase().replace(/^www\./,''):'';}catch(_){return '';}};
function layout(title,desc,canonical,body,robots='index,follow'){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="${robots}"><title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(canonical)}"><link rel="stylesheet" href="/styles.css"><script src="/theme.js" defer></script></head><body><header class="site-header"><div class="container nav"><a class="logo" href="/">Civil<span>Career</span></a><nav><a href="/private-jobs">Private Jobs</a><a href="/government-jobs">Government Jobs</a><a href="/exams">Exams</a></nav></div></header><main class="container article-page" style="padding-top:48px;padding-bottom:72px">${body}</main><footer><div class="container footer-bottom"><p>CivilCareer is an independent information directory. Always verify important information with the original official source.</p><span>© 2026 CivilCareer</span></div></footer></body></html>`;}

function textValue(value){
  if(value===null||value===undefined||value==='')return 'Not disclosed';
  if(Array.isArray(value))return value.map(textValue).join(', ');
  if(typeof value==='object')return Object.entries(value).map(([key,item])=>`${key}: ${textValue(item)}`).join('; ');
  return String(value).slice(0,1000);
}
function renderFacts(value){
  if(!value||typeof value!=='object')return `<p>${esc(textValue(value))}</p>`;
  const entries=Array.isArray(value)?value.map((item,index)=>[String(index+1),item]):Object.entries(value);
  const facts=entries.filter(([,item])=>item!==null&&item!==undefined&&item!=='');
  return facts.length?`<dl>${facts.map(([key,item])=>`<dt>${esc(String(key).replace(/[_-]+/g,' '))}</dt><dd>${esc(textValue(item))}</dd>`).join('')}</dl>`:'<p>Not disclosed</p>';
}
function renderTimeline(dates,applyEnd){
  const entries=dates&&typeof dates==='object'&&!Array.isArray(dates)?Object.entries(dates):[];
  if(applyEnd&&!entries.some(([key])=>['apply_end','application_end'].includes(String(key).toLowerCase())))entries.push(['application_end',applyEnd]);
  const visible=entries.filter(([,value])=>value!==null&&value!==undefined&&value!=='');
  if(!visible.length)return '<p>No recruitment dates have been disclosed. Check the official notification.</p>';
  return `<ol>${visible.map(([key,value])=>`<li><strong>${esc(String(key).replace(/[_-]+/g,' '))}:</strong> ${esc(textValue(value))}</li>`).join('')}</ol>`;
}
function ageRanges(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return [];
  return Object.entries(value).flatMap(([category,criteria])=>{
    let min,max;
    if(criteria&&typeof criteria==='object'&&!Array.isArray(criteria)){
      min=Number(criteria.min_age??criteria.min);
      max=Number(criteria.max_age??criteria.max);
    }else{
      const range=String(criteria||'').match(/(?:^|[^\d])(\d{1,2})\s*(?:years?\s*)?(?:-|to|–|—)\s*(\d{1,2})(?:\s*years?)?/i);
      if(range){min=Number(range[1]);max=Number(range[2]);}
    }
    return Number.isInteger(min)&&Number.isInteger(max)&&min>=0&&max>=min&&max<=100
      ?[{category:String(category),min,max}]
      :[];
  });
}
function renderAgeChecker(value,asOf){
  const ranges=ageRanges(value);
  const validAsOf=typeof asOf==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(asOf)&&!Number.isNaN(Date.parse(asOf))&&new Date(asOf+'T00:00:00Z').toISOString().slice(0,10)===asOf;
  if(!ranges.length||!validAsOf)return '<p>Age criteria are not stored with both a clear age range and a valid reference date. Compare your circumstances with the official notification; no automatic age assessment is available.</p>';
  return `<div class="callout"><h3>Age range self-check only</h3><p>Enter your age in completed years as of ${esc(textValue(asOf))}. This compares only the stored age band; it is not an eligibility decision. Your entry stays in this browser and is not saved or sent to CivilCareer.</p><label>Age in completed years<input id="govt-age-value" type="number" min="0" max="100" step="1" inputmode="numeric"></label><label>Category<select id="govt-age-category">${ranges.map(range=>`<option value="${esc(range.category)}" data-min="${range.min}" data-max="${range.max}">${esc(range.category)} (${range.min}–${range.max})</option>`).join('')}</select></label><button class="btn secondary" id="govt-age-check" type="button">Check stored age band</button><p id="govt-age-result" role="status" aria-live="polite"></p></div><script>(()=>{const age=document.getElementById('govt-age-value');const category=document.getElementById('govt-age-category');const button=document.getElementById('govt-age-check');const result=document.getElementById('govt-age-result');button.addEventListener('click',()=>{const value=Number(age.value);if(age.value===''||!Number.isInteger(value)||value<0||value>100){result.textContent='Enter an age from 0 to 100 in completed years.';return;}const option=category.selectedOptions[0];const min=Number(option.dataset.min);const max=Number(option.dataset.max);result.textContent=value>=min&&value<=max?'Your age is within this stored range only. Verify qualification, relaxations and every other rule in the official notification.':'Your age is outside this stored range. Check official relaxation rules and the notification before deciding.';});})();</script>`;
}
function renderJobCard(job){
  const host=sourceHost(job.official_notice_url);
  const reviewed=job.reviewed_at?new Date(job.reviewed_at).toLocaleDateString('en-IN'):'Not recorded';
  const deadline=job.deadline_kind==='fixed'?(job.apply_end||'Not announced'):(job.deadline_text||'Notified Soon');
  const compare=JSON.stringify({
    title:job.title||'Not disclosed',
    organization:job.organization||'Not disclosed',
    scope:job.scope==='state'?'State':'Central',
    state:job.state||'All India',
    civilPosts:job.civil_posts_count==null?'Not disclosed':job.civil_posts_count,
    deadline,
    source:host,
    reviewed,
  });
  return `<article class="card" data-govt-compare data-compare="${esc(compare)}"><span class="eyebrow">${esc(job.scope==='state'?'State':'Central')} · ${esc(job.state||'All India')}</span><h2>${esc(job.title)}</h2><p><strong>${esc(job.organization)}</strong></p><p>${esc(job.civil_posts_count==null?'Civil posts: not stated':job.civil_posts_count+' civil posts of '+(job.total_posts_in_notification||job.civil_posts_count))}</p><p>Deadline: <strong>${esc(deadline)}</strong></p><p>Official source: <a href="${esc(job.official_notice_url)}" target="_blank" rel="noopener noreferrer">${esc(host)} ↗</a><br>Last reviewed: ${esc(reviewed)}</p><label><input type="checkbox" data-govt-compare-choice> Compare this recruitment</label><p><a class="text-link" href="/government-jobs/${encodeURIComponent(slug(job.slug))}">View details →</a></p></article>`;
}
function renderCompareTool(){
  return `<div class="govt-compare-controls"><span id="govt-compare-count" aria-live="polite">0 selected (choose up to 3)</span><button class="btn secondary" id="govt-compare-run" type="button" disabled>Compare selected</button><button class="text-link" id="govt-compare-clear" type="button">Clear</button></div><section id="govt-compare-results" hidden aria-live="polite"><h2>Compare government recruitments</h2><div id="govt-compare-table" style="overflow-x:auto"></div></section><script>(()=>{const cards=[...document.querySelectorAll('[data-govt-compare]')];const count=document.getElementById('govt-compare-count');const run=document.getElementById('govt-compare-run');const clear=document.getElementById('govt-compare-clear');const results=document.getElementById('govt-compare-results');const tableWrap=document.getElementById('govt-compare-table');const selected=()=>cards.filter(card=>card.querySelector('[data-govt-compare-choice]').checked);const update=()=>{const n=selected().length;count.textContent=n+' selected (choose up to 3)';run.disabled=n<2||n>3;};cards.forEach(card=>card.querySelector('[data-govt-compare-choice]').addEventListener('change',event=>{if(selected().length>3){event.target.checked=false;count.textContent='Select no more than 3 recruitments.';}else update();}));run.addEventListener('click',()=>{const jobs=selected().map(card=>JSON.parse(card.dataset.compare));if(jobs.length<2||jobs.length>3)return;const fields=[['Recruitment','title'],['Organization','organization'],['Government level','scope'],['State','state'],['Civil posts','civilPosts'],['Deadline','deadline'],['Official source','source'],['Last reviewed','reviewed']];const table=document.createElement('table');const head=document.createElement('tr');const first=document.createElement('th');first.textContent='Details';head.appendChild(first);jobs.forEach(job=>{const cell=document.createElement('th');cell.textContent=job.title;head.appendChild(cell);});const thead=document.createElement('thead');thead.appendChild(head);table.appendChild(thead);const tbody=document.createElement('tbody');fields.slice(1).forEach(([label,key])=>{const row=document.createElement('tr');const heading=document.createElement('th');heading.textContent=label;row.appendChild(heading);jobs.forEach(job=>{const cell=document.createElement('td');cell.textContent=String(job[key]);row.appendChild(cell);});tbody.appendChild(row);});table.appendChild(tbody);tableWrap.replaceChildren(table);results.hidden=false;results.scrollIntoView({behavior:'smooth',block:'start'});});clear.addEventListener('click',()=>{cards.forEach(card=>{card.querySelector('[data-govt-compare-choice]').checked=false;});results.hidden=true;tableWrap.replaceChildren();update();});})();</script>`;
}

async function rowsByFilter(p){
  const parts=['status=eq.active'];
  const page=Math.min(10000,Math.max(1,parseInt(p.get('page')||'1',10)||1));
  const perPage=Math.min(50,Math.max(1,parseInt(p.get('per_page')||'25',10)||25));
  const verifiedDomains=['gov.in','nic.in',...OFFICIAL_GOVT_HOSTS];
  const sourceFilters=verifiedDomains.flatMap(domain=>[
    `official_notice_url.ilike.https://%.${domain}`,
    `official_notice_url.ilike.https://%.${domain}/%`,
    `official_notice_url.ilike.https://${domain}`,
    `official_notice_url.ilike.https://${domain}/%`,
  ]);
  const andFilters=[`or(${sourceFilters.join(',')})`];
  const cleanFilter=value=>String(value||'').trim().slice(0,120).replace(/[*%,()'"\\]/g,' ').replace(/\s+/g,' ').trim();
  const search=cleanFilter(p.get('q'));
  if(search) andFilters.push(`or(title.ilike.*${search}*,organization.ilike.*${search}*,department_category.ilike.*${search}*)`);
  parts.push('and='+encodeURIComponent('('+andFilters.join(',')+')'));
  const state=cleanFilter(p.get('state'));
  const department=cleanFilter(p.get('department'));
  const role=cleanFilter(p.get('role'));
  const scope=String(p.get('scope')||'').toLowerCase();
  if(state) parts.push('state=ilike.*'+encodeURIComponent(state)+'*');
  if(['central','state'].includes(scope)) parts.push('scope=eq.'+scope);
  if(department) parts.push('department_category=ilike.*'+encodeURIComponent(department)+'*');
  if(role) parts.push('title=ilike.*'+encodeURIComponent(role)+'*');
  const offset=(page-1)*perPage;
  const r=await dbWithHeaders('govt_jobs?select=id,title,slug,organization,department_category,scope,state,civil_posts_count,total_posts_in_notification,apply_end,deadline_kind,deadline_text,official_notice_url,official_apply_url,reviewed_at,summary&'+parts.join('&')+'&order=apply_end.asc.nullslast,published_at.desc&limit='+perPage+'&offset='+offset,{Prefer:'count=exact'});
  if(!r.ok) throw new Error(`Government listing query failed (${r.status}).`);
  const rows=await r.json();
  if(!Array.isArray(rows)) throw new Error('Government listing query returned an invalid response.');
  const range=String(r.headers&&r.headers.get&&r.headers.get('content-range')||'');
  const match=range.match(/\/(\d+)$/);
  if(!match) throw new Error('Government listing total could not be verified.');
  return {rows,total:Number(match[1]),page,perPage};
}
module.exports=async function(req,res){
  if(req.method!=='GET') return res.status(405).send('Method not allowed');
  if(!SUPA||!KEY) return res.status(503).send('Government page data is not configured.');
  try{
    const p=new URL(req.url||'/',SITE).searchParams;
    const detail=p.get('job');
    if(detail){
      const r=await db('govt_jobs?slug=eq.'+encodeURIComponent(detail)+'&status=eq.active&select=*&limit=1');
      if(!r.ok) throw new Error('lookup failed');
      const jobs=await r.json(); const j=jobs[0];
      if(!j||!official(j.official_notice_url)) return res.status(404).send(layout('Government Job Not Found | CivilCareer','This government recruitment page is unavailable.',SITE+'/government-jobs/'+encodeURIComponent(detail),'<h1>Government job not found</h1><p>The recruitment may have closed or its official notification source could not be verified.</p>','noindex,follow'));
      const pr=await db('govt_job_posts?govt_job_id=eq.'+encodeURIComponent(j.id)+'&is_civil=eq.true&select=post_name,vacancies,pay,qualification,qualification_levels,selection_process');
      if(!pr.ok) throw new Error(`Government post details query failed (${pr.status}).`);
      const posts=await pr.json();
      if(!Array.isArray(posts)) throw new Error('Government post details returned an invalid response.');
      const officialUrl=j.official_notice_url;
      const applyUrl=official(j.official_apply_url)?j.official_apply_url:'';
      const host=sourceHost(officialUrl);
      const left=days(j.apply_end);
      const deadline=j.deadline_kind==='fixed'?(j.apply_end?new Date(j.apply_end+'T00:00:00Z').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'Not announced'):(j.deadline_text||'Notified Soon');
      const reviewed=j.reviewed_at?new Date(j.reviewed_at).toLocaleDateString('en-IN'):'Not recorded';
      const timeline=renderTimeline(j.dates,j.apply_end);
      const previousDeadline=j.previous_apply_end&&j.previous_apply_end!==j.apply_end
        ?`<div class="callout"><strong>Previously recorded deadline:</strong> ${esc(j.previous_apply_end)}. Current recorded deadline: ${esc(j.apply_end||deadline)}. Check the official notice to confirm the change.</div>`
        :'';
      const body=`
        <p class="eyebrow">Government Civil Recruitment · ${esc(j.scope==='state'?'State':'Central')}</p>
        <h1>${esc(j.title)}</h1>
        <p class="lead">${esc(j.organization)} · ${esc(j.state||'All India')}</p>
        <p><strong>Official source:</strong> <a href="${esc(officialUrl)}" target="_blank" rel="noopener noreferrer">${esc(host)} ↗</a><br><strong>Last reviewed:</strong> ${esc(reviewed)}</p>
        <div class="callout"><strong>Verify at the official source.</strong><p>Dates, vacancies, eligibility, fees and application rules can change.</p><p>Deadline: <b>${esc(deadline)}</b>${left!==null&&left>=0?' · '+esc(left===0?'Closing today':left+' days left'):''}</p></div>
        <h2>Civil posts</h2>
        ${posts.length?`<div style="overflow-x:auto"><table><thead><tr><th>Post</th><th>Vacancies</th><th>Qualification</th><th>Pay</th><th>Selection</th></tr></thead><tbody>${posts.map(x=>'<tr><td>'+esc(x.post_name||'Not disclosed')+'</td><td>'+esc(x.vacancies==null?'Not disclosed':x.vacancies)+'</td><td>'+esc(x.qualification||'Not disclosed')+'</td><td>'+esc(textValue(x.pay))+'</td><td>'+esc(x.selection_process||'Not disclosed')+'</td></tr>').join('')}</tbody></table></div>`:'<p>Civil post details are not disclosed. Consult the official notification.</p>'}
        <h2>Recruitment timeline</h2>${timeline}
        <h2>Eligibility information</h2>
        <p>Use these published criteria as a reference only; CivilCareer does not determine eligibility. Confirm category-specific rules in the official notification.</p>
        <p><strong>Age limits by category:</strong></p>${renderFacts(j.age_limit_by_category)}
        <p><strong>Age calculated as of:</strong> ${esc(textValue(j.age_as_on))}</p>
        ${renderAgeChecker(j.age_limit_by_category,j.age_as_on)}
        <h2>Application fee</h2>${renderFacts(j.fee_by_category)}
        <p><strong>Payment mode:</strong> ${esc(textValue(j.payment_mode))}</p>
        <h2>How to apply</h2><p>${esc(textValue(j.how_to_apply))}</p>
        <h2>Required documents</h2>${renderFacts(j.required_documents)}
        <h2>Recruitment details</h2>
        <p>${esc(j.summary||'No additional summary available. Use the official notification for complete conditions.')}</p>
        <p><strong>Notification:</strong> ${esc(j.notification_no||'Not disclosed')}<br><strong>Total posts in notice:</strong> ${esc(j.total_posts_in_notification==null?'Not disclosed':j.total_posts_in_notification)}<br><strong>Civil posts:</strong> ${esc(j.civil_posts_count==null?'Not disclosed':j.civil_posts_count)}<br><strong>Language / domicile rules:</strong> ${esc(textValue(j.language_required))} / ${esc(textValue(j.local_cadre_or_domicile))}<br><strong>Reservation notes:</strong> ${esc(textValue(j.reservation_notes))}<br><strong>Application link:</strong> ${esc(applyUrl?sourceHost(applyUrl):'Not disclosed')}</p>
        ${previousDeadline}
        <p><a class="btn primary" href="${esc(officialUrl)}" target="_blank" rel="noopener noreferrer">Open Official Notification ↗</a>${applyUrl?` <a class="btn secondary" href="${esc(applyUrl)}" target="_blank" rel="noopener noreferrer">Apply on Official Site ↗</a>`:''}</p>
        <p style="margin-top:24px"><a class="text-link" href="/government-jobs">← Government Civil Jobs</a></p>`;
      const schema = {
        '@context': 'https://schema.org',
        '@type': 'JobPosting',
        title: j.title,
        description: j.summary || 'Civil-focused government recruitment listing.',
        datePosted: j.published_at || j.reviewed_at || undefined,
        validThrough: j.apply_end ? `${j.apply_end}T23:59:59Z` : undefined,
        employmentType: ({ apprentice: 'INTERN', trainee: 'INTERN', contract: 'CONTRACTOR', regular: 'FULL_TIME' })[String(j.job_type || '').toLowerCase()] || 'FULL_TIME',
        hiringOrganization: { '@type': 'Organization', name: j.organization },
        jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressRegion: j.state || 'All India', addressCountry: 'IN' } },
        identifier: { '@type': 'PropertyValue', name: j.organization, value: j.notification_no || j.slug },
        url: `${SITE}/government-jobs/${slug(j.slug)}`,
      };
      const schemaScript = '<script type="application/ld+json">' + JSON.stringify(schema).replace(/</g,'\\u003c') + '</script>';
      res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','public, s-maxage=600, stale-while-revalidate=1800');
      return res.status(200).send(layout(j.title+' | CivilCareer',j.summary||'Civil-focused government recruitment details.',SITE+'/government-jobs/'+slug(j.slug),schemaScript+body));
    }
    const result=await rowsByFilter(p);
    const jobs=result.rows.filter(j=>official(j.official_notice_url));
    const query=p.get('q')||'';
    const label=query?'Government Civil Jobs matching '+query:p.get('role')?'Role: '+p.get('role'):p.get('department')?'Department: '+p.get('department'):p.get('state')?'Government Jobs in '+p.get('state'):p.get('scope')?(p.get('scope')==='state'?'State Government Jobs':'Central Government Jobs'):'Government Civil Jobs in India';
    const pages=Math.max(1,Math.ceil(result.total/result.perPage));
    const pageUrl=page=>{const params=new URLSearchParams(p);params.set('page',String(page));return '/government-jobs?'+params.toString();};
    const pager=pages>1?`<nav class="govt-job-pager" aria-label="Government job result pages">${result.page>1?`<a class="btn secondary" href="${esc(pageUrl(result.page-1))}">Previous</a>`:''}<span>Page ${result.page} of ${pages} · ${result.total} official-source notification${result.total===1?'':'s'}</span>${result.page<pages?`<a class="btn secondary" href="${esc(pageUrl(result.page+1))}">Next</a>`:''}</nav>`:'';
    const filters=`<form class="govt-job-filters" method="get" action="/government-jobs" aria-label="Filter government civil jobs"><label>Search title or organization<input name="q" value="${esc(query)}" maxlength="120" placeholder="e.g. Junior Engineer"></label><label>State<input name="state" value="${esc(p.get('state')||'')}" maxlength="80" placeholder="e.g. Karnataka"></label><label>Department<input name="department" value="${esc(p.get('department')||'')}" maxlength="80" placeholder="e.g. PWD"></label><label>Government level<select name="scope"><option value="">All levels</option><option value="central"${p.get('scope')==='central'?' selected':''}>Central</option><option value="state"${p.get('scope')==='state'?' selected':''}>State</option></select></label><button class="btn primary" type="submit">Search jobs</button><a class="text-link" href="/government-jobs">Clear filters</a></form>`;
    const body=`<style>.govt-job-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;padding:16px;margin:20px 0;background:var(--surface,#fff);border:1px solid var(--border,#e3e7ee);border-radius:12px}.govt-job-filters label{display:grid;gap:5px;font-weight:600}.govt-job-filters input,.govt-job-filters select{min-height:44px;padding:8px 10px;border:1px solid var(--border,#e3e7ee);border-radius:8px;background:var(--surface,#fff);color:var(--ink,#0b1f3a)}.govt-job-pager{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;margin:24px 0}.govt-job-pager span{color:var(--ink-muted,#4a5a70)}.govt-compare-controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:18px 0}.govt-compare-controls button:disabled{opacity:.55;cursor:not-allowed}[data-govt-compare-choice]{width:18px;height:18px;vertical-align:middle;margin-right:6px}#govt-compare-results{margin:28px 0;padding:18px;border:1px solid var(--border,#e3e7ee);border-radius:12px;background:var(--surface,#fff)}#govt-compare-results table{width:100%;border-collapse:collapse}#govt-compare-results th,#govt-compare-results td{padding:10px;border:1px solid var(--border,#e3e7ee);text-align:left;vertical-align:top}#govt-compare-results th{color:var(--ink,#0b1f3a)}@media(max-width:480px){.govt-job-filters{grid-template-columns:1fr}}</style><p class="eyebrow">Civil-only government recruitment</p><h1>${esc(label)}</h1><p class="lead">Civil Engineering government recruitment listings with official notification links. Verify current details with the recruiting organization.</p>${filters}<p role="status">Showing ${jobs.length} verified official-source result${jobs.length===1?'':'s'} on this page.</p>${jobs.length>1?renderCompareTool():''}<div class="cards three">${jobs.map(renderJobCard).join('')||'<p>No currently listed government civil-engineering recruitments match these filters.</p>'}</div>${pager}<div class="callout"><strong>Information notice.</strong> CivilCareer is an independent directory. Confirm current dates, eligibility and application steps in the official notification.</div>`;
    const noindex=jobs.length<3||Boolean(query)||result.page>1?'noindex,follow':'index,follow';
    res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','public, s-maxage=600, stale-while-revalidate=1800');
    return res.status(200).send(layout(label+' | CivilCareer','Civil-focused government recruitment and reviewed Civil Engineering vacancies.',SITE+'/government-jobs',body,noindex));
  }catch(e){console.error('govt-public',e.message);return res.status(500).send('Government page could not be generated.');}
};
