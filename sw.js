/* ═══════════════════════════════════════════════════════════════════
   sw.js — service worker untuk semua app personal (scope: /app/)
   Daftar dari shared/auth.js, jadi cukup satu file ini.

   Strategi:
   - File app sendiri (HTML/JS/manifest/icon): NETWORK-FIRST. Online selalu
     dapat versi terbaru; kalau jaringan gagal/lambat (>4 dtk) pakai cache.
   - Library CDN yang versinya di-pin (supabase-js, xlsx): CACHE-FIRST.
   - Google Fonts: CSS stale-while-revalidate, file font cache-first.
   - Supabase API/auth (*.supabase.co) dan lainnya: gak disentuh sama sekali.

   Naikkan VERSION kalau mau buang semua cache lama.
   ═══════════════════════════════════════════════════════════════════ */
const VERSION = 'v2';
const SHELL = 'shell-' + VERSION;
const LIB   = 'lib-' + VERSION;
const NET_TIMEOUT = 4000;

const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.min.js';
const XLSX = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

/* relatif terhadap lokasi sw.js */
const PRECACHE = [
  'shared/auth.js',
  'coffeelog/', 'coffeelog/index.html',
  'targetin/', 'targetin/index.html',
  'karnote/',  'karnote/index.html',
  'sehatin/',  'sehatin/index.html',
  'sehatin/js/shared.js', 'sehatin/js/data.js'
];
const LIB_PRECACHE = [SDK, XLSX];

self.addEventListener('install', function (e) {
  e.waitUntil((async function () {
    const shell = await caches.open(SHELL);
    await Promise.allSettled(PRECACHE.map(function (u) { return shell.add(new Request(u, { cache: 'reload' })); }));
    const lib = await caches.open(LIB);
    await Promise.allSettled(LIB_PRECACHE.map(function (u) { return lib.add(u); }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    const keep = [SHELL, LIB];
    const names = await caches.keys();
    await Promise.all(names.filter(function (n) { return keep.indexOf(n) < 0; }).map(function (n) { return caches.delete(n); }));
    await self.clients.claim();
  })());
});

/* cari di cache; untuk navigasi coba varian URL (tanpa slash / index.html) */
async function matchAny(cache, req) {
  let hit = await cache.match(req);
  if (hit) return hit;
  hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  if (req.mode === 'navigate') {
    const u = new URL(req.url);
    u.search = ''; u.hash = '';
    const base = u.href.replace(/index\.html$/, '').replace(/\/$/, '');
    const tries = [base + '/', base + '/index.html'];
    for (let i = 0; i < tries.length; i++) {
      hit = await cache.match(tries[i]);
      if (hit) return hit;
    }
  }
  return null;
}

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  const net = fetch(req).then(function (res) {
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  });
  try {
    return await Promise.race([
      net,
      new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, NET_TIMEOUT); })
    ]);
  } catch (err) {
    const hit = await matchAny(cache, req);
    if (hit) return hit;
    return net;   // gak ada cache: tunggu jaringan apa adanya
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(LIB);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(LIB);
  const hit = await cache.match(req);
  const net = fetch(req).then(function (res) {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(function () { return hit; });
  return hit || net;
}

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req));
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(cacheFirst(req));
  } else if (url.hostname === 'fonts.googleapis.com') {
    e.respondWith(staleWhileRevalidate(req));
  } else if (url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req));
  }
  /* selain itu (supabase.co, dll): biarkan browser yang urus */
});
