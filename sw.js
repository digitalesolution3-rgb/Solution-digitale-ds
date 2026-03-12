// sw.js — Service Worker Digitale Solution v2
// ============================================================
// Stratégies :
//   - Ressources statiques : Cache First (offline immédiat)
//   - Appels API GET : Network First + fallback cache
//   - Appels API POST/PUT : Network First + file d'attente IndexedDB si hors ligne
//   - Background Sync : flush automatique dès retour connexion
// ============================================================

const CACHE_NAME     = 'ds-pos-v2';
const CACHE_STATIC   = 'ds-static-v2';
const DB_NAME        = 'ds_sw_db';
const DB_VERSION     = 2;
const STORE_QUEUE    = 'offline_queue';
const STORE_CACHE_TS = 'cache_timestamps';

// Ressources critiques à pré-cacher lors de l'installation
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  // Fonts Google (si hors ligne — optionnel, peut ralentir l'install)
  // '/offline.html',  // page offline dédiée si vous en créez une
];

// ============================================================
// INSTALLATION — pré-cache des ressources critiques
// ============================================================
self.addEventListener('install', event => {
  console.log('[SW] Installation v2...');
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(PRECACHE_URLS.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => {
        console.log('[SW] ✅ Ressources critiques mises en cache.');
        return self.skipWaiting(); // Prendre contrôle immédiatement
      })
      .catch(err => console.warn('[SW] Pré-cache partiel:', err.message))
  );
});

// ============================================================
// ACTIVATION — nettoyage des anciens caches
// ============================================================
self.addEventListener('activate', event => {
  console.log('[SW] Activation...');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== CACHE_STATIC)
          .map(k => { console.log('[SW] Suppression cache obsolète:', k); return caches.delete(k); })
      ))
      .then(() => self.clients.claim()) // Contrôler tous les onglets ouverts
      .then(() => console.log('[SW] ✅ Activé et en contrôle.'))
  );
});

// ============================================================
// FETCH — routage intelligent des requêtes
// ============================================================
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Ignorer les requêtes non-GET non-POST (ex: HEAD, OPTIONS)
  if (req.method !== 'GET' && req.method !== 'POST') return;

  // Ignorer les extensions browser internes et Chrome DevTools
  if (url.protocol === 'chrome-extension:' || url.hostname === 'localhost' && url.port > 9000) return;

  // ── Appels API ─────────────────────────────────────────────
  if (url.pathname.startsWith('/api/')) {
    if (req.method === 'POST') {
      event.respondWith(networkFirstWithQueue(req));
    } else {
      event.respondWith(networkFirstApi(req));
    }
    return;
  }

  // ── Polices Google Fonts — cache long durée ───────────────
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirstWithFallback(req, CACHE_NAME));
    return;
  }

  // ── Ressources statiques — cache first ───────────────────
  event.respondWith(cacheFirstWithFallback(req, CACHE_STATIC));
});

// ── Stratégie : Network First pour les GET d'API ──────────
async function networkFirstApi(request) {
  try {
    const response = await fetchWithTimeout(request.clone(), 8000);
    if (response.ok) {
      // Mettre à jour le cache API (GET uniquement)
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch(e) {
    // Hors ligne — essayer le cache
    const cached = await caches.match(request);
    if (cached) {
      // Ajouter un header pour signaler que c'est du cache
      const headers = new Headers(cached.headers);
      headers.set('X-Offline', '1');
      headers.set('X-Cache-Date', cached.headers.get('date') || '');
      return new Response(cached.body, { status: cached.status, headers });
    }
    // Aucun cache disponible
    return offlineApiResponse({ error: 'Hors ligne. Données locales utilisées.', offline: true });
  }
}

// ── Stratégie : Network First + File d'attente pour POST ──
async function networkFirstWithQueue(request) {
  try {
    const response = await fetchWithTimeout(request.clone(), 8000);
    return response;
  } catch(e) {
    // Hors ligne — mettre en file d'attente si c'est une action importante
    const cloned = request.clone();
    try {
      const body = await cloned.json();
      await enqueueRequest({ url: request.url, method: 'POST', body });
      console.log('[SW] 📥 Requête mise en file d\'attente:', request.url);

      // Demander une Background Sync quand la connexion reviendra
      if (self.registration.sync) {
        await self.registration.sync.register('ds-sync-queue');
      }

      return offlineApiResponse({
        success:  true,
        offline:  true,
        queued:   true,
        message:  'Action enregistrée hors ligne. Sera synchronisée dès reconnexion.'
      });
    } catch(parseErr) {
      return offlineApiResponse({ success: false, offline: true, error: 'Hors ligne.' });
    }
  }
}

// ── Stratégie : Cache First + mise à jour réseau en arrière-plan ──
async function cacheFirstWithFallback(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) {
    // Stale-while-revalidate : retourner le cache ET actualiser en arrière-plan
    fetchWithTimeout(request.clone(), 5000)
      .then(fresh => {
        if (fresh && fresh.ok) {
          caches.open(cacheName).then(c => c.put(request, fresh)).catch(() => {});
        }
      })
      .catch(() => {}); // Silencieux si hors ligne
    return cached;
  }

  try {
    const response = await fetchWithTimeout(request, 10000);
    if (response && response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch(e) {
    // Navigation hors ligne → retourner index.html depuis le cache
    if (request.mode === 'navigate') {
      return caches.match('/index.html') ||
             caches.match('/') ||
             offlineHtmlResponse();
    }
    throw e;
  }
}

// ============================================================
// FILE D'ATTENTE HORS LIGNE (IndexedDB)
// ============================================================

/** Ajoute une requête à la file d'attente offline */
async function enqueueRequest(item) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    const store = tx.objectStore(STORE_QUEUE);
    const record = { ...item, timestamp: Date.now(), id: Date.now() + '_' + Math.random().toString(36).substr(2, 4) };
    store.add(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

/** Récupère toutes les requêtes en attente */
async function getQueue() {
  const db = await openIDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_QUEUE, 'readonly');
    const req = tx.objectStore(STORE_QUEUE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

/** Vide la file d'attente (ou ne garde que les échecs) */
async function clearQueue(keepIds = []) {
  const db = await openIDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    const store = tx.objectStore(STORE_QUEUE);
    if (keepIds.length === 0) {
      store.clear();
    } else {
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        store.clear();
        all.filter(i => keepIds.includes(i.id)).forEach(i => store.add(i));
      };
    }
    tx.oncomplete = resolve;
  });
}

// ============================================================
// BACKGROUND SYNC — flush automatique au retour connexion
// ============================================================
self.addEventListener('sync', event => {
  if (event.tag === 'ds-sync-queue') {
    console.log('[SW] 🔄 Background Sync déclenché...');
    event.waitUntil(flushQueue());
  }
});

/** Envoie toutes les requêtes en file vers le serveur */
async function flushQueue() {
  const queue = await getQueue();
  if (!queue.length) {
    console.log('[SW] File d\'attente vide, rien à synchroniser.');
    return;
  }

  console.log(`[SW] Flush de ${queue.length} requête(s) en attente...`);
  const failedIds = [];
  let synced = 0;

  for (const item of queue) {
    try {
      const response = await fetch(item.url, {
        method: item.method || 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.body)
      });

      if (response.ok) {
        synced++;
        console.log('[SW] ✅ Sync réussie:', item.url);
      } else {
        // Erreur serveur (4xx/5xx) — ne pas réessayer infiniment
        console.warn('[SW] ⚠️ Erreur serveur', response.status, 'pour:', item.url);
        if (response.status >= 500) failedIds.push(item.id); // Retry les 5xx seulement
      }
    } catch(e) {
      // Encore hors ligne — garder pour le prochain flush
      failedIds.push(item.id);
      console.warn('[SW] 📡 Encore hors ligne, retry plus tard:', item.url);
    }
  }

  // Nettoyer la file (garder seulement les échecs)
  await clearQueue(failedIds);

  // Notifier l'application
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach(client => {
    client.postMessage({
      type:    'SYNC_COMPLETE',
      synced,
      pending: failedIds.length,
      total:   queue.length
    });
  });

  console.log(`[SW] Sync terminée — ${synced} réussies, ${failedIds.length} en attente`);
}

// ============================================================
// MESSAGES depuis l'application
// ============================================================
self.addEventListener('message', async event => {
  const { type, payload } = event.data || {};

  switch(type) {
    case 'FORCE_SYNC':
      console.log('[SW] Sync manuelle déclenchée depuis l\'app');
      await flushQueue();
      break;

    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'GET_QUEUE_SIZE':
      const queue = await getQueue();
      event.source?.postMessage({ type: 'QUEUE_SIZE', size: queue.length });
      break;

    case 'CLEAR_CACHE':
      await caches.delete(CACHE_NAME);
      await caches.delete(CACHE_STATIC);
      event.source?.postMessage({ type: 'CACHE_CLEARED' });
      break;
  }
});

// ============================================================
// PUSH NOTIFICATIONS (préparé pour extension future)
// ============================================================
self.addEventListener('push', event => {
  const data = event.data?.json() || { title: 'Digitale Solution', body: 'Nouvelle notification' };
  event.waitUntil(
    self.registration.showNotification(data.title || 'Digitale Solution', {
      body:  data.body  || '',
      icon:  '/icon-192.png',
      badge: '/icon-192.png',
      data:  data.url ? { url: data.url } : {}
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(clients.openWindow(url));
});

// ============================================================
// UTILITAIRES
// ============================================================

/** Fetch avec timeout (pour éviter les blocages indéfinis) */
function fetchWithTimeout(request, timeoutMs = 8000) {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout réseau')), timeoutMs)
    )
  ]);
}

/** Réponse JSON pour les API en mode offline */
function offlineApiResponse(data) {
  return new Response(JSON.stringify(data), {
    status:  200,
    headers: {
      'Content-Type': 'application/json',
      'X-Offline':    '1'
    }
  });
}

/** Page HTML minimale pour navigation offline */
function offlineHtmlResponse() {
  return new Response(
    `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Hors ligne</title>
    <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0F0E0D;color:#F0EDE8;text-align:center;margin:0}
    .box{padding:40px}.ico{font-size:4rem;margin-bottom:16px}.h1{font-size:1.5rem;margin-bottom:8px}.p{color:#8A8480;font-size:.9rem}</style>
    </head><body><div class="box"><div class="ico">📡</div><div class="h1">Hors ligne</div>
    <p class="p">Veuillez vérifier votre connexion Internet.<br>Vos données locales sont préservées.</p>
    <p class="p" style="margin-top:20px"><a href="/" style="color:#E8730C">Réessayer →</a></p>
    </div></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html' } }
  );
}

/** Ouvre (ou crée) la base IndexedDB du Service Worker */
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const db = e.target.result;
      // Store pour la file d'attente offline
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const store = db.createObjectStore(STORE_QUEUE, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('url',       'url',       { unique: false });
      }
      // Store pour les timestamps de cache
      if (!db.objectStoreNames.contains(STORE_CACHE_TS)) {
        db.createObjectStore(STORE_CACHE_TS, { keyPath: 'key' });
      }
    };

    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => reject(req.error);
  });
}
