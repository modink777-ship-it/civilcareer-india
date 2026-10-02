/* CivilCareer candidate accounts — password auth, no OTP/magic-link login. */
(() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let cfg = null, session = null, loading = null;
  const SESSION_KEY = 'cc_auth_session';

  function normalizePhone(v) {
    let d = String(v || '').replace(/[^\d+]/g, '');
    if (d.startsWith('+91')) d = d.slice(3);
    else if (d.startsWith('0091')) d = d.slice(4);
    else if (d.startsWith('91') && d.length === 12) d = d.slice(2);
    if (d.startsWith('0') && d.length === 11) d = d.slice(1);
    if (!/^\d{10}$/.test(d)) throw Error('Enter a valid Indian mobile number.');
    return `+91${d}`;
  }
  const normalizeIndianPhone = normalizePhone; /* alias kept for tests */
  function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim()); }
  function isPhone(v) { return /^\+?\d[\d\s()-]{8,}$/.test(String(v || '').trim()); }

  async function getConfig() {
    if (cfg) return cfg;
    const r = await fetch('/api/auth-config', {cache:'no-store'});
    const x = await r.json().catch(() => ({}));
    if (!r.ok || !x.url || !x.anonKey) throw Error(x.error || 'Authentication is not configured.');
    cfg = x; return cfg;
  }
  function saveSession(s) { session = s || null; if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session)); else localStorage.removeItem(SESSION_KEY); renderAccountButton(); }
  function loadSession() { try { const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); if (s?.access_token) session = s; } catch {} }
  async function authRequest(path, body, method='POST') {
    const c = await getConfig();
    const r = await fetch(`${c.url.replace(/\/$/,'')}/auth/v1/${path}`, {method, headers:{apikey:c.anonKey,'Content-Type':'application/json',...(session?{Authorization:`Bearer ${session.access_token}`}:{})}, body: body === undefined ? undefined : JSON.stringify(body)});
    const x = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(x.error_description || x.msg || x.error || 'Authentication request failed.');
    return x;
  }
  async function refreshSession() {
    if (!session?.refresh_token) return;
    try { const x = await authRequest('token?grant_type=refresh_token', {refresh_token:session.refresh_token}); saveSession(x); } catch { saveSession(null); }
  }
  async function accountApi(action, payload={}) {
    if (!session) return null;
    const r = await fetch('/api/account', {method:'POST', headers:{'content-type':'application/json',Authorization:`Bearer ${session.access_token}`}, body:JSON.stringify({action,...payload})});
    const x = await r.json().catch(()=>({})); if (!r.ok) throw Error(x.error || 'Account sync failed.'); return x;
  }
  async function loadAccount() {
    if (!session) return null;
    const r = await fetch('/api/account', {headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store'});
    const x = await r.json().catch(()=>({})); if (!r.ok) throw Error(x.error || 'Could not load account.'); return x;
  }
  function localProfile() { try { return JSON.parse(localStorage.getItem('cc_civil_profile') || '{}'); } catch { return {}; } }

  function modal() {
    let d = $('ccAccountDialog'); if (d) return d;
    d = document.createElement('dialog'); d.id='ccAccountDialog'; d.className='cc-account-dialog';
    d.innerHTML='<div class="dialog-head"><h2>CivilCareer Account</h2><button type="button" data-close>×</button></div><div class="dialog-body" id="ccAccountBody"></div>';
    document.body.appendChild(d); d.querySelector('[data-close]').onclick=()=>d.close(); return d;
  }
  function renderAccountButton() {
    const b=$('ccAccountBtn'); if(!b)return; b.textContent=session?'Account':'Sign in'; b.setAttribute('aria-label',session?'Open account':'Sign in to CivilCareer'); b.classList.toggle('signed-in',!!session);
  }
  function ensureButton() {
    const tools=document.querySelector('.nav-tools'); if(!tools||$('ccAccountBtn'))return;
    const b=document.createElement('button'); b.id='ccAccountBtn'; b.className='icon-btn cc-account-btn'; b.type='button'; b.textContent='Sign in'; b.onclick=openAccount; tools.insertBefore(b,tools.firstChild); renderAccountButton();
  }
  function setStatus(msg,type='error'){const e=$('ccAccountStatus');if(e){e.className=`form-status ${type} show`;e.textContent=msg;}}

  function renderAccount() {
    const d=modal(), b=d.querySelector('#ccAccountBody');
    if (!session) {
      b.innerHTML=`<p>Sign in with your email or Indian mobile number and password.</p>
        <form id="ccSignInForm" class="cc-account-form"><p class="form-consent">By signing in, you agree to the account terms and processing described in our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p><label>Email or mobile<input id="ccLoginId" required autocomplete="username" placeholder="you@example.com or 9876543210"></label><label>Password<input id="ccLoginPassword" type="password" required autocomplete="current-password"></label><button class="btn primary">Sign in</button></form>
        <div id="ccAccountStatus" class="form-status"></div><div class="cc-account-actions"><button type="button" class="btn secondary" id="ccCreateMode">Create account</button><button type="button" class="btn secondary" id="ccForgot">Forgot password?</button></div>`;
      $('ccSignInForm').onsubmit=signIn; $('ccCreateMode').onclick=renderSignup; $('ccForgot').onclick=renderForgot; return;
    }
    b.innerHTML=`<p class="cc-account-email">Signed in as <b>${esc(session.user?.email || session.user?.phone || 'your account')}</b></p><div class="cc-account-stats"><span><b id="ccSavedCount">—</b> saved jobs</span><span><b id="ccAppliedCount">—</b> tracked applications</span></div><div class="cc-account-actions"><button class="btn secondary" id="ccSync">Sync profile</button><button class="btn secondary" id="ccSignOut">Sign out</button><button class="btn secondary cc-danger-link" id="ccDeleteData">Delete my data</button></div><div id="ccAccountStatus" class="form-status"></div><section class="cc-account-section"><h3>Recommended for you</h3><div id="ccRecommendations"><p>Loading recommendations…</p></div></section><section class="cc-account-section"><h3>Application tracker</h3><div id="ccApplications"><p>Loading applications…</p></div></section><section class="cc-account-section"><h3>Job alerts</h3><form id="ccAlertForm" class="cc-alert-form"><p class="form-consent">By saving an alert, you agree to CivilCareer using these preferences to provide the alert service as described in our <a href="/privacy">Privacy Policy</a>.</p><div class="cc-alert-grid"><label>Alert type<select id="ccAlertType"><option value="all">All civil jobs</option><option value="private">Private jobs</option><option value="government">Government jobs</option></select></label><label>Keywords<input id="ccAlertKeywords"></label><label>Role<input id="ccAlertRole"></label><label>Location<input id="ccAlertLocation"></label><label>Frequency<select id="ccAlertFrequency"><option value="daily">Daily digest</option><option value="weekly">Weekly digest</option></select></label></div><button class="btn primary">Save alert preferences</button></form><div id="ccAlerts"></div></section>`;
    $('ccSignOut').onclick=async()=>{saveSession(null);d.close();}; $('ccSync').onclick=()=>syncAccount(true); loadAlerts(); syncAccount();
    $('ccDeleteData').onclick=async()=>{
      if(!confirm('Delete all your CivilCareer data? Your profile, saved jobs, application tracker and alert preferences are erased. This cannot be undone.'))return;
      try{await accountApi('delete_account');saveSession(null);setStatus('All your data has been deleted.','success');d.close();}catch(err){setStatus(err.message||'Could not delete your data.');}
    };
  }
  function renderSignup(){
    const b=modal().querySelector('#ccAccountBody'); b.innerHTML=`<p>Create a CivilCareer account using an email or Indian mobile number and password.</p><form id="ccSignupForm" class="cc-account-form"><p class="form-consent">By creating an account, you agree to the processing described in our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p><label>Email or mobile<input id="ccSignupId" required autocomplete="username"></label><label>Password<input id="ccSignupPassword" type="password" required autocomplete="new-password" minlength="8"></label><label>Confirm password<input id="ccSignupConfirm" type="password" required autocomplete="new-password" minlength="8"></label><button class="btn primary">Create account</button></form><div id="ccAccountStatus" class="form-status"></div><button type="button" class="btn secondary" id="ccBackLogin">Back to sign in</button>`;
    $('ccSignupForm').onsubmit=signup; $('ccBackLogin').onclick=renderAccount;
  }
  function renderForgot(){
    const b=modal().querySelector('#ccAccountBody'); b.innerHTML=`<p>Enter the email address on your account and we will send a password reset link.</p><form id="ccForgotForm" class="cc-account-form"><p class="form-consent">Password reset uses your account contact details as described in our <a href="/privacy">Privacy Policy</a>.</p><label>Email<input id="ccForgotEmail" type="email" required></label><button class="btn primary">Send reset link</button></form><div id="ccAccountStatus" class="form-status"></div><button type="button" class="btn secondary" id="ccBackLogin">Back to sign in</button>`;
    $('ccForgotForm').onsubmit=forgotPassword; $('ccBackLogin').onclick=renderAccount;
  }
  async function signIn(e){
    e.preventDefault(); const id=$('ccLoginId').value.trim(), password=$('ccLoginPassword').value; try { const body=isPhone(id)?{phone:normalizePhone(id),password}:{email:id,password}; const x=await authRequest('token?grant_type=password',body); saveSession(x); setStatus('Signed in successfully.','success'); renderAccount(); } catch(err){setStatus(err.message);}}
  async function signup(e){
    e.preventDefault(); const id=$('ccSignupId').value.trim(), p=$('ccSignupPassword').value, c=$('ccSignupConfirm').value; if(p!==c)return setStatus('Passwords do not match.'); try { const body=isPhone(id)?{phone:normalizePhone(id),password:p}:{email:id,password:p}; const x=await authRequest('signup',body); if(x.access_token) {saveSession(x); renderAccount();} else setStatus('Account created. If email confirmation is enabled, confirm your email and then sign in.','success'); } catch(err){setStatus(err.message);}}
  async function forgotPassword(e){e.preventDefault(); try {const c=await getConfig(); const email=$('ccForgotEmail').value.trim(); const r=await fetch(`${c.url.replace(/\/$/,'')}/auth/v1/recover`,{method:'POST',headers:{apikey:c.anonKey,'Content-Type':'application/json'},body:JSON.stringify({email,redirect_to:location.origin+location.pathname})}); if(!r.ok)throw Error((await r.json().catch(()=>({}))).msg||'Could not send reset link.'); setStatus('Password reset link sent.','success');}catch(err){setStatus(err.message);}}
  async function syncAccount(showStatus=false){if(!session)return;try{const x=await loadAccount();const remote=x.profile||null, local=localProfile();if(remote)localStorage.setItem('cc_civil_profile',JSON.stringify({...local,...remote}));else if(Object.keys(local).length)await accountApi('profile',{profile:local});const saved=new Set(x.saved_job_ids||[]);localStorage.setItem('cc_saved',JSON.stringify([...saved]));localStorage.setItem('cc_recommendations',JSON.stringify(x.recommendations||[]));window.__ccRecommendations=x.recommendations||[];if($('ccSavedCount'))$('ccSavedCount').textContent=saved.size;if($('ccAppliedCount'))$('ccAppliedCount').textContent=(x.applications||[]).length;renderRecommendations(x.recommendations||[]);renderApplications(x.applications||[]);if(showStatus)setStatus('Your profile and career activity are synced.','success');}catch(err){setStatus(err.message);}}
  function renderRecommendations(list){const root=$('ccRecommendations');if(!root)return;root.innerHTML=list.length?list.slice(0,8).map(j=>`<div class="cc-account-job"><div><b>${esc(j.role||'Civil opportunity')}</b><span>${esc(j.company||'Organization')} · ${esc(j.location_display||j.location||'India')}</span><small>${esc((j.reasons||[]).slice(0,2).join(' · ')||'Based on your profile')}</small></div><button class="btn secondary" type="button" data-cc-recommend="${esc(j.id)}">View</button></div>`).join(''):'<p>No additional recommendations yet.</p>';root.querySelectorAll('[data-cc-recommend]').forEach(b=>b.onclick=()=>{const j=list.find(x=>String(x.id)===String(b.dataset.ccRecommend));if(j&&typeof window.openJob==='function')window.openJob(j.id);else location.href=`/jobs/${encodeURIComponent(j.slug||j.id)}`;});}
  function renderApplications(list){const root=$('ccApplications');if(!root)return;root.innerHTML=list.length?list.slice(0,8).map(a=>`<div class="cc-account-job"><div><b>${esc(a.status||'Tracked')}</b><span>Job ID: ${esc(a.job_id)}</span><small>Updated ${esc(String(a.updated_at||a.applied_at||'').slice(0,10))}</small></div></div>`).join(''):'<p>No applications tracked yet.</p>';}
  async function loadAlerts(){if(!session||!$('ccAlerts'))return;try{const r=await fetch('/api/alerts',{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store'});const x=await r.json();if(!r.ok)throw Error(x.error||'Could not load alerts.');const a=(x.alerts||[])[0];if(a){$('ccAlertType').value=a.alert_type||'all';$('ccAlertKeywords').value=a.keywords||'';$('ccAlertRole').value=a.role||'';$('ccAlertLocation').value=a.location||'';$('ccAlertFrequency').value=a.frequency||'daily';}$('ccAlerts').innerHTML=a?`<div class="cc-account-job"><div><b>${esc(a.active?'Alert active':'Alert paused')}</b><span>${esc(a.alert_type||'all')} · ${esc(a.frequency||'daily')}</span></div><button class="btn secondary" id="ccDeleteAlert">Remove</button></div>`:'<p>No alert preferences saved yet.</p>';$('ccDeleteAlert')?.addEventListener('click',async()=>{await fetch('/api/alerts',{method:'DELETE',headers:{'content-type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({id:a.id})});loadAlerts()});$('ccAlertForm').onsubmit=async e=>{e.preventDefault();const payload={alert_type:$('ccAlertType').value,keywords:$('ccAlertKeywords').value,role:$('ccAlertRole').value,location:$('ccAlertLocation').value,frequency:$('ccAlertFrequency').value,active:true};const rr=await fetch('/api/alerts',{method:'POST',headers:{'content-type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(payload)});const xx=await rr.json();if(!rr.ok)return setStatus(xx.error||'Could not save alert.');setStatus('Alert preferences saved.','success');loadAlerts()};}catch(err){setStatus(err.message);}}
  async function openAccount(){const d=modal();d.showModal();if(!session)loadSession();d.querySelector('#ccAccountBody').innerHTML='<p>Loading secure sign-in…</p>';try{await getConfig();renderAccount();}catch(err){d.querySelector('#ccAccountBody').innerHTML=`<div class="form-status error show">${esc(err.message)}</div>`;}}
  async function markApplied(jobId){if(!session)return false;await accountApi('application',{job_id:jobId,status:'Applied'});return true;}
window.openAccount=openAccount; window.ccAccount={open:openAccount,sync:syncAccount,markApplied};
  document.addEventListener('DOMContentLoaded',()=>{loadSession();refreshSession().finally(()=>{ensureButton();renderAccountButton();});});
})();
