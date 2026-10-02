/**
 * CivilCareer — Social Content Engine publishers (P2, gap report F3)
 *
 * Every platform send goes through this module so the API layer
 * never talks to a platform directly. Publishers return a uniform
 * result:
 *   { ok, externalId, externalUrl, destinationRef, error, response, retryable }
 * `response` is the RAW platform response — the API layer redacts
 * it (redactSecrets) before persisting response_snapshot.
 *
 * Telegram: plain-text channel posts (api.telegram.org).
 * LinkedIn/Instagram: later-phase official API publishers; Phase 1
 * keeps them fail-closed until their approved account routes are implemented.
 * WhatsApp: not an external publisher; manual copy/share only.
 * All publishers return a uniform result and never hide platform failures.
 */

const { PLATFORMS } = require('./social-core');
const linkedinMember = require('./linkedin-member');

const TELEGRAM_API_HOST = 'api.telegram.org';

/* ── Telegram ─────────────────────────────────────────── */

/**
 * POST /sendMessage to a channel. Plain text (no parse_mode) so
 * unusual exam/company names can never break delivery — the same
 * discipline as the pre-engine announcer in _api/exam-tracker.js.
 */
function sendTelegram({ token, chatId, text, disablePreview = true }) {
  return new Promise((resolve) => {
    if (!token) {
      resolve({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set', retryable: false });
      return;
    }
    if (!chatId) {
      resolve({ ok: false, error: 'TELEGRAM_CHANNEL_ID not set', retryable: false });
      return;
    }
    if (!text) {
      resolve({ ok: false, error: 'Empty Telegram text', retryable: false });
      return;
    }

    const https = require('https');
    const body = JSON.stringify({
      chat_id: chatId,
      text: String(text).slice(0, 4096),
      disable_web_page_preview: disablePreview,
    });

    const rq = https.request({
      hostname: TELEGRAM_API_HOST,
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 10000,
    }, (rs) => {
      let data = '';
      rs.on('data', (d) => { data += d; });
      rs.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (_) { parsed = null; }
        if (parsed && parsed.ok) {
          const messageId = parsed.result && parsed.result.message_id;
          const numeric = String(chatId).replace(/^-100/, '');
          resolve({
            ok: true,
            externalId: messageId != null ? String(messageId) : null,
            externalUrl: /^\d+$/.test(numeric) && messageId != null
              ? `https://t.me/c/${numeric}/${messageId}`
              : null,
            destinationRef: String(chatId),
            error: null,
            response: parsed,
            retryable: false,
          });
          return;
        }
        const description = parsed && (parsed.description || parsed.error_code);
        /* 429 and 5xx are retryable; other Telegram errors are not. */
        const code = parsed && parsed.error_code;
        resolve({
          ok: false,
          externalId: null,
          externalUrl: null,
          destinationRef: String(chatId),
          error: description || `Telegram error (HTTP ${rs.statusCode})`,
          response: parsed,
          retryable: code === 429 || (rs.statusCode >= 500),
        });
      });
    });
    rq.on('error', (err) => resolve({
      ok: false,
      error: `Telegram network error: ${err && err.message}`,
      retryable: false,
      ambiguous: true,
      response: null,
    }));
    rq.on('timeout', () => {
      rq.destroy();
      resolve({
        ok: false,
        error: 'Telegram request timed out — delivery is uncertain',
        retryable: false,
        ambiguous: true,
        response: null,
      });
    });
    rq.write(body);
    rq.end();
  });
}

/* ── shared HTTP ────────────────────────────────── */

const DEFAULT_TIMEOUT_MS = 10000;

/** Small fetch wrapper with a timeout + JSON parse.
 *  Returns { status, headers, payload } — never throws. */
async function platformRequest(url, { method = 'POST', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body == null ? undefined : body,
      signal: controller.signal,
    });
    let payload = null;
    const text = await res.text();
    if (text) {
      try { payload = JSON.parse(text); } catch (_) { payload = null; }
    }
    return { status: res.status, headers: res.headers, payload };
  } catch (err) {
    return { status: 0, headers: null, payload: null, networkError: err };
  } finally {
    clearTimeout(timer);
  }
}

function platformError(kind, status, payload, networkError) {
  if (networkError) {
    return `${kind} network error: ${networkError && networkError.message}`;
  }
  /* Meta (Instagram) and LinkedIn nest the human-readable
     message under payload.error.message — flatten any shape
     so `error` is always a STRING in the uniform result. */
  const raw = payload && (payload.message || payload.error || payload.error_description);
  const detail = typeof raw === 'string' ? raw : (raw && raw.message);
  return detail || `${kind} error (HTTP ${status})`;
}

/* ── LinkedIn (Marketing Developer Platform) ─────── */

const LINKEDIN_API_HOST = 'https://api.linkedin.com';

function linkedinHeaders(token, apiVersion) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
  };
  if (apiVersion) headers['LinkedIn-Version'] = String(apiVersion);
  return headers;
}

/** POST /rest/shares as an organization. Returns the
 *  share URN from the x-restli-id response header. */
async function sendLinkedIn({ token, organizationId, authorUrn, apiVersion, text, mediaUrl } = {}) {
  if (!organizationId && authorUrn) {
    return linkedinMember.publishMemberPost({ token, authorUrn, apiVersion, text });
  }
  if (!token) {
    return { ok: false, externalId: null, externalUrl: null, destinationRef: null, error: 'LINKEDIN_ACCESS_TOKEN not set', response: null, retryable: false };
  }
  if (!organizationId) {
    return { ok: false, externalId: null, externalUrl: null, destinationRef: null, error: 'LINKEDIN_ORGANIZATION_ID not set', response: null, retryable: false };
  }
  if (!text) {
    return { ok: false, externalId: null, externalUrl: null, destinationRef: null, error: 'Empty LinkedIn text', response: null, retryable: false };
  }

  const shareText = String(text).slice(0, 3000);
  const shareContent = {
    shareCommentary: { text: shareText },
    shareMediaCategory: 'NONE',
  };
  if (mediaUrl && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(String(mediaUrl))) {
    shareContent.shareMediaCategory = 'IMAGE';
    shareContent.media = [{
      status: 'READY',
      originalUrl: String(mediaUrl).slice(0, 2048),
      description: { text: shareText.slice(0, 256) },
    }];
  }

  const response = await platformRequest(`${LINKEDIN_API_HOST}/rest/shares`, {
    headers: linkedinHeaders(token, apiVersion),
    body: JSON.stringify({
      author: `urn:li:organization:${organizationId}`,
      lifecycleState: 'PUBLISHED',
      specificContent: { 'com.linkedin.ugc.ShareContent': shareContent },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
  });

  const destinationRef = String(organizationId);
  if (response.networkError) {
    return { ok: false, externalId: null, externalUrl: null, destinationRef, error: platformError('LinkedIn', 0, null, response.networkError), response: null, retryable: true };
  }
  const { status, headers, payload } = response;
  if (status === 201 || status === 200) {
    const headerId = String((headers && headers.get && headers.get('x-restli-id')) || '');
    const match = headerId.match(/urn:li:share:(\d+)/);
    const id = (match && match[1]) || headerId || null;
    return {
      ok: true,
      externalId: id,
      externalUrl: id ? `https://www.linkedin.com/feed/update/urn:li:share:${id}` : null,
      destinationRef,
      error: null,
      response: payload,
      retryable: false,
    };
  }
  return {
    ok: false,
    externalId: null,
    externalUrl: null,
    destinationRef,
    error: platformError('LinkedIn', status, payload),
    response: payload,
    retryable: status === 429 || status >= 500,
  };
}

/* ── Instagram (Instagram API with Instagram Login) ── */

const INSTAGRAM_API_HOST = 'https://graph.instagram.com';
const DEFAULT_INSTAGRAM_API_VERSION = 'v26.0';

function instagramBase(accountId, apiVersion) {
  const version = String(apiVersion || DEFAULT_INSTAGRAM_API_VERSION).replace(/^v?/,'v');
  return `${INSTAGRAM_API_HOST}/${version}/${encodeURIComponent(accountId)}`;
}

/** Step 1 only: create an Instagram media container.
 *  The container id is intentionally returned as needs_second_step so
 *  the Social Engine can publish it from a later request. */
async function createInstagramContainer({ token, accountId, apiVersion, caption, mediaUrl } = {}) {
  if (!token) return { ok:false,status:'not_configured',externalId:null,externalUrl:null,destinationRef:null,error:'INSTAGRAM_ACCESS_TOKEN not set',response:null,retryable:false };
  if (!accountId) return { ok:false,status:'not_configured',externalId:null,externalUrl:null,destinationRef:null,error:'INSTAGRAM_BUSINESS_ACCOUNT_ID not set',response:null,retryable:false };
  if (!caption) return { ok:false,status:'failed',externalId:null,externalUrl:null,destinationRef:String(accountId),error:'Empty Instagram caption',response:null,retryable:false };

  const media=String(mediaUrl||'').trim();
  if (!media || !/^https?:\/\//i.test(media)) {
    return { ok:false,status:'failed',externalId:null,externalUrl:null,destinationRef:String(accountId),error:'Instagram requires a public media URL',response:null,retryable:false };
  }
  if (!/\.jpe?g(?:\?|$)/i.test(media)) {
    return { ok:false,status:'failed',externalId:null,externalUrl:null,destinationRef:String(accountId),error:'Instagram image publishing requires a public JPEG media_url',response:null,retryable:false };
  }

  const base=instagramBase(accountId,apiVersion);
  const params=new URLSearchParams({image_url:media,caption:String(caption).slice(0,2200),access_token:token});
  const created=await platformRequest(`${base}/media`,{
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:params.toString(),
  });
  const destinationRef=String(accountId);
  if(created.networkError){
    return { ok:false,status:'uncertain',externalId:null,externalUrl:null,destinationRef,error:'Instagram container request timed out or failed ambiguously',response:null,retryable:false,ambiguous:true };
  }
  const containerId=created.payload&&created.payload.id;
  if(created.status!==200||!containerId){
    return { ok:false,status:'failed',externalId:null,externalUrl:null,destinationRef,error:platformError('Instagram',created.status,created.payload),response:created.payload,retryable:created.status===429||created.status>=500 };
  }
  return {
    ok:false,
    status:'needs_second_step',
    externalId:String(containerId),
    externalUrl:null,
    destinationRef,
    error:null,
    response:created.payload,
    retryable:false,
  };
}

/** Step 2: inspect a container once. Callers must enforce the one-minute
 * minimum between polls; this module never loops or sleeps. */
async function getInstagramContainerStatus({ token, containerId, apiVersion } = {}) {
  if (!token) return { ok:false,status:'not_configured',error:'INSTAGRAM_ACCESS_TOKEN not set',response:null,retryable:false };
  if (!containerId) return { ok:false,status:'failed',error:'Instagram container id is required',response:null,retryable:false };
  const url=`https://graph.instagram.com/${String(apiVersion || DEFAULT_INSTAGRAM_API_VERSION).replace(/^v?/,'v')}/${encodeURIComponent(containerId)}?fields=status_code,status&access_token=${encodeURIComponent(token)}`;
  const response=await platformRequest(url,{method:'GET'});
  if(response.networkError) return {ok:false,status:'uncertain',error:'Instagram container status request was ambiguous',response:null,retryable:false,ambiguous:true};
  if(response.status!==200) return {ok:false,status:'failed',error:platformError('Instagram',response.status,response.payload),response:response.payload,retryable:response.status===429||response.status>=500};
  const payload=response.payload||{};
  return {ok:true,status:String(payload.status_code||'').toUpperCase()||'UNKNOWN',error:null,response:payload,retryable:false};
}

/** Step 2 finalization. The engine calls this only after a later,
 * explicit admin action or scheduled worker decides the container is ready. */
async function publishInstagramContainer({ token, accountId, apiVersion, containerId, skipStatusCheck = false } = {}) {
  if (!token) return { ok:false,status:'not_configured',externalId:null,externalUrl:null,destinationRef:String(accountId||''),error:'INSTAGRAM_ACCESS_TOKEN not set',response:null,retryable:false };
  if (!accountId) return { ok:false,status:'not_configured',externalId:null,externalUrl:null,destinationRef:null,error:'INSTAGRAM_BUSINESS_ACCOUNT_ID not set',response:null,retryable:false };
  if (!containerId) return { ok:false,status:'failed',externalId:null,externalUrl:null,destinationRef:String(accountId),error:'Instagram container id is required',response:null,retryable:false };

  const ready=skipStatusCheck ? {ok:true,status:'FINISHED',response:null,error:null} : await getInstagramContainerStatus({token,containerId,apiVersion});
  if(!ready.ok || ready.status!=='FINISHED'){
    const expired=['EXPIRED','ERROR'].includes(ready.status);
    return {
      ok:false,
      status:expired?(ready.status==='EXPIRED'?'expired':'failed'):'needs_second_step',
      externalId:String(containerId),
      externalUrl:null,
      destinationRef:String(accountId),
      error:ready.error || `Instagram container status is ${ready.status}; try again after processing completes.`,
      response:ready.response,
      retryable:false,
      ambiguous:ready.ambiguous,
    };
  }

  const base=instagramBase(accountId,apiVersion);
  const response=await platformRequest(`${base}/media_publish`,{
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({creation_id:String(containerId),access_token:String(token)}).toString(),
  });
  const destinationRef=String(accountId);
  if(response.networkError){
    return {ok:false,status:'uncertain',externalId:String(containerId),externalUrl:null,destinationRef,error:'Instagram publish request was ambiguous',response:null,retryable:false,ambiguous:true};
  }
  const mediaId=response.payload&&response.payload.id;
  if(response.status!==200||!mediaId){
    return {ok:false,status:'failed',externalId:String(containerId),externalUrl:null,destinationRef,error:platformError('Instagram',response.status,response.payload),response:response.payload,retryable:response.status===429||response.status>=500};
  }

  let permalink=null;
  try{
    const lookup=await platformRequest(`${base}/${encodeURIComponent(mediaId)}?fields=permalink&access_token=${encodeURIComponent(token)}`,{method:'GET'});
    if(lookup.status===200&&lookup.payload&&lookup.payload.permalink) permalink=String(lookup.payload.permalink);
  }catch(_){}

  return {ok:true,status:'sent',externalId:String(mediaId),externalUrl:permalink,destinationRef,error:null,response:response.payload,retryable:false};
}

/** Backward-compatible helper for non-engine callers/tests. The Social
 * Engine itself uses createInstagramContainer + publishInstagramContainer. */
async function sendInstagram(args={}) {
  const first=await createInstagramContainer(args);
  if(first.status==='needs_second_step') {
    return publishInstagramContainer({...args,containerId:first.externalId});
  }
  return first;
}

/* ── dispatch + configuration ─────────────────────────── */

const PUBLISHERS = {
  telegram: sendTelegram,
  linkedin: (args = {}) => linkedinMember.publishMemberPost({
    token: process.env.LINKEDIN_ACCESS_TOKEN,
    authorUrn: process.env.LINKEDIN_AUTHOR_URN,
    apiVersion: process.env.LINKEDIN_API_VERSION,
    text: args.text,
  }),
  instagram: createInstagramContainer,
};

function publisherFor(platform) {
  return PUBLISHERS[platform] || null;
}

/**
 * Is the platform wired up enough to attempt a send?
 * Telegram needs bot token + a channel (real or test).
 * LinkedIn needs a token AND the organization it posts as;
 * Instagram needs a token AND the business account id.
 */
function platformConfigured(platform, env = process.env) {
  switch (platform) {
    case 'telegram':
      return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHANNEL_ID);
    case 'linkedin':
      return Boolean(
        env.LINKEDIN_ACCESS_TOKEN && env.LINKEDIN_API_VERSION && env.LINKEDIN_AUTHOR_URN
      );
    case 'instagram':
      return Boolean(env.INSTAGRAM_ACCESS_TOKEN && env.INSTAGRAM_BUSINESS_ACCOUNT_ID && env.INSTAGRAM_API_VERSION);
    default:
      return false;
  }
}

/** Optional test destination. Never falls back to the production
 * channel: the current project uses the production channel directly
 * for approved real posts. */
function telegramTestChannel(env = process.env) {
  return env.TELEGRAM_TEST_CHANNEL_ID || null;
}

module.exports = {
  PUBLISHERS, publisherFor, platformConfigured,
  sendTelegram, sendLinkedIn, sendInstagram, createInstagramContainer,
  getInstagramContainerStatus, publishInstagramContainer,
  telegramTestChannel, PLATFORMS,
};
