#!/usr/bin/env node
'use strict';
const crypto=require('crypto');
const fs=require('fs');

const URL_BASE=String(process.env.SUPABASE_URL||'').replace(/\/+$/,'');
const KEY=String(process.env.SUPABASE_SERVICE_ROLE_KEY||'').trim();
const BACKUP_KEY=String(process.env.BACKUP_ENCRYPTION_KEY||'').trim();
if(!URL_BASE||!KEY||!BACKUP_KEY) throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and BACKUP_ENCRYPTION_KEY are required.');

const TABLES=['jobs','govt_jobs','govt_job_posts','exam_tracker','social_suggestions','social_publishes','social_connections','social_settings','job_alerts'];

async function readTable(table){
  const out=[];
  let offset=0;
  const page=500;
  while(true){
    const r=await fetch(URL_BASE+'/rest/v1/'+table+'?select=*',{headers:{
      apikey:KEY,Authorization:'Bearer '+KEY,Range:offset+'-'+(offset+page-1),
      Prefer:'count=none',Accept:'application/json'
    }});
    if(!r.ok) throw new Error(table+' export failed');
    const rows=await r.json();
    if(!Array.isArray(rows)||!rows.length) break;
    out.push(...rows);
    if(rows.length<page) break;
    offset+=page;
  }
  return out;
}

function encrypt(value){
  const key=crypto.createHash('sha256').update(BACKUP_KEY).digest();
  const iv=crypto.randomBytes(12);
  const c=crypto.createCipheriv('aes-256-gcm',key,iv);
  const body=Buffer.concat([c.update(Buffer.from(JSON.stringify(value),'utf8')),c.final()]);
  return JSON.stringify({v:1,iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:body.toString('base64')});
}

(async()=>{
  const exported={created_at:new Date().toISOString(),tables:{}};
  for(const t of TABLES) exported.tables[t]=await readTable(t);
  const name='civilcareer-backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json.enc';
  fs.writeFileSync(name,encrypt(exported));
  process.stdout.write(JSON.stringify({file:name,tables:Object.fromEntries(TABLES.map(t=>[t,exported.tables[t].length]))}));
})().catch(err=>{console.error(err.message);process.exit(1);});
