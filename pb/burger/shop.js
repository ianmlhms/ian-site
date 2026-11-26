/* Burger-Restaurant shop: built once, refresh() updates prices, levels and buttons. Buttons carry data-act="buy" for main.js. */
import {INTERIOR_UPGRADES, KITCHEN_UPGRADES, PREMIUM_UPGRADES} from "/pb/burger/data.js?v=2";
import {upgradeLevel} from "/pb/burger/sim.js?v=3";

const TABS = Object.freeze([
  {id:"kit", label:"Kichen", upgrades:KITCHEN_UPGRADES, currency:"coins"},
  {id:"int", label:"Restaurant", upgrades:INTERIOR_UPGRADES, currency:"coins"},
  {id:"prem", label:"Stären", upgrades:PREMIUM_UPGRADES, currency:"stars", note:"Stäre gëtt et nëmme fir en Dag mat 3 Stären."},
]);

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const icon = (currency) => el("i", currency === "stars" ? "star" : "coin");

export function createShop(container) {
  let activeTab = TABS[0].id;
  const rows = [];
  const panels = new Map();
  const tabButtons = new Map();

  const header = el("div", "shop-header");
  const closeButton = el("button", "arcade-btn secondary", "Zou");
  closeButton.type = "button";
  closeButton.dataset.act = "shop-close";
  header.append(el("h2", "shop-title", "Buttek"), closeButton);
  const coinBalance = el("span");
  const starBalance = el("span");
  const balance = el("p", "shop-balance");
  balance.append(coinBalance, starBalance);
  const tabBar = el("div", "shop-tabs");
  tabBar.setAttribute("role", "tablist");

  TABS.forEach((tab) => {
    const tabButton = el("button", "shop-tab", tab.label);
    tabButton.type = "button";
    tabButton.dataset.act = "shop-tab";
    tabButton.dataset.item = tab.id;
    tabButton.setAttribute("role", "tab");
    tabButtons.set(tab.id, tabButton);
    tabBar.append(tabButton);
    const panel = el("div", "shop-panel");
    if (tab.note) panel.append(el("p", "shop-note", tab.note));
    tab.upgrades.forEach((upgrade) => {
      const row = el("article", "upgrade");
      const copy = el("div");
      const pips = el("div", "upgrade-level");
      const pipList = Array.from({length:upgrade.max}, () => el("i"));
      pips.append(...pipList);
      pips.setAttribute("aria-hidden", "true");
      copy.append(el("h3", "", upgrade.name), el("p", "", upgrade.description), pips);
      const buy = el("button", "arcade-btn upgrade-buy");
      buy.type = "button";
      buy.dataset.act = "buy";
      buy.dataset.item = `${tab.id}:${upgrade.id}`;
      row.append(copy, buy);
      panel.append(row);
      rows.push({tab, upgrade, pipList, buy, key:""});
    });
    panels.set(tab.id, panel);
  });
  container.replaceChildren(header, balance, tabBar, ...panels.values());

  function showTab(tabId) {
    if (!panels.has(tabId)) return;
    activeTab = tabId;
    panels.forEach((panel, id) => { panel.hidden = id !== tabId; });
    tabButtons.forEach((button, id) => {
      button.classList.toggle("active", id === tabId);
      button.setAttribute("aria-selected", String(id === tabId));
    });
  }

  function refresh(progress) {
    const coinKey = `${progress.coins}:${progress.stars}`;
    if (balance.dataset.key !== coinKey) {
      balance.dataset.key = coinKey;
      coinBalance.replaceChildren(icon("coins"), document.createTextNode(String(progress.coins)));
      starBalance.replaceChildren(icon("stars"), document.createTextNode(String(progress.stars)));
    }
    rows.forEach((row) => {
      const level = upgradeLevel(progress, row.tab.id, row.upgrade.id);
      const isMax = level >= row.upgrade.max;
      const cost = row.upgrade.costs[level];
      const key = `${level}:${isMax || progress[row.tab.currency] >= cost}`;
      if (row.key === key) return;
      row.key = key;
      row.pipList.forEach((pip, index) => pip.classList.toggle("on", index < level));
      row.buy.replaceChildren(...(isMax ? [document.createTextNode("Max")] : [icon(row.tab.currency), document.createTextNode(String(cost))]));
      row.buy.disabled = isMax || progress[row.tab.currency] < cost;
      row.buy.setAttribute("aria-label", isMax ? `${row.upgrade.name}: maximal` : `${row.upgrade.name} fir ${cost} kafen`);
    });
  }

  showTab(activeTab);
  return {refresh, showTab, focusClose:() => closeButton.focus()};
}
