// Med Med service worker: shows missed-dose alerts and opens the app when one is tapped.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Med Med", {
    body: d.body || "A dose for Yuki isn't logged yet.",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: d.tag || "med-med",
    data: { url: d.url || "./#today" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data && e.notification.data.url || "./#today", self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) { await w.focus(); return w.navigate ? w.navigate(url) : undefined; }
    }
    return self.clients.openWindow(url);
  })());
});
