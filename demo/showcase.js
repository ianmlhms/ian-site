import { COPY, SHOWCASE_ORDER, UI } from "/demo/copy.js?v=1";

const ICONS = Object.freeze({
  games: "🎮",
  transit: "🚌",
  sky: "🛩️",
  chat: "💬",
  buddy: "🧠",
  wuertspill: "🟩",
  trails: "🥾",
  maps: "🗺️",
});

const MODULE_PATHS = Object.freeze(Object.fromEntries(
  SHOWCASE_ORDER.map((id) => [id, `/demo/${id}.js?v=1`]),
));
const WIDE_CARDS = new Set(["games", "transit", "maps"]);
const OBSERVER_MARGIN = "300px";

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function makeCard(id, copy) {
  const card = makeElement("section", "dcard");
  card.id = `card-${id}`;
  if (WIDE_CARDS.has(id)) card.classList.add("wide");

  const head = makeElement("div", "dcard-head");
  head.append(makeElement("span", "dcard-ico", ICONS[id]));

  const text = makeElement("div", "dcard-text");
  text.append(
    makeElement("h2", "dcard-title", copy.t),
    makeElement("p", "dcard-sub", copy.s),
  );
  head.append(text);
  card.append(head);

  if (copy.how) card.append(makeElement("p", "dcard-how", copy.how));

  const body = makeElement("div", "dbody");
  card.append(body);
  return { card, head, body };
}

function addBadge(head, badge) {
  if (badge !== "live" && badge !== "demo") return;
  const label = badge === "live" ? UI.liveBadge : UI.demoBadge;
  head.append(makeElement("span", `dbadge ${badge}`, label));
}

function showFailure(body, id, error) {
  body.replaceChildren(makeElement("p", "dfail", UI.failed));
  console.error(`[demo] ${id} failed to load`, error);
}

export async function renderShowcases(root, audience) {
  const pageCopy = COPY[audience];
  if (!root || !pageCopy) throw new TypeError("Invalid showcase root or audience");

  const instances = [];
  const cards = SHOWCASE_ORDER.map((id) => {
    const parts = makeCard(id, pageCopy.cards[id]);
    root.append(parts.card);
    return { id, ...parts, started: false };
  });

  async function mountCard(entry) {
    if (entry.started) return;
    entry.started = true;
    entry.body.replaceChildren(makeElement("p", "dmuted", UI.loading));

    try {
      const module = await import(MODULE_PATHS[entry.id]);
      addBadge(entry.head, module.meta?.badge);
      entry.body.replaceChildren();
      const instance = module.mount(entry.body, { audience });
      if (!instance || typeof instance.destroy !== "function") {
        throw new TypeError(`${entry.id} did not return a destroy handle`);
      }
      instances.push(instance);
    } catch (error) {
      showFailure(entry.body, entry.id, error);
    }
  }

  let observer = null;
  if ("IntersectionObserver" in window) {
    observer = new IntersectionObserver((entries) => {
      entries.filter(({ isIntersecting }) => isIntersecting).forEach(({ target }) => {
        const entry = cards.find(({ card }) => card === target);
        if (entry) void mountCard(entry);
        observer.unobserve(target);
      });
    }, { rootMargin: OBSERVER_MARGIN });
    cards.slice(1).forEach(({ card }) => observer.observe(card));
  } else {
    cards.slice(1).forEach((entry) => void mountCard(entry));
  }

  await mountCard(cards[0]);
  return instances;
}
