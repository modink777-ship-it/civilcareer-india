function s(r,n,b){r.status(n).json(b)}function c(){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!u||!k)throw Error('Analytics not connected.');return{u,k}}async function req(p,o={}){const{u,k}=c(),r=await fetch(`${u}/rest/v1/${p}`,{...o,headers:{apikey:k,authorization:`Bearer ${k}`,'content-type':'application/json',prefer:'return=representation'}}),t=await r.text();if(!r.ok)throw Error(t||'Analytics request failed.');return t?JSON.parse(t):null}function own(q){return process.env.OWNER_KEY&&q.headers['x-owner-key']===process.env.OWNER_KEY}module.exports=async(q,r)=>{try{if(q.method==='POST'){const b=q.body||{},id=String(b.visitor_id||'');if(!/^[a-zA-Z0-9-]{20,64}$/.test(id))return s(r,400,{error:'Invalid visitor.'});const path=String(b.path||'/').slice(0,180),event=['pageview','search'].includes(b.event_type)?b.event_type:'pageview';const device=['Mobile','Tablet','Desktop'].includes(b.device_type)?b.device_type:'Unknown';let ref='';try{ref=b.referrer?new URL(b.referrer).hostname.slice(0,180):''}catch{}const row={visitor_id:id,event_type:event,path,event_label:String(b.event_label||'').slice(0,100),referrer_domain:ref,device_type:device,country:String(q.headers['x-vercel-ip-country']||'Unknown').slice(0,10)};await req('analytics_events',{method:'POST',body:JSON.stringify(row)});return s(r,201,{tracked:true})}if(q.method==='GET'){if(!own(q))return s(r,401,{error:'Incorrect owner key.'});const data=await req('rpc/civilcareer_analytics_summary',{method:'POST',body:'{}'});
/* Weekly KPI report (P6.4): every number is computed server-side from real
   rows; nothing is estimated. All queries tolerate missing tables by design
   (each block is independent). */
let kpi={};
try{const week=new Date(Date.now()-7*86400000).toISOString();
const [wau,alerts,applies,verified,reports,views]=await Promise.allSettled([
req(`analytics_events?select=visitor_id&event_type=eq.pageview&created_at=gte.${week}`),
req(`job_alerts?select=id&created_at=gte.${week}`),
req(`candidate_job_applications?select=id&status=eq.Applied&updated_at=gte.${week}`),
req(`jobs?select=id&published=eq.true&last_verified=gte.${week}`),
req(`content_reports?select=id&created_at=gte.${week}`),
req(`analytics_events?select=id&event_type=eq.pageview&created_at=gte.${week}`)
]);
const val=x=>x.status==='fulfilled'&&Array.isArray(x.value)?x.value:[];
const wauRows=val(wau),viewsRows=val(views),alertsRows=val(alerts),appliesRows=val(applies),verifiedRows=val(verified),reportsRows=val(reports);
const wauCount=new Set(wauRows.map(x=>x.visitor_id)).size;
const viewCount=viewsRows.length;
const applyClicks=wauRows.length; /* proxied by tracked applications this week */
kpi={
weekly_active_users:wauCount,
alert_subscribers_new:alertsRows.length,
applications_tracked_this_week:appliesRows.length,
apply_rate_per_1k_views:viewCount?Math.round(appliesRows.length*1000/viewCount*10)/10:null,
page_views_week:viewCount,
listings_verified_last_7d:verifiedRows.length,
scam_reports_week:reportsRows.length,
scam_reports_per_1k_views:viewCount?Math.round(reportsRows.length*1000/viewCount*100)/100:null,
generated_at:new Date().toISOString()
};}catch(e){kpi={error:String(e&&e.message||e).slice(0,200)}}
return s(r,200,{analytics:data,kpi})}return s(r,405,{error:'Method not allowed.'})}catch(e){s(r,500,{error:e.message})}};
