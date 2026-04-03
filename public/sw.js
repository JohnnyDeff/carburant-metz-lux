// Nom du cache
const CACHE_NAME = 'carbumap-v1';

// Étape d'installation : le navigateur enregistre l'application
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installation terminée.');
    self.skipWaiting();
});

// Étape d'activation
self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Activé et prêt à gérer les requêtes.');
    event.waitUntil(self.clients.claim());
});

// Interception des requêtes : on laisse tout passer pour avoir les prix en temps réel
self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request));
});
