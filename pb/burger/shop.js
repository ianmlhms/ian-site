import {
  INTERIOR_UPGRADES,
  KITCHEN_UPGRADES,
  PREMIUM_UPGRADES,
} from "/pb/burger/data.js?v=1";

const TABS = Object.freeze([
  {id:"kit", label:"Kitchen", upgrades:KITCHEN_UPGRADES, currency:"coins"},
  {id:"int", label:"Interior", upgrades:INTERIOR_UPGRADES, currency:"coins"},
  {id:"prem", label:"⭐", upgrades:PREMIUM_UPGRADES, currency:"stars"},
]);

const element = (tagName, className, text) => {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const displayLevel = (upgrade, purchasedLevel) => {
  const base = upgrade.base || 0;
  return `${base + purchasedLevel}/${base + upgrade.max}`;
};

export function createShop(container, {getState, onPurchase, onClose}) {
  if (!(container instanceof HTMLElement)) throw new TypeError("Burger shop needs a container element.");
  let activeTab = TABS[0].id;
  const rows = new Map();
  const panels = new Map();
  const tabButtons = new Map();

  const header = element("div", "shop-header");
  header.append(element("h2", "shop-title", "Restaurant Shop"));
  const balance = element("div", "shop-balance");
  const closeButton = element("button", "shop-close", "Done");
  closeButton.type = "button";
  closeButton.addEventListener("click", onClose);
  header.append(balance, closeButton);

  const tabBar = element("div", "shop-tabs");
  const content = element("div", "shop-content");

  const showTab = (tabId) => {
    if (!panels.has(tabId)) return;
    activeTab = tabId;
    panels.forEach((panel, id) => { panel.hidden = id !== tabId; });
    tabButtons.forEach((button, id) => button.classList.toggle("active", id === tabId));
    refresh();
  };

  TABS.forEach((tab) => {
    const tabButton = element("button", "shop-tab", tab.label);
    tabButton.type = "button";
    tabButton.addEventListener("click", () => showTab(tab.id));
    tabButtons.set(tab.id, tabButton);
    tabBar.append(tabButton);

    const panel = element("div", "shop-panel");
    panel.dataset.tab = tab.id;
    tab.upgrades.forEach((upgrade) => {
      const row = element("article", "upgrade-row");
      const copy = element("div", "upgrade-copy");
      const title = element("h3", "upgrade-name", upgrade.name);
      const description = element("p", "upgrade-description", upgrade.description);
      const level = element("span", "upgrade-level");
      copy.append(title, description, level);
      const buyButton = element("button", "upgrade-buy");
      buyButton.type = "button";
      buyButton.addEventListener("click", () => onPurchase(tab.id, upgrade.id));
      row.append(copy, buyButton);
      panel.append(row);
      rows.set(`${tab.id}:${upgrade.id}`, {tab, upgrade, level, buyButton});
    });
    panels.set(tab.id, panel);
    content.append(panel);
  });

  container.append(header, tabBar, content);

  function refresh() {
    const state = getState();
    balance.textContent = `🪙 ${state.coins}   ⭐ ${state.stars}`;
    rows.forEach(({tab, upgrade, level, buyButton}) => {
      const purchasedLevel = Number(state[tab.id]?.[upgrade.id] || 0);
      const isMaximum = purchasedLevel >= upgrade.max;
      const cost = upgrade.costs[purchasedLevel];
      const symbol = tab.currency === "stars" ? "⭐" : "🪙";
      level.textContent = `Level ${displayLevel(upgrade, purchasedLevel)}`;
      buyButton.textContent = isMaximum ? "Max" : `${symbol} ${cost}`;
      buyButton.disabled = isMaximum || state[tab.currency] < cost;
      buyButton.setAttribute("aria-label", isMaximum ? `${upgrade.name} maxed` : `Buy ${upgrade.name} for ${cost}`);
    });
    const tab = TABS.find((entry) => entry.id === activeTab);
    if (tab?.id === "prem") balance.textContent += " · Stars come only from 3-star days";
  }

  showTab(activeTab);
  return {refresh, showTab};
}
