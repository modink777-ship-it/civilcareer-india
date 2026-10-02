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
