const test=require('node:test');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const graphics=require('../lib/social-graphics-core');
const fs=require('fs');
const path=require('path');

test('P4 graphics core produces both required SVG sizes without government logos',()=>{
  for(const size of ['1080x1080','1080x1350']){
    const svg=graphics.createGraphic('government_job',{
      title:'Junior Engineer Civil',
      organization:'Example PWD',
      civil_posts_count:12,
      apply_end:'2026-10-12'
    },size);
    assert.match(svg,new RegExp(`width="1080" height="${size==='1080x1350'?1350:1080}"`));
    assert.match(svg,/Verify on the official notification/);
    assert.doesNotMatch(svg,/Ashoka|Emblem|Government of India|PSU logo/i);
  }
});

test('P4 SVG templates escape source text',()=>{
  const svg=graphics.createGraphic('new_job',{title:'<script>alert(1)</script> & unsafe'},'1080x1080');
  assert.ok(!svg.includes('<script>'));
  assert.match(svg,/&lt;script&gt;/);
});

test('P4 SVG renders to JPEG with sharp at the requested dimensions',async()=>{
  const svg=graphics.createGraphic('deadline_alert',{title:'Deadline Alert',deadline:'12 Oct 2026'},'1080x1350');
  const jpeg=await sharp(Buffer.from(svg)).jpeg({quality:88,mozjpeg:true}).toBuffer();
  const meta=await sharp(jpeg).metadata();
  assert.equal(meta.format,'jpeg');
  assert.equal(meta.width,1080);
  assert.equal(meta.height,1350);
  assert.ok(jpeg.length<8*1024*1024);
});

test('P4 endpoint is admin-only and supports JPEG plus storage upload',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','_api','social-graphics-v4.js'),'utf8');
  assert.match(src,/ownerKeyMatches/);
  assert.match(src,/format==='jpeg'/);
  assert.match(src,/storage\/v1\/object/);
  assert.match(src,/x-upsert/);
  assert.match(src,/public_url/);
});
