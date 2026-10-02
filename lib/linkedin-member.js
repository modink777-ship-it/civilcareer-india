const API = 'https://api.linkedin.com/rest/posts';

function errorResult(message,retryable=false,response=null){
  return {ok:false,externalId:null,externalUrl:null,destinationRef:null,error:message,response,retryable};
}

async function publishMemberPost({token,authorUrn,apiVersion,text} = {}){
  if(!token)return errorResult('LINKEDIN_ACCESS_TOKEN not set');
  if(!authorUrn)return errorResult('LINKEDIN_AUTHOR_URN not set');
  if(!apiVersion)return errorResult('LINKEDIN_API_VERSION not set');
  if(!text)return errorResult('Empty LinkedIn text');

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);
  try{
    const response=await fetch(API,{
      method:'POST',
      headers:{
        Authorization:'Bearer '+String(token),
        'Content-Type':'application/json',
        'X-Restli-Protocol-Version':'2.0.0',
        'Linkedin-Version':String(apiVersion),
      },
      body:JSON.stringify({
        author:String(authorUrn),
        commentary:String(text).slice(0,3000),
        visibility:'PUBLIC',
        distribution:{feedDistribution:'MAIN_FEED',targetEntities:[],thirdPartyDistributionChannels:[]},
        lifecycleState:'PUBLISHED',
        isReshareDisabledByAuthor:false,
      }),
      signal:controller.signal,
    });
    const raw=await response.text();
    let payload=null;
    try{payload=raw?JSON.parse(raw):null;}catch(_){}
    if(response.status===201||response.status===200){
      const header=String(response.headers.get('x-restli-id')||'');
      const id=header||null;
      return {ok:true,externalId:id,externalUrl:id?'https://www.linkedin.com/feed/update/'+encodeURIComponent(id):null,destinationRef:String(authorUrn),error:null,response:payload,retryable:false};
    }
    const detail=payload&&((payload.message)||((payload.error||{}).message)||payload.error_description);
    return errorResult('LinkedIn error: '+String(detail||('HTTP '+response.status)),response.status===429||response.status>=500,payload);
  }catch(err){
    const ambiguous=err&&err.name==='AbortError';
    return {ok:false,externalId:null,externalUrl:null,destinationRef:String(authorUrn),error:ambiguous?'LinkedIn request timed out — delivery is uncertain':'LinkedIn network error: '+String(err&&err.message||err),response:null,retryable:false,ambiguous};
  }finally{clearTimeout(timer);}
}

module.exports={publishMemberPost};
