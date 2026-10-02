const DAY=86400000;
function key(v){
 const s=String(v==null?'':v).trim();
 if(!s)return null;
 if(s.length>=10&&s[4]=='-'&&s[7]=='-')return s.slice(0,10);
 const p=s.replaceAll('/','-').split('-');
 if(p.length==3&&p[0].length==2&&p[1].length==2){
  const y=p[2].length==2?2000+Number(p[2]):Number(p[2]);
  if(Number.isFinite(y))return String(y).padStart(4,'0')+'-'+p[1]+'-'+p[0];
 }
 return null;
}
function parse(v){const k=key(v);return k?new Date(k+'T23:59:59.999Z'):null;}
function active(t,r){return !!r&&(t==='job'?r.published===true:String(r.status||'').toLowerCase()==='active');}
function dates(t,r){
 let d={};try{d=t==='govt_job'?(typeof r.dates==='object'?(r.dates||{}):JSON.parse(String(r.dates||'{}'))):{};}catch(_){}
 const endRaw=t==='govt_job'?(r.apply_end||r.application_end||d.apply_end||d.application_end||r.deadline_text):(r.deadline||r.valid_through);
 const startRaw=t==='govt_job'?(r.application_start||d.application_start||d.apply_start||d.start):r.application_start;
 const ek=key(endRaw),sk=key(startRaw);
 return {endRaw,startRaw,ek,sk,end:ek?parse(ek):null,start:sk?new Date(sk+'T00:00:00.000Z'):null};
}
function today(now,tz){return new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));}
function localMidnight(k,tz){const p=String(k).split('-').map(Number);if(p.length!==3)return null;const n=Date.UTC(p[0],p[1]-1,p[2]);const q=new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(n));const g=x=>Number((q.find(y=>y.type===x)||{}).value||0);return n-(Date.UTC(g('year'),g('month')-1,g('day'),g('hour'),g('minute'),g('second'))-n);}
function events(t,r,now=Date.now(),tz='Asia/Kolkata'){
 if(!active(t,r))return [];
 const d=dates(t,r),out=[];
 const pub=r.published_at||r.posted_at||r.created_at;
 if(pub){const at=Date.parse(pub);if(Number.isFinite(at)&&now-at>=0&&now-at<=DAY)out.push('newly_announced');}
 if(d.start&&d.end&&d.sk===today(now,tz)&&now<=d.end.getTime())out.push('application_open');
 if(d.end){
  const a=localMidnight(today(now,tz),tz),b=localMidnight(d.ek,tz);
  if(a!=null&&b!=null){
   const diff=Math.round((b-a)/DAY),h=(d.end.getTime()-now)/3600000;
   if(diff===7)out.push('7_days');
   if(diff===3)out.push('3_days');
   if(h>0&&h<=24)out.push('24_hours');
   if(diff===0&&h>=0)out.push('closing_today');
   if(h<0&&h>=-24)out.push('closed');
  }
 }
 return [...new Set(out)];
}
module.exports={key,parse,events};
