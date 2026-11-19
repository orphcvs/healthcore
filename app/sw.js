// Offline: app files and the model come from the cache, photos are cached when first seen, the API never.
// server.py swaps the dev version below for a hash of all app files, so every deploy gets a fresh cache.
const VERSION = "hc-dev";
const PHOTOS = "hc-photos";
const PRECACHE = [
  "./", "index.html", "theme.js", "style.css", "manifest.webmanifest",
  "app.js", "dom.js", "regions.js", "generator.js", "progress.js", "store.js", "model.js",
  "muscles.js", "plans.js", "training.js", "history.js", "exercises.js",
  "vendor/three.module.js", "vendor/OrbitControls.js",
  "data/exercises.json", "data/model.json", "data/model.bin",
  "fonts/mona-sans.woff2", "fonts/plex-mono-400.woff2", "fonts/plex-mono-500.woff2",
  "icons/favicon.svg", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== PHOTOS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function photo(request) {
  const cache = await caches.open(PHOTOS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/api/")) return;
  if (url.pathname.includes("/img/")) return e.respondWith(photo(e.request));
  const page = e.request.mode === "navigate" ? new URL("./", self.registration.scope).href : e.request;
  e.respondWith(caches.open(VERSION).then(c => c.match(page, { ignoreSearch: true })).then(hit => hit || fetch(e.request)));
});

// The app sends the photos of every exercise in a plan, so they are there in the gym without signal.
self.addEventListener("message", e => {
  if (e.data?.type !== "precache-images") return;
  e.waitUntil(caches.open(PHOTOS).then(c => Promise.all(e.data.urls.map(u => c.match(u).then(hit => hit || c.add(u).catch(() => {}))))));
});
