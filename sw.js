const CACHE_NAME = 'cermaq-bodega-v3';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './Cermaq_logo2.png',
    './Q.png',
    './manifest.json',
    'https://unpkg.com/html5-qrcode',
    'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap',
    'https://fonts.googleapis.com/icon?family=Material+Icons+Round'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((response) => response || fetch(e.request))
    );
});
