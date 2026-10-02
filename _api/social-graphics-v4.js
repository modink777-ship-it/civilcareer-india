const { ownerKeyMatches } = require('../lib/security');
const radarService = require('../lib/social-radar-service');
const graphics = require('../lib/social-graphics-core');

function send(res,status,body){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(body));
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
