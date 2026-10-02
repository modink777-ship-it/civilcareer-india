const crypto = require('crypto');

const DAY_MS = 86400000;

function dateKey(value){
  const raw=String(value==null?'':value).trim();
  if(!raw) return null;
  if(raw.length>=10 && raw[4]==='-' && raw[7]==='-') return raw.slice(0,10);
  const p=raw.replaceAll('/','-').split('-');
  if(p.length===3 && p[0].length===2 && p[1].length===2 && (p[2].length===2 || p[2].length===4)){
    const y=p[2].length===2?2000+Number(p[2]):Number(p[2]);
    if(Number.isFinite(y)) return String(y).padStart(4,'0')+'-'+p[1]+'-'+p[0];
  }
  return null;
}

function parseDateToken(value){
  const key=dateKey(value);
  if(!key) return null;
  const d=new Date(key+'T23:59:59.999Z');
  return Number.isNaN(d.getTime())?null:d;
}

function dateOnlyInZone(now,tz='Asia/Kolkata'){
  return new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now==null?Date.now():now));
}

function localDateAsUtc(key,tz='Asia/Kolkata'){
  const p=String(key).split('-').map(Number);
  if(p.length!==3 || p.some(x=>!Number.isFinite(x))) return null;
  const naive=Date.UTC(p[0],p[1]-1,p[2]);
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(naive));
  const get=t=>Number((parts.find(x=>x.type===t)||{}).value||0);
  const asUtc=Date.UTC(get('year'),get('month')-1,get('day'),get('hour'),get('minute'),get('second'));
  return naive-(asUtc-naive);
}

module.exports={DAY_MS,dateKey,parseDateToken,dateOnlyInZone,localDateAsUtc};
