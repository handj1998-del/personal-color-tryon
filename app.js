// 퍼스널컬러 가상 피팅 — 100% client-side. Photos/video never leave the device.
const MP_VER = '1.0.1';
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`;
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const HAIR_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite';

/* ------------------------------------------------------------------ data */
const FRAMES = {
  gold:          { n: '골드메탈',     kind: 'metal', c: '#C9A24E', hi: '#F6E3A6', lo: '#7D5F22' },
  rosegold:      { n: '로즈골드메탈', kind: 'metal', c: '#C98F7E', hi: '#F5D2C6', lo: '#875448' },
  antiquegold:   { n: '앤틱골드메탈', kind: 'metal', c: '#A68A4E', hi: '#DCC892', lo: '#5E4A22' },
  silver:        { n: '실버메탈',     kind: 'metal', c: '#A9AFB7', hi: '#F4F6F8', lo: '#545A62' },
  gunmetal:      { n: '건메탈',       kind: 'metal', c: '#5B5E64', hi: '#A9ADB4', lo: '#2B2D31' },
  tortoiselight: { n: '뿔테 라이트호피', kind: 'tortoise', c: '#C48A4C', spot: '#6E3D18' },
  tortoise:      { n: '뿔테 브라운호피', kind: 'tortoise', c: '#7A4824', spot: '#2A160A' },
  brown:         { n: '뿔테 브라운',  kind: 'acetate', c: '#6A4530' },
  camel:         { n: '뿔테 카멜',    kind: 'acetate', c: '#A8764A' },
  khaki:         { n: '뿔테 카키',    kind: 'acetate', c: '#6A6447' },
  ivory:         { n: '뿔테 아이보리', kind: 'acetate', c: '#E7DCC4' },
  grey:          { n: '뿔테 그레이',  kind: 'acetate', c: '#808390' },
  black:         { n: '뿔테 블랙',    kind: 'acetate', c: '#161517' },
  wine:          { n: '뿔테 와인',    kind: 'acetate', c: '#5E1E2E' },
  navy:          { n: '뿔테 네이비',  kind: 'acetate', c: '#1F2A46' },
  clearpink:     { n: '투명 핑크',    kind: 'clear', c: '#F1A9BE' },
  clearpeach:    { n: '투명 피치',    kind: 'clear', c: '#F4B892' },
  clearlav:      { n: '투명 라벤더',  kind: 'clear', c: '#BFA9E6' },
  clear:         { n: '투명 크리스탈', kind: 'clear', c: '#DCE6EE' },
  cleargrey:     { n: '투명 그레이',  kind: 'clear', c: '#8E949D' },
};
const SHAPES = [
  { id: 'none', n: '없음' }, { id: 'round', n: '라운드' }, { id: 'square', n: '스퀘어' },
  { id: 'boeing', n: '보잉' }, { id: 'browline', n: '하금테' },
];
const TYPES = {
  spring: { n: '봄 웜', e: '🌸', bg: 'var(--spring)', worst: 'winter', warm: true,
    subs: [['light', '라이트'], ['bright', '브라이트']],
    hair: [ { n: '밀크브라운', c: '#A27C5E', t: ['light'] }, { n: '허니브라운', c: '#A06D3C', t: ['light', 'bright'] },
            { n: '오렌지브라운', c: '#9E5630', t: ['bright'] }, { n: '골드브라운', c: '#8C6436', t: ['light', 'bright'] },
            { n: '코랄브라운', c: '#9A5B49', t: ['bright'] }, { n: '카라멜브라운', c: '#80553A', t: ['light'] } ],
    frames: ['gold', 'rosegold', 'tortoiselight', 'clearpeach', 'camel', 'ivory'] },
  summer: { n: '여름 쿨', e: '🌊', bg: 'var(--summer)', worst: 'autumn', warm: false,
    subs: [['light', '라이트'], ['mute', '뮤트']],
    hair: [ { n: '애쉬브라운', c: '#6D6159', t: ['light', 'mute'] }, { n: '애쉬베이지', c: '#8E8274', t: ['light'] },
            { n: '로즈브라운', c: '#7C5352', t: ['light', 'mute'] }, { n: '라벤더브라운', c: '#6C5A6B', t: ['light'] },
            { n: '애쉬그레이', c: '#716F6F', t: ['mute'] }, { n: '소프트블랙', c: '#302C2F', t: ['mute'] } ],
    frames: ['silver', 'rosegold', 'clearpink', 'clearlav', 'grey', 'clear'] },
  autumn: { n: '가을 웜', e: '🍂', bg: 'var(--autumn)', worst: 'summer', warm: true,
    subs: [['mute', '뮤트'], ['deep', '딥']],
    hair: [ { n: '초코브라운', c: '#563726', t: ['mute', 'deep'] }, { n: '다크브라운', c: '#4A3427', t: ['deep'] },
            { n: '카퍼브라운', c: '#7C3F22', t: ['deep'] }, { n: '카키브라운', c: '#5F523A', t: ['mute'] },
            { n: '마호가니', c: '#5C2B25', t: ['deep'] }, { n: '올리브브라운', c: '#5B4E37', t: ['mute'] } ],
    frames: ['antiquegold', 'gold', 'tortoise', 'brown', 'khaki', 'camel'] },
  winter: { n: '겨울 쿨', e: '❄️', bg: 'var(--winter)', worst: 'spring', warm: false,
    subs: [['bright', '브라이트'], ['deep', '딥']],
    hair: [ { n: '블루블랙', c: '#141824', t: ['bright', 'deep'] }, { n: '블랙', c: '#131212', t: ['deep'] },
            { n: '다크애쉬', c: '#35312F', t: ['deep'] }, { n: '버건디', c: '#4E1B29', t: ['bright'] },
            { n: '플럼퍼플', c: '#3D2338', t: ['bright'] }, { n: '쿨다크브라운', c: '#3B2E2C', t: ['deep'] } ],
    frames: ['black', 'silver', 'gunmetal', 'clear', 'wine', 'navy'] },
};

/* ------------------------------------------------------------------ state */
const S = {
  type: 'spring', sub: 'light', hair: TYPES.spring.hair[0], intensity: 0.75,
  frame: 'gold', shape: 'round', gScale: 1,
  showWorst: false, compare: 'after', holdBefore: false,
  mode: 'live',          // 'live' | 'still'
  facing: 'user',
};
const $ = (id) => document.getElementById(id);
const view = $('view'), vctx = view.getContext('2d');
const video = $('video');
const stage = $('stage');
const mk = (w = 1, h = 1) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const rawC = mk(), rawX = rawC.getContext('2d', { willReadFrequently: true });
const outC = mk(), outX = outC.getContext('2d');
const recC = mk(), recX = recC.getContext('2d');
const glassC = mk(), glassX = glassC.getContext('2d');
const maskC = mk(), maskX = maskC.getContext('2d');
const shadowC = mk(), shadowX = shadowC.getContext('2d');
const segIn = mk(), segX = segIn.getContext('2d', { willReadFrequently: true });

let MP = null, face = null, seg = null, faceMode = null, segMode = null, delegate = 'GPU';
let stream = null, liveRAF = 0, cameraOK = false, mkFace = null, mkSeg = null, switching = false, tuned = false;
// Auto-tune: some devices (weak/emulated GPUs) run WebGL inference slower than WASM-SIMD on CPU.
async function switchToCPU() {
  switching = true;
  try {
    const f2 = await mkFace('CPU'), s2 = await mkSeg('CPU');
    try { face.close(); seg.close(); } catch (e) {}
    face = f2; seg = s2; faceMode = segMode = 'VIDEO'; delegate = 'CPU'; stats.delegate = 'CPU(auto)'; resetFilters();
    if (S.mode !== 'live') await ensureMode('IMAGE');
    console.info('auto-switched to CPU delegate');
  } catch (e) { console.warn('CPU switch failed', e); }
  switching = false;
}
let mirror = false;          // mirror on display (front camera)
let lm = null;               // current landmarks in raw pixel coords (only needed points)
let hairMask = null;         // {data: Float32Array, w, h, meanY, bbox}
const stats = { fps: 0, frames: 0, detMs: 0, segMs: 0, renderMs: 0, segEvery: 2, delegate: '', lastFps: [] };
window.__pc = { S, stats, get lm() { return lm; }, get hairMask() { return hairMask; }, render: () => renderStill() };

/* ------------------------------------------------------------------ utils */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex2rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgba = (h, a) => { const [r, g, b] = hex2rgb(h); return `rgba(${r},${g},${b},${a})`; };
const mix = (h1, h2, t) => { const a = hex2rgb(h1), b = hex2rgb(h2); return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
let toastT = 0;
function toast(msg, ms = 2400) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
function setStatus(s) { $('status').textContent = s; }

/* One-Euro filter for landmark smoothing (reduces jitter, keeps fast motion responsive) */
class OneEuro {
  constructor(minCut = 1.2, beta = 0.015, dCut = 1.0) { this.minCut = minCut; this.beta = beta; this.dCut = dCut; this.x = null; this.dx = 0; this.t = 0; }
  static a(cut, dt) { const tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); }
  f(x, t) {
    if (this.x === null) { this.x = x; this.t = t; return x; }
    const dt = Math.max(1e-3, (t - this.t) / 1000); this.t = t;
    const dx = (x - this.x) / dt; const ad = OneEuro.a(this.dCut, dt); this.dx = this.dx + ad * (dx - this.dx);
    const cut = this.minCut + this.beta * Math.abs(this.dx); const a = OneEuro.a(cut, dt);
    this.x = this.x + a * (x - this.x); return this.x;
  }
}
const KEYS = { iL: 468, iR: 473, B: 168, eL: 234, eR: 454, oL: 33, oR: 263 };
let filters = null;
function resetFilters() { filters = null; }
function extractLm(res, W, H, t) {
  const f = res && res.faceLandmarks && res.faceLandmarks[0];
  if (!f || f.length < 474) return null;
  const out = {};
  for (const [k, i] of Object.entries(KEYS)) out[k] = { x: f[i].x * W, y: f[i].y * H };
  if (t === undefined) return out;
  if (!filters) { filters = {}; for (const k of Object.keys(KEYS)) filters[k] = [new OneEuro(), new OneEuro()]; }
  for (const k of Object.keys(KEYS)) { out[k].x = filters[k][0].f(out[k].x, t); out[k].y = filters[k][1].f(out[k].y, t); }
  return out;
}

/* ------------------------------------------------------------------ models */
async function loadModels() {
  setStatus('AI 모델 불러오는 중…');
  MP = await import(MP_URL);
  const files = await MP.FilesetResolver.forVisionTasks(WASM_URL);
  mkFace = (d) => MP.FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate: d }, runningMode: 'VIDEO', numFaces: 1,
    minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
  mkSeg = (d) => MP.ImageSegmenter.createFromOptions(files, {
    baseOptions: { modelAssetPath: HAIR_MODEL, delegate: d }, runningMode: 'VIDEO',
    outputConfidenceMasks: true, outputCategoryMask: false });
  const forceCPU = new URLSearchParams(location.search).has('cpu');
  try { if (forceCPU) throw 0; face = await mkFace('GPU'); seg = await mkSeg('GPU'); delegate = 'GPU'; }
  catch (e) { console.warn('GPU delegate failed, using CPU', e); face = face || await mkFace('CPU'); seg = await mkSeg('CPU'); delegate = face && seg ? 'CPU' : delegate; }
  faceMode = segMode = 'VIDEO'; stats.delegate = delegate;
}
async function ensureMode(m) {
  if (faceMode !== m) { await face.setOptions({ runningMode: m }); faceMode = m; }
  if (segMode !== m) { await seg.setOptions({ runningMode: m }); segMode = m; }
  if (m === 'VIDEO') resetFilters();
}

/* ------------------------------------------------------------------ hair mask */
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length), dst = new Float32Array(src.length);
  for (let y = 0; y < h; y++) { let acc = 0; const o = y * w;
    for (let x = -r; x <= r; x++) acc += src[o + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) { tmp[o + x] = acc / (2 * r + 1); acc += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)]; } }
  for (let x = 0; x < w; x++) { let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) { dst[y * w + x] = acc / (2 * r + 1); acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
  return dst;
}
// Turn the raw confidence mask into a smoothed mask + hair stats (computed on segIn pixels)
function buildHairMask(conf, w, h, prev) {
  let m = conf;
  if (prev && prev.w === w && prev.h === h) { // temporal EMA to stop flicker in live mode
    const s = new Float32Array(m.length); for (let i = 0; i < m.length; i++) s[i] = prev.raw[i] * 0.45 + m[i] * 0.55; m = s;
  } else m = new Float32Array(m);
  const raw = m;
  const sm = boxBlur(m, w, h, Math.max(1, Math.round(Math.max(w, h) / 220)));
  const px = segX.getImageData(0, 0, w, h).data;
  let sumY = 0, n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, v = sm[i];
    if (v > 0.25) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (v > 0.6) { const j = i * 4; sumY += 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]; n++; }
  }
  const cover = n / (w * h);
  if (x1 < 0 || cover < 0.002) return { raw, w, h, empty: true, cover };
  // alpha mask image (small; gets bilinearly upscaled when composited)
  const id = maskX.createImageData(w, h);
  for (let i = 0; i < sm.length; i++) { let a = clamp((sm[i] - 0.18) / 0.62, 0, 1); a = a * a * (3 - 2 * a); id.data[i * 4 + 3] = a * 255; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; }
  return { raw, w, h, id, meanY: Math.max(18, sumY / Math.max(1, n)), cover,
           bbox: [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h], empty: false };
}
function segInputFrom(src, sw, sh, maxSide) {
  const s = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(16, Math.round(sw * s)), h = Math.max(16, Math.round(sh * s));
  if (segIn.width !== w || segIn.height !== h) { segIn.width = w; segIn.height = h; }
  segX.drawImage(src, 0, 0, w, h);
  return segIn;
}
function takeMask(result) {
  const ms = result && result.confidenceMasks; if (!ms || !ms.length) return null;
  const m = ms[ms.length - 1]; // hair_segmenter: [background, hair]
  return { data: m.getAsFloat32Array(), w: m.width, h: m.height };
}

/* ------------------------------------------------------------------ hair recolor */
let lutCache = { key: '' , lut: null };
function hairLUT(hex, meanY) {
  const key = hex + '|' + Math.round(meanY);
  if (lutCache.key === key) return lutCache.lut;
  const [tr, tg, tb] = hex2rgb(hex);
  const lut = new Uint8ClampedArray(256 * 3);
  for (let y = 0; y < 256; y++) {
    const r = (y + 1) / (meanY + 1);                 // pixel brightness relative to average hair brightness
    let k = r < 1 ? Math.pow(r, 0.85) : 1 + (Math.pow(r, 0.75) - 1) * 0.9; // keep texture, compress highlights
    const hl = Math.max(0, k - 1) * 40;              // highlights drift toward white (shine)
    lut[y * 3] = tr * k + hl; lut[y * 3 + 1] = tg * k + hl; lut[y * 3 + 2] = tb * k + hl;
  }
  lutCache = { key, lut }; return lut;
}
function applyHair(ctx, W, H, mask, hex, intensity) {
  if (!mask || mask.empty || !hex || intensity <= 0) return;
  const [bx0, by0, bx1, by1] = mask.bbox;
  const pad = 0.02;
  const x = Math.max(0, Math.floor((bx0 - pad) * W)), y = Math.max(0, Math.floor((by0 - pad) * H));
  const w = Math.min(W, Math.ceil((bx1 + pad) * W)) - x, h = Math.min(H, Math.ceil((by1 + pad) * H)) - y;
  if (w <= 0 || h <= 0) return;
  if (recC.width !== W || recC.height !== H) { recC.width = W; recC.height = H; }
  const img = rawX.getImageData(x, y, w, h), d = img.data;
  const lut = hairLUT(hex, mask.meanY);
  for (let i = 0; i < d.length; i += 4) {
    const Y = (77 * d[i] + 150 * d[i + 1] + 29 * d[i + 2]) >> 8, j = Y * 3;
    d[i] = lut[j] * 0.92 + d[i] * 0.08; d[i + 1] = lut[j + 1] * 0.92 + d[i + 1] * 0.08; d[i + 2] = lut[j + 2] * 0.92 + d[i + 2] * 0.08;
  }
  recX.globalCompositeOperation = 'source-over'; recX.clearRect(0, 0, W, H);
  recX.putImageData(img, x, y);
  if (maskC.width !== mask.w || maskC.height !== mask.h) { maskC.width = mask.w; maskC.height = mask.h; }
  maskX.putImageData(mask.id, 0, 0);
  recX.globalCompositeOperation = 'destination-in';
  recX.imageSmoothingEnabled = true; recX.imageSmoothingQuality = 'high';
  recX.drawImage(maskC, 0, 0, W, H);
  recX.globalCompositeOperation = 'source-over';
  ctx.save(); ctx.globalAlpha = intensity; ctx.drawImage(recC, 0, 0); ctx.restore();
}

/* ------------------------------------------------------------------ glasses */
let tortoiseCache = {};
function tortoisePattern(ctx, base, spot) {
  const key = base + spot;
  if (!tortoiseCache[key]) {
    const c = mk(128, 128), x = c.getContext('2d');
    x.fillStyle = base; x.fillRect(0, 0, 128, 128);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 70; i++) {
      const px = rnd() * 128, py = rnd() * 128, r = 3 + rnd() * 12;
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      const a = 0.35 + rnd() * 0.5; g.addColorStop(0, rgba(spot, a)); g.addColorStop(1, rgba(spot, 0));
      x.fillStyle = g; x.beginPath(); x.ellipse(px, py, r * 1.6, r, rnd() * 3, 0, Math.PI * 2); x.fill();
    }
    for (let i = 0; i < 25; i++) { const px = rnd() * 128, py = rnd() * 128, r = 2 + rnd() * 6;
      x.fillStyle = rgba('#E8B063', 0.25); x.beginPath(); x.arc(px, py, r, 0, 7); x.fill(); }
    tortoiseCache[key] = c;
  }
  const p = ctx.createPattern(tortoiseCache[key], 'repeat');
  p.setTransform(new DOMMatrix().scale(1 / 110));
  return p;
}
// lens outline in local units (1 unit = half the inter-pupil distance); right-side lens, +x = outward
function lensPath(shape, cx, cy) {
  const p = new Path2D();
  if (shape === 'round') { p.ellipse(cx, cy, 0.78, 0.74, 0, 0, Math.PI * 2); return p; }
  if (shape === 'boeing') { // aviator: straight-ish brow, slanted inner edge, full rounded bottom
    p.moveTo(cx - 0.80, cy - 0.50);
    p.bezierCurveTo(cx - 0.35, cy - 0.66, cx + 0.45, cy - 0.68, cx + 0.90, cy - 0.58);
    p.bezierCurveTo(cx + 1.04, cy - 0.25, cx + 0.92, cy + 0.55, cx + 0.25, cy + 0.80);
    p.bezierCurveTo(cx - 0.30, cy + 0.95, cx - 0.72, cy + 0.55, cx - 0.80, cy + 0.05);
    p.bezierCurveTo(cx - 0.84, cy - 0.20, cx - 0.83, cy - 0.40, cx - 0.80, cy - 0.50);
    p.closePath(); return p;
  }
  // square / browline: soft wellington trapezoid
  const xi = cx - 0.80, xo = cx + 0.86, yt = cy - 0.60, yb = cy + 0.56, inset = 0.07, r = 0.24;
  p.moveTo(xi + r, yt);
  p.lineTo(xo - r, yt - 0.02); p.quadraticCurveTo(xo, yt - 0.02, xo, yt + r);
  p.lineTo(xo - inset, yb - r); p.quadraticCurveTo(xo - inset, yb, xo - inset - r, yb);
  p.lineTo(xi + inset + r, yb); p.quadraticCurveTo(xi + inset, yb, xi + inset, yb - r);
  p.lineTo(xi, yt + r); p.quadraticCurveTo(xi, yt, xi + r, yt);
  p.closePath(); return p;
}
function lensEdgeX(shape, cx, cy, y, outer) {
  if (shape === 'round') { const k = clamp((y - cy) / 0.74, -0.98, 0.98); const w = 0.78 * Math.sqrt(1 - k * k); return outer ? cx + w : cx - w; }
  if (shape === 'boeing') return outer ? cx + 0.92 : cx - 0.82;
  return outer ? cx + 0.86 : cx - 0.80;
}
function browTopPath(cx, cy) {
  const p = new Path2D(), xi = cx - 0.80, xo = cx + 0.86, yt = cy - 0.60, r = 0.24;
  p.moveTo(xi + 0.02, cy - 0.05); p.lineTo(xi, yt + r); p.quadraticCurveTo(xi, yt, xi + r, yt);
  p.lineTo(xo - r, yt - 0.02); p.quadraticCurveTo(xo, yt - 0.02, xo, yt + r); p.lineTo(xo - 0.01, cy - 0.12);
  return p;
}
function drawGlasses(ctx, P, frameId, shape, gScale) {
  if (!P || shape === 'none' || !frameId) return;
  const F = FRAMES[frameId];
  let L = P.iL, R = P.iR, eL = P.eL, eR = P.eR;
  if (L.x > R.x) { [L, R] = [R, L]; [eL, eR] = [eR, eL]; }
  const dx = R.x - L.x, dy = R.y - L.y, d = Math.hypot(dx, dy); if (d < 6) return;
  const e = { x: dx / d, y: dy / d }, n = { x: -e.y, y: e.x };
  const t = clamp((P.B.x - L.x) * e.x + (P.B.y - L.y) * e.y, d * 0.3, d * 0.7);
  const C = { x: L.x + e.x * t, y: L.y + e.y * t };
  gScale *= 0.94; // base fit
  const u = (d / 2) * gScale;
  const sides = [ { s: (d - t) * gScale, sign: 1, ear: eR }, { s: t * gScale, sign: -1, ear: eL } ];
  const cx = 1.08, cy = -0.04;
  const metal = F.kind === 'metal', th = metal ? 0.068 : 0.15;
  const isBrow = shape === 'browline', isBoeing = shape === 'boeing';
  const accent = TYPES[S.type].warm ? FRAMES.gold : FRAMES.silver; // 하금테 lower metal rim
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); ctx.restore();

  const toScreen = (sd, x, y) => ({ x: C.x + e.x * x * sd.s * sd.sign + n.x * y * u, y: C.y + e.y * x * sd.s * sd.sign + n.y * y * u });
  const setT = (sd) => ctx.setTransform(e.x * sd.s * sd.sign, e.y * sd.s * sd.sign, n.x * u, n.y * u, C.x, C.y);
  const frameStroke = () => {
    if (F.kind === 'tortoise') return tortoisePattern(ctx, F.c, F.spot);
    if (metal) { const g = ctx.createLinearGradient(0, -0.8, 0, 0.8); g.addColorStop(0, F.hi); g.addColorStop(0.35, F.c); g.addColorStop(0.7, F.lo); g.addColorStop(1, F.c); return g; }
    if (F.kind === 'clear') return rgba(mix(F.c, '#000000', 0.15), 0.9);
    return F.c;
  };
  const pxPerUnit = u;

  // temples (behind the front): only visible where the ear lies outward of the hinge
  for (const sd of sides) {
    const hinge = toScreen(sd, cx + 0.98, -0.36);
    const earLocal = ((sd.ear.x - C.x) * e.x + (sd.ear.y - C.y) * e.y) * sd.sign / sd.s;
    if (earLocal > cx + 1.0) {
      const end = toScreen(sd, cx + 0.98 + (earLocal - cx - 0.98) * 0.9, -0.28);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const g = ctx.createLinearGradient(hinge.x, hinge.y, end.x, end.y);
      const base = metal ? F.c : F.kind === 'clear' ? rgba(F.c, 0.8) : F.kind === 'tortoise' ? F.c : F.c;
      g.addColorStop(0, base); g.addColorStop(0.75, base); g.addColorStop(1, rgba('#000000', 0));
      ctx.strokeStyle = g; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.5, (metal ? 0.07 : 0.13) * pxPerUnit);
      ctx.beginPath(); ctx.moveTo(hinge.x, hinge.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    }
  }
  for (const sd of sides) {
    setT(sd);
    const lens = lensPath(shape, cx, cy);
    // lens: faint tint + reflection
    ctx.fillStyle = F.kind === 'clear' ? rgba(F.c, 0.10) : 'rgba(225,235,245,0.08)'; ctx.fill(lens);
    ctx.save(); ctx.clip(lens);
    const rg = ctx.createLinearGradient(cx - 0.8, cy - 0.8, cx + 0.6, cy + 0.8);
    rg.addColorStop(0.0, 'rgba(255,255,255,0)'); rg.addColorStop(0.28, 'rgba(255,255,255,0.20)');
    rg.addColorStop(0.36, 'rgba(255,255,255,0.04)'); rg.addColorStop(0.5, 'rgba(255,255,255,0.12)'); rg.addColorStop(0.6, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg; ctx.fillRect(cx - 1.2, cy - 1.2, 2.4, 2.4);
    ctx.restore();

    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // bridge
    ctx.strokeStyle = frameStroke();
    if (metal || isBoeing || isBrow) {
      const bm = metal ? F : accent;
      const g = ctx.createLinearGradient(0, -0.6, 0, -0.2); g.addColorStop(0, bm.hi); g.addColorStop(0.5, bm.c); g.addColorStop(1, bm.lo);
      ctx.strokeStyle = metal ? frameStroke() : g; ctx.lineWidth = 0.06;
      const bx = lensEdgeX(shape, cx, cy, -0.40, false) + 0.03; ctx.beginPath(); ctx.moveTo(0, -0.36); ctx.quadraticCurveTo(bx * 0.5, -0.46, bx, -0.40); ctx.stroke();
      if (isBoeing) { ctx.beginPath(); ctx.moveTo(0, -0.66); ctx.quadraticCurveTo(0.3, -0.68, cx - 0.42, -0.66); ctx.stroke(); }
      // nose pads
      ctx.fillStyle = 'rgba(240,244,248,0.35)'; ctx.strokeStyle = 'rgba(160,170,180,0.5)'; ctx.lineWidth = 0.015;
      ctx.beginPath(); ctx.ellipse(0.30, 0.12, 0.07, 0.15, -0.3, 0, 7); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = metal ? frameStroke() : g; ctx.lineWidth = 0.02;
      const px0 = lensEdgeX(shape, cx, cy, -0.25, false) + 0.02; ctx.beginPath(); ctx.moveTo(px0, -0.25); ctx.quadraticCurveTo(0.42, -0.1, 0.32, 0.0); ctx.stroke();
    } else {
      ctx.lineWidth = th * 0.95;
      const bx = lensEdgeX(shape, cx, cy, -0.30, false) + th * 0.3; ctx.beginPath(); ctx.moveTo(0, -0.30); ctx.quadraticCurveTo(bx * 0.5, -0.40, bx, -0.30); ctx.stroke();
    }
    // rim
    if (isBrow) {
      const g = ctx.createLinearGradient(0, -0.6, 0, 0.6); g.addColorStop(0, accent.hi); g.addColorStop(0.5, accent.c); g.addColorStop(1, accent.lo);
      ctx.strokeStyle = g; ctx.lineWidth = 0.045; ctx.stroke(lens);
      ctx.strokeStyle = frameStroke(); ctx.lineWidth = metal ? 0.13 : 0.2; ctx.stroke(browTopPath(cx, cy));
      if (!metal) { ctx.strokeStyle = rgba('#ffffff', 0.22); ctx.lineWidth = 0.04; ctx.save(); ctx.translate(0, -0.05); ctx.stroke(browTopPath(cx, cy)); ctx.restore(); }
    } else {
      ctx.strokeStyle = frameStroke(); ctx.lineWidth = th; ctx.stroke(lens);
      if (F.kind === 'clear') { // hollow-looking translucent rim: keep edges, thin the middle
        ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = th * 0.62; ctx.stroke(lens); ctx.restore();
        ctx.strokeStyle = rgba(F.c, 0.35); ctx.lineWidth = th * 0.62; ctx.stroke(lens);
      }
      // specular highlight along the top
      ctx.save(); ctx.translate(0, -th * 0.28);
      ctx.strokeStyle = metal ? rgba(F.hi, 0.75) : rgba('#ffffff', F.kind === 'clear' ? 0.5 : 0.2);
      ctx.lineWidth = th * (metal ? 0.3 : 0.22); ctx.setLineDash([0.9, 0.5]); ctx.lineDashOffset = 0.2; ctx.stroke(lens); ctx.restore();
    }
    // end piece / hinge block
    ctx.fillStyle = metal ? frameStroke() : (F.kind === 'clear' ? rgba(mix(F.c, '#000', 0.15), 0.85) : frameStroke());
    const ex0 = lensEdgeX(shape, cx, cy, -0.40, true) - (metal ? 0.03 : th * 0.4);
    ctx.beginPath(); ctx.roundRect(ex0, metal ? -0.46 : -0.50, cx + 1.02 - ex0, metal ? 0.12 : 0.2, 0.05); ctx.fill();
    if (!metal) { ctx.fillStyle = rgba('#d8d8d8', 0.9); ctx.beginPath(); ctx.arc(ex0 - 0.04, -0.4, 0.03, 0, 7); ctx.fill(); } // rivet
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/* ------------------------------------------------------------------ compositing */
function compose(W, H, P, mask) {
  if (outC.width !== W || outC.height !== H) { outC.width = W; outC.height = H; }
  if (glassC.width !== W || glassC.height !== H) { glassC.width = W; glassC.height = H; }
  const t0 = performance.now();
  outX.drawImage(rawC, 0, 0);
  if (S.hair) applyHair(outX, W, H, mask, S.hair.c, S.intensity);
  const t1 = performance.now(); stats.hairMs = (stats.hairMs || 0) * 0.9 + (t1 - t0) * 0.1;
  if (P && S.shape !== 'none') {
    drawGlasses(glassX, P, S.frame, S.shape, S.gScale);
    const d = Math.hypot(P.iR.x - P.iL.x, P.iR.y - P.iL.y);
    // cheap soft drop shadow: render the glasses layer at 1/6 res, tint dark, upscale (bilinear = blur)
    const sw = Math.max(8, Math.round(W / 6)), sh = Math.max(8, Math.round(H / 6));
    if (shadowC.width !== sw || shadowC.height !== sh) { shadowC.width = sw; shadowC.height = sh; }
    shadowX.globalCompositeOperation = 'source-over'; shadowX.clearRect(0, 0, sw, sh); shadowX.drawImage(glassC, 0, 0, sw, sh);
    shadowX.globalCompositeOperation = 'source-in'; shadowX.fillStyle = 'rgb(25,12,12)'; shadowX.fillRect(0, 0, sw, sh);
    outX.save(); outX.globalAlpha = 0.32; outX.imageSmoothingEnabled = true; outX.drawImage(shadowC, 0, d * 0.035, W, H); outX.restore();
    outX.drawImage(glassC, 0, 0);
  }
  stats.glassMs = (stats.glassMs || 0) * 0.9 + (performance.now() - t1) * 0.1;
}
function present(target = view, labels = true) {
  const W = rawC.width, H = rawC.height; const split = S.compare === 'split';
  const tw = split ? W * 2 : W;
  if (target.width !== tw || target.height !== H) { target.width = tw; target.height = H; }
  const x = target.getContext('2d');
  const panes = split ? [[rawC, 0, '원본 BEFORE'], [outC, W, 'AFTER']] : [[S.holdBefore ? rawC : outC, 0, S.holdBefore ? '원본' : '']];
  for (const [src, ox, label] of panes) {
    x.save();
    if (mirror) { x.translate(ox + W, 0); x.scale(-1, 1); x.drawImage(src, 0, 0); }
    else x.drawImage(src, ox, 0);
    x.restore();
    if (labels && label) {
      const fs = Math.max(14, Math.round(H / 26)); x.font = `700 ${fs}px sans-serif`;
      const tw2 = x.measureText(label).width + fs; x.fillStyle = 'rgba(255,255,255,0.85)';
      x.beginPath(); x.roundRect(ox + fs * 0.6, H - fs * 2.2, tw2, fs * 1.6, fs * 0.8); x.fill();
      x.fillStyle = '#3d3346'; x.fillText(label, ox + fs * 1.1, H - fs * 1.4 + fs * 0.35);
    }
  }
  if (split) { x.fillStyle = '#fff'; x.fillRect(W - 2, 0, 4, H); }
}

/* ------------------------------------------------------------------ live mode */
const LIVE_CAP = +(new URLSearchParams(location.search).get('res') || 800); // processing resolution (long side)
let lastSegT = 0, frameNo = 0, fpsT0 = 0, fpsN = 0, segBusy = false;
function liveSize() {
  const vw = video.videoWidth, vh = video.videoHeight; const cap = LIVE_CAP;
  const s = Math.min(1, cap / Math.max(vw, vh)); return [Math.round(vw * s), Math.round(vh * s)];
}
function liveLoop() {
  liveRAF = requestAnimationFrame(liveLoop);
  if (S.mode !== 'live' || switching || video.readyState < 2 || !video.videoWidth) return;
  const t0 = performance.now();
  const [W, H] = liveSize();
  if (rawC.width !== W || rawC.height !== H) { rawC.width = W; rawC.height = H; hairMask = null; }
  rawX.drawImage(video, 0, 0, W, H);
  const ts = t0;
  // face landmarks every frame
  try {
    const r = face.detectForVideo(video, ts);
    const p = extractLm(r, W, H, ts);
    if (!p) resetFilters();
    lm = p;
  } catch (e) { console.warn(e); }
  const t1 = performance.now(); stats.detMs = stats.detMs * 0.9 + (t1 - t0) * 0.1;
  // hair segmentation at low res, every Nth frame
  frameNo++;
  if (S.hair && frameNo % stats.segEvery === 0) {
    segInputFrom(rawC, W, H, 256);
    try {
      seg.segmentForVideo(segIn, ts, (res) => {
        const m = takeMask(res);
        if (m) hairMask = buildHairMask(m.data, m.w, m.h, hairMask);
      });
    } catch (e) { console.warn(e); }
  }
  const t2 = performance.now(); if (S.hair && frameNo % stats.segEvery === 0) stats.segMs = stats.segMs * 0.8 + (t2 - t1) * 0.2;
  compose(W, H, lm, hairMask);
  present();
  const t3 = performance.now(); stats.renderMs = stats.renderMs * 0.9 + (t3 - t2) * 0.1;
  // fps + adaptive segmentation cadence
  fpsN++; if (!fpsT0) fpsT0 = t3;
  if (t3 - fpsT0 >= 1000) {
    stats.fps = fpsN * 1000 / (t3 - fpsT0); fpsN = 0; fpsT0 = t3; stats.lastFps.push(+stats.fps.toFixed(1)); if (stats.lastFps.length > 30) stats.lastFps.shift();
    if (stats.fps < 18 && stats.segEvery < 4) stats.segEvery++; else if (stats.fps > 28 && stats.segEvery > 2) stats.segEvery--;
    $('fps').textContent = `${stats.fps.toFixed(0)} fps · ${delegate}`;
    if (!tuned && delegate === 'GPU' && frameNo > 45) { tuned = true; if (stats.detMs > 55) switchToCPU(); }
  }
  setStatus(lm ? '✓ 얼굴 인식 중' : '얼굴을 화면 가운데에 맞춰주세요');
}
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error(window.isSecureContext ? '이 브라우저는 카메라를 지원하지 않아요' : 'HTTPS 주소에서만 카메라를 쓸 수 있어요');
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({ audio: false,
    video: { facingMode: S.facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
  video.srcObject = stream; await video.play();
  const st = stream.getVideoTracks()[0].getSettings();
  mirror = (st.facingMode || S.facing) !== 'environment';
  cameraOK = true;
}
async function goLive() {
  if (!face) return;
  try {
    if (!cameraOK) await startCamera();
    await ensureMode('VIDEO');
    S.mode = 'live'; hairMask = null; lm = null; resetFilters();
    stage.classList.remove('is-still', 'no-live'); $('placeholder').classList.add('hide');
    $('btnLive').classList.add('on'); $('btnPhoto').classList.remove('on');
    if (!liveRAF) liveLoop();
  } catch (e) {
    console.warn(e); cameraOK = false;
    toast('카메라를 쓸 수 없어요: ' + (e.message || e.name || e)); showPhotoMode();
  }
}
function stopLoop() { if (liveRAF) cancelAnimationFrame(liveRAF); liveRAF = 0; }

/* ------------------------------------------------------------------ still (photo / captured) */
let stillMirror = false;
async function analyzeStill() {
  await ensureMode('IMAGE');
  const W = rawC.width, H = rawC.height;
  const r = face.detect(rawC);
  lm = extractLm(r, W, H);
  segInputFrom(rawC, W, H, 640);
  hairMask = null;
  const res = seg.segment(segIn);
  const m = takeMask(res);
  if (m) hairMask = buildHairMask(m.data, m.w, m.h, null);
  if (res && res.close) res.close();
  window.__pc.lastAnalysis = { face: !!lm, hairCover: hairMask ? hairMask.cover : 0, W, H, maskW: m && m.w, maskH: m && m.h };
}
function renderStill() { if (S.mode !== 'still') return; compose(rawC.width, rawC.height, lm, hairMask); present(); }
async function loadStillFrom(src, sw, sh, mirrorIt) {
  stopLoop(); S.mode = 'still'; mirror = mirrorIt;
  const s = Math.min(1, 1600 / Math.max(sw, sh));
  rawC.width = Math.round(sw * s); rawC.height = Math.round(sh * s);
  rawX.save(); if (mirrorIt) { /* keep source orientation; mirror only on display */ } rawX.drawImage(src, 0, 0, rawC.width, rawC.height); rawX.restore();
  stage.classList.add('is-still'); $('placeholder').classList.add('hide');
  // quick preview, then analyze
  outX.drawImage && compose(rawC.width, rawC.height, null, null); present();
  setStatus('분석 중…'); $('fps').textContent = '';
  try { await analyzeStill(); } catch (e) { console.error(e); toast('분석 중 오류가 났어요'); }
  setStatus(lm ? '✓ 얼굴 인식 완료' : '얼굴을 찾지 못했어요 (헤어만 적용)');
  if (!lm) toast('얼굴을 찾지 못했어요. 정면 사진이 가장 잘 돼요.');
  renderStill();
}
async function capture() {
  if (S.mode !== 'live' || !video.videoWidth) return;
  await loadStillFrom(video, video.videoWidth, video.videoHeight, mirror);
  toast('촬영했어요! 저장하거나 컬러를 계속 바꿔보세요.');
}
async function loadFile(file) {
  if (!file) return;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    await loadStillFrom(bmp, bmp.width, bmp.height, false);
    $('btnPhoto').classList.add('on'); $('btnLive').classList.remove('on');
  } catch (e) { console.error(e); toast('사진을 열 수 없어요'); }
}
async function loadSample() {
  const img = new Image(); img.src = 'assets/sample.jpg'; await img.decode();
  await loadStillFrom(img, img.naturalWidth, img.naturalHeight, false);
  $('btnPhoto').classList.add('on'); $('btnLive').classList.remove('on');
}
function showPhotoMode() {
  stopLoop(); S.mode = 'still';
  $('btnPhoto').classList.add('on'); $('btnLive').classList.remove('on');
  if (!rawC.width || rawC.width < 2 || !lm && !hairMask) {
    $('placeholder').classList.remove('hide'); $('phText').textContent = '사진을 올리거나 샘플 사진으로 시작해 보세요';
    stage.classList.add('no-live');
  }
}

/* ------------------------------------------------------------------ save / share */
function buildExport() {
  const c = mk(); present(c, true);
  const W = c.width, H = c.height, fs = Math.max(16, Math.round(W / 42)), bar = Math.round(fs * 2.6);
  const ex = mk(W, H + bar), x = ex.getContext('2d');
  x.drawImage(c, 0, 0); x.fillStyle = '#fdf6f9'; x.fillRect(0, H, W, bar);
  x.fillStyle = '#3d3346'; x.font = `700 ${fs}px sans-serif`;
  const T = TYPES[S.type]; const sub = T.subs.find((s) => s[0] === S.sub)?.[1] || '';
  const parts = [`${T.e} ${T.n} ${sub}`, S.hair ? `헤어 ${S.hair.n}` : null, S.shape !== 'none' ? `안경 ${FRAMES[S.frame].n} ${SHAPES.find((s) => s.id === S.shape).n}` : null].filter(Boolean);
  x.fillText(parts.join('  ·  '), fs, H + bar / 2 + fs * 0.35);
  x.font = `500 ${Math.round(fs * 0.7)}px sans-serif`; x.fillStyle = '#8a7f93';
  const dt = new Date().toLocaleDateString('ko-KR'); const dw = x.measureText(dt).width; x.fillText(dt, W - dw - fs, H + bar / 2 + fs * 0.3);
  return ex;
}
function exportBlob() { return new Promise((res) => buildExport().toBlob(res, 'image/png')); }
async function save() {
  const blob = await exportBlob(); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `personal-color_${S.type}_${Date.now()}.png`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('이미지를 저장했어요');
}
async function share() {
  const blob = await exportBlob(); const file = new File([blob], 'personal-color.png', { type: 'image/png' });
  try { await navigator.share({ files: [file], title: '퍼스널컬러 가상 피팅' }); } catch (e) { if (e.name !== 'AbortError') toast('공유할 수 없어요'); }
}

/* ------------------------------------------------------------------ UI */
function rerender() { if (S.mode === 'still') renderStill(); /* live loop picks up state automatically */ }
function renderTypes() {
  $('types').innerHTML = Object.entries(TYPES).map(([k, t]) =>
    `<button class="type ${S.type === k ? 'on' : ''}" data-type="${k}" style="background:${t.bg}">${t.e}<span>${t.n}</span></button>`).join('');
  $('subs').innerHTML = TYPES[S.type].subs.map(([k, n]) => `<button class="sub ${S.sub === k ? 'on' : ''}" data-sub="${k}">${TYPES[S.type].n.split(' ')[0]} ${n}</button>`).join('');
}
function hairBtn(h, worst) {
  const on = S.hair && S.hair.n === h.n; const best = !worst && h.t.includes(S.sub);
  return `<button class="sw ${on ? 'on' : ''} ${worst ? 'worst' : ''}" data-hair="${h.n}">${best ? '<span class="best">BEST</span>' : ''}<span class="chip" style="background:radial-gradient(circle at 35% 30%, ${mix(h.c, '#ffffff', 0.35)}, ${h.c} 60%, ${mix(h.c, '#000000', 0.35)})"></span><span class="lbl">${h.n}</span></button>`;
}
function renderHair() {
  const T = TYPES[S.type];
  let html = `<button class="sw ${!S.hair ? 'on' : ''}" data-hair=""><span class="chip" style="background:repeating-linear-gradient(45deg,#eee,#eee 4px,#fff 4px,#fff 8px)"></span><span class="lbl">원래 머리</span></button>`;
  html += T.hair.map((h) => hairBtn(h, false)).join('');
  if (S.showWorst) { const WT = TYPES[T.worst]; html += `<div class="sep">비교용 워스트 (${WT.n})</div>` + WT.hair.map((h) => hairBtn(h, true)).join(''); }
  $('hairList').innerHTML = html;
}
function frameChip(F) {
  if (F.kind === 'metal') return `linear-gradient(180deg, ${F.hi}, ${F.c} 45%, ${F.lo})`;
  if (F.kind === 'tortoise') return `radial-gradient(circle at 30% 40%, ${F.spot} 0 18%, transparent 30%), radial-gradient(circle at 70% 65%, ${F.spot} 0 14%, transparent 26%), ${F.c}`;
  if (F.kind === 'clear') return `linear-gradient(135deg, ${rgba(F.c, 0.55)}, ${rgba(F.c, 0.9)})`;
  return F.c;
}
function renderFrames() {
  const T = TYPES[S.type];
  let ids = T.frames.map((f) => [f, false]);
  if (S.showWorst) ids = ids.concat(TYPES[T.worst].frames.filter((f) => !T.frames.includes(f)).map((f) => [f, true]));
  $('frameList').innerHTML = ids.map(([id, worst], i) => (worst && !ids[i - 1][1] ? `<div class="sep">비교용 워스트 (${TYPES[T.worst].n})</div>` : '') +
    `<button class="sw ${S.frame === id ? 'on' : ''} ${worst ? 'worst' : ''}" data-frame="${id}"><span class="chip" style="background:${frameChip(FRAMES[id])}"></span><span class="lbl">${FRAMES[id].n}</span></button>`).join('');
}
const SHAPE_SVG = {
  none: '<line x1="12" y1="4" x2="44" y2="20" stroke="#c9b9c4" stroke-width="2"/>',
  round: '<circle cx="16" cy="12" r="9"/><circle cx="40" cy="12" r="9"/><path d="M25 10q3-3 6 0"/>',
  square: '<rect x="5" y="4" width="21" height="15" rx="4"/><rect x="30" y="4" width="21" height="15" rx="4"/><path d="M26 9q2-2 4 0"/>',
  boeing: '<path d="M5 5q10-2 20 0q1 12-9 14q-10-1-11-14z"/><path d="M51 5q-10-2-20 0q-1 12 9 14q10-1 11-14z"/><path d="M25 6h6M25 3h6"/>',
  browline: '<path d="M5 9V6q0-2 3-2h15q3 0 3 3v2" stroke-width="4"/><path d="M5 9q0 10 10 10q11 0 11-10" stroke-width="1"/><path d="M30 9V6q0-2 3-2h15q3 0 3 3v2" stroke-width="4"/><path d="M30 9q0 10 10 10q11 0 11-10" stroke-width="1"/>',
};
function renderShapes() {
  $('shapeList').innerHTML = SHAPES.map((s) => `<button class="shape ${S.shape === s.id ? 'on' : ''}" data-shape="${s.id}"><svg viewBox="0 0 56 24" fill="none" stroke="#3d3346" stroke-width="2">${SHAPE_SVG[s.id]}</svg>${s.n}</button>`).join('');
}
function selectType(k) {
  S.type = k; S.sub = TYPES[k].subs[0][0];
  S.hair = TYPES[k].hair.find((h) => h.t.includes(S.sub)) || TYPES[k].hair[0];
  S.frame = TYPES[k].frames[0];
  renderTypes(); renderHair(); renderFrames(); rerender();
}
function bindUI() {
  $('types').addEventListener('click', (ev) => { const b = ev.target.closest('[data-type]'); if (b) selectType(b.dataset.type); });
  $('subs').addEventListener('click', (ev) => { const b = ev.target.closest('[data-sub]'); if (!b) return; S.sub = b.dataset.sub; renderTypes(); renderHair(); });
  $('hairList').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-hair]'); if (!b) return; const n = b.dataset.hair;
    S.hair = n ? Object.values(TYPES).flatMap((t) => t.hair).find((h) => h.n === n) : null;
    if (S.hair && S.mode === 'live' && !hairMask) frameNo = stats.segEvery - 1; // segment on next frame
    renderHair(); rerender();
  });
  $('frameList').addEventListener('click', (ev) => { const b = ev.target.closest('[data-frame]'); if (!b) return; S.frame = b.dataset.frame; if (S.shape === 'none') S.shape = 'round'; renderFrames(); renderShapes(); rerender(); });
  $('shapeList').addEventListener('click', (ev) => { const b = ev.target.closest('[data-shape]'); if (!b) return; S.shape = b.dataset.shape; renderShapes(); rerender(); });
  $('worstToggle').addEventListener('change', (ev) => { S.showWorst = ev.target.checked; renderHair(); renderFrames(); });
  let rq = 0; const throttled = () => { if (!rq) rq = requestAnimationFrame(() => { rq = 0; rerender(); }); };
  $('intensity').addEventListener('input', (ev) => { S.intensity = ev.target.value / 100; $('intensityVal').textContent = ev.target.value + '%'; throttled(); });
  $('gSize').addEventListener('input', (ev) => { S.gScale = ev.target.value / 100; $('gSizeVal').textContent = ev.target.value + '%'; throttled(); });
  const hold = (el) => {
    const on = (e) => { e.preventDefault(); S.holdBefore = true; rerender(); }, off = () => { if (S.holdBefore) { S.holdBefore = false; rerender(); } };
    el.addEventListener('pointerdown', on); ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => el.addEventListener(t, off));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  hold($('btnHold')); hold($('btnHold2'));
  $('cmpAfter').onclick = () => { S.compare = 'after'; $('cmpAfter').classList.add('on'); $('cmpSplit').classList.remove('on'); rerender(); };
  $('cmpSplit').onclick = () => { S.compare = 'split'; $('cmpSplit').classList.add('on'); $('cmpAfter').classList.remove('on'); rerender(); };
  $('btnCapture').onclick = capture;
  $('btnRelive').onclick = goLive;
  $('btnLive').onclick = goLive;
  $('phCamera').onclick = goLive;
  $('btnPhoto').onclick = showPhotoMode;
  $('phSample').onclick = loadSample;
  $('btnFlip').onclick = async () => { S.facing = S.facing === 'user' ? 'environment' : 'user'; cameraOK = false; await goLive(); };
  $('fileInput').onchange = (e) => loadFile(e.target.files[0]);
  $('fileInput2').onchange = (e) => loadFile(e.target.files[0]);
  $('btnSave').onclick = save;
  if (navigator.canShare && navigator.canShare({ files: [new File([''], 'a.png', { type: 'image/png' })] })) { $('btnShare').hidden = false; $('btnShare').onclick = share; }
  document.addEventListener('visibilitychange', () => { if (document.hidden && stream && S.mode === 'live') { /* keep stream; rAF pauses itself */ } });
}

/* ------------------------------------------------------------------ boot */
async function boot() {
  renderTypes(); renderHair(); renderFrames(); renderShapes(); bindUI();
  try { await loadModels(); }
  catch (e) { console.error(e); $('phText').textContent = 'AI 모델을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침 해주세요.'; setStatus('모델 로딩 실패'); return; }
  setStatus(`모델 준비 완료 (${delegate})`);
  const params = new URLSearchParams(location.search);
  if (params.has('sample')) { await loadSample(); return; }
  const canCam = !!navigator.mediaDevices?.getUserMedia;
  if (canCam && !params.has('photo')) { $('phText').textContent = '카메라를 켜는 중… (권한을 허용해 주세요)'; await goLive(); }
  else showPhotoMode();
  window.__pc.ready = true;
}
window.__pc.selectType = selectType;
window.__pc.set = (o) => { Object.assign(S, o); renderTypes(); renderHair(); renderFrames(); renderShapes(); rerender(); };
window.__pc.loadSample = loadSample;
boot().then(() => { window.__pc.ready = true; });
