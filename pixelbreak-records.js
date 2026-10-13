/* Arcade — accounts + high-score records.
 *
 * - Captures a score from each game via a small reporter injected into the game iframe
 *   (games broadcast their score with postMessage; we keep the max as that play's result).
 * - Always saves your best per game in localStorage (works logged-out, on-device).
 * - If Supabase is configured (pixelbreak-config.js) and you're signed in, it also syncs
 *   your best to the cloud and shows a global per-game leaderboard.
 *
 * The page calls: PB.chooseMode(game) (owner prompt: true = test, false = normal, null = cancelled),
 * PB.onOpenGame(game, {testMode}), PB.instrument(html), PB.onCloseGame().
 */
import * as auth from "./auth.js?v=32";
import { loadTags, tagsHtml } from "./leaderboard-tags.js?v=10";

import { compactScore, scoreHtml, scoreKeyHtml, arcadeText } from "./score-format.js?v=8";
import { loadWeekly, installWeeklyUi, weeklyHeadingHtml, weeklyRowsHtml } from "./arcade-weekly.js?v=8";

const cfg = window.PB_CONFIG || {};
const cloudEnabled = /^https:\/\/.+\.supabase\.co\/?$/.test((cfg.url || "").trim()) &&
                     (cfg.anonKey || "").trim().length > 20;

const PB = (window.PB = {});
PB.current = null;          // currently open game object {id,name,...}
let sessionBests = new Map();   // best score reported during this play, per board id
// Idle games raise their score every tick. Scores reach the cloud at most once a
// minute per board (immediately for the first one, a final one and on leaving),
// and the last known cloud score is cached so each sync is a single request.
const SCORE_SYNC_MS = 60_000;
const cloudBests = new Map();   // "userId:boardId" -> best score known in the cloud (null = none)
let pendingScores = new Map(), scoreTimer = null;
let activeBoard = null;         // sub-leaderboard chosen by the game (e.g. one per level), or null
const GAME_MESSAGE_KEYS = new Set(["__pb", "score", "final", "board", "run"]);
const BOARD_ID_PATTERN = /^[a-z0-9-]{1,48}$/;
let sb = null, session = null, username = null, sessionKnown = false;

/* ---------------- test mode (owner only) ----------------
 * The arcade owner is asked "Test mode or Normal?" whenever a game opens. In test mode the game gets
 * window.__pbTestMode=true before any of its scripts run, and this module guarantees that nothing the game does
 * reaches a leaderboard, a counter, the cloud or the real saved progress:
 *   - scores (scores, weekly runs, daily scores, streaks, Halloween progress) are dropped,
 *   - {__pbSave} goes to localStorage "pb_testsave_<gameId>" only (never pb_save_*, never game_saves),
 *   - {__pbWantSave} is not answered, so no cloud save is delivered,
 *   - the game bar shows a "TEST" badge instead of the best score. */
const OWNER_EMAIL = "konto@ian.lu";
const TEST_SAVE_PREFIX = "pb_testsave_";
const MODE_LAST_KEY = "pb_mode_last";          // last choice, used only as the default focus of the prompt
const TEST_TOKEN_KEY = "pb_testmode_game";     // sessionStorage: hands the choice to an href game page (see arcade-kit.js)
let testMode = false;
Object.defineProperty(PB, "testMode", { get: () => testMode, enumerable: true });
function setTestMode(on) {
  testMode = on === true;
  document.body?.classList.toggle("pb-test-mode", testMode);
}

/* ---------------- local best (always on) ---------------- */
function localBest(id) {
  try {
    const stored = localStorage.getItem("pb_best_" + id);
    if (stored === null) return null;
    const value = Number(stored);
    return Number.isFinite(value) ? value : null;
  } catch (error) {
    console.warn("[Arcade] local best read failed", { id, error });
    return null;
  }
}
function isBetter(g, value, previous) {
  return previous === null || previous === undefined || (g?.lowerIsBetter ? value < previous : value > previous);
}
function setLocalBest(g, value) {
  const previous = localBest(g.id);
  if (!isBetter(g, value, previous)) return false;
  try { localStorage.setItem("pb_best_" + g.id, String(value)); }
  catch (error) { console.warn("[Arcade] local best write failed", { id: g.id, error }); return false; }
  return true;
}

/* ---------------- boards: a game may keep several leaderboards (one per level) ----------------
 * The game names the active one through Arcade.setBoard({id,name,format}). Its id must be the game's own id or
 * start with it plus "-" (geometrydash, geometrydash-2 …), so a game can only ever write to its own boards. */
function ownsBoard(g, id) {
  return !!g && typeof id === "string" && BOARD_ID_PATTERN.test(id) && (id === g.id || id.startsWith(g.id + "-"));
}
function cleanBoard(g, board) {
  if (board === null) return null;
  if (!board || typeof board !== "object" || !ownsBoard(g, board.id)) return undefined;
  if (typeof board.name !== "string" || !board.name || board.name.length > 80) return undefined;
  return Object.freeze({ id: board.id, name: board.name, format: typeof board.format === "string" ? board.format : "" });
}
function activeGame() {
  const g = PB.current;
  if (!g) return null;
  return activeBoard ? { ...g, id: activeBoard.id, name: activeBoard.name, format: activeBoard.format } : g;
}
function setActiveBoard(board) {
  const g = PB.current;
  if (!g) return;
  const clean = cleanBoard(g, board);
  if (clean === undefined) { console.warn("[Arcade] ignored a leaderboard that is not this game's", board); return; }
  activeBoard = clean;
  renderGameBar();
}

/* Scores that need more than a bare number: the game names a format, we know how to print it. */
const SCORE_FORMATS = {
  // Geometry Dash: below 1000 a plain best %, from 1000 up a finished run (1000 + 999 - attempts).
  gd(score) {
    if (score < 1000) return score + " %";
    const attempts = 1999 - score;
    return score === 1000 ? "100 % · 999+ attempts" : "100 % · " + attempts + (attempts === 1 ? " attempt" : " attempts");
  },
};
function formatScore(g, score) {
  const format = SCORE_FORMATS[g?.format];
  return format ? format(score) : compactScore(score);
}

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

/* ---------------- sound + haptics shim injected into each game ----------------
 * Universal feedback with zero per-game edits: a short blip + vibration when the
 * score goes up. Continuously ticking scores (distance counters in driving games)
 * are detected by back-to-back increases and suppressed after the first blip. */
const SOUND = `<script>(function(){
  if(window.__pbSnd)return;window.__pbSnd=1;
  var muted=__PB_MUTED__,ac=null;
  function ctx(){if(!ac){try{ac=new (window.AudioContext||window.webkitAudioContext)()}catch(e){}}
    if(ac&&ac.state==='suspended')ac.resume();}
  document.addEventListener('pointerdown',ctx,{capture:true});
  document.addEventListener('keydown',ctx,{capture:true});
  function blip(){
    if(muted||!ac||ac.state!=='running')return;
    try{var o=ac.createOscillator(),g=ac.createGain();o.type='triangle';o.frequency.value=660;
    g.gain.setValueAtTime(0.07,ac.currentTime);g.gain.exponentialRampToValueAtTime(0.0001,ac.currentTime+0.09);
    o.connect(g);g.connect(ac.destination);o.start();o.stop(ac.currentTime+0.1);}catch(e){}
    if(navigator.vibrate)try{navigator.vibrate(12)}catch(e){}
  }
  var last=null,lastInc=0;
  function num(x){var n=parseInt(String(x).replace(/[^0-9-]/g,''),10);return isNaN(n)?null:n;}
  function read(){try{
    if(typeof window.score==='number'&&isFinite(window.score))return window.score;
    var el=document.querySelector('[id*="score" i]:not([id*="high" i]),[class*="score" i]:not([class*="high" i])');
    if(el){var n=num(el.textContent);if(n!=null)return n;}
  }catch(e){}return null;}
  setInterval(function(){
    var s=read();if(s==null)return;
    if(last!=null&&s>last){
      var t=Date.now();
      if(t-lastInc>700)blip();      // discrete scoring only, not a running counter
      lastInc=t;
    }
    last=s;
  },250);
  window.addEventListener('message',function(e){var d=e.data;if(d&&d.__pbSndMute!==undefined)muted=!!d.__pbSndMute;});
})();<\/script>`;

const isMuted = () => localStorage.getItem("pb_muted") === "1";

PB.instrument = (html) => {
  // Paket Express reports only completed shifts; DOM polling would submit free-drive points.
  const automaticFeedback = PB.current?.id === "paket-express" ? "" : REPORTER + SOUND.replace("__PB_MUTED__", isMuted() ? "true" : "false");
  // Test mode: the flag and the storage redirect come first, ahead of every other script of the game.
  let inject = testMode ? testModeInject(PB.current) : "";
  inject += `<script>window.addEventListener('message',function(event){
    if(event.source===parent&&event.data&&event.data.__pbStreak){
      window.__pbStreak=event.data.__pbStreak;
    }
  });<\/script>` + automaticFeedback;
  // hand the game its locally saved state (page must call onOpenGame BEFORE instrument)
  const g = PB.current;
  if (g) {
    inject += `<script>window.__pbHalloween=${halloweenVisible()};<\/script>`;
    if (window.__pbStreak && !testMode) inject += `<script>window.__pbStreak=${JSON.stringify(window.__pbStreak)};<\/script>`;
    const sv = localStorage.getItem((testMode ? TEST_SAVE_PREFIX : SAVE_PREFIX) + g.id);
    if (sv) inject += `<script>window.__pbSave=${sv.replace(/</g, "\\u003c")};<\/script>`;
  }
  return html.includes("<head>") ? html.replace("<head>", "<head>" + inject) : inject + html;
};

/* The script that puts a game frame into test mode: the flag, then the storage redirect (arcade-kit.js owns its source). */
function testModeInject(game) {
  const shim = window.Arcade?.testStorageShim;
  let inject = `<script>window.__pbTestMode=true;<\/script>`;
  if (typeof shim === "function" && game) inject += `<script>(${shim.toString()})(${JSON.stringify(game.id)});<\/script>`;
  else console.warn("[Arcade] test mode storage redirect unavailable");
  return inject;
}

/* ---------------- open / close hooks ---------------- */
PB.onOpenGame = (g, options = {}) => {
  flushScores();                          // the previous game's scores go out before the mode flips
  dismissModeDialog(null);
  setTestMode(options.testMode === true);
  PB.current = g; weeklyFinals = new Set(); touchStreak(); sessionBests = new Map(); activeBoard = null; renderGameBar(); loadCloudSave(g); loadEventStatus();
};
PB.onCloseGame = () => {
  dismissModeDialog(null);
  flushScores(); flushSave(); flushEvent(); netClose();
  PB.current = null; activeBoard = null; setTestMode(false); updateSaveHint();
};
PB.registerStandalone = (g) => {
  setTestMode(window.__pbTestMode === true);   // set by arcade-kit.js from the arcade's choice
  PB.current = g;
  weeklyFinals = new Set();
  touchStreak();
  sessionBests = new Map();
  activeBoard = null;
  const chosen = window.Arcade?.getBoard?.();   // the game may have picked a board before this module loaded
  if (chosen) activeBoard = cleanBoard(g, chosen) || null;
  renderGameBar();
};
// Saves reach the cloud on a 3 s debounce; leaving the page inside that window
// (closing the tab, swiping the PWA away) would otherwise drop them from the
// cloud copy. Best effort -- the local copy is always written synchronously.
window.addEventListener("pagehide", () => { flushScores(); if (pendingSave) flushSave(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "hidden") return; flushScores(); if (pendingSave) flushSave(); });

/* ---------------- game-state saves (progress, not just score) ----------------
 * Games post {__pbSave:1,data:{...}} → stored in localStorage always, and
 * upserted (debounced) to the game_saves table when signed in.
 * On open, the local save is injected inline; the cloud save is fetched and
 * delivered via {__pbLoadSave:1,data} — games keep whichever has more progress. */
const SAVE_PREFIX = "pb_save_";
let saveTimer = null, pendingSave = null, cloudSave;   // undefined = fetching, null = none

const MAX_MESSAGE_SIZE = 256 * 1024, MAX_SAVE_DEPTH = 32, MAX_SCORE = Number.MAX_SAFE_INTEGER;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function isGameMessage(e) {
  const frame = document.getElementById("gf");
  return !!frame?.contentWindow && e.source === frame.contentWindow && e.origin === location.origin && isObject(e.data);
}
function isSaveData(data) {
  const seen = new Set();
  let size = 0;
  const check = (value, depth) => {
    if (depth > MAX_SAVE_DEPTH || ++size > MAX_MESSAGE_SIZE) return false;
    if (value === null || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "string") { size += value.length; return size <= MAX_MESSAGE_SIZE; }
    if (typeof value !== "object" || seen.has(value)) return false;
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return false;
    if (Array.isArray(value) && value.length > MAX_MESSAGE_SIZE) return false;
    seen.add(value);
    return Object.entries(value).every(([key, v]) => {
      size += key.length;
      return size <= MAX_MESSAGE_SIZE && check(v, depth + 1);
    });
  };
  return isObject(data) && check(data, 0);
}

window.addEventListener("message", (e) => {
  if (!isGameMessage(e)) return;
  const d = e.data;
  const g = PB.current; if (!g) return;
  if (d.__pbSave === 1) {
    if (Object.keys(d).length !== 2 || !isSaveData(d.data)) return;
    const json = JSON.stringify(d.data);
    if (json.length > MAX_MESSAGE_SIZE) return;
    if (testMode) {   // test saves stay on this device under their own key: no pb_save_*, no game_saves
      try { localStorage.setItem(TEST_SAVE_PREFIX + g.id, json); } catch (e) { console.warn("[PB] test save failed", e); }
      return;
    }
    try { localStorage.setItem(SAVE_PREFIX + g.id, json); } catch (e) { console.warn("[PB] local save failed", e); }
    pendingSave = { g, data: d.data };
    // Keep the cached cloud copy current: a game that reloads inside the frame asks again ({__pbWantSave})
    // and must get its latest progress, not the copy fetched when it was opened (its saves would then be
    // older than the server's and silently rejected by the keep-progress trigger).
    if (cloudSave !== undefined) cloudSave = d.data;
    savingGameId = g.id;
    updateSaveHint();
    if (sb && session && !saveTimer) saveTimer = setTimeout(flushSave, 3000);
  }
  if (d && d.__pbWantSave === 1 && !testMode && cloudSave !== undefined) sendCloudSave();
  if (d.__pbEvent && !testMode && eventGame(g) && halloweenVisible() && fullAccount()) {
    const event = d.__pbEvent;
    if (event.event === HALLOWEEN_EVENT && Number.isSafeInteger(event.count) && event.count > 0 && event.count <= 5) {
      eventQueued += event.count;
      scheduleEventFlush();
    }
  }
  if (d && d.__pbRpc) rpcCall(d.__pbRpc);
  if (d && d.__pbNet) {
    const n = d.__pbNet;
    if (n.op === "open" && /^[a-z0-9]{4,10}$/.test(n.code || "") && (n.role === "host" || n.role === "guest"))
      netOpen(n.code, n.role);
    else if (n.op === "send") netSend(n.d);
    else if (n.op === "close") netClose();
  }
});

/* ---------------- database bridge (PB.rpc) ----------------
 * A game iframe cannot reach Supabase: the client and the auth session live out
 * here. Games post {__pbRpc:{id,fn,args}} and get {__pbRpcRes:{id,data,error}}
 * back. Only the functions named below can be called -- never proxy an
 * arbitrary name, or a game becomes a general-purpose database console. */
const RPC_WHITELIST = new Set([
  "park_gallery", "park_layout", "publish_park", "unpublish_park", "like_park",
  "submit_daily_score", "daily_board",
]);
// Writes (scores, publishing or liking a park) are refused in test mode; the read-only functions still work.
const TEST_MODE_BLOCKED_RPC = new Set(["submit_daily_score", "publish_park", "unpublish_park", "like_park"]);
const MAX_RPC_ARGS = 16;

function rpcPost(id, data, error) {
  const fr = document.getElementById("gf");
  try { fr.contentWindow.postMessage({ __pbRpcRes: { id, data, error } }, "*"); } catch {}
}

async function rpcCall(call) {
  const id = call && call.id;
  if (typeof id !== "number" && typeof id !== "string") return;
  if (!RPC_WHITELIST.has(call.fn)) { rpcPost(id, null, "forbidden"); return; }
  if (testMode && TEST_MODE_BLOCKED_RPC.has(call.fn)) { rpcPost(id, null, "test-mode"); return; }
  const args = call.args === undefined ? {} : call.args;
  if (!isObject(args) || Object.keys(args).length > MAX_RPC_ARGS || !isSaveData(args)) {
    rpcPost(id, null, "bad-args"); return;
  }
  if (["submit_daily_score", "daily_board"].includes(call.fn) && !fullAccount()) { rpcPost(id, null, "not signed in"); return; }
  if (!sb) { rpcPost(id, null, "offline"); return; }
  try {
    const { data, error } = await sb.rpc(call.fn, args);
    rpcPost(id, error ? null : data, error ? error.message : null);
  } catch (err) { rpcPost(id, null, String(err && err.message || err)); }
}

/* ---------------- online play relay (PB.net) ----------------
 * Games post {__pbNet:{op:'open',code,role}} / {op:'send',d} / {op:'close'}.
 * We hold a Supabase realtime channel pbn_<gameId>_<code>; peer broadcasts come
 * back into the iframe as {__pbNetMsg:{r,d}}, presence as {__pbNetPeers:{n,roles}},
 * subscribe success as {__pbNetUp:1}, failures as {__pbNetErr}. Works signed out —
 * realtime broadcast only needs the anon key, on a dedicated non-persisting client
 * so we never touch the shared auth client's socket or its 10 msg/s default cap. */
let netChan = null, netClient = null, netRole = null;

async function getNetClient() {
  if (netClient) return netClient;
  const createClient = await getCreateClient();
  netClient = createClient(cfg.url.replace(/\/$/, ""), cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 24 } },
  });
  return netClient;
}

function netPost(msg) {
  const fr = document.getElementById("gf");
  try { fr.contentWindow.postMessage(msg, "*"); } catch {}
}

async function netOpen(code, role) {
  netClose();
  if (!cloudEnabled) { netPost({ __pbNetErr: "offline" }); return; }
  const g = PB.current; if (!g) return;
  const client = await getNetClient();
  if (PB.current !== g) return;                      // game was closed while loading
  netRole = role;
  const ch = client.channel("pbn_" + g.id + "_" + code, {
    config: { presence: { key: role }, broadcast: { self: false } },
  });
  netChan = ch;
  ch.on("broadcast", { event: "d" }, (m) => netPost({ __pbNetMsg: m.payload }));
  ch.on("presence", { event: "sync" }, () => {
    const st = ch.presenceState();
    netPost({ __pbNetPeers: { n: Object.keys(st).length, roles: Object.keys(st) } });
  });
  ch.subscribe(async (status) => {
    if (status === "SUBSCRIBED") { try { await ch.track({ t: Date.now() }); } catch {} netPost({ __pbNetUp: 1 }); }
    else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") netPost({ __pbNetErr: status });
  });
}

function netSend(d) {
  if (!netChan || d === undefined) return;
  try { netChan.send({ type: "broadcast", event: "d", payload: { r: netRole, d } }); } catch {}
}

function netClose() {
  if (netChan) { try { netChan.unsubscribe(); } catch {} netChan = null; }
  netRole = null;
}

function sendCloudSave() {
  if (!cloudSave || !PB.current) return;
  const fr = document.getElementById("gf");
  try { fr.contentWindow.postMessage({ __pbLoadSave: 1, data: cloudSave }, "*"); } catch {}
}

async function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const p = pendingSave; pendingSave = null;
  if (!p || !sb || !session) return;
  try {
    const { error } = await sb.from("game_saves").upsert(
      { user_id: session.user.id, game_id: p.g.id, data: p.data, updated_at: new Date().toISOString() },
      { onConflict: "user_id,game_id" });
    if (error) throw error;
  } catch (err) {
    if (!pendingSave && PB.current === p.g) pendingSave = p;
    console.warn("[PB] save state failed", err);
  }
}

// Remote reload/close must also flush when the usual debounce already ran.
// Every validated __pbSave message writes localStorage before scheduling cloud work.
window.__pbFlushSave = async () => {
  const game = PB.current;
  if (!game || !sb || !session || testMode) return;
  if (pendingSave?.g !== game) {
    try {
      const json = localStorage.getItem(SAVE_PREFIX + game.id);
      const data = json ? JSON.parse(json) : null;
      if (json?.length <= MAX_MESSAGE_SIZE && isSaveData(data)) pendingSave = { g: game, data };
    } catch (error) { console.warn("[PB] remote save read failed", error); }
  }
  const board = activeGame();
  const scores = new Map(sessionBests);
  const best = localBest(board.id);
  if (!game.noScore && best !== null) scores.set(board.id, best);
  await Promise.all([
    flushScores(),
    flushSave(),
    ...Array.from(scores, ([id, score]) => saveCloud(id === board.id ? board : { ...game, id }, score)),
  ]);
};

async function loadCloudSave(g) {
  cloudSave = undefined;
  if (testMode || !sb || !session) { cloudSave = null; return; }
  try {
    const { data } = await sb.from("game_saves")
      .select("data").eq("user_id", session.user.id).eq("game_id", g.id).maybeSingle();
    // A slow response for a game the player has already left must not land in
    // cloudSave: the next game's {__pbWantSave} would be answered with it and
    // could adopt another game's progress as its own.
    if (PB.current !== g) return;
    cloudSave = (data && data.data) || null;
  } catch { if (PB.current === g) cloudSave = null; return; }
  sendCloudSave();
}

/* ---------------- receive scores from iframe or standalone games ---------------- */
function receiveScore(detail) {
  const base = PB.current;
  if (!base || base.noScore || testMode) return;   // test mode never counts
  let g = activeGame();
  if (detail?.board !== undefined) {   // a score tagged with its board: must be one this game owns
    if (!ownsBoard(base, detail.board)) { console.warn("[Arcade] ignored a score for a board this game does not own", detail.board); return; }
    g = detail.board === g.id ? g : { ...base, id: detail.board, name: base.name, format: activeBoard?.format || "" };
  }
  const score = detail?.score;
  if (!Number.isFinite(score) || Math.abs(score) > MAX_SCORE) return;
  if (detail.run !== undefined && (!Number.isSafeInteger(detail.run) || detail.run < 0)) return;
  if (detail.final === true) submitWeeklyRun(base, detail);
  if (!isBetter(g, score, sessionBests.has(g.id) ? sessionBests.get(g.id) : null)) return;
  sessionBests.set(g.id, score);
  setLocalBest(g, score);
  renderGameBar();
  if (sb && session) queueCloudScore(g, score, detail.final === true);
}
window.addEventListener("message", (e) => {
  if (!isGameMessage(e)) return;
  const d = e.data;
  if (d.__pbBoard === 1) { setActiveBoard(d.board); return; }
  if (d.__pb !== 1 || !Object.keys(d).every((key) => GAME_MESSAGE_KEYS.has(key))) return;
  receiveScore(d);
});
window.addEventListener("arcade:score", (event) => receiveScore(event.detail));
window.addEventListener("arcade:board", (event) => setActiveBoard(event.detail?.board ?? null));

/* ---------------- cloud: auth + scores ---------------- */
async function getCreateClient() {
  if (window.supabase && window.supabase.createClient) return window.supabase.createClient;
  try {
    return (await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/+esm")).createClient;
  } catch {
    return (await import("https://esm.sh/@supabase/supabase-js@2.117.1")).createClient;
  }
}

async function initCloud() {
  if (!cloudEnabled) return;
  sb = await auth.client();
  const { data } = await sb.auth.getSession();
  applySession(data.session);
  sb.auth.onAuthStateChange((_e, s) => applySession(s));
}
function applySession(s) {
  const previousUserId = session?.user?.id || null;
  session = s || null;
  sessionKnown = true;
  username = s ? (s.user.user_metadata?.username || s.user.email) : null;
  renderAccount();
  renderGameBar();
  updateSaveHint();
  // Signed in while a game is open (e.g. opened it signed out on a new device):
  // fetch that account's cloud save now, so the game adopts it instead of the
  // fresh local progress. The server also refuses saves with less progress.
  const userId = session?.user?.id || null;
  if (userId !== previousUserId) {
    delete window.__pbStreak;
    try { document.getElementById("gf")?.contentWindow?.postMessage({ __pbStreak: null }, location.origin); }
    catch (error) { console.warn("[Arcade] streak clear failed", error); }
    eventQueued = 0; eventStatus = null;
    if (eventTimer) clearTimeout(eventTimer);
    eventTimer = null;
    loadEventStatus();
  }
  if (userId && userId !== previousUserId && PB.current) loadCloudSave(PB.current);
  if (PB.current) touchStreak();
  loadWeeklyHome();
}
function queueCloudScore(g, s, isFinal) {
  if (testMode) return;
  pendingScores.set(g.id, { g, s });
  const isFirst = !cloudBests.has(`${session.user.id}:${g.id}`);
  if (isFinal || isFirst) { flushScores(); return; }
  if (!scoreTimer) scoreTimer = setTimeout(flushScores, SCORE_SYNC_MS);
}
function flushScores() {
  if (scoreTimer) { clearTimeout(scoreTimer); scoreTimer = null; }
  if (!pendingScores.size || !sb || !session) return Promise.resolve();
  const batch = [...pendingScores.values()];
  pendingScores = new Map();
  return Promise.all(batch.map(({ g, s }) => saveCloud(g, s)));
}
async function saveCloud(g, s) {
  if (testMode) return;
  try {
    const uid = session.user.id;
    const key = `${uid}:${g.id}`;
    if (!cloudBests.has(key)) {
      const { data: ex, error: readError } = await sb.from("scores")
        .select("score").eq("user_id", uid).eq("game_id", g.id).maybeSingle();
      if (readError && readError.code !== "PGRST116") throw readError;
      cloudBests.set(key, ex ? ex.score : null);
    }
    const known = cloudBests.get(key);
    if (known !== null && !isBetter(g, s, known)) return;
    cloudBests.set(key, s);   // the server keeps the better score if another device got further
    const { error } = await sb.from("scores").upsert(
      { user_id: uid, username, game_id: g.id, game_name: g.name, score: s, updated_at: new Date().toISOString() },
      { onConflict: "user_id,game_id" });
    if (error) { cloudBests.delete(key); throw error; }
  } catch (err) { console.warn("[PB] save score failed", err); }
}
async function fetchBoard(g) {
  try {
    const { data, error } = await sb.from("scores")
      .select("user_id,username,score").eq("game_id", g.id).order("score", { ascending: Boolean(g.lowerIsBetter) }).limit(10);
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.warn("[Arcade] leaderboard load failed", { id: g.id, error });
    return null;
  }
}

async function fetchBoardTags() {
  if (!sb || !session) return null;
  try {
    return await loadTags(sb);
  } catch (error) {
    console.warn("[Arcade] leaderboard tags unavailable", error);
    return null;
  }
}


/* ---------------- weekly runs and daily streak ---------------- */
let weeklyFinals = new Set();
const streakResults = new Map();
let homeWeekly = null;
const fullAccount = () => !!session && session.user.user_metadata?.account_kind !== "kart";

async function submitWeeklyRun(game, detail) {
  if (testMode || !sb || !fullAccount() || !Number.isSafeInteger(detail.score) || detail.score < 0) return;
  // Arcade supplies a run token. Retain the fallback for older cached game reporters.
  const key = `${session.user.id}:${game.id}:${detail.run ?? "legacy-" + detail.score}`;
  if (weeklyFinals.has(key)) return;
  weeklyFinals.add(key);
  const account = session;
  try {
    const weekly = await loadWeekly(sb, account);
    if (weekly?.gameId !== game.id || session?.user.id !== account.user.id) return;
    const { error } = await sb.rpc("submit_weekly_score", { p_game: game.id, p_score: detail.score });
    if (error) throw error;
  } catch (error) { console.warn("[Arcade] weekly score failed", error); }
}

function showStreakToast(copy) {
  document.getElementById("pbStreakToast")?.remove();
  const toast = document.createElement("div");
  toast.id = "pbStreakToast";
  toast.className = "pb-save-hint";
  toast.style.pointerEvents = "none";
  toast.setAttribute("role", "status");
  toast.textContent = copy;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function sendStreak() {
  if (!window.__pbStreak || !PB.current || testMode) return;
  try { document.getElementById("gf")?.contentWindow?.postMessage({ __pbStreak: window.__pbStreak }, location.origin); }
  catch (error) { console.warn("[Arcade] streak delivery failed", error); }
}

async function touchStreak() {
  if (testMode || !sb || !fullAccount() || !PB.current) return;
  const userId = session.user.id;
  if (streakResults.has(userId)) {
    const cached = streakResults.get(userId);
    if (cached) { window.__pbStreak = cached; sendStreak(); }
    return;
  }
  streakResults.set(userId, null);
  try {
    const { data, error } = await sb.rpc("touch_streak");
    if (error) throw error;
    if (!data || !Number.isFinite(data.streak) || !Number.isFinite(data.best)) throw new Error("Invalid streak result");
    const result = Object.freeze({ streak: data.streak, best: data.best });
    streakResults.set(userId, result);
    if (session?.user.id !== userId) return;
    window.__pbStreak = result;
    sendStreak();
    if (data.is_new_day) showStreakToast(arcadeText(data.streak === 1 && data.best > 1 ? "arc.streakNew" : "arc.streakDay", { n: data.streak }));
  } catch (error) {
    console.warn("[Arcade] streak unavailable", error);
    showStreakToast(arcadeText("arc.streakError"));
  }
}

document.getElementById("gf")?.addEventListener("load", sendStreak);

function renderWeeklyHome() {
  const card = document.getElementById("weeklyCard");
  if (!card || !homeWeekly) return;
  const joined = fullAccount();
  card.innerHTML = weeklyHeadingHtml(homeWeekly) + (joined ? weeklyRowsHtml(homeWeekly, 5) : `<p>${esc(arcadeText("arc.weeklySignin"))}</p>`) +
    `<button type="button" class="ui-btn ui-btn--primary weekly-play">${esc(arcadeText("arc.weeklyPlay"))}</button>`;
  card.querySelector(".weekly-play").onclick = () => {
    const game = window.arcadeGameById?.(homeWeekly.gameId);
    if (game) window.openGame(window.arcadeGameIndex?.(game.id));
  };
  card.hidden = false;
  window.__pbWeeklyGame = homeWeekly.gameId;
  window.applyFilters?.();
}

async function loadWeeklyHome() {
  const card = document.getElementById("weeklyCard");
  if (!card || !sb) return;
  const account = session;
  try {
    installWeeklyUi();
    const weekly = await loadWeekly(sb, account);
    if (session?.user.id !== account?.user.id) return;
    if (weekly && !window.arcadeGameById?.(weekly.gameId)) throw new Error("Unknown weekly game: " + weekly.gameId);
    homeWeekly = weekly;
    card.hidden = !weekly;
    renderWeeklyHome();
  } catch (error) {
    card.hidden = true;
    console.warn("[Arcade] weekly card unavailable", error);
  }
}
document.addEventListener("i18n:change", renderWeeklyHome);

/* ---------------- UI ---------------- */
function css() {
  const s = document.createElement("style");
  s.textContent = `
  .pb-acct{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:30px;border:2px solid var(--border);background:var(--card2);color:var(--text);font-weight:700;font-size:14px;cursor:pointer;font-family:'Nunito',sans-serif;white-space:nowrap}
  .pb-acct:hover{border-color:var(--accent2);color:var(--accent2)}
  .pb-modal{position:fixed;inset:0;background:rgba(0,0,0,.65);display:none;align-items:center;justify-content:center;z-index:3000;padding:18px}
  .pb-modal.open{display:flex}
  .pb-box{background:var(--card);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:26px 24px;width:340px;max-width:100%;font-family:'Nunito',sans-serif}
  .pb-box h3{margin:0 0 4px;font-family:'Fredoka',sans-serif;font-size:20px}
  .pb-tabs{display:flex;gap:8px;margin:14px 0}
  .pb-tab{flex:1;padding:8px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-weight:700;font-size:13px}
  .pb-tab.active{background:var(--accent);border-color:var(--accent);color:#fff}
  .pb-box input{width:100%;background:var(--card2);border:1px solid var(--border);color:var(--text);border-radius:10px;padding:11px 12px;font-size:14px;margin-bottom:10px;font-family:'Nunito',sans-serif}
  .pb-go{width:100%;background:var(--accent);color:#fff;border:none;border-radius:10px;padding:12px;font-size:15px;font-weight:800;cursor:pointer}
  .pb-go:hover{filter:brightness(1.08)}
  .pb-msg{font-size:12.5px;margin-top:10px;min-height:16px}
  .pb-msg.err{color:#ff6b6b}.pb-msg.ok{color:var(--accent4)}
  .pb-x{float:right;background:none;border:none;color:var(--text2);font-size:20px;cursor:pointer;line-height:1}
  .pb-row{display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:14px}
  .pb-row .r{width:26px;flex:none;color:var(--text2)}.pb-row .pb-name{min-width:0;flex:1;overflow-wrap:anywhere}.pb-row b{flex:none;margin-left:6px;color:var(--accent3);text-align:right;font-variant-numeric:tabular-nums;max-width:45%;min-width:0}
  .pb-link{color:var(--accent2);cursor:pointer;font-size:12.5px}
  .pb-save-hint{position:fixed;left:50%;bottom:max(14px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2500;display:flex;align-items:center;gap:10px;width:max-content;max-width:calc(100vw - 24px);padding:8px 8px 8px 14px;border-radius:14px;background:var(--card,#161625);color:var(--text,#e8e8f0);border:1px solid var(--border,rgba(255,255,255,.14));box-shadow:0 10px 30px rgba(0,0,0,.4);font:600 13.5px/1.35 'Nunito',system-ui,sans-serif}
  .pb-save-hint__go{flex:none;min-height:40px;padding:0 14px;border:0;border-radius:10px;background:var(--accent,#6c5ce7);color:#fff;font:inherit;font-weight:800;cursor:pointer}
  .pb-mode{z-index:3100}
  .pb-mode__box{text-align:center}
  .pb-mode__box h3{margin-bottom:2px}
  .pb-mode__ask{margin:0 0 14px;color:var(--text2,#9a9ab8);font-size:14px}
  .pb-mode__box .pb-go{display:block;width:100%;margin:0 0 8px;min-height:46px;font-family:inherit}
  .pb-mode__box .pb-go kbd{margin-left:6px;padding:1px 6px;border-radius:6px;background:rgba(255,255,255,.2);font:700 11px/1.4 inherit;vertical-align:1px}
  .pb-mode__box .pb-mode__test{background:transparent;color:var(--text,#e8e8f0);box-shadow:inset 0 0 0 2px #ffcc00}
  .pb-mode__box .pb-mode__test kbd{background:rgba(255,204,0,.22)}
  .pb-mode__box .pb-go:focus-visible,.pb-mode__back:focus-visible{outline:3px solid var(--accent2,#4de8ff);outline-offset:2px}
  .pb-mode__note{margin:2px 0 12px;font-size:12.5px;line-height:1.4;color:var(--text2,#9a9ab8)}
  .pb-mode__back{display:inline-block;min-height:44px;padding:0 12px;background:none;border:0;font:inherit;font-size:13px}
  .pb-save-hint__x{flex:none;min-width:40px;min-height:40px;border:0;background:none;color:var(--text2,#9a9ab8);font-size:20px;cursor:pointer}`;
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
    if (!host) return;
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
      <h3>Arcade</h3>
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

/* Shared in-game bar: back, title, best, leaderboard, restart, mute. */
let mountedGameBar = null;
function renderGameBar() {
  const gh = document.getElementById("gh");
  const g = PB.current;
  if (gh && g && window.Arcade) {
    mountedGameBar = window.Arcade.mountBar({
      host: gh,
      title: g.name,
      noScore: g.noScore || !cloudEnabled,
      badge: testMode,
      restart: true,
      onBack: (event) => { event.preventDefault(); window.closeGame?.(); },
      onLeaderboard: openBoard,
      onRestart: () => {
        try { document.getElementById("gf")?.contentWindow?.postMessage({ __pbCommand: "restart" }, "*"); }
        catch (error) { console.warn("[Arcade] restart message failed", error); }
      },
      onMute: (muted) => {
        try { document.getElementById("gf")?.contentWindow?.postMessage({ __pbSndMute: muted }, "*"); }
        catch (error) { console.warn("[Arcade] mute message failed", error); }
      },
    });
  }
  renderEventChip();
  const best = mountedGameBar?.best || document.getElementById("arcadeBest");
  const shown = activeGame();
  if (!best || !shown || shown.noScore) return;
  if (testMode) { best.textContent = ""; return; }   // a test play has no best
  const stored = localBest(shown.id);
  const sessionBest = sessionBests.has(shown.id) ? sessionBests.get(shown.id) : null;
  const value = sessionBest !== null && isBetter(shown, sessionBest, stored) ? sessionBest : stored;
  best.innerHTML = value === null ? "" : "Best: " + (SCORE_FORMATS[shown.format] ? esc(formatScore(shown, value)) : scoreHtml(value));
}

/* Halloween preview affects the visuals; the server decides whether catches count. */
const HALLOWEEN_EVENT = "halloween-2026", EVENT_FLUSH_MS = 6000, EVENT_BATCH_MAX = 5;
let eventStatus = null, eventQueued = 0, eventTimer = null, eventBusy = false, eventLastCall = 0;
function halloweenVisible() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Luxembourg", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const date = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const day = `${date.year}-${date.month}-${date.day}`;
  return new URLSearchParams(location.search).get("halloween") === "1" || (day >= "2026-10-24" && day <= "2026-11-02");
}
function eventGame(game) { return game?.id === "cookie-clicker" || game?.id === "idle-empire" || game?.id === "bus-tycoon"; }
function renderEventChip() {
  const host = document.getElementById("gh");
  document.getElementById("pbEventChip")?.remove();
  const banner = document.getElementById("halloweenBanner");
  if (banner) { banner.hidden = !halloweenVisible(); banner.textContent = arcadeText("arc.halloweenBanner"); }
  if (!host || testMode || !eventGame(PB.current) || !halloweenVisible() || (fullAccount() && eventStatus?.active === false && new URLSearchParams(location.search).get("halloween") !== "1")) return;
  const chip = document.createElement("div");
  chip.id = "pbEventChip"; chip.className = "arcade-context"; chip.setAttribute("role", "status");
  chip.textContent = fullAccount() ? `🎃 ${eventStatus?.count ?? 0} / ${eventStatus?.goal ?? 50}` : arcadeText("arc.halloweenSignin");
  host.append(chip);
}
async function loadEventStatus() {
  renderEventChip();
  if (!sb || !fullAccount() || !halloweenVisible()) return;
  const userId = session.user.id;
  try {
    const { data, error } = await sb.rpc("event_status", { p_event: HALLOWEEN_EVENT });
    if (error) throw error;
    if (session?.user?.id !== userId) return;
    eventStatus = data; renderEventChip();
  } catch (error) { console.warn("[Arcade] event status unavailable", error); }
}
function scheduleEventFlush() {
  if (eventTimer || eventBusy || !eventQueued) return;
  eventTimer = setTimeout(() => { eventTimer = null; flushEvent(); }, Math.max(0, EVENT_FLUSH_MS - (Date.now() - eventLastCall)));
}
async function flushEvent() {
  if (!eventQueued || eventBusy || !sb || !fullAccount()) return;
  if (Date.now() - eventLastCall < EVENT_FLUSH_MS) { scheduleEventFlush(); return; }
  if (eventTimer) clearTimeout(eventTimer);
  eventTimer = null;
  const count = Math.min(EVENT_BATCH_MAX, eventQueued), userId = session.user.id;
  eventQueued -= count; eventBusy = true; eventLastCall = Date.now();
  try {
    const { data, error } = await sb.rpc("add_event_progress", { p_event: HALLOWEEN_EVENT, p_count: count });
    if (error) throw error;
    if (session?.user?.id !== userId) return;
    if (data?.badge && !eventStatus?.badge) showStreakToast(arcadeText("arc.halloweenEarned"));
    eventStatus = data; renderEventChip();
  } catch (error) {
    if (session?.user?.id === userId) eventQueued += count;
    console.warn("[Arcade] event progress failed", error);
  } finally { eventBusy = false; scheduleEventFlush(); }
}
document.addEventListener("i18n:change", renderEventChip);
window.addEventListener("pagehide", flushEvent);
document.addEventListener("DOMContentLoaded", renderEventChip);

async function openBoard() {
  const g = activeGame(); if (!g || g.noScore) return;
  boardModal.querySelector(".pb-box").innerHTML =
    `<button class="pb-x">&times;</button><h3>🏆 ${esc(g.name)}</h3><div id="pbBoardList" style="margin-top:12px;color:var(--text2)">Loading…</div>`;
  boardModal.querySelector(".pb-x").onclick = () => boardModal.classList.remove("open");
  boardModal.classList.add("open");
  const [rows, tagData] = await Promise.all([fetchBoard(g), fetchBoardTags()]);
  const list = document.getElementById("pbBoardList");
  if (!list) return;
  if (rows === null) {
    list.textContent = "Leaderboard unavailable right now. Please try again.";
    return;
  }
  if (!rows.length) {
    list.innerHTML = session
      ? "No scores yet — be the first!"
      : `No scores yet. <span class="pb-link" id="pbSignin">Sign in</span> to get on the board.`;
    const si = document.getElementById("pbSignin"); if (si) si.onclick = () => { boardModal.classList.remove("open"); openAuth(); };
    return;
  }
  const visibleTagData = session ? tagData : null;
  list.innerHTML = rows.map((r, i) => boardRowHtml(g, r, i, visibleTagData)).join("") +
    (SCORE_FORMATS[g.format] ? "" : scoreKeyHtml(rows.map((row) => row.score)));
}
PB.openBoard = openBoard;

/* ---------------- mode prompt: Test mode or Normal (owner only) ---------------- */
const MODE_COPY = Object.freeze({
  lb: Object.freeze({ ask: "Wéi wëlls du spillen?", normal: "Normal spillen", test: "🧪 Test-Modus", back: "‹ Zréck",
    note: "Alles fräigeschalt, zielt net fir d'Leaderboard, däi richtege Spillstand bleift onberéiert." }),
  de: Object.freeze({ ask: "Wie möchtest du spielen?", normal: "Normal spielen", test: "🧪 Test-Modus", back: "‹ Zurück",
    note: "Alles freigeschaltet, zählt nicht fürs Leaderboard, dein echter Spielstand bleibt unberührt." }),
  en: Object.freeze({ ask: "How do you want to play?", normal: "Play normally", test: "🧪 Test mode", back: "‹ Back",
    note: "Everything unlocked, doesn't count for any leaderboard, your real progress stays untouched." }),
});
let modeDialog = null;   // { el, game, resolve, cleanup }

/* The arcade owner is the account signed in as OWNER_EMAIL. The live session wins; until it has loaded, the session
 * Supabase stored on this device answers (same approach as the owner preview in pixelbreak.html). */
function storedSessionEmail() {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!/^sb-.+-auth-token$/.test(key)) continue;
      return JSON.parse(localStorage.getItem(key) || "null")?.user?.email || "";
    }
  } catch (error) { console.warn("[Arcade] stored session unreadable", error); }
  return "";
}
PB.isOwner = () => String((sessionKnown ? session?.user?.email : storedSessionEmail()) || "").toLowerCase() === OWNER_EMAIL;

function lastMode() {
  try { return localStorage.getItem(MODE_LAST_KEY) === "test" ? "test" : "normal"; }
  catch (error) { console.warn("[Arcade] last mode unreadable", error); return "normal"; }
}

function dismissModeDialog(result) {
  const dialog = modeDialog;
  if (!dialog) return;
  modeDialog = null;
  dialog.cleanup();
  dialog.resolve(result);
}

/* Resolves true = test mode, false = normal, null = cancelled (Back or Escape). Non-owners resolve false at once. */
function askMode(game) {
  dismissModeDialog(null);
  return new Promise((resolve) => {
    const copy = MODE_COPY[hintLanguage()];
    const opener = document.activeElement;
    const el = document.createElement("div");
    el.className = "pb-modal open pb-mode";
    el.innerHTML = `<div class="pb-box pb-mode__box" role="dialog" aria-modal="true" aria-labelledby="pbModeT" aria-describedby="pbModeN">
      <h3 id="pbModeT">${esc(game.name)}</h3>
      <p class="pb-mode__ask">${esc(copy.ask)}</p>
      <button type="button" class="pb-go pb-mode__normal" data-mode="normal">${esc(copy.normal)} <kbd>Enter</kbd></button>
      <button type="button" class="pb-go pb-mode__test" data-mode="test">${esc(copy.test)} <kbd>T</kbd></button>
      <p class="pb-mode__note" id="pbModeN">${esc(copy.note)}</p>
      <button type="button" class="pb-link pb-mode__back" data-mode="back">${esc(copy.back)}</button>
    </div>`;
    const buttons = [...el.querySelectorAll("button")];
    const choose = (mode) => {
      if (mode === "back") { dismissModeDialog(null); opener?.isConnected && opener.focus?.(); return; }
      try { localStorage.setItem(MODE_LAST_KEY, mode); } catch (error) { console.warn("[Arcade] last mode not saved", error); }
      dismissModeDialog(mode === "test");
    };
    const onClick = (event) => {
      const button = event.target.closest("button[data-mode]");
      if (!button) return;
      choose(button.dataset.mode);
    };
    const onKey = (event) => {
      // Enter held down on the game card repeats into the dialog: only a fresh press may choose.
      if (event.repeat && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); return; }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); choose("back"); return; }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "t" || event.key === "T") { event.preventDefault(); event.stopPropagation(); choose("test"); return; }
      if (event.key === "n" || event.key === "N") { event.preventDefault(); event.stopPropagation(); choose("normal"); return; }
      if (event.key === "Tab") {   // keep focus inside the dialog
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        else if (!el.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      }
    };
    el.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey, true);
    document.body.appendChild(el);
    const preferred = el.querySelector(lastMode() === "test" ? ".pb-mode__test" : ".pb-mode__normal");
    preferred.focus();
    modeDialog = {
      game, resolve,
      cleanup() { window.removeEventListener("keydown", onKey, true); el.remove(); },
    };
  });
}

PB.chooseMode = (game) => (game && PB.isOwner() ? askMode(game) : Promise.resolve(false));
PB.setStandaloneTest = (id, on) => {
  try {
    if (on) sessionStorage.setItem(TEST_TOKEN_KEY, id);
    else sessionStorage.removeItem(TEST_TOKEN_KEY);
  } catch (error) { console.warn("[Arcade] test mode hand-over failed", error); }
};
// Back on the hub: a hand-over token from an earlier href game must not outlive its visit.
if (document.getElementById("gf")) PB.setStandaloneTest("", false);

/* ---------------- sign-in hint ----------------
 * A game that saves progress while nobody is signed in keeps it on this device
 * only, so a player on a new device sees 0 and thinks it is gone. Say so. */
const SAVE_HINT_TEXT = Object.freeze({
  lb: Object.freeze({ msg: "Mell dech un, fir däi Spillstand ze lueden an op all Apparat ze späicheren.", go: "Umellen" }),
  de: Object.freeze({ msg: "Melde dich an, um deinen Spielstand zu laden und auf allen Geräten zu speichern.", go: "Anmelden" }),
  en: Object.freeze({ msg: "Sign in to load your progress and keep it on every device.", go: "Sign in" }),
});
let saveHintDismissed = false;
let savingGameId = null;   // the open game has posted a progress save

function hintLanguage() {
  const langs = ["lb", "de", "en"];
  if (langs.includes(window.I18N?.lang)) return window.I18N.lang;
  try {
    const saved = localStorage.getItem("site_lang");
    if (langs.includes(saved)) return saved;
  } catch (error) {
    console.warn("[Arcade] hint language", error);
  }
  return "lb";
}

function updateSaveHint() {
  const show = cloudEnabled && !session && !!PB.current && PB.current.id === savingGameId && !saveHintDismissed;
  let hint = document.getElementById("pbSaveHint");
  if (!show) { hint?.remove(); return; }
  if (hint) return;
  const copy = SAVE_HINT_TEXT[hintLanguage()];
  hint = document.createElement("div");
  hint.id = "pbSaveHint";
  hint.className = "pb-save-hint";
  hint.setAttribute("role", "status");
  hint.innerHTML = `<span>💾 ${esc(copy.msg)}</span><button type="button" class="pb-save-hint__go">${esc(copy.go)}</button><button type="button" class="pb-save-hint__x" aria-label="OK">&times;</button>`;
  hint.querySelector(".pb-save-hint__go").onclick = () => openAuth();
  hint.querySelector(".pb-save-hint__x").onclick = () => { saveHintDismissed = true; hint.remove(); };
  document.body.appendChild(hint);
}

/* ---------------- helpers ---------------- */

function boardRowHtml(g, row, index, tagData) {
  const tagRow = tagData?.byUserId?.[row.user_id];
  const tagMarkup = tagRow ? tagsHtml(tagRow) : "";
  return `<div class="pb-row"><span class="r">${index + 1}</span><span class="pb-name">${esc(row.username || "anon")}${tagMarkup}</span><b>${SCORE_FORMATS[g.format] ? esc(formatScore(g, row.score)) : scoreHtml(row.score)}</b></div>`;
}


const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const val = (id) => (document.getElementById(id)?.value || "").trim();

/* ---------------- boot ---------------- */
css();
authModal = modal("");
boardModal = modal("");
if (cloudEnabled) initCloud().catch((e) => console.warn("[PB] cloud init failed", e));
