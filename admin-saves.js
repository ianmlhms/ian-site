/* Admin tab "Saves": look at a player's cloud saves, the save history, restore an old state and gift
 * cash / cookies / passengers to an idle game. Everything is admin-only on the server (is_admin()).
 *
 * Data comes from four RPCs, each only when the admin asks for it (never on a timer):
 *   admin_find_users(p_query)            username search
 *   admin_user_saves(p_user, p_game)     games + presence (+ the live save of p_game)
 *   admin_game_save_history(p_user, p_game)
 *   admin_restore_game_save(p_id) / admin_gift_idle(p_user, p_game, p_amount)
 * The only repeated calls are the ones of the "close their game first" helper while it waits for the
 * player to leave the game (small admin_user_saves answers, every few seconds, at most 10 minutes). */
import { at, esc, label, ago, fmtDateTime, fmtNum, parseAmount } from "./admin-texts.js?v=1";

const NEED_IDLE_S = 90;       // the cloud save must not have changed for this long
const PAGE_GRACE_S = 180;     // presence on the game page counts for this long after the last ping
const COMMAND_MINUTES = 15;   // how long the close_game command stays valid
const MAX_AMOUNT = 1e30;
const GIFT_GAMES = new Set(["idle-empire", "cookie-clicker", "bus-tycoon"]);
const GAME_NAMES = { "idle-empire": "Business Empire", "cookie-clicker": "Cookie Clicker", "bus-tycoon": "Bus Tycoon", "train-sim": "Train Sim", "paket-express": "Paket Express", "drive-mad": "Drive Mad", "kart-letzebuerg": "Kart Lëtzebuerg", "chill-drive": "Chill Drive", "crossy-road": "Crossy Road", towerdefense: "Tower Defense", burger: "Burger" };
const NOISE_KEYS = new Set(["v", "savedAt", "ts", "rs", "ud", "gd", "sc"]);
const params = new URLSearchParams(location.search);
// test hooks (the flows speed the waiting up); normal use keeps the defaults
const POLL_MS = Number(params.get("pollms")) || 5000;
const WAIT_TIMEOUT_MS = Number(params.get("waitms")) || 10 * 60_000;

export const gameName = (id) => GAME_NAMES[id] || String(id).replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

/* ---------- save summaries ---------- */
const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const sumValues = (object) => (object && typeof object === "object" ? Object.values(object).reduce((total, value) => total + (num(value) ?? 0), 0) : null);
const countTrue = (object) => (object && typeof object === "object" ? Object.values(object).filter(Boolean).length : null);
const countItems = (value) => (Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : null);
const metric = (id, textKey, value) => ({ id, label: at(textKey), value });

/* The key numbers of a save: [{ id, label, value }]. Known idle games get named fields, everything else the
 * top-level numbers (and sizes of lists / objects). */
export function summarize(gameId, data) {
  if (!data || typeof data !== "object") return [];
  let list;
  if (gameId === "idle-empire") {
    list = [metric("cash", "m.cash", num(data.cash)), metric("lifetime", "m.lifetime", num(data.lifetime)), metric("investors", "m.investors", num(data.investors)),
      metric("st", "m.stars", num(data.st)), metric("rbc", "m.rebirths", num(data.rbc)), metric("owned", "m.owned", sumValues(data.owned)), metric("managers", "m.managers", countTrue(data.managers))];
  } else if (gameId === "cookie-clicker") {
    list = [metric("tb", "m.baked", num(data.tb)), metric("c", "m.cookies", num(data.c)), metric("st", "m.stars", num(data.st)), metric("rbc", "m.rebirths", num(data.rbc)),
      metric("tc", "m.clicks", num(data.tc)), metric("u", "m.buildings", Array.isArray(data.u) ? data.u.reduce((total, value) => total + (num(value) ?? 0), 0) : null)];
  } else if (gameId === "bus-tycoon") {
    list = [metric("p", "m.passengers", num(data.p)), metric("tb", "m.lifetime", num(data.tb)), metric("st", "m.stars", num(data.st)), metric("rbc", "m.rebirths", num(data.rbc)),
      metric("drivers", "m.drivers", num(data.drivers)), metric("owned", "m.owned", sumValues(data.owned)), metric("upgrades", "m.upgrades", countItems(data.upgrades))];
  } else {
    const numbers = Object.entries(data).filter(([key, value]) => !NOISE_KEYS.has(key) && num(value) !== null).slice(0, 8)
      .map(([key, value]) => ({ id: key, label: key, value }));
    const sizes = Object.entries(data).filter(([, value]) => value && typeof value === "object").slice(0, 4)
      .map(([key, value]) => ({ id: `#${key}`, label: key, value: countItems(value) }));
    list = [...numbers, ...sizes];
  }
  return list.filter((entry) => entry.value !== null);
}

/* history state vs live state → what is lower / higher in the live save */
export function diffAgainstLive(historySummary, liveSummary) {
  const liveById = new Map(liveSummary.map((entry) => [entry.id, entry]));
  const lower = [];
  const higher = [];
  for (const entry of historySummary) {
    const current = liveById.get(entry.id);
    const liveValue = current ? current.value : 0;
    const tolerance = Math.max(Math.abs(entry.value), Math.abs(liveValue)) * 1e-9;
    if (liveValue < entry.value - tolerance) lower.push({ label: entry.label, history: entry.value, live: liveValue });
    else if (liveValue > entry.value + tolerance) higher.push({ label: entry.label, history: entry.value, live: liveValue });
  }
  return { lower, higher, same: !lower.length && !higher.length };
}

/* ---------- is the player out of the game? ---------- */
function pageIsGame(page, game) {
  try {
    const url = new URL(String(page || ""), "https://ian.lu");
    return url.pathname === "/pixelbreak.html" && url.searchParams.get("g") === game;
  } catch { return false; }
}

export function assessQuiet(data, game) {
  const nowMs = Date.parse(data?.now);
  const updated = Date.parse(data?.live?.updated_at);
  const idleS = Number.isFinite(updated) && Number.isFinite(nowMs) ? Math.max(0, (nowMs - updated) / 1000) : Infinity;
  const seen = Date.parse(data?.presence?.last_seen);
  const seenS = Number.isFinite(seen) && Number.isFinite(nowMs) ? (nowMs - seen) / 1000 : Infinity;
  const onGame = pageIsGame(data?.presence?.page, game) && seenS <= PAGE_GRACE_S;
  return { idleS, onGame, quiet: idleS >= NEED_IDLE_S && !onGame };
}

const sleep = (ms, signal) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});

const errorText = (error) => {
  const message = String(error?.message || error || "");
  if (/not idle/i.test(message)) return at("saves.err.notIdle");
  if (/game page/i.test(message)) return at("saves.err.onPage");
  return message || at("common.unknown");
};

export function mountSaves(host, { getClient, pageLabel }) {
  const state = {
    query: "", results: null, searching: false, searchFailed: false,
    user: null, games: null, game: null, live: null, presence: null, serverNow: null, history: [],
    loading: false, failed: false, notice: null, generation: 0, giftText: "",
  };
  const dialog = document.createElement("dialog");
  dialog.className = "sv-dialog";
  dialog.setAttribute("aria-labelledby", "svDialogTitle");
  document.body.appendChild(dialog);

  /* ---------------- data ---------------- */
  async function searchUsers() {
    const query = state.query.trim();
    state.searchFailed = false;
    if (!query) { state.results = null; renderSearch(); return; }
    state.searching = true;
    renderSearch();
    try {
      const sb = await getClient();
      const { data, error } = await sb.rpc("admin_find_users", { p_query: query });
      if (error) throw error;
      state.results = Array.isArray(data) ? data : [];
    } catch (error) {
      console.error("[admin] user search failed", error);
      state.searchFailed = true;
    } finally {
      state.searching = false;
      renderSearch();
    }
  }

  async function loadUser(id, name, keepGame = null) {
    const generation = ++state.generation;
    state.user = { id, username: name || "" };
    state.games = null; state.game = null; state.live = null; state.presence = null; state.history = [];
    state.failed = false; state.loading = true; state.notice = null;
    render();
    try {
      const sb = await getClient();
      const { data, error } = await sb.rpc("admin_user_saves", { p_user: id });
      if (error) throw error;
      if (generation !== state.generation) return;
      state.user = data?.user ? { ...data.user } : { id, username: name || "" };
      state.games = Array.isArray(data?.games) ? data.games : [];
      state.presence = data?.presence || null;
      state.serverNow = data?.now || null;
      state.loading = false;
      const pick = keepGame && state.games.some((game) => game.game_id === keepGame) ? keepGame : state.games.length === 1 ? state.games[0].game_id : null;
      if (pick) { await loadGame(pick, generation); return; }
    } catch (error) {
      console.error("[admin] user saves failed to load", error);
      if (generation !== state.generation) return;
      state.failed = true;
    }
    state.loading = false;
    render();
  }

  async function loadGame(gameId, generation = ++state.generation) {
    state.game = gameId; state.live = null; state.history = []; state.failed = false; state.loading = true;
    render();
    try {
      const sb = await getClient();
      const [saves, history] = await Promise.all([
        sb.rpc("admin_user_saves", { p_user: state.user.id, p_game: gameId }),
        sb.rpc("admin_game_save_history", { p_user: state.user.id, p_game: gameId }),
      ]);
      if (saves.error) throw saves.error;
      if (history.error) throw history.error;
      if (generation !== state.generation) return;
      state.live = saves.data?.live || null;
      state.presence = saves.data?.presence || null;
      state.serverNow = saves.data?.now || null;
      state.games = Array.isArray(saves.data?.games) ? saves.data.games : state.games;
      state.history = Array.isArray(history.data) ? history.data : [];
    } catch (error) {
      console.error("[admin] game save failed to load", error);
      if (generation !== state.generation) return;
      state.failed = true;
    }
    state.loading = false;
    render();
  }

  const reload = () => (state.user ? loadUser(state.user.id, state.user.username, state.game) : Promise.resolve());

  /* ---------------- rendering ---------------- */
  const metricsHtml = (list) => (list.length
    ? list.map((entry) => `<span class="sv-metric">${esc(entry.label)} <b>${esc(fmtNum(entry.value))}</b></span>`).join("")
    : `<span class="muted">—</span>`);

  function diffHtml(row, liveSummary) {
    if (!state.live) return `<div class="sv-diff muted">${esc(at("saves.noLiveToCompare"))}</div>`;
    const diff = diffAgainstLive(summarize(row.game_id, row.data), liveSummary);
    if (diff.same) return `<div class="sv-diff muted">${esc(at("saves.sameAsLive"))}</div>`;
    const part = (cls, textKey, items) => (items.length
      ? `<div class="sv-diff-line ${cls}"><span>${esc(at(textKey))}</span> ${items.map((item) => `${esc(item.label)} ${esc(fmtNum(item.history))} → <b>${esc(fmtNum(item.live))}</b>`).join(" · ")}</div>` : "");
    return `<div class="sv-diff"><span class="muted">${esc(at("saves.vsLive"))}</span>${part("lower", "saves.liveLower", diff.lower)}${part("higher", "saves.liveHigher", diff.higher)}</div>`;
  }

  function historyRowHtml(row, liveSummary) {
    const summary = summarize(row.game_id, row.data);
    return `<li class="sv-row" data-history="${esc(row.id)}">
      <div class="sv-row-h"><b>${esc(fmtDateTime(row.recorded_at))}</b>
        <span class="sv-reason r-${esc(row.reason)}">${esc(label("saves.reason", row.reason))}</span>
        <span class="muted">${esc(at("saves.stateFrom"))} ${esc(fmtDateTime(row.saved_at))} · ${esc(row.size_bytes ?? "?")} B</span></div>
      <div class="sv-metrics">${metricsHtml(summary)}</div>
      ${diffHtml(row, liveSummary)}
      <div class="sv-row-a">
        <button type="button" class="wide-btn" data-restore="${esc(row.id)}">♻️ ${esc(at("saves.restore"))}</button>
        <details><summary>${esc(at("saves.raw"))}</summary><pre>${esc(JSON.stringify(row.data, null, 1))}</pre></details>
      </div></li>`;
  }

  function presenceHtml() {
    if (!state.presence) return `<span class="muted">${esc(at("saves.presenceNone"))}</span>`;
    const nowMs = Date.parse(state.serverNow) || Date.now();
    const onGame = state.game && pageIsGame(state.presence.page, state.game);
    return `${esc(at("saves.presenceOn", { page: pageLabel(state.presence.page), ago: ago(state.presence.last_seen, nowMs) }))}${onGame ? ` <span class="sv-reason r-live">${esc(at("saves.onGame"))}</span>` : ""}`;
  }

  function giftHtml() {
    if (!state.live || !GIFT_GAMES.has(state.game)) return "";
    const what = at(`what.${state.game}`);
    return `<div class="sv-card"><h3>${esc(at("saves.gift"))}</h3>
      <form class="wide-filters" id="svGiftForm">
        <label class="wide-field"><span>${esc(at("saves.giftAmount", { what }))}</span><input id="svGiftAmount" value="${esc(state.giftText)}" inputmode="decimal" autocomplete="off" spellcheck="false"></label>
        <button type="submit" class="wide-btn">${esc(at("saves.giftBtn"))}</button>
      </form>
      <div class="sv-hint">${esc(at("saves.giftAmountHint"))}</div>
      <div class="sv-gift-err" id="svGiftErr" role="alert"></div></div>`;
  }

  function gameDetailHtml() {
    const liveSummary = state.live ? summarize(state.game, state.live.data) : [];
    return `<div class="sv-card"><h3>${esc(at("saves.live"))} · ${esc(gameName(state.game))}</h3>
        ${state.live
    ? `<div class="sv-metrics">${metricsHtml(liveSummary)}</div>
           <div class="muted">${esc(at("saves.updated"))}: ${esc(fmtDateTime(state.live.updated_at))} (${esc(ago(state.live.updated_at, Date.parse(state.serverNow) || Date.now()))})</div>`
    : `<div class="muted">${esc(at("saves.noLive"))}</div>`}
        <div class="sv-presence"><b>${esc(at("saves.presence"))}:</b> ${presenceHtml()}</div></div>
      ${giftHtml()}
      <div class="sv-card"><h3>${esc(at("saves.history"))}</h3>
        ${state.history.length ? `<ul class="sv-history">${state.history.map((row) => historyRowHtml(row, liveSummary)).join("")}</ul>` : `<div class="muted">${esc(at("saves.noHistory"))}</div>`}</div>`;
  }

  function userHtml() {
    if (!state.user) return "";
    const games = state.games;
    return `<div class="sv-user"><div class="sv-user-h"><span class="sv-avatar" aria-hidden="true">${esc(state.user.avatar || "👤")}</span>
        <b>${esc(state.user.username || "?")}</b>${state.user.class ? ` <span class="muted">${esc(state.user.class)}</span>` : ""}
        <span class="spacer"></span>
        <button type="button" class="wide-btn" data-saves-refresh${state.loading ? " disabled" : ""}>${esc(at("common.refresh"))}</button></div>
      ${state.loading && !games ? `<div class="wide-note" role="status">${esc(at("common.loading"))}</div>` : ""}
      ${state.failed ? `<div class="wide-note bad" role="alert">${esc(at("saves.error"))}</div>` : ""}
      ${games && !games.length ? `<div class="wide-note">${esc(at("saves.noGames"))}</div>` : ""}
      ${games && games.length ? `<div class="sv-games" role="group" aria-label="${esc(at("saves.pickGame"))}">${games.map((game) => `<button type="button" class="sv-game${game.game_id === state.game ? " active" : ""}" data-game="${esc(game.game_id)}" aria-pressed="${game.game_id === state.game}">${esc(gameName(game.game_id))}<span class="muted"> · ${esc(game.history_count)}</span></button>`).join("")}</div>` : ""}
      ${state.notice ? `<div class="wide-note ${state.notice.kind}" role="status">${esc(state.notice.text)}</div>` : ""}
      ${state.game && !state.failed && (state.live || state.history.length || !state.loading) ? gameDetailHtml() : ""}
      ${state.loading && state.game ? `<div class="wide-note" role="status">${esc(at("common.loading"))}</div>` : ""}</div>`;
  }

  function resultsHtml() {
    if (state.searching) return `<div class="wide-note" role="status">${esc(at("common.loading"))}</div>`;
    if (state.searchFailed) return `<div class="wide-note bad" role="alert">${esc(at("saves.error"))}</div>`;
    if (state.results === null) return "";
    if (!state.results.length) return `<div class="wide-note">${esc(at("saves.noUsers"))}</div>`;
    return `<ul class="sv-results">${state.results.map((user) => `<li><button type="button" class="sv-result" data-user="${esc(user.user_id)}" data-name="${esc(user.username)}">
        <span class="sv-avatar" aria-hidden="true">${esc(user.avatar || "👤")}</span><b>${esc(user.username)}</b>
        ${user.class ? `<span class="muted">${esc(user.class)}</span>` : ""}${user.account_kind === "kart" ? ` <span class="kart-tag">🏁 Kart</span>` : ""}
        <span class="muted"> · ${esc(user.save_games === 1 ? at("saves.games1") : at("saves.games", { n: user.save_games }))}</span></button></li>`).join("")}</ul>`;
  }

  function renderSearch() {
    const results = host.querySelector("#svResults");
    if (results) results.innerHTML = resultsHtml();
    const button = host.querySelector("#svSearchBtn");
    if (button) button.disabled = state.searching;
  }

  function render() {
    host.innerHTML = `<section class="wide-section" aria-label="${esc(at("saves.title"))}">
      <div class="wide-bar"><h2>${esc(at("saves.title"))}</h2></div>
      <form class="wide-filters" id="svSearchForm" role="search">
        <label class="wide-field stretch"><span class="sr-only">${esc(at("saves.search"))}</span><input id="svSearch" type="search" value="${esc(state.query)}" placeholder="${esc(at("saves.search"))}" aria-label="${esc(at("saves.search"))}" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
        <button type="submit" class="wide-btn" id="svSearchBtn">${esc(at("saves.searchBtn"))}</button>
      </form>
      <div id="svResults">${resultsHtml()}</div>
      ${userHtml()}</section>`;
  }

  /* ---------------- dialog + helper ---------------- */
  function openDialog({ title, bodyText, caveat, nowLabel, perform, successText }) {
    let abort = null;
    let running = false;
    dialog.innerHTML = `<form method="dialog" class="sv-dialog-body">
      <h3 id="svDialogTitle">${esc(title)}</h3>
      <p>${esc(bodyText)}</p>
      <p class="sv-caveat">${esc(caveat)}</p>
      <div class="sv-progress" id="svProgress" role="status" aria-live="polite"></div>
      <div class="sv-dialog-a">
        <button type="button" class="wide-btn primary" id="svCloseFirst">${esc(at("saves.closeFirst"))}</button>
        <button type="button" class="wide-btn" id="svNow">${esc(nowLabel)}</button>
        <button type="button" class="wide-btn ghost" id="svCancel">${esc(at("common.cancel"))}</button>
      </div></form>`;
    const $ = (id) => dialog.querySelector(id);
    const progress = $("#svProgress");
    const setProgress = (html, kind = "") => { progress.className = `sv-progress ${kind}`; progress.innerHTML = html; };
    const setBusy = (busy) => { $("#svCloseFirst").disabled = busy; $("#svNow").disabled = busy; };
    const finish = (kind, text) => {
      setProgress(`<span>${esc(text)}</span>`, kind);
      const actions = $(".sv-dialog-a");
      actions.innerHTML = `<button type="button" class="wide-btn primary" id="svDone">${esc(at("common.close"))}</button>`;
      actions.querySelector("#svDone").addEventListener("click", () => dialog.close());
      actions.querySelector("#svDone").focus();
    };
    const run = async (closeFirst) => {
      if (running) return;
      running = true;
      abort = new AbortController();
      setBusy(true);
      $("#svCancel").textContent = closeFirst ? at("saves.stopWaiting") : at("common.cancel");
      try {
        if (closeFirst) {
          const outcome = await waitUntilQuiet(abort.signal, setProgress);
          if (outcome !== "quiet") { running = false; setBusy(false); $("#svCancel").textContent = at("common.cancel"); setProgress(`<span>${esc(at(outcome === "timeout" ? "saves.wait.timeout" : "saves.wait.cancelled"))}</span>`, outcome === "timeout" ? "bad" : ""); return; }
        }
        const result = await perform();
        running = false;
        finish("good", successText(result));
        await reload();
        state.notice = { kind: "good", text: successText(result) };
        render();
      } catch (error) {
        console.error("[admin] save action failed", error);
        running = false;
        finish("bad", `${errorText(error)}`);
      }
    };
    $("#svCloseFirst").addEventListener("click", () => void run(true));
    $("#svNow").addEventListener("click", () => void run(false));
    $("#svCancel").addEventListener("click", () => {
      if (running) abort?.abort(); else dialog.close();
    });
    dialog.onclose = () => abort?.abort();
    dialog.oncancel = (event) => { if (running) { event.preventDefault(); abort?.abort(); } };
    dialog.showModal();
    $("#svCloseFirst").focus();
  }

  /* close_game command, then wait until the cloud save is idle and the player is off the game page */
  async function waitUntilQuiet(signal, setProgress) {
    const sb = await getClient();
    const userId = state.user.id;
    const game = state.game;
    const read = async () => {
      const { data, error } = await sb.rpc("admin_user_saves", { p_user: userId, p_game: game });
      if (error) throw error;
      return assessQuiet(data, game);
    };
    const show = (status, lead) => setProgress(`<div>${lead ? `${esc(lead)}<br>` : ""}${esc(at("saves.wait.idle", { s: Number.isFinite(status.idleS) ? Math.min(NEED_IDLE_S, Math.floor(status.idleS)) : NEED_IDLE_S, need: NEED_IDLE_S }))}
      <progress max="${NEED_IDLE_S}" value="${Number.isFinite(status.idleS) ? Math.min(NEED_IDLE_S, Math.floor(status.idleS)) : NEED_IDLE_S}"></progress><br>
      ${esc(at(status.onGame ? "saves.wait.onPage" : "saves.wait.offPage"))}</div>`);
    let status = await read();
    if (status.quiet) { show(status, at("saves.wait.quiet")); return "quiet"; }
    const { error } = await sb.rpc("issue_client_command", { p_action: "close_game", p_user: userId, p_game: game, p_reason: null, p_minutes: COMMAND_MINUTES });
    if (error) throw new Error(at("saves.wait.cmdFail"));
    show(status, at("saves.wait.start"));
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    while (!signal.aborted) {
      await sleep(POLL_MS, signal);
      if (signal.aborted) break;
      status = await read();
      show(status, at("saves.wait.start"));
      if (status.quiet) return "quiet";
      if (Date.now() > deadline) return "timeout";
    }
    return "cancelled";
  }

  function startRestore(historyId) {
    const row = state.history.find((item) => String(item.id) === String(historyId));
    if (!row) return;
    openDialog({
      title: at("saves.restoreTitle"),
      bodyText: at("saves.restoreBody", { game: gameName(state.game), user: state.user.username, when: fmtDateTime(row.recorded_at), summary: summarize(row.game_id, row.data).map((entry) => `${entry.label} ${fmtNum(entry.value)}`).join(", ") }),
      caveat: at("saves.caveat"),
      nowLabel: at("saves.restoreNow"),
      perform: async () => {
        const sb = await getClient();
        const { error } = await sb.rpc("admin_restore_game_save", { p_id: row.id });
        if (error) throw error;
      },
      successText: () => at("saves.restored"),
    });
  }

  function startGift(amount) {
    const what = at(`what.${state.game}`);
    const data = state.live?.data || {};
    const base = num(state.game === "idle-empire" ? data.lifetime : data.tb) ?? 0;
    const bump = Math.max(1e4, base * 0.001);
    const user = state.user.username;
    const game = state.game;
    openDialog({
      title: at("saves.giftTitle"),
      bodyText: at("saves.giftBody", { user, amount: fmtNum(amount), what, game: gameName(game), lifetime: fmtNum(base), bump: fmtNum(bump) }),
      caveat: at("saves.giftCaveat"),
      nowLabel: at("saves.giftNow"),
      perform: async () => {
        const sb = await getClient();
        const { data: result, error } = await sb.rpc("admin_gift_idle", { p_user: state.user.id, p_game: game, p_amount: amount });
        if (error) throw error;
        return result;
      },
      successText: (result) => at("saves.gifted", { what, before: fmtNum(Number(result?.before)), after: fmtNum(Number(result?.after)) }),
    });
  }

  /* ---------------- events ---------------- */
  host.addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.target.id === "svSearchForm") {
      state.query = host.querySelector("#svSearch").value;
      void searchUsers();
    } else if (event.target.id === "svGiftForm") {
      state.giftText = host.querySelector("#svGiftAmount").value;
      const amount = parseAmount(state.giftText);
      const errorBox = host.querySelector("#svGiftErr");
      if (amount === null || !(amount > 0) || amount > MAX_AMOUNT) { errorBox.textContent = at("saves.giftBad"); return; }
      errorBox.textContent = "";
      startGift(amount);
    }
  });
  host.addEventListener("input", (event) => {
    if (event.target.id === "svSearch") state.query = event.target.value;
    else if (event.target.id === "svGiftAmount") state.giftText = event.target.value;
  });
  host.addEventListener("click", (event) => {
    const result = event.target.closest?.("[data-user]");
    if (result) { void loadUser(result.dataset.user, result.dataset.name); return; }
    const game = event.target.closest?.("[data-game]");
    if (game) { void loadGame(game.dataset.game); return; }
    const restore = event.target.closest?.("[data-restore]");
    if (restore) { startRestore(restore.dataset.restore); return; }
    if (event.target.closest?.("[data-saves-refresh]")) void reload();
  });

  return {
    show() { if (!host.firstChild) render(); },
    hide() { if (dialog.open) dialog.close(); },
    /* deep link from the Kart tab */
    openUser(id, name) { state.query = name || ""; state.results = null; void loadUser(id, name); },
    relabel() { render(); },
  };
}
