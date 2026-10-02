'use strict';

const SUPA=String(process.env.SUPABASE_URL||'').replace(/\/+$/,'');
const KEY=String(process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY||'');
const SITE=String(process.env.SITE_URL||'https://civilcareer-india-two.vercel.app').replace(/\/+$/,'');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const db=async path=>fetch(`${SUPA}/rest/v1/${path}`,{headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,Accept:'application/json'}});
const slug=v=>String(v||'government-job').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,90)||'government-job';
const days=d=>d?Math.floor((Date.parse(d+'T00:00:00Z')-Date.parse(new Date().toISOString().slice(0,10)+'T00:00:00Z'))/86400000):null;
const official=u=>{try{const x=new URL(u);const h=x.hostname.toLowerCase().replace(/^www\./,'');return x.protocol==='https:'&&(h.endsWith('.gov.in')||h.endsWith('.nic.in')||['ntpc.co.in','bhel.com','rites.com','ircon.org','aai.aero','nhpcindia.com','nbccindia.com','wapcos.gov.in'].some(d=>h===d||h.endsWith('.'+d)));}catch(_){return false;}};
function layout(title,desc,canonical,body,robots='index,follow'){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="${robots}"><title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(canonical)}"><link rel="stylesheet" href="/styles.css"><script src="/theme.js" defer></script></head><body><header class="site-header"><div class="container nav"><a class="logo" href="/">Civil<span>Career</span></a><nav><a href="/private-jobs">Private Jobs</a><a href="/government-jobs">Government Jobs</a><a href="/exams">Exams</a></nav></div></header><main class="container article-page" style="padding-top:48px;padding-bottom:72px">${body}</main><footer><div class="container footer-bottom"><p>CivilCareer is an independent information directory. Always verify important information with the original official source.</p><span>© 2026 CivilCareer</span></div></footer></body></html>`;}

async function rowsByFilter(p){
  const parts=['status=eq.active'];
  if(p.get('state')) parts.push('state=ilike.*'+encodeURIComponent(p.get('state'))+'*');
  if(p.get('scope')) parts.push('scope=eq.'+encodeURIComponent(p.get('scope')));
  if(p.get('department')) parts.push('department_category=ilike.*'+encodeURIComponent(p.get('department'))+'*');
  if(p.get('role')) parts.push('title=ilike.*'+encodeURIComponent(p.get('role'))+'*');
  const r=await db('govt_jobs?select=id,title,slug,organization,department_category,scope,state,civil_posts_count,total_posts_in_notification,apply_end,deadline_kind,deadline_text,official_notice_url,official_apply_url,reviewed_at,summary&'+parts.join('&')+'&order=apply_end.asc.nullslast,published_at.desc&limit=100');
  return r.ok?await r.json():[];
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
      if(!j) return res.status(404).send(layout('Government Job Not Found | CivilCareer','This government recruitment page is unavailable.',SITE+'/government-jobs/'+encodeURIComponent(detail),'<h1>Government job not found</h1><p>The recruitment may have closed or the URL may have changed.</p>','noindex,follow'));
      const pr=await db('govt_job_posts?govt_job_id=eq.'+encodeURIComponent(j.id)+'&is_civil=eq.true&select=post_name,vacancies,pay,qualification,qualification_levels,selection_process');
      const posts=pr.ok?await pr.json():[];
      const officialUrl=j.official_notice_url||j.official_site_url;
      const left=days(j.apply_end);
      const deadline=j.deadline_kind==='fixed'?(j.apply_end?new Date(j.apply_end+'T00:00:00Z').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'Not announced'):(j.deadline_text||'Notified Soon');
      const body=`<p class="eyebrow">Government Civil Recruitment · ${esc(j.scope==='state'?'State':'Central')}</p><h1>${esc(j.title)}</h1><p class="lead">${esc(j.organization)} · ${esc(j.state||'All India')}</p><p><strong>Reviewed on ${esc(j.reviewed_at?new Date(j.reviewed_at).toLocaleDateString('en-IN'):'—')}</strong></p><div class="callout"><strong>Verify at the official source.</strong><p>Dates, vacancies, eligibility, fees and application rules can change.</p><p>Deadline: <b>${esc(deadline)}</b>${left!==null&&left>=0?' · '+esc(left===0?'Closing today':left+' days left'):''}</p></div><h2>Civil posts</h2><div style="overflow-x:auto"><table><thead><tr><th>Post</th><th>Vacancies</th><th>Qualification</th><th>Pay</th><th>Selection</th></tr></thead><tbody>${posts.map(x=>'<tr><td>'+esc(x.post_name)+'</td><td>'+esc(x.vacancies==null?'—':x.vacancies)+'</td><td>'+esc(x.qualification||'—')+'</td><td>'+esc(typeof x.pay==='object'?JSON.stringify(x.pay):x.pay||'—')+'</td><td>'+esc(x.selection_process||'—')+'</td></tr>').join('')}</tbody></table></div><h2>Recruitment details</h2><p>${esc(j.summary||'No additional summary available. Use the official notification for complete conditions.')}</p><p><strong>Notification:</strong> ${j.notification_no?esc(j.notification_no):'Not stated'}<br><strong>Deadline:</strong> ${esc(deadline)}<br><strong>Application:</strong> ${esc(j.official_apply_url?'Official application link available':'See official notice')}</p><p><a class="btn primary" href="${esc(officialUrl||'#')}" target="_blank" rel="noopener noreferrer">Open Official Notification ↗</a></p><p style="margin-top:24px"><a class="text-link" href="/government-jobs">← Government Civil Jobs</a></p>`;
      res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','public, s-maxage=600, stale-while-revalidate=1800');
      return res.status(200).send(layout(j.title+' | CivilCareer',j.summary||'Civil-focused government recruitment details.',SITE+'/government-jobs/'+slug(j.slug),body));
    }
    const jobs=await rowsByFilter(p);
    const kind=p.get('kind')||'All India'; const label=p.get('role')?'Role: '+p.get('role'):p.get('department')?'Department: '+p.get('department'):p.get('state')?'Government Jobs in '+p.get('state'):p.get('scope')?(p.get('scope')==='state'?'State Government Jobs':'Central Government Jobs'):'Government Civil Jobs in India';
    const body=`<p class="eyebrow">Civil-only government recruitment</p><h1>${esc(label)}</h1><p class="lead">Verified public-sector Civil Engineering openings from CivilCareer’s reviewed government queue.</p><div class="stats-grid"><div class="stat-item"><span class="stat-num">${jobs.length}</span><span class="stat-label">Active notifications</span></div><div class="stat-item"><span class="stat-num">${jobs.reduce((n,j)=>n+(Number(j.civil_posts_count)||0),0)}</span><span class="stat-label">Civil posts</span></div><div class="stat-item"><span class="stat-num">India</span><span class="stat-label">Coverage</span></div></div><div class="cards three">${jobs.map(j=>`<article class="card"><span class="eyebrow">${esc(j.scope==='state'?'State':'Central')} · ${esc(j.state||'All India')}</span><h2>${esc(j.title)}</h2><p><strong>${esc(j.organization)}</strong></p><p>${esc(j.civil_posts_count==null?'Civil posts: not stated':j.civil_posts_count+' civil posts of '+(j.total_posts_in_notification||j.civil_posts_count))}</p><p>Deadline: <strong>${esc(j.deadline_kind==='fixed'?(j.apply_end||'Not announced'):(j.deadline_text||'Notified Soon'))}</strong></p><p>Reviewed on ${esc(j.reviewed_at?new Date(j.reviewed_at).toLocaleDateString('en-IN'):'—')}</p><a class="text-link" href="/government-jobs/${encodeURIComponent(slug(j.slug))}">View details →</a></article>`).join('')}</div><div class="callout"><strong>Source-first.</strong> CivilCareer does not replace the official notification. Verify all application details before applying.</div>`;
    const noindex=jobs.length<3?'noindex,follow':'index,follow';
    res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','public, s-maxage=600, stale-while-revalidate=1800');
    return res.status(200).send(layout(label+' | CivilCareer','Civil-focused government recruitment and reviewed Civil Engineering vacancies.',SITE+'/government-jobs',body,noindex));
  }catch(e){console.error('govt-public',e.message);return res.status(500).send('Government page could not be generated.');}
};
