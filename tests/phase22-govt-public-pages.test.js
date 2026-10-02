const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');

test('P9 government SSR handler is wired through single-segment API alias',()=>{
  const api=fs.readFileSync(path.join(root,'_api','govt-public.js'),'utf8');
  const dispatcher=fs.readFileSync(path.join(root,'api','[[...path]].js'),'utf8');
  const vercel=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
  assert.match(api,/Content-Type.*text\/html/);
  assert.match(api,/noindex,follow/);
  assert.match(dispatcher,/['"]\/api\/govt-public['"]/);
  for(const source of ['/government-jobs/central','/government-jobs/:slug','/state/:state','/department/:dept','/role/:role']){
    assert.ok(vercel.rewrites.some(x=>x.source===source),source+' rewrite missing');
  }
});

test('government jobs landing URL uses government SSR and old HTML URL redirects',()=>{
  const vercel=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
  const landing=vercel.rewrites.findIndex(x=>x.source==='/government-jobs');
  const detail=vercel.rewrites.findIndex(x=>x.source==='/government-jobs/:slug');
  assert.notEqual(landing,-1,'clean Government Jobs landing rewrite exists');
  assert.equal(vercel.rewrites[landing].destination,'/api/govt-public');
  assert.ok(landing<detail,'the exact landing route must precede the detail route');
  assert.ok(!vercel.rewrites.some(x=>x.source==='/government-jobs'&&x.destination==='/government-jobs.html'));
  assert.ok(vercel.redirects.some(x=>x.source==='/government-jobs.html'&&x.destination==='/government-jobs'&&x.permanent));
});
