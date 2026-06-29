/* ============================================================================
 * i18n.js — tiny trilingual engine for ian.lu (LB · DE · EN). No build step.
 * Load as a plain <script> in <head> AFTER i18n-dict.js and theme.js.
 *
 *   Markup:
 *     <h1 data-i18n="key">fallback</h1>            -> textContent
 *     <p  data-i18n-html="key">fallback</p>         -> innerHTML (allows <b>, &nbsp;)
 *     <input data-i18n-attr="placeholder:key|title:key2">
 *
 *   JS API (window.I18N):
 *     t(key)            -> translated string for the active language
 *     lang              -> "lb" | "de" | "en"
 *     set(lang)         -> switch language, persist, re-apply, fire i18n:change
 *     apply(root?)      -> (re)translate a DOM subtree (default: document)
 *     onChange(fn)      -> subscribe to language changes (also fires once now)
 *
 *   Dynamic content rendered by other scripts should call I18N.t(...) and
 *   listen for the "i18n:change" event on document to re-render.
 * ========================================================================== */
(function () {
  "use strict";

  var LANGS = ["lb", "de", "en"];
  var DEFAULT_LANG = "lb"; // Luxembourgish first (per site preference)
  var STORE_KEY = "site_lang";
  var DICT = window.I18N_DICT || {};

  function read() {
    try {
      var v = localStorage.getItem(STORE_KEY);
      return LANGS.indexOf(v) >= 0 ? v : DEFAULT_LANG;
    } catch (e) {
      return DEFAULT_LANG;
    }
  }

  var lang = read();

  function t(key, l) {
    var entry = DICT[key];
    if (!entry) return key; // surfaces missing keys instead of blanking text
    return entry[l || lang] || entry.en || entry.lb || key;
  }

  function applyAttrs(el) {
    var spec = el.getAttribute("data-i18n-attr");
    if (!spec) return;
    spec.split("|").forEach(function (pair) {
      var idx = pair.indexOf(":");
      if (idx < 0) return;
      var attr = pair.slice(0, idx).trim();
      var key = pair.slice(idx + 1).trim();
      if (attr && key) el.setAttribute(attr, t(key));
    });
  }

  function apply(root) {
    root = root || document;
    document.documentElement.lang = lang;
    root.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    root.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
    root.querySelectorAll("[data-i18n-attr]").forEach(applyAttrs);
    syncSwitchers();
  }

  function set(next) {
    if (LANGS.indexOf(next) < 0 || next === lang) {
      if (next === lang) return;
      return;
    }
    lang = next;
    try { localStorage.setItem(STORE_KEY, lang); } catch (e) {}
    apply(document);
    document.dispatchEvent(new CustomEvent("i18n:change", { detail: { lang: lang } }));
  }

  // ---- language switcher (auto-mounts into every #langSw host) -------------
  function injectCss() {
    if (document.getElementById("i18n-css")) return;
    var s = document.createElement("style");
    s.id = "i18n-css";
    s.textContent =
      ".langsw{display:inline-flex;align-items:stretch;border:1px solid var(--border,#2a2a4a);" +
      "border-radius:9px;overflow:hidden;vertical-align:middle}" +
      ".langsw button{background:transparent;color:var(--muted,#8888aa);border:none;" +
      "padding:6px 9px;font-weight:800;font-size:12px;line-height:1.2;cursor:pointer;font-family:inherit}" +
      ".langsw button+button{border-left:1px solid var(--border,#2a2a4a)}" +
      ".langsw button.on{background:var(--accent,#6ea8fe);color:#fff}";
    document.head.appendChild(s);
  }

  function buildSwitcher(host) {
    host.classList.add("langsw");
    host.setAttribute("role", "group");
    host.setAttribute("aria-label", "Language");
    host.innerHTML = LANGS.map(function (l) {
      return '<button type="button" data-lang="' + l + '">' + l.toUpperCase() + "</button>";
    }).join("");
    host.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () { set(b.getAttribute("data-lang")); });
    });
  }

  function syncSwitchers() {
    document.querySelectorAll(".langsw").forEach(function (sw) {
      sw.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("on", b.getAttribute("data-lang") === lang);
      });
    });
  }

  function mountSwitchers() {
    document.querySelectorAll("#langSw, [data-langsw]").forEach(function (host) {
      if (!host.dataset.i18nMounted) {
        host.dataset.i18nMounted = "1";
        buildSwitcher(host);
      }
    });
  }

  function onChange(fn) {
    document.addEventListener("i18n:change", function (e) { fn(e.detail.lang); });
    fn(lang); // fire immediately so callers render in the current language
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

  // Apply ASAP. <head> scripts run before body exists, so wait for DOM.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
