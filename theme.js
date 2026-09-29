/* Dark-mode controller (P5.1): "auto" follows prefers-color-scheme; an explicit
   choice is stored in localStorage. Loaded from <head> so the theme applies
   before first paint (no flash). */
(function () {
  var KEY = 'cc_theme';
  function apply(t) { document.documentElement.setAttribute('data-theme', t); }
  function stored() {
    try { var s = localStorage.getItem(KEY); return (s === 'dark' || s === 'light') ? s : null; } catch (e) { return null; }
  }
  function system() {
    try { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) { return 'light'; }
  }
  function effective() { return stored() || system(); }
  apply(effective());
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (!stored()) apply(effective());
    });
  } catch (e) { /* older browsers keep the initial choice */ }
  function cycle() {
    var cur = stored() || system();
    var next = cur === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) {}
    apply(next);
    var b = document.querySelector('.theme-toggle');
    if (b) { b.textContent = next === 'dark' ? '\u2600' : '\u263D'; b.setAttribute('aria-label', 'Switch to ' + (next === 'dark' ? 'light' : 'dark') + ' theme (currently ' + next + ')'); }
  }
  function wire() {
    var b = document.querySelector('.theme-toggle');
    if (!b || b.dataset.ccThemeWired) return;
    b.dataset.ccThemeWired = '1';
    b.addEventListener('click', cycle);
    b.textContent = effective() === 'dark' ? '\u2600' : '\u263D';
    b.setAttribute('aria-label', 'Switch theme');
    b.setAttribute('aria-live', 'polite');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.theme-toggle')) { /* handled above */ }
  });
  window.ccTheme = { effective: effective, cycle: cycle, wire: wire };
})();
