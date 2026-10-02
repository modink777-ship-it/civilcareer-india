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

  if(!['job','govt_job'].includes(type)||!id)return send(res,400,{error:'source_type and source_id are required'});
  if(!['new_job','government_job','psu_job','exam_alert','deadline_alert','result_alert'].includes(template))return send(res,400,{error:'Unknown graphics template'});
  if(!['1080x1080','1080x1350'].includes(size))return send(res,400,{error:'size must be 1080x1080 or 1080x1350'});

  try{
    const row=await radarService.fetchSource(type,id);
    const check=radarService.verified(type,row);
    if(!check.ok)return send(res,409,{error:check.error});
    const svg=graphics.createGraphic(template,row,size);
    res.statusCode=200;
    res.setHeader('Content-Type','image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control','private, no-store');
    res.end(svg);
  }catch(_){
    return send(res,500,{error:'Graphic could not be generated'});
  }
};
