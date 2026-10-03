// Photoreal glasses: pre-rendered (Blender, studio HDRI) front-view layers recoloured per frame material.
// Assets: assets/glasses/{key}_a.png (R=diffuse shade, G=specular, A=alpha), _m.png (metal luminance+alpha),
// _l.png (lens reflections, premultiplied-ish RGB + coverage). 160 px per local unit, centre (400,208).
import { FRAMES, SHAPE_BY_ID, drawGlasses } from './frames.js';
const BASE = new URL('./assets/glasses/', import.meta.url).href;
let manifest = null, onReady = null;
const imgs = {}, colCache = new Map();
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
  img.src = BASE + fn; return null;
}
function pixels(img) {
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height);
}
export function variantKey(shapeId, frameId) {
  const sh = SHAPE_BY_ID[shapeId], F = FRAMES[frameId]; if (!sh || !sh.d || !F || !manifest) return null;
  const rim = sh.rim || 'full';
  let v = (F.kind === 'metal' || sh.thin || rim === 'rimless') ? 'wire' : 'thick';
  if (rim === 'brow' || rim === 'combo') v = 'thick';
  let k = `${shapeId}_${v}`; if (!manifest.keys[k]) k = `${shapeId}_${v === 'wire' ? 'thick' : 'wire'}`;
  return manifest.keys[k] ? k : null;
}
// gradient map: luminance -> lo .. c .. hi .. white
function metalLUT(M) {
  const lo = hex(M.lo), c = hex(M.c), hi = hex(M.hi), stops = [[0, [lo[0] * 0.35, lo[1] * 0.35, lo[2] * 0.35]], [0.22, lo], [0.5, c], [0.8, hi], [1, [255, 255, 250]]];
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255; let j = 0; while (j < stops.length - 2 && t > stops[j + 1][0]) j++;
    const [t0, a] = stops[j], [t1, b] = stops[j + 1], f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    for (let k = 0; k < 3; k++) lut[i * 3 + k] = a[k] + (b[k] - a[k]) * f;
  }
  return lut;
}
function tortoiseField(W, H, F) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  x.fillStyle = F.c; x.fillRect(0, 0, W, H);
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  x.filter = 'blur(3px)';
  for (let i = 0; i < 420; i++) {
    const px = rnd() * W, py = rnd() * H, r = 6 + rnd() * 26; const [sr, sg, sb] = hex(F.spot);
    x.fillStyle = `rgba(${sr},${sg},${sb},${0.35 + rnd() * 0.55})`; x.beginPath(); x.ellipse(px, py, r * 1.8, r * 0.8, -0.5 + rnd() * 0.6, 0, 7); x.fill();
  }
  for (let i = 0; i < 160; i++) { const px = rnd() * W, py = rnd() * H, r = 3 + rnd() * 10; x.fillStyle = 'rgba(232,170,90,0.30)'; x.beginPath(); x.ellipse(px, py, r * 1.5, r, 0, 0, 7); x.fill(); }
  return x.getImageData(0, 0, W, H).data;
}
function colorize(key, frameId, accentWarm) {
  const ck = key + '|' + frameId + '|' + accentWarm; if (colCache.has(ck)) return colCache.get(ck);
  const info = manifest.keys[key];
  const ia = info.A ? load(key + '_a.png') : null, im = info.M ? load(key + '_m.png') : null, il = load(key + '_l.png');
  if ((info.A && !ia) || (info.M && !im) || !il) return null;
  const F = FRAMES[frameId], sh = SHAPE_BY_ID[key.replace(/_(thick|wire)$/, '')], rim = sh.rim || 'full', thick = key.endsWith('_thick');
  const W = il.naturalWidth, H = il.naturalHeight;
  const frame = document.createElement('canvas'); frame.width = W; frame.height = H; const fx = frame.getContext('2d');
  const out = fx.createImageData(W, H), o = out.data;
  // metal layer
  const isMetal = F.kind === 'metal';
  const metalOf = (q) => q.kind === 'metal' ? q : { c: q.c, hi: mixh(q.c, '#ffffff', 0.55), lo: mixh(q.c, '#000000', 0.5) };
  const M = isMetal ? F : thick ? (accentWarm ? FRAMES.gold : FRAMES.silver) : metalOf(F);
  if (im) {
    const d = pixels(im).data, lut = metalLUT(M);
    for (let i = 0; i < W * H; i++) { const a = d[i * 4 + 3]; if (!a) continue; const l = d[i * 4] * 3; o[i * 4] = lut[l]; o[i * 4 + 1] = lut[l + 1]; o[i * 4 + 2] = lut[l + 2]; o[i * 4 + 3] = a; }
  }
  if (ia) {
    const d = pixels(ia).data;
    const AF = (isMetal && (rim === 'brow' || rim === 'combo')) ? FRAMES.black : isMetal ? FRAMES.black : F;
    const base = hex(AF.c), tort = AF.kind === 'tortoise' ? tortoiseField(W, H, AF) : null, c2 = AF.c2 ? hex(AF.c2) : null;
    const specK = AF.matte ? 0.25 : AF.kind === 'clear' ? 1.15 : 1;
    // vertical extent of acetate for gradient frames
    const y0 = H * 0.5 - 0.75 * 160, y1 = H * 0.5 + 0.55 * 160;
    for (let y = 0; y < H; y++) {
      const gy = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
      for (let x = 0; x < W; x++) {
        const i = y * W + x, a = d[i * 4 + 3]; if (!a) continue;
        const diff = d[i * 4] / 255 * 1.25, spec = d[i * 4 + 1] * specK;
        let r = base[0], g = base[1], b = base[2], al = a;
        if (tort) { r = tort[i * 4]; g = tort[i * 4 + 1]; b = tort[i * 4 + 2]; }
        if (c2) { const t = Math.max(0, (gy - 0.3) / 0.7); r += (c2[0] - r) * t; g += (c2[1] - g) * t; b += (c2[2] - b) * t; al = a * (1 - 0.45 * t); }
        if (AF.kind === 'clear') al = a * (0.38 + 0.5 * Math.min(1, spec / 160));
        const k = Math.min(1.25, diff);
        const R = r * k + spec, G = g * k + spec, B = b * k + spec;
        // over existing metal pixel
        const ea = o[i * 4 + 3] / 255, na = al / 255, ta = na + ea * (1 - na);
        o[i * 4] = (R * na + o[i * 4] * ea * (1 - na)) / ta; o[i * 4 + 1] = (G * na + o[i * 4 + 1] * ea * (1 - na)) / ta; o[i * 4 + 2] = (B * na + o[i * 4 + 2] * ea * (1 - na)) / ta;
        o[i * 4 + 3] = ta * 255;
      }
    }
  }
  fx.putImageData(out, 0, 0);
  const res = { frame, lens: il, W, H, info };
  colCache.set(ck, res); if (colCache.size > 10) colCache.delete(colCache.keys().next().value);
  return res;
}
function mixh(h1, h2, t) { const a = hex(h1), b = hex(h2); return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join(''); }

// Returns false when the photoreal assets are not available yet (caller falls back to the procedural renderer).
// Draws temples + frame into ctx (cleared); lens reflections go to lensCtx (cleared) to be composited with 'screen'.
export function drawGlasses3D(ctx, lensCtx, P, frameId, shapeId, gScale, accentWarm, hideTemples) {
  const key = variantKey(shapeId, frameId); if (!key) return false;
  const res = colorize(key, frameId, accentWarm); if (!res) return false;
  drawGlasses(ctx, P, frameId, shapeId, gScale, accentWarm, hideTemples, true); // procedural temples only
  const Wc = lensCtx.canvas.width, Hc = lensCtx.canvas.height; lensCtx.setTransform(1, 0, 0, 1, 0, 0); lensCtx.clearRect(0, 0, Wc, Hc);
  let L = P.iL, R = P.iR; if (L.x > R.x) [L, R] = [R, L];
  const dx = R.x - L.x, dy = R.y - L.y, d = Math.hypot(dx, dy); if (d < 6) return true;
  const e = { x: dx / d, y: dy / d }, n = { x: -e.y, y: e.x };
  const t = Math.min(d * 0.7, Math.max(d * 0.3, (P.B.x - L.x) * e.x + (P.B.y - L.y) * e.y));
  const C = { x: L.x + e.x * t, y: L.y + e.y * t };
  const g = gScale * 0.94, u = (d / 2) * g, k = 160, cx = res.W / 2, cy = res.H / 2;
  const sides = [{ s: (d - t) * g, sx: cx, sw: res.W - cx }, { s: t * g, sx: 0, sw: cx }];
  for (const target of [ctx, lensCtx]) {
    const src = target === ctx ? res.frame : res.lens;
    target.imageSmoothingEnabled = true; target.imageSmoothingQuality = 'high';
    for (const sd of sides) {
      // local x = (px - cx)/k ; screen = C + e*x*s + n*y*u  (right half uses s of right side, left half of left side)
      target.setTransform(e.x * sd.s / k, e.y * sd.s / k, n.x * u / k, n.y * u / k, C.x - (e.x * sd.s * cx + n.x * u * cy) / k, C.y - (e.y * sd.s * cx + n.y * u * cy) / k);
      target.drawImage(src, sd.sx, 0, sd.sw, res.H, sd.sx, 0, sd.sw, res.H);
    }
    target.setTransform(1, 0, 0, 1, 0, 0);
  }
  return true;
}
