/* Pairwise service worker: shows lock-screen notifications from your partner (web push).
   It does not cache pages or files, so updates to the app reach you exactly as before. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  const show = () => self.registration.showNotification(d.title || 'Pairwise', {
    body: d.body || '',
    tag: d.tag || 'pairwise',
    renotify: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: d.url || '/' }
  });
  /* Pairwise open on screen already shows the change itself. iPhone requires a notification for
     every push, so it always gets one. */
  const iOS = /iPad|iPhone|iPod/.test(self.navigator.userAgent);
  e.waitUntil(iOS ? show() : self.clients.matchAll({ type: 'window' }).then((wins) =>
    wins.some((w) => w.visibilityState === 'visible' && w.focused) ? null : show()));
});

/* tapping the notification opens Pairwise (or brings the open window to the front) */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) if ('focus' in w) return w.focus();
    return self.clients.openWindow(url);
  }));
});
