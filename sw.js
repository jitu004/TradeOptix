// TradeOptix service worker — network-first (live data priority), cache fallback for shell
const CACHE = "tfx-shell-v1";
const SHELL = ["/", "/index.html", "/v4.js", "/icon-192.png", "/icon-512.png", "/dog-up.png", "/dog-down.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // API + live data: network only (never cache)
  if (url.origin !== location.origin || e.request.method !== "GET") return;
  // Shell: network-first, cache fallback
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html")))
  );
});
