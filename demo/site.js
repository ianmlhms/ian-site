import { COPY, SHOWCASE_ORDER, UI } from "/demo/copy.js?v=1";

const ICONS = Object.freeze({
  games: "🎮",
  duo: "📱",
  transit: "🚌",
  sky: "🛩️",
  chat: "💬",
  buddy: "🧠",
  wuertspill: "🟩",
  trails: "🥾",
  maps: "🗺️",
});

const SHOWCASE_LIMIT = 6;
const SHOWCASES = SHOWCASE_ORDER.slice(0, SHOWCASE_LIMIT);
const GROUPS = Object.freeze([
  Object.freeze(SHOWCASES.slice(0, 2)),
  Object.freeze(SHOWCASES.slice(2, 4)),
  Object.freeze(SHOWCASES.slice(4, 6)),
]);
const MODULE_PATHS = Object.freeze(Object.fromEntries(
  SHOWCASES.map((id) => [id, `/demo/${id}.js?v=1`]),
));
const copy = COPY.adults;

let active = null;
let activationToken = 0;

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function makeTile(id) {
  const cardCopy = copy.cards[id];
  const tile = makeElement("button", `tile demo-${id}`);
  tile.type = "button";
  tile.dataset.showcase = id;
  tile.setAttribute("aria-expanded", "false");
  tile.append(
    makeElement("span", "ico", ICONS[id]),
    makeElement("span", "tname", cardCopy.t),
    makeElement("span", "tsub", cardCopy.s),
  );
  tile.querySelector(".ico").setAttribute("aria-hidden", "true");
  return tile;
}

function closeActive() {
  if (!active) return;
  activationToken += 1;
  try {
    active.instance?.destroy();
  } catch (error) {
    console.error(`[demo2] ${active.id} failed to close`, error);
  }
  active.tile.setAttribute("aria-expanded", "false");
  active.panel.remove();
  active = null;
}

function showFailure(entry, error) {
  if (active !== entry) return;
  const message = makeElement("p", "dfail", UI.failed);
  const retry = makeElement("button", "dbtn", UI.retry);
  retry.type = "button";
  retry.addEventListener("click", () => void activate(entry.tile, true), { once: true });
  message.append(retry);
  entry.body.replaceChildren(message);
  console.error(`[demo2] ${entry.id} failed to load`, error);
}

async function activate(tile, force = false) {
  const id = tile.dataset.showcase;
  if (!MODULE_PATHS[id]) return;
  if (active?.id === id && !force) {
    closeActive();
    return;
  }

  closeActive();
  const token = ++activationToken;
  const panel = makeElement("div", "dpanel");
  const body = makeElement("div", "dbody");
  body.append(makeElement("p", "dmuted", UI.loading));
  panel.append(body);
  tile.closest(".tile-group").append(panel);
  tile.setAttribute("aria-expanded", "true");

  const entry = { id, tile, panel, body, instance: null, token };
  active = entry;

  try {
    const showcase = await import(MODULE_PATHS[id]);
    if (active !== entry || activationToken !== token) return;
    body.replaceChildren();
    const instance = showcase.mount(body, { audience: "adults" });
    if (!instance || typeof instance.destroy !== "function") {
      throw new TypeError(`${id} did not return a destroy handle`);
    }
    entry.instance = instance;
  } catch (error) {
    showFailure(entry, error);
  }
}

function renderPage() {
  document.getElementById("kicker").textContent = copy.kicker;
  document.getElementById("title").textContent = copy.title;
  document.getElementById("sub").textContent = copy.sub;
  document.getElementById("section-title").textContent = copy.kicker;
  document.getElementById("footer-copy").textContent = copy.footer;
  document.getElementById("cta").textContent = copy.cta;

  const groupsRoot = document.getElementById("showcase-groups");
  GROUPS.forEach((ids) => {
    const group = makeElement("div", "tile-group");
    const head = makeElement("div", "group-head");
    head.append(makeElement("h3", "group-title", copy.cards[ids[0]].t));
    const tiles = makeElement("div", "tiles");
    ids.forEach((id) => tiles.append(makeTile(id)));
    group.append(head, tiles);
    groupsRoot.append(group);
  });

  groupsRoot.addEventListener("click", (event) => {
    const tile = event.target.closest(".tile");
    if (tile && groupsRoot.contains(tile)) void activate(tile);
  });

  const firstTile = groupsRoot.querySelector(`[data-showcase="${SHOWCASES[0]}"]`);
  if (firstTile) void activate(firstTile);
}

addEventListener("pagehide", closeActive, { once: true });
renderPage();
