const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const classifier=require('../lib/civil-classifier');

test('P8 canonical government endpoint uses the shared civil classifier',()=>{
  const src=fs.readFileSync(path.join(root,'_api','govt-discovery.js'),'utf8');
  assert.match(src,/require\(["']\.\.\/lib\/civil-classifier["']\)/);
  assert.match(src,/classifyPost\(/);
});

test('P8 hard-negative government posts are excluded, unknown stays needs_info',()=>{
  const neg=classifier.classifyPost({title:'Civil Judge',qualification:'Diploma in Engineering'});
  assert.equal(neg.outcome,'not_civil');
  const unknown=classifier.classifyPost({title:'Assistant Engineer',organization:'Mumbai Port Authority',qualification:'B.E/B.Tech Engineering'});
  assert.equal(unknown.outcome,'discipline_unknown');
});

test('P8 expiry route and daily schedule are wired',()=>{
  const api=fs.readFileSync(path.join(root,'_api','govt-expiry.js'),'utf8');
  assert.match(api,/req\.isCron/);
  assert.match(api,/status=eq\.active/);
  assert.match(api,/status:'closed'/);
  const dispatcher=fs.readFileSync(path.join(root,'api','[[...path]].js'),'utf8');
  assert.match(dispatcher,/['"]\/api\/govt-expiry['"]/);
  const vercel=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
  assert.ok(vercel.crons.some(x=>x.path==='/api/govt-expiry' && x.schedule==='20 0 * * *'));
});

test('P8 crawler never stages a hard negative through the legacy path',()=>{
  const src=fs.readFileSync(path.join(root,'_api','govt-discovery.js'),'utf8');
  assert.match(src,/classification\.civil_status === "not_civil"/);
  assert.match(src,/skipped: "not_civil"/);
});
