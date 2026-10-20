/* Admin tab "Kart": the latest online races of Kart Lëtzebuerg (RPC admin_kart_races, admin only).
 * Loads when the tab is opened and on the Refresh button, never on a timer. Paging = a bigger p_limit. */
import { at, esc, label, fmtDay, fmtTime, fmtRaceTime, localDayKey } from "./admin-texts.js?v=1";

const PAGE_SIZE = 25;
const MAX_LIMIT = 500;

export function mountKart(host, { getClient, openSaves }) {
  const state = { limit: PAGE_SIZE, races: [], loaded: false, loading: false, failed: false, name: "", day: "", open: new Set(), generation: 0 };

  host.addEventListener("click", (event) => {
    const toggle = event.target.closest?.("[data-race-toggle]");
    if (toggle) {
      const id = toggle.dataset.raceToggle;
      if (state.open.has(id)) state.open.delete(id); else state.open.add(id);
      renderList();
      host.querySelector(`[data-race-toggle="${CSS.escape(id)}"]`)?.focus();
      return;
    }
    const userButton = event.target.closest?.("[data-open-saves]");
    if (userButton) { openSaves(userButton.dataset.openSaves, userButton.dataset.name || ""); return; }
    if (event.target.closest?.("[data-kart-refresh]")) { void load(); return; }
    if (event.target.closest?.("[data-kart-more]")) { state.limit = Math.min(MAX_LIMIT, state.limit + PAGE_SIZE * 2); void load(); return; }
    if (event.target.closest?.("[data-kart-clear]")) { state.name = ""; state.day = ""; render(); }
  });
  host.addEventListener("input", (event) => {
    if (event.target.id === "kartFilterName") state.name = event.target.value;
    else if (event.target.id === "kartFilterDay") state.day = event.target.value;
    else return;
    renderList();
  });

  async function load() {
    const generation = ++state.generation;
    state.loading = true;
    state.failed = false;
    render();
    try {
      const sb = await getClient();
      const { data, error } = await sb.rpc("admin_kart_races", { p_limit: state.limit });
      if (error) throw error;
      if (generation !== state.generation) return;
      state.races = Array.isArray(data) ? data : [];
      state.loaded = true;
    } catch (error) {
      console.error("[admin] kart races failed to load", error);
      if (generation !== state.generation) return;
      state.failed = true;
    } finally {
      if (generation === state.generation) { state.loading = false; render(); }
    }
  }

  function visibleRaces() {
    const name = state.name.trim().toLowerCase();
    return state.races.filter((race) => {
      if (state.day && localDayKey(race.created_at) !== state.day) return false;
      if (name && !playersOf(race).some((player) => String(player.name || "").toLowerCase().includes(name))) return false;
      return true;
    });
  }

  const playersOf = (race) => (Array.isArray(race.players) ? [...race.players].sort((a, b) => (a.place ?? 99) - (b.place ?? 99)) : []);

  const hasIssues = (race) => playersOf(race).some((player) => !player.bot && (Number.isFinite(player.dropped_at_s) || player.away_s > 0));

  function modeText(race) {
    if (race.mode !== "gp") return at("kart.race");
    const cup = race.cup ? label("cup", race.cup) : "";
    return [at("kart.gp"), cup, race.gp_round ? at("kart.round", { n: race.gp_round }) : ""].filter(Boolean).join(" · ");
  }

  function playerRow(player, nameFilter) {
    const isMatch = nameFilter && String(player.name || "").toLowerCase().includes(nameFilter);
    const badges = `${player.bot ? `<span class="kt-badge bot">${esc(at("kart.bot"))}</span>` : ""}${!player.bot && player.guest ? `<span class="kt-badge guest">${esc(at("kart.guest"))}</span>` : ""}`;
    const nameHtml = player.user_id
      ? `<button type="button" class="kt-user" data-open-saves="${esc(player.user_id)}" data-name="${esc(player.name)}" title="${esc(at("kart.openSaves", { name: player.name }))}">${esc(player.name)}</button>`
      : esc(player.name);
    const link = player.link ? esc(label("kart.link", player.link)) : "—";
    const dropped = Number.isFinite(player.dropped_at_s) ? `<span class="kt-bad">${esc(at("kart.droppedAt", { n: player.dropped_at_s }))}</span>` : "—";
    const away = player.away_s > 0 ? `<span class="kt-warn">${esc(at("common.s", { n: player.away_s }))}</span>` : "—";
    return `<tr${isMatch ? ' class="match"' : ""}>
      <td class="num">${esc(player.place ?? "—")}</td>
      <td class="kt-pname">${nameHtml} ${badges}</td>
      <td class="num">${player.time_ms ? esc(fmtRaceTime(player.time_ms)) : `<span class="muted">${esc(at("kart.noTime"))}</span>`}</td>
      <td class="num">${player.best_lap_ms ? esc(fmtRaceTime(player.best_lap_ms)) : "—"}</td>
      <td>${player.bot ? "—" : link}</td>
      <td class="num">${player.bot ? "—" : dropped}</td>
      <td class="num">${player.bot ? "—" : away}</td>
    </tr>`;
  }

  function raceHtml(race) {
    const id = String(race.id);
    const open = state.open.has(id);
    const nameFilter = state.name.trim().toLowerCase();
    const issues = hasIssues(race);
    const head = `<button type="button" class="kt-head" data-race-toggle="${esc(id)}" aria-expanded="${open}" aria-controls="kart-race-${esc(id)}">
      <span class="kt-time"><b>${esc(fmtTime(race.created_at))}</b><span class="muted"> ${esc(fmtDay(race.created_at))}</span></span>
      <span class="kt-room">${esc(at("kart.room", { code: race.room }))}</span>
      <span class="kt-track">${esc(label("t", race.track))}</span>
      <span class="kt-mode muted">${esc(modeText(race))} · ${esc(at("kart.laps", { n: race.laps }))} · ${esc(label("w", race.weather))}</span>
      <span class="kt-humans">${esc(at("kart.humans", { n: race.human_count }))}${issues ? ` <span class="kt-badge warn" title="${esc(at("kart.issues"))}">⚠ ${esc(at("kart.issues"))}</span>` : ""}</span>
      <span class="kt-chevron" aria-hidden="true">${open ? "▾" : "▸"}</span>
    </button>`;
    if (!open) return `<li class="kt-race">${head}</li>`;
    return `<li class="kt-race open">${head}
      <div class="kt-players" id="kart-race-${esc(id)}"><div class="kt-scroll"><table>
        <thead><tr><th class="num">${esc(at("kart.col.place"))}</th><th>${esc(at("kart.col.name"))}</th><th class="num">${esc(at("kart.col.time"))}</th><th class="num">${esc(at("kart.col.best"))}</th><th>${esc(at("kart.col.link"))}</th><th class="num">${esc(at("kart.col.dropped"))}</th><th class="num">${esc(at("kart.col.away"))}</th></tr></thead>
        <tbody>${playersOf(race).map((player) => playerRow(player, nameFilter)).join("")}</tbody>
      </table></div></div></li>`;
  }

  function renderList() {
    const list = host.querySelector("#kartList");
    if (!list) return;
    const shown = visibleRaces();
    host.querySelector("#kartCount").textContent = at("kart.count", { shown: shown.length, total: state.races.length });
    host.querySelector("[data-kart-clear]").hidden = !(state.name || state.day);
    if (!state.races.length) { list.innerHTML = `<li class="kt-empty">${esc(at("kart.empty"))}</li>`; return; }
    list.innerHTML = shown.length ? shown.map(raceHtml).join("") : `<li class="kt-empty">${esc(at("kart.noMatch"))}</li>`;
  }

  function render() {
    const canMore = state.loaded && state.races.length >= state.limit && state.limit < MAX_LIMIT;
    host.innerHTML = `<section class="wide-section" aria-label="${esc(at("kart.title"))}">
      <div class="wide-bar">
        <h2>${esc(at("kart.title"))}</h2>
        <button type="button" class="wide-btn" data-kart-refresh${state.loading ? " disabled" : ""}>${esc(at("common.refresh"))}</button>
      </div>
      <div class="wide-filters">
        <label class="wide-field"><span>${esc(at("kart.filterNameLabel"))}</span><input id="kartFilterName" type="search" value="${esc(state.name)}" placeholder="${esc(at("kart.filterName"))}" autocomplete="off" spellcheck="false"></label>
        <label class="wide-field"><span>${esc(at("kart.filterDay"))}</span><input id="kartFilterDay" type="date" value="${esc(state.day)}"></label>
        <button type="button" class="wide-btn ghost" data-kart-clear>${esc(at("kart.clear"))}</button>
      </div>
      ${state.loading && !state.loaded ? `<div class="wide-note" role="status">${esc(at("common.loading"))}</div>` : ""}
      ${state.failed ? `<div class="wide-note bad" role="alert">${esc(at("kart.error"))}</div>` : ""}
      ${state.loaded ? `<div class="wide-meta"><span id="kartCount" role="status"></span><span class="muted">${esc(at("kart.hint"))}</span></div>
      <ul class="kt-list" id="kartList"></ul>
      ${canMore ? `<button type="button" class="wide-btn" data-kart-more${state.loading ? " disabled" : ""}>${esc(at("kart.more"))}</button>` : ""}` : ""}
    </section>`;
    if (state.loaded) renderList();
  }

  return {
    /* tab opened: fetch once (again only through the Refresh button) */
    show() { if (!state.loaded && !state.loading) void load(); else render(); },
    hide() { state.generation += 1; state.loading = false; },
    relabel() { if (state.loaded || state.failed) render(); },
  };
}
