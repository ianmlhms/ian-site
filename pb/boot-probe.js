/* Starts a big game's entry module and, when it does not load, says WHY on the loading screen instead of hanging silently.
 *
 * A failed module graph (a file blocked by a school web filter, an HTML block page instead of JS, a syntax the browser does not know, a request that
 * never answers) rejects import() with a bare "Importing a module script failed" in Safari, or never settles at all. Then this walks the import graph
 * from the entry, fetches every file once and lists the ones that are not a 200 JavaScript response, together with the browser version, so a photo
 * of the screen is enough to find the cause.
 * Use: <script src="/pb/boot-probe.js?v=1"></script>, then bootProbe("/pb/<game>/main.js?v=N", { fail(text) {...} }) instead of import(). */
(function () {
  "use strict";
  if (window.bootProbe) return;

  var HANG_MS = 20000;          // the entry graph has not finished evaluating after this long: probe it
  var FETCH_MS = 10000;         // one probe request may take this long
  var MAX_FILES = 120;
  var IMPORT_RE = /(?:^|[;\s}])(?:import|export)\s*(?:[\w*{}\s,$]*?\sfrom\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error("timeout " + ms / 1000 + " s")); }, ms);
      promise.then(function (value) { clearTimeout(timer); resolve(value); }, function (error) { clearTimeout(timer); reject(error); });
    });
  }

  function shortName(url) {
    try { var u = new URL(url); return u.pathname.replace(/^\/pb\//, "") + (u.search || ""); } catch (error) { return String(url); }
  }

  function specifiersOf(text) {
    var found = [];
    var code = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
    var match;
    IMPORT_RE.lastIndex = 0;
    while ((match = IMPORT_RE.exec(code))) found.push(match[1] || match[2]);
    return found.filter(function (spec) { return /^(\.{1,2}\/|\/)/.test(spec); });
  }

  /** Fetches every file of the import graph once; resolves to the list of problems ("file: what"). */
  function crawl(entry) {
    var seen = {};
    var problems = [];
    var count = 0;
    function visit(url) {
      if (seen[url] || count >= MAX_FILES) return Promise.resolve();
      seen[url] = true;
      count += 1;
      return withTimeout(fetch(url, { cache: "no-store" }), FETCH_MS)
        .then(function (res) {
          var type = res.headers.get("content-type") || "";
          if (!res.ok) { problems.push(shortName(url) + ": HTTP " + res.status); return null; }
          if (type && !/javascript|ecmascript/i.test(type)) problems.push(shortName(url) + ": type " + type.split(";")[0]);
          return res.text();
        })
        .then(function (text) {
          if (text === null) return null;
          var children = specifiersOf(text).map(function (spec) { return new URL(spec, url).href; });
          return Promise.all(children.map(visit));
        })
        .catch(function (error) { problems.push(shortName(url) + ": " + (error && error.message || error)); });
    }
    return visit(new URL(entry, location.href).href).then(function () { return { problems: problems, files: count }; });
  }

  function browserLine() {
    var ua = navigator.userAgent || "";
    var os = /OS (\d+[_.]\d+(?:[_.]\d+)?)/.exec(ua);
    var safari = /Version\/([\d.]+)/.exec(ua);
    return (os ? "iOS " + os[1].replace(/_/g, ".") : "") + (safari ? " Safari " + safari[1] : "") + (os || safari ? "" : ua.slice(0, 120));
  }

  function report(entry, loader, reason, isFinal) {
    console.error("[boot-probe]", reason);
    crawl(entry).then(function (result) {
      var lines = ["⚠ " + reason]
        .concat(result.problems.length ? result.problems.slice(0, 8) : ["all " + result.files + " files OK (code error?)"])
        .concat([browserLine()]);
      var text = lines.join("\n");
      document.documentElement.dataset.bootError = text;
      if (isFinal && loader && typeof loader.fail === "function") loader.fail();   // a slow but healthy load must still be able to finish: only a rejected import ends the loader
      var box = document.querySelector("#loading .box") || document.body;
      var pre = document.createElement("pre");
      pre.className = "boot-probe";
      pre.textContent = text;
      pre.style.cssText = "margin:10px auto 0;max-width:92vw;white-space:pre-wrap;word-break:break-word;text-align:left;font:11px/1.35 ui-monospace,Menlo,monospace;" +
        "color:#ffd9a8;background:rgba(0,0,0,.45);padding:8px 10px;border-radius:8px;user-select:text;-webkit-user-select:text";
      box.appendChild(pre);
    });
  }

  window.bootProbe = function (entry, loader) {
    var settled = false;
    var timer = setTimeout(function () { if (!settled) report(entry, loader, "code not loaded after " + HANG_MS / 1000 + " s", false); }, HANG_MS);
    return import(entry).then(function (module) {
      settled = true;
      clearTimeout(timer);
      Array.prototype.forEach.call(document.querySelectorAll("pre.boot-probe"), function (node) { node.parentNode.removeChild(node); });   // it did load after all
      return module;
    }, function (error) {
      settled = true;
      clearTimeout(timer);
      report(entry, loader, (error && error.name ? error.name + ": " : "") + (error && error.message || String(error)), true);
    });
  };
})();
