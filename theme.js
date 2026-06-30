/* Site-wide theme: dark / light + custom accent. Sets CSS variables and injects
 * a floating 🎨 picker on every page that includes this script. Also injects a
 * ↻ refresh button when launched from the home screen (standalone PWA), where
 * there is no browser toolbar to reload from. */
(function () {
  const KEY = "site_theme";
  const ACCENTS = ["#6ea8fe", "#ff6b9d", "#3fb950", "#a371f7", "#ffb347", "#4de8ff"];

  const PALETTES = {
    dark: {
      "--bg": "#0d0d1a", "--text": "#e8e8f0", "--muted": "#8888aa", "--text2": "#8888aa",
      "--border": "#2a2a4a", "--card": "#161625", "--card2": "#1e1e35", "--card-hover": "#1e1e35",
      "--panel": "#161b22", "--panel2": "#1c232c", "--accent2": "#4de8ff",
    },
    light: {
      "--bg": "#f4f5fb", "--text": "#16182a", "--muted": "#5b6478", "--text2": "#5b6478",
      "--border": "#d6d9ea", "--card": "#ffffff", "--card2": "#eceefb", "--card-hover": "#eceefb",
      "--panel": "#ffffff", "--panel2": "#eceefb", "--accent2": "#0891b2",
    },
  };

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
  }
  function save(t) { localStorage.setItem(KEY, JSON.stringify(t)); apply(t); }

  apply(get()); // apply ASAP (before paint where possible)

  // ---- floating picker ----
  function buildPicker() {
    if (document.getElementById("themeFab")) return;
    const css = document.createElement("style");
    css.textContent = `
    #themeFab{position:fixed;right:14px;bottom:14px;z-index:9000;width:42px;height:42px;border-radius:50%;
      border:1px solid var(--border);background:var(--card);color:var(--text);font-size:18px;cursor:pointer;
      box-shadow:0 4px 14px rgba(0,0,0,.3)}
    #themePop{position:fixed;right:14px;bottom:64px;z-index:9000;background:var(--card);border:1px solid var(--border);
      border-radius:14px;padding:14px;width:230px;display:none;box-shadow:0 8px 24px rgba(0,0,0,.4);font-family:system-ui,sans-serif}
    #themePop.open{display:block}
    #themePop h4{margin:0 0 10px;font-size:13px;color:var(--text)}
    .th-modes{display:flex;gap:8px;margin-bottom:12px}
    .th-modes button{flex:1;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--card2);
      color:var(--text);cursor:pointer;font-weight:700;font-size:13px}
    .th-modes button.on{border-color:var(--accent);color:var(--accent)}
    .th-acc{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
    .th-sw{width:26px;height:26px;border-radius:50%;cursor:pointer;border:2px solid transparent}
    .th-sw.on{border-color:var(--text)}
    .th-custom{width:30px;height:30px;padding:0;border:none;background:none;cursor:pointer}`;
    document.head.appendChild(css);

    const fab = document.createElement("button");
    fab.id = "themeFab"; fab.title = "Theme"; fab.textContent = "🎨";
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
        ${ACCENTS.map(c=>`<span class="th-sw" data-acc="${c}" style="background:${c}"></span>`).join("")}
        <input type="color" class="th-custom" title="Custom colour" value="${t.accent||'#6ea8fe'}">
      </div>`;
    document.body.appendChild(fab);
    document.body.appendChild(pop);

    function sync() {
      const cur = get();
      pop.querySelectorAll(".th-modes button").forEach(b=>b.classList.toggle("on",(cur.mode||"dark")===b.dataset.mode));
      pop.querySelectorAll(".th-sw").forEach(s=>s.classList.toggle("on", cur.accent===s.dataset.acc));
    }
    fab.onclick = () => { pop.classList.toggle("open"); sync(); };
    pop.querySelectorAll(".th-modes button").forEach(b=> b.onclick=()=>{ const c=get(); c.mode=b.dataset.mode; save(c); sync(); });
    pop.querySelectorAll(".th-sw").forEach(s=> s.onclick=()=>{ const c=get(); c.accent=s.dataset.acc; save(c); sync(); });
    pop.querySelector(".th-custom").oninput = (e)=>{ const c=get(); c.accent=e.target.value; save(c); sync(); };
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
    #pwaRefresh{position:fixed;right:66px;bottom:14px;z-index:9000;width:42px;height:42px;border-radius:50%;
      border:1px solid var(--border);background:var(--card);color:var(--text);font-size:20px;cursor:pointer;
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

  function boot() { buildPicker(); buildRefresh(); }
  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
