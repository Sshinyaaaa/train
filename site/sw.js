// Service worker (PLAN.md §4g): installable, and plans trips offline from the cached network.json.
//
// Same-origin GETs are network-first (revalidated with no-cache, so a deploy is picked up on the
// next online visit, network.json included) and fall back to the cache when offline or slow.
// Cross-origin requests (Photon, OSRM, OSM tiles, Leaflet, fonts) are never intercepted or cached.

const VERSION = "2";                       // bump when this file or PRECACHE changes
const CACHE = `klrail-${VERSION}`;
const SLOW_MS = 4000;                      // with a cached copy, don't wait longer than this
const PRECACHE = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "router.js",
  "fares.js",
  "walk.js",
  "config.js",
  "favs.js",
  "nearby.js",
  "search.js",
  "state.js",
  "share.js",
  "theme.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
  "data/network.json",
];

const scope = () => self.registration.scope;
// Navigations (any page URL in scope) map to the app page; other files ignore the query string.
const cacheKey = (req) => (req.mode === "navigate" ? scope() : req.url.split("?")[0]);

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(PRECACHE.map((u) => new Request(new URL(u, scope()).href, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("klrail-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || !req.url.startsWith(scope())) return;   // cross-origin / out of scope: browser handles it
  const key = cacheKey(req);
  const fresh = fetch(req, { cache: "no-cache" });
  // keep the cache current whenever the network answers, even if the cached copy was served
  e.waitUntil(fresh.then(async (res) => {
    if (res.ok) await (await caches.open(CACHE)).put(key, res.clone());
  }).catch(() => {}));
  e.respondWith(respond(key, fresh));
});

async function respond(key, fresh) {
  const cached = await caches.match(key);
  if (!cached) return fresh;
  const slow = new Promise((r) => setTimeout(() => r(null), SLOW_MS));
  try {
    const res = await Promise.race([fresh.then((r) => r.clone()), slow]);
    return res && res.ok ? res : cached;
  } catch {
    return cached;                          // offline
  }
}
