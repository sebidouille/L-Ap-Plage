const CACHE = 'applage-v20260301111346';

const PRECACHE = [
    './',
    './index.html',
    './app.js',
    './style.css',
    './manifest.json',
    './images/bar.png',
    './images/resto.png',
    './images/auberge-pecheur.jpg',
    './images/baie-des-cures.jpg',
    './images/bao.jpg',
    './images/chochai.jpg',
    './images/chez-h.jpg',
    './images/cote-d-heno.jpg',
    './images/kermarec.jpg',
    './images/les-grands-sables.jpg',
    './images/les-sables-rouges.jpg',
    './images/les-saisies.jpg',
    './images/locmaria.jpg',
    './images/plage-du-wwf.jpg',
    './images/pointe-des-chats.jpg',
    './images/port-coustic.jpg',
    './images/port-lay.jpg',
    './images/port-melin.jpg',
    './images/port-melite.jpg',
    './images/port-morvil.jpg',
    './images/port-saint-nicolas.jpg',
    './images/porskedoul.jpg',
    './images/poulziorec.jpg',
    './images/stang.jpg'
];

// Installation : mise en cache des assets statiques
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE)
            .then(c => c.addAll(PRECACHE))
            .then(() => self.skipWaiting())
    );
});

// Activation : nettoyage des anciens caches
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // Ignorer les tuiles et ressources Mapbox (trop lourdes, déjà gérées par Mapbox)
    if (url.hostname.includes('mapbox.com')) return;

    // Google Sheets → network-first, fallback cache (données fraîches si réseau dispo)
    if (url.hostname.includes('docs.google.com')) {
        e.respondWith(
            fetch(e.request)
                .then(r => {
                    caches.open(CACHE).then(c => c.put(e.request, r.clone()));
                    return r;
                })
                .catch(() => caches.match(e.request))
        );
        return;
    }

    // Tout le reste → cache-first, mise en cache à la volée si absent
    e.respondWith(
        caches.match(e.request).then(cached => {
            if (cached) return cached;
            return fetch(e.request).then(r => {
                if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
                return r;
            });
        })
    );
});
