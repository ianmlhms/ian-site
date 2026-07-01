/* Service worker for ian.lu — Web Push notifications (Messenger).
 * Kept tiny on purpose: it only handles incoming pushes and clicks. The page
 * registers it (notify.js). No fetch handler — pages are never cached here. */

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
    tag: d.tag || (d.group_id ? "grp-" + d.group_id : "msgr"),   // collapse repeats per source
    renotify: true,
    data: { url: d.url || "messenger.html" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "messenger.html";
  const page = url.split("/").pop().split("?")[0].split("#")[0] || url;   // e.g. "friends.html"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (page && w.url.includes(page) && "focus" in w) return w.focus();   // already on that page → focus it
      }
      return self.clients.openWindow(url);
    })
  );
});
