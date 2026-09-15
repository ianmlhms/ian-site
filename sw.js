/* Service worker for ian.lu.
 * 1) Web Push notifications (Messenger, calls, mentions).
 * 2) Offline app-shell caching (#20) so the site behaves like an installed app.
 *    Safe with the site's ?v= versioning: bumped asset URLs are cache misses and
 *    fetch fresh; navigations are network-first so pages are never stale online. */

const CACHE = "ianlu-v8";
const CORE = [
  "index.html", "favicon.svg", "apple-touch-icon.png", "site.webmanifest",
  "skylens.html", "skylens.css?v=4", "skylens.js?v=6", "skylens.webmanifest",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch((error) => console.warn("[SW] precache failed", error))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // let CDN/Supabase pass straight through

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
        event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy))
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
