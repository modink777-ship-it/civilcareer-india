(() => {
  'use strict';

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) document.documentElement.classList.add('cc-reduced-motion');

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  function visitorId() {
    let id = localStorage.getItem('cc_vid');
    if (!id) {
      id = (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem('cc_vid', id);
    }
    return id;
  }

  async function json(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function localSaved() {
    try { return new Set(JSON.parse(localStorage.getItem('cc_saved') || '[]')); }
    catch { return new Set(); }
  }

  function setLocalSaved(set) {
    localStorage.setItem('cc_saved', JSON.stringify([...set]));
  }

  function buildHero() {
    const hero = qs('.hero');
    if (!hero || hero.dataset.premium === '1') return;

    hero.dataset.premium = '1';
    hero.classList.add('cc-premium-hero');
    hero.innerHTML = `
      <canvas class="hero-canvas" id="ccHeroCanvas" aria-hidden="true"></canvas>
      <div class="cc-hero-glow" aria-hidden="true"></div>
      <div class="container cc-hero-grid">
        <div class="cc-hero-copy">
          <p class="eyebrow">INDIA'S CIVIL ENGINEERING CAREER PLATFORM</p>
          <h1>Build India's Infrastructure.<br><span>Build Your Career.</span></h1>
          <p class="lead">Civil Engineering Jobs, Government Recruitment, Exams and Learning Resources.</p>
          <div class="cc-hero-actions">
            <a class="btn primary route" href="/private-jobs" data-route="private">Find Jobs</a>
            <a class="btn secondary route" href="/government-jobs" data-route="government">Government Careers</a>
            <a class="btn secondary route" href="/job-alerts.html">Job Alerts</a>
          </div>
        </div>
        <aside class="cc-hero-side" aria-label="CivilCareer platform highlights">
          <div class="mini"><span>Infrastructure</span><b>Jobs</b></div>
          <div class="mini"><span>Government</span><b>Recruitment</b></div>
          <div class="mini"><span>Professional</span><b>Growth</b></div>
          <div class="mini"><span>Learning</span><b>Resources</b></div>
        </aside>
      </div>`;
  }

  function buildStats() {
    const host = qs('.stats-bar');
    if (!host || qs('#ccPremiumStats')) return;

    const wrap = document.createElement('div');
    wrap.id = 'ccPremiumStats';
    wrap.className = 'container cc-stats';
    wrap.innerHTML = `
      <div class="cc-stat-grid">
        <article class="cc-stat-card"><strong data-count="1200">0+</strong><span>Jobs</span></article>
        <article class="cc-stat-card"><strong data-count="50">0+</strong><span>Recruiters</span></article>
        <article class="cc-stat-card"><strong data-count="25">0+</strong><span>Career Guides</span></article>
        <article class="cc-stat-card"><strong data-count="10000">0+</strong><span>Engineers</span></article>
      </div>`;
    host.replaceWith(wrap);
  }

  function saveButton(job) {
    const id = String(job.id || job.job_id || '');
    const saved = localSaved().has(id);
    return `<button class="cc-save-btn ${saved ? 'saved' : ''}" type="button" data-cc-save="${escapeHtml(id)}" aria-pressed="${saved}">${saved ? '★ Saved' : '☆ Save Job'}</button>`;
  }

  async function toggleSaved(id, button) {
    const set = localSaved();
    const saving = !set.has(id);
    if (saving) set.add(id); else set.delete(id);
    setLocalSaved(set);
    button.classList.toggle('saved', saving);
    button.setAttribute('aria-pressed', String(saving));
    button.textContent = saving ? '★ Saved' : '☆ Save Job';

    try {
      await json('/api/saved-jobs', {
        method: 'POST',
        body: JSON.stringify({ visitor_id: visitorId(), job_id: id, saved: saving })
      });
    } catch (error) {
      if (saving) set.delete(id); else set.add(id);
      setLocalSaved(set);
      button.classList.toggle('saved', !saving);
      button.setAttribute('aria-pressed', String(!saving));
      button.textContent = !saving ? '★ Saved' : '☆ Save Job';
      console.warn('Saved jobs sync unavailable:', error.message);
    }
    window.dispatchEvent(new CustomEvent('cc:saved-change'));
  }

  function bindSaveButtons(root = document) {
    qsa('[data-cc-save]', root).forEach(button => {
      if (button.dataset.bound === '1') return;
      button.dataset.bound = '1';
      button.addEventListener('click', () => toggleSaved(button.dataset.ccSave, button));
    });
  }

  async function syncSaved() {
    try {
      const result = await json(`/api/saved-jobs?visitor_id=${encodeURIComponent(visitorId())}`);
      const saved = new Set((result.saved || []).map(item => String(item.job_id)));
      setLocalSaved(saved);
      qsa('[data-cc-save]').forEach(button => {
        const active = saved.has(button.dataset.ccSave);
        button.classList.toggle('saved', active);
        button.setAttribute('aria-pressed', String(active));
        button.textContent = active ? '★ Saved' : '☆ Save Job';
      });
    } catch (error) {
      console.warn('Saved jobs sync unavailable:', error.message);
    }
  }

  function buildSavedJobsPage() {
    if (qs('#cc-saved-page')) return;
    const content = qs('#content');
    if (!content) return;

    const section = document.createElement('section');
    section.id = 'cc-saved-page';
    section.className = 'page';
    section.dataset.page = 'saved';
    section.innerHTML = `
      <div class="page-hero container">
        <p class="eyebrow">YOUR CAREER SHORTLIST</p>
        <h1>Saved Jobs</h1>
        <p>Keep promising civil engineering opportunities in one place.</p>
      </div>
      <div class="container">
        <div class="cc-saved-toolbar">
          <strong id="ccSavedCount">0 saved jobs</strong>
          <a class="btn secondary" href="/job-alerts.html">Create Job Alert</a>
        </div>
        <div id="ccSavedGrid" class="cc-saved-grid"></div>
      </div>`;
    content.append(section);
    renderSavedPage();
  }

  function renderSavedPage() {
    const out = qs('#ccSavedGrid');
    const count = qs('#ccSavedCount');
    if (!out) return;

    const ids = [...localSaved()];
    if (count) count.textContent = `${ids.length} saved job${ids.length === 1 ? '' : 's'}`;

    const jobs = Array.isArray(window.jobs) ? window.jobs : [];
    const found = ids.map(id => jobs.find(job => String(job.id) === id)).filter(Boolean);

    if (!found.length) {
      out.innerHTML = `<div class="cc-empty"><h3>No saved jobs yet</h3><p>Use “Save Job” on any opportunity to build your shortlist.</p><a class="btn primary" href="/private-jobs">Browse jobs</a></div>`;
      return;
    }

    out.innerHTML = found.map(job => `
      <article class="cc-saved-job">
        <div>
          <h3>${escapeHtml(job.role || job.job_title || 'Civil engineering opportunity')}</h3>
          <p>${escapeHtml(job.company || job.company_name || 'Organization')} · ${escapeHtml(job.location || 'India')}</p>
          ${job.salary ? `<p>${escapeHtml(job.salary)}</p>` : ''}
        </div>
        <div>
          <a class="btn secondary" href="/jobs/${encodeURIComponent(job.slug || job.id)}">View job</a>
          ${saveButton(job)}
        </div>
      </article>`).join('');
    bindSaveButtons(out);
  }

  function addSavedJobsNavigation() {
    const nav = qs('#mainNav');
    if (nav && !nav.querySelector('[data-route="saved"]')) {
      const link = document.createElement('a');
      link.href = '/saved-jobs';
      link.dataset.route = 'saved';
      link.className = 'route';
      link.textContent = 'Saved Jobs';
      nav.querySelector('.mobile-nav-grid')?.append(link);
    }
  }

  function drawBlueprintFallback(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const draw = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(79,163,255,.12)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 42) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 42) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.fillStyle = 'rgba(79,163,255,.08)';
      for (let i = 0; i < 22; i++) {
        const bw = 20 + ((i * 37) % 85), bh = 70 + ((i * 71) % 220);
        const x = ((i * 97) % Math.max(1, w + 120)) - 60;
        const y = h - bh - 35;
        ctx.fillRect(x, y, bw, bh);
      }
      ctx.strokeStyle = 'rgba(102,217,239,.35)';
      ctx.beginPath(); ctx.moveTo(w * .05, h * .72); ctx.quadraticCurveTo(w * .48, h * .45, w * .96, h * .7); ctx.stroke();
    };
    resize(); draw();
    window.addEventListener('resize', () => { resize(); draw(); }, { passive: true });
  }

  function threeScene() {
    const canvas = qs('#ccHeroCanvas');
    if (!canvas || reduced || !window.THREE) {
      if (canvas) drawBlueprintFallback(canvas);
      return;
    }

    const THREE = window.THREE;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x081827, 0.038);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 120);
    camera.position.set(8, 7, 15);

    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: true, powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const sceneGroup = new THREE.Group();
    scene.add(sceneGroup);
    scene.add(new THREE.HemisphereLight(0x9edcff, 0x07121e, 1.55));
    const light = new THREE.DirectionalLight(0x66d9ef, 2);
    light.position.set(8, 14, 6);
    scene.add(light);

    const buildingMaterial = new THREE.MeshStandardMaterial({ color: 0x163b5d, roughness: .72, metalness: .18 });
    const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x4fa3ff, roughness: .3, metalness: .2, transparent: true, opacity: .48 });
    const yellowMaterial = new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: .65 });

    for (let i = 0; i < 28; i++) {
      const height = 1.2 + Math.random() * 7.5;
      const width = .7 + Math.random() * 1.8;
      const depth = .7 + Math.random() * 1.8;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), i % 5 === 0 ? glassMaterial : buildingMaterial);
      mesh.position.set((Math.random() - .5) * 22, height / 2 - 2, (Math.random() - .5) * 9);
      sceneGroup.add(mesh);
    }

    const road = new THREE.Mesh(new THREE.BoxGeometry(24, .18, 4), new THREE.MeshStandardMaterial({ color: 0x0a1725, roughness: 1 }));
    road.position.y = -1.95;
    sceneGroup.add(road);
    for (let x = -9; x <= 9; x += 2) {
      const lane = new THREE.Mesh(new THREE.BoxGeometry(.9, .02, .08), yellowMaterial);
      lane.position.set(x, -1.84, 0);
      sceneGroup.add(lane);
    }

    const bridge = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(14, .35, 2.3), new THREE.MeshStandardMaterial({ color: 0x274d70, roughness: .8 }));
    deck.position.set(0, .1, -4);
    bridge.add(deck);
    for (let x = -5; x <= 5; x += 2.5) {
      const pier = new THREE.Mesh(new THREE.CylinderGeometry(.11, .11, 3.2, 8), buildingMaterial);
      pier.position.set(x, -1.45, -4);
      bridge.add(pier);
    }
    sceneGroup.add(bridge);

    const crane = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.BoxGeometry(.22, 5, .22), yellowMaterial);
    mast.position.y = .6;
    crane.add(mast);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(5, .16, .16), yellowMaterial);
    arm.position.set(2, 3.05, 0);
    crane.add(arm);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(1, .3, .3), yellowMaterial);
    counter.position.set(-.5, 3.05, 0);
    crane.add(counter);
    crane.position.set(3, -1.9, -1);
    sceneGroup.add(crane);

    const points = new Float32Array(360);
    for (let i = 0; i < points.length; i += 3) {
      points[i] = (Math.random() - .5) * 28;
      points[i + 1] = (Math.random() - .2) * 13 - 2;
      points[i + 2] = (Math.random() - .5) * 14;
    }
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
    scene.add(new THREE.Points(pointGeometry, new THREE.PointsMaterial({ color: 0x66d9ef, size: .035, transparent: true, opacity: .65 })));

    const resize = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    let elapsed = 0;
    let last = performance.now();
    const frame = now => {
      const dt = Math.min(.04, (now - last) / 1000);
      last = now;
      elapsed += dt;
      crane.rotation.y = Math.sin(elapsed * .45) * .16;
      sceneGroup.rotation.y = Math.sin(elapsed * .09) * .08;
      camera.position.x = 8 + Math.sin(elapsed * .12) * 1.2;
      camera.position.y = 7 + Math.sin(elapsed * .17) * .35;
      camera.lookAt(0, 1, -2);
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    };

    resize();
    window.addEventListener('resize', resize, { passive: true });
    requestAnimationFrame(frame);
  }

  function initAnimations() {
    if (reduced || !window.gsap) return;
    const gsap = window.gsap;
    const ScrollTrigger = window.ScrollTrigger;
    if (ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

    const cards = qsa('.cc-stat-card');
    cards.forEach((element, index) => gsap.fromTo(element,
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: .6, delay: index * .04, ease: 'power2.out', scrollTrigger: ScrollTrigger ? { trigger: element, start: 'top 90%', once: true } : undefined }
    ));

    qsa('[data-count]').forEach(element => {
      const target = Number(element.dataset.count || 0);
      gsap.fromTo(element, { textContent: 0 }, {
        textContent: target,
        duration: 1.25,
        ease: 'power2.out',
        snap: { textContent: 1 },
        scrollTrigger: ScrollTrigger ? { trigger: element, start: 'top 90%', once: true } : undefined,
        onUpdate() { element.textContent = `${Math.round(Number(element.textContent || 0)).toLocaleString('en-IN')}+`; }
      });
    });
  }

  function init() {
    buildHero();
    buildStats();
    buildSavedJobsPage();
    addSavedJobsNavigation();
    bindSaveButtons();
    syncSaved();

    if (location.pathname === '/saved-jobs') {
      qsa('.page').forEach(page => page.classList.remove('active'));
      qs('#cc-saved-page')?.classList.add('active');
      document.title = 'Saved Civil Engineering Jobs | CivilCareer';
      const robots = document.querySelector('meta[name="robots"]') || document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'robots' }));
      robots.content = 'noindex,follow';
    }

    requestAnimationFrame(() => threeScene());
    initAnimations();
    window.addEventListener('cc:saved-change', renderSavedPage);

    const observer = new MutationObserver(() => bindSaveButtons());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
