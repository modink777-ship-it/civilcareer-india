/* ── CivilCareer hero — cinematic 4D blueprint city ──────────────────────
   Dependency-free canvas engine: perspective wireframe skyline with
   atmospheric aurora, depth fog, crane/spire details, blinking beacons,
   ground reflections, 3-layer bokeh particles, shooting light streaks,
   pointer parallax and a soft vignette. Honors prefers-reduced-motion,
   pauses off-screen, hidden below 480px. No external requests. */
(function () {
  'use strict';
  var REDUCED = false;
  try { REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function initHero() {
    var hero = document.querySelector('.hero');
    if (!hero || hero.querySelector('.hero-3d-canvas')) return;
    if (window.innerWidth < 480) return;

    var canvas = document.createElement('canvas');
    canvas.className = 'hero-3d-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    hero.prepend(canvas);
    var ctx = canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return; }

    /* deterministic rng */
    var seed = 90210;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

    /* ── city ── */
    var buildings = [];
    (function () {
      var ring, cell;
      for (ring = -4; ring <= 4; ring++) {
        for (cell = -4; cell <= 4; cell++) {
          if (ring === 0 && cell === 0) continue;
          var cheb = Math.max(Math.abs(ring), Math.abs(cell));
          if (cheb > 5) continue;
          if (cheb > 3 && rnd() < 0.35) continue;           // sparse outskirts
          var h = (1.6 + rnd() * 7.5) / (1 + cheb * 0.32);  // taller downtown
          buildings.push({
            x: ring * 6 + (rnd() - 0.5) * 2.4,
            z: cell * 6 + (rnd() - 0.5) * 2.4,
            w: 2.4 + rnd() * 1.8,
            d: 2.4 + rnd() * 1.8,
            h: Math.max(1.1, h),
            ph: rnd() * 6.283,
            spire: rnd() < 0.14,
            crane: rnd() < 0.10
          });
        }
      }
      buildings.sort(function (a, b) { return (b.x * b.x + b.z * b.z) - (a.x * a.x + a.z * a.z); });
    })();

    /* ── stars ── */
    var stars = [];
    (function () {
      for (var i = 0; i < 70; i++) {
        stars.push({ x: rnd(), y: rnd() * 0.55, r: 0.4 + rnd() * 1.1, tw: rnd() * 6.283, sp: 0.4 + rnd() * 1.2 });
      }
    })();

    /* ── bokeh particles: 3 depth layers ── */
    var parts = [];
    (function () {
      for (var i = 0; i < 42; i++) {
        var layer = Math.floor(rnd() * 3);
        parts.push({
          x: rnd(), y: rnd(),
          r: (layer === 2 ? 2.2 : layer === 1 ? 1.4 : 0.9) + rnd() * 1.4,
          layer: layer,
          sp: 0.006 + rnd() * 0.014,
          drift: (rnd() - 0.5) * 0.012,
          tw: rnd() * 6.283
        });
      }
    })();

    var streak = null, nextStreak = 4;

    /* ── sizing ── */
    var W = 0, H = 0, DPR = 1;
    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      var r = hero.getBoundingClientRect();
      W = Math.max(320, r.width);
      H = Math.max(240, r.height);
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    /* ── pointer parallax ── */
    var mx = 0, my = 0, tmx = 0, tmy = 0;
    hero.addEventListener('pointermove', function (ev) {
      var r = hero.getBoundingClientRect();
      tmx = ((ev.clientX - r.left) / r.width - 0.5) * 2;
      tmy = ((ev.clientY - r.top) / r.height - 0.5) * 2;
    });
    hero.addEventListener('pointerleave', function () { tmx = 0; tmy = 0; });

    /* ── camera ── */
    var CAM_DIST = 26, FOV = 300, yaw = 0;
    function project(x, y, z) {
      var c = Math.cos(yaw), s = Math.sin(yaw);
      var rx = x * c - z * s;
      var rz = x * s + z * c;
      var depth = rz + CAM_DIST;
      if (depth < 0.5) return null;
      var sc = FOV / depth;
      return { sx: W * 0.62 + rx * sc, sy: H * 0.80 - y * sc, s: sc };
    }

    var BLUE = '21, 94, 168';
    function blue(a) { return 'rgba(' + BLUE + ',' + a + ')'; }

    /* ── aurora atmosphere ── */
    function aurora(t) {
      var ax = W * 0.72 + mx * 30, ay = H * 0.18 + my * 18;
      var g1 = ctx.createRadialGradient(ax, ay, 10, ax, ay, Math.max(W, H) * 0.55);
      g1.addColorStop(0, 'rgba(21,94,168,0.16)');
      g1.addColorStop(1, 'rgba(21,94,168,0)');
      ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);

      var bx = W * 0.20 - mx * 24, by = H * 0.70 + my * 14;
      var g2 = ctx.createRadialGradient(bx, by, 10, bx, by, Math.max(W, H) * 0.45);
      g2.addColorStop(0, 'rgba(36,117,104,0.12)');
      g2.addColorStop(1, 'rgba(36,117,104,0)');
      ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);

      var gx = W * 0.5 + Math.sin(t * 0.05) * W * 0.18;
      var g3 = ctx.createRadialGradient(gx, H * 0.35, 10, gx, H * 0.35, Math.max(W, H) * 0.40);
      g3.addColorStop(0, 'rgba(255,255,255,0.20)');
      g3.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g3; ctx.fillRect(0, 0, W, H);
    }

    function drawStars(t) {
      var i, st;
      for (i = 0; i < stars.length; i++) {
        st = stars[i];
        var a = 0.18 + 0.30 * (0.5 + 0.5 * Math.sin(t * st.sp + st.tw));
        ctx.globalAlpha = a;
        ctx.fillStyle = blue(0.55);
        ctx.beginPath(); ctx.arc(st.x * W, st.y * H, st.r, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    /* ── shooting light streaks ── */
    function drawStreak(t, dt) {
      if (!streak && t > nextStreak) {
        streak = { x: -0.1, y: 0.10 + rnd() * 0.30, vx: 0.55 + rnd() * 0.30, vy: 0.05 + rnd() * 0.05, life: 1 };
        nextStreak = t + 5 + rnd() * 6;
      }
      if (!streak) return;
      streak.x += streak.vx * dt;
      streak.y += streak.vy * dt;
      streak.life -= dt * 0.7;
      if (streak.life <= 0 || streak.x > 1.2) { streak = null; return; }
      var x = streak.x * W, y = streak.y * H, len = 90;
      var slope = streak.vy / streak.vx;
      var g = ctx.createLinearGradient(x - len, y - len * slope, x, y);
      g.addColorStop(0, 'rgba(21,94,168,0)');
      g.addColorStop(1, 'rgba(21,94,168,' + (0.35 * streak.life).toFixed(3) + ')');
      ctx.strokeStyle = g; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x - len, y - len * slope); ctx.lineTo(x, y); ctx.stroke();
    }

    /* ── perspective grid + horizon glow ── */
    function drawGrid() {
      var EXT = 42, STEP = 6, i, a, b2;
      ctx.beginPath();
      for (i = -EXT; i <= EXT; i += STEP) {
        a = project(i, 0, -EXT); b2 = project(i, 0, EXT);
        if (a && b2) { ctx.moveTo(a.sx, a.sy); ctx.lineTo(b2.sx, b2.sy); }
        a = project(-EXT, 0, i); b2 = project(EXT, 0, i);
        if (a && b2) { ctx.moveTo(a.sx, a.sy); ctx.lineTo(b2.sx, b2.sy); }
      }
      ctx.strokeStyle = blue(0.10); ctx.stroke();

      var hz = project(0, 0, EXT * 0.2);
      if (hz) {
        var g = ctx.createLinearGradient(0, hz.sy - 40, 0, hz.sy + 2);
        g.addColorStop(0, 'rgba(21,94,168,0)');
        g.addColorStop(1, 'rgba(21,94,168,0.10)');
        ctx.fillStyle = g;
        ctx.fillRect(0, hz.sy - 40, W, 42);
      }
    }

    /* ── one wireframe building with fog, glow, details, reflection ── */
    function drawBuilding(b, t) {
      var hw = b.w / 2, hd = b.d / 2, h = b.h;
      var c = [
        project(b.x - hw, 0, b.z - hd), project(b.x + hw, 0, b.z - hd),
        project(b.x + hw, 0, b.z + hd), project(b.x - hw, 0, b.z + hd),
        project(b.x - hw, h, b.z - hd), project(b.x + hw, h, b.z - hd),
        project(b.x + hw, h, b.z + hd), project(b.x - hw, h, b.z + hd)
      ];
      var i;
      for (i = 0; i < 8; i++) { if (!c[i]) return; }
      var centre = project(b.x, h * 0.5, b.z);
      var base = centre ? Math.max(0.08, Math.min(0.5, 10 / Math.max(7, centre.s))) : 0.2;
      var edges = [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7]
      ];

      if (base > 0.30) {                       /* soft glow on near towers */
        ctx.beginPath();
        for (i = 0; i < edges.length; i++) {
          ctx.moveTo(c[edges[i][0]].sx, c[edges[i][0]].sy);
          ctx.lineTo(c[edges[i][1]].sx, c[edges[i][1]].sy);
        }
        ctx.strokeStyle = blue(base * 0.25); ctx.lineWidth = 3; ctx.stroke();
      }

      ctx.beginPath();
      for (i = 0; i < edges.length; i++) {
        ctx.moveTo(c[edges[i][0]].sx, c[edges[i][0]].sy);
        ctx.lineTo(c[edges[i][1]].sx, c[edges[i][1]].sy);
      }
      ctx.strokeStyle = blue(base); ctx.lineWidth = 1; ctx.stroke();

      var floors = Math.max(2, Math.round(b.h * 2.4)), f, tv, pA, pB;
      ctx.beginPath();
      for (f = 1; f < floors; f++) {
        tv = f / floors;
        pA = project(b.x - hw, h * tv, b.z - hd); pB = project(b.x + hw, h * tv, b.z - hd);
        if (pA && pB) { ctx.moveTo(pA.sx, pA.sy); ctx.lineTo(pB.sx, pB.sy); }
        pA = project(b.x - hw, h * tv, b.z + hd); pB = project(b.x + hw, h * tv, b.z + hd);
        if (pA && pB) { ctx.moveTo(pA.sx, pA.sy); ctx.lineTo(pB.sx, pB.sy); }
      }
      ctx.strokeStyle = blue(base * 0.45); ctx.stroke();

      if (b.spire) {                           /* antenna + blinking beacon */
        var s0 = project(b.x, h, b.z), s1 = project(b.x, h + 2.6, b.z);
        if (s0 && s1) {
          ctx.beginPath(); ctx.moveTo(s0.sx, s0.sy); ctx.lineTo(s1.sx, s1.sy);
          ctx.strokeStyle = blue(Math.min(0.6, base + 0.15)); ctx.stroke();
          var blink = 0.5 + 0.5 * Math.sin(t * 2 + b.ph);
          ctx.beginPath(); ctx.arc(s1.sx, s1.sy, 1.6, 0, 6.283);
          ctx.fillStyle = 'rgba(255,120,90,' + (0.25 + 0.45 * blink).toFixed(3) + ')';
          ctx.fill();
        }
      }

      if (b.crane) {                           /* construction crane silhouette */
        var topA = project(b.x + hw, h, b.z + hd), topB = project(b.x + hw, h, b.z - hd);
        var tipT = project(b.x + hw, h + 2.2, b.z + hd), tipB = project(b.x + hw, h + 2.2, b.z - hd);
        var jib = project(b.x + hw + 3.2, h + 2.0, b.z + hd);
        var tie = project(b.x + hw + 1.6, h + 3.0, b.z + hd);
        if (topA && topB && tipT && tipB && jib && tie) {
          ctx.beginPath();
          ctx.moveTo(topA.sx, topA.sy); ctx.lineTo(tipT.sx, tipT.sy);
          ctx.moveTo(topB.sx, topB.sy); ctx.lineTo(tipB.sx, tipB.sy);
          ctx.moveTo(tipT.sx, tipT.sy); ctx.lineTo(tipB.sx, tipB.sy);
          ctx.moveTo(tipT.sx, tipT.sy); ctx.lineTo(jib.sx, jib.sy);
          ctx.moveTo(jib.sx, jib.sy); ctx.lineTo(tie.sx, tie.sy);
          ctx.moveTo(tipT.sx, tipT.sy); ctx.lineTo(tie.sx, tie.sy);
          ctx.strokeStyle = blue(Math.min(0.55, base + 0.18)); ctx.stroke();
        }
      }

      /* faint ground reflection */
      var rA = project(b.x - hw, -h * 0.55, b.z - hd);
      var rB = project(b.x + hw, -h * 0.55, b.z - hd);
      if (rA && rB) {
        ctx.beginPath();
        ctx.moveTo(c[0].sx, c[0].sy); ctx.lineTo(rA.sx, rA.sy);
        ctx.moveTo(c[1].sx, c[1].sy); ctx.lineTo(rB.sx, rB.sy);
        ctx.strokeStyle = blue(base * 0.18); ctx.stroke();
      }
    }

    /* ── bokeh particles (3 parallax layers) ── */
    function drawParts(t, dt) {
      var i, p;
      for (i = 0; i < parts.length; i++) {
        p = parts[i];
        p.y -= p.sp * dt;
        if (p.y < -0.05) { p.y = 1.05; p.x = rnd(); }
        p.x += p.drift * dt;
        if (p.x < 0) p.x += 1; if (p.x > 1) p.x -= 1;
        var px = p.x * W + mx * (8 + p.layer * 14);
        var py = p.y * H + my * (5 + p.layer * 9);
        var a = (0.10 + 0.16 * p.layer) * (0.6 + 0.4 * Math.sin(t * 1.3 + p.tw));
        if (a <= 0.02) continue;
        if (p.layer === 2) {
          var g = ctx.createRadialGradient(px, py, 0, px, py, p.r * 3);
          g.addColorStop(0, 'rgba(21,94,168,' + (a * 0.9).toFixed(3) + ')');
          g.addColorStop(1, 'rgba(21,94,168,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(px, py, p.r * 3, 0, 6.283); ctx.fill();
        } else {
          ctx.fillStyle = blue(a.toFixed(3));
          ctx.beginPath(); ctx.arc(px, py, p.r, 0, 6.283); ctx.fill();
        }
      }
    }

    function vignette() {
      var g = ctx.createRadialGradient(W * 0.5, H * 0.45, Math.min(W, H) * 0.45, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
      g.addColorStop(0, 'rgba(11,31,58,0)');
      g.addColorStop(1, 'rgba(11,31,58,0.10)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    /* ── frame loop ── */
    var t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
    var last = t0;
    var rafId = null, running = false;

    function drawScene(t, dt) {
      ctx.clearRect(0, 0, W, H);
      aurora(t);
      drawStars(t);
      drawStreak(t, dt);
      drawGrid();
      for (var i = 0; i < buildings.length; i++) drawBuilding(buildings[i], t);
      drawParts(t, dt);
      vignette();
    }

    function frame(now) {
      if (!running) return;
      var t = (now - t0) / 1000;
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      mx += (tmx - mx) * 0.04;
      my += (tmy - my) * 0.04;
      yaw = t * 0.05 + mx * 0.30;
      CAM_DIST = 26 + my * 2;
      drawScene(t, dt);
      rafId = requestAnimationFrame(frame);
    }

    if (REDUCED) {
      yaw = 0.5;
      drawScene(2.0, 0);           /* one static, fully-composed frame */
    } else {
      running = true;
      drawScene(0, 0.016);         /* synchronous first paint */
      rafId = requestAnimationFrame(frame);
    }

    /* pause off-screen — zero wasted CPU */
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        var vis = entries[0].isIntersecting;
        if (REDUCED) return;
        if (vis && !running) { running = true; last = performance.now(); rafId = requestAnimationFrame(frame); }
        if (!vis && running) { running = false; if (rafId) cancelAnimationFrame(rafId); }
      }, { threshold: 0.02 }).observe(hero);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHero);
  } else {
    initHero();
  }
})();
