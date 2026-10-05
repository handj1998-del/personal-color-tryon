// Photoreal glasses: pre-rendered (Blender, studio HDRI) front-view layers recoloured per frame material.
// Assets: assets/glasses/{key}_a.png (R=diffuse shade, G=specular, A=alpha), _m.png (metal luminance+alpha),
// _l.png (lens reflections, premultiplied-ish RGB + coverage). 160 px per local unit, centre (400,208).
// v24: slim the chunky acetate rims in-browser and soften CGI highlights so frames read as real eyewear.
import { FRAMES, SHAPE_BY_ID, drawGlasses } from './frames.js';
const BASE = new URL('./assets/glasses/', import.meta.url).href;
let manifest = null, onReady = null;
const imgs = {}, colCache = new Map();
// Android / low-memory: work at half the asset resolution (still >= the old 1x renders) and keep fewer colourised variants
const LOW = (/Android/i.test(navigator.userAgent) || /android/i.test(navigator.userAgentData?.platform || '') || /^android-app:/.test(document.referrer) || (navigator.deviceMemory && navigator.deviceMemory <= 4) || /[?&](lite|ultra)\b/.test(location.search)) && !/[?&]full\b/.test(location.search);
// Android / low-memory: load the 1x files (assets/glasses/lo, 800x416) so no 1600x832 image is ever decoded; work at file resolution
const FILEK = LOW ? 0.5 : 1, IMG_BASE = LOW ? BASE + 'lo/' : BASE;
const SCALE = 1, MAXC = LOW ? 2 : 8;
export function initGlasses3D(cb) {
  onReady = cb;
  fetch(BASE + 'glasses.json').then((r) => r.json()).then((m) => { manifest = m; cb && cb(); }).catch(() => {});
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function load(fn) {
  if (imgs[fn]) return imgs[fn].ok ? imgs[fn].img : null;
  const img = new Image(); imgs[fn] = { img, ok: false };
  img.onload = () => { imgs[fn].ok = true; onReady && onReady(); };
  img.onerror = () => { imgs[fn].err = true; };
  img.decoding = 'async'; img.src = IMG_BASE + fn; return null;
}
function scaled(img) {
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * SCALE); c.height = Math.round(img.naturalHeight * SCALE);
  const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, c.width, c.height); return c;
}
function pixels(img) { const c = scaled(img), d = c.getContext('2d').getImageData(0, 0, c.width, c.height); c.width = c.height = 0; return d; }
export function variantKey(shapeId, frameId) {
  const sh = SHAPE_BY_ID[shapeId], F = FRAMES[frameId]; if (!sh || !sh.d || !F || !manifest) return null;
  const rim = sh.rim || 'full';
  let v = (F.kind === 'metal' || sh.thin || rim === 'rimless') ? 'wire' : 'thick';
  if (rim === 'brow' || rim === 'combo') v = 'thick';
  let k = `${shapeId}_${v}`; if (!manifest.keys[k]) k = `${shapeId}_${v === 'wire' ? 'thick' : 'wire'}`;
  return manifest.keys[k] ? k : null;
}
// gradient map: luminance -> lo .. c .. hi .. soft white (clipped so metal does not blow out to plastic)
function metalLUT(M) {
  const lo = hex(M.lo), c = hex(M.c), hi = hex(M.hi), stops = [[0, [lo[0] * 0.28, lo[1] * 0.28, lo[2] * 0.28]], [0.22, [lo[0] * 0.72, lo[1] * 0.72, lo[2] * 0.72]], [0.48, c], [0.74, hi], [0.9, [hi[0] * 0.55 + 255 * 0.45, hi[1] * 0.55 + 253 * 0.45, hi[2] * 0.55 + 245 * 0.45]], [1, [hi[0] * 0.25 + 255 * 0.75, hi[1] * 0.25 + 255 * 0.75, hi[2] * 0.25 + 255 * 0.75]]];
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255; let j = 0; while (j < stops.length - 2 && t > stops[j + 1][0]) j++;
    const [t0, a] = stops[j], [t1, b] = stops[j + 1], f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    for (let k = 0; k < 3; k++) lut[i * 3 + k] = a[k] + (b[k] - a[k]) * f;
  }
  return lut;
}
const tortCache = new Map();
function tortoiseField(W, H, F) {
  const key = W + 'x' + H + F.c + F.spot; if (tortCache.has(key)) return tortCache.get(key);
  const mkc = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const q = W / 800, [sr, sg, sb] = hex(F.spot);
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ell = (x, px, py, rx, ry, rot) => { x.beginPath(); x.ellipse(px, py, rx, ry, rot, 0, 7); x.fill(); };
  const k1 = 6, A = mkc(Math.ceil(W / k1), Math.ceil(H / k1)), ax = A.getContext('2d', { willReadFrequently: true });
  ax.fillStyle = F.c; ax.fillRect(0, 0, A.width, A.height); ax.setTransform(1 / k1, 0, 0, 1 / k1, 0, 0);
  for (let i = 0; i < 110; i++) { const px = rnd() * W, py = rnd() * H, r = (14 + rnd() * 26) * q; ax.fillStyle = `rgba(${sr},${sg},${sb},${0.35 + rnd() * 0.35})`; ell(ax, px, py, r * 1.5, r * 0.9, -0.3 + rnd() * 0.6); }
  for (let i = 0; i < 40; i++) { const px = rnd() * W, py = rnd() * H, r = (5 + rnd() * 10) * q; ax.fillStyle = `rgba(214,150,76,${0.12 + rnd() * 0.15})`; ell(ax, px, py, r * 1.4, r, rnd() - 0.5); }
  const k2 = 2.5, B = mkc(Math.ceil(W / k2), Math.ceil(H / k2)), bx = B.getContext('2d', { willReadFrequently: true }); bx.setTransform(1 / k2, 0, 0, 1 / k2, 0, 0);
  for (let i = 0; i < 700; i++) { const px = rnd() * W, py = rnd() * H, r = (2 + rnd() * rnd() * 9) * q; bx.fillStyle = `rgba(${sr},${sg},${sb},${0.4 + rnd() * 0.45})`; ell(bx, px, py, r * (1.1 + rnd() * 0.7), r * 0.8, rnd() * 3); }
  const c = mkc(W, H), x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(A, 0, 0, W, H); x.drawImage(B, 0, 0, W, H);
  for (let i = 0; i < 200; i++) { const px = rnd() * W, py = rnd() * H, r = (0.8 + rnd() * 1.6) * q; x.fillStyle = `rgba(${sr * 0.6 | 0},${sg * 0.6 | 0},${sb * 0.6 | 0},${0.5 + rnd() * 0.4})`; ell(x, px, py, r * 1.3, r, rnd() * 3); }
  const d = x.getImageData(0, 0, W, H).data;
  A.width = A.height = B.width = B.height = c.width = c.height = 0;
  tortCache.set(key, d); while (tortCache.size > 2) tortCache.delete(tortCache.keys().next().value);
  return d;
}
// Eat the outer shell of a pre-rendered thick rim so acetate reads closer to a real 3–4 mm front.
function slimAlpha(data, W, H, rad) {
  if (rad < 1) return;
  const srcA = new Uint8ClampedArray(W * H);
  for (let i = 0; i < W * H; i++) srcA[i] = data[i * 4 + 3];
  const tmp = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = 255; const y0 = y * W;
    for (let k = -rad; k <= rad; k++) { const xx = x + k; if (xx < 0 || xx >= W) { m = 0; break; } if (srcA[y0 + xx] < m) m = srcA[y0 + xx]; }
    tmp[y0 + x] = m;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = 255;
    for (let k = -rad; k <= rad; k++) { const yy = y + k; if (yy < 0 || yy >= H) { m = 0; break; } if (tmp[yy * W + x] < m) m = tmp[yy * W + x]; }
    data[(y * W + x) * 4 + 3] = m;
  }
}
function colorize(key, frameId, accentWarm) {
  const ck = key + '|' + frameId + '|' + accentWarm; if (colCache.has(ck)) return colCache.get(ck);
  const info = manifest.keys[key];
  const ia = info.A ? load(key + '_a.png') : null, im = info.M ? load(key + '_m.png') : null, il = load(key + '_l.png');
  if ((info.A && !ia) || (info.M && !im) || !il) return null;
  const F = FRAMES[frameId], sh = SHAPE_BY_ID[key.replace(/_(thick|wire)$/, '')], rim = sh.rim || 'full', thick = key.endsWith('_thick');
  const W = Math.round(il.naturalWidth * SCALE), H = Math.round(il.naturalHeight * SCALE), PU = (manifest.px_per_unit || 160) * FILEK * SCALE;
  const frame = document.createElement('canvas'); frame.width = W; frame.height = H; const fx = frame.getContext('2d');
  const out = fx.createImageData(W, H), o = out.data;
  let tintC = null, tintImg = null;
  const isMetal = F.kind === 'metal';
  const metalOf = (q) => q.kind === 'metal' ? q : { c: q.c, hi: mixh(q.c, '#ffffff', 0.42), lo: mixh(q.c, '#000000', 0.42) };
  const M = isMetal ? F : thick ? (accentWarm && F.kind !== 'clear' ? FRAMES.gold : FRAMES.silver) : metalOf(F);
  if (im) {
    const d = pixels(im).data, lut = metalLUT(M);
    for (let i = 0; i < W * H; i++) { const a = d[i * 4 + 3]; if (!a) continue; const l = d[i * 4] * 3; o[i * 4] = lut[l]; o[i * 4 + 1] = lut[l + 1]; o[i * 4 + 2] = lut[l + 2]; o[i * 4 + 3] = Math.min(255, a * 0.92); }
  }
  if (ia) {
    const d = pixels(ia).data;
    const AF = (isMetal && (rim === 'brow' || rim === 'combo')) ? FRAMES.black : isMetal ? FRAMES.black : F;
    const base = hex(AF.c), tort = AF.kind === 'tortoise' ? tortoiseField(W, H, AF) : null, c2 = AF.c2 ? hex(AF.c2) : null;
    const specK = AF.matte ? 0.12 : AF.kind === 'clear' ? 0.72 : 0.42;
    if (AF.kind === 'clear') { tintC = document.createElement('canvas'); tintC.width = W; tintC.height = H; tintImg = tintC.getContext('2d').createImageData(W, H); }
    const td = tintImg ? tintImg.data : null;
    const y0 = H * 0.5 - 0.75 * PU, y1 = H * 0.5 + 0.55 * PU;
    for (let y = 0; y < H; y++) {
      const gy = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
      for (let x = 0; x < W; x++) {
        const i = y * W + x, a = d[i * 4 + 3]; if (!a) continue;
        const diff = d[i * 4] / 255 * 1.05, s0 = d[i * 4 + 1] / 255, spec = (AF.kind === 'clear' ? s0 * 150 : Math.pow(s0, 1.85) * 150) * specK;
        let r = base[0], g = base[1], b = base[2], al = a;
        if (tort) { r = tort[i * 4]; g = tort[i * 4 + 1]; b = tort[i * 4 + 2]; }
        if (c2) { const t = Math.max(0, (gy - 0.3) / 0.7); r += (c2[0] - r) * t; g += (c2[1] - g) * t; b += (c2[2] - b) * t; al = a * (1 - 0.45 * t); }
        let k = Math.min(1.05, 0.72 + diff * 0.28);
        if (AF.kind === 'clear') {
          const edge = Math.min(1, Math.max(0, 1 - d[i * 4] / 255 * 1.15)), sp = Math.min(1, spec / 140);
          if (td) { const dens = 0.42 + 0.4 * edge; td[i * 4] = 255 - (255 - r) * dens; td[i * 4 + 1] = 255 - (255 - g) * dens; td[i * 4 + 2] = 255 - (255 - b) * dens; td[i * 4 + 3] = a; }
          al = a * Math.min(1, 0.06 + 0.36 * edge + 0.45 * sp);
          r = 255 - (255 - r) * 0.45; g = 255 - (255 - g) * 0.45; b = 255 - (255 - b) * 0.45; k = 0.8 + 0.2 * Math.min(1, diff);
        }
        const R = r * k + spec, G = g * k + spec, B = b * k + spec;
        const ea = o[i * 4 + 3] / 255, na = al / 255, ta = na + ea * (1 - na);
        o[i * 4] = (R * na + o[i * 4] * ea * (1 - na)) / ta; o[i * 4 + 1] = (G * na + o[i * 4 + 1] * ea * (1 - na)) / ta; o[i * 4 + 2] = (B * na + o[i * 4 + 2] * ea * (1 - na)) / ta;
        o[i * 4 + 3] = ta * 255;
      }
    }
    if (thick && rim !== 'brow') slimAlpha(o, W, H, Math.max(2, Math.round(PU * (sh.thk > 1.3 ? 0.02 : 0.034))));
  }
  fx.putImageData(out, 0, 0);
  if (tintC) tintC.getContext('2d').putImageData(tintImg, 0, 0);
  const res = { frame, lens: SCALE === 1 ? il : scaled(il), tint: tintC, W, H, info, k: PU };
  colCache.set(ck, res);
  while (colCache.size > MAXC) { const k0 = colCache.keys().next().value, r0 = colCache.get(k0); colCache.delete(k0); for (const c of [r0.frame, r0.tint, r0.lens]) if (c && c.getContext) c.width = c.height = 0; }
  return res;
}
function mixh(h1, h2, t) { const a = hex(h1), b = hex(h2); return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join(''); }

export function drawGlasses3D(ctx, lensCtx, P, frameId, shapeId, gScale, accentWarm, hideTemples, tintCtx) {
  const key = variantKey(shapeId, frameId); if (!key) return false;
  const res = colorize(key, frameId, accentWarm); if (!res) return false;
  drawGlasses(ctx, P, frameId, shapeId, gScale * 0.94, accentWarm, hideTemples, true);
  const Wc = lensCtx.canvas.width, Hc = lensCtx.canvas.height; lensCtx.setTransform(1, 0, 0, 1, 0, 0); lensCtx.clearRect(0, 0, Wc, Hc);
  if (tintCtx) { tintCtx.setTransform(1, 0, 0, 1, 0, 0); tintCtx.clearRect(0, 0, tintCtx.canvas.width, tintCtx.canvas.height); }
  let L = P.iL, R = P.iR; if (L.x > R.x) [L, R] = [R, L];
  const dx = R.x - L.x, dy = R.y - L.y, d = Math.hypot(dx, dy); if (d < 6) return true;
  const e = { x: dx / d, y: dy / d }, n = { x: -e.y, y: e.x };
  const t = Math.min(d * 0.7, Math.max(d * 0.3, (P.B.x - L.x) * e.x + (P.B.y - L.y) * e.y));
  const C = { x: L.x + e.x * t, y: L.y + e.y * t };
  const g = gScale * 0.88, u = (d / 2) * g, k = res.k, cx = res.W / 2, cy = res.H / 2;
  const sides = [{ s: (d - t) * g, sx: cx, sw: res.W - cx }, { s: t * g, sx: 0, sw: cx }];
  const jobs = [[ctx, res.frame, 1], [lensCtx, res.lens, 0.58]]; if (tintCtx && res.tint) jobs.push([tintCtx, res.tint, 0.85]);
  for (const [target, src, alpha] of jobs) {
    target.imageSmoothingEnabled = true; target.imageSmoothingQuality = 'high'; target.globalAlpha = alpha;
    for (const sd of sides) {
      target.setTransform(e.x * sd.s / k, e.y * sd.s / k, n.x * u / k, n.y * u / k, C.x - (e.x * sd.s * cx + n.x * u * cy) / k, C.y - (e.y * sd.s * cx + n.y * u * cy) / k);
      target.drawImage(src, sd.sx, 0, sd.sw, res.H, sd.sx, 0, sd.sw, res.H);
    }
    target.globalAlpha = 1; target.setTransform(1, 0, 0, 1, 0, 0);
  }
  return tintCtx && res.tint ? 'tint' : true;
}
export function preloadGlasses3D(shapeId, frameId, timeout = 4000) {
  const key = variantKey(shapeId, frameId); if (!key) return Promise.resolve(false);
  const info = manifest.keys[key], fns = [info.A && key + '_a.png', info.M && key + '_m.png', key + '_l.png'].filter(Boolean);
  fns.forEach((fn) => load(fn));
  const t0 = performance.now();
  return new Promise((r) => {
    const chk = () => {
      const st = fns.map((fn) => imgs[fn]);
      if (st.every((q) => q && q.ok)) return r(true);
      if (st.some((q) => q && q.err) || performance.now() - t0 > timeout) return r(false);
      setTimeout(chk, 50);
    };
    chk();
  });
}
export function purgeGlasses3D() {
  for (const r0 of colCache.values()) for (const c of [r0.frame, r0.tint, r0.lens]) if (c && c.getContext) c.width = c.height = 0;
  colCache.clear(); tortCache.clear();
  for (const k in imgs) { if (imgs[k].ok) { const im = imgs[k].img; im.onload = im.onerror = null; im.removeAttribute('src'); delete imgs[k]; } }
}
