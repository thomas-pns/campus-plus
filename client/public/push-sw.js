/* Campus+ : notifications (ajouté au service worker). */
self.addEventListener('push', (e) => {
  let d = { titre: 'Campus+', corps: 'Du nouveau dans ton planning.', tag: 'campus' };
  try { d = { ...d, ...e.data.json() }; } catch (_) { /* message vide */ }
  e.waitUntil(self.registration.showNotification(d.titre, {
    body: d.corps, tag: d.tag, icon: '/icone-192.png', badge: '/icone-192.png', data: { url: '/#alertes' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const f of fenetres) {
      if ('focus' in f) {
        f.postMessage({ type: 'ouvrir-alertes' });
        return f.focus();
      }
    }
    return self.clients.openWindow('/#alertes');
  })());
});
