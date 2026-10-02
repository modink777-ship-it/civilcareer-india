const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');

test('P12 private backup exporter is server-side and excludes repo output',()=>{
  const src=fs.readFileSync(path.join(root,'scripts','export-key-tables.js'),'utf8');
  assert.match(src,/SUPABASE_URL/);
  assert.match(src,/SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(src,/Contains production data/);
  assert.match(src,/never commit or publish/);
});

test('P12 backup workflow retains private artifacts for 7 days',()=>{
  const wf=fs.readFileSync(path.join(root,'.github','workflows','private-supabase-backup.yml'),'utf8');
  assert.match(wf,/upload-artifact@v4/);
  assert.match(wf,/retention-days: 7/);
  assert.match(wf,/CIVILCAREER_SUPABASE_URL/);
  assert.match(wf,/CIVILCAREER_SUPABASE_SERVICE_KEY/);
});

test('P12 site health workflow checks home and api health hourly',()=>{
  const wf=fs.readFileSync(path.join(root,'.github','workflows','site-health.yml'),'utf8');
  assert.match(wf,/cron: '11 \* \* \* \*'/);
  assert.match(wf,/civilcareer-india-two\.vercel\.app/);
  assert.match(wf,/\/api\/health/);
});

test('P12 health endpoint fails closed when readiness env is missing',()=>{
  const src=fs.readFileSync(path.join(root,'_api','health.js'),'utf8');
  assert.match(src,/res\.status\(ready \? 200 : 503\)/);
  assert.doesNotMatch(src,/SERVICE_ROLE_KEY.*console\.log/);
});