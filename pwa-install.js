// CivilCareer India — installable app prompt
(() => {
  let deferredPrompt = null;

  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  if (isStandalone) return;

  const style = document.createElement("style");
  style.textContent = `
    .cc-install-card{
      position:fixed;
      left:16px;
      right:16px;
      bottom:16px;
      z-index:9999;
      display:none;
      align-items:center;
      gap:12px;
      padding:14px 16px;
      border:1px solid rgba(255,255,255,.14);
      border-radius:16px;
      background:#0b1f3a;
      color:#fff;
      box-shadow:0 12px 35px rgba(0,0,0,.25);
      font-family:inherit;
    }
    .cc-install-card.show{display:flex}
    .cc-install-card .cc-install-text{flex:1}
    .cc-install-card strong{display:block;font-size:15px}
    .cc-install-card span{display:block;font-size:12px;opacity:.82;margin-top:3px}
    .cc-install-btn{
      border:0;
      border-radius:10px;
      padding:10px 14px;
      background:#fff;
      color:#0b1f3a;
      font-weight:700;
      cursor:pointer;
      white-space:nowrap;
    }
    .cc-install-close{
      border:0;
      background:transparent;
      color:#fff;
      opacity:.7;
      font-size:20px;
      cursor:pointer;
      padding:4px;
    }
    @media(min-width:700px){
      .cc-install-card{left:auto;max-width:430px}
    }
  `;
  document.head.appendChild(style);

  const card = document.createElement("div");
  card.className = "cc-install-card";
  card.innerHTML = `
    <div class="cc-install-text">
      <strong>Install CivilCareer India</strong>
      <span>Get quick access from your phone home screen.</span>
    </div>
    <button class="cc-install-btn" type="button">Install</button>
    <button class="cc-install-close" type="button" aria-label="Close">×</button>
  `;
  document.body.appendChild(card);

  const installButton = card.querySelector(".cc-install-btn");
  const closeButton = card.querySelector(".cc-install-close");

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;

    // Don't repeatedly annoy users who dismissed it recently.
    const dismissed = Number(localStorage.getItem("cc_install_dismissed") || 0);
    if (Date.now() - dismissed < 7 * 24 * 60 * 60 * 1000) return;

    card.classList.add("show");
  });

  installButton.addEventListener("click", async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();

    try {
      await deferredPrompt.userChoice;
    } catch {}

    deferredPrompt = null;
    card.classList.remove("show");
  });

  closeButton.addEventListener("click", () => {
    localStorage.setItem("cc_install_dismissed", String(Date.now()));
    card.classList.remove("show");
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    card.classList.remove("show");
  });
})();
