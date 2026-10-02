const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');

test('P11 standalone disclaimer and legal routes exist',()=>{
  for(const file of ['privacy.html','terms.html','disclaimer.html']) assert.ok(fs.existsSync(path.join(root,file)),file);
  const v=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
  for(const route of ['/privacy','/terms','/disclaimer']) assert.ok(v.rewrites.some(x=>x.source===route),route);
});

test('P11 key public pages are India-only and link standalone legal pages',()=>{
  for(const file of ['index.html','exams.html','government-jobs.html','private-jobs.html','exam-tracker.html']){
    const s=fs.readFileSync(path.join(root,file),'utf8');
    assert.doesNotMatch(s,/India and globally/i,file);
    assert.match(s,/href="\/privacy"/,file+' privacy link');
    assert.match(s,/href="\/terms"/,file+' terms link');
    assert.match(s,/href="\/disclaimer"/,file+' disclaimer link');
  }
});

test('P11 account and collected-data forms carry a data-use notice',()=>{
  const account=fs.readFileSync(path.join(root,'account.js'),'utf8');
  for(const form of ['ccSignInForm','ccSignupForm','ccForgotForm','ccAlertForm']) assert.match(account,new RegExp(form));
  assert.match(account,/Privacy Policy/);
  const tracker=fs.readFileSync(path.join(root,'exam-tracker.html'),'utf8');
  assert.match(tracker,/data-cc-consent/);
  assert.match(tracker,/Privacy Policy/);
});

test('P11 disclaimer states source-first and safety boundaries',()=>{
  const s=fs.readFileSync(path.join(root,'disclaimer.html'),'utf8');
  for(const token of ['India-only','official government notification','not an employer','Safety','External links']) assert.match(s,new RegExp(token,'i'));
});
