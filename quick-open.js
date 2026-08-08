import { APPS } from "./apps-catalog.js?v=1";

const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
const RESULT_LIMIT = 8;
const FALLBACK_ORDER = [
  "messenger.html", "grades.html", "timetable.html", "classchat.html",
  "pixelbreak.html", "bus.html", "moien.html", "skylens.html",
];
const LOCAL_STRINGS = {
  "qo.placeholder": { lb: "App sichen…", de: "App suchen…", en: "Search apps…" },
  "qo.empty": { lb: "Keng App fonnt.", de: "Keine App gefunden.", en: "No apps found." },
  "qo.hint": { lb: "opmaachen · Esc zoumaachen", de: "öffnen · Esc schließen", en: "open · Esc close" },
  "grp.school": { lb: "Schoul", de: "Schule", en: "School" },
  "grp.social": { lb: "Chat & Frënn", de: "Chat & Freunde", en: "Chat & Friends" },
  "grp.fun": { lb: "Spiller", de: "Spiele", en: "Games" },
  "grp.maps": { lb: "Kaarten & Ënnerwee", de: "Karten & unterwegs", en: "Maps & Getting Around" },
  "grp.personal": { lb: "Perséinlech", de: "Persönlich", en: "Personal" },
  "grp.private": { lb: "Privat", de: "Privat", en: "Private" },
};

let backdrop = null;
let input = null;
let list = null;
let results = [];
let selectedIndex = 0;
let previouslyFocused = null;

function currentLanguage() {
  if (["lb", "de", "en"].includes(window.I18N?.lang)) return window.I18N.lang;
  try {
    const saved = localStorage.getItem("site_lang");
    if (["lb", "de", "en"].includes(saved)) return saved;
  } catch {}
  const browserLanguage = (navigator.language || "").slice(0, 2).toLowerCase();
  return browserLanguage === "lb" || browserLanguage === "de" ? browserLanguage : "en";
}

function translate(key) {
  const translated = window.I18N?.t?.(key);
  if (translated && translated !== key) return translated;
  const entry = window.I18N_DICT?.[key] || LOCAL_STRINGS[key];
  const language = currentLanguage();
  return entry?.[language] || entry?.en || key;
}

function normalize(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

function isSubsequence(query, value) {
  let queryIndex = 0;
  for (let valueIndex = 0; valueIndex < value.length && queryIndex < query.length; valueIndex += 1) {
    if (value[valueIndex] === query[queryIndex]) queryIndex += 1;
  }
  return queryIndex === query.length;
}

function readUsage() {
  try {
    const parsed = JSON.parse(localStorage.getItem("appUsage") || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, entry]) =>
      entry && Number.isFinite(entry.score) && entry.score >= 0 && Number.isFinite(entry.ts)
    ));
  } catch {
    return {};
  }
}

function readFavorites() {
  try {
    const parsed = JSON.parse(localStorage.getItem("favApps") || "[]");
    return Array.isArray(parsed) ? new Set(parsed.filter((url) => typeof url === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function decayedScore(entry, now) {
  if (!entry) return 0;
  return entry.score * Math.pow(0.5, (now - entry.ts) / HALF_LIFE_MS);
}

function usageScores(now = Date.now()) {
  return Object.fromEntries(Object.entries(readUsage()).map(([url, entry]) =>
    [url, decayedScore(entry, now)]
  ));
}

function recordUsage(url) {
  const now = Date.now();
  const usage = readUsage();
  usage[url] = { score: decayedScore(usage[url], now) + 1, ts: now };
  const capped = Object.entries(usage)
    .sort(([, first], [, second]) => decayedScore(second, now) - decayedScore(first, now))
    .slice(0, 40);
  try {
    localStorage.setItem("appUsage", JSON.stringify(Object.fromEntries(capped)));
  } catch {}
}

function matchQuality(app, query) {
  const name = normalize(app.name);
  if (name.startsWith(query)) return 0;
  if (name.includes(query)) return 1;
  if (app.keywords.some((keyword) => normalize(keyword).includes(query))) return 2;
  if (isSubsequence(query, name)) return 3;
  return null;
}

function rankedApps(rawQuery) {
  const query = normalize(rawQuery);
  const usage = usageScores();
  if (query) {
    return APPS.map((app, authoredIndex) => ({
      app,
      authoredIndex,
      quality: matchQuality(app, query),
      usage: usage[app.url] || 0,
    }))
      .filter((result) => result.quality !== null)
      .sort((first, second) =>
        first.quality - second.quality ||
        second.usage - first.usage ||
        first.authoredIndex - second.authoredIndex
      )
      .slice(0, RESULT_LIMIT)
      .map((result) => result.app);
  }

  const favorites = readFavorites();
  return APPS.map((app, authoredIndex) => ({
    app,
    authoredIndex,
    favorite: favorites.has(app.url),
    usage: usage[app.url] || 0,
    fallbackIndex: FALLBACK_ORDER.indexOf(app.url),
  }))
    .sort((first, second) =>
      Number(second.favorite) - Number(first.favorite) ||
      second.usage - first.usage ||
      (first.fallbackIndex < 0 ? Number.POSITIVE_INFINITY : first.fallbackIndex) -
        (second.fallbackIndex < 0 ? Number.POSITIVE_INFINITY : second.fallbackIndex) ||
      first.authoredIndex - second.authoredIndex
    )
    .slice(0, RESULT_LIMIT)
    .map((result) => result.app);
}

function ensureCss() {
  if (document.getElementById("quick-open-css")) return;
  const link = document.createElement("link");
  link.id = "quick-open-css";
  link.rel = "stylesheet";
  link.href = "quick-open.css?v=1";
  document.head.appendChild(link);
}

function navigate(app) {
  recordUsage(app.url);
  location.href = app.url;
}

function render() {
  if (!backdrop) return;
  results = rankedApps(input.value);
  selectedIndex = Math.min(selectedIndex, Math.max(0, results.length - 1));
  list.replaceChildren();

  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "qo-empty";
    empty.dataset.i18n = "qo.empty";
    empty.textContent = translate("qo.empty");
    list.appendChild(empty);
    return;
  }

  results.forEach((app, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "qo-result";
    row.id = `qo-result-${index}`;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(index === selectedIndex));

    const icon = document.createElement("span");
    icon.className = "qo-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = app.icon;

    const name = document.createElement("span");
    name.className = "qo-name";
    name.textContent = app.name;
    if (app.locked) {
      const lock = document.createElement("span");
      lock.className = "qo-lock";
      lock.setAttribute("aria-label", "Locked");
      lock.textContent = "🔒";
      name.append(" ", lock);
    }

    const group = document.createElement("span");
    group.className = "qo-group";
    group.dataset.i18n = app.group;
    group.textContent = translate(app.group);

    row.append(icon, name, group);
    row.addEventListener("click", () => navigate(app));
    row.addEventListener("pointermove", () => {
      if (selectedIndex === index) return;
      selectedIndex = index;
      syncSelection(false);
    });
    list.appendChild(row);
  });
  syncSelection(false);
}

function syncSelection(scroll) {
  if (!backdrop) return;
  const rows = list.querySelectorAll(".qo-result");
  rows.forEach((row, index) => row.setAttribute("aria-selected", String(index === selectedIndex)));
  const selected = rows[selectedIndex];
  input.setAttribute("aria-activedescendant", selected?.id || "");
  if (scroll && selected) selected.scrollIntoView({ block: "nearest" });
}

function close() {
  if (!backdrop) return;
  backdrop.remove();
  backdrop = null;
  input = null;
  list = null;
  results = [];
  selectedIndex = 0;
  if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
  previouslyFocused = null;
}

function open() {
  if (backdrop) return;
  ensureCss();
  previouslyFocused = document.activeElement;

  backdrop = document.createElement("div");
  backdrop.className = "qo-backdrop";
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });

  const panel = document.createElement("section");
  panel.className = "qo-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");

  input = document.createElement("input");
  input.className = "qo-input";
  input.type = "search";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.dataset.i18nAttr = "placeholder:qo.placeholder|aria-label:qo.placeholder";
  input.placeholder = translate("qo.placeholder");
  input.setAttribute("aria-label", translate("qo.placeholder"));
  input.setAttribute("aria-controls", "qo-results");
  input.setAttribute("aria-autocomplete", "list");
  input.addEventListener("input", () => {
    selectedIndex = 0;
    render();
  });

  list = document.createElement("div");
  list.className = "qo-results";
  list.id = "qo-results";
  list.setAttribute("role", "listbox");

  const footer = document.createElement("footer");
  footer.className = "qo-footer";
  const shortcut = document.createElement("kbd");
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  shortcut.textContent = isMac ? "⌘K" : "Ctrl+K";
  const hint = document.createElement("span");
  hint.dataset.i18n = "qo.hint";
  hint.textContent = translate("qo.hint");
  footer.append(shortcut, hint);

  panel.append(input, list, footer);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  render();
  input.focus();
}

function isTypingElement(element) {
  return element instanceof HTMLElement &&
    (element.matches("input, textarea, select") || element.isContentEditable);
}

document.addEventListener("keydown", (event) => {
  const quickOpenShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
  if (quickOpenShortcut) {
    if (isTypingElement(document.activeElement)) return;
    event.preventDefault();
    open();
    return;
  }
  if (!backdrop) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  } else if (event.key === "ArrowDown" && results.length) {
    event.preventDefault();
    selectedIndex = (selectedIndex + 1) % results.length;
    syncSelection(true);
  } else if (event.key === "ArrowUp" && results.length) {
    event.preventDefault();
    selectedIndex = (selectedIndex - 1 + results.length) % results.length;
    syncSelection(true);
  } else if (event.key === "Enter" && results[selectedIndex]) {
    event.preventDefault();
    navigate(results[selectedIndex]);
  }
});

document.addEventListener("i18n:change", () => {
  if (!backdrop) return;
  input.placeholder = translate("qo.placeholder");
  input.setAttribute("aria-label", translate("qo.placeholder"));
  backdrop.querySelector(".qo-footer span").textContent = translate("qo.hint");
  render();
});
