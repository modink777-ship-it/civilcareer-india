/**
 * CivilCareer — gated admin page (gap report A3)
 *
 * vercel.json rewrites /admin (and /admin.html, closing the static
 * bypass) to /api/admin-page. The admin bundle is served ONLY after
 * the caller's session is verified against the ADMIN_EMAIL /
 * ADMIN_USER_ID allowlist — the same verifyAdminToken check every
 * admin JSON endpoint uses (lib/security.js).
 *
 * Credential sources:
 *   1. Authorization: Bearer <supabase access token> — scripts/curl
 *   2. cc_admin_session cookie — set by admin.html (and by the shell
 *      below) right after a successful Supabase password login.
 *      It carries the same short-lived ACCESS token that already
 *      lives in sessionStorage; never the refresh token.
 *
 * Without a valid session the caller gets a minimal sign-in shell.
 * The admin bundle itself (structure, field names, admin surface)
 * is never publicly fetchable.
 */

const { verifyAdminToken } = require('../lib/security');
const { html: ADMIN_HTML } = require('./admin-page-html');

function bearerToken(req) {
  const m = String(req.headers?.authorization || '').match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : '';
}

function cookieToken(req) {
  const m = String(req.headers?.cookie || '').match(/(?:^|;\s*)cc_admin_session=([^;]+)/);
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
}

/* Minimal, dependency-free sign-in shell. Deliberately generic:
   no admin structure, field names or dashboard markup. The login
   flow mirrors admin.html (Supabase password grant via the public
   /api/auth-config), then stores the session and reloads /admin so
   the gate can recognise the fresh cookie. */
const SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Administrator sign-in</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#eaf1f8;font:15.5px/1.58 Inter,Manrope,"Segoe UI",Arial,sans-serif}card,.card{box-sizing:border-box}.card{background:#0f2847;border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:2.5rem;width:100%;max-width:400px;text-align:center;color:#fff}.card h1{font-size:1.5rem;font-weight:800;margin:0 0 6px}.card p{color:#6a8aaa;font-size:.85rem;margin:0 0 1.5rem}.card input{width:100%;padding:12px 16px;border-radius:10px;border:1.5px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;font-size:1rem;font-family:inherit;text-align:center;letter-spacing:.08em;margin-bottom:12px;outline:none;box-sizing:border-box}.card input:focus{border-color:#c9973c}.card button{width:100%;padding:12px;background:#c9973c;color:#0b1f3a;border:none;border-radius:10px;font-weight:800;font-size:.95rem;cursor:pointer;font-family:inherit}.card button:hover{background:#e8b04a}.err{color:#fca5a5;font-size:.82rem;margin-top:8px;min-height:1.2em}</style>
</head>
<body>
<main class="card">
  <h1>Administrator sign-in</h1>
  <p>Supabase email and password</p>
  <form id="f">
    <input id="email" type="email" placeholder="Email" autocomplete="username">
    <input id="password" type="password" placeholder="Password" autocomplete="current-password">
    <button type="submit">Continue</button>
  </form>
  <p id="err" class="err" hidden></p>
  <noscript>JavaScript is required to sign in.</noscript>
</main>
<script>
(function(){
  var form=document.getElementById('f'),err=document.getElementById('err');
  function show(msg){err.textContent=msg;err.hidden=false;}
  function store(token,refresh,expiresIn){
    try{sessionStorage.setItem('cc_admin_token',token);if(refresh)sessionStorage.setItem('cc_admin_refresh',refresh);}catch(e){}
    document.cookie='cc_admin_session='+encodeURIComponent(token)+'; path=/; same-site=lax; max-age='+(parseInt(expiresIn,10)||3600);
  }
  function signIn(email,password){
    return fetch('/api/auth-config',{cache:'no-store'}).then(function(r){return r.json();}).then(function(cfg){
      if(!cfg.url||!cfg.anonKey)throw new Error('Authentication is not configured.');
      return fetch(cfg.url.replace(/\\/$/,'')+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:cfg.anonKey,'Content-Type':'application/json'},body:JSON.stringify({email:email,password:password})})
        .then(function(r){return r.json().then(function(x){return{ok:r.ok,x:x};});});
    }).then(function(res){
      if(!res.ok||!res.x.access_token)throw new Error(res.x.error_description||res.x.msg||'Administrator sign-in failed.');
      store(res.x.access_token,res.x.refresh_token||'',res.x.expires_in||3600);
      location.replace('/admin');
    });
  }
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var email=document.getElementById('email').value.trim().toLowerCase();
    var password=document.getElementById('password').value;
    if(!email||!password)return;
    signIn(email,password).catch(function(ex){show(ex.message||'Administrator sign-in failed.');});
  });
  /* Session restore: this tab has a session but the cookie is
     missing or expired. One guarded retry, then refresh, else the
     sign-in form — never a reload loop. */
  var retried=sessionStorage.getItem('cc_admin_retry');
  var token=sessionStorage.getItem('cc_admin_token');
  var refresh=sessionStorage.getItem('cc_admin_refresh');
  if(token&&!retried){
    sessionStorage.setItem('cc_admin_retry','1');
    store(token,refresh,3600);
    location.replace('/admin');
  }else if(refresh){
    sessionStorage.removeItem('cc_admin_retry');
    fetch('/api/admin-auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({op:'refresh_token',refresh_token:refresh})})
      .then(function(r){return r.json().then(function(x){return{ok:r.ok,x:x};});})
      .then(function(res){
        if(res.ok&&res.x.access_token){store(res.x.access_token,res.x.refresh_token||refresh,res.x.expires_in||3600);location.replace('/admin');}
        else{sessionStorage.clear();}
      }).catch(function(){sessionStorage.clear();});
  }
})();
</script>
</body>
</html>`;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const token = bearerToken(req) || cookieToken(req);
  /* Fail closed: no credential or any verification failure
     (including misconfiguration / network error) gets the shell. */
  const auth = token ? await verifyAdminToken(token) : { ok: false };
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.statusCode = 200;
  res.end(auth.ok ? ADMIN_HTML : SHELL);
};
