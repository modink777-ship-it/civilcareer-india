const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const routes=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8')).rewrites;

test('P10 exact exams route resolves before the exams fallback',()=>{
  const exact=routes.findIndex(route=>route.source==='/exams');
  const fallback=routes.findIndex(route=>route.source==='/exams/:path*');
  assert.notEqual(exact,-1,'exact /exams rewrite exists');
  assert.notEqual(fallback,-1,'nested exams fallback exists');
  assert.equal(routes[exact].destination,'/exams.html');
  assert.ok(exact<fallback,'exact route must precede catch-all');
});

test('P10 government details emit active JobPosting JSON-LD',()=>{
  const src=fs.readFileSync(path.join(root,'_api','govt-public.js'),'utf8');
  for(const token of ["'@type': 'JobPosting'",'validThrough','hiringOrganization','jobLocation','identifier','status=eq.active']) assert.ok(src.includes(token),token);
});

test('P10 sitemap includes active government detail URLs and legal pages',()=>{
  const src=fs.readFileSync(path.join(root,'_api','sitemap.js'),'utf8');
  for(const token of ['govt_jobs?select=id,slug','government-jobs/','/privacy','/terms','/disclaimer']) assert.ok(src.includes(token),token);
});
