/* ian.lu's own visitor counter (the Worker in cloudflare/ian-count). One small request per page view plus a few "still here" pings,
 * so the traffic page can show visits, pages and time on page. What it sends: a random id that lives in sessionStorage (it ends
 * with the tab and is never stored anywhere permanent), the page path (no query, except the arcade's game id), the referrer's
 * host, screen size, language and time zone. No cookies, no localStorage, no fingerprint; the server does not keep the address.
 * Off with Do Not Track / Global Privacy Control, in automated browsers, on local copies and inside game frames.
 * Plain ES5 on purpose: it has to run on old school iPads, and it must never throw or slow a page. Loaded with defer. */
(function () {
  'use strict';
  try {
    var win = window, doc = document, nav = navigator, loc = location;
    var host = loc.hostname;
    // Tests (and only tests, and only on localhost) may set window.__IAN_COUNT_TEST__ = { endpoint: '...' } before this file runs.
    var test = win.__IAN_COUNT_TEST__;
    var isLocal = host === 'localhost' || host === '127.0.0.1';
    if (!(test && typeof test === 'object' && isLocal)) {
      test = null;
      if (host !== 'ian.lu' && host !== 'www.ian.lu') return;
      if (nav.webdriver) return;
    }
    if (nav.doNotTrack === '1' || win.doNotTrack === '1' || nav.msDoNotTrack === '1' || nav.globalPrivacyControl) return;
    try { if (win.top !== win.self) return; } catch (error) { return; }          // a game inside an iframe: the hub page counts it
    if (win.ianCount) return;                                                    // included twice

    var ENDPOINT = (test && typeof test.endpoint === 'string') ? test.endpoint : 'https://ian-count.ianlu.workers.dev/hit';
    var SID_KEY = 'ic_sid', FIRST_KEY = 'ic_first';
    var sid = '', first = false;
    try {
      sid = sessionStorage.getItem(SID_KEY) || '';
      if (!/^[A-Za-z0-9_-]{8,40}$/.test(sid)) {
        var bytes = new Uint8Array(12), id = '';
        if (win.crypto && win.crypto.getRandomValues) win.crypto.getRandomValues(bytes);
        else for (var i = 0; i < 12; i++) bytes[i] = Math.floor(Math.random() * 256);
        for (var j = 0; j < 12; j++) id += (bytes[j] + 256).toString(16).slice(1);
        sid = (test && test.sidPrefix ? String(test.sidPrefix) : '') + id;
        sessionStorage.setItem(SID_KEY, sid);
      }
      first = !sessionStorage.getItem(FIRST_KEY);
      if (first) sessionStorage.setItem(FIRST_KEY, '1');
    } catch (error) { return; }                                                  // no storage: every page would look like a new visitor, so count none

    function send(data, beacon) {
      try {
        var body = JSON.stringify(data);
        if (beacon && nav.sendBeacon && nav.sendBeacon(ENDPOINT, body)) return;
        if (win.fetch) {
          win.fetch(ENDPOINT, { method: 'POST', body: body, keepalive: true, credentials: 'omit', mode: 'cors', headers: { 'content-type': 'text/plain' } })
            .catch(function () { /* statistics only */ });
        }
      } catch (error) { /* statistics only */ }
    }

    function pagePath() {
      var path = loc.pathname || '/';
      var game = /(?:^\?|&)g=([A-Za-z0-9_-]{1,40})(?:&|$)/.exec(loc.search || '');
      return path === '/pixelbreak.html' && game ? path + '?g=' + game[1] : path;
    }

    function view(path, title, isFirst) {
      var ref = '';
      try { ref = doc.referrer || ''; } catch (error) { ref = ''; }
      send({
        sid: sid, kind: 'view', path: path, title: String(title || '').slice(0, 100), ref: isFirst ? ref : '',
        w: win.screen ? win.screen.width : 0, h: win.screen ? win.screen.height : 0, dpr: win.devicePixelRatio || 1,
        lang: nav.language || '', tz: tz(), tp: nav.maxTouchPoints || 0, f: isFirst ? 1 : 0
      });
    }
    function tz() {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (error) { return ''; }
    }

    // "Still here" pings, only while the page is visible: 30 s apart for 2 min, then 1 min until 10 min, then 5 min until 1 h
    // (22 pings at most per page, then silence) plus one when the page is left.
    var shownAt = Date.now(), visibleBefore = 0, timer = 0, lastPing = Date.now();
    function visibleMs() { return visibleBefore + (doc.visibilityState === 'hidden' ? 0 : Date.now() - shownAt); }
    function gap(ms) { return ms < 120000 ? 30000 : ms < 600000 ? 60000 : ms < 3600000 ? 300000 : 0; }
    function ping(beacon) { lastPing = Date.now(); send({ sid: sid, kind: 'ping' }, beacon); }
    function schedule() {
      clearTimeout(timer);
      if (doc.visibilityState === 'hidden') return;
      var wait = gap(visibleMs());
      if (!wait) return;
      timer = setTimeout(function () { ping(false); schedule(); }, wait);
    }
    function leave() {
      clearTimeout(timer);
      if (Date.now() - lastPing > 15000) ping(true);
    }
    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState === 'hidden') { visibleBefore += Date.now() - shownAt; leave(); }
      else { shownAt = Date.now(); schedule(); }
    });
    win.addEventListener('pagehide', function () { visibleBefore = visibleMs(); leave(); });

    // The arcade hub opens games without loading a page: it calls ianCount.view('/pixelbreak.html?g=<id>').
    win.ianCount = { view: function (path, title) { try { if (typeof path === 'string') view(path, title || doc.title, false); } catch (error) { /* statistics only */ } } };

    view(pagePath(), doc.title, first);
    schedule();
  } catch (error) { /* a counter must never break a page */ }
})();
