// Network first: always show the latest stats and code, fall back to the
// cached copy when offline. No cache version to bump on deploy.
const CACHE = "anari";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  // Ignore the ?t= cache-buster so the offline copy is found
  const key = req.url.split("?")[0];
  e.respondWith(
    // no-cache: revalidate with the server instead of using a stale HTTP-cached copy
    fetch(req.url, { cache: "no-cache", credentials: "same-origin" })
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
        return res;
      })
      .catch(() => caches.match(key))
  );
});
