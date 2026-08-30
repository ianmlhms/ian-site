import { UI } from "/demo/copy.js?v=1";

const MODULE_PATHS = Object.freeze({
  games: "/demo/games.js?v=1",
  duo: "/demo/duo.js?v=1",
  transit: "/demo/transit.js?v=1",
  sky: "/demo/sky.js?v=1",
  chat: "/demo/chat.js?v=1",
  buddy: "/demo/buddy.js?v=1",
});

let active = null;
let activationToken = 0;

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function destroyActive() {
  if (!active) return;
  activationToken += 1;
  try {
    active.instance?.destroy();
  } catch (error) {
    console.warn(`[demo2] ${active.id} cleanup failed`, error);
  }
  active.tile.setAttribute("aria-expanded", "false");
  active.tile.classList.remove("selected");
  active.panel.remove();
  active = null;
}

function renderFailure(entry, error) {
  if (active !== entry) return;
  const message = makeElement("p", "dfail", UI.failed);
  const retry = makeElement("button", "dbtn", UI.retry);
  retry.type = "button";
  retry.addEventListener("click", () => void activate(entry.tile, true), { once: true });
  message.append(retry);
  entry.body.replaceChildren(message);
  console.warn(`[demo2] ${entry.id} failed to load`, error);
}

function renderBadge(panel, badge) {
  if (badge !== "live" && badge !== "demo") return;
  const label = badge === "live" ? UI.liveBadge : UI.demoBadge;
  panel.prepend(makeElement("span", `dbadge ${badge}`, label));
}

async function activate(tile, force = false) {
  const id = tile.dataset.showcase;
  if (!MODULE_PATHS[id]) return;
  if (active?.tile === tile && !force) return;

  destroyActive();
  const token = ++activationToken;
  const group = tile.closest(".tile-group");
  if (group instanceof HTMLDetailsElement) group.open = true;

  const panel = makeElement("div", "dpanel");
  const body = makeElement("div", "dbody");
  body.append(makeElement("p", "dmuted", UI.loading));
  panel.append(body);
  group.append(panel);

  tile.setAttribute("aria-expanded", "true");
  tile.classList.add("selected");
  const entry = { id, tile, panel, body, instance: null };
  active = entry;

  try {
    const showcase = await import(MODULE_PATHS[id]);
    if (active !== entry || activationToken !== token) return;
    renderBadge(panel, showcase.meta?.badge);
    body.replaceChildren();
    const instance = showcase.mount(body, { audience: "adults" });
    if (!instance || typeof instance.destroy !== "function") {
      throw new TypeError(`${id} did not return a destroy handle`);
    }
    entry.instance = instance;
  } catch (error) {
    renderFailure(entry, error);
  }
}

function handleTileClick(event) {
  const tile = event.target.closest(".tile[data-showcase]");
  if (!tile) return;
  event.preventDefault();
  void activate(tile);
}

function boot() {
  const apps = document.getElementById("apps");
  apps.addEventListener("click", handleTileClick);
  const firstTile = apps.querySelector('[data-showcase="games"]');
  if (firstTile) void activate(firstTile);
}

addEventListener("pagehide", destroyActive, { once: true });
boot();
