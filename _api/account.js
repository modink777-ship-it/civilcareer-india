function send(res,status,body,headers={}){Object.entries(headers).forEach(([k,v])=>res.setHeader(k,v));res.status(status).json(body)}
function config(){const url=process.env.SUPABASE_URL,anon=process.env.SUPABASE_ANON_KEY,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!anon||!key)throw Error('Account service is not configured.');return{url,anon,key}}
async function rest(path,opts={}){const{url,key}=config();const r=await fetch(`${url}/rest/v1/${path}`,{...opts,headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json',prefer:'return=representation',...(opts.headers||{})}});const text=await r.text();if(!r.ok)throw Error(text||'Database request failed.');return text?JSON.parse(text):[]}
async function userFromToken(req){const {url,anon}=config();const h=String(req.headers.authorization||'');if(!/^Bearer\s+[^\s]+$/i.test(h))return null;const token=h.replace(/^Bearer\s+/i,'');const r=await fetch(`${url}/auth/v1/user`,{headers:{apikey:anon,authorization:`Bearer ${token}`}});if(!r.ok)return null;const u=await r.json();return u&&u.id?{id:u.id,email:u.email||''}:null}
function uuid(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''))}
function cleanProfile(b){const skills=Array.isArray(b.skills)?b.skills.map(x=>String(x).trim()).filter(Boolean).slice(0,30):[];return{role:String(b.role||'').slice(0,120),location:String(b.location||'').slice(0,180),stage:String(b.stage||'').slice(0,80),project:String(b.project||'').slice(0,120),work:String(b.work||'').slice(0,80),environment:String(b.environment||b.env||'').slice(0,100),education:String(b.education||'').slice(0,180),skills}}
module.exports=async(req,res)=>{res.setHeader('Cache-Control','private, no-store');try{const u=await userFromToken(req);if(!u)return send(res,401,{error:'Sign in required.'});if(req.method==='GET'){
const [profiles,saved,applications]=await Promise.all([
  rest(`candidate_profiles?user_id=eq.${u.id}&select=user_id,role,location,stage,project,work,environment,education,skills,created_at,updated_at&limit=1`),
  rest(`candidate_saved_jobs?user_id=eq.${u.id}&select=job_id,saved_at&order=saved_at.desc&limit=500`),
  rest(`candidate_job_applications?user_id=eq.${u.id}&select=job_id,status,notes,applied_at,updated_at&order=updated_at.desc&limit=500`)
]);
const profile=profiles[0]||null;
let recommendations=[];
try {
  const now=new Date().toISOString();
  const jr=await rest(`jobs?select=id,slug,role,company,company_name,location,location_display,state,city,description,skills,qualification,experience_level,sector,employment_type,published_at,created_at,application_url,source_url,deadline,expires_at,verification_status,last_verified&published=eq.true&or=(expires_at.gte.${encodeURIComponent(now)},expires_at.is.null)&or=(deadline.gte.${encodeURIComponent(new Date(new Date().setHours(0,0,0,0)).toISOString())},deadline.is.null)&order=created_at.desc&limit=120`);
  const savedSet=new Set(saved.map(x=>String(x.job_id)));
  const appliedSet=new Set(applications.map(x=>String(x.job_id)));
  const text=v=>String(v||'').toLowerCase();
  const skills=Array.isArray(profile?.skills)?profile.skills.map(text).filter(Boolean):[];
  const role=text(profile?.role), loc=text(profile?.location), stage=text(profile?.stage), project=text(profile?.project), work=text(profile?.work), env=text(profile?.environment), edu=text(profile?.education);
  const stageWords=stage.replace(/[–—]/g,' ').split(/\s+/).filter(Boolean);
  recommendations=jr.filter(j=>!savedSet.has(String(j.id))&&!appliedSet.has(String(j.id))).map(j=>{
    const hay=text([j.role,j.description,j.skills,j.qualification,j.project_type,j.specialization,j.location,j.location_display,j.city,j.state,j.company].join(' '));
    const reasons=[];
    if(role&&hay.includes(role)){reasons.push('Target role appears in this job')}
    if(loc&&hay.includes(loc)){reasons.push('Preferred location appears in this job')}
    const skillHits=skills.filter(k=>hay.includes(k)); if(skillHits.length)reasons.push(`Skills: ${skillHits.slice(0,3).join(', ')}`);
    if(project&&hay.includes(project))reasons.push('Project preference appears in the listing');
    if(work&&hay.includes(work))reasons.push('Work preference appears in the listing');
    if(env&&hay.includes(env))reasons.push('Preferred work environment appears in the listing');
    if(edu&&hay.includes(edu))reasons.push('Education preference appears in the listing');
    if(stageWords.length&&stageWords.some(w=>w.length>1&&hay.includes(w)))reasons.push('Career-stage terms appear in the listing');
    if(j.verification_status==='Verified'||j.last_verified)reasons.push('Source-verified listing');
    const freshness=new Date(j.published_at||j.created_at||0).getTime();
    const ageDays=Number.isFinite(freshness)?Math.max(0,(Date.now()-freshness)/86400000):999;
    const score=(role&&hay.includes(role)?5:0)+(loc&&hay.includes(loc)?4:0)+Math.min(6,skillHits.length*2)+(project&&hay.includes(project)?2:0)+(work&&hay.includes(work)?2:0)+(env&&hay.includes(env)?2:0)+(edu&&hay.includes(edu)?2:0)+(j.verification_status==='Verified'||j.last_verified?1:0)+(ageDays<=7?2:ageDays<=30?1:0);
    return {...j,reasons,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,12).map(({score,...j})=>j);
} catch (_) {}
return send(res,200,{user:{id:u.id,email:u.email},profile,saved_job_ids:saved.map(x=>x.job_id),saved_jobs:saved,applications,recommendations});
}
if(req.method!=='POST'&&req.method!=='DELETE')return send(res,405,{error:'Method not allowed.'});const b=req.body||{};const action=String(b.action||'');if(action==='profile'){const p=cleanProfile(b.profile||{});const rows=await rest(`candidate_profiles?user_id=eq.${u.id}`,{method:'PATCH',body:JSON.stringify({...p,updated_at:new Date().toISOString()})});if(!rows.length)await rest('candidate_profiles',{method:'POST',body:JSON.stringify({user_id:u.id,...p})});return send(res,200,{saved:true})}
if(action==='save'){if(!uuid(b.job_id))return send(res,400,{error:'Invalid job id.'});await rest('candidate_saved_jobs',{method:'POST',body:JSON.stringify({user_id:u.id,job_id:b.job_id})}).catch(e=>{if(!/duplicate|unique/i.test(e.message))throw e});return send(res,200,{saved:true})}
if(action==='unsave'){if(!uuid(b.job_id))return send(res,400,{error:'Invalid job id.'});await rest(`candidate_saved_jobs?user_id=eq.${u.id}&job_id=eq.${b.job_id}`,{method:'DELETE'});return send(res,200,{saved:false})}
if(action==='view'){if(!uuid(b.job_id))return send(res,400,{error:'Invalid job id.'});await rest('candidate_job_events',{method:'POST',body:JSON.stringify({job_id:b.job_id,user_id:u.id,event_type:'view',event_data:{source:'candidate-account'}})});return send(res,200,{tracked:true})}
if(action==='application'){if(!uuid(b.job_id))return send(res,400,{error:'Invalid job id.'});const status=['Interested','Applied','Interview','Offer','Rejected','Withdrawn'].includes(b.status)?b.status:'Applied';const existing=await rest(`candidate_job_applications?user_id=eq.${u.id}&job_id=eq.${b.job_id}&select=id&limit=1`);const payload={user_id:u.id,job_id:b.job_id,status,notes:String(b.notes||'').slice(0,2000),applied_at:b.applied_at||new Date().toISOString(),updated_at:new Date().toISOString()};if(existing.length)await rest(`candidate_job_applications?id=eq.${existing[0].id}`,{method:'PATCH',body:JSON.stringify(payload)});else await rest('candidate_job_applications',{method:'POST',body:JSON.stringify(payload)});return send(res,200,{saved:true})}
return send(res,400,{error:'Unknown account action.'})}catch(e){return send(res,500,{error:e.message||'Account request failed.'})}}
