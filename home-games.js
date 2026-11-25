/* home-games.js — every arcade game on the home page (25 Nov 2026): one wall of small picture tiles, grouped, each game once.
 *
 * Classic script right behind <section id="gtWall">, so the wall is there before the first paint (no layout shift). The games, their
 * groups and their order (real use) come from arcade-catalogue.js; nothing is listed here.
 *   - tiles are plain links (hub ?g=<id>, or the game's own page); home.js records the click in `appUsage` as on every other link
 *   - pictures are pb/thumbs/s/<id>.webp (320 px) and load when their tile comes near the screen
 *   - "Weider spillen" (signed in): games from `appUsage` (last opened first), then games with a save or a best score on this device.
 *     Those are not repeated below, so every game stands on the page exactly once
 *   - chips and the search field filter the wall: matches stand in one continuous grid, in the same order */
(function () {
  "use strict";

  var catalogue = window.ArcadeCatalogue;
  var wall = document.getElementById("gtWall");
  if (!catalogue || !wall) return;   // the ink cell below still leads to the arcade

  var RECENT_MAX_PHONE = 8;   // the row scrolls sideways there
  var PHONE = "(max-width: 700px)";
  var USAGE_KEY = "appUsage";
  var GAME_KEY = /^pixelbreak\.html\?g=([a-z0-9-]{1,40})$/;
  var LOCAL_KEY = /^pb_(?:save|best)_(.+)$/;
  var NEAR = "200px 0px";
  var ALL = "all";
  var CHIPS = [{ id: ALL, label: "games.all" }].concat(catalogue.GROUPS).concat([{ id: "webcam", label: "games.g.webcam" }]);
  var state = { filter: ALL, query: "" };

  function t(key) { return window.I18N ? window.I18N.t(key) : key; }
  function esc(text) {
    return String(text).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function plain(text) { return String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); }

  /* ---------- games of this player on this device ---------- */
  function gameOfKey(id) {
    if (catalogue.byId(id)) return id;
    // boards and saves of one game may carry a suffix ("ski-…", "minesweeper-hard"): the longest id that starts it
    var owner = catalogue.GAMES.filter(function (g) { return id.indexOf(g.id + "-") === 0; })
      .sort(function (a, b) { return b.id.length - a.id.length; })[0];
    return owner ? owner.id : null;
  }

  function openedLast() {
    var usage = JSON.parse(localStorage.getItem(USAGE_KEY) || "{}") || {};
    return Object.keys(usage).map(function (key) {
      var match = GAME_KEY.exec(key);
      var page = match ? null : catalogue.GAMES.find(function (g) { return g.app === key; });
      return { id: match ? match[1] : page ? page.id : null, at: Number(usage[key] && usage[key].ts) || 0 };
    }).filter(function (entry) { return entry.id; })
      .sort(function (a, b) { return b.at - a.at; })
      .map(function (entry) { return entry.id; });
  }

  function playedHere() {
    var ids = [];
    for (var i = 0; i < localStorage.length; i += 1) {
      var match = LOCAL_KEY.exec(localStorage.key(i) || "");
      var id = match && gameOfKey(match[1]);
      if (id) ids.push(id);
    }
    return catalogue.rankedCopy(catalogue.GAMES.filter(function (g) { return ids.indexOf(g.id) > -1; })).map(function (g) { return g.id; });
  }

  function recentGames() {
    if (!document.documentElement.classList.contains("auth-in")) return [];   // theme.js sets it before the first paint
    // one row: the heading takes the first place
    var columns = Number(getComputedStyle(wall).getPropertyValue("--n")) || 8;
    var max = window.matchMedia(PHONE).matches ? RECENT_MAX_PHONE : columns - 1;
    try {
      var ids = openedLast().concat(playedHere());
      return ids.filter(function (id, i) { return ids.indexOf(id) === i; })
        .map(catalogue.byId).filter(Boolean).slice(0, max);
    } catch (error) {
      return [];   // private mode or a broken store: no personal row
    }
  }

  /* ---------- markup ---------- */
  function tileHtml(g) {
    var feature = window.ArcadeFeature && window.ArcadeFeature.config.id === g.id;
    var tag = feature ? '<span class="gw-tag arc-feat" data-feat-text="new">' + esc(window.ArcadeFeature.text("new")) + "</span>" : "";
    return '<li role="listitem" data-group="' + g.group + '">' +
      '<a class="gw-t" href="' + esc(catalogue.gameLink(g)) + '" data-app="' + esc(g.app || "pixelbreak.html") + '" data-game="' + g.id + '">' +
      '<span class="gw-p">' + tag + '<img data-src="' + catalogue.smallThumb(g.id) + '" alt="" width="320" height="200" decoding="async"></span>' +
      '<span class="gw-n">' + esc(catalogue.tileName(g)) + "</span></a></li>";
  }

  function sectionHtml(section) {
    return '<div class="gw-sec" data-sec="' + section.id + '">' +
      '<h3 class="gw-h" id="gw-' + section.id + '"><span data-i18n="' + section.label + '">' + esc(t(section.label)) + "</span>" + (section.id === "recent" ? "" : '<small aria-hidden="true">' + section.games.length + "</small>") + "</h3>" +
      '<ul class="gw-row" role="list" aria-labelledby="gw-' + section.id + '">' +
      section.games.map(tileHtml).join("") + "</ul></div>";
  }

  function toolsHtml() {
    return '<div class="gw-tools" role="search" data-i18n-attr="aria-label:games.filter" aria-label="' + esc(t("games.filter")) + '">' +
      '<label class="gw-find"><svg class="ic" aria-hidden="true"><use href="#i-magnifying-glass"/></svg>' +
      '<input type="search" id="gwFind" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" data-i18n-attr="placeholder:games.find|aria-label:games.find" placeholder="' + esc(t("games.find")) + '" aria-label="' + esc(t("games.find")) + '"></label>' +
      '<div class="gw-chips">' + CHIPS.map(function (chip) {
        return '<button type="button" data-chip="' + chip.id + '" aria-pressed="' + (chip.id === ALL) + '" data-i18n="' + chip.label + '">' + esc(t(chip.label)) + "</button>";
      }).join("") + "</div></div>";
  }

  function render() {
    var recent = recentGames();
    var sections = (recent.length ? [{ id: "recent", label: "games.g.recent", games: recent }] : []).concat(catalogue.homeSections(recent));
    wall.innerHTML = toolsHtml() +
      '<a class="gw-skip" href="#gtAll" data-i18n="games.skip">' + esc(t("games.skip")) + "</a>" +
      '<div class="gw-wall" id="gwWall">' +
      sections.filter(function (section) { return section.games.length; }).map(sectionHtml).join("") +
      '</div><p class="gw-none" id="gwNone" role="status" hidden></p>';
    wall.hidden = false;
    document.getElementById("gwWall").appendChild(document.getElementById("gtAll"));   // the ink cell closes the last row
    showCount();
    watchPictures();
    wireTools();
  }

  /* ---------- pictures ---------- */
  function load(img) {
    if (!img.dataset.src) return;
    var small = img.dataset.src;
    img.removeAttribute("data-src");
    img.onerror = function () { img.onerror = null; img.src = small.replace("/s/", "/"); };   // no small picture yet: the big one
    img.src = small;
  }

  function watchPictures() {
    var pictures = wall.querySelectorAll("img[data-src]");
    if (!("IntersectionObserver" in window)) { pictures.forEach(load); return; }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        load(entry.target);
      });
    }, { rootMargin: NEAR });
    pictures.forEach(function (img) { observer.observe(img); });
    // a row that scrolls sideways (phone): its other pictures as soon as it moves
    wall.querySelectorAll(".gw-row").forEach(function (row) {
      row.addEventListener("scroll", function () { row.querySelectorAll("img[data-src]").forEach(load); }, { passive: true, once: true });
    });
  }

  /* ---------- filter ---------- */
  var wordsById = {};
  function wordsOf(g) {   // name + the three descriptions, put together at the first search
    if (!wordsById[g.id]) wordsById[g.id] = plain([g.name, catalogue.tileName(g), g.desc, catalogue.descOf(g, "lb"), catalogue.descOf(g, "de"), g.id].join(" "));
    return wordsById[g.id];
  }

  function matches(g) {
    var isInChip = state.filter === ALL || g.group === state.filter || g.cats.indexOf(state.filter) > -1 && state.filter === "webcam";
    return isInChip && (!state.query || state.query.split(/\s+/).every(function (word) { return wordsOf(g).indexOf(word) > -1; }));
  }

  function applyFilter() {
    var isFiltered = state.filter !== ALL || state.query !== "";
    var shown = 0;
    wall.classList.toggle("is-filtered", isFiltered);
    wall.querySelectorAll("li[data-group]").forEach(function (item) {
      var hit = !isFiltered || matches(catalogue.byId(item.querySelector("a").dataset.game));
      item.hidden = !hit;
      if (hit) shown += 1;
    });
    wall.querySelectorAll("[data-chip]").forEach(function (chip) { chip.setAttribute("aria-pressed", String(chip.dataset.chip === state.filter)); });
    var none = document.getElementById("gwNone");
    none.hidden = shown > 0;
    none.textContent = shown > 0 ? "" : t("arc.emptyT");
  }

  function wireTools() {
    var input = document.getElementById("gwFind");
    input.addEventListener("input", function () { state = { filter: state.filter, query: plain(input.value) }; applyFilter(); });
    input.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !input.value) return;
      input.value = "";
      state = { filter: state.filter, query: "" };
      applyFilter();
    });
    wall.querySelectorAll("[data-chip]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        state = { filter: chip.dataset.chip, query: state.query };
        applyFilter();
      });
    });
  }

  function showCount() {
    document.getElementById("gtCount").textContent = t("arc.countAll").replace("{n}", String(catalogue.GAMES.length));
  }

  render();
  document.addEventListener("i18n:change", showCount);
})();
