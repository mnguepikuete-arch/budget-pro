/**
 * FICHIER : sw.js (Service Worker)
 * RÔLE    : Permet à l'application de fonctionner HORS LIGNE
 *
 * Comment ça marche :
 * 1. Lors du premier chargement, le SW s'installe et met en cache tous les fichiers
 * 2. Quand l'utilisateur est hors ligne, le SW intercepte les requêtes réseau
 *    et retourne les fichiers depuis le cache
 * 3. Pour les requêtes API (données), on utilise une stratégie "Network first,
 *    then Cache" : on essaie le réseau, et si ça échoue, on prend le cache
 *
 * IMPORTANT : Ce fichier doit être à la RACINE du projet (même dossier qu'index.html)
 *             pour avoir le scope maximum
 */

// ── VERSION DU CACHE ──────────────────────────────────────────
// Changer ce numéro force la mise à jour du cache chez tous les utilisateurs
const CACHE_VERSION = 'budget-pro-v1.0.0';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;  // Pour les fichiers de l'appli
const API_CACHE     = `${CACHE_VERSION}-api`;     // Pour les données de l'API

// ── FICHIERS À METTRE EN CACHE (App Shell) ───────────────────
// Ces fichiers seront disponibles hors ligne
const STATIC_ASSETS = [
    '/budget-pro/index.html',
    '/budget-pro/login.html',
    '/budget-pro/style.css',
    '/budget-pro/app.js',
    '/budget-pro/auth.js',
    '/budget-pro/manifest.json',
    '/budget-pro/icons/icon-192.png',
    '/budget-pro/icons/icon-512.png',
    // Chart.js sera chargé depuis le cache du navigateur (CDN)
];

// ── ÉVÉNEMENT : INSTALLATION ──────────────────────────────────
// Se déclenche une seule fois quand le Service Worker est installé
self.addEventListener('install', (event) => {
    console.log('[SW] Installation en cours...');

    // waitUntil() dit au navigateur d'attendre la fin de cette promesse
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => {
            console.log('[SW] Mise en cache des fichiers statiques...');
            // addAll() télécharge et met en cache tous les fichiers
            return cache.addAll(STATIC_ASSETS);
        }).then(() => {
            // self.skipWaiting() active le SW immédiatement sans attendre
            self.skipWaiting();
        })
    );
});

// ── ÉVÉNEMENT : ACTIVATION ────────────────────────────────────
// Se déclenche quand le SW prend le contrôle (après install)
// On nettoie les anciens caches ici
self.addEventListener('activate', (event) => {
    console.log('[SW] Activation...');

    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    // Supprimer les caches qui ne correspondent pas à la version actuelle
                    if (cacheName !== STATIC_CACHE && cacheName !== API_CACHE) {
                        console.log('[SW] Suppression de l\'ancien cache :', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            // Prendre le contrôle de toutes les pages ouvertes
            self.clients.claim();
        })
    );
});

// ── ÉVÉNEMENT : INTERCEPTION DES REQUÊTES ────────────────────
// Se déclenche pour CHAQUE requête réseau de l'application
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // ── Stratégie pour les requêtes API (données dynamiques) ──
    // "Network First, Cache Fallback" : essayer le réseau, sinon le cache
    if (url.pathname.includes('/api/')) {
        event.respondWith(
            fetch(event.request)
                .then((networkResponse) => {
                    // Si on a une réponse réseau OK, on la met en cache pour plus tard
                    if (networkResponse.ok) {
                        const responseClone = networkResponse.clone();
                        caches.open(API_CACHE).then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return networkResponse;
                })
                .catch(() => {
                    // Pas de réseau → on cherche dans le cache
                    console.log('[SW] Hors ligne - Utilisation du cache API pour :', url.pathname);
                    return caches.match(event.request).then((cachedResponse) => {
                        if (cachedResponse) return cachedResponse;
                        // Aucun cache disponible → réponse d'erreur explicite
                        return new Response(
                            JSON.stringify({
                                success: false,
                                message: 'Vous êtes hors ligne. Les données affichées sont celles de votre dernière connexion.',
                                offline: true
                            }),
                            { headers: { 'Content-Type': 'application/json' } }
                        );
                    });
                })
        );
        return;
    }

    // ── Stratégie pour les fichiers statiques (HTML, CSS, JS) ─
    // "Cache First, Network Fallback" : d'abord le cache, puis le réseau
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                // Fichier trouvé dans le cache → on le retourne directement (rapide !)
                return cachedResponse;
            }
            // Fichier pas en cache → on le télécharge et on le met en cache
            return fetch(event.request).then((networkResponse) => {
                const responseClone = networkResponse.clone();
                caches.open(STATIC_CACHE).then((cache) => {
                    cache.put(event.request, responseClone);
                });
                return networkResponse;
            });
        })
    );
});

// ── SYNCHRONISATION EN ARRIÈRE-PLAN ──────────────────────────
// Quand la connexion est rétablie, on peut synchroniser les données en attente
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-expenses') {
        console.log('[SW] Synchronisation des dépenses hors ligne...');
        // La synchronisation réelle est gérée dans app.js
        event.waitUntil(self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({ type: 'SYNC_REQUIRED' });
            });
        }));
    }
});
