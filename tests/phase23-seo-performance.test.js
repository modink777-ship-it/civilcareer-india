const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');

test('P10 government details emit active JobPosting JSON-LD',()=>{
  const src=fs.readFileSync(path.join(root,'_api','govt-public.js'),'utf8');
  assert.match(src,/['"]JobPosting['"]/);
  assert.match(src,/validThrough/);
  assert.match(src,/hiringOrganization/);
  assert.match(src,/jobLocation/);
  assert.match(src,/identifier/);
  assert.match(src,/status=eq\.active/);
});

test('P10 sitemap includes active government detail URLs and legal pages',()=>{
  const src=fs.readFileSync(path.join(root,'_api','sitemap.js'),'utf8');
  assert.match(src,/govt_jobs\?select=id,slug/);
  assert.match(src,/government-jobs\\/\$\{encodeURIComponent/);
  assert.match(src,/\['\/privacy'/);
  assert.match(src,/\['\/terms'/);
  assert.match(src,/\['\/disclaimer'/);
});
