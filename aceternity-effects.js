/* CivilCareer Aceternity-inspired visual effects
   Dependency-free vanilla implementation of two effects:
   1) animated career/engineering SVG paths driven by scroll + pointer
   2) depth-based parallax for existing photo background layers
   No React, Tailwind, shadcn, Motion or paid service required. */
(function () {
  'use strict';

  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  var targets = new WeakMap();
  var raf = 0;

  function makeSvg(parent) {
    if (parent.querySelector('.cc-aceternity-paths')) return;

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('cc-aceternity-paths');
    svg.setAttribute('viewBox', '0 0 1440 700');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    svg.style.inset = '0';
    svg.style.display = 'block';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '1';

    var paths = [
      'M-20 545 C170 545 230 535 340 475 C445 418 485 425 585 455 C690 487 725 390 835 398 C950 407 1000 490 1120 462 C1230 436 1290 350 1460 360',
      'M-20 600 C145 570 235 580 355 520 C465 465 530 485 640 505 C750 525 790 455 890 438 C1010 418 1080 500 1190 475 C1300 450 1350 405 1460 420',
      'M-20 430 C130 415 245 430 330 390 C450 335 530 355 625 410 C710 458 760 330 870 350 C980 370 1045 430 1150 400 C1260 368 1330 315 1460 325',
      'M-20 650 C190 625 290 635 405 575 C520 515 605 570 700 565 C805 560 850 485 960 490 C1070 495 1145 550 1245 515 C1330 485 1380 455 1460 460',
      'M-20 350 C160 365 235 350 350 315 C470 278 555 315 645 350 C745 388 810 280 920 305 C1035 332 1090 370 1190 342 C1300 312 1360 275 1460 290'
    ];

    paths.forEach(function (d, i) {
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      p.setAttribute('class', 'cc-career-path cc-career-path-' + i);
      p.setAttribute('fill', 'none');
      svg.appendChild(p);
    });

    parent.prepend(svg);
    var lineData = Array.prototype.slice.call(svg.querySelectorAll('path')).map(function (p) {
      var len = p.getTotalLength();
      p.style.strokeDasharray = len + ' ' + len;
      p.style.strokeDashoffset = len;
      return { el: p, len: len };
    });

    targets.set(parent, {
      svg: svg,
      lines: lineData,
      px: 0, py: 0, tx: 0, ty: 0,
      visible: true,
      progress: reduced ? 1 : 0
    });

    if (!reduced) {
      parent.addEventListener('pointermove', function (ev) {
        var r = parent.getBoundingClientRect();
        var x = ((ev.clientX - r.left) / Math.max(1, r.width) - 0.5) * 2;
        var y = ((ev.clientY - r.top) / Math.max(1, r.height) - 0.5) * 2;
        var state = targets.get(parent);
        if (state) { state.tx = x; state.ty = y; }
      });
      parent.addEventListener('pointerleave', function () {
        var state = targets.get(parent);
        if (state) { state.tx = 0; state.ty = 0; }
      });
    }
  }

  function addParallax(parent) {
    var layers = parent.querySelectorAll('.cc-bg-layer');
    if (!layers.length) return;
    Array.prototype.forEach.call(layers, function (layer, i) {
      if (layer.dataset.ccParallaxReady) return;
      layer.dataset.ccParallaxReady = '1';
      layer.style.setProperty('--cc-depth', String(0.22 + i * 0.10));
    });
  }

  function getTargets() {
    var list = [];
    document.querySelectorAll('.hero, .page-hero, .careerhub-hero').forEach(function (el) {
      if (el.offsetParent !== null) list.push(el);
    });
    return list;
  }

  function update(now) {
    raf = 0;
    var list = getTargets();
    list.forEach(function (parent) {
      makeSvg(parent);
      addParallax(parent);
      var state = targets.get(parent);
      if (!state) return;

      var r = parent.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight;
      var visible = r.bottom > 0 && r.top < vh;
      if (!visible) return;

      var raw = (vh - r.top) / (vh + Math.max(1, r.height));
      var progress = Math.max(0, Math.min(1, raw));
      state.progress = reduced ? 1 : progress;
      state.px += (state.tx - state.px) * 0.08;
      state.py += (state.ty - state.py) * 0.08;

      state.lines.forEach(function (line, i) {
        var stagger = i * 0.055;
        var p = Math.max(0, Math.min(1, (state.progress - stagger) / Math.max(0.35, 1 - stagger)));
        line.el.style.strokeDashoffset = String(line.len * (1 - p));
      });

      state.svg.style.transform = 'translate3d(' + (state.px * 12).toFixed(2) + 'px,' + (state.py * 7).toFixed(2) + 'px,0)';

      var layers = parent.querySelectorAll('.cc-bg-layer');
      Array.prototype.forEach.call(layers, function (layer, i) {
        var depth = 0.22 + i * 0.10;
        var x = state.px * 28 * depth;
        var y = state.py * 18 * depth;
        var scale = 1.035 + depth * 0.006;
        layer.style.setProperty('--cc-px', x.toFixed(2) + 'px');
        layer.style.setProperty('--cc-py', y.toFixed(2) + 'px');
        layer.style.setProperty('--cc-scale', scale.toFixed(4));
      });
    });
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(update);
  }

  function init() {
    getTargets().forEach(function (parent) { makeSvg(parent); addParallax(parent); });
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    document.addEventListener('click', function () { setTimeout(schedule, 100); }, true);
    new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    setInterval(schedule, 900);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}());
