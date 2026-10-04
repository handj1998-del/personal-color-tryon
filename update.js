// Version label + update button + new-version banner (classic script, independent of app.js so it also works on the
// transitional load right after a deploy). Running version = version.js (cached with the app shell by the SW).
(() => {
  const RUN = self.APP_VERSION || 'v0', DATE = self.APP_DATE || '', num = (v) => +(String(v || '').match(/\d+/) || [0])[0];
  const qp = new URLSearchParams(location.search), SW = 'serviceWorker' in navigator && location.protocol !== 'file:' && !qp.has('nosw');
  const $$ = (s) => document.querySelectorAll(s);
  function toast(msg, ms = 2600) { const t = document.getElementById('toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms); }
  async function remote() { try { const r = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; } }
  async function cacheNum() { try { const ns = (await caches.keys()).map((k) => (k.match(/^pc-tryon-v(\d+)$/) || [])[1]).filter(Boolean).map(Number); return ns.length ? Math.max(...ns) : null; } catch (e) { return null; } }
  async function isStale(r) { if (!r) return false; const rn = num(r.version), cn = await cacheNum(); return rn > num(RUN) || (SW && cn != null && rn > cn); }
  if (SW) addEventListener('load', () => navigator.serviceWorker.register('./sw.js?v=' + RUN, { updateViaCache: 'none' }).catch((e) => console.warn('SW', e)));

  // wait until a fresh worker is installed (-> tell it to skip waiting) and active; never longer than 25 s
  function settle(reg) {
    const w = reg && (reg.installing || reg.waiting); if (!w) return Promise.resolve();
    return new Promise((res) => { const tick = () => { if (w.state === 'installed') w.postMessage({ type: 'SKIP_WAITING' }); if (w.state === 'activated' || w.state === 'redundant') res(); };
      w.addEventListener('statechange', tick); tick(); setTimeout(res, 25000); });
  }
  let busy = false;
  async function update() {
    if (busy) return; busy = true; $$('[data-upd]').forEach((b) => b.classList.add('busy'));
    const r = await remote(), stale = await isStale(r), target = stale ? r.version : RUN;
    toast(stale ? `새 버전으로 업데이트합니다 ${r.version}` : `최신 버전입니다 ${RUN}`);
    try {
      if (SW) {
        let reg = await navigator.serviceWorker.getRegistration();
        if (stale) reg = await navigator.serviceWorker.register('./sw.js?v=' + target, { updateViaCache: 'none' }); else if (reg) await reg.update();
        if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        await settle(reg);
        const keep = 'pc-tryon-' + target, ks = await caches.keys(); // old caches out (only once the new one exists: it reuses the big model files)
        if (ks.includes(keep)) for (const k of ks) if (k !== keep) await caches.delete(k);
      }
    } catch (e) { console.warn('update', e); }
    const u = new URL(location.href); u.searchParams.set('_u', Date.now().toString(36)); // cache-busting navigation
    setTimeout(() => location.replace(u.toString()), stale ? 500 : 1200);
  }
  // auto-detect: on launch and whenever the app comes back to the foreground (at most every 30 s)
  let last = 0;
  async function check() { if (Date.now() - last < 30000) return; last = Date.now(); const r = await remote(); if (await isStale(r)) { const b = document.getElementById('updBanner'); if (b) { b.querySelector('b').textContent = r.version; b.hidden = false; } } }
  function init() {
    if (qp.has('_u')) { const u = new URL(location.href); u.searchParams.delete('_u'); history.replaceState(null, '', u.toString()); }
    $$('[data-ver]').forEach((e) => { e.textContent = RUN + (DATE ? ' · ' + DATE : ''); });
    $$('[data-upd]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); update(); }));
    $$('[data-upd]').forEach((b) => b.addEventListener('keydown', (e) => e.stopPropagation())); // cover listens for Enter/Space
    check(); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
  window.__upd = { update, check, RUN };
})();
