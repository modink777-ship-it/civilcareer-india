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
/* The two-pane explorer was replaced by dynamic detail pages (openJob +
   activateDynamic): cards must still carry the data-job hook that opens them. */
assert(v8.includes('data-job="${j.id}"'),'job cards must expose a View Details hook');
assert(v8.includes('activateDynamic'),'detail pages must render through the dynamic router');
assert(v8.includes('data-xf') || !v8.includes('ccRenderBar'),'filter bars must tag selects with their logical key');
assert(exams.includes("body.published = false"),'exam creation must remain unpublished until review');
assert(examAlerts.includes('review_state')&&examAlerts.includes('Pending Review'),'exam discovery must create review drafts');
assert(yt.includes('review_state')&&yt.includes('Pending Review'),'YouTube ingestion must create review drafts');
assert(dispatch.includes("'/api/exam-alerts'")&&dispatch.includes("'/api/youtube-materials'"),'new handlers must be registered');
assert(security.includes('allowPublicCors'),'public reads must go through the shared public-CORS helper');
console.log('Phase 11 auth/explorer/ingestion tests: PASS');
{
  /* Public reads are served to any origin through allowPublicCors, while
     allowSameOrigin stays strict for admin-only endpoints. This used to assert
     a `{publicGet:true}` option on allowSameOrigin that no longer exists, which
     left the entire suite red. */
  const sec=require('../lib/security');
  const make=()=>{const h={};return {h,res:{setHeader:(k,v)=>h[k]=v,status:()=>({json:()=>{}}),json:()=>{}}};};
  const pub=make();
  assert.equal(sec.allowPublicCors({method:'GET',headers:{origin:'https://another.example'}},pub.res),true,'public reads must not be blocked by an origin check');
  assert.equal(pub.h['Access-Control-Allow-Origin'],'*','public CORS must stay open');
  const admin=make();
  assert.equal(sec.allowSameOrigin({method:'GET',headers:{origin:'https://another.example'}},admin.res),false,'admin endpoints must reject cross-origin reads');
}
assert(fs.readFileSync(path.join(root,'app.js'),'utf8').includes('window.__ccRecommendations'),'For You must resolve jobs from authenticated recommendations');
/* These three assertions had drifted away from the code: they pinned exact
   strings from earlier refactors (a `sources.map` bulk insert, a YouTube
   `fallbackTimedText`) that no longer describe how the ingestion works, which
   kept the whole suite red and hid real failures. They now assert the
   properties that actually matter. */
assert(
  examAlerts.includes('Promise.allSettled(SOURCES.map'),
  'exam alerts must fetch sources concurrently to avoid Vercel timeout'
);
assert(examAlerts.includes('Promise.allSettled'), 'exam alerts must tolerate one source failing without losing the rest');
assert(examAlerts.includes('result.error'), 'exam alerts must record per-source insert failures instead of aborting the run');
assert(yt.includes('pickTrack'), 'YouTube ingestion must fall back between caption tracks (manual → ASR → translated)');
/* Caption discovery now scrapes the public watch page for ytInitialPlayerResponse;
   the old InnerTube visionOS client was removed in the 2026-09 rework. */
assert(yt.includes('ytInitialPlayerResponse') && yt.includes('captionTracks'), 'YouTube ingestion must discover caption tracks from the watch-page player response');
assert(authConfigIncludesAliases(),'auth config must support public Supabase URL/anon-key aliases');
function appIncludesRecommendationsBind(){
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  return app.includes('window.__ccRecommendations?.find');
}
function authConfigIncludesAliases(){
  const cfg=fs.readFileSync(path.join(root,'_api/auth-config.js'),'utf8');
  return cfg.includes('SUPABASE_PUBLIC_URL')&&cfg.includes('SUPABASE_PUBLIC_ANON_KEY');
}
