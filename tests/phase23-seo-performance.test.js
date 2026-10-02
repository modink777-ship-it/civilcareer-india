const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');

test('P10 government details emit active JobPosting JSON-LD',()=>{
  const src=fs.readFileSync(path.join(root,'_api','govt-public.js'),'utf8');
  for(const token of ["'@type': 'JobPosting'",'validThrough','hiringOrganization','jobLocation','identifier','status=eq.active']) assert.ok(src.includes(token),token);
});

test('P10 sitemap includes active government detail URLs and legal pages',()=>{
  const src=fs.readFileSync(path.join(root,'_api','sitemap.js'),'utf8');
  for(const token of ['govt_jobs?select=id,slug','government-jobs/','/privacy','/terms','/disclaimer']) assert.ok(src.includes(token),token);
});
