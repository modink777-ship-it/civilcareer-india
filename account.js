/* CivilCareer candidate accounts.
   Password-based authentication only: email/Gmail OR Indian mobile + password.
   No OTP or magic-link sign-in. Supabase Auth REST is used directly so the
   browser does not depend on a third-party CDN SDK at login time. */
(()=>{
  const $=id=>document.getElementById(id);
  let cfg=null,session=null,loading=null,refreshTimer=null;
  const SESSION_KEY='cc_auth_session';
  const escA=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const json=async(r)=>{const t=await r.text();let x={};try{x=t?JSON.parse(t):{}}catch{}if(!r.ok)throw Error(x.error_description||x.msg||x.error||`Authentication request failed (${r.status})`);return x};
  function toastA(m){if(typeof window.toast==='function')window.toast(m)}
  async function loadClient(){
    if(cfg)return cfg;
    if(loading)return loading;
    loading=(async()=>{
      let lastError=null;
      for(let attempt=0;attempt<2;attempt++){
        try{
          const r=await fetch('/api/auth-config',{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'}});
          const x=await json(r);
          if(!x.url||!x.anonKey)throw Error('Authentication is not configured.');
          cfg=x;
          restoreSession();
          return cfg;
        }catch(e){
          lastError=e;
          if(attempt===0)await new Promise(resolve=>setTimeout(resolve,250));
        }
      }
      throw lastError||Error('Authentication service is unavailable.');
    })().finally(()=>{loading=null});
    return loading;
  }
  async function handleRecoveryHash(){
    const hash=String(location.hash||'').replace(/^#/,'');if(!hash)return false;
    const q=new URLSearchParams(hash);if(q.get('type')!=='recovery'||!q.get('access_token'))return false;
    const access_token=q.get('access_token'),refresh_token=q.get('refresh_token')||'',expires_in=Number(q.get('expires_in')||3600);
    saveSession({access_token,refresh_token,expires_in,user:{id:q.get('user_id')||''}});
    history.replaceState({},'',location.pathname+location.search);
    const d=modal();d.showModal();const body=d.querySelector('#ccAccountBody');body.innerHTML=`<p class="cc-account-note">Set a new password for your CivilCareer account.</p><form id="ccRecoveryForm" class="cc-account-form"><label>New password<input id="ccRecoveryPassword" type="password" minlength="8" required autocomplete="new-password"></label><label>Confirm password<input id="ccRecoveryConfirm" type="password" minlength="8" required autocomplete="new-password"></label><button class="btn primary" id="ccRecoveryBtn">Update password</button></form><div id="ccAccountStatus" class="form-status"></div>`;
    $('ccRecoveryForm').onsubmit=async e=>{e.preventDefault();const a=$('ccRecoveryPassword').value,b=$('ccRecoveryConfirm').value;if(a.length<8)return status('Use a password with at least 8 characters.');if(a!==b)return status('Passwords do not match.');const btn=$('ccRecoveryBtn');btn.disabled=true;btn.textContent='Updating…';try{const r=await fetch(`${cfg.url.replace(/\/+$/,'')}/auth/v1/user`,{method:'PUT',headers:{apikey:cfg.anonKey,Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({password:a})});const x=await json(r);saveSession({...session,user:x.user||session.user});status('Password updated. You are signed in.','success');setTimeout(renderAccount,400)}catch(err){status(err.message||'Could not update the password.')}finally{btn.disabled=false;btn.textContent='Update password'}};
    return true;
  }
  function restoreSession(){
    try{const x=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');if(x&&x.access_token&&x.user)session=x}catch{}
    if(session){
      if(Number(session.expires_at||0)&&Date.now()/1000>=Number(session.expires_at)-30){refreshSession().catch(()=>clearSession())}
      scheduleRefresh();
    }
  }
  function saveSession(x){
    if(!x?.access_token||!x?.user)return;
    session={...x,expires_at:x.expires_at||Math.floor(Date.now()/1000)+Number(x.expires_in||3600)};
    localStorage.setItem(SESSION_KEY,JSON.stringify(session));
    scheduleRefresh();
  }
  function clearSession(){session=null;localStorage.removeItem(SESSION_KEY);if(refreshTimer)clearTimeout(refreshTimer);refreshTimer=null;renderAccountButton()}
  function scheduleRefresh(){if(refreshTimer)clearTimeout(refreshTimer);if(!session)return;const seconds=Math.max(60,Number(session.expires_at||0)-Math.floor(Date.now()/1000)-120);refreshTimer=setTimeout(()=>refreshSession().catch(()=>{}),seconds*1000)}
  async function refreshSession(){if(!session?.refresh_token)return null;const r=await fetch(`${cfg.url.replace(/\/+$/,'')}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:cfg.anonKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});const x=await json(r);saveSession(x);return session}
  async function authRequest(path,body){
    const r=await fetch(`${cfg.url.replace(/\/+$/,'')}/auth/v1/${path}`,{method:'POST',headers:{apikey:cfg.anonKey,'Content-Type':'application/json'},body:JSON.stringify(body)});
    return json(r);
  }
  function normalizeIndianPhone(value){
    let s=String(value||'').trim().replace(/[\s().-]/g,'');
    if(/^\+91\d{10}$/.test(s))return s;
    if(/^91\d{10}$/.test(s))return `+${s}`;
    if(/^0\d{10}$/.test(s))return `+91${s.slice(1)}`;
    if(/^\d{10}$/.test(s))return `+91${s}`;
    return null;
  }
  function identifier(value){
    const s=String(value||'').trim();
    if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))return{email:s.toLowerCase()};
    const phone=normalizeIndianPhone(s);
    if(phone)return{phone};
    return null;
  }
  function displayIdentity(){return session?.user?.email||session?.user?.phone||'your account'}
  function renderAccountButton(){const b=$('ccAccountBtn');if(!b)return;b.textContent=session?'Account':'Sign in';b.setAttribute('aria-label',session?'Open account':'Sign in to CivilCareer');b.classList.toggle('signed-in',!!session)}
  function ensureButton(){const tools=document.querySelector('.nav-tools');if(!tools||$('ccAccountBtn'))return;const b=document.createElement('button');b.id='ccAccountBtn';b.className='icon-btn cc-account-btn';b.type='button';b.textContent='Sign in';b.onclick=openAccount;tools.insertBefore(b,tools.firstChild);renderAccountButton()}
  function modal(){let d=$('ccAccountDialog');if(d)return d;d=document.createElement('dialog');d.id='ccAccountDialog';d.className='cc-account-dialog';d.innerHTML='<div class="dialog-head"><h2 id="ccAccountTitle">CivilCareer Account</h2><button type="button" data-cc-close aria-label="Close">×</button></div><div class="dialog-body" id="ccAccountBody"></div>';document.body.appendChild(d);d.querySelector('[data-cc-close]').onclick=()=>d.close();return d}
  async function openAccount(){const d=modal();d.showModal();d.querySelector('#ccAccountBody').innerHTML='<p>Loading secure sign-in…</p>';try{await loadClient();renderAccount()}catch(e){d.querySelector('#ccAccountBody').innerHTML=`<div class="form-status error show">${escA(e.message||'Secure sign-in is not available right now.')}</div><p class="cc-account-note">The sign-in service could not be reached. If you manage CivilCareer, verify SUPABASE_URL and SUPABASE_ANON_KEY in Vercel Production.</p><button type="button" class="btn primary" id="ccRetryAuth">Retry sign-in</button>`;const retry=$('ccRetryAuth');if(retry)retry.onclick=()=>{cfg=null;openAccount()}}}
  function renderAccount(){
    const d=modal(),body=d.querySelector('#ccAccountBody');
    if(session){
      body.innerHTML=`<p class="cc-account-email">Signed in as <b>${escA(displayIdentity())}</b></p><div class="cc-account-stats"><span><b id="ccSavedCount">—</b> saved jobs</span><span><b id="ccAppliedCount">—</b> tracked applications</span></div><div class="cc-account-actions"><button class="btn primary" id="ccRefreshPersonal">Refresh My Career</button><button class="btn secondary" id="ccSync">Sync profile</button><button class="btn secondary" id="ccSignOut">Sign out</button></div><div id="ccAccountStatus" class="form-status"></div><section class="cc-account-section"><h3>Recommended for you</h3><div id="ccRecommendations"><p>Loading recommendations…</p></div></section><section class="cc-account-section"><h3>Application tracker</h3><div id="ccApplications"><p>Loading applications…</p></div></section><section class="cc-account-section"><h3>Job alerts</h3><form id="ccAlertForm" class="cc-alert-form"><div class="cc-alert-grid"><label>Alert type<select id="ccAlertType"><option value="all">All civil jobs</option><option value="private">Private jobs</option><option value="government">Government jobs</option></select></label><label>Keywords<input id="ccAlertKeywords" placeholder="site engineer, BIM, QS"></label><label>Role<input id="ccAlertRole" placeholder="Civil Engineer"></label><label>Location<input id="ccAlertLocation" placeholder="Bengaluru, Karnataka"></label><label>Frequency<select id="ccAlertFrequency"><option value="daily">Daily digest</option><option value="weekly">Weekly digest</option></select></label></div><button class="btn primary">Save alert preferences</button></form><div id="ccAlerts"><p>Loading alert preferences…</p></div></section>`;
      $('ccSignOut').onclick=async()=>{clearSession();toastA('Signed out. Your local preferences remain on this device.');d.close()};
      $('ccSync').onclick=async()=>{await syncAccount(true)};
      $('ccRefreshPersonal').onclick=async()=>{await syncAccount(true);if(typeof window.renderForYou==='function')window.renderForYou()};
      loadAlerts();syncAccount();
      return;
    }
    body.innerHTML=`<p class="cc-account-note">Sign in with your <b>email address (including Gmail) or Indian mobile number</b> and password. <b>No OTP or magic link is required for sign-in.</b></p><form id="ccSignInForm" class="cc-account-form"><label>Email or mobile number<input id="ccSignInId" type="text" required autocomplete="username" inputmode="email" placeholder="you@gmail.com or 9876543210"></label><label>Password<input id="ccSignInPassword" type="password" required autocomplete="current-password" placeholder="Your password"></label><button class="btn primary" id="ccSignInBtn">Sign in</button></form><div class="cc-account-links"><button type="button" class="text-link" id="ccShowSignup">Create account</button><button type="button" class="text-link" id="ccForgotPassword">Forgot password?</button></div><div id="ccAccountStatus" class="form-status"></div><p class="cc-account-note">Your profile, saved jobs, viewed jobs and application tracking can follow you across devices.</p>`;
    $('ccSignInForm').onsubmit=signIn;
    $('ccShowSignup').onclick=renderSignup;
    $('ccForgotPassword').onclick=renderForgotPassword;
  }
  function status(msg,type='error'){const st=$('ccAccountStatus');if(st){st.className=`form-status ${type} show`;st.textContent=msg}}
  async function signIn(e){
    e.preventDefault();const id=$('ccSignInId').value.trim(),password=$('ccSignInPassword').value;
    const ident=identifier(id);if(!ident){status('Enter a valid email address or 10-digit Indian mobile number.');return}if(password.length<1){status('Enter your password.');return}
    const b=$('ccSignInBtn');b.disabled=true;b.textContent='Signing in…';
    try{const x=await authRequest('token?grant_type=password',{...ident,password});saveSession(x);status('Signed in successfully.','success');renderAccountButton();setTimeout(()=>{renderAccount();toastA('Welcome back to CivilCareer.');},250)}catch(err){status(/invalid login credentials/i.test(err.message)?'Incorrect email/mobile number or password.':err.message||'Could not sign in. Please try again.')}finally{b.disabled=false;b.textContent='Sign in'}
  }
  function renderSignup(){const body=modal().querySelector('#ccAccountBody');body.innerHTML=`<p class="cc-account-note">Create your CivilCareer account with an email address or Indian mobile number and a password.</p><form id="ccSignupForm" class="cc-account-form"><label>Email or mobile number<input id="ccSignupId" type="text" required autocomplete="username" placeholder="you@gmail.com or 9876543210"></label><label>Password<input id="ccSignupPassword" type="password" required autocomplete="new-password" minlength="8" placeholder="At least 8 characters"></label><label>Confirm password<input id="ccSignupConfirm" type="password" required autocomplete="new-password" minlength="8" placeholder="Repeat password"></label><button class="btn primary" id="ccSignupBtn">Create account</button></form><div class="cc-account-links"><button type="button" class="text-link" id="ccBackSignin">Back to sign in</button></div><div id="ccAccountStatus" class="form-status"></div>`;$('ccSignupForm').onsubmit=signUp;$('ccBackSignin').onclick=renderAccount}
  async function signUp(e){e.preventDefault();const id=$('ccSignupId').value.trim(),password=$('ccSignupPassword').value,confirm=$('ccSignupConfirm').value;const ident=identifier(id);if(!ident){status('Enter a valid email address or 10-digit Indian mobile number.');return}if(password.length<8){status('Use a password with at least 8 characters.');return}if(password!==confirm){status('Passwords do not match.');return}const b=$('ccSignupBtn');b.disabled=true;b.textContent='Creating account…';try{const x=await authRequest('signup',{...ident,password});if(x.access_token)saveSession(x);if(x.access_token){status('Account created and signed in.','success');setTimeout(renderAccount,250)}else{status(ident.email?'Account created. If email confirmation is enabled in Supabase, open the confirmation email, then return here and sign in with your password.':'Account created. If phone confirmation is enabled in Supabase, an SMS verification step will be required by Supabase. To keep CivilCareer OTP-free, disable phone confirmation in Auth settings.','success');$('ccSignupForm').reset()}}catch(err){status(err.message||'Could not create the account. Please try again.')}finally{b.disabled=false;b.textContent='Create account'}}
  function renderForgotPassword(){const body=modal().querySelector('#ccAccountBody');body.innerHTML=`<p class="cc-account-note">Enter your email address and Supabase will send a password-reset link. Password reset uses an email link rather than an OTP.</p><form id="ccForgotForm" class="cc-account-form"><label>Email address<input id="ccForgotEmail" type="email" required autocomplete="email" placeholder="you@gmail.com"></label><button class="btn primary" id="ccForgotBtn">Send reset link</button></form><div class="cc-account-links"><button type="button" class="text-link" id="ccBackSignin">Back to sign in</button></div><div id="ccAccountStatus" class="form-status"></div>`;$('ccForgotForm').onsubmit=forgotPassword;$('ccBackSignin').onclick=renderAccount}
  async function forgotPassword(e){e.preventDefault();const email=$('ccForgotEmail').value.trim().toLowerCase();const b=$('ccForgotBtn');b.disabled=true;b.textContent='Sending…';try{const r=await fetch(`${cfg.url.replace(/\/+$/,'')}/auth/v1/recover`,{method:'POST',headers:{apikey:cfg.anonKey,'Content-Type':'application/json'},body:JSON.stringify({email,redirect_to:location.origin+location.pathname})});await json(r);status('If an account uses that email address, a password-reset link will be sent.','success')}catch(err){status(err.message||'Could not send the reset link. Please try again.')}finally{b.disabled=false;b.textContent='Send reset link'}}
  async function loadAlerts(){if(!session||!$('ccAlerts'))return;try{const r=await fetch('/api/alerts',{headers:{authorization:`Bearer ${session.access_token}`},cache:'no-store'});const x=await r.json();if(!r.ok)throw Error(x.error||'Could not load alerts.');const a=(x.alerts||[])[0];if(a){$('ccAlertType').value=a.alert_type||'all';$('ccAlertKeywords').value=a.keywords||'';$('ccAlertRole').value=a.role||'';$('ccAlertLocation').value=a.location||'';$('ccAlertFrequency').value=a.frequency||'daily'}$('ccAlerts').innerHTML=a?`<div class="cc-account-job"><div><b>${escA(a.active?'Alert active':'Alert paused')}</b><span>${escA(a.alert_type||'all')} · ${escA(a.frequency||'daily')}</span><small>${escA([a.keywords,a.role,a.location].filter(Boolean).join(' · ')||'All civil opportunities')}</small></div><button class="btn secondary" id="ccDeleteAlert" type="button">Remove</button></div>`:'<p>No alert preferences saved yet.</p>';const d=$('ccDeleteAlert');if(d)d.onclick=async()=>{await fetch('/api/alerts',{method:'DELETE',headers:{'content-type':'application/json',authorization:`Bearer ${session.access_token}`},body:JSON.stringify({id:a.id})});loadAlerts()};const f=$('ccAlertForm');if(f&&!f.dataset.wired){f.dataset.wired='1';f.onsubmit=async e=>{e.preventDefault();const payload={alert_type:$('ccAlertType').value,keywords:$('ccAlertKeywords').value,role:$('ccAlertRole').value,location:$('ccAlertLocation').value,frequency:$('ccAlertFrequency').value,active:true};const rr=await fetch('/api/alerts',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${session.access_token}`},body:JSON.stringify(payload)});const xx=await rr.json();const st=$('ccAccountStatus');if(!rr.ok){if(st){st.className='form-status error';st.textContent=xx.error||'Could not save alert.'}return}if(st){st.className='form-status success';st.textContent='Alert preferences saved. New matching jobs can be queued for delivery.'}loadAlerts()}}}catch(e){$('ccAlerts').innerHTML=`<div class="form-status error">${escA(e.message)}</div>`}}
  function localProfile(){try{return JSON.parse(localStorage.getItem('cc_civil_profile')||'{}')}catch{return{}}}
  async function authFetch(action,payload={}){if(!session)return null;try{const r=await fetch('/api/account',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${session.access_token}`},body:JSON.stringify({action,...payload})});const x=await r.json();if(r.status===401&&session.refresh_token){await refreshSession();return authFetch(action,payload)}if(!r.ok)throw Error(x.error||'Account sync failed.');return x}catch(e){throw e}}
  async function syncAccount(showStatus=false){if(!session)return;try{const r=await fetch('/api/account',{headers:{authorization:`Bearer ${session.access_token}`},cache:'no-store'});if(r.status===401&&session.refresh_token){await refreshSession();return syncAccount(showStatus)}const x=await r.json();if(!r.ok)throw Error(x.error||'Could not load account.');const remote=x.profile||null,local=localProfile();if(remote)localStorage.setItem('cc_civil_profile',JSON.stringify({...local,...remote,skills:Array.isArray(remote.skills)?remote.skills:local.skills||[]}));else if(Object.keys(local).length)await authFetch('profile',{profile:local});const saved=new Set(x.saved_job_ids||[]);const localSaved=new Set(JSON.parse(localStorage.getItem('cc_saved')||'[]'));for(const id of localSaved){if(/^[0-9a-f-]{36}$/i.test(id)&&!saved.has(id))await authFetch('save',{job_id:id});saved.add(id)}localStorage.setItem('cc_saved',JSON.stringify([...saved]));localStorage.setItem('cc_recommendations',JSON.stringify(x.recommendations||[]));window.__ccRecommendations=x.recommendations||[];const im=JSON.parse(localStorage.getItem('cc_interactions')||'{}');(x.applications||[]).forEach(a=>{if(a.job_id)im[a.job_id]=a.status==='Applied'?'applied':'saved'});localStorage.setItem('cc_interactions',JSON.stringify(im));if($('ccSavedCount'))$('ccSavedCount').textContent=String(saved.size);if($('ccAppliedCount'))$('ccAppliedCount').textContent=String((x.applications||[]).length);if($('ccRecommendations'))$('ccRecommendations').innerHTML=(x.recommendations||[]).length?(x.recommendations||[]).slice(0,6).map(j=>`<article class="cc-account-job"><div><b>${escA(j.role||'Civil opportunity')}</b><span>${escA(j.company||'Organization')} · ${escA(j.location_display||j.location||'India')}</span><small>${escA((j.reasons||[]).slice(0,2).join(' · ')||'Based on your profile')}</small></div><a class="btn secondary" href="/jobs/${encodeURIComponent(j.slug||j.id)}">View</a></article>`).join(''):'<p>No additional recommendations yet. Add more profile details or check again after new jobs are published.</p>';if($('ccApplications'))$('ccApplications').innerHTML=(x.applications||[]).length?(x.applications||[]).slice(0,8).map(a=>`<div class="cc-account-job"><div><b>${escA(a.status||'Tracked')}</b><span>Job ID: ${escA(a.job_id)}</span><small>Updated ${escA(String(a.updated_at||a.applied_at||'').slice(0,10))}</small></div></div>`).join(''):'<p>No applications tracked yet. Use Apply on a job and mark it as applied.</p>';if(showStatus&&$('ccAccountStatus'))status('Your profile, saved jobs and career workflow are synced.','success');renderAccountButton()}catch(e){if($('ccAccountStatus'))status(e.message)}}
  async function pushProfile(){if(session)try{await authFetch('profile',{profile:localProfile()})}catch{}}
  function wrap(){if(window.__ccAccountWrapped)return;window.__ccAccountWrapped=true;const oldToggle=window.toggleSave;window.toggleSave=async function(id){oldToggle(id);if(session)try{const saved=new Set(JSON.parse(localStorage.getItem('cc_saved')||'[]'));await authFetch(saved.has(id)?'save':'unsave',{job_id:id})}catch{}};const oldMark=window.markViewed;window.markViewed=function(id){oldMark(id);if(session&&id)authFetch('view',{job_id:id}).catch(()=>{})};const oldSave=window.saveProfile;window.saveProfile=async function(){oldSave();await pushProfile()};const oldTrack=window.trackJob;window.trackJob=async function(id,action,btn){oldTrack(id,action,btn);if(session&&['saved','unsave','applied'].includes(action))try{if(action==='saved')await authFetch('save',{job_id:id});else if(action==='unsave')await authFetch('unsave',{job_id:id});else if(action==='applied')await authFetch('application',{job_id:id,status:'Applied'})}catch{}}}
  document.addEventListener('DOMContentLoaded',async()=>{ensureButton();wrap();try{await loadClient();if(await handleRecoveryHash())return;renderAccountButton()}catch{}});
  window.openAccount=openAccount;window.ccAccount={open:openAccount,sync:syncAccount};
})();
