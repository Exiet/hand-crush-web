self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('hand-crush-web-v1').then((cache) =>
      cache.addAll(['/', '/manifest.webmanifest', '/icon-192.svg', '/icon-512.svg', '/favicon.svg']),
    ),
  )
})

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request)),
  )
})
