const test=require('node:test');
const assert=require('node:assert/strict');
const publishers=require('../lib/social-publishers');
const fs=require('fs');
const path=require('path');

function stubFetch(fn){
  const old=global.fetch;
  global.fetch=fn;
  return ()=>{global.fetch=old;};
}

test('P6 Instagram Login uses graph.instagram.com and creates a deferred container',async()=>{
  const calls=[];
  const restore=stubFetch(async(url,init={})=>{
    calls.push({url:String(url),method:init.method||'GET',body:String(init.body||'')});
    return {status:200,headers:{get:()=>null},text:async()=>JSON.stringify({id:'container-1'})};
  });
  try{
    const out=await publishers.createInstagramContainer({
      token:'ig-token',
      accountId:'17841',
      apiVersion:'v26.0',
      caption:'Hello Instagram',
      mediaUrl:'https://storage.example/social/a.jpg'
    });
    assert.equal(out.status,'needs_second_step');
    assert.equal(out.externalId,'container-1');
    assert.match(calls[0].url,/^https:\/\/graph\.instagram\.com\/v26\.0\/17841\/media$/);
    assert.match(calls[0].body,/image_url=/);
    assert.ok(!calls.some(x=>x.url.includes('graph.facebook.com')));
  }finally{restore();}
});

test('P6 Instagram Login refuses non-JPEG image media',async()=>{
  let calls=0;
  const restore=stubFetch(async()=>{calls++;throw new Error('unexpected network');});
  try{
    const out=await publishers.createInstagramContainer({
      token:'ig-token',accountId:'17841',caption:'Hello',mediaUrl:'https://storage.example/a.png'
    });
    assert.equal(out.ok,false);
    assert.equal(out.status,'failed');
    assert.match(out.error,/public JPEG media_url/);
    assert.equal(calls,0);
  }finally{restore();}
});

test('P6 Instagram final publish is blocked until container is FINISHED',async()=>{
  const calls=[];
  const restore=stubFetch(async(url,init={})=>{
    const method=init.method||'GET';
    calls.push({url:String(url),method});
    if(method==='GET') return {status:200,headers:{get:()=>null},text:async()=>JSON.stringify({status_code:'FINISHED',status:'Finished'})};
    if(String(url).endsWith('/media_publish')) return {status:200,headers:{get:()=>null},text:async()=>JSON.stringify({id:'media-1'})};
    if(String(url).includes('fields=permalink')) return {status:200,headers:{get:()=>null},text:async()=>JSON.stringify({permalink:'https://www.instagram.com/p/abc/'})};
    throw new Error('unexpected call');
  });
  try{
    const out=await publishers.publishInstagramContainer({
      token:'ig-token',accountId:'17841',apiVersion:'v26.0',containerId:'container-1'
    });
    assert.equal(out.ok,true);
    assert.equal(out.status,'sent');
    assert.equal(out.externalId,'media-1');
    assert.equal(calls[0].method,'GET');
    assert.equal(calls.some(x=>x.url.includes('/media_publish')),true);
  }finally{restore();}
});

test('P6 social engine has an explicit publish_container action for Instagram',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','_api','social.js'),'utf8');
  assert.match(src,/publishInstagramSecondStep/);
  assert.match(src,/publish_container/);
  assert.match(src,/needs_second_step/);
});

test('P6 publishers export separate container and publish methods',()=>{
  assert.equal(typeof publishers.createInstagramContainer,'function');
  assert.equal(typeof publishers.getInstagramContainerStatus,'function');
  assert.equal(typeof publishers.publishInstagramContainer,'function');
});
