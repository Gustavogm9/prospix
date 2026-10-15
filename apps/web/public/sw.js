const CACHE_NAME = 'prospix-v3';
const PRECACHE_URLS = [
  '/offline',
  '/manifest.json',
  '/logo-mark.svg',
  '/favicon.png',
  '/pwa-192.png',
  '/pwa-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline')));
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith('/_next/static/') ||
    /\.(?:css|ico|jpe?g|png|svg|webp|woff2?)$/i.test(url.pathname);

  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const responseToCache = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
        }
        return response;
      });
    }),
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'Prospix', body: 'Nova notificação', url: '/' };

  try {
    if (event.data) {
      const payload = event.data.json();
      const candidateUrl = new URL(payload.url || payload.link || '/', self.location.origin);
      data = {
        title: payload.title || 'Prospix',
        body: payload.body || 'Você tem uma nova notificação',
        url:
          candidateUrl.origin === self.location.origin
            ? `${candidateUrl.pathname}${candidateUrl.search}${candidateUrl.hash}`
            : '/',
      };
    }
  } catch {
    if (event.data) data.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/pwa-192.png',
      badge: '/favicon.png',
      vibrate: [100, 50, 100],
      data: { url: data.url },
      actions: [
        { action: 'open', title: 'Abrir' },
        { action: 'close', title: 'Fechar' },
      ],
      tag: 'prospix-notification',
      renotify: true,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'close') return;

  const candidateUrl = new URL(event.notification.data?.url || '/', self.location.origin);
  const targetUrl =
    candidateUrl.origin === self.location.origin ? candidateUrl.href : self.location.origin;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          return client.navigate(targetUrl).then(() => client.focus());
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
