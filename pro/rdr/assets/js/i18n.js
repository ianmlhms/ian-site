/* Tiny trilingual engine ported from the existing site. Plain scripts only. */
(function () {
  "use strict";

  var LANGS = ["fr", "de", "en"];
  var DEFAULT_LANG = "fr";
  var STORE_KEY = "rdr_lang";
  var DICT = window.I18N_DICT || {};

  function read() {
    try {
      var queryLang = new URLSearchParams(window.location.search).get("lang");
      if (LANGS.indexOf(queryLang) >= 0) return queryLang;
      var savedLang = localStorage.getItem(STORE_KEY);
      if (LANGS.indexOf(savedLang) >= 0) return savedLang;
    } catch (error) {
      console.warn("Language preference could not be read.", error);
    }
    return DEFAULT_LANG;
  }

  var lang = read();

  function t(key, targetLang) {
    var entry = DICT[key];
    if (!entry) return key;
    return entry[targetLang || lang] || entry.fr || entry.en || key;
  }

  function applyAttrs(element) {
    var spec = element.getAttribute("data-i18n-attr");
    if (!spec) return;
    spec.split("|").forEach(function (pair) {
      var index = pair.indexOf(":");
      if (index < 0) return;
      var attribute = pair.slice(0, index).trim();
      var key = pair.slice(index + 1).trim();
      if (attribute && key) element.setAttribute(attribute, t(key));
    });
  }

  function apply(root) {
    root = root || document;
    mountSwitchers();
    document.documentElement.lang = lang;
    root.querySelectorAll("[data-i18n]").forEach(function (element) {
      element.textContent = t(element.getAttribute("data-i18n"));
    });
    root.querySelectorAll("[data-i18n-html]").forEach(function (element) {
      element.innerHTML = t(element.getAttribute("data-i18n-html"));
    });
    root.querySelectorAll("[data-i18n-attr]").forEach(applyAttrs);
    syncSwitchers();
  }

  function syncUrl(nextLang) {
    try {
      var url = new URL(window.location.href);
      if (nextLang === DEFAULT_LANG) url.searchParams.delete("lang");
      else url.searchParams.set("lang", nextLang);
      history.replaceState({}, "", url);
    } catch (error) {
      console.warn("Language could not be reflected in the URL.", error);
    }
  }

  function set(nextLang) {
    if (LANGS.indexOf(nextLang) < 0 || nextLang === lang) return;
    lang = nextLang;
    try { localStorage.setItem(STORE_KEY, lang); } catch (error) {
      console.warn("Language preference could not be saved.", error);
    }
    syncUrl(lang);
    apply(document);
    document.dispatchEvent(new CustomEvent("i18n:change", { detail: { lang: lang } }));
  }

  function injectCss() {
    if (document.getElementById("i18n-css")) return;
    var style = document.createElement("style");
    style.id = "i18n-css";
    style.textContent =
      ".langsw{display:inline-flex;align-items:stretch;border:1px solid var(--rule,#ddd)}" +
      ".langsw button{background:transparent;color:var(--muted,#666);border:0;padding:6px 9px;cursor:pointer;font-family:inherit}" +
      ".langsw button+button{border-left:1px solid var(--rule,#ddd)}" +
      ".langsw button.on{background:var(--ink,#231f20);color:#fff}";
    document.head.appendChild(style);
  }

  function buildSwitcher(host) {
    host.classList.add("langsw");
    host.setAttribute("role", "group");
    host.setAttribute("aria-label", "Langue / Sprache / Language");
    host.innerHTML = LANGS.map(function (code) {
      return '<button type="button" data-lang="' + code + '">' + code.toUpperCase() + "</button>";
    }).join("");
    host.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-lang]");
      if (button) set(button.getAttribute("data-lang"));
    });
  }

  function syncSwitchers() {
    document.querySelectorAll(".langsw").forEach(function (switcher) {
      switcher.querySelectorAll("button").forEach(function (button) {
        var isCurrent = button.getAttribute("data-lang") === lang;
        button.classList.toggle("on", isCurrent);
        button.setAttribute("aria-pressed", String(isCurrent));
      });
    });
  }

  function mountSwitchers() {
    document.querySelectorAll("#langSw, [data-langsw]").forEach(function (host) {
      if (host.dataset.i18nMounted) return;
      host.dataset.i18nMounted = "1";
      buildSwitcher(host);
    });
  }

  function onChange(callback) {
    document.addEventListener("i18n:change", function (event) { callback(event.detail.lang); });
    callback(lang);
  }

  function boot() {
    injectCss();
    mountSwitchers();
    apply(document);
  }

  window.I18N = {
    get lang() { return lang; },
    t: t,
    set: set,
    apply: apply,
    onChange: onChange,
    LANGS: LANGS,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
