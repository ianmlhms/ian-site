/* Site-wide feedback widget. Injected on every page by theme.js.
 * Anyone (signed in or not) can send an idea / bug / note — it goes to the
 * public.feedback table via an anon REST insert (RLS allows anon insert), and
 * shows up in the admin panel's Feedback tab. Skips pages that already have
 * their own feedback box (PixelBreak). */
(function () {
  if (window.__fbWidget) return;
  window.__fbWidget = true;

  const cfg = window.PB_CONFIG || {};
  const SB_URL = (cfg.url || "https://lvksqmgfwkfbblfsozfk.supabase.co").replace(/\/$/, "");
  const SB_KEY = cfg.anonKey || "sb_publishable_aqZ5h0dyxzgwqnpAv-oiuA_2O60dNH2";

  function readUsername() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!/^sb-.+-auth-token$/.test(k)) continue;
        const raw = JSON.parse(localStorage.getItem(k) || "null");
        const s = (raw && raw.currentSession) || raw;
        if (s && s.user) return (s.user.user_metadata && s.user.user_metadata.username) || s.user.email || null;
      }
    } catch (e) {}
    return null;
  }

  function boot() {
    if (document.getElementById("fbFab")) return;   // page already has a feedback box

    const css = document.createElement("style");
    css.textContent = `
    #fbFab{position:fixed;bottom:18px;left:18px;z-index:8500;width:46px;height:46px;border-radius:50%;
      border:1px solid var(--border,#2a2a4a);background:var(--card,#161625);color:var(--accent2,#4de8ff);
      font-size:21px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3)}
    #fbPanel{position:fixed;bottom:72px;left:18px;z-index:8501;width:290px;max-width:calc(100vw - 36px);
      background:var(--card,#161625);border:1px solid var(--border,#2a2a4a);border-radius:14px;padding:14px;
      display:none;box-shadow:0 8px 24px rgba(0,0,0,.4);font-family:system-ui,sans-serif;color:var(--text,#e8e8f0)}
    #fbPanel.open{display:block}
    #fbPanel h4{margin:0 0 8px;font-size:14px}
    #fbPanel select,#fbPanel textarea{width:100%;box-sizing:border-box;margin-bottom:8px;padding:8px;border-radius:8px;
      border:1px solid var(--border,#2a2a4a);background:var(--bg,#0d0d1a);color:var(--text,#e8e8f0);font-family:inherit;font-size:14px}
    #fbPanel textarea{resize:vertical}
    #fbRow{display:flex;gap:8px;align-items:center}
    #fbSend{flex:1;padding:9px;border-radius:8px;border:none;background:var(--accent2,#4de8ff);color:#08121a;font-weight:800;cursor:pointer;font-family:inherit}
    #fbNote{font-size:12px;color:var(--muted,#8888aa)}`;
    document.head.appendChild(css);

    const fab = document.createElement("button");
    fab.id = "fbFab"; fab.title = "Feedback"; fab.setAttribute("aria-label", "Feedback"); fab.textContent = "💬";
    const panel = document.createElement("div");
    panel.id = "fbPanel";
    panel.innerHTML = `<h4>Feedback</h4>
      <select id="fbKind">
        <option value="idea">💡 Idea / suggestion</option>
        <option value="bug">🐛 Report a bug</option>
        <option value="other">💬 Something else</option>
      </select>
      <textarea id="fbMsg" rows="3" maxlength="2000" placeholder="Tell me…"></textarea>
      <div id="fbRow"><button id="fbSend">Send</button><span id="fbNote"></span></div>`;
    document.body.appendChild(fab);
    document.body.appendChild(panel);

    fab.onclick = () => panel.classList.toggle("open");
    document.addEventListener("click", (e) => { if (!panel.contains(e.target) && e.target !== fab) panel.classList.remove("open"); });

    document.getElementById("fbSend").onclick = async () => {
      const msg = document.getElementById("fbMsg").value.trim();
      const note = document.getElementById("fbNote");
      if (msg.length < 3) { note.textContent = "Too short"; return; }
      note.textContent = "…";
      try {
        const r = await fetch(SB_URL + "/rest/v1/feedback", {
          method: "POST",
          headers: { apikey: SB_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({
            kind: document.getElementById("fbKind").value,
            message: msg.slice(0, 2000),
            page: location.pathname.replace(/^\//, "").replace(/\.html$/, "") || "home",
            username: readUsername(),
          }),
        });
        if (!r.ok) throw new Error("HTTP " + r.status);
        document.getElementById("fbMsg").value = "";
        note.textContent = "Merci! 🎉";
        setTimeout(() => { panel.classList.remove("open"); note.textContent = ""; }, 1500);
      } catch (e) { console.warn("[feedback]", e); note.textContent = "Failed — try again"; }
    };
  }

  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
