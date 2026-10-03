// Service worker: caches the app shell and the self-hosted MediaPipe runtime/models so the app works offline
// after the first visit. Bump VERSION on every deploy.
const VERSION = 'pc-tryon-v11';
const SHELL = ['./', './index.html', './style.css', './app.js', './frames.js', './hairstyle.js', './glasses3d.js', './reco.js', './manifest.webmanifest',
  './assets/glasses/glasses.json', './assets/hair/hair.json',
  './assets/sample.jpg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png', './assets/fonts/cormorant-latin.woff2'];
const HEAVY = ['./vendor/mediapipe/vision_bundle.mjs', './vendor/mediapipe/face_landmarker.task', './vendor/mediapipe/hair_segmenter.tflite',
  './vendor/mediapipe/wasm/vision_wasm_internal.js', './vendor/mediapipe/wasm/vision_wasm_internal.wasm'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL);
    // models/wasm: reuse copies from an older cache when possible (they rarely change), else download
    for (const u of HEAVY) {
      const old = await caches.match(u);
      if (old) await c.put(u, old); else await c.add(u);
    }
    self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== location.origin) return;
  const heavy = url.pathname.includes('/vendor/');
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('./index.html') : null);
    if (heavy && hit) return hit;                       // cache-first for the big runtime/model files
    const net = fetch(req).then((r) => { if (r.ok && r.type === 'basic') c.put(req, r.clone()); return r; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }           // stale-while-revalidate for the app shell
    return (await net) || new Response('오프라인 상태입니다.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
