'use strict';

const SUPA=String(process.env.SUPABASE_URL||'').replace(/\/+$/,'');
const KEY=String(process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY||'');

async function db(path,opts={}) {
  return fetch(`${SUPA}/rest/v1/${path}`, {
    ...opts,
    headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'return=representation',...(opts.headers||{})}
  });
}

module.exports=async function handler(req,res){
  if(req.method!=='POST' && req.method!=='GET') return res.status(405).json({ok:false,error:'GET or POST only.'});
  if(!req.isCron) return res.status(401).json({ok:false,error:'Cron authentication required.'});
  if(!SUPA||!KEY) return res.status(503).json({ok:false,error:'Supabase is not configured.'});
  try{
    const today=new Date().toISOString().slice(0,10);
    const r=await db(`govt_jobs?status=eq.active&apply_end=not.is.null&apply_end=lt.${encodeURIComponent(today)}&select=id,slug,apply_end`);
    if(!r.ok) throw new Error(`Lookup failed (HTTP ${r.status})`);
    const rows=await r.json();
    if(!rows.length) return res.status(200).json({ok:true,closed:0});
    const ids=rows.map(x=>encodeURIComponent(x.id)).join(',');
    const p=await db(`govt_jobs?id=in.(${ids})&status=eq.active`,{method:'PATCH',body:JSON.stringify({status:'closed'})});
    if(!p.ok) throw new Error(`Update failed (HTTP ${p.status})`);
    return res.status(200).json({ok:true,closed:rows.length});
  }catch(e){
    console.error('govt-expiry',e.message);
    return res.status(500).json({ok:false,error:'Government expiry sweep failed.'});
  }
};
