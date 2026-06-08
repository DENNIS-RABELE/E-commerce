const CACHE_NAME = "ict-commerce-client-web-v1";
const ASSETS = [
  "index.html",
  "styles.css",
  "client.js",
  "manifest.webmanifest",
  "assets/customer-suite.svg",
  "assets/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("fetch", (event) => {
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
