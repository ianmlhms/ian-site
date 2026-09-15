import { serializeSave, readLayout } from "./save.js?v=1";

export const RPC_TIMEOUT = 8000;
const LAYOUT_LIMIT = 8000;
const GALLERY_LIMIT = 24;
const NAME_LIMIT = 32;
const SORTS = ["value", "likes", "recent"];
const FUNCTIONS = new Set(["publish_park", "unpublish_park", "park_gallery", "park_layout", "like_park"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const cleanText = (value, fallback, limit = 80) => typeof value === "string" ? value.slice(0, limit) : fallback;
const count = value => typeof value === "number" && Number.isFinite(value)
  ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value))) : 0;
let nextId = 0;

export function createBridge({ timeout = RPC_TIMEOUT } = {}) {
  const pending = new Map();
  const prefix = `park-${Date.now()}-`;
  function receive(event) {
    if (event.source !== window.parent || !isRecord(event.data?.__pbRpcRes)) return;
    const { id, data, error } = event.data.__pbRpcRes;
    const call = pending.get(id);
    if (!call) return;
    clearTimeout(call.timer);
    pending.delete(id);
    if (error !== null && error !== undefined) call.reject(new Error(cleanText(error, "request-failed", 240)));
    else call.resolve(data);
  }
  window.addEventListener("message", receive);
  function rpc(fn, args = {}) {
    return new Promise((resolve, reject) => {
      if (!FUNCTIONS.has(fn)) { reject(new Error("forbidden")); return; }
      if (window.parent === window) { reject(new Error("offline")); return; }
      const id = `${prefix}${++nextId}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("timeout"));
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      try { window.parent.postMessage({ __pbRpc: { id, fn, args } }, "*"); }
      catch {
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error("offline"));
      }
    });
  }
  return { rpc, destroy() {
    window.removeEventListener("message", receive);
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error("offline")); }
    pending.clear();
  } };
}

export function errorMessage(error) {
  const message = cleanText(error?.message, "request-failed", 240).toLowerCase();
  if (message === "offline") return "Gallery unavailable offline. Open this game in PixelBreak and check your connection. Sign in to publish or like; browsing needs no account.";
  if (message === "timeout") return "The gallery did not reply in time. Please try again. A publish or like request may already have reached it; refresh before retrying.";
  if (message === "forbidden" || /permission|jwt|auth|sign.?in/.test(message)) {
    return "This action needs a PixelBreak account and permission. Sign in to publish or like. You can browse signed out.";
  }
  if (message === "bad-args") return "The gallery rejected this request. Reopen the gallery and try again.";
  if (message === "invalid-layout") return "This park's layout is missing or damaged and cannot be visited.";
  if (message.includes("too large")) return cleanText(error.message, "Park is too large to publish.", 240);
  return "The gallery is unavailable right now. Please try again later. Sign in to publish or like.";
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, action) {
  const node = element("button", text);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

function cleanRow(row) {
  if (!isRecord(row) || typeof row.user_id !== "string" || !UUID.test(row.user_id)) return null;
  return { userId: row.user_id, username: cleanText(row.username, "Player", NAME_LIMIT),
    name: cleanText(row.park_name, "Untitled park", NAME_LIMIT), value: count(row.value),
    guests: count(row.guests), rating: Math.min(1000, count(row.rating)), likes: count(row.likes),
    liked: row.liked_by_me === true, updated: cleanText(row.updated_at, "Unknown", 40) };
}

export function createSocial({ getState, onVisit, onReturn, beforeOpen }) {
  const bridge = createBridge();
  const dialog = element("dialog");
  dialog.id = "parkSocial";
  dialog.setAttribute("aria-labelledby", "socialTitle");
  const heading = element("div", undefined, "panel-heading");
  const title = element("h2", "Park gallery");
  title.id = "socialTitle";
  const close = button("Close", () => dialog.close());
  heading.append(title, close);
  const body = element("div", undefined, "panel-body");
  const note = element("p", "Browse without an account. Publishing, removing a listing, and liking require signing in to PixelBreak.", "note");
  const status = element("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const content = element("div");
  body.append(note, status, content);
  dialog.append(heading, body);
  document.body.append(dialog);
  const visitBar = document.getElementById("visitBar");
  const visitLabel = document.getElementById("visitLabel");
  document.getElementById("returnPark").addEventListener("click", () => {
    visitBar.hidden = true;
    onReturn();
  });
  let revision = 0;
  let sort = "value";
  let visiting = false;
  dialog.addEventListener("close", () => { revision++; });

  function open(titleText) {
    revision++;
    beforeOpen();
    title.textContent = titleText;
    content.replaceChildren();
    status.textContent = "";
    if (!dialog.open) dialog.showModal();
  }

  async function publish(buttonNode, name, remove = false) {
    const currentRevision = revision;
    buttonNode.disabled = true;
    status.textContent = remove ? "Removing listing…" : "Sending your park…";
    try {
      if (remove) await bridge.rpc("unpublish_park");
      else {
        const state = getState();
        const layout = serializeSave(state);
        if (layout.length > LAYOUT_LIMIT) throw new Error("Park layout is too large to publish: the gallery limit is 8000 characters.");
        await bridge.rpc("publish_park", { p_name: name.trim().slice(0, NAME_LIMIT),
          p_value: Math.max(0, state.derived.parkValue), p_guests: state.derived.guestCount,
          p_rating: state.derived.rating, p_layout: layout });
      }
      // These functions return nothing, including when a signed-out request is ignored.
      if (revision === currentRevision) status.textContent = "Request sent. You must be signed in with a username for it to take effect. Refresh the gallery to confirm your listing.";
    } catch (error) { if (revision === currentRevision) status.textContent = errorMessage(error); }
    finally { buttonNode.disabled = false; }
  }

  function showPublish() {
    open("Publish your park");
    const explanation = element("p", "Publishing shares a snapshot of your park and your username publicly. Publish again to update it; remove your listing whenever you like.");
    const label = element("label", "Park name ");
    const input = element("input");
    input.type = "text";
    input.maxLength = NAME_LIMIT;
    input.value = "My theme park";
    label.append(input);
    const actions = element("div", undefined, "button-row");
    const send = button("Publish", () => publish(send, input.value));
    const remove = button("Remove my listing", () => publish(remove, "", true));
    actions.append(send, remove);
    content.append(explanation, label, actions);
  }

  async function visit(row, openButton) {
    if (visiting) return;
    visiting = true;
    const currentRevision = revision;
    openButton.disabled = true;
    status.textContent = "Opening park…";
    try {
      const layout = await bridge.rpc("park_layout", { p_user: row.userId });
      const state = readLayout(layout);
      if (!state) throw new Error("invalid-layout");
      if (revision !== currentRevision || !dialog.open) return;
      onVisit(state);
      visitLabel.textContent = `Read-only visit: ${row.name} by ${row.username}`;
      visitBar.hidden = false;
      dialog.close();
      document.getElementById("returnPark").focus();
    } catch (error) { if (revision === currentRevision) status.textContent = errorMessage(error); }
    finally { visiting = false; openButton.disabled = false; }
  }

  async function like(row, likeButton) {
    const currentRevision = revision;
    likeButton.disabled = true;
    status.textContent = "Updating like…";
    try {
      const liked = await bridge.rpc("like_park", { p_target: row.userId });
      if (typeof liked !== "boolean") throw new Error("bad-args");
      if (revision !== currentRevision) return;
      status.textContent = liked ? "Park liked." : row.liked ? "Like removed."
        : "No like added. Sign in to like other players' parks; you cannot like your own park.";
      const next = { ...row, liked, likes: Math.max(0, row.likes + Number(liked) - Number(row.liked)) };
      likeButton.replaceWith(likeControl(next));
    } catch (error) { if (revision === currentRevision) status.textContent = errorMessage(error); }
    finally { likeButton.disabled = false; }
  }

  function likeControl(row) {
    const control = button(`${row.liked ? "Unlike" : "Like"} · ${row.likes}`, () => like(row, control));
    control.setAttribute("aria-pressed", String(row.liked));
    return control;
  }

  function card(row) {
    const node = element("article", undefined, "objective");
    node.append(element("h3", row.name), element("p", `By ${row.username}`),
      element("p", `$${row.value.toLocaleString("en-US")} value · ${row.guests} guests · ${row.rating} rating`),
      element("small", `Updated: ${row.updated}`));
    const actions = element("div", undefined, "button-row");
    const openButton = button("Visit park", () => visit(row, openButton));
    actions.append(openButton, likeControl(row));
    node.append(actions);
    return node;
  }

  async function showGallery(nextSort = sort) {
    sort = SORTS.includes(nextSort) ? nextSort : "value";
    open("Park gallery");
    const currentRevision = revision;
    const controls = element("div", undefined, "button-row");
    for (const option of SORTS) {
      const control = button({ value: "Value", likes: "Likes", recent: "Recent" }[option], () => showGallery(option));
      control.setAttribute("aria-pressed", String(option === sort));
      controls.append(control);
    }
    controls.append(button("Refresh", () => showGallery()), button("Publish my park", showPublish));
    const cards = element("div");
    content.append(controls, cards);
    status.textContent = "Loading parks…";
    try {
      const result = await bridge.rpc("park_gallery", { p_sort: sort, p_limit: GALLERY_LIMIT });
      if (revision !== currentRevision) return;
      if (!Array.isArray(result)) throw new Error("bad-args");
      const rows = result.slice(0, GALLERY_LIMIT).map(cleanRow).filter(Boolean);
      cards.replaceChildren(...rows.map(card));
      status.textContent = rows.length ? `${rows.length} parks. Visits are read-only.`
        : result.length ? "No readable parks were returned. Please refresh later." : "No parks published yet. Be the first to share yours!";
    } catch (error) { if (revision === currentRevision) status.textContent = errorMessage(error); }
  }

  return { showGallery, showPublish };
}
