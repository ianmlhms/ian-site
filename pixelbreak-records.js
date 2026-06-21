/* PixelBreak — accounts + high-score records.
 *
 * - Captures a score from each game via a small reporter injected into the game iframe
 *   (games broadcast their score with postMessage; we keep the max as that play's result).
 * - Always saves your best per game in localStorage (works logged-out, on-device).
 * - If Supabase is configured (pixelbreak-config.js) and you're signed in, it also syncs
 *   your best to the cloud and shows a global per-game leaderboard.
 *
 * The page calls: PB.instrument(html), PB.onOpenGame(game), PB.onCloseGame().
 */
const cfg = window.PB_CONFIG || {};
const cloudEnabled = /^https:\/\/.+\.supabase\.co\/?$/.test((cfg.url || "").trim()) &&
                     (cfg.anonKey || "").trim().length > 20;

const PB = (window.PB = {});
PB.current = null;          // currently open game object {id,name,...}
let sessionMax = null;      // best score reported during this play
let sb = null, session = null, username = null;

/* ---------------- local best (always on) ---------------- */
const localBest = (id) => +(localStorage.getItem("pb_best_" + id) || 0);
const setLocalBest = (id, v) => { if (v > localBest(id)) localStorage.setItem("pb_best_" + id, v); };

/* ---------------- score reporter injected into each game ---------------- */
const REPORTER = `<script>(function(){
  var last=null;
  function num(x){var n=parseInt(String(x).replace(/[^0-9-]/g,''),10);return isNaN(n)?null:n;}
  function read(){
    try{
      if(typeof window.score==='number'&&isFinite(window.score))return window.score;
      var el=document.querySelector('[id*="score" i]:not([id*="high" i]),[class*="score" i]:not([class*="high" i])');
      if(el){var n=num(el.textContent);if(n!=null)return n;}
    }catch(e){}
    return null;
  }
  function rep(){var s=read();if(s!=null&&s!==last){last=s;try{parent.postMessage({__pb:1,score:s},'*');}catch(e){}}}
  setInterval(rep,800);
  window.addEventListener('pagehide',rep);
  document.addEventListener('visibilitychange',rep);
})();<\/script>`;

PB.instrument = (html) =>
  html.indexOf("</body>") >= 0 ? html.replace("</body>", REPORTER + "</body>") : html + REPORTER;

/* ---------------- open / close hooks ---------------- */
PB.onOpenGame = (g) => { PB.current = g; sessionMax = null; renderGameBar(); };
PB.onCloseGame = () => { PB.current = null; };

/* ---------------- receive scores from the game iframe ---------------- */
window.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || d.__pb !== 1) return;
  const g = PB.current; if (!g) return;
  const s = +d.score; if (!isFinite(s)) return;
  if (sessionMax == null || s > sessionMax) {
    sessionMax = s;
    setLocalBest(g.id, s);
    renderGameBar();
    if (sb && session) saveCloud(g, s);
  }
});

/* ---------------- cloud: auth + scores ---------------- */
async function getCreateClient() {
  if (window.supabase && window.supabase.createClient) return window.supabase.createClient;
  try {
    return (await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm")).createClient;
  } catch {
    return (await import("https://esm.sh/@supabase/supabase-js@2")).createClient;
  }
}

async function initCloud() {
  if (!cloudEnabled) return;
  const createClient = await getCreateClient();
  sb = createClient(cfg.url.replace(/\/$/, ""), cfg.anonKey);
  const { data } = await sb.auth.getSession();
  applySession(data.session);
  sb.auth.onAuthStateChange((_e, s) => applySession(s));
}
function applySession(s) {
  session = s || null;
  username = s ? (s.user.user_metadata?.username || s.user.email) : null;
  renderAccount();
  renderGameBar();
}
async function saveCloud(g, s) {
  try {
    const uid = session.user.id;
    const { data: ex } = await sb.from("scores")
      .select("score").eq("user_id", uid).eq("game_id", g.id).maybeSingle();
    if (ex && ex.score >= s) return;
    await sb.from("scores").upsert(
      { user_id: uid, username, game_id: g.id, game_name: g.name, score: s, updated_at: new Date().toISOString() },
      { onConflict: "user_id,game_id" });
  } catch (err) { console.warn("[PB] save score failed", err); }
}
async function fetchBoard(gid) {
  try {
    const { data } = await sb.from("scores")
      .select("username,score").eq("game_id", gid).order("score", { ascending: false }).limit(10);
    return data || [];
  } catch { return []; }
}

/* ---------------- UI ---------------- */
function css() {
  const s = document.createElement("style");
  s.textContent = `
  .pb-acct{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:30px;border:2px solid #2a2a4a;background:#1a1a30;color:var(--text);font-weight:700;font-size:14px;cursor:pointer;font-family:'Nunito',sans-serif;white-space:nowrap}
  .pb-acct:hover{border-color:var(--accent2);color:var(--accent2)}
  .gbest{font-size:13px;color:var(--accent3);font-weight:700;margin-left:auto;white-space:nowrap}
  .gboard-btn{background:none;border:none;color:var(--text2);font-size:18px;cursor:pointer;padding:4px 8px}
  .gboard-btn:hover{color:var(--accent3)}
  .pb-modal{position:fixed;inset:0;background:rgba(0,0,0,.65);display:none;align-items:center;justify-content:center;z-index:3000;padding:18px}
  .pb-modal.open{display:flex}
  .pb-box{background:var(--card);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:26px 24px;width:340px;max-width:100%;font-family:'Nunito',sans-serif}
  .pb-box h3{margin:0 0 4px;font-family:'Fredoka',sans-serif;font-size:20px}
  .pb-tabs{display:flex;gap:8px;margin:14px 0}
  .pb-tab{flex:1;padding:8px;border-radius:10px;border:1px solid #2a2a4a;background:transparent;color:var(--text2);cursor:pointer;font-weight:700;font-size:13px}
  .pb-tab.active{background:var(--accent);border-color:var(--accent);color:#fff}
  .pb-box input{width:100%;background:#1a1a30;border:1px solid #2a2a4a;color:var(--text);border-radius:10px;padding:11px 12px;font-size:14px;margin-bottom:10px;font-family:'Nunito',sans-serif}
  .pb-go{width:100%;background:var(--accent);color:#fff;border:none;border-radius:10px;padding:12px;font-size:15px;font-weight:800;cursor:pointer}
  .pb-go:hover{filter:brightness(1.08)}
  .pb-msg{font-size:12.5px;margin-top:10px;min-height:16px}
  .pb-msg.err{color:#ff6b6b}.pb-msg.ok{color:var(--accent4)}
  .pb-x{float:right;background:none;border:none;color:var(--text2);font-size:20px;cursor:pointer;line-height:1}
  .pb-row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:14px}
  .pb-row .r{color:var(--text2);width:26px}.pb-row b{color:var(--accent3)}
  .pb-link{color:var(--accent2);cursor:pointer;font-size:12.5px}`;
  document.head.appendChild(s);
}

function modal(html) {
  const m = document.createElement("div");
  m.className = "pb-modal";
  m.innerHTML = `<div class="pb-box">${html}</div>`;
  m.addEventListener("click", (e) => { if (e.target === m) m.classList.remove("open"); });
  document.body.appendChild(m);
  return m;
}

let authModal, boardModal;
function renderAccount() {
  let btn = document.getElementById("pbAcct");
  if (!btn) {
    const host = document.querySelector(".header-right") || document.querySelector(".header-inner");
    btn = document.createElement("button");
    btn.id = "pbAcct"; btn.className = "pb-acct";
    btn.onclick = openAuth;
    host.appendChild(btn);
  }
  btn.innerHTML = session ? `👤 ${esc(username)}` : "👤 Sign in";
}

function openAuth() {
  if (session) {
    authModal.querySelector(".pb-box").innerHTML =
      `<button class="pb-x">&times;</button><h3>Signed in</h3>
       <p style="color:var(--text2);font-size:13px">as <b>${esc(username)}</b></p>
       <button class="pb-go" id="pbOut">Sign out</button>`;
    authModal.querySelector(".pb-x").onclick = () => authModal.classList.remove("open");
    authModal.querySelector("#pbOut").onclick = async () => { await sb.auth.signOut(); authModal.classList.remove("open"); };
    authModal.classList.add("open");
    return;
  }
  let mode = "in";
  const draw = () => {
    authModal.querySelector(".pb-box").innerHTML = `
      <button class="pb-x">&times;</button>
      <h3>PixelBreak</h3>
      <div class="pb-tabs">
        <button class="pb-tab ${mode==='in'?'active':''}" data-m="in">Sign in</button>
        <button class="pb-tab ${mode==='up'?'active':''}" data-m="up">Create account</button>
      </div>
      ${mode==='up'?'<input id="pbUser" placeholder="Username" maxlength="24" autocomplete="username">':''}
      <input id="pbEmail" type="email" placeholder="Email" autocomplete="email">
      <input id="pbPass" type="password" placeholder="Password (min 6)" autocomplete="current-password">
      <button class="pb-go">${mode==='up'?'Create account':'Sign in'}</button>
      <div class="pb-msg" id="pbMsg"></div>`;
    const box = authModal.querySelector(".pb-box");
    box.querySelector(".pb-x").onclick = () => authModal.classList.remove("open");
    box.querySelectorAll(".pb-tab").forEach((t) => t.onclick = () => { mode = t.dataset.m; draw(); });
    box.querySelector(".pb-go").onclick = submit;
  };
  const submit = async () => {
    const msg = document.getElementById("pbMsg");
    const email = val("pbEmail"), pass = val("pbPass");
    msg.className = "pb-msg";
    if (!email || pass.length < 6) { msg.className = "pb-msg err"; msg.textContent = "Enter an email and a 6+ char password."; return; }
    msg.textContent = "…";
    try {
      if (mode === "up") {
        const uname = val("pbUser") || email.split("@")[0];
        const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { username: uname } } });
        if (error) throw error;
        if (!data.session) { msg.className = "pb-msg ok"; msg.textContent = "Account created — check your email to confirm, then sign in."; return; }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
      }
      authModal.classList.remove("open");
    } catch (e) { msg.className = "pb-msg err"; msg.textContent = e.message || "Something went wrong."; }
  };
  draw();
  authModal.classList.add("open");
}

/* in-game bar: your best + leaderboard button */
function renderGameBar() {
  const gh = document.getElementById("gh");
  if (!gh) return;
  let best = document.getElementById("gbest");
  if (!best) {
    best = document.createElement("span"); best.id = "gbest"; best.className = "gbest";
    const cb = document.getElementById("cb");
    gh.insertBefore(best, cb);
    if (cloudEnabled) {
      const bb = document.createElement("button");
      bb.className = "gboard-btn"; bb.title = "Leaderboard"; bb.textContent = "🏆";
      bb.onclick = openBoard;
      gh.insertBefore(bb, cb);
    }
  }
  const g = PB.current;
  const b = g ? Math.max(localBest(g.id), sessionMax || 0) : 0;
  best.textContent = b > 0 ? "Your best: " + b : "";
}

async function openBoard() {
  const g = PB.current; if (!g) return;
  boardModal.querySelector(".pb-box").innerHTML =
    `<button class="pb-x">&times;</button><h3>🏆 ${esc(g.name)}</h3><div id="pbBoardList" style="margin-top:12px;color:var(--text2)">Loading…</div>`;
  boardModal.querySelector(".pb-x").onclick = () => boardModal.classList.remove("open");
  boardModal.classList.add("open");
  const rows = await fetchBoard(g.id);
  const list = document.getElementById("pbBoardList");
  if (!rows.length) {
    list.innerHTML = session
      ? "No scores yet — be the first!"
      : `No scores yet. <span class="pb-link" id="pbSignin">Sign in</span> to get on the board.`;
    const si = document.getElementById("pbSignin"); if (si) si.onclick = () => { boardModal.classList.remove("open"); openAuth(); };
    return;
  }
  list.innerHTML = rows.map((r, i) =>
    `<div class="pb-row"><span class="r">${i + 1}</span><span style="flex:1">${esc(r.username || "anon")}</span><b>${r.score}</b></div>`).join("");
}

/* ---------------- helpers ---------------- */
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const val = (id) => (document.getElementById(id)?.value || "").trim();

/* ---------------- boot ---------------- */
css();
authModal = modal("");
boardModal = modal("");
if (cloudEnabled) initCloud().catch((e) => console.warn("[PB] cloud init failed", e));
