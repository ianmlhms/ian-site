/* Service worker for ian.lu.
 * 1) Web Push notifications (Messenger, calls, mentions).
 * 2) Offline app-shell caching (#20) so the site behaves like an installed app.
 *    Safe with the site's ?v= versioning: bumped asset URLs are cache misses and
 *    fetch fresh; navigations are network-first so pages are never stale online. */

/* v13 (fail-safe game data, 28 Oct 2026): players opening MTB / Schueberfouer for the FIRST time (nothing stored yet) stayed on the loading screen.
 * Now the game-data path can never block or fail a file the network could deliver: every cache step has a time limit, waitUntil is guarded (WebKit throws
 * when it is called after the fetch event was dispatched), and any error falls back to a plain network fetch.
 * v12 (game worlds on the device): adds the separate cache GAMEDATA_CACHE (see "Game data" below) for the big data files of pb/<game>/data/.
 * This cache is NOT part of CACHE: activate keeps it, so a new CACHE name never throws the downloaded worlds away.
 * v11 (Schueberfouer Tycoon launch): drops every cache entry a player's browser kept of the old Theme Park Tycoon page and arcade.
 * pb/fouer.html, its modules and pb/fouer/data/glacis-world.bin (about 600 KB) are NOT precached on purpose: all /pb/ requests go to
 * the network first (see below) and the browser's own HTTP cache keeps the bundle, a second copy here would only cost storage. */
const CACHE = "ianlu-v13";
const GAMEDATA_CACHE = "ianlu-gamedata-v1";
const CORE = [
  "index.html", "favicon.svg", "apple-touch-icon.png", "site.webmanifest",
  "skylens.html", "skylens.css?v=5", "skylens.js?v=7", "skylens.webmanifest",
];

/* ---- Game data -------------------------------------------------------------------------------------------------------------------------------
 * The worlds of the big games (MTB, Schueberfouer, Zuchsimulator) are files below /pb/<game>/data/ that change rarely (a bake script rewrites them) and
 * weigh megabytes. The host sends no Cache-Control for them, so the browser's HTTP cache revalidates or re-downloads them on many opens. Here they are
 * kept on the device instead, and a CONTENT HASH decides whether a stored copy is still the right one:
 *
 *   /pb/<game>/data-hashes.json   written by scripts/gamedata_manifest.py: { v: 1, files: { "<path below data/>": "<first 10 hex of the SHA-256>" } }
 *
 * The manifest is always read from the network first (a small conditional request, offline it falls back to the stored copy) and is trusted over the
 * ?v= of the request, which the games set by hand or not at all. A stored copy is served only while its hash equals the manifest's, so a data file can
 * never freeze: a changed file has a new hash, the old copy is a miss, the new one is fetched, checked against its hash, stored, and every older copy of
 * that path is deleted. Files the manifest does not list, ranged requests and failed responses go to the network exactly as before.
 * The code (HTML, JS modules, CSS) stays network-first below: that is what un-freezes a game after a rewrite, and it must not change.
 */
const GAMEDATA_GAMES = Object.freeze(["fouer", "mtb", "train-sim"]);   // the pb/<game> folders that have data-hashes.json (scripts/check_site.py keeps this list in step)
const GAMEDATA_PATH = /^\/pb\/([a-z0-9-]+)\/data\/(.+)$/;
const GAME_PAGE = /^\/pb\/([a-z0-9-]+)\.html$/;
const MANIFEST_FILE = "data-hashes.json";
const MANIFEST_FORMAT = 1;
const HASH_LEN = 10;                       // keep equal to HASH_LEN in scripts/gamedata_manifest.py
const MANIFEST_FRESH_MS = 5 * 60 * 1000;   // a running worker re-reads the manifest this often (a deploy during a long session)
const MANIFEST_RETRY_MS = 30 * 1000;       // after a failed read (offline) the stored manifest is used and the network is retried this soon
const STATS_DELAY_MS = 250;
const MANIFEST_WAIT_MS = 4000;             // a data file never waits longer than this for the manifest: after that it is fetched plainly from the network
const CACHE_WAIT_MS = 3000;                // the same for opening / reading the device cache (a stuck storage must not stall the world)                // the page hears about hits / misses at most this often

const manifests = new Map();               // game -> { files: Map<path, hash> | null, at, ttl } | { pending: Promise }
const gameStats = new Map();               // clientId -> { game, hits, misses, missBytes, timer }

const manifestUrl = (game) => `/${["pb", game, MANIFEST_FILE].join("/")}`;
const hashedKey = (pathname, hash) => new Request(`${self.location.origin}${pathname}?v=${hash}`);

/** Parses a manifest into a Map; null when it is not a version-1 manifest (a broken file must not poison the cache). */
function parseManifest(text) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || parsed.v !== MANIFEST_FORMAT || !parsed.files || typeof parsed.files !== "object") return null;
    const entries = Object.entries(parsed.files).filter(([path, hash]) => path && typeof hash === "string" && hash.length === HASH_LEN);
    return new Map(entries);
  } catch (error) {
    console.warn("[SW] bad game data manifest", error);
    return null;
  }
}

/** Reads one game's manifest: network first (revalidated), the stored copy when offline. Resolves to { files, ttl }; files is null for a game without one. */
async function readManifest(game, cache) {
  const url = manifestUrl(game);
  let text = null;
  let online = false;
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (res.ok) { text = await res.text(); online = true; }
    else if (res.status === 404) { await cache.delete(url); return { files: null, ttl: MANIFEST_FRESH_MS }; }
  } catch (error) { /* offline: use the stored copy */ }
  if (text === null) {
    const stored = await cache.match(url);
    text = stored ? await stored.text() : null;
  }
  const files = text === null ? null : parseManifest(text);
  if (online && files) {
    const stored = await cache.match(url);
    const storedText = stored ? await stored.text() : null;
    if (storedText !== text) {
      await cache.put(url, new Response(text, { headers: { "content-type": "application/json" } }));
      await pruneGame(game, files, cache);
    }
  }
  return { files, ttl: online ? MANIFEST_FRESH_MS : MANIFEST_RETRY_MS };
}

/** Deletes every stored copy of a game whose path is gone from the manifest or whose hash is no longer the current one. */
async function pruneGame(game, files, cache) {
  const prefix = `/pb/${game}/data/`;
  const requests = await cache.keys();
  const outdated = requests.filter((request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(prefix)) return false;
    const path = decodePath(url.pathname.slice(prefix.length));
    return files.get(path) !== url.searchParams.get("v");
  });
  await Promise.all(outdated.map((request) => cache.delete(request)));
}

function decodePath(path) {
  try { return decodeURIComponent(path); } catch (error) { return path; }
}

/** The manifest of a game (cached in memory for MANIFEST_FRESH_MS; concurrent callers share one read). */
async function loadManifest(game) {
  const known = manifests.get(game);
  if (known && known.pending) return known.pending;
  if (known && Date.now() - known.at < known.ttl) return known;
  const pending = caches.open(GAMEDATA_CACHE)
    .then((cache) => readManifest(game, cache))
    .catch((error) => { console.warn("[SW] manifest read failed", error); return { files: null, ttl: MANIFEST_RETRY_MS }; })
    .then((result) => {
      const entry = Object.freeze({ files: result.files, at: Date.now(), ttl: result.ttl });
      manifests.set(game, entry);
      return entry;
    });
  manifests.set(game, { pending });
  return pending;
}

/** Resolves like `promise`, or with `fallback` after `ms` (the promise keeps running; its late result is ignored). */
function withTimeout(promise, ms, fallback) {
  let timer = 0;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([Promise.resolve(promise).catch(() => fallback), late]).finally(() => clearTimeout(timer));
}

/** event.waitUntil that never throws: WebKit rejects a waitUntil called after the fetch event was dispatched; the work then simply runs unguarded. */
function keepAlive(event, promise) {
  try { event.waitUntil(promise); } catch (error) { /* the promise still runs; only the worker's lifetime is not extended */ }
}

/** sha-256 of the body, first HASH_LEN hex characters. */
async function hashOf(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, HASH_LEN);
}

/** Stores one verified copy and deletes the older copies of the same path (they differ only by ?v=). */
async function storeVersion(cache, pathname, key, response) {
  await cache.put(key, response);
  const siblings = await cache.keys(new Request(`${self.location.origin}${pathname}`), { ignoreSearch: true });
  await Promise.all(siblings.filter((request) => request.url !== key.url).map((request) => cache.delete(request)));
}

/** Tells the page how its data came in, so it can say "from this device" (pb/game-data.js). */
function reportToPage(event, game, source, bytes) {
  const id = event.clientId;
  if (!id) return;
  const stats = gameStats.get(id) || { game, hits: 0, misses: 0, missBytes: 0, timer: 0 };
  const next = { ...stats, game, hits: stats.hits + (source === "device" ? 1 : 0), misses: stats.misses + (source === "device" ? 0 : 1), missBytes: stats.missBytes + (source === "device" ? 0 : bytes) };
  if (!next.timer) {
    next.timer = setTimeout(async () => {
      const current = gameStats.get(id);
      if (current) gameStats.set(id, { ...current, timer: 0 });
      const client = await self.clients.get(id).catch(() => null);
      if (client && current) client.postMessage({ type: "ianlu-gamedata", game: current.game, hits: current.hits, misses: current.misses, missBytes: current.missBytes });
    }, STATS_DELAY_MS);
  }
  gameStats.set(id, next);
}

/** Re-reads a game's manifest now. Called when a game page is requested, so a new deploy's data is never judged by a manifest older than the page that needs it. */
function refreshManifest(game) {
  const known = manifests.get(game);
  if (known && known.pending) return known.pending;
  manifests.delete(game);
  return loadManifest(game);
}

/** The reply for one data file: the stored copy when its hash is the manifest's, else the network (and a new stored copy). */
async function serveGameData(event, game, relative) {
  const req = event.request;
  const url = new URL(req.url);
  const manifest = await withTimeout(loadManifest(game), MANIFEST_WAIT_MS, null);
  const hash = manifest && manifest.files && manifest.files.get(decodePath(relative));
  if (!hash) return fetch(req).catch(() => caches.match(req));   // not a listed file (or no manifest in time): as before, the network (the cache only offline)

  const cache = await withTimeout(caches.open(GAMEDATA_CACHE), CACHE_WAIT_MS, null);
  if (!cache) return fetch(req);
  const key = hashedKey(url.pathname, hash);
  const stored = await withTimeout(cache.match(key), CACHE_WAIT_MS, null);
  if (stored) { reportToPage(event, game, "device", 0); return stored; }

  try {
    const res = await fetch(key.url, { cache: "no-cache" });   // the ?v=<hash> URL: never answered by an old copy in the HTTP cache
    if (!res.ok || res.status !== 200) return res;
    const buffer = await res.arrayBuffer();
    const headers = res.headers.get("content-type") ? { "content-type": res.headers.get("content-type") } : {};
    const verified = (await hashOf(buffer)) === hash;
    if (verified) keepAlive(event, storeVersion(cache, url.pathname, key, new Response(buffer, { headers })).catch((error) => console.warn("[SW] game data not stored", error)));
    else { console.warn("[SW] game data does not match its hash, not stored:", url.pathname); manifests.delete(game); }
    reportToPage(event, game, "network", buffer.byteLength);
    return new Response(buffer, { headers });
  } catch (error) {
    const older = await withTimeout(cache.match(new Request(`${self.location.origin}${url.pathname}`), { ignoreSearch: true }), CACHE_WAIT_MS, null);   // offline: an older copy beats no world
    if (older) return older;
    throw error;
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch((error) => console.warn("[SW] precache failed", error))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== GAMEDATA_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // let CDN/Supabase pass straight through

  const gameData = GAMEDATA_PATH.exec(url.pathname);
  if (gameData && GAMEDATA_GAMES.includes(gameData[1]) && !req.headers.has("range")) {
    event.respondWith(serveGameData(event, gameData[1], gameData[2]).catch((error) => {   // whatever went wrong with the device copy: the network, as without this cache
      console.warn("[SW] game data path failed, plain fetch:", url.pathname, error);
      return fetch(req);
    }));
    return;
  }
  const gamePage = GAME_PAGE.exec(url.pathname);
  if (gamePage && GAMEDATA_GAMES.includes(gamePage[1])) keepAlive(event, refreshManifest(gamePage[1]).catch(() => null));   // the page itself is still network-first (next rule)

  /* PixelBreak game payloads are versioned by CONTENT, not by URL: pb/<game>.html
   * keeps its name across rewrites and the arcade re-fetches it on every open.
   * The cache-first branch below therefore froze a game at whatever version a
   * player first loaded — it pinned the old 2D Road Rage after its 3D rebuild,
   * and fetch({cache:"no-cache"}) does not help because that flag only bypasses
   * the HTTP cache, not the service worker. Always go to the network here, and
   * fall back to the cache only when offline. */
  if (url.pathname.startsWith("/pb/")) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  /* The /demo pages are a showcase Ian iterates on while showing it to people,
   * and their modules are only versioned by a hand-bumped ?v= that no automated
   * check watches (check_site.py's cache check reads root *.html only). That is
   * the same trap as /pb/ above, so take the same way out: always network, cache
   * only as an offline fallback. Nothing here is worth caching offline anyway. */
  if (url.pathname.startsWith("/demo")) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  const isNav = req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");

  const isMutable = /\.(?:m?js|css|json)$/i.test(url.pathname) && !url.searchParams.get("v");
  function fetchAndCache() {
    return fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        keepAlive(event, caches.open(CACHE).then((c) => c.put(req, copy))
          .catch((error) => console.warn("[SW] cache write failed", error)));
      }
      return res;
    });
  }
  async function networkFirst() {
    try {
      const res = await fetchAndCache();
      if (res.ok) return res;
      return await caches.match(req) || res;
    } catch (error) {
      const cached = await caches.match(req) || (isNav && await caches.match("index.html"));
      if (cached) return cached;
      throw error;
    }
  }

  // Mutable code/data and pages refresh online; versioned assets remain cache-first.
  event.respondWith(isNav || isMutable ? networkFirst() :
    caches.match(req).then((cached) => cached || fetchAndCache()));
});

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = {}; }
  const title = d.title || "💬 Messenger";
  const options = {
    body: d.body || "New message",
    icon: "favicon.svg",
    badge: "favicon.svg",
    tag: d.tag || (d.group_id ? "grp-" + d.group_id : "msgr"),
    renotify: true,
    data: { url: d.url || "messenger.html" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "messenger.html";
  const page = url.split("/").pop().split("?")[0].split("#")[0] || url;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (page && w.url.includes(page) && "focus" in w) return w.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
