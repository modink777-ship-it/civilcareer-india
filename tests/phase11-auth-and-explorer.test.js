const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.join(__dirname,'..');
const account=fs.readFileSync(path.join(root,'account.js'),'utf8');
const v8=fs.readFileSync(path.join(root,'v8.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const exams=fs.readFileSync(path.join(root,'_api/exams.js'),'utf8');
const examAlerts=fs.readFileSync(path.join(root,'_api/exam-alerts.js'),'utf8');
const yt=fs.readFileSync(path.join(root,'_api/youtube-materials.js'),'utf8');
const dispatch=fs.readFileSync(path.join(root,'api/[[...path]].js'),'utf8');
const security=fs.readFileSync(path.join(root,'lib/security.js'),'utf8');

assert(account.includes("token?grant_type=password"),'account login must use password auth');
assert(account.includes('normalizeIndianPhone'),'Indian phone normalization must exist');
assert(account.includes("authRequest('signup'"),'account signup must use Supabase Auth');
assert(account.includes('auth/v1/recover'),'password reset must use email recovery');
assert(!account.includes('signInWithOtp'),'OTP sign-in must not be used');
assert(!account.includes('cdn.jsdelivr.netlify') && !account.includes('cdn.jsdelivr.net/npm/@supabase/supabase-js'),'login must not depend on a Supabase CDN SDK');
assert(v8.includes('data-open-explorer'),'explorer View button must open the right-side panel');
assert(v8.includes('governmentJobDetailPanel'),'Government explorer must have its own detail panel');
assert(index.includes('id="governmentJobDetailPanel"'),'Government page must use the two-pane explorer');
assert(exams.includes("body.published = false"),'exam creation must remain unpublished until review');
assert(examAlerts.includes('review_state')&&examAlerts.includes('Pending Review'),'exam discovery must create review drafts');
assert(yt.includes('review_state')&&yt.includes('Pending Review'),'YouTube ingestion must create review drafts');
assert(dispatch.includes("'/api/exam-alerts'")&&dispatch.includes("'/api/youtube-materials'"),'new handlers must be registered');
assert(security.includes('publicGet'),'public reads must not be blocked by same-origin checks');
console.log('Phase 11 auth/explorer/ingestion tests: PASS');
{
  const sec=require('../lib/security');
  const headers={};
  const res={setHeader:(k,v)=>headers[k]=v,status:()=>({json:()=>{}}),json:()=>{}};
  assert.equal(sec.allowSameOrigin({method:'GET',headers:{origin:'https://another.example'}},res,{publicGet:true}),true);
}
assert(appIncludesRecommendationsBind(),'For You View Details must resolve jobs from authenticated recommendations');
assert(examAlerts.includes('Promise.all(sources.map'), 'exam alerts must fetch sources concurrently to avoid Vercel timeout');
assert(examAlerts.includes('method: \'POST\', body: JSON.stringify(payloads)'), 'exam alerts must use a bounded bulk insert rather than N+1 inserts');
assert(yt.includes('fallbackTimedText'), 'YouTube ingestion must have a timed-text fallback');
assert(authConfigIncludesAliases(),'auth config must support public Supabase URL/anon-key aliases');
function appIncludesRecommendationsBind(){
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  return app.includes('window.__ccRecommendations?.find');
}
function authConfigIncludesAliases(){
  const cfg=fs.readFileSync(path.join(root,'_api/auth-config.js'),'utf8');
  return cfg.includes('SUPABASE_PUBLIC_URL')&&cfg.includes('SUPABASE_PUBLIC_ANON_KEY');
}
