(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const qs = s => document.querySelector(s);
  const qsa = s => [...document.querySelectorAll(s)];
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) document.documentElement.classList.add('cc-reduced-motion');

  function visitorId(){
    let id = localStorage.getItem('cc_vid');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('cc_vid', id); }
    return id;
  }
  async function json(url, options={}){
    const r = await fetch(url,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});
    const data = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  }
  const localSaved = () => new Set(JSON.parse(localStorage.getItem('cc_saved') || '[]'));
  function setLocalSaved(set){ localStorage.setItem('cc_saved',JSON.stringify([...set])); }

  const roadmap = [
    {role:'Graduate Engineer Trainee',exp:'0–1 year',salary:'₹2.5–4.5 LPA',skills:'AutoCAD, surveying, drawings, site safety',cert:'AutoCAD + site safety',jobs:'GET, Junior Engineer, Trainee Engineer'},
    {role:'Site Engineer',exp:'1–3 years',salary:'₹3.5–6.5 LPA',skills:'Execution, QA/QC, BOQ, measurements',cert:'QA/QC, Primavera basics',jobs:'Site Engineer, Civil Engineer'},
    {role:'Project Engineer',exp:'3–6 years',salary:'₹5–10 LPA',skills:'Planning, billing, subcontractor management',cert:'Primavera P6 / PMP track',jobs:'Project Engineer, Planning Engineer'},
    {role:'Senior Engineer',exp:'6–10 years',salary:'₹8–15 LPA',skills:'Cost, contracts, teams, risk',cert:'PMP / contracts',jobs:'Senior Civil, Senior Planning'},
    {role:'Project Manager',exp:'10–15 years',salary:'₹14–28 LPA',skills:'Delivery, budgets, stakeholders',cert:'PMP / advanced contracts',jobs:'Project Manager, Construction Manager'},
    {role:'Construction Manager',exp:'15+ years',salary:'₹22–45+ LPA',skills:'Portfolio delivery, strategy, leadership',cert:'PMP / executive leadership',jobs:'Construction Manager, Project Director'}
  ];
  const specializationData = [
    ['▦','Structural Engineering','RCC, steel, seismic design and analysis'],['▤','Highway Engineering','Roads, pavements, geometric design and IRC practice'],['₹','Quantity Surveying','BOQ, estimation, billing and commercial controls'],['🚆','Railways & Metro','Track, stations, viaducts and package delivery'],['◇','BIM','Revit, Navisworks, coordination and digital delivery'],['◫','Project Planning','Primavera, scheduling, progress and project controls'],['▥','Construction Management','Execution, contracts, quality, safety and delivery'],['≈','Water Resources','Hydraulics, irrigation, drainage and water infrastructure'],['▰','Infrastructure Leadership','Mega projects, risk, cost and stakeholder management']
  ];

  function hero(){
    const old = qs('.hero'); if(!old || old.dataset.premium) return;
    old.dataset.premium='1'; old.classList.add('cc-premium-hero');
    old.innerHTML = `<canvas class="hero-canvas" id="ccHeroCanvas" aria-hidden="true"></canvas><div class="container cc-hero-grid"><div class="cc-hero-copy"><p class="eyebrow">INDIA'S CIVIL ENGINEERING CAREER PLATFORM</p><h1>Build India's Infrastructure.<br><span>Build Your Career.</span></h1><p class="lead">Civil Engineering Jobs, Government Recruitment, Exams, Career Roadmaps and Learning Resources.</p><div class="cc-hero-actions"><a class="btn primary route" href="/private-jobs" data-route="private">Find Jobs</a><a class="btn secondary route" href="/government-jobs" data-route="government">Government Careers</a><a class="btn secondary route" href="#career-roadmaps" data-premium-anchor="career-roadmaps">Career Roadmaps</a></div></div><aside class="cc-hero-side"><div class="mini"><span>Infrastructure</span><b>Jobs</b></div><div class="mini"><span>Government</span><b>Recruitment</b></div><div class="mini"><span>Professional</span><b>Growth</b></div><div class="mini"><span>Learning</span><b>Resources</b></div></aside></div>`;
    qsa('[data-premium-anchor]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();qs('#career-roadmaps')?.scrollIntoView({behavior:reduced?'auto':'smooth'});}));
  }
  function stats(){
    const host=qs('.stats-bar'); if(!host || qs('#ccPremiumStats')) return;
    const wrap=document.createElement('div');wrap.id='ccPremiumStats';wrap.className='container cc-stats';
    wrap.innerHTML=`<div class="cc-stat-grid"><article class="cc-stat-card"><strong data-count="1200">0+</strong><span>Jobs</span></article><article class="cc-stat-card"><strong data-count="50">0+</strong><span>Recruiters</span></article><article class="cc-stat-card"><strong data-count="25">0+</strong><span>Career Guides</span></article><article class="cc-stat-card"><strong data-count="10000">0+</strong><span>Engineers</span></article></div>`;
    host.replaceWith(wrap);
  }
  function roadmapSection(){
    if(qs('#career-roadmaps')) return;
    const s=document.createElement('section');s.id='career-roadmaps';s.className='cc-premium-section';
    s.innerHTML=`<div class="container"><div class="cc-section-head"><div><p class="eyebrow">CAREER ROADMAP EXPLORER</p><h2>See where your civil career can go.</h2></div><p>Explore a progression from graduate entry to construction leadership. Select a role to see the skills, experience and credentials commonly associated with that stage.</p></div><div class="cc-roadmap"><div class="cc-roadmap-track" id="ccRoadmapTrack"></div><div class="cc-roadmap-detail" id="ccRoadmapDetail"></div></div></div>`;
    const anchor=qs('.how-section')||qs('.section.soft'); anchor?.before(s); renderRoadmap();
  }
  function renderRoadmap(){
    const track=qs('#ccRoadmapTrack'),detail=qs('#ccRoadmapDetail'); if(!track||!detail)return;
    track.innerHTML=roadmap.map((x,i)=>`<button type="button" class="cc-roadmap-node ${i===0?'active':''}" data-roadmap="${i}"><span class="cc-node-dot"></span><small>Stage ${String(i+1).padStart(2,'0')}</small><b>${esc(x.role)}</b></button>`).join('');
    const paint=i=>{const x=roadmap[i];qsa('[data-roadmap]').forEach(b=>b.classList.toggle('active',Number(b.dataset.roadmap)===i));detail.innerHTML=`<p class="eyebrow" style="color:#66d9ef">CAREER STAGE ${String(i+1).padStart(2,'0')}</p><h3>${esc(x.role)}</h3><div class="cc-detail-grid"><div><small>Experience</small><b>${esc(x.exp)}</b></div><div><small>Indicative salary</small><b>${esc(x.salary)}</b></div><div><small>Skills</small><b>${esc(x.skills)}</b></div><div><small>Certifications</small><b>${esc(x.cert)}</b></div></div><p style="color:rgba(255,255,255,.7);margin-top:1rem">Open jobs: ${esc(x.jobs)}</p>`};
    track.onclick=e=>{const b=e.target.closest('[data-roadmap]');if(b)paint(Number(b.dataset.roadmap));};paint(0);
  }
  function specializations(){
    if(qs('#cc-specializations'))return;
    const s=document.createElement('section');s.id='cc-specializations';s.className='cc-premium-section';
    s.innerHTML=`<div class="container"><div class="cc-section-head"><div><p class="eyebrow">SPECIALIZATION MAP</p><h2>Choose the infrastructure domain you want to master.</h2></div><p>Explore the major civil engineering paths represented across construction, infrastructure, design and digital delivery.</p></div><div class="cc-specializations">${specializationData.map((x,i)=>`<article class="cc-special-card" data-special="${i}"><div class="cc-special-icon">${x[0]}</div><h3>${esc(x[1])}</h3><p>${esc(x[2])}</p></article>`).join('')}</div></div>`;
    qs('#career-roadmaps')?.after(s);
  }
  function simulator(){
    if(qs('#cc-simulator'))return;
    const s=document.createElement('section');s.id='cc-simulator';s.className='cc-premium-section';
    s.innerHTML=`<div class="container"><div class="cc-section-head"><div><p class="eyebrow">AI CAREER SIMULATOR</p><h2>Model your next civil engineering move.</h2></div><p>Enter your current profile and get a practical career-path recommendation based on role, experience and skills. Results are guidance, not a salary guarantee.</p></div><div class="cc-sim"><form class="cc-sim-form" id="ccSimForm"><h3>Your profile</h3><div class="cc-field"><label for="ccRole">Current role</label><input id="ccRole" required placeholder="Site Engineer"></div><div class="cc-field"><label for="ccExp">Experience (years)</label><input id="ccExp" required type="number" min="0" max="40" step="0.5" placeholder="3"></div><div class="cc-field"><label for="ccSkills">Skills</label><input id="ccSkills" placeholder="AutoCAD, BOQ, Primavera, Revit"></div><button class="btn primary" type="submit">Simulate career path</button></form><div class="cc-sim-result" id="ccSimResult"><div class="result-placeholder"><div><strong>Ready when you are.</strong><p>We'll map likely next roles, indicative salary bands and useful certifications.</p></div></div></div></div></div>`;
    qs('#cc-specializations')?.after(s);qs('#ccSimForm').addEventListener('submit',runSimulator);
  }
  function runSimulator(e){
    e.preventDefault();const role=qs('#ccRole').value.toLowerCase(),exp=Number(qs('#ccExp').value||0),skills=qs('#ccSkills').value.toLowerCase();let next='Site Engineer',salary='₹3.5–6.5 LPA',cert=['AutoCAD','QA/QC fundamentals'];
    if(/site|field|execution/.test(role)&&exp>=3){next='Project Engineer';salary='₹5–10 LPA';cert=['Primavera P6','Contracts & billing'];}
    if(/planning|project control/.test(role)&&exp>=3){next='Senior Planning Engineer';salary='₹7–14 LPA';cert=['Primavera P6','Project controls'];}
    if(/quantity|qs|estimation|billing/.test(role)&&exp>=3){next='Senior Quantity Surveyor';salary='₹7–14 LPA';cert=['Advanced quantity surveying','Contracts'];}
    if(/structural|design/.test(role)&&exp>=4){next='Senior Structural Engineer';salary='₹8–16 LPA';cert=['ETABS/STAAD.Pro','Seismic design'];}
    if(/bim|revit/.test(role)&&exp>=3){next='BIM Coordinator / Manager';salary='₹7–16 LPA';cert=['Revit','Navisworks / BIM coordination'];}
    if(exp>=8){next='Project Manager / Construction Manager';salary='₹14–28+ LPA';cert=['PMP','Advanced contracts'];}
    const skillSet=skills.split(',').map(x=>x.trim()).filter(Boolean);if(skillSet.some(x=>/primavera|p6/.test(x)))cert.unshift('Project controls');
    qs('#ccSimResult').innerHTML=`<div><p class="eyebrow">SIMULATION RESULT</p><h3>${esc(next)}</h3><div class="cc-result-grid"><div class="cc-result-card"><small>Indicative salary band</small><b>${esc(salary)}</b></div><div class="cc-result-card"><small>Profile</small><b>${esc(exp)} years · ${esc(role||'civil engineer')}</b></div><div class="cc-result-card"><small>Recommended certifications</small><b>${esc(cert.slice(0,3).join(' · '))}</b></div><div class="cc-result-card"><small>Suggested next roles</small><b>Project Engineer · Senior Engineer · Project Manager</b></div></div><p class="cc-muted" style="margin-top:1rem">Salary ranges are indicative planning bands, not guarantees; actual compensation varies by employer, city, specialization and project scale.</p></div>`;
  }
  function saveButton(job){
    const id=String(job.id||job.job_id||'');const saved=localSaved().has(id);return `<button class="cc-save-btn ${saved?'saved':''}" type="button" data-cc-save="${esc(id)}">${saved?'★ Saved':'☆ Save Job'}</button>`;
  }
  async function toggleSaved(id,button){
    const set=localSaved();const saving=!set.has(id);saving?set.add(id):set.delete(id);setLocalSaved(set);button.classList.toggle('saved',saving);button.textContent=saving?'★ Saved':'☆ Save Job';
    try{await json('/api/saved-jobs',{method:'POST',body:JSON.stringify({visitor_id:visitorId(),job_id:id,saved:saving})});}catch(err){if(!saving)set.add(id);else set.delete(id);setLocalSaved(set);button.classList.toggle('saved',!saving);button.textContent=!saving?'★ Saved':'☆ Save Job';console.warn(err);}
    window.dispatchEvent(new CustomEvent('cc:saved-change'));
  }
  function bindSaveButtons(root=document){root.querySelectorAll('[data-cc-save]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound='1';b.addEventListener('click',()=>toggleSaved(b.dataset.ccSave,b));});}
  async function syncSaved(){
    try{const x=await json('/api/saved-jobs?visitor_id='+encodeURIComponent(visitorId()));const set=new Set((x.saved||[]).map(x=>String(x.job_id)));if(set.size){setLocalSaved(set);qsa('[data-cc-save]').forEach(b=>{const yes=set.has(b.dataset.ccSave);b.classList.toggle('saved',yes);b.textContent=yes?'★ Saved':'☆ Save Job';});}}catch(e){console.warn('Saved jobs sync unavailable',e)}
  }
  function savedJobsPage(){
    if(qs('#cc-saved-page'))return;
    const s=document.createElement('section');s.id='cc-saved-page';s.className='page';s.dataset.page='saved';
    s.innerHTML=`<div class="page-hero container"><p class="eyebrow">YOUR CAREER SHORTLIST</p><h1>Saved Jobs</h1><p>Keep promising civil engineering opportunities in one place on this device.</p></div><div class="container"><div class="cc-saved-toolbar"><strong id="ccSavedCount">0 saved jobs</strong><a class="btn secondary" href="/job-alerts.html">Create Job Alert</a></div><div id="ccSavedGrid" class="cc-saved-grid"></div></div>`;
    qs('#content')?.append(s);renderSavedPage();
  }
  function renderSavedPage(){
    const out=qs('#ccSavedGrid'),count=qs('#ccSavedCount');if(!out)return;const ids=[...localSaved()];if(count)count.textContent=`${ids.length} saved job${ids.length===1?'':'s'}`;
    const jobs=window.jobs||[];const found=ids.map(id=>jobs.find(j=>String(j.id)===id)).filter(Boolean);
    if(!found.length){out.innerHTML='<div class="cc-empty"><h3>No saved jobs yet</h3><p>Use “Save Job” on any opportunity to build your shortlist.</p><a class="btn primary" href="/private-jobs">Browse jobs</a></div>';return;}
    out.innerHTML=found.map(j=>`<article class="cc-saved-job"><div><h3>${esc(j.role||j.job_title||'Civil engineering opportunity')}</h3><p>${esc(j.company||j.company_name||'Organization')} · ${esc(j.location||'India')}</p>${j.salary?`<p>${esc(j.salary)}</p>`:''}</div><div><a class="btn secondary" href="/jobs/${encodeURIComponent(j.slug||j.id)}">View job</a> ${saveButton(j)}</div></article>`).join('');bindSaveButtons(out);
  }
  function navigation(){
    const nav=qs('#mainNav');if(!nav||nav.querySelector('[data-route="saved"]'))return;const a=document.createElement('a');a.href='/saved-jobs';a.dataset.route='saved';a.textContent='Saved Jobs';a.className='route';nav.querySelector('.mobile-nav-grid')?.append(a);
    const footer=qs('footer .footer-grid div:nth-child(2)');if(footer&&!footer.querySelector('[href="/saved-jobs"]')){const f=document.createElement('a');f.href='/saved-jobs';f.textContent='Saved Jobs';f.className='route';footer.append(f);}
  }
  function three(){
    if(reduced||!window.THREE)return;const canvas=qs('#ccHeroCanvas');if(!canvas)return;const THREE=window.THREE,scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x081827,.035);const camera=new THREE.PerspectiveCamera(45,canvas.clientWidth/canvas.clientHeight,.1,120);camera.position.set(8,7,15);const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);renderer.outputColorSpace=THREE.SRGBColorSpace;scene.add(new THREE.HemisphereLight(0x9edcff,0x07121e,1.7));const dl=new THREE.DirectionalLight(0x66d9ef,2.1);dl.position.set(8,14,6);scene.add(dl);
    const mat=new THREE.MeshStandardMaterial({color:0x163b5d,roughness:.72,metalness:.18});const glass=new THREE.MeshStandardMaterial({color:0x4fa3ff,roughness:.3,metalness:.2,transparent:true,opacity:.48});const group=new THREE.Group();scene.add(group);
    for(let i=0;i<30;i++){const h=1.2+Math.random()*7.5,w=.7+Math.random()*1.8,d=.7+Math.random()*1.8;const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),i%5===0?glass:mat);m.position.set((Math.random()-.5)*22,h/2-2,(Math.random()-.5)*9);group.add(m);}
    const road=new THREE.Mesh(new THREE.BoxGeometry(24,.18,4),new THREE.MeshStandardMaterial({color:0x0a1725,roughness:1}));road.position.set(0,-1.95,0);group.add(road);for(let i=-9;i<=9;i+=2){const lane=new THREE.Mesh(new THREE.BoxGeometry(.9,.02,.08),new THREE.MeshBasicMaterial({color:0xffcc00}));lane.position.set(i,-1.84,0);group.add(lane);}
    const bridge=new THREE.Group();const deck=new THREE.Mesh(new THREE.BoxGeometry(14,.35,2.3),new THREE.MeshStandardMaterial({color:0x274d70,roughness:.8}));deck.position.set(0,.1,-4);bridge.add(deck);for(let x=-5;x<=5;x+=2.5){const p=new THREE.Mesh(new THREE.CylinderGeometry(.11,.11,3.2,8),mat);p.position.set(x,-1.45,-4);bridge.add(p);}group.add(bridge);
    const crane=new THREE.Group();const mast=new THREE.Mesh(new THREE.BoxGeometry(.22,5,.22),new THREE.MeshStandardMaterial({color:0xffcc00,roughness:.65}));mast.position.y=.6;crane.add(mast);const arm=new THREE.Mesh(new THREE.BoxGeometry(5,.16,.16),new THREE.MeshStandardMaterial({color:0xffcc00,roughness:.65}));arm.position.set(2,3.05,0);crane.add(arm);const counter=new THREE.Mesh(new THREE.BoxGeometry(1,.3,.3),new THREE.MeshStandardMaterial({color:0xffcc00}));counter.position.set(-.5,3.05,0);crane.add(counter);crane.position.set(3,-1.9,-1);group.add(crane);
    const pts=new Float32Array(360);for(let i=0;i<pts.length;i+=3){pts[i]=(Math.random()-.5)*28;pts[i+1]=(Math.random()-.2)*13-2;pts[i+2]=(Math.random()-.5)*14;}const pm=new THREE.PointsMaterial({color:0x66d9ef,size:.035,transparent:true,opacity:.65});scene.add(new THREE.Points(new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(pts,3)),pm));
    let t=0,last=performance.now();function resize(){const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);}window.addEventListener('resize',resize,{passive:true});function frame(now){const dt=Math.min(.04,(now-last)/1000);last=now;t+=dt;crane.rotation.y=Math.sin(t*.45)*.16;group.rotation.y=Math.sin(t*.09)*.08;camera.position.x=8+Math.sin(t*.12)*1.2;camera.position.y=7+Math.sin(t*.17)*.35;camera.lookAt(0,1,-2);renderer.render(scene,camera);requestAnimationFrame(frame);}resize();requestAnimationFrame(frame);
  }
  function gsapInit(){
    if(!window.gsap)return;const gs=window.gsap; if(window.ScrollTrigger)gs.registerPlugin(window.ScrollTrigger);const els=qsa('.cc-stat-card,.cc-special-card,.cc-roadmap-node,.cc-sim');els.forEach((el,i)=>{if(reduced)return;gs.fromTo(el,{opacity:0,y:24},{opacity:1,y:0,duration:.65,delay:i*.03,ease:'power2.out',scrollTrigger:window.ScrollTrigger?{trigger:el,start:'top 88%',once:true}:undefined});});
    qsa('[data-count]').forEach(el=>{const n=Number(el.dataset.count);if(reduced){el.textContent=n.toLocaleString('en-IN')+'+';return;}gs.fromTo(el,{textContent:0},{textContent:n,duration:1.4,ease:'power2.out',snap:{textContent:1},scrollTrigger:window.ScrollTrigger?{trigger:el,start:'top 90%',once:true}:undefined,onUpdate(){el.textContent=Math.round(Number(el.textContent)).toLocaleString('en-IN')+'+';}});});
  }
  function init(){
    hero();stats();roadmapSection();specializations();simulator();savedJobsPage();navigation();bindSaveButtons();syncSaved();
    const jobs=window.jobs; if(jobs?.length){};
    if(location.pathname==='/saved-jobs'){qsa('.page').forEach(p=>p.classList.remove('active'));qs('#cc-saved-page')?.classList.add('active');document.title='Saved Civil Engineering Jobs | CivilCareer';const robots=document.querySelector('meta[name=robots]')||document.head.appendChild(Object.assign(document.createElement('meta'),{name:'robots'}));robots.content='noindex,follow';let canon=document.querySelector('link[rel=canonical]');if(canon)canon.href='https://civilcareer-india-two.vercel.app/saved-jobs';}
    if(!document.querySelector('link[href*="premium-experience.css"]')){const l=document.createElement('link');l.rel='stylesheet';l.href='/premium-experience.css?v=20260921-1';document.head.append(l);}
    const oldHero=qs('.hero');if(oldHero)requestAnimationFrame(()=>three());
    gsapInit();
    window.addEventListener('cc:saved-change',renderSavedPage);
    document.addEventListener('click',e=>{const b=e.target.closest('[data-save-job]');if(!b)return;setTimeout(()=>{const id=b.dataset.saveJob;const set=localSaved();json('/api/saved-jobs',{method:'POST',body:JSON.stringify({visitor_id:visitorId(),job_id:id,saved:set.has(id)})}).catch(err=>console.warn('Saved job sync failed',err));window.dispatchEvent(new CustomEvent('cc:saved-change'));},80);},{passive:true});
    const obs=new MutationObserver(()=>bindSaveButtons());obs.observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
