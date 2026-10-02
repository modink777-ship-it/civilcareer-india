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
      const body=`<p class="eyebrow">Government Civil Recruitment · ${esc(j.scope==='state'?'State':'Central')}</p><h1>${esc(j.title)}</h1><p class="lead">${esc(j.organization)} · ${esc(j.state||'All India')}</p><p><strong>Official source:</strong> <a href="${esc(officialUrl)}" target="_blank" rel="noopener noreferrer">${esc(host)} ↗</a><br><strong>Last reviewed:</strong> ${esc(reviewed)}</p><div class="callout"><strong>Verify at the official source.</strong><p>Dates, vacancies, eligibility, fees and application rules can change.</p><p>Deadline: <b>${esc(deadline)}</b>${left!==null&&left>=0?' · '+esc(left===0?'Closing today':left+' days left'):''}</p></div><h2>Civil posts</h2><div style="overflow-x:auto"><table><thead><tr><th>Post</th><th>Vacancies</th><th>Qualification</th><th>Pay</th><th>Selection</th></tr></thead><tbody>${posts.map(x=>'<tr><td>'+esc(x.post_name)+'</td><td>'+esc(x.vacancies==null?'—':x.vacancies)+'</td><td>'+esc(x.qualification||'—')+'</td><td>'+esc(typeof x.pay==='object'?JSON.stringify(x.pay):x.pay||'—')+'</td><td>'+esc(x.selection_process||'—')+'</td></tr>').join('')}</tbody></table></div><h2>Recruitment details</h2><p>${esc(j.summary||'No additional summary available. Use the official notification for complete conditions.')}</p><p><strong>Notification:</strong> ${j.notification_no?esc(j.notification_no):'Not stated'}<br><strong>Deadline:</strong> ${esc(deadline)}<br><strong>Application:</strong> ${esc(applyUrl?sourceHost(applyUrl):'See official notice')}</p><p><a class="btn primary" href="${esc(officialUrl)}" target="_blank" rel="noopener noreferrer">Open Official Notification ↗</a>${applyUrl?` <a class="btn secondary" href="${esc(applyUrl)}" target="_blank" rel="noopener noreferrer">Apply on Official Site ↗</a>`:''}</p><p style="margin-top:24px"><a class="text-link" href="/government-jobs">← Government Civil Jobs</a></p>`;
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
    const body=`<style>.govt-job-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;padding:16px;margin:20px 0;background:var(--surface,#fff);border:1px solid var(--border,#e3e7ee);border-radius:12px}.govt-job-filters label{display:grid;gap:5px;font-weight:600}.govt-job-filters input,.govt-job-filters select{min-height:44px;padding:8px 10px;border:1px solid var(--border,#e3e7ee);border-radius:8px;background:var(--surface,#fff);color:var(--ink,#0b1f3a)}.govt-job-pager{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;margin:24px 0}.govt-job-pager span{color:var(--ink-muted,#4a5a70)}@media(max-width:480px){.govt-job-filters{grid-template-columns:1fr}}</style><p class="eyebrow">Civil-only government recruitment</p><h1>${esc(label)}</h1><p class="lead">Civil Engineering government recruitment listings with official notification links. Verify current details with the recruiting organization.</p>${filters}<p role="status">Showing ${jobs.length} verified official-source result${jobs.length===1?'':'s'} on this page.</p><div class="cards three">${jobs.map(j=>{const host=sourceHost(j.official_notice_url);const reviewed=j.reviewed_at?new Date(j.reviewed_at).toLocaleDateString('en-IN'):'Not recorded';return `<article class="card"><span class="eyebrow">${esc(j.scope==='state'?'State':'Central')} · ${esc(j.state||'All India')}</span><h2>${esc(j.title)}</h2><p><strong>${esc(j.organization)}</strong></p><p>${esc(j.civil_posts_count==null?'Civil posts: not stated':j.civil_posts_count+' civil posts of '+(j.total_posts_in_notification||j.civil_posts_count))}</p><p>Deadline: <strong>${esc(j.deadline_kind==='fixed'?(j.apply_end||'Not announced'):(j.deadline_text||'Notified Soon'))}</strong></p><p>Official source: <a href="${esc(j.official_notice_url)}" target="_blank" rel="noopener noreferrer">${esc(host)} ↗</a><br>Last reviewed: ${esc(reviewed)}</p><a class="text-link" href="/government-jobs/${encodeURIComponent(slug(j.slug))}">View details →</a></article>`;}).join('')||'<p>No currently listed government civil-engineering recruitments match these filters.</p>'}</div>${pager}<div class="callout"><strong>Information notice.</strong> CivilCareer is an independent directory. Confirm current dates, eligibility and application steps in the official notification.</div>`;
    const noindex=jobs.length<3||Boolean(query)||result.page>1?'noindex,follow':'index,follow';
    res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','public, s-maxage=600, stale-while-revalidate=1800');
    return res.status(200).send(layout(label+' | CivilCareer','Civil-focused government recruitment and reviewed Civil Engineering vacancies.',SITE+'/government-jobs',body,noindex));
  }catch(e){console.error('govt-public',e.message);return res.status(500).send('Government page could not be generated.');}
};
