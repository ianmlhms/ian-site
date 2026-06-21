/* Service worker for ian.lu — Web Push notifications (Messenger).
 * Kept tiny on purpose: it only handles incoming pushes and clicks. The page
 * registers it (notify.js). Bump CACHE_TAG if you ever add real caching. */
const CACHE_TAG = "ianlu-sw-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = {}; }
  const title = d.title || "💬 Messenger";
  const options = {
    body: d.body || "New message",
    icon: "favicon.svg",
    badge: "favicon.svg",
    tag: d.group_id ? "grp-" + d.group_id : "msgr",   // collapse repeats per chat
    renotify: true,
    data: { url: d.url || "messenger.html" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "messenger.html";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes("messenger") && "focus" in w) return w.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
