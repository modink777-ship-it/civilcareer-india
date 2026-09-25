function send(res,status,body,headers={}){Object.entries(headers).forEach(([k,v])=>res.setHeader(k,v));res.status(status).json(body)}
function config(){const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw Error('Database is not configured.');return{url,key}}
async function db(path,opts={}){const{url,key}=config();const r=await fetch(`${url}/rest/v1/${path}`,{...opts,headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json',prefer:'return=representation',...(opts.headers||{})}});const t=await r.text();if(!r.ok)throw Error(t||'Database request failed.');return t?JSON.parse(t):[]}
function own(req){return Boolean(process.env.OWNER_KEY)&&req.headers['x-owner-key']===process.env.OWNER_KEY}
function clean(v,max=500){return String(v??'').trim().slice(0,max)}
function validUrl(v){try{return ['http:','https:'].includes(new URL(v).protocol)}catch{return false}}
function publicProfile(x){return{id:x.id,company_name:x.company_name,official_url:x.official_url,description:x.description||'',locations:x.locations||[],industries:x.industries||[],verified_at:x.verified_at||null}}
module.exports=async(req,res)=>{res.setHeader('Cache-Control',req.method==='GET'?'public, s-maxage=300, stale-while-revalidate=86400':'private, no-store');try{
 if(req.method==='GET'){
   const company=clean(req.query?.company,200),id=clean(req.query?.id,80);
   const filter=id?`id=eq.${encodeURIComponent(id)}`:company?`company_name=ilike.${encodeURIComponent(`*${company}*`)}`:'status=eq.Verified';
   const rows=await db(`employer_profiles?select=id,company_name,official_url,description,locations,industries,verified_at,status&${filter}&status=eq.Verified&order=company_name.asc&limit=20`);
   return send(res,200,{employers:rows.map(publicProfile)});
 }
 if(!own(req))return send(res,401,{error:'Incorrect owner key.'});
 if(req.method==='POST'){
   const b=req.body||{};const name=clean(b.company_name,200),url=clean(b.official_url,1000);if(!name||!validUrl(url))return send(res,400,{error:'Company name and a valid official URL are required.'});
   const row={company_name:name,official_url:url,description:clean(b.description,3000),locations:Array.isArray(b.locations)?b.locations.map(x=>clean(x,120)).filter(Boolean).slice(0,30):[],industries:Array.isArray(b.industries)?b.industries.map(x=>clean(x,120)).filter(Boolean).slice(0,20):[],status:['Pending','Verified','Rejected'].includes(b.status)?b.status:'Pending',verified_at:b.status==='Verified'?new Date().toISOString():null,notes:clean(b.notes,2000)};
   const existing=await db(`employer_profiles?select=id&company_name=ilike.${encodeURIComponent(`*${name}*`)}&limit=1`);let rows;
   if(existing[0])rows=await db(`employer_profiles?id=eq.${encodeURIComponent(existing[0].id)}`,{method:'PATCH',body:JSON.stringify(row)});else rows=await db('employer_profiles',{method:'POST',body:JSON.stringify(row)});
   return send(res,200,{employer:rows[0]});
 }
 if(req.method==='PATCH'){
   const id=clean(req.body?.id,80),status=clean(req.body?.status,30);if(!id||!['Pending','Verified','Rejected'].includes(status))return send(res,400,{error:'Employer id and valid status are required.'});
   const patch={status,verified_at:status==='Verified'?new Date().toISOString():null};if(req.body?.notes!==undefined)patch.notes=clean(req.body.notes,2000);
   const rows=await db(`employer_profiles?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(patch)});if(!rows[0])return send(res,404,{error:'Employer not found.'});
   if(status==='Verified'){const profile=rows[0];await db(`jobs?company=ilike.${encodeURIComponent(`*${profile.company_name}*`)}&select=id`,{headers:{prefer:'return=representation'}}).then(async matches=>{if(matches.length){await db(`jobs?company=ilike.${encodeURIComponent(`*${profile.company_name}*`)}`,{method:'PATCH',body:JSON.stringify({employer_profile_id:profile.id,employer_verification_status:'Verified'})})}}).catch(()=>{});}else if(status==='Rejected'){const profile=rows[0];await db(`jobs?employer_profile_id=eq.${encodeURIComponent(profile.id)}`,{method:'PATCH',body:JSON.stringify({employer_verification_status:'Rejected'})}).catch(()=>{});}
   return send(res,200,{employer:rows[0]});
 }
 return send(res,405,{error:'Method not allowed.'});
}catch(e){return send(res,500,{error:e.message||'Employer service failed.'})}}
