/* Shared Supabase auth for the site (same project/accounts as PixelBreak).
 * Reads window.PB_CONFIG from pixelbreak-config.js. ES module. */
const cfg = window.PB_CONFIG || {};
export const authConfigured =
  /^https:\/\/.+\.supabase\.co\/?$/.test((cfg.url || "").trim()) && (cfg.anonKey || "").trim().length > 20;

// Shared across EVERY instance of this module — even when it's imported under
// different "?v=" query strings (auth.js vs auth.js?v=4 are otherwise separate
// modules with separate clients). Two Supabase/GoTrue clients on the same
// localStorage race on token refresh and corrupt the session, which shows up as
// "signed in but everything 401s" (no chats load, admin link missing). One global
// client avoids that.
const _g = (window.__pbAuth = window.__pbAuth || { sb: null, ready: null, session: null, cbs: [] });

async function getCreateClient() {
  // Prefer the global UMD build (loaded via <script> in the page) — most reliable
  // across browsers (Safari/iOS in particular). Fall back to an ESM CDN import.
  if (window.supabase && window.supabase.createClient) return window.supabase.createClient;
  try {
    const m = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    return m.createClient;
  } catch {
    const m = await import("https://esm.sh/@supabase/supabase-js@2");
    return m.createClient;
  }
}

// Best-effort read of the persisted session straight from localStorage. Used
// only as a recovery hint: getSession() can transiently return null (a flaky /
// mid-flight token refresh, Safari throttling), which otherwise makes a
// signed-in user look logged out — no chats, no admin link, profile shows the
// sign-in gate. If a real session is stored, we re-establish it below.
function storedSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!/^sb-.+-auth-token$/.test(k)) continue;
      const raw = JSON.parse(localStorage.getItem(k) || "null");
      const s = (raw && raw.currentSession) || raw; // tolerate storage-format differences
      if (s && s.access_token && s.refresh_token && s.user) return s;
    }
  } catch { /* unreadable storage — treat as no stored session */ }
  return null;
}

export async function client() {
  if (_g.sb) return _g.sb;
  if (!_g.ready) {
    _g.ready = (async () => {
      const createClient = await getCreateClient();
      _g.sb = createClient(cfg.url.replace(/\/$/, ""), cfg.anonKey);
      let { data } = await _g.sb.auth.getSession();
      if (!data.session) {
        // getSession came back empty. If a session is actually persisted, recover
        // it (setSession refreshes an expired access token when the refresh token
        // is still good) rather than declaring the user logged out. If the refresh
        // token is genuinely dead, this fails quietly and we stay signed out.
        const stored = storedSession();
        if (stored) {
          try {
            const r = await _g.sb.auth.setSession({
              access_token: stored.access_token, refresh_token: stored.refresh_token,
            });
            if (r.data && r.data.session) data = r.data;
          } catch { /* dead refresh token — genuinely signed out */ }
        }
      }
      _g.session = data.session;
      _g.sb.auth.onAuthStateChange((_e, s) => { _g.session = s; _g.cbs.forEach((cb) => cb(s)); });
      return _g.sb;
    })();
  }
  await _g.ready;
  return _g.sb;
}

export const session = () => _g.session;
export const username = () => (_g.session ? (_g.session.user.user_metadata?.username || _g.session.user.email) : null);
export function onAuth(cb) { _g.cbs.push(cb); }

export async function signIn(email, password) {
  const sb = await client();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function signUp(email, password, uname) {
  const sb = await client();
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username: uname } } });
  if (error) throw error;
  return data;
}
export async function signOut() { const sb = await client(); await sb.auth.signOut(); }

/* ---------------- reusable UI ---------------- */
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function injectCss() {
  if (document.getElementById("auth-css")) return;
  const s = document.createElement("style");
  s.id = "auth-css";
  s.textContent = `
  .auth-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:30px;border:1px solid #2a2a4a;background:#1a1a30;color:#e8e8f0;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;white-space:nowrap}
  .auth-btn:hover{border-color:#4de8ff;color:#4de8ff}
  .auth-modal{position:fixed;inset:0;background:rgba(0,0,0,.65);display:none;align-items:center;justify-content:center;z-index:5000;padding:18px}
  .auth-modal.open{display:flex}
  .auth-box{background:#161625;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:26px 24px;width:340px;max-width:100%;color:#e8e8f0;font-family:inherit}
  .auth-box h3{margin:0 0 4px;font-size:20px}
  .auth-tabs{display:flex;gap:8px;margin:14px 0}
  .auth-tab{flex:1;padding:8px;border-radius:10px;border:1px solid #2a2a4a;background:transparent;color:#8888aa;cursor:pointer;font-weight:700;font-size:13px}
  .auth-tab.active{background:#ff6b9d;border-color:#ff6b9d;color:#fff}
  .auth-box input{width:100%;background:#1a1a30;border:1px solid #2a2a4a;color:#e8e8f0;border-radius:10px;padding:11px 12px;font-size:14px;margin-bottom:10px;font-family:inherit}
  .auth-go{width:100%;background:#ff6b9d;color:#fff;border:none;border-radius:10px;padding:12px;font-size:15px;font-weight:800;cursor:pointer}
  .auth-go:hover{filter:brightness(1.08)}
  .auth-msg{font-size:12.5px;margin-top:10px;min-height:16px}
  .auth-msg.err{color:#ff6b6b}.auth-msg.ok{color:#44ff88}
  .auth-x{float:right;background:none;border:none;color:#8888aa;font-size:20px;cursor:pointer;line-height:1}`;
  document.head.appendChild(s);
}

let _modal;
function modalEl() {
  if (_modal) return _modal;
  injectCss();
  _modal = document.createElement("div");
  _modal.className = "auth-modal";
  _modal.innerHTML = `<div class="auth-box"></div>`;
  _modal.addEventListener("click", (e) => { if (e.target === _modal) _modal.classList.remove("open"); });
  document.body.appendChild(_modal);
  return _modal;
}

export function openAuthModal() {
  const m = modalEl();
  if (session()) {
    m.querySelector(".auth-box").innerHTML =
      `<button class="auth-x">&times;</button><h3>Signed in</h3>
       <p style="color:#8888aa;font-size:13px">as <b>${esc(username())}</b></p>
       <button class="auth-go" id="authOut">Sign out</button>`;
    m.querySelector(".auth-x").onclick = () => m.classList.remove("open");
    m.querySelector("#authOut").onclick = async () => { await signOut(); m.classList.remove("open"); };
    m.classList.add("open");
    return;
  }
  let mode = "in";
  const draw = () => {
    m.querySelector(".auth-box").innerHTML = `
      <button class="auth-x">&times;</button>
      <h3>Account</h3>
      <div class="auth-tabs">
        <button class="auth-tab ${mode === "in" ? "active" : ""}" data-m="in">Sign in</button>
        <button class="auth-tab ${mode === "up" ? "active" : ""}" data-m="up">Create account</button>
      </div>
      ${mode === "up" ? '<input id="authUser" placeholder="Username" maxlength="24" autocomplete="username">' : ""}
      <input id="authEmail" type="email" placeholder="Email" autocomplete="email">
      <input id="authPass" type="password" placeholder="Password (min 6)" autocomplete="current-password">
      <button class="auth-go">${mode === "up" ? "Create account" : "Sign in"}</button>
      <div class="auth-msg" id="authMsg"></div>`;
    const box = m.querySelector(".auth-box");
    box.querySelector(".auth-x").onclick = () => m.classList.remove("open");
    box.querySelectorAll(".auth-tab").forEach((t) => (t.onclick = () => { mode = t.dataset.m; draw(); }));
    box.querySelector(".auth-go").onclick = submit;
  };
  const v = (id) => (document.getElementById(id)?.value || "").trim();
  const submit = async () => {
    const msg = document.getElementById("authMsg");
    const email = v("authEmail"), pass = v("authPass");
    msg.className = "auth-msg";
    if (!email || pass.length < 6) { msg.className = "auth-msg err"; msg.textContent = "Enter an email and a 6+ char password."; return; }
    msg.textContent = "…";
    try {
      if (mode === "up") {
        const data = await signUp(email, pass, v("authUser") || email.split("@")[0]);
        if (!data.session) { msg.className = "auth-msg ok"; msg.textContent = "Account created — confirm via email, then sign in."; return; }
      } else {
        await signIn(email, pass);
      }
      m.classList.remove("open");
    } catch (e) { msg.className = "auth-msg err"; msg.textContent = e.message || "Something went wrong."; }
  };
  draw();
  m.classList.add("open");
}

/* Render a sign-in / username button into a host element and keep it in sync. */
export function mountAccountButton(host) {
  injectCss();
  const btn = document.createElement("button");
  btn.className = "auth-btn";
  btn.onclick = openAuthModal;
  host.appendChild(btn);
  const sync = () => { btn.innerHTML = session() ? `👤 ${esc(username())}` : "👤 Sign in"; };
  onAuth(sync);
  client().then(sync).catch(() => sync());
  sync();
  return btn;
}
