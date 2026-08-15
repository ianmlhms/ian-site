/* Site-wide theme: dark / light + custom accent. Sets CSS variables and injects
 * a floating 🎨 picker on every page that includes this script. Also injects a
 * ↻ refresh button when launched from the home screen (standalone PWA), where
 * there is no browser toolbar to reload from. */
(function () {
  const KEY = "site_theme";
  // theme.js is included from pages at different depths (root, and haus/), and a
  // bare "site-glass.css" in an href resolves against the PAGE, not this script —
  // so from haus/ it would ask for /haus/site-glass.css and 404. Resolve against
  // the script's own URL instead. (Dynamic import() below already does this,
  // because module specifiers resolve against the importing module.)
  const HERE = new URL(".", document.currentScript ? document.currentScript.src : location.href);
  const asset = (path) => new URL(path, HERE).href;
  const SITE_GLASS_URL = asset("site-glass.css?v=3");
  const MOBILE_CSS_URL = asset("mobile.css?v=1");
  const CONTRAST_MODULE_URL = "./glass-contrast.js?v=2";
  const ACCENTS = ["#6ea8fe", "#ff6b9d", "#3fb950", "#a371f7", "#ffb347", "#4de8ff"];

  const PALETTES = {
    dark: {
      "--bg": "#0d0d1a", "--text": "#e8e8f0", "--muted": "#8888aa", "--text2": "#8888aa",
      "--border": "#2a2a4a", "--card-opaque": "#161625", "--card2-opaque": "#1e1e35",
      "--card": "color-mix(in srgb, #161625 90%, transparent)",
      "--card2": "color-mix(in srgb, #1e1e35 92%, transparent)", "--card-hover": "#1e1e35",
      "--panel": "#161b22", "--panel2": "#1c232c", "--accent2": "#4de8ff",
    },
    light: {
      "--bg": "#f4f5fb", "--text": "#16182a", "--muted": "#5b6478", "--text2": "#5b6478",
      "--border": "#d6d9ea", "--card-opaque": "#ffffff", "--card2-opaque": "#eceefb",
      "--card": "color-mix(in srgb, #ffffff 90%, transparent)",
      "--card2": "color-mix(in srgb, #eceefb 92%, transparent)", "--card-hover": "#eceefb",
      "--panel": "#ffffff", "--panel2": "#eceefb", "--accent2": "#0891b2",
    },
  };
  const PICKER_CSS = `
    #themeFab{position:fixed;right:14px;bottom:14px;z-index:9000;width:44px;height:44px;border-radius:50%;
      border:1px solid var(--border);background:var(--glass-solid);color:var(--text);font-size:18px;cursor:pointer;
      box-shadow:0 4px 14px rgba(0,0,0,.3)}
    #themePop{position:fixed;right:14px;bottom:66px;z-index:9000;background:var(--glass-solid);border:1px solid var(--border);
      border-radius:14px;padding:14px;width:230px;display:none;box-shadow:0 8px 24px rgba(0,0,0,.4);font-family:system-ui,sans-serif}
    #themePop.open{display:block}
    #themePop h4{margin:0 0 10px;font-size:13px;color:var(--text)}
    .th-modes{display:flex;gap:8px;margin-bottom:12px}
    .th-modes button{flex:1;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--card2);
      color:var(--text);cursor:pointer;font-weight:700;font-size:13px}
    .th-modes button.on{border-color:var(--accent-border);color:var(--accent-text)}
    .th-acc{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
    .th-sw{width:44px;height:44px;border-radius:50%;cursor:pointer;border:6px solid transparent;padding:0}
    .th-sw.on{border-color:var(--text)}
    .th-custom{width:44px;height:44px;padding:0;border:none;background:none;cursor:pointer}`;

  let contrastRequest = 0;

  // `first` puts the sheet ahead of the page's own <style>, so page rules keep
  // winning ties — that is how site-glass.css has always been layered. mobile.css
  // does not need it: every rule there is `body`-prefixed and wins on specificity.
  function injectStylesheet(url, { first = false } = {}) {
    if (document.querySelector(`link[href="${url}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    if (first) document.head.insertBefore(link, document.head.querySelector('link[rel="stylesheet"],style'));
    else document.head.appendChild(link);
  }

  function refreshContrast(root, palette, accent) {
    contrastRequest += 1;
    const request = contrastRequest;
    import(CONTRAST_MODULE_URL).then(({ applyThemeContrast }) => {
      if (request !== contrastRequest) return;
      applyThemeContrast(root, palette, accent);
    }).catch((error) => console.error("site contrast", error));
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function get() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  }
  function apply(t) {
    const mode = t.mode === "light" ? "light" : "dark";
    const pal = PALETTES[mode];
    const root = document.documentElement;
    for (const k in pal) root.style.setProperty(k, pal[k]);
    const accent = t.accent || (mode === "light" ? "#2563eb" : "#6ea8fe");
    root.style.setProperty("--accent", accent);
    root.style.setProperty("color-scheme", mode);
    document.documentElement.dataset.theme = mode;
    refreshContrast(root, pal, accent);
  }
  function save(t) { localStorage.setItem(KEY, JSON.stringify(t)); apply(t); pushTheme(t); }

  injectStylesheet(SITE_GLASS_URL, { first: true });
  injectStylesheet(MOBILE_CSS_URL);
  apply(get()); // apply ASAP (before paint where possible)

  // ---- cross-device theme sync (#19) ----
  // localStorage stays the instant source (no flash on load); when signed in we
  // also mirror the choice to profiles.theme via PostgREST so it follows the
  // user to any device. No supabase-js needed here (theme.js loads first) — we
  // read the session token straight from localStorage, like restrictionGuard.
  function readSession() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!/^sb-.+-auth-token$/.test(k)) continue;
        const raw = JSON.parse(localStorage.getItem(k) || "null");
        const s = (raw && raw.currentSession) || raw;
        const token = s && s.access_token;
        let uid = s && s.user && s.user.id;
        if (token && !uid) {
          const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
          uid = p.sub;
        }
        if (token && uid) return { token, uid };
      }
    } catch (e) { /* unreadable session */ }
    return null;
  }
  function pushTheme(t) {
    const c = window.PB_CONFIG, s = readSession();
    if (!c || !s || !t || (!t.mode && !t.accent)) return;
    fetch(c.url + "/rest/v1/rpc/set_theme", {
      method: "POST",
      headers: { apikey: c.anonKey, Authorization: "Bearer " + s.token, "Content-Type": "application/json" },
      body: JSON.stringify({ p_theme: t }),
    }).catch(() => {});   // best-effort; localStorage already has it
  }
  async function serverSync() {
    const c = window.PB_CONFIG, s = readSession();
    if (!c || !s) return;
    try {
      const r = await fetch(c.url + "/rest/v1/profiles?id=eq." + s.uid + "&select=theme", {
        headers: { apikey: c.anonKey, Authorization: "Bearer " + s.token },
      });
      const rows = await r.json();
      const srv = rows && rows[0] && rows[0].theme;
      const local = get();
      if (srv && (srv.mode || srv.accent)) {
        if (JSON.stringify(srv) !== JSON.stringify(local)) {   // another device changed it
          localStorage.setItem(KEY, JSON.stringify(srv)); apply(srv);
        }
      } else if (local && (local.mode || local.accent)) {
        pushTheme(local);   // first sync: seed the server from this device
      }
    } catch (e) { /* offline / not migrated — stay on localStorage */ }
  }

  // ---- per-account access restriction ----
  // Some accounts may only use one app. A restricted user landing on any other
  // page is sent to their allowed app. Runs in <head> before paint, so there is
  // no flash of the hub. Reads the Supabase session straight from localStorage
  // (no SDK needed here); the real data is still protected server-side by RLS.
  function restrictionGuard() {
    const HOTEL_ONLY = []; // emails limited to the hotel builder (none currently)
    if (/(^|\/)hotel\.html$/.test(location.pathname)) return; // already allowed
    let email = "";
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!/^sb-.+-auth-token$/.test(k)) continue;
        const raw = JSON.parse(localStorage.getItem(k) || "null");
        const s = (raw && raw.currentSession) || raw; // tolerate version differences
        email = ((s && s.user && s.user.email) || "").toLowerCase();
        if (!email && s && s.access_token) {           // fall back to the JWT payload
          const p = JSON.parse(atob(s.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
          email = (p.email || "").toLowerCase();
        }
        break;
      }
    } catch (e) { /* unreadable session — leave navigation alone */ }
    if (email && HOTEL_ONLY.includes(email)) location.replace("hotel.html");
  }
  restrictionGuard();

  // ---- floating picker ----
  function buildPicker() {
    if (document.getElementById("themeFab")) return;
    const css = document.createElement("style");
    css.textContent = PICKER_CSS;
    document.head.appendChild(css);

    const fab = document.createElement("button");
    fab.id = "themeFab"; fab.title = "Theme"; fab.textContent = "🎨";
    fab.setAttribute("aria-label", "Theme");
    fab.setAttribute("aria-haspopup", "true");
    const pop = document.createElement("div");
    pop.id = "themePop";
    const t = get();
    pop.innerHTML = `<h4>Appearance</h4>
      <div class="th-modes">
        <button data-mode="dark">🌙 Dark</button>
        <button data-mode="light">☀️ Light</button>
      </div>
      <h4>Accent</h4>
      <div class="th-acc">
        ${ACCENTS.map(c=>`<button type="button" class="th-sw" data-acc="${esc(c)}" style="background:${esc(c)}" aria-label="Accent ${esc(c)}"></button>`).join("")}
        <input type="color" class="th-custom" title="Custom colour" aria-label="Custom accent colour" value="${esc(t.accent||'#6ea8fe')}">
      </div>`;
    document.body.appendChild(fab);
    document.body.appendChild(pop);

    function sync() {
      const cur = get();
      pop.querySelectorAll(".th-modes button").forEach(b=>b.classList.toggle("on",(cur.mode||"dark")===b.dataset.mode));
      pop.querySelectorAll(".th-sw").forEach(s=>s.classList.toggle("on", cur.accent===s.dataset.acc));
    }
    fab.onclick = () => { pop.classList.toggle("open"); sync(); };
    pop.querySelectorAll(".th-modes button").forEach(b=> b.onclick=()=>{ save({ ...get(), mode: b.dataset.mode }); sync(); });
    pop.querySelectorAll(".th-sw").forEach(s=> s.onclick=()=>{ save({ ...get(), accent: s.dataset.acc }); sync(); });
    pop.querySelector(".th-custom").oninput = (e)=>{ save({ ...get(), accent: e.target.value }); sync(); };
    document.addEventListener("click",(e)=>{ if(!pop.contains(e.target) && e.target!==fab) pop.classList.remove("open"); });
  }
  // ---- home-screen (standalone) refresh button ----
  function buildRefresh() {
    // Only useful when launched from the home screen — a standalone PWA has no
    // browser toolbar, so there is otherwise no way to reload the page.
    const standalone = window.navigator.standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches;
    if (!standalone || document.getElementById("pwaRefresh")) return;
    const css = document.createElement("style");
    css.textContent = `
    #pwaRefresh{position:fixed;right:66px;bottom:14px;z-index:9000;width:44px;height:44px;border-radius:50%;
      border:1px solid var(--border);background:var(--glass-solid);color:var(--text);font-size:20px;cursor:pointer;
      display:flex;align-items:center;justify-content:center;line-height:1;box-shadow:0 4px 14px rgba(0,0,0,.3)}
    #pwaRefresh:active{transform:scale(.92)}
    #pwaRefresh.spin{animation:pwaSpin .6s linear}
    @keyframes pwaSpin{to{transform:rotate(360deg)}}`;
    document.head.appendChild(css);
    const btn = document.createElement("button");
    btn.id = "pwaRefresh"; btn.title = "Refresh"; btn.setAttribute("aria-label", "Refresh");
    btn.textContent = "↻";
    btn.onclick = () => { btn.classList.add("spin"); location.reload(); };
    document.body.appendChild(btn);
  }

  // ---- site-wide feedback widget ----
  function loadFeedback() {
    // pixelbreak has its own feedback box; skip loading a second one there
    if (document.getElementById("fbFab") || document.getElementById("fbScript")) return;
    // no feedback button on phones — keeps the small-screen UI uncluttered
    if (window.matchMedia && window.matchMedia("(max-width: 760px)").matches) return;
    const s = document.createElement("script");
    s.id = "fbScript"; s.src = asset("feedback.js?v=1");
    document.body.appendChild(s);
  }

  // ---- PWA: real-app feel (#20) ----
  // Register the service worker on every page (idempotent; notify.js may also
  // register the same URL). Gives offline app-shell + faster repeat loads.
  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    // Resolved against this script, so a page in a subfolder still registers the
    // root worker and keeps the site-wide "/" scope instead of 404ing.
    navigator.serviceWorker.register(asset("sw.js")).catch(() => {});
  }

  // Mobile bottom tab bar so the site feels like a native app. Skipped on pages
  // that own the bottom of the screen (chat composers, full-screen games, call).
  const NAV = [
    { href: "index.html", ic: "🏠", label: "Heem" },
    { href: "pixelbreak.html", ic: "🎮", label: "Spiller" },
    { href: "messenger.html", ic: "💬", label: "Chat" },
    { href: "friends.html", ic: "👥", label: "Frënn" },
    { href: "profile.html", ic: "🪪", label: "Profil" },
  ];
  const NAV_SKIP = /(^|\/)(call|messenger|classchat|hotel|games|pixelbreak|kart)\.html$/;
  function buildBottomNav() {
    if (!window.matchMedia("(max-width:760px)").matches) return;
    if (NAV_SKIP.test(location.pathname)) return;
    if (document.getElementById("appNav")) return;
    const cur = location.pathname.split("/").pop() || "index.html";
    const css = document.createElement("style");
    css.textContent = `
    #appNav{position:fixed;left:0;right:0;bottom:0;z-index:8000;display:flex;
      background:var(--glass-solid);border-top:1px solid var(--border);
      padding-bottom:env(safe-area-inset-bottom,0px)}
    #appNav a{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;
      padding:8px 0 6px;color:var(--muted);font-size:10.5px;text-decoration:none;
      -webkit-tap-highlight-color:transparent}
    #appNav a .i{font-size:20px;line-height:1}
    #appNav a.on{color:var(--accent-text)}
    @media (max-width:760px){
      body{padding-bottom:calc(60px + env(safe-area-inset-bottom,0px)) !important}
      #themeFab,#pwaRefresh{bottom:calc(72px + env(safe-area-inset-bottom,0px)) !important}
    }`;
    document.head.appendChild(css);
    const nav = document.createElement("nav");
    nav.id = "appNav";
    nav.innerHTML = NAV.map(n => `<a href="${esc(n.href)}" class="${cur === n.href ? "on" : ""}"><span class="i">${esc(n.ic)}</span>${esc(n.label)}</a>`).join("");
    document.body.appendChild(nav);
  }

  // Install prompt: a small dismissible chip. Android/desktop Chrome fire
  // beforeinstallprompt; iOS Safari has no event, so the chip shows proactively
  // there and opens a short Add-to-Home-Screen guide instead.
  let deferredPrompt = null;
  // The native iOS wrapper app appends "IanLuApp" to its user agent — inside it
  // there is nothing to install.
  const IS_WRAPPER = /IanLuApp/.test(navigator.userAgent);
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; showInstall(); });
  function isIosSafari() {
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    return ios && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
  }
  function showIosGuide() {
    if (document.getElementById("pwaIosGuide")) return;
    const s = document.createElement("div");
    s.id = "pwaIosGuide";
    s.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9002;background:var(--glass-solid);" +
      "border-top:1px solid var(--border);border-radius:16px 16px 0 0;" +
      "padding:18px 20px calc(18px + env(safe-area-inset-bottom,0px));" +
      "box-shadow:0 -6px 24px rgba(0,0,0,.35);font-size:14.5px;line-height:1.6";
    s.innerHTML = "<b>📲 ian.lu als App installéieren</b><br>" +
      "1. Ënnen an der Mëtt op <b>Deelen</b> ⬆️ tippen<br>" +
      "2. <b>Zum Home-Bildschierm ➕</b> wielen<br>" +
      '<a href="notify-help.html" style="color:var(--accent)">Méi Hëllef</a>' +
      '<button id="pwaIosClose" style="position:absolute;top:10px;right:12px;background:none;border:none;' +
      'color:var(--muted);font-size:18px;cursor:pointer">✕</button>';
    document.body.appendChild(s);
    document.getElementById("pwaIosClose").onclick = () => s.remove();
  }
  function showInstall() {
    if (IS_WRAPPER) return;
    if (document.getElementById("pwaInstall")) return;
    const standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
    if (standalone) return;
    try { if (localStorage.getItem("pwaInstallDismissed")) return; } catch (e) {}
    const ios = !deferredPrompt && isIosSafari();
    const b = document.createElement("button");
    b.id = "pwaInstall"; b.textContent = ios ? "📲 Als App" : "⬇︎ Install";
    b.style.cssText = "position:fixed;left:14px;z-index:9001;bottom:calc(72px + env(safe-area-inset-bottom,0px));" +
      "background:var(--accent);color:var(--accent-foreground);border:none;border-radius:20px;padding:10px 15px;font-weight:800;" +
      "font-size:13px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3)";
    b.onclick = async () => {
      b.remove();
      try { localStorage.setItem("pwaInstallDismissed", "1"); } catch (e) {}
      if (deferredPrompt) { deferredPrompt.prompt(); try { await deferredPrompt.userChoice; } catch (e) {} deferredPrompt = null; }
      else if (ios) showIosGuide();
    };
    document.body.appendChild(b);
  }

  function boot() {
    buildPicker(); buildRefresh(); loadFeedback(); serverSync(); registerSW(); buildBottomNav();
    if (isIosSafari()) showInstall();
  }
  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot);

  import("./quick-open.js?v=1").catch((error) => console.error("quick open", error));
})();
