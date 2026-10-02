const sharp = require('sharp');
const crypto = require('crypto');
const { ownerKeyMatches } = require('../lib/security');
const radarService = require('../lib/social-radar-service');
const graphics = require('../lib/social-graphics-core');

const BUCKET = 'social-graphics';
const JPEG_MAX_BYTES = 8 * 1024 * 1024;

function send(res,status,body){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(body));
}

function storageHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...extra,
  };
}

async function ensureBucket(url, key) {
  const get = await fetch(`${url}/storage/v1/bucket/${BUCKET}`, {
    headers: storageHeaders(key, { Accept: 'application/json' }),
  });
  if (get.ok) return true;
  if (get.status !== 404) return false;

  const create = await fetch(`${url}/storage/v1/bucket`, {
    method: 'POST',
    headers: storageHeaders(key, { 'Content-Type': 'application/json', Accept: 'application/json' }),
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: true,
      file_size_limit: JPEG_MAX_BYTES,
      allowed_mime_types: ['image/jpeg'],
    }),
  });
  return create.ok || create.status === 409;
}

function safePathPart(value) {
  return String(value || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}

function objectPath(sourceType, sourceId, template, size, svg) {
  const hash = crypto.createHash('sha256').update(svg).digest('hex').slice(0, 16);
  return [
    sourceType,
    safePathPart(sourceId),
    `${safePathPart(template)}-${safePathPart(size)}-${hash}.jpg`,
  ].join('/');
}

async function uploadJpeg(url, key, objectName, jpegBuffer) {
  if (!Buffer.isBuffer(jpegBuffer) || jpegBuffer.length > JPEG_MAX_BYTES) {
    return { ok: false, error: 'JPEG output exceeds the 8 MB storage limit.' };
  }

  const encodedPath = objectName.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${url}/storage/v1/object/${BUCKET}/${encodedPath}`, {
    method: 'POST',
    headers: storageHeaders(key, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-upsert': 'true',
    }),
    body: jpegBuffer,
  });
  if (!response.ok) {
    return { ok: false, error: `Supabase Storage upload failed (HTTP ${response.status})` };
  }

  return {
    ok: true,
    publicUrl: `${url}/storage/v1/object/public/${BUCKET}/${encodedPath}`,
  };
}

module.exports = async function socialGraphicsV4(req,res){
  if(!ownerKeyMatches(req) && !req.adminUser) return send(res,401,{error:'Admin authentication required.'});
  if(req.method!=='GET' && req.method!=='POST') return send(res,405,{error:'Method not allowed'});

  let q={};
  try{ q=Object.fromEntries(new URL(req.url||'/', 'http://localhost').searchParams); }catch(_){}
  const body=req.body&&typeof req.body==='object'?req.body:{};
  const type=String(q.source_type||body.source_type||'');
  const id=String(q.source_id||body.source_id||'');
  const template=String(q.template||body.template||'new_job');
  const size=String(q.size||body.size||'1080x1080');
  const format=String(q.format||body.format||'svg').toLowerCase();
  const upload=String(q.upload||body.upload||'')==='true';

  if(!['job','govt_job','exam_tracker'].includes(type)||!id){
    return send(res,400,{error:'source_type and source_id are required'});
  }
  if(!['new_job','government_job','psu_job','exam_alert','deadline_alert','result_alert'].includes(template)){
    return send(res,400,{error:'Unknown graphics template'});
  }
  if(!['1080x1080','1080x1350'].includes(size)){
    return send(res,400,{error:'size must be 1080x1080 or 1080x1350'});
  }
  if(!['svg','jpeg'].includes(format)) return send(res,400,{error:'format must be svg or jpeg'});

  const storageUrl=String(process.env.SUPABASE_URL||'').replace(/\/+$/,'');
  const storageKey=String(process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY||'');
  if((format==='jpeg'||upload)&&(!storageUrl||!storageKey)){
    return send(res,503,{error:'Supabase server configuration is missing'});
  }

  try{
    const row=await radarService.fetchSource(type,id);
    const check=radarService.verified(type,row);
    if(!check.ok)return send(res,409,{error:check.error});

    const svg=graphics.createGraphic(template,row,size);
    if(format==='svg'&&!upload){
      res.statusCode=200;
      res.setHeader('Content-Type','image/svg+xml; charset=utf-8');
      res.setHeader('Cache-Control','private, no-store');
      return res.end(svg);
    }

    const jpeg=await sharp(Buffer.from(svg)).jpeg({quality:88,mozjpeg:true}).toBuffer();
    if(format==='jpeg'&&!upload){
      res.statusCode=200;
      res.setHeader('Content-Type','image/jpeg');
      res.setHeader('Content-Length',String(jpeg.length));
      res.setHeader('Cache-Control','private, no-store');
      return res.end(jpeg);
    }

    if(!(await ensureBucket(storageUrl,storageKey))){
      return send(res,503,{error:'Public social-graphics Storage bucket is not available.'});
    }
    const hash=crypto.createHash('sha256').update(svg).digest('hex').slice(0,16);
    const safe=(v)=>String(v||'').replace(/[^A-Za-z0-9._-]/g,'_').slice(0,120);
    const objectName=[type,safe(id),`${safe(template)}-${safe(size)}-${hash}.jpg`].join('/');
    const stored=await uploadJpeg(storageUrl,storageKey,objectName,jpeg);
    if(!stored.ok)return send(res,502,{error:stored.error});
    return send(res,200,{
      success:true,
      status:'uploaded',
      format:'jpeg',
      mime_type:'image/jpeg',
      storage_bucket:BUCKET,
      storage_path:objectName,
      public_url:stored.publicUrl,
      bytes:jpeg.length,
      width:1080,
      height:size==='1080x1350'?1350:1080
    });
  }catch(_){
    return send(res,500,{error:'Graphic could not be generated'});
  }
};
