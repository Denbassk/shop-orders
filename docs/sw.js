// Мінімальний service worker. Потрібен, щоб Android дозволив
// встановити застосунок на головний екран. Дані не кешує -
// замовлення завжди тягнуться з сервера свіжими.
const SHELL = 'fm-shell-v1';
const FILES = ['./', './index.html', './app-url.js',
               './icon-192.png', './icon-512.png', './manifest.webmanifest'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(FILES); }).catch(function () {}));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== SHELL; })
                           .map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (u.origin !== location.origin) return;              // застосунок - завжди з мережі
  e.respondWith(
    fetch(e.request).catch(function () { return caches.match(e.request); })
  );
});
