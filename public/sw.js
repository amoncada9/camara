// Minimal Service Worker for PWA installability
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  // Basic fetch handler
  event.respondWith(fetch(event.request));
});
