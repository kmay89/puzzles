/* sw.js — the room works offline.

   Cache-first over a fixed shell: the whole thing is seven scripts and
   a page, none of which change between releases. Bump VERSION on every
   release or installed players keep the old one for ever.

   Worlds are never cached. A region file is opened from your disk and
   never leaves the tab; there is nothing here that would want to keep
   a copy of it. */
var VERSION = "reading-room-v1";
var SHELL = [
  "./", "./index.html",
  "./nbt.js", "./anvil.js", "./blocks.js", "./mesher.js",
  "./world.js", "./gfx.js", "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    /* one missing icon must not fail the whole install */
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () { return null; }); }));
  }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k === VERSION ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.match(req).then(function (hit) {
    if (hit) {
      fetch(req).then(function (res) {
        if (res && res.ok) caches.open(VERSION).then(function (c) { c.put(req, res.clone()); });
      }).catch(function () {});
      return hit;
    }
    return fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () { return caches.match("./index.html"); });
  }));
});
