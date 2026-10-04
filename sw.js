// Service worker: caches the app shell and the self-hosted MediaPipe runtime/models so the app works offline
// after the first visit. The version comes from version.js (single source, bump with tools/bump-version.sh); the page registers
// ./sw.js?v=<version>, and the query also busts the HTTP cache for the imported version.js.
importScripts('./version.js?v=' + (new URL(self.location.href).searchParams.get('v') || Date.now()));
const VERSION = 'pc-tryon-' + self.APP_VERSION;
const SHELL = ['./', './index.html', './version.js', './update.js', './style.css', './app.js', './frames.js', './hairstyle.js', './glasses3d.js', './reco.js', './gender.js', './manifest.webmanifest',
  './assets/glasses/glasses.json', './assets/hair/hair.json',
  './assets/sample.jpg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png', './assets/fonts/cormorant-latin.woff2'];
const HEAVY = ['./assets/models/age_gender_model-weights_manifest.json', './assets/models/age_gender_model.bin', './vendor/mediapipe/vision_bundle.mjs', './vendor/mediapipe/face_landmarker.task', './vendor/mediapipe/hair_segmenter.tflite',
  './vendor/mediapipe/wasm/vision_wasm_internal.js', './vendor/mediapipe/wasm/vision_wasm_internal.wasm'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))); // bypass the HTTP cache: a new SW must never cache old files
    // models/wasm: reuse copies from an older cache when possible (they rarely change), else download
    for (const u of HEAVY) {
      const old = await caches.match(u);
      if (old) await c.put(u, old); else await c.add(new Request(u, { cache: 'reload' }));
    }
    self.skipWaiting();
  })());
});
self.addEventListener('message', (e) => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== location.origin) return;
  if (url.pathname.endsWith('/version.json')) return; // update check: always the network
  const heavy = url.pathname.includes('/vendor/') || url.pathname.includes('/assets/models/');
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    if (req.mode === 'navigate') { // network-first for the page itself (so HTML and modules of a new version don't mix), cache when offline/slow
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 3500);
      try { const r = await fetch(req, { signal: ctl.signal }); clearTimeout(to); if (r.ok) { c.put('./index.html', r.clone()); return r; } } catch (err) { /* offline */ }
      return (await c.match(req, { ignoreSearch: true })) || (await c.match('./index.html')) || new Response('오프라인 상태입니다.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    const hit = await c.match(req, { ignoreSearch: true });
    if (heavy && hit) return hit;                       // cache-first for the big runtime/model files
    const net = fetch(req).then((r) => { if (r.ok && r.type === 'basic') c.put(req, r.clone()); return r; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }           // stale-while-revalidate for the app shell
    return (await net) || new Response('오프라인 상태입니다.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
