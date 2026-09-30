'use strict';

const { allowPublicCors } = require('../lib/security');
const SUPA_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '');
const OFFICIAL_GOVT_HOSTS = new Set(['ntpc.co.in','bhel.com','rites.com','ircon.org','aai.aero','nhpcindia.com','nbccindia.com','wapcos.gov.in']);
function isOfficialGovtUrl(value) {
  try { const u = new URL(String(value || '')); if (u.protocol !== 'https:') return false; const h = u.hostname.toLowerCase().replace(/^www\./,''); return h.endsWith('.gov.in') || h.endsWith('.nic.in') || OFFICIAL_GOVT_HOSTS.has(h) || [...OFFICIAL_GOVT_HOSTS].some(x => h.endsWith('.' + x)); } catch (_) { return false; }
}
function db(path, opts={}) { return fetch(`${SUPA_URL}/rest/v1/${path}`, { ...opts, headers: { apikey: SUPA_KEY, Authorization:`Bearer ${SUPA_KEY}`, 'Content-Type':'application/json', ...(opts.headers||{}) } }); }
function daysLeft(date) { if (!date) return null; const d = new Date(`${date}T00:00:00Z`); const t = new Date(); const today = new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth(),t.getUTCDate())); return Math.round((d-today)/86400000); }
function shape(job, posts) {
  const civilPosts = posts.filter(p => p.is_civil);
  const deadline = job.apply_end || null; const left = daysLeft(deadline);
  const source = job.official_notice_url || job.official_site_url;
  return { id:job.id, role:job.title, company:job.organization, department:job.department_category, departmentLabel:job.department_category, qualification:[...new Set(civilPosts.map(p=>p.qualification).filter(Boolean))].join(' / ').slice(0,300), location:job.state || 'All India', state:job.state || 'All India', vacancies:job.civil_posts_count || civilPosts.reduce((n,p)=>n+(Number(p.vacancies)||0),0) || null, deadline, deadlineText:deadline, daysLeft:left, expired:left!==null&&left<0, closingSoon:left!==null&&left>=0&&left<=5, applyUrl:job.official_apply_url || source, sourceUrl:source, verificationStatus:isOfficialGovtUrl(source)?'official-source':'unverified-source', internalUrl:`/government-jobs?job=${encodeURIComponent(job.slug)}`, source:job.organization, govScope:job.scope, postedAt:job.published_at, scrapedAt:new Date().toISOString(), posts:civilPosts.map(p=>({name:p.post_name,vacancies:p.vacancies,qualification:p.qualification,pay:p.pay,selection_process:p.selection_process})) };
}
module.exports = async function handler(req,res) {
  allowPublicCors(req,res); if(req.method==='OPTIONS') return res.status(200).end(); if(req.method!=='GET') return res.status(405).json({ok:false,error:'GET only.'});
  if(!SUPA_URL||!SUPA_KEY) return res.status(500).json({ok:false,error:'Supabase not configured.'});
  try {
    const p=new URL(req.url,'http://localhost').searchParams; const slug=p.get('slug');
    const jq=slug ? `govt_jobs?slug=eq.${encodeURIComponent(slug)}&status=eq.active&select=*&limit=1` : `govt_jobs?status=eq.active&order=apply_end.asc.nullslast,published_at.desc&limit=1000`;
    const jr=await db(jq); if(!jr.ok) { const t=await jr.text(); if(/relation .*govt_jobs.* does not exist/i.test(t)) return res.status(200).json({ok:true,updatedAt:new Date().toISOString(),totals:{notifications:0,shown:0,vacancies:null,states:0},departments:[],states:[],jobs:[]}); throw new Error(t.slice(0,300)); }
    const jobs=await jr.json(); if(slug) {
      const j=jobs[0]; if(!j) return res.status(404).json({ok:false,error:'Government job not found.'});
      const pr=await db(`govt_job_posts?govt_job_id=eq.${encodeURIComponent(j.id)}&is_civil=eq.true&select=post_name,discipline,vacancies,pay,qualification,qualification_levels,selection_process`); const posts=pr.ok?await pr.json():[];
      return res.status(200).json({ok:true,job:shape(j,posts)});
    }
    const ids=jobs.map(j=>j.id); let posts=[]; if(ids.length){ const inList=ids.map(x=>`"${String(x).replace(/"/g,'') }"`).join(','); const pr=await db(`govt_job_posts?govt_job_id=in.(${encodeURIComponent(inList)})&is_civil=eq.true&select=govt_job_id,post_name,discipline,vacancies,pay,qualification,qualification_levels,selection_process`); if(pr.ok) posts=await pr.json(); }
    const byJob=new Map(); for(const p of posts){ if(!byJob.has(p.govt_job_id)) byJob.set(p.govt_job_id,[]); byJob.get(p.govt_job_id).push(p); }
    let list=jobs.map(j=>shape(j,byJob.get(j.id)||[])).filter(j=>j.posts.length && j.verificationStatus==='official-source');
    const q=String(p.get('q')||'').toLowerCase().trim(), dept=String(p.get('dept')||'').toLowerCase().trim(), state=String(p.get('state')||'').toLowerCase().trim();
    if(q) list=list.filter(j=>`${j.role} ${j.company} ${j.qualification} ${j.location}`.toLowerCase().includes(q)); if(dept&&dept!=='all') list=list.filter(j=>j.department.toLowerCase()===dept); if(state&&state!=='all') list=list.filter(j=>j.state.toLowerCase()===state);
    const deptMap=new Map(), stateMap=new Map(); let vacancies=0; for(const j of list){ const d=deptMap.get(j.department)||{key:j.department,label:j.departmentLabel,count:0,vacancies:0};d.count++;d.vacancies+=j.vacancies||0;deptMap.set(j.department,d);const s=stateMap.get(j.state)||{name:j.state,count:0,vacancies:0};s.count++;s.vacancies+=j.vacancies||0;stateMap.set(j.state,s);vacancies+=j.vacancies||0; }
    res.setHeader('Cache-Control','public, s-maxage=600, stale-while-revalidate=1800'); return res.status(200).json({ok:true,updatedAt:new Date().toISOString(),totals:{notifications:list.length,shown:list.length,vacancies:vacancies||null,states:stateMap.size},departments:[...deptMap.values()],states:[...stateMap.values()],jobs:list});
  } catch(e) { console.error('govt-jobs',e.message); return res.status(500).json({ok:false,error:'Could not load government jobs.'}); }
};
module.exports.isOfficialGovtUrl=isOfficialGovtUrl;
