/* Service worker for ian.lu.
 * 1) Web Push notifications (Messenger, calls, mentions).
 * 2) Offline app-shell caching (#20) so the site behaves like an installed app.
 *    Safe with the site's ?v= versioning: bumped asset URLs are cache misses and
 *    fetch fresh; navigations are network-first so pages are never stale online. */

const CACHE = "ianlu-v2";
const CORE = [
  "index.html", "favicon.svg", "apple-touch-icon.png", "site.webmanifest",
  "skylens.html", "skylens.css?v=1", "skylens.js?v=1", "skylens.webmanifest",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})));
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

  const isNav = req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");

  if (isNav) {
    // network-first: fresh when online, cached copy (or Home) when offline
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match("index.html")))
    );
    return;
  }

  // static assets: cache-first, then network (and cache it for next time)
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => cached))
  );
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
