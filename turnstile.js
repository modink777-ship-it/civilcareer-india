/* Turnstile loader — no-op until the server publishes a site key.
   When TURNSTILE_SITE_KEY is configured, the widget is rendered into every
   <form data-cc-turnstile> and wireForm() attaches the token to submissions. */
(async function () {
  try {
    const r = await fetch('/api/auth-config', { cache: 'no-store' });
    const c = await r.json().catch(() => ({}));
    const siteKey = String(c.turnstileSiteKey || '');
    if (!siteKey) return;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true;
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
    if (!window.turnstile) return;
    const widgets = new Map();
    function ensure(form) {
      let w = widgets.get(form);
      if (w) return w;
      const holder = document.createElement('div');
      const status = form.querySelector('.form-status');
      form.insertBefore(holder, status || null);
      const id = window.turnstile.render(holder, { sitekey: siteKey, theme: 'light' });
      w = { holder, id };
      widgets.set(form, w);
      return w;
    }
    document.querySelectorAll('form[data-cc-turnstile]').forEach(ensure);
    window.ccTurnstile = {
      token(form) {
        const w = widgets.get(form);
        if (!w) return '';
        const input = w.holder.querySelector('input[name="cf-turnstile-response"]');
        return input ? input.value : '';
      },
      reset(form) {
        const w = widgets.get(form);
        if (w) { try { window.turnstile.reset(w.id); } catch (e) {} }
      },
    };
  } catch (e) {
    /* Captcha stays optional; server-side rate limiting and the honeypot still apply. */
  }
})();
