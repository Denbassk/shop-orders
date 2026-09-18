// Мінімальний service worker: потрібен лише для того, щоб Chrome вважав
// сторінку застосунком і пропонував "Встановити". Нічого не кешуємо -
// пульт завжди має показувати свіжі дані.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) { e.respondWith(fetch(e.request)); });
