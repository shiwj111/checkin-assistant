      
const CACHE = 'checkin-v1';
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.add('/'))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(caches.delete)))));
self.addEventListener('fetch', e => e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))));

    
