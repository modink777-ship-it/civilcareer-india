/* CivilCareer visual construction background rotator
   Free-use source pages are documented in PHOTO-SOURCES.md.
   The rotator is visual-only and does not affect page content or controls. */
(function(){
  const U='https://images.unsplash.com/';
  const img=(id)=>U+id+'?auto=format&fit=crop&w=2200&q=82';
  const sets={
    home:[
      img('photo-1773643331861-96242b012c3f'), // high-rise / residential development
      img('photo-1777919393730-463e2c0b7f4c'), // concrete structure / rebar
      img('photo-1781613977789-6453baf7cfe8'), // industrial construction
      img('photo-1772300164438-f73307d3b645'), // commercial/industrial interior work
      img('photo-1768677903496-becc4be07258'), // steel/rebar site work
      img('photo-1777919393703-ad0a60555274')  // structure under construction
    ],
    private:[
      img('photo-1773643331861-96242b012c3f'),
      img('photo-1777919393703-ad0a60555274'),
      img('photo-1781613977789-6453baf7cfe8'),
      img('photo-1772300164438-f73307d3b645'),
      img('photo-1761213230327-d89a8cc9cc63')
    ],
    government:[
      img('photo-1780427999144-4bd6cd1efbab'),
      img('photo-1777919393730-463e2c0b7f4c'),
      img('photo-1768677903496-becc4be07258'),
      img('photo-1777919393703-ad0a60555274'),
      img('photo-1781613977789-6453baf7cfe8')
    ],
    exams:[
      img('photo-1768677903496-becc4be07258'),
      img('photo-1777919393730-463e2c0b7f4c'),
      img('photo-1761213230327-d89a8cc9cc63'),
      img('photo-1780427999144-4bd6cd1efbab'),
      img('photo-1773643331861-96242b012c3f')
    ],
    materials:[
      img('photo-1768677903496-becc4be07258'),
      img('photo-1761213230327-d89a8cc9cc63'),
      img('photo-1777919393730-463e2c0b7f4c'),
      img('photo-1772300164438-f73307d3b645'),
      img('photo-1777919393703-ad0a60555274')
    ],
    foryou:[
      img('photo-1773643331861-96242b012c3f'),
      img('photo-1781613977789-6453baf7cfe8'),
      img('photo-1777919393703-ad0a60555274'),
      img('photo-1768677903496-becc4be07258')
    ],
    post:[
      img('photo-1777919393703-ad0a60555274'),
      img('photo-1781613977789-6453baf7cfe8'),
      img('photo-1772300164438-f73307d3b645')
    ],
    resource:[
      img('photo-1768677903496-becc4be07258'),
      img('photo-1777919393730-463e2c0b7f4c'),
      img('photo-1761213230327-d89a8cc9cc63')
    ],
    about:[
      img('photo-1773643331861-96242b012c3f'),
      img('photo-1777919393730-463e2c0b7f4c'),
      img('photo-1781613977789-6453baf7cfe8')
    ],
    search:[
      img('photo-1777919393703-ad0a60555274'),
      img('photo-1773643331861-96242b012c3f'),
      img('photo-1768677903496-becc4be07258')
    ],
    report:[
      img('photo-1761213230327-d89a8cc9cc63'),
      img('photo-1772300164438-f73307d3b645'),
      img('photo-1777919393730-463e2c0b7f4c')
    ],
    careerhub:[
      img('photo-1773643331861-96242b012c3f'),
      img('photo-1777919393730-463e2c0b7f4c'),
      img('photo-1781613977789-6453baf7cfe8'),
      img('photo-1772300164438-f73307d3b645'),
      img('photo-1768677903496-becc4be07258')
    ],
    admin:[
      img('photo-1781613977789-6453baf7cfe8'),
      img('photo-1768677903496-becc4be07258'),
      img('photo-1777919393703-ad0a60555274')
    ]
  };

  const titleSets={
    home:['RESIDENTIAL','CONCRETE & REINFORCEMENT','INDUSTRIAL / EPC','COMMERCIAL','STEEL & STRUCTURAL','PROJECT DELIVERY'],
    private:['RESIDENTIAL','COMMERCIAL','INDUSTRIAL / EPC','SITE EXECUTION','STRUCTURAL STEEL'],
    government:['EARTHWORK & EXCAVATION','CONCRETE WORKS','REINFORCEMENT','PROJECT DELIVERY','INDUSTRIAL / INFRA'],
    exams:['REINFORCEMENT','CONCRETE','STEEL','EARTHWORK','STRUCTURAL ENGINEERING'],
    materials:['REBAR & DETAILING','STEEL WORK','CONCRETE','SITE PRACTICE','STRUCTURAL WORK'],
    foryou:['RESIDENTIAL','INDUSTRIAL / EPC','PROJECT DELIVERY','REINFORCEMENT'],
    post:['PROJECT DELIVERY','INDUSTRIAL / EPC','COMMERCIAL'],
    resource:['REBAR & DETAILING','CONCRETE','STEEL'],
    about:['RESIDENTIAL','CONCRETE','INDUSTRIAL / EPC'],
    search:['PROJECT DELIVERY','RESIDENTIAL','REINFORCEMENT'],
    report:['STEEL WORK','COMMERCIAL','CONCRETE'],
    careerhub:['RESIDENTIAL','CONCRETE & REINFORCEMENT','INDUSTRIAL / EPC','COMMERCIAL','STEEL & STRUCTURAL'],
    admin:['INDUSTRIAL / EPC','REINFORCEMENT','PROJECT DELIVERY']
  };

  const layers=new Map();
  let activeRoute='';
  let timer=null, idx=0, reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;

  function targets(){
    const active=document.querySelector('.page.active');
    if(!active || ['jobDetail','examDetail','materialDetail'].includes(active.dataset.page))return [];
    const hero=active.querySelector('.hero, .careerhub-hero');
    const pageHero=active.querySelector('.page-hero');
    if(hero||pageHero)return [hero,pageHero].filter(Boolean);
    let visual=active.querySelector(':scope > .cc-page-visual');
    if(!visual){
      visual=document.createElement('div');
      visual.className='cc-page-visual';
      visual.setAttribute('aria-hidden','true');
      active.prepend(visual);
    }
    return [visual];
  }
  function makeLayer(parent,n){
    const el=document.createElement('span');
    el.className='cc-bg-layer cc-bg-layer-'+n;
    el.setAttribute('aria-hidden','true');
    parent.prepend(el);
    return el;
  }
  function clearLayers(){
    document.querySelectorAll('.cc-bg-layer').forEach(x=>x.remove());
    layers.clear();
  }
  function routeNow(){
    const p=location.pathname.replace(/\/$/,'')||'/';
    return (p.startsWith('/jobs/') ? 'jobDetail' : ({'/':'home','/for-you':'foryou','/private-jobs':'private','/government-jobs':'government','/exams':'exams','/study-materials':'materials','/post-a-job':'post','/submit-resource':'resource','/report':'report','/about':'about','/search':'search','/admin':'admin','/career-hub':'careerhub'})[p]||'home');
  }
  function setImage(route,position,imageIndex){
    const el=layers.get(position); if(!el)return;
    const list=sets[route]||sets.home;
    const src=list[imageIndex%list.length];
    el.style.backgroundImage='url("'+src+'")';
    el.dataset.imageIndex=imageIndex;
  }
  function show(route,n){
    const list=sets[route]||sets.home;
    if(!list.length)return;
    const next=n%list.length;
    layers.forEach((pair)=>{
      const active=pair.a.classList.contains('is-active');
      const incoming=active?pair.b:pair.a;
      const outgoing=active?pair.a:pair.b;
      incoming.style.backgroundImage='url("'+list[next]+'")';
      incoming.classList.add('is-active');
      outgoing.classList.remove('is-active');
    });
    document.querySelectorAll('.cc-bg-label').forEach(label=>{
      const labels=titleSets[route]||titleSets.home;
      label.textContent=labels[next%labels.length];
    });
  }
  function build(route){
    clearLayers();
    idx=0;
    if(['jobDetail','examDetail','materialDetail'].includes(route))return;
    targets().forEach((parent)=>{
      const a=makeLayer(parent,'a'), b=makeLayer(parent,'b');
      layers.set(parent,{a,b});
      a.style.backgroundImage='url("'+sets[route][0]+'")';
      b.style.backgroundImage='url("'+sets[route][1%sets[route].length]+'")';
      a.classList.add('is-active');
      const label=document.createElement('span');
      label.className='cc-bg-label';
      label.textContent=(titleSets[route]||titleSets.home)[0];
      label.setAttribute('aria-hidden','true');
      parent.appendChild(label);
    });
    if(timer)clearInterval(timer);
    if(!reduced){
      timer=setInterval(()=>{idx=(idx+1)%sets[route].length;show(route,idx)},6500);
    }
  }
  function refresh(){
    const r=routeNow();
    if(r===activeRoute && layers.size)return;
    activeRoute=r;
    build(r);
  }
  const observer=new MutationObserver(()=>{requestAnimationFrame(refresh)});
  function init(){
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
    refresh();
    setTimeout(refresh,120);
    setTimeout(refresh,600);
    window.addEventListener('popstate',refresh);
    document.addEventListener('click',()=>setTimeout(refresh,80),true);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
