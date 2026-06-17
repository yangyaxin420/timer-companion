const CACHE = 'focus-v3'
const FILES = ['/', '/index.html', '/css/style.css', '/js/app.js', '/js/config.js', '/manifest.json']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)))
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    Promise.all([
      caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))),
      // 立即接管所有页面
      self.clients.claim()
    ])
  )
})

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  )
})
