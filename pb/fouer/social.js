// Schueberfouer Tycoon W7: the gallery (DESIGN 7.6). Same five RPCs as Theme Park Tycoon (park_gallery, park_layout, publish_park,
// unpublish_park, like_park, all through the arcade page's __pbRpc bridge, no schema change). Columns keep their meaning:
//   value = tb (lifetime Fouer-Wäert), guests = built pitches, rating = stars x 100 + points / 10, layout = "F2|..." (below).
// v1 entries (layout is a JSON text starting "{") show up as "Museum" cards and open the old-park minimap, read-only.
// Pure part (DOM-free, harness-tested): layout codec, row cleaning, museum test, error ids. DOM part: createGallery (a modal built from textContent only:
// nothing a foreign player wrote ever reaches innerHTML).
import { PITCH_COUNT, PITCHES } from "./data.js";
import { decodePitches, encodePitches } from "./save.js";
import { gallerySummary, cleanName } from "./sim.js";

export const RPC_TIMEOUT = 8000;
export const LAYOUT_PREFIX = "F2|";
export const LAYOUT_LIMIT = 8000;               // publish_park ignores anything longer
export const GALLERY_LIMIT = 24;
export const NAME_LIMIT = 32;
export const SORTS = Object.freeze(["value", "likes", "recent"]);
export const FUNCTIONS = Object.freeze(["publish_park", "unpublish_park", "park_gallery", "park_layout", "like_park"]);
const TEST_BLOCKED = new Set(["publish_park", "unpublish_park", "like_park"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE36 = /^[0-9a-z]+$/;
/** v1 ratings were 0..76 in the live table, v2 ratings are stars x 100 + something (>= 100); v1 entries were last written before the launch. */
export const V1_RATING_BELOW = 100;
export const V1_BEFORE_MS = Date.parse("2026-10-23T00:00:00Z");

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const cleanText = (value, fallback, limit = 80) => typeof value === "string" ? value.slice(0, limit) : fallback;
const count = value => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value))) : 0;

// ---------------------------------------------------------------- layout codec

/** "F2|<34 pitches x 3 base36>|<opened-pitch mask, base36>|<pioneer 0/1>|<stars 1..5>" (about 115 characters). */
export function encodeLayout(state, stars = 1) {
  const pu = Math.max(0, Math.floor(state.pu)).toString(36);
  const rating = Math.max(1, Math.min(5, Math.floor(stars)));
  return `${LAYOUT_PREFIX}${encodePitches(state.pitches)}|${pu}|${state.pi === 1 ? 1 : 0}|${rating}`;
}

/** The pitch list of a published fair, or null for anything that is not a well-formed v2 layout. Never throws. */
export function decodeLayout(text) {
  if (typeof text !== "string" || text.length > LAYOUT_LIMIT || !text.startsWith(LAYOUT_PREFIX)) return null;
  const parts = text.slice(LAYOUT_PREFIX.length).split("|");
  if (parts.length < 4) return null;
  const [p, puText, piText, starText] = parts;
  if (p.length !== PITCH_COUNT * 3 || !/^[0-9a-z]+$/.test(p)) return null;
  if (!BASE36.test(puText) || puText.length > 8) return null;
  if (piText !== "0" && piText !== "1") return null;
  if (!/^[1-5]$/.test(starText)) return null;
  const pu = Math.min(2 ** PITCH_COUNT - 1, parseInt(puText, 36));
  // a visitor sees whatever was published: specials (gold carousel, old-park kiosk, Hämmi statue) are shown without any check
  const pitches = decodePitches(p, { pioneer: true, stampTotal: 99 });
  return { pitches, pu, pioneer: piText === "1", stars: Number(starText) };
}

/** True for a layout text of the old game (a JSON object text). */
export const isV1Layout = text => typeof text === "string" && text.trimStart().startsWith("{");

/** What the row of the list is, judged from the columns alone (the list has no layout): authoritative is the layout fetched on a visit. */
export function isMuseumRow(row) {
  return row.rating < V1_RATING_BELOW || (Number.isFinite(Date.parse(row.updated)) && Date.parse(row.updated) < V1_BEFORE_MS);
}

export function cleanRow(row) {
  if (!isRecord(row) || typeof row.user_id !== "string" || !UUID.test(row.user_id)) return null;
  const clean = { userId: row.user_id, username: cleanText(row.username, "?", NAME_LIMIT), name: cleanText(row.park_name, "?", NAME_LIMIT),
    value: count(row.value), guests: count(row.guests), rating: Math.min(1000, count(row.rating)), likes: count(row.likes),
    liked: row.liked_by_me === true, updated: cleanText(row.updated_at, "", 40) };
  return { ...clean, stars: Math.max(1, Math.min(5, Math.floor(clean.rating / 100))), museum: isMuseumRow(clean) };
}

/** The error id (a `gal.err.*` string) for whatever an RPC threw. */
export function errorId(error) {
  const message = cleanText(error?.message, "request-failed", 240).toLowerCase();
  if (message === "offline") return "offline";
  if (message === "test-mode") return "test";
  if (message === "timeout") return "timeout";
  if (message === "forbidden" || /permission|jwt|auth|sign.?in/.test(message)) return "auth";
  if (message === "invalid-layout") return "invalid";
  if (message === "too-large") return "big";
  return "generic";
}

/** The arguments of publish_park for the player's current fair. */
export function publishArgs(state, name) {
  const summary = gallerySummary(state);
  const stars = Math.max(1, Math.min(5, Math.floor(summary.rating / 100)));
  const layout = encodeLayout(state, stars);
  if (layout.length > LAYOUT_LIMIT) throw new Error("too-large");
  const clean = cleanName(name).slice(0, NAME_LIMIT);
  return { p_name: clean, p_value: summary.value, p_guests: summary.guests, p_rating: summary.rating, p_layout: layout };
}

/** What the scene draws for a visited fair: the spec the fair layer takes for pitch `index`. */
export function visitSpec(layout, index) {
  const entry = layout.pitches[index];
  if (entry) return { state: "built", item: entry.k, look: entry.look, level: entry.lv + 1 };
  const open = PITCHES[index].star <= layout.stars || Math.floor(layout.pu / 2 ** index) % 2 === 1;
  return { state: open ? "open" : "locked" };
}

// ---------------------------------------------------------------- the bridge to the arcade page

export function createBridge({ win = globalThis.window, timeout = RPC_TIMEOUT, testMode = false } = {}) {
  const pending = new Map();
  const prefix = `fouer-${Date.now()}-`;
  let nextId = 0;
  function receive(event) {
    if (event.source !== win.parent || !isRecord(event.data?.__pbRpcRes)) return;
    const { id, data, error } = event.data.__pbRpcRes;
    const call = pending.get(id);
    if (!call) return;
    clearTimeout(call.timer);
    pending.delete(id);
    if (error !== null && error !== undefined) call.reject(new Error(cleanText(error, "request-failed", 240)));
    else call.resolve(data);
  }
  win.addEventListener("message", receive);
  function rpc(fn, args = {}) {
    return new Promise((resolve, reject) => {
      if (!FUNCTIONS.includes(fn)) { reject(new Error("forbidden")); return; }
      if (testMode && TEST_BLOCKED.has(fn)) { reject(new Error("test-mode")); return; }
      if (win.parent === win) { reject(new Error("offline")); return; }
      const id = `${prefix}${++nextId}`;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("timeout")); }, timeout);
      pending.set(id, { resolve, reject, timer });
      try { win.parent.postMessage({ __pbRpc: { id, fn, args } }, "*"); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(new Error("offline")); }
    });
  }
  return { rpc, destroy() {
    win.removeEventListener("message", receive);
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error("offline")); }
    pending.clear();
  } };
}

// ---------------------------------------------------------------- the gallery modal

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (text, className, action) => {
  const node = el("button", className, text);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
};

/** `T(key, params)` translates in the language of the moment; `showModal(build)` is the UI's modal queue ((overlay, close) => void). */
export function createGallery({ game, showModal, T, money, formatDate, bridge = createBridge({ testMode: game.testMode }), onVisit, onMuseum, ownName = () => "", sfx = { click() {} } }) {
  const testMode = game.testMode === true;
  let sort = "value";
  let revision = 0;

  function open() {
    return showModal((overlay, close) => {
      const myRevision = ++revision;
      const card = el("div", "dialog gallery");
      card.setAttribute("aria-label", T("gal.title"));
      const heading = el("h2", "", T("gal.title"));
      const note = el("p", "note", T("gal.note"));
      const status = el("p", "gstatus"); status.setAttribute("role", "status");
      const body = el("div", "gbody");
      const closeBtn = button(T("gal.close"), "btn ghost", () => { revision++; sfx.click(); close(); });
      closeBtn.dataset.gal = "close";
      card.append(heading, note, status, body, closeBtn);
      overlay.append(card);
      const alive = () => revision === myRevision && overlay.isConnected;
      const say = (text) => { status.textContent = text; };
      const fail = error => { if (alive()) say(T(`gal.err.${errorId(error)}`)); };

      async function visit(row, openBtn) {
        openBtn.disabled = true; say(T("gal.opening"));
        try {
          const layoutText = await bridge.rpc("park_layout", { p_user: row.userId });
          if (!alive()) return;
          if (isV1Layout(layoutText)) { revision++; close(); onMuseum(layoutText, row); return; }
          const layout = decodeLayout(layoutText);
          if (!layout) throw new Error("invalid-layout");
          revision++; close();
          onVisit(layout, row);
        } catch (error) { fail(error); openBtn.disabled = false; }
      }

      function likeControl(row) {
        const control = button(`${row.liked ? "♥" : "♡"} ${row.likes}`, "chip like", async () => {
          control.disabled = true; say("…");
          try {
            const liked = await bridge.rpc("like_park", { p_target: row.userId });
            if (typeof liked !== "boolean") throw new Error("bad-args");
            if (!alive()) return;
            say(liked ? T("gal.liked") : row.liked ? T("gal.unliked") : T("gal.noLike"));
            control.replaceWith(likeControl({ ...row, liked, likes: Math.max(0, row.likes + Number(liked) - Number(row.liked)) }));
          } catch (error) { fail(error); control.disabled = false; }
        });
        control.setAttribute("aria-pressed", String(row.liked));
        control.setAttribute("aria-label", row.liked ? T("gal.unlike") : T("gal.like"));
        return control;
      }

      function rowCard(row) {
        const node = el("article", `gcard${row.museum ? " museum" : ""}`);
        node.dataset.user = row.userId;
        const mine = ownName() !== "" && row.username === ownName();
        const title = el("h3", "", row.name);
        if (row.museum) title.prepend(el("span", "gbadge", `🏛️ ${T("gal.museum")}`));
        else if (mine) title.prepend(el("span", "gbadge mine", `⭐ ${T("gal.you")}`));
        node.append(title, el("p", "gby", T("gal.by", { name: row.username })));
        node.append(el("p", "gstats", row.museum ? T("gal.museum.blurb") : T("gal.stats", { value: money(row.value).replace("€", ""), built: row.guests, stars: row.stars })));
        node.append(el("small", "gdate", T("gal.updated", { date: formatDate(row.updated) })));
        const actions = el("div", "gactions");
        const openBtn = button(row.museum ? T("gal.museum.open") : T("gal.visit"), "btn", () => visit(row, openBtn));
        openBtn.dataset.gal = "visit";
        actions.append(openBtn);
        if (!testMode) actions.append(likeControl(row));
        node.append(actions);
        return node;
      }

      async function showList(nextSort = sort) {
        sort = SORTS.includes(nextSort) ? nextSort : "value";
        body.replaceChildren();
        const controls = el("div", "row"); controls.setAttribute("role", "group");
        for (const option of SORTS) {
          const chip = button(T(`gal.sort.${option}`), "chip", () => { sfx.click(); showList(option); });
          chip.setAttribute("aria-pressed", String(option === sort)); chip.dataset.sort = option;
          controls.append(chip);
        }
        controls.append(button(T("gal.refresh"), "chip", () => { sfx.click(); showList(); }));
        if (!testMode) { const pub = button(`📣 ${T("gal.publish")}`, "chip wide", () => { sfx.click(); showPublish(); }); pub.dataset.gal = "publish"; controls.append(pub); }
        const cards = el("div", "glist");
        body.append(controls, cards);
        say(T("gal.loading"));
        try {
          const result = await bridge.rpc("park_gallery", { p_sort: sort, p_limit: GALLERY_LIMIT });
          if (!alive()) return;
          if (!Array.isArray(result)) throw new Error("bad-args");
          const rows = result.slice(0, GALLERY_LIMIT).map(cleanRow).filter(Boolean);
          cards.replaceChildren(...rows.map(rowCard));
          say(rows.length ? T("gal.count", { count: rows.length }) : result.length ? T("gal.unreadable") : T("gal.empty"));
        } catch (error) { fail(error); }
      }

      async function publish(buttonNode, name, remove) {
        buttonNode.disabled = true; say(remove ? T("gal.removing") : T("gal.sending"));
        try {
          if (remove) await bridge.rpc("unpublish_park");
          else await bridge.rpc("publish_park", publishArgs(game.state, name));
          // these functions return nothing, also when a signed-out request is ignored: so the honest message is "sent"
          if (alive()) say(T("gal.sent"));
        } catch (error) { fail(error); }
        finally { buttonNode.disabled = false; }
      }

      function showPublish() {
        body.replaceChildren();
        const form = el("div", "gform");
        form.append(el("h3", "", T("gal.publish.title")), el("p", "", T("gal.publish.explain")));
        const label = el("label", "", `${T("gal.name")} `);
        const input = el("input"); input.type = "text"; input.maxLength = NAME_LIMIT; input.id = "galName";
        input.value = game.state.n || T("gal.defaultName");
        label.append(input);
        const actions = el("div", "gactions");
        const send = button(T("gal.send"), "btn green", () => publish(send, input.value, false)); send.dataset.gal = "send";
        const remove = button(T("gal.remove"), "btn ghost", () => publish(remove, "", true)); remove.dataset.gal = "remove";
        const back = button(T("gal.title"), "btn ghost", () => { sfx.click(); showList(); });
        actions.append(send, remove, back);
        form.append(label, actions);
        body.append(form);
        say("");
      }

      showList();
    });
  }
  return { open, bridge };
}
