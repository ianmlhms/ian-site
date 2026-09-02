import {
  duelMarkup,
  finishedMarkup,
  homeMarkup,
  standingsMarkup,
  swipeMarkup,
} from "./fotovote-render.js?v=1";

const BATCH_SIZE = 12;
const PRELOAD_AHEAD = 3;
const REFILL_AT = 4;
const DUEL_TARGET = 200;
const STANDINGS_LIMIT = 300;
const BUCKET = "fotovote";

const $ = (id) => document.getElementById(id);

let sb = null;
let refillPromise = null;
let state = {
  me: null,
  view: "home",
  swipeQueue: [],
  swipeHistory: [],
  duel: null,
  isBusy: false,
};

function setState(patch) {
  state = { ...state, ...patch };
}

function setMessage(message = "") {
  $("msg").textContent = message;
}

function report(error, message) {
  console.warn("[fotovote]", error);
  setMessage(message);
}

async function callRpc(name, args, message) {
  try {
    const { data, error } = await sb.rpc(name, args);
    if (error) {
      report(error, message);
      return { ok: false, data: null };
    }
    return { ok: true, data };
  } catch (error) {
    report(error, message);
    return { ok: false, data: null };
  }
}

function readToken() {
  const url = new URL(window.location.href);
  if (url.searchParams.has("k")) {
    const token = (url.searchParams.get("k") || "").trim();
    try {
      localStorage.setItem("fotovote_token", token);
    } catch (error) {
      console.warn("[fotovote]", error);
    }
    url.searchParams.delete("k");
    history.replaceState({}, "", url.pathname + url.search + url.hash);
    return token;
  }
  try {
    return (localStorage.getItem("fotovote_token") || "").trim();
  } catch (error) {
    console.warn("[fotovote]", error);
    return "";
  }
}

function photoUrl(path) {
  if (/^https:\/\//.test(path || "")) return path;
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return data?.publicUrl || "";
}

function preload(paths) {
  paths.filter(Boolean).forEach((path) => {
    const image = new Image();
    image.src = photoUrl(path);
  });
}

function showScreen(html, isWide = false) {
  $("app").className = isWide ? "wrap wide" : "wrap";
  $("screen").innerHTML = html;
}

function showGate() {
  $("gateMsg").textContent = "🔒 Du brauchs däi perséinleche Link.";
  $("bar").hidden = true;
  $("app").hidden = true;
  $("gateWrap").hidden = false;
}

function showApp() {
  $("gateWrap").hidden = true;
  $("bar").hidden = false;
  $("app").hidden = false;
  $("who").textContent = state.me.name;
}

async function loadMe(token) {
  const result = await callRpc(
    "pv_me",
    { p_token: token },
    "D'Donnéeë konnten net geluede ginn.",
  );
  const me = result.data?.[0];
  if (!result.ok || !me) return false;
  setState({ me: {
    ...me,
    total: Number(me.total),
    swiped: Number(me.swiped),
    kept: Number(me.kept),
    survivors: Number(me.survivors),
    my_duels: Number(me.my_duels),
  } });
  return true;
}

function progressPercent() {
  if (!state.me.total) return 100;
  return Math.min(100, Math.round(
    100 * state.me.swiped / state.me.total,
  ));
}

function showHome() {
  setState({ view: "home" });
  setMessage();
  const me = state.me;
  showScreen(homeMarkup(me, progressPercent()));
  $("swipeBtn").onclick = openSwipe;
  $("duelBtn").onclick = openDuel;
  if (me.is_owner) $("standingsBtn").onclick = openStandings;
}

async function requestSwipeBatch() {
  const result = await callRpc(
    "pv_next_swipe",
    { p_token: token, p_n: BATCH_SIZE },
    "D'Fotoe konnten net geluede ginn.",
  );
  if (!result.ok) return false;
  const known = new Set(state.swipeQueue.map((photo) => photo.id));
  const additions = (result.data || []).filter(
    (photo) => !known.has(photo.id),
  );
  setState({ swipeQueue: [...state.swipeQueue, ...additions] });
  return true;
}

function refillSwipes() {
  if (refillPromise) return refillPromise;
  refillPromise = requestSwipeBatch().finally(() => {
    refillPromise = null;
  });
  return refillPromise;
}

function renderSwipe() {
  const photo = state.swipeQueue[0];
  if (!photo) {
    if (state.me.swiped >= state.me.total) showSwipeFinished();
    else showScreen('<div class="card gate">Fotoe gi gelueden…</div>');
    return;
  }
  preload(state.swipeQueue.slice(1, PRELOAD_AHEAD + 1)
    .map((next) => next.storage_path));
  showScreen(swipeMarkup(
    photo, state.me, state.swipeHistory.length > 0,
    photoUrl(photo.storage_path),
  ), true);
  $("overviewBtn").onclick = returnHome;
  $("skipBtn").onclick = () => saveSwipe(false);
  $("keepBtn").onclick = () => saveSwipe(true);
  $("undoBtn").onclick = undoSwipe;
}

async function openSwipe() {
  setState({ view: "swipe", swipeQueue: [],
    swipeHistory: [], isBusy: false });
  setMessage();
  showScreen('<div class="card gate">Fotoe gi gelueden…</div>');
  const ok = await refillSwipes();
  if (ok) renderSwipe();
}

async function saveSwipe(keep) {
  const photo = state.swipeQueue[0];
  if (!photo || state.isBusy) return;
  setState({ isBusy: true });
  document.querySelectorAll("#screen button").forEach(
    (button) => { button.disabled = true; },
  );
  const result = await callRpc(
    "pv_swipe",
    { p_token: token, p_photo: photo.id, p_keep: keep },
    "Deng Stëmm konnt net gespäichert ginn.",
  );
  if (!result.ok) {
    setState({ isBusy: false });
    renderSwipe();
    return;
  }
  setState({
    swipeQueue: state.swipeQueue.slice(1),
    swipeHistory: [...state.swipeHistory, { photo, keep }],
    me: { ...state.me, swiped: state.me.swiped + 1,
      kept: state.me.kept + (keep ? 1 : 0) },
    isBusy: false,
  });
  if (state.me.swiped >= state.me.total) {
    await loadMe(token);
    showSwipeFinished();
    return;
  }
  renderSwipe();
  if (!state.swipeQueue.length) {
    await refillSwipes();
    if (state.view === "swipe") renderSwipe();
  } else if (state.swipeQueue.length <= REFILL_AT) {
    void refillSwipes().then(() => {
      if (state.view === "swipe") renderSwipe();
    });
  }
}

async function undoSwipe() {
  const last = state.swipeHistory.at(-1);
  if (!last || state.isBusy) return;
  setState({ isBusy: true });
  const result = await callRpc(
    "pv_unswipe",
    { p_token: token, p_photo: last.photo.id },
    "D'Zréckgoe konnt net gespäichert ginn.",
  );
  if (!result.ok) {
    setState({ isBusy: false });
    return;
  }
  const otherPhotos = state.swipeQueue.filter(
    (photo) => photo.id !== last.photo.id,
  );
  setState({
    swipeQueue: [last.photo, ...otherPhotos],
    swipeHistory: state.swipeHistory.slice(0, -1),
    me: { ...state.me, swiped: state.me.swiped - 1,
      kept: state.me.kept - (last.keep ? 1 : 0) },
    isBusy: false,
  });
  setMessage();
  renderSwipe();
}

function showSwipeFinished() {
  showScreen(finishedMarkup(state.swipeHistory.length > 0));
  $("finishedDuel").onclick = openDuel;
  $("finishedUndo").onclick = undoSwipe;
}

function duelTargetText() {
  if (state.me.my_duels >= DUEL_TARGET) return "genuch ✓";
  return `${DUEL_TARGET - state.me.my_duels} bis zum Zil`;
}

function renderDuel() {
  const pair = state.duel;
  if (!pair) return;
  showScreen(duelMarkup(
    pair, photoUrl(pair.a_path), photoUrl(pair.b_path),
    state.me.my_duels, duelTargetText(),
  ), true);
  $("overviewBtn").onclick = returnHome;
  $("pickA").onclick = () => saveDuel(pair.a_id);
  $("pickB").onclick = () => saveDuel(pair.b_id);
}

async function loadDuel() {
  showScreen('<div class="card gate">Nächsten Duell gëtt gelueden…</div>');
  const result = await callRpc(
    "pv_next_duel",
    { p_token: token },
    "Den Duell konnt net geluede ginn.",
  );
  if (!result.ok) return;
  const pair = result.data?.[0] || null;
  setState({ duel: pair, isBusy: false });
  if (!pair) {
    showScreen(`<div class="card gate"><h2>Keen Duell fräi</h2>
      <p>Et gëtt elo kee passenden neie Foto-Puer.</p>
      <button class="btn secondary" id="overviewBtn">Iwwersiicht</button></div>`);
    $("overviewBtn").onclick = returnHome;
    return;
  }
  preload([pair.a_path, pair.b_path]);
  renderDuel();
}

async function openDuel() {
  if (state.me.swiped < state.me.total) return;
  setState({ view: "duel", duel: null, isBusy: false });
  setMessage();
  await loadDuel();
}

async function saveDuel(winnerId) {
  const pair = state.duel;
  if (!pair || state.isBusy) return;
  setState({ isBusy: true });
  document.querySelectorAll(".duel-pick").forEach(
    (button) => { button.disabled = true; },
  );
  const result = await callRpc(
    "pv_duel",
    { p_token: token, p_a: pair.a_id,
      p_b: pair.b_id, p_winner: winnerId },
    "Den Duell konnt net gespäichert ginn.",
  );
  if (!result.ok) {
    setState({ isBusy: false });
    renderDuel();
    return;
  }
  setState({ me: { ...state.me,
    my_duels: state.me.my_duels + 1 }, duel: null });
  await loadDuel();
}

async function openStandings() {
  if (!state.me.is_owner) return;
  setState({ view: "standings" });
  setMessage();
  showScreen('<div class="card gate">Ranglëscht gëtt gelueden…</div>');
  const result = await callRpc(
    "pv_standings",
    { p_token: token, p_limit: STANDINGS_LIMIT },
    "D'Ranglëscht konnt net geluede ginn.",
  );
  if (!result.ok) return;
  showScreen(standingsMarkup(
    result.data || [], (row) => photoUrl(row.thumb_path),
  ), true);
  $("overviewBtn").onclick = returnHome;
}

async function returnHome() {
  const ok = await loadMe(token);
  if (ok) showHome();
}

function handleKeyboard(event) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (state.view === "swipe" && event.key === "ArrowLeft") {
    event.preventDefault();
    void saveSwipe(false);
  } else if (state.view === "swipe" && event.key === "ArrowRight") {
    event.preventDefault();
    void saveSwipe(true);
  } else if (state.view === "duel" && event.key === "ArrowLeft") {
    event.preventDefault();
    void saveDuel(state.duel?.a_id);
  } else if (state.view === "duel" && event.key === "ArrowRight") {
    event.preventDefault();
    void saveDuel(state.duel?.b_id);
  }
}

const token = readToken();
document.addEventListener("keydown", handleKeyboard);

(async () => {
  if (!token) {
    showGate();
    return;
  }
  sb = window.supabase.createClient(
    window.PB_CONFIG.url,
    window.PB_CONFIG.anonKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const ok = await loadMe(token);
  if (!ok) {
    showGate();
    return;
  }
  showApp();
  showHome();
})();
