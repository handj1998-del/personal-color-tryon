// 퍼스널컬러 가상 피팅 — 100% client-side. Photos/video never leave the device.
import { FRAMES, SHAPES, SHAPE_BY_ID, drawGlasses, shapeIconSVG, mix, rgba } from './frames.js';
import { initGlasses3D, drawGlasses3D, preloadGlasses3D, purgeGlasses3D } from './glasses3d.js';
import { faceMetrics, classifyFace, colorMetrics, classifyColor, recommend, SHAPES_KO } from './reco.js';
import { loadGender, predictGender, genderReady } from './gender.js';
import { OVAL_IDX, CANON, fitAffine, invAffine } from './face.js';

const MP_VER = '1.0.1';
// MediaPipe runtime + models are self-hosted under ./vendor so the service worker can cache them (offline use)
const VENDOR = new URL('./vendor/mediapipe/', import.meta.url).href;
const MP_URL = VENDOR + 'vision_bundle.mjs';
const WASM_URL = VENDOR + 'wasm';
const FACE_MODEL = VENDOR + 'face_landmarker.task';
// hair segmentation (masks: [background, hair]). The multiclass selfie model was ~6x slower on CPU, so the
// neck occluder is geometric and the forehead fill uses non-hair pixels inside the face oval.
const SEG_MODEL = VENDOR + 'hair_segmenter.tflite';

/* ------------------------------------------------------------------ data */
// Android / low-memory devices: CPU delegate by default (mobile GPU delegates can crash or lose the WebGL context mid-session),
// smaller caches and a lower display-resolution cap for the glasses pass
// Android detection must not depend on deviceMemory (Galaxy S23 reports 8): UA, UA-CH platform, or the TWA launch
const IS_ANDROID = /Android/i.test(navigator.userAgent) || /android/i.test(navigator.userAgentData?.platform || '') || /^android-app:/.test(document.referrer) || new URLSearchParams(location.search).get('source') === 'twa';
const LOWMEM = IS_ANDROID || (navigator.deviceMemory && navigator.deviceMemory <= 4);
// lite mode (Android / <=4 GB): the recommendation step renders only the selected preview, no combo thumbnails
const QP0 = new URLSearchParams(location.search);
const LITE = (LOWMEM || QP0.has('lite') || QP0.has('ultra')) && !QP0.has('full');
// crash breadcrumbs: the current heavy stage is written before it starts; a page load that finds an unfinished heavy stage
// (renderer crash -> "앗, 이런!" -> reload / relaunch) switches this device to ultra-lite for two weeks (?full resets it)
const HEAVY = ['models', 'camera', 'capture', 'analysis', 'preview', 'live'];
let crashedAt = null;
try {
  const c = JSON.parse(localStorage.getItem('pcCrumb') || 'null');
  if (c && !c.ok && HEAVY.includes(c.s) && Date.now() - c.t < 30 * 60e3) { crashedAt = c.s; localStorage.setItem('pcUltra', String(Date.now())); }
  if (QP0.has('full')) localStorage.removeItem('pcUltra');
} catch (e) {}
const ULTRA = !QP0.has('full') && (QP0.has('ultra') || (() => { try { const u = +localStorage.getItem('pcUltra'); return !!u && Date.now() - u < 14 * 864e5; } catch (e) { return false; } })());
const MARKS = []; const mark = (s) => { if (MARKS.length > 200) MARKS.shift(); MARKS.push([s, Date.now()]); };
function crumb(s, ok) { mark(s + (ok ? ':ok' : '')); try { localStorage.setItem('pcCrumb', JSON.stringify({ s, ok: !!ok, t: Date.now() })); sessionStorage.setItem('pcStage', s + (ok ? ':ok' : '')); } catch (e) {} }
// a normal close / app switch is not a crash
addEventListener('pagehide', () => { try { const c = JSON.parse(localStorage.getItem('pcCrumb') || 'null'); if (c && !c.ok) crumb(c.s, true); } catch (e) {} });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { try { const c = JSON.parse(localStorage.getItem('pcCrumb') || 'null'); if (c && !c.ok) crumb(c.s, true); } catch (e) {} } });
crumb('boot', true);
const freeCanvas = (c) => { if (c && c.getContext) { c.width = c.height = 0; } };
const TYPES = {
  spring: { n: '봄 웜', e: '🌸', bg: 'var(--spring)', worst: 'winter', warm: true,
    subs: [['light', '라이트'], ['bright', '브라이트']],
    hair: [ { n: '밀크브라운', c: '#A27C5E', t: ['light'] }, { n: '허니브라운', c: '#A06D3C', t: ['light', 'bright'] },
            { n: '오렌지브라운', c: '#9E5630', t: ['bright'] }, { n: '골드브라운', c: '#8C6436', t: ['light', 'bright'] },
            { n: '코랄브라운', c: '#9A5B49', t: ['bright'] }, { n: '카라멜브라운', c: '#80553A', t: ['light'] } ],
    frames: ['gold', 'champagne', 'rosegold', 'tortoiselight', 'clearpeach', 'clearhoney', 'camel', 'ivory', 'gradbrown'] },
  summer: { n: '여름 쿨', e: '🌊', bg: 'var(--summer)', worst: 'autumn', warm: false,
    subs: [['light', '라이트'], ['mute', '뮤트']],
    hair: [ { n: '애쉬브라운', c: '#6D6159', t: ['light', 'mute'] }, { n: '애쉬베이지', c: '#8E8274', t: ['light'] },
            { n: '로즈브라운', c: '#7C5352', t: ['light', 'mute'] }, { n: '라벤더브라운', c: '#6C5A6B', t: ['light'] },
            { n: '애쉬그레이', c: '#716F6F', t: ['mute'] }, { n: '소프트블랙', c: '#302C2F', t: ['mute'] } ],
    frames: ['silver', 'rosegold', 'clearpink', 'clearlav', 'crystalgrey', 'grey', 'clear', 'gradrose', 'gradlav'] },
  autumn: { n: '가을 웜', e: '🍂', bg: 'var(--autumn)', worst: 'summer', warm: true,
    subs: [['mute', '뮤트'], ['deep', '딥']],
    hair: [ { n: '초코브라운', c: '#563726', t: ['mute', 'deep'] }, { n: '다크브라운', c: '#4A3427', t: ['deep'] },
            { n: '카퍼브라운', c: '#7C3F22', t: ['deep'] }, { n: '카키브라운', c: '#5F523A', t: ['mute'] },
            { n: '마호가니', c: '#5C2B25', t: ['deep'] }, { n: '올리브브라운', c: '#5B4E37', t: ['mute'] } ],
    frames: ['antiquegold', 'gold', 'tortoise', 'brown', 'khaki', 'camel', 'clearhoney', 'gradbrown', 'gradkhaki'] },
  winter: { n: '겨울 쿨', e: '❄️', bg: 'var(--winter)', worst: 'spring', warm: false,
    subs: [['bright', '브라이트'], ['deep', '딥']],
    hair: [ { n: '블루블랙', c: '#141824', t: ['bright', 'deep'] }, { n: '블랙', c: '#131212', t: ['deep'] },
            { n: '다크애쉬', c: '#35312F', t: ['deep'] }, { n: '버건디', c: '#4E1B29', t: ['bright'] },
            { n: '플럼퍼플', c: '#3D2338', t: ['bright'] }, { n: '쿨다크브라운', c: '#3B2E2C', t: ['deep'] } ],
    frames: ['black', 'matteblack', 'silver', 'gunmetal', 'blackmetal', 'clear', 'crystalgrey', 'wine', 'navy', 'gradblack'] },
};

/* ------------------------------------------------------------------ state */
const S = {
  type: 'spring', sub: 'light', hair: TYPES.spring.hair[0], intensity: 0.75,
  frame: 'gold', shape: 'round', gScale: 1, gender: 'f',
  showWorst: false, compare: 'after', holdBefore: false,
  mode: 'live', facing: 'user',
};
const $ = (id) => document.getElementById(id);
const view = $('view');
const video = $('video');
const stage = $('stage');
const mk = (w = 1, h = 1) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const rawC = mk(), rawX = rawC.getContext('2d', { willReadFrequently: true });
const outC = mk(), outX = outC.getContext('2d');
const recC = mk(), recX = recC.getContext('2d');
const glassC = mk(), glassX = glassC.getContext('2d');
const lensC = mk(), lensX = lensC.getContext('2d');
const tintC = mk(), tintX = tintC.getContext('2d');
const darkC = mk(), darkX = darkC.getContext('2d');
function lensDark() { ensure(darkC, lensC.width, lensC.height); darkX.globalCompositeOperation = 'source-over'; darkX.clearRect(0, 0, darkC.width, darkC.height); darkX.drawImage(lensC, 0, 0); darkX.globalCompositeOperation = 'source-in'; darkX.fillStyle = '#000'; darkX.fillRect(0, 0, darkC.width, darkC.height); return darkC; }
const shadowC = mk(), shadowX = shadowC.getContext('2d');
const maskC = mk(), maskX = maskC.getContext('2d');
const segIn = mk(), segX = segIn.getContext('2d', { willReadFrequently: true });

let MP = null, face = null, seg = null, faceMode = null, segMode = null, delegate = 'GPU';
let stream = null, liveRAF = 0, cameraOK = false, mkFace = null, mkSeg = null, switching = false, tuned = false;
let mirror = false;
let lm = null;        // landmarks (key points + oval) in raw pixel coords
let hairMask = null;  // {id, meanY, meanRGB, bbox, ...} + seg extras (fill, neck)
const stats = { fps: 0, detMs: 0, segMs: 0, renderMs: 0, hairMs: 0, glassMs: 0, segEvery: 2, delegate: '', lastFps: [] };
window.__pc = { S, stats, get lm() { return lm; }, get hairMask() { return hairMask; }, render: () => renderStill() };
window.__pc.marks = MARKS; window.__pc.mark = mark;
window.__pc.flags = { IS_ANDROID, LOWMEM, LITE, ULTRA, get crashedAt() { return crashedAt; }, dpr: devicePixelRatio, deviceMemory: navigator.deviceMemory };
if (new URLSearchParams(location.search).has('proc')) { S.procGlasses = true; }
Object.defineProperty(window.__pc, 'outC', { get: () => outC });
Object.defineProperty(window.__pc, 'viewC', { get: () => view });
Object.defineProperty(window.__pc, 'rawC', { get: () => rawC });

/* ------------------------------------------------------------------ utils */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex2rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgb2hex = (r, g, b) => '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
let toastT = 0;
function toast(msg, ms = 2400) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
function setStatus(s) { $('status').textContent = s; }

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
const KEYS = { iL: 468, iR: 473, B: 168, eL: 234, eR: 454, top: 10, chin: 152 };
let filters = null, ovalPrev = null;
function resetFilters() { filters = null; ovalPrev = null; }
function extractLm(res, W, H, t) {
  const f = res && res.faceLandmarks && res.faceLandmarks[0];
  if (!f || f.length < 474) return null;
  const out = {};
  for (const [k, i] of Object.entries(KEYS)) out[k] = { x: f[i].x * W, y: f[i].y * H };
  let oval = OVAL_IDX.map((i) => ({ x: f[i].x * W, y: f[i].y * H }));
  if (t !== undefined) {
    if (!filters) { filters = {}; for (const k of Object.keys(KEYS)) filters[k] = [new OneEuro(), new OneEuro()]; }
    for (const k of Object.keys(KEYS)) { out[k].x = filters[k][0].f(out[k].x, t); out[k].y = filters[k][1].f(out[k].y, t); }
    if (ovalPrev) oval = oval.map((p, i) => ({ x: ovalPrev[i].x * 0.55 + p.x * 0.45, y: ovalPrev[i].y * 0.55 + p.y * 0.45 }));
    ovalPrev = oval;
  }
  out.oval = oval;
  // brows (protected from the forehead cleanup) and upper-eyelid line (lower limit of the cleanup)
  out.brows = [70, 63, 105, 66, 107, 46, 53, 52, 65, 55, 336, 296, 334, 293, 300, 276, 283, 282, 295, 285].map((i) => ({ x: f[i].x * W, y: f[i].y * H }));
  out.lids = [159, 386, 27, 257].map((i) => ({ x: f[i].x * W, y: f[i].y * H }));
  out.eyes = [33, 133, 159, 145, 160, 144, 158, 153, 362, 263, 386, 374, 385, 380, 387, 373].map((i) => ({ x: f[i].x * W, y: f[i].y * H }));
  out.aff = fitAffine([[...CANON[234], out.eL.x, out.eL.y, 2], [...CANON[454], out.eR.x, out.eR.y, 2], [...CANON[10], out.top.x, out.top.y, 1], [...CANON[152], out.chin.x, out.chin.y, 1]]);
  return out;
}

/* ------------------------------------------------------------------ models */
async function loadModels() {
  crumb('models');
  setStatus('얼굴 인식 모델 불러오는 중…');
  MP = await import(MP_URL);
  const files = await MP.FilesetResolver.forVisionTasks(WASM_URL);
  mkFace = (d) => MP.FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate: d }, runningMode: 'VIDEO', numFaces: 1,
    minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
  mkSeg = (d) => MP.ImageSegmenter.createFromOptions(files, {
    baseOptions: { modelAssetPath: SEG_MODEL, delegate: d }, runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false });
  const qp = new URLSearchParams(location.search), forceCPU = qp.has('cpu') || (IS_ANDROID && !qp.has('gpu'));
  try { if (forceCPU) throw 0; face = await mkFace('GPU'); seg = await mkSeg('GPU'); delegate = 'GPU'; }
  catch (e) { console.warn('GPU delegate failed, using CPU', e); face = face || await mkFace('CPU'); seg = await mkSeg('CPU'); delegate = 'CPU'; }
  faceMode = segMode = 'VIDEO'; stats.delegate = delegate;
  crumb('models', true);
}
async function ensureMode(m) {
  if (faceMode !== m) { await face.setOptions({ runningMode: m }); faceMode = m; }
  if (segMode !== m) { await seg.setOptions({ runningMode: m }); segMode = m; }
  if (m === 'VIDEO') resetFilters();
}
async function switchToCPU() {
  switching = true;
  try {
    const f2 = await mkFace('CPU'), s2 = await mkSeg('CPU');
    try { face.close(); seg.close(); } catch (e) {}
    face = f2; seg = s2; faceMode = segMode = 'VIDEO'; delegate = 'CPU'; stats.delegate = 'CPU(auto)'; resetFilters();
    if (S.mode !== 'live') await ensureMode('IMAGE');
  } catch (e) { console.warn('CPU switch failed', e); }
  switching = false;
}

/* ------------------------------------------------------------------ segmentation post-processing */
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
function buildSeg(masks, w, h, prev, lmP) {
  const hairRaw = masks[masks.length - 1];
  let m = hairRaw;
  if (prev && prev.w === w && prev.h === h) { const s = new Float32Array(m.length); for (let i = 0; i < m.length; i++) s[i] = prev.raw[i] * 0.45 + m[i] * 0.55; m = s; }
  else m = new Float32Array(m);
  const raw = m;
  const sm = boxBlur(m, w, h, Math.max(1, Math.round(Math.max(w, h) / 220)));
  const px = segX.getImageData(0, 0, w, h).data;
  let sumY = 0, sr = 0, sg = 0, sb = 0, n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, v = sm[i];
    if (v > 0.25) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (v > 0.6) { const j = i * 4; sumY += 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]; sr += px[j]; sg += px[j + 1]; sb += px[j + 2]; n++; }
  }
  const out = { raw, w, h, cover: n / (w * h), empty: true };
  if (x1 >= 0 && out.cover >= 0.002) {
    const id = new ImageData(w, h);
    for (let i = 0; i < sm.length; i++) { let a = clamp((sm[i] - 0.18) / 0.62, 0, 1); a = a * a * (3 - 2 * a); id.data[i * 4 + 3] = a * 255; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; }
    Object.assign(out, { id, meanY: Math.max(18, sumY / n), meanRGB: [sr / n, sg / n, sb / n], bbox: [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h], empty: false });
  }
  return out;
}
// reference skin colour at face coords (cx, cy) from the per-band / per-zone table: linear between bands, smooth centre -> side blend
function rowRef(rows, cx, cy) {
  const f = clamp((cy + 1.6) / 0.02 - 0.5, 0, 49), k0 = Math.floor(f), k1 = Math.min(49, k0 + 1), u = f - k0;
  const at = (z) => { const a = rows[z][k0], b = rows[z][k1]; return a && b ? [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u] : a || b; };
  const c = at(1), sd = at(cx < 0 ? 0 : 2); if (!c || !sd) return c || sd;
  let t = clamp((Math.abs(cx) - 0.1) / 0.45, 0, 1); t = t * t * (3 - 2 * t);
  return [c[0] + (sd[0] - c[0]) * t, c[1] + (sd[1] - c[1]) * t, c[2] + (sd[2] - c[2]) * t];
}
let segScaleX = 1, segScaleY = 1;
function segInputFrom(src, sw, sh, maxSide) {
  const s = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(16, Math.round(sw * s)), h = Math.max(16, Math.round(sh * s));
  if (segIn.width !== w || segIn.height !== h) { segIn.width = w; segIn.height = h; }
  segX.drawImage(src, 0, 0, w, h); segScaleX = sw / w; segScaleY = sh / h;
  return segIn;
}
function takeMasks(result) {
  const ms = result && result.confidenceMasks; if (!ms || !ms.length) return null;
  return { masks: ms.map((m) => m.getAsFloat32Array()), w: ms[0].width, h: ms[0].height };
}

/* ------------------------------------------------------------------ hair recolor */
let lutCache = {};
function hairLUT(hex, meanY) {
  const key = hex + '|' + Math.round(meanY);
  if (lutCache[key]) return lutCache[key];
  const [tr, tg, tb] = hex2rgb(hex); const lut = new Uint8ClampedArray(256 * 3);
  for (let y = 0; y < 256; y++) {
    const r = (y + 1) / (meanY + 1);
    const k = r < 1 ? Math.pow(r, 0.85) : 1 + (Math.pow(r, 0.75) - 1) * 0.9;
    const hl = Math.max(0, k - 1) * 40;
    lut[y * 3] = tr * k + hl; lut[y * 3 + 1] = tg * k + hl; lut[y * 3 + 2] = tb * k + hl;
  }
  if (Object.keys(lutCache).length > 40) lutCache = {};
  return (lutCache[key] = lut);
}
function applyHair(ctx, W, H, mask, hex, intensity) {
  if (!mask || mask.empty || !hex || intensity <= 0) return;
  const [bx0, by0, bx1, by1] = mask.bbox, pad = 0.02;
  const x = Math.max(0, Math.floor((bx0 - pad) * W)), y = Math.max(0, Math.floor((by0 - pad) * H));
  const w = Math.min(W, Math.ceil((bx1 + pad) * W)) - x, h = Math.min(H, Math.ceil((by1 + pad) * H)) - y;
  if (w <= 0 || h <= 0) return;
  if (recC.width !== W || recC.height !== H) { recC.width = W; recC.height = H; }
  const img = rawX.getImageData(x, y, w, h), d = img.data, lut = hairLUT(hex, mask.meanY);
  for (let i = 0; i < d.length; i += 4) {
    const Y = (77 * d[i] + 150 * d[i + 1] + 29 * d[i + 2]) >> 8, j = Y * 3;
    d[i] = lut[j] * 0.92 + d[i] * 0.08; d[i + 1] = lut[j + 1] * 0.92 + d[i + 1] * 0.08; d[i + 2] = lut[j + 2] * 0.92 + d[i + 2] * 0.08;
  }
  recX.globalCompositeOperation = 'source-over'; recX.clearRect(0, 0, W, H); recX.putImageData(img, x, y);
  if (maskC.width !== mask.w || maskC.height !== mask.h) { maskC.width = mask.w; maskC.height = mask.h; }
  maskX.putImageData(mask.id, 0, 0);
  recX.globalCompositeOperation = 'destination-in'; recX.imageSmoothingEnabled = true; recX.imageSmoothingQuality = 'high';
  recX.drawImage(maskC, 0, 0, W, H); recX.globalCompositeOperation = 'source-over';
  ctx.save(); ctx.globalAlpha = intensity; ctx.drawImage(recC, 0, 0); ctx.restore();
}

/* ------------------------------------------------------------------ compositing */
function ensure(c, W, H) { if (c.width !== W || c.height !== H) { c.width = W; c.height = H; } }
function compose(W, H, P, mask) {
  ensure(outC, W, H); ensure(glassC, W, H); ensure(lensC, W, H); ensure(tintC, W, H); glassX.setTransform(1,0,0,1,0,0); glassX.clearRect(0,0,W,H); lensX.setTransform(1,0,0,1,0,0); lensX.clearRect(0,0,W,H); tintX.setTransform(1,0,0,1,0,0); tintX.clearRect(0,0,W,H);
  const t0 = performance.now();
  outX.drawImage(rawC, 0, 0);
  if (S.hair) applyHair(outX, W, H, mask, S.hair.c, S.intensity, P);
  const t1 = performance.now(); stats.hairMs = stats.hairMs * 0.9 + (t1 - t0) * 0.1;
  hiScale = calcHiScale(W, H);
  if (hiScale === 1) glassesPass(outX, W, H, P);
  stats.glassMs = stats.glassMs * 0.9 + (performance.now() - t1) * 0.1;
}
function glassesPass(outX, W, H, P) {
  ensure(glassC, W, H); ensure(lensC, W, H); ensure(tintC, W, H); glassX.setTransform(1,0,0,1,0,0); glassX.clearRect(0,0,W,H); lensX.setTransform(1,0,0,1,0,0); lensX.clearRect(0,0,W,H); tintX.setTransform(1,0,0,1,0,0); tintX.clearRect(0,0,W,H);
  if (P && S.shape !== 'none') {
    const hideT = false;
    const photo = !S.procGlasses && drawGlasses3D(glassX, lensX, P, S.frame, S.shape, S.gScale, TYPES[S.type].warm, hideT, tintX);
    stats.glass3d = !!photo;
    if (!photo) drawGlasses(glassX, P, S.frame, S.shape, S.gScale, TYPES[S.type].warm, hideT);
    const d = Math.hypot(P.iR.x - P.iL.x, P.iR.y - P.iL.y);
    const sw = Math.max(8, Math.round(W / 6)), sh = Math.max(8, Math.round(H / 6));
    ensure(shadowC, sw, sh);
    shadowX.globalCompositeOperation = 'source-over'; shadowX.clearRect(0, 0, sw, sh); shadowX.drawImage(glassC, 0, 0, sw, sh);
    shadowX.globalCompositeOperation = 'source-in'; shadowX.fillStyle = 'rgb(25,12,12)'; shadowX.fillRect(0, 0, sw, sh);
    outX.save(); outX.imageSmoothingEnabled = true;
    // two-tier contact shadow: tight occlusion right under the rims + wide soft shadow falling on cheeks/nose (light from above)
    outX.globalAlpha = 0.12; outX.drawImage(shadowC, 0, d * 0.02, W, H); outX.restore();
    if (photo) {
      // lens: slight darkening of what is behind, then reflections (screen)
      outX.save(); outX.globalCompositeOperation = 'source-over'; outX.globalAlpha = 0.07;
      outX.drawImage(lensDark(), 0, 0); outX.globalAlpha = 0.38; outX.globalCompositeOperation = 'screen'; outX.drawImage(lensC, 0, 0); outX.restore();
      if (photo === 'tint') { outX.save(); outX.globalCompositeOperation = 'multiply'; outX.drawImage(tintC, 0, 0); outX.restore(); }
    }
    outX.drawImage(glassC, 0, 0);
  }
}
// glasses are drawn at display resolution (canvas px = CSS px x devicePixelRatio) on top of the upscaled photo/video frame,
// so rims, hinges and reflections stay crisp instead of being upscaled with a low-res live frame
let hiScale = 1;
const paneC = mk(), paneX = paneC.getContext('2d');
function calcHiScale(W, H) {
  if (S.noHiGlasses || LITE || !stage.clientWidth) return 1;
  const tw = S.compare === 'split' ? W * 2 : W, fit = Math.min(stage.clientWidth / tw, stage.clientHeight / H) * (window.devicePixelRatio || 1);
  let s = Math.min(LOWMEM ? 1.5 : 2.5, Math.max(1, fit), (LOWMEM ? 1800 : 2600) / Math.max(tw, H));
  s = Math.round(s * 4) / 4; return s < 1.2 ? 1 : s;
}
function scaleP(o, s) {
  if (Array.isArray(o)) return o.map((v) => scaleP(v, s));
  if (o && typeof o === 'object') {
    if ('a' in o && 'd' in o && 'e' in o && 'f' in o && 'b' in o && 'c' in o) return { a: o.a * s, b: o.b * s, c: o.c * s, d: o.d * s, e: o.e * s, f: o.f * s };
    const r = {}; for (const k in o) { const v = o[k]; r[k] = (k === 'x' || k === 'y' || k === 'z') && typeof v === 'number' ? v * s : scaleP(v, s); } return r;
  }
  return o;
}
function present(target = view, labels = true) {
  const sc = hiScale, W0 = rawC.width, H0 = rawC.height, W = Math.round(W0 * sc), H = Math.round(H0 * sc), split = S.compare === 'split', tw = split ? W * 2 : W;
  if (target.width !== tw || target.height !== H) { target.width = tw; target.height = H; }
  if (target === view) stage.classList.toggle('tall-src', H > W * 1.05); // phone stage: portrait photos are shown whole (contain)
  const x = target.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  let after = outC;
  if (sc === 1 && paneC.width > 1) { paneC.width = paneC.height = 1; }
  if (sc !== 1 && !S.holdBefore) { // hi-res pass: upscale the composed frame, then draw the glasses at full resolution
    ensure(paneC, W, H); paneX.imageSmoothingEnabled = true; paneX.imageSmoothingQuality = 'high'; paneX.drawImage(outC, 0, 0, W, H);
    if (lm) glassesPass(paneX, W, H, scaleP(lm, sc)); after = paneC;
  }
  const panes = split ? [[rawC, 0, '원본 BEFORE'], [after, W, 'AFTER']] : [[S.holdBefore ? rawC : after, 0, S.holdBefore ? '원본' : '']];
  for (const [src, ox, label] of panes) {
    x.save(); if (mirror) { x.translate(ox + W, 0); x.scale(-1, 1); x.drawImage(src, 0, 0, W, H); } else x.drawImage(src, ox, 0, W, H); x.restore();
    if (labels && label) {
      const fs = Math.max(14, Math.round(H / 26)); x.font = `700 ${fs}px sans-serif`;
      const tw2 = x.measureText(label).width + fs; x.fillStyle = 'rgba(255,255,255,0.85)';
      x.beginPath(); x.roundRect(ox + fs * 0.6, H - fs * 2.2, tw2, fs * 1.6, fs * 0.8); x.fill();
      x.fillStyle = '#3d3346'; x.fillText(label, ox + fs * 1.1, H - fs * 1.4 + fs * 0.35);
    }
  }
  if (split) { x.fillStyle = '#fff'; x.fillRect(W - 2, 0, 4, H); }
}


/* ------------------------------------------------------------------ camera frame grabber (lite) */
// Every drawImage(video) leaves a decoded copy of that frame in Chrome's image-decode cache (measured: ~340 MB per tab on an
// 8 GB device profile within seconds). VideoFrame.copyTo + putImageData bypasses that cache, so on lite devices all camera
// pixels come from this one reused canvas. Falls back to drawImage(video) if the API is missing or the frame is rotated.
const vidC = mk(), vidX = vidC.getContext('2d', { willReadFrequently: true });
const vg = { on: false, seq: 0, busy: false, img: null, cb: 0, ok: LITE && typeof VideoFrame === 'function' && !!VideoFrame.prototype.copyTo && !QP0.has('nograb') };
function grabStart() {
  if (!vg.ok || vg.on || !video.requestVideoFrameCallback) return; vg.on = true; vg.seq = 0;
  const step = async () => {
    if (!vg.on) return;
    if (!vg.busy && video.readyState >= 2 && video.videoWidth) {
      vg.busy = true; let f = null;
      try {
        f = new VideoFrame(video); const r = f.visibleRect, w = r.width, h = r.height;
        if ((f.rotation || 0) !== 0 || f.flip || (video.videoWidth !== video.videoHeight && (w > h) !== (video.videoWidth > video.videoHeight))) throw new Error('rotated frame');
        if (!vg.img || vg.img.width !== w || vg.img.height !== h) { vg.img = new ImageData(w, h); vidC.width = w; vidC.height = h; }
        await f.copyTo(vg.img.data, { format: 'RGBA', rect: { x: r.x, y: r.y, width: w, height: h }, layout: [{ offset: 0, stride: w * 4 }] });
        if (vg.on) { vidX.putImageData(vg.img, 0, 0); vg.seq++; }
      } catch (e) { console.warn('frame grabber off, using drawImage(video)', e); vg.ok = false; vg.on = false; vg.seq = 0; }
      finally { if (f) { try { f.close(); } catch (e) {} } vg.busy = false; }
    }
    if (vg.on) vg.cb = video.requestVideoFrameCallback(step);
  };
  vg.cb = video.requestVideoFrameCallback(step);
}
function grabStop() { vg.on = false; if (vg.cb && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(vg.cb); vg.cb = 0; vg.seq = 0; vg.img = null; vidC.width = vidC.height = 1; }
// current camera image source + its size; null while the grabber has no frame yet (avoids drawing the <video> at all)
function camSrc() {
  if (vg.on) return vg.seq > 0 ? [vidC, vidC.width, vidC.height] : null;
  return video.videoWidth ? [video, video.videoWidth, video.videoHeight] : null;
}
window.__pc.grab = vg;

/* ------------------------------------------------------------------ live mode */
const LIVE_CAP = +(new URLSearchParams(location.search).get('res') || (ULTRA ? 480 : LITE ? 640 : 800));
let frameNo = 0, fpsT0 = 0, fpsN = 0, liveErr = 0;
function liveSize() { const vw = video.videoWidth, vh = video.videoHeight, s = Math.min(1, LIVE_CAP / Math.max(vw, vh)); return [Math.round(vw * s), Math.round(vh * s)]; }
function liveLoop() {
  liveRAF = requestAnimationFrame(liveLoop);
  if (S.mode !== 'live' || switching || video.readyState < 2 || !video.videoWidth) return;
  const t0 = performance.now(), [W, H] = liveSize();
  if (rawC.width !== W || rawC.height !== H) { rawC.width = W; rawC.height = H; hairMask = null; }
  const cs = camSrc(); if (!cs) return;
  rawX.drawImage(cs[0], 0, 0, W, H);
  try { const r = face.detectForVideo(LITE ? rawC : video, vts()); const p = extractLm(r, W, H, t0); if (!p) resetFilters(); lm = p; liveErr = 0; } catch (e) { console.warn(e); if (++liveErr >= 3 && delegate === 'GPU' && !switching) switchToCPU(); }
  const t1 = performance.now(); stats.detMs = stats.detMs * 0.9 + (t1 - t0) * 0.1;
  frameNo++;
  const needSeg = !!S.hair;
  if (needSeg && frameNo % stats.segEvery === 0) {
    segInputFrom(rawC, W, H, 256);
    try { seg.segmentForVideo(segIn, vts(), (res) => { const ti = performance.now(); stats.inferMs = ti - t1; const m = takeMasks(res); stats.takeMs = performance.now() - ti; if (m) hairMask = buildSeg(m.masks, m.w, m.h, hairMask, lm); stats.postMs = performance.now() - ti; }); } catch (e) { console.warn(e); if (++liveErr >= 3 && delegate === 'GPU' && !switching) switchToCPU(); }
    stats.segMs = stats.segMs * 0.8 + (performance.now() - t1) * 0.2;
  }
  const t2 = performance.now();
  compose(W, H, lm, hairMask); present();
  const t3 = performance.now(); stats.renderMs = stats.renderMs * 0.9 + (t3 - t2) * 0.1;
  fpsN++; if (!fpsT0) fpsT0 = t3;
  if (t3 - fpsT0 >= 1000) {
    stats.fps = fpsN * 1000 / (t3 - fpsT0); fpsN = 0; fpsT0 = t3; stats.lastFps.push(+stats.fps.toFixed(1)); if (stats.lastFps.length > 30) stats.lastFps.shift();
    if (stats.fps < 18 && stats.segEvery < 4) stats.segEvery++; else if (stats.fps > 28 && stats.segEvery > 2) stats.segEvery--;
    $('fps').textContent = `${stats.fps.toFixed(0)} fps · ${delegate}`;
    if (!tuned && delegate === 'GPU' && frameNo > 20) { tuned = true; if (stats.detMs > 55) switchToCPU(); }
  }
  setStatus(lm ? '✓ 얼굴 인식 중' : '얼굴을 화면 가운데에 맞춰주세요');
}
// camera requests are serialised (double taps / overlapping goLive calls used to open two streams and lose one, which kept the
// camera on) and generation-checked (a stream that arrives after the camera was released - home button, tab hidden - is stopped)
let camGen = 0, camP = null;
function startCamera() { if (camP) return camP; camP = startCamera0().finally(() => { camP = null; }); return camP; }
function releaseCamera() { camGen++; grabStop(); if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; cameraOK = false; video.srcObject = null; }
function camHealthy() { const t = stream && stream.getVideoTracks()[0]; return !!(cameraOK && t && t.readyState === 'live'); }
function camErrKo(e) {
  const n = e && e.name;
  if (n === 'StaleCamera') return '';
  if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return '카메라 권한이 꺼져 있어요 · 브라우저 설정에서 카메라를 허용해 주세요';
  if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError') return '카메라를 찾을 수 없어요 · 사진 올리기로 진행해 주세요';
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return '다른 앱이 카메라를 쓰고 있어요 · 그 앱을 닫고 다시 시도해 주세요';
  if (n === 'NotSupportedError') return '이 브라우저에서는 카메라를 쓸 수 없어요 · 사진 올리기로 진행해 주세요';
  return (e && e.message && /[가-힣]/.test(e.message)) ? e.message : '카메라를 쓸 수 없어요 · 사진 올리기로 진행해 주세요';
}
async function startCamera0() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error(window.isSecureContext ? '이 브라우저는 카메라를 지원하지 않아요' : 'HTTPS 주소에서만 카메라를 쓸 수 있어요');
  grabStop(); if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; cameraOK = false;
  crumb('camera'); const my = ++camGen;
  const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: LITE ? { facingMode: S.facing, width: { ideal: 640, max: 960 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 24, max: 30 } } : { facingMode: S.facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
  if (my !== camGen) { s.getTracks().forEach((t) => t.stop()); const e = new Error('stale camera request'); e.name = 'StaleCamera'; throw e; }
  stream = s; const tr = s.getVideoTracks()[0];
  if (tr) tr.addEventListener('ended', () => { if (stream === s) { cameraOK = false; if (!document.hidden && S.mode === 'live') toast('카메라 연결이 끊겼어요 · 📷 라이브를 눌러 다시 켜 주세요'); } }, { once: true });
  video.srcObject = stream; await video.play(); if (my !== camGen) { const e = new Error('stale camera request'); e.name = 'StaleCamera'; throw e; } grabStart();
  const st = stream.getVideoTracks()[0].getSettings(); mirror = (st.facingMode || S.facing) !== 'environment'; cameraOK = true;
}
async function goLive() {
  if (!face) return;
  await stillIdle();
  try {
    if (!cameraOK) await startCamera();
    await ensureMode('VIDEO');
    crumb('live'); S.mode = 'live'; hairMask = null; lastStillMasks = null; lm = null; resetFilters(); // still-only data (masks) not needed live
    stage.classList.remove('is-still', 'no-live'); $('placeholder').classList.add('hide');
    $('btnLive').classList.add('on'); $('btnPhoto').classList.remove('on');
    if (!liveRAF) liveLoop();
  } catch (e) { console.warn(e); if (e && e.name === 'StaleCamera') return; cameraOK = false; toast(camErrKo(e), 4200); showPhotoMode(); }
}
function stopLoop() { if (liveRAF) cancelAnimationFrame(liveRAF); liveRAF = 0; }

/* ------------------------------------------------------------------ still (photo / captured) */
let lastStillMasks = null;
// strictly increasing timestamps shared by the live loop and lite still analysis (VIDEO-mode graphs)
let vtsLast = 0; const vts = () => (vtsLast = Math.max(vtsLast + 1, performance.now()));
async function analyzeStill(stepped) {
  // lite: stay in VIDEO mode (no graph rebuild = no transient double allocation); the tracker is re-seeded by repeated calls
  if (!LITE) await ensureMode('IMAGE'); else await ensureMode('VIDEO'); // same model instances either way
  const W = rawC.width, H = rawC.height;
  let r;
  if (LITE) { resetFilters(); for (let i = 0; i < 3; i++) { r = face.detectForVideo(rawC, vts()); if (i >= 1 && r.faceLandmarks && r.faceLandmarks.length) break; } }
  else r = face.detect(rawC);
  mark('face-done');
  lm = extractLm(r, W, H);
  window.__pc.rawLm = r.faceLandmarks && r.faceLandmarks[0] ? r.faceLandmarks[0].map((q) => [q.x * W, q.y * H]) : null;
  hairMask = null; lastStillMasks = null;
  if (stepped) { rcProgress('헤어 영역을 분석하는 중…'); await yieldUI(); }
  let m = null;
  try {
    segInputFrom(rawC, W, H, 640);
    if (LITE) seg.segmentForVideo(segIn, vts(), (res) => { m = takeMasks(res); });
    else { const res = seg.segment(segIn); m = takeMasks(res); if (res && res.close) res.close(); }
    lastStillMasks = m;
    mark('seg-done'); if (m) hairMask = buildSeg(m.masks, m.w, m.h, null, lm); mark('buildseg-done');
  } catch (e) { console.warn('hair segmentation failed, continuing without hair mask', e); hairMask = null; }
  window.__pc.lastAnalysis = { face: !!lm, hairCover: hairMask ? hairMask.cover : 0, W, H, maskW: m && m.w, maskH: m && m.h };
}
function renderStill() { if (S.mode !== 'still') return; compose(rawC.width, rawC.height, lm, hairMask); present(); }
// one still analysis at a time; 다시 라이브 / 다음 고객 / another photo wait for a running one (bounded) instead of switching the
// models' running mode or clearing the canvases underneath it
let stillP = null;
const stillIdle = () => stillP ? Promise.race([stillP.catch(() => {}), sleep(8000)]) : Promise.resolve();
async function loadStillFrom(...args) {
  await stillIdle(); const p = loadStillFrom0(...args); stillP = p;
  try { return await p; } finally { if (stillP === p) stillP = null; }
}
async function loadStillFrom0(src, sw, sh, mirrorIt, opt = {}) {
  stopLoop(); S.mode = 'still'; mirror = mirrorIt;
  const s = Math.min(1, (opt.cap || (LOWMEM ? 1200 : 1600)) / Math.max(sw, sh));
  rawC.width = Math.round(sw * s); rawC.height = Math.round(sh * s);
  rawX.drawImage(src, 0, 0, rawC.width, rawC.height);
  stage.classList.add('is-still'); $('placeholder').classList.add('hide');
  crumb('analysis');
  if (!opt.quiet) { compose(rawC.width, rawC.height, null, null); present(); }
  setStatus('분석 중…'); $('fps').textContent = '';
  try { await analyzeStill(opt.quiet); } catch (e) { console.error(e); lm = null; if (!opt.quiet) toast('분석 중 오류가 났어요'); }
  setStatus(lm ? '✓ 얼굴 인식 완료' : '얼굴을 찾지 못했어요 (헤어 컬러만 적용)');
  if (opt.quiet) return;
  if (!lm) toast('얼굴을 찾지 못했어요. 정면 사진이 가장 잘 돼요.');
  renderStill(); crumb('still', true);
}
async function capture() { const cs = camSrc(); if (S.mode !== 'live' || !cs) return; await loadStillFrom(cs[0], cs[1], cs[2], mirror); toast('촬영했어요! 저장하거나 헤어 컬러·안경을 계속 바꿔보세요.'); }
// big camera photos (12-50 MP) would decode to 50-200 MB; decode straight to <= ~1600 px wide instead
async function decodePhoto(file) {
  if (file.size > 1.2e6) { try { return await createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: LITE ? 1280 : 1600, resizeQuality: 'high' }); } catch (e) { /* older engines: full decode */ } }
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}
async function loadFile(file) {
  if (!file) return;
  try { const bmp = await decodePhoto(file); await loadStillFrom(bmp, bmp.width, bmp.height, false); try { bmp.close && bmp.close(); } catch (e) {} $('btnPhoto').classList.add('on'); $('btnLive').classList.remove('on'); }
  catch (e) { console.error(e); toast('사진을 열 수 없어요'); }
}
async function loadSample() {
  const img = new Image(); img.src = 'assets/sample.jpg'; await img.decode();
  await loadStillFrom(img, img.naturalWidth, img.naturalHeight, false); $('btnPhoto').classList.add('on'); $('btnLive').classList.remove('on');
}
function showPhotoMode() {
  stopLoop(); S.mode = 'still'; $('btnPhoto').classList.add('on'); $('btnLive').classList.remove('on');
  if (rawC.width < 2 || (!lm && !hairMask)) { $('placeholder').classList.remove('hide'); $('phText').textContent = '사진을 올리거나 샘플 사진으로 시작해 보세요'; stage.classList.add('no-live'); }
}

/* ------------------------------------------------------------------ save / share */
function buildExport() {
  const c = mk(); present(c, true); try { return buildExport0(c); } finally { freeCanvas(c); }
}
function buildExport0(c) {
  const W = c.width, H = c.height, fs = Math.max(16, Math.round(W / 42)), bar = Math.round(fs * 2.6);
  const ex = mk(W, H + bar), x = ex.getContext('2d');
  x.drawImage(c, 0, 0); x.fillStyle = '#fdf6f9'; x.fillRect(0, H, W, bar); x.fillStyle = '#3d3346'; x.font = `700 ${fs}px sans-serif`;
  const T = TYPES[S.type], sub = T.subs.find((s) => s[0] === S.sub)?.[1] || '';
  const parts = [`${T.e} ${T.n} ${sub}`, S.hair ? `헤어 ${S.hair.n}` : null,
    S.shape !== 'none' ? `안경 ${FRAMES[S.frame].n} ${SHAPES.find((s) => s.id === S.shape).n}` : null].filter(Boolean);
  x.fillText(parts.join(' · '), fs, H + bar / 2 + fs * 0.35, W - fs * 7);
  x.font = `500 ${Math.round(fs * 0.7)}px sans-serif`; x.fillStyle = '#8a7f93';
  const dt = new Date().toLocaleDateString('ko-KR'), dw = x.measureText(dt).width; x.fillText(dt, W - dw - fs, H + bar / 2 + fs * 0.3);
  return ex;
}
function exportBlob() { return new Promise((res) => { const ex = buildExport(); ex.toBlob((b) => { freeCanvas(ex); res(b); }, 'image/png'); }); }
let exporting = false; // double taps on 저장/공유 used to build two full-size exports at once (and download twice)
async function save() {
  if (exporting) return; exporting = true; try { await save0(); } catch (e) { console.warn(e); toast('저장하지 못했어요 · 다시 눌러 주세요'); } finally { exporting = false; }
}
async function save0() {
  const blob = await exportBlob(), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `personal-color_${S.type}_${Date.now()}.png`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000); toast('이미지를 저장했어요');
}
async function share() { if (exporting) return; exporting = true; try { await share0(); } finally { exporting = false; } }
async function share0() {
  const blob = await exportBlob(), file = new File([blob], 'personal-color.png', { type: 'image/png' });
  try { await navigator.share({ files: [file], title: '퍼스널컬러 가상 피팅' }); } catch (e) { if (e.name !== 'AbortError') toast('공유할 수 없어요'); }
}

/* ------------------------------------------------------------------ result sheet (share) */
// One H.O.W-branded portrait sheet (ivory / charcoal): type, face shape, before/after, the final look, the top-3 and a note.
// Rendered once on demand into a single canvas, encoded, then released (S23 lite: ~1080x1820 = 8 MB for a moment).
const SH = { W: 1080, ink: '#2b2a28', mute: '#8f8a83', ivory: '#faf8f4', card: '#ffffff', line: '#e7e1d8' };
function shCrop(src, srcLm, k, mirrorIt, dst, dx, dy, dw, dh) { // face-centred crop of src (lm in src/k pixels) into dst rect
  const x = dst.getContext('2d'); x.save(); x.beginPath(); x.roundRect(dx, dy, dw, dh, 22); x.clip(); x.fillStyle = '#eee9e2'; x.fillRect(dx, dy, dw, dh);
  let cx = src.width / 2, cy = src.height / 2, hh = src.height;
  if (srcLm) { const fh = Math.hypot(srcLm.chin.x - srcLm.top.x, srcLm.chin.y - srcLm.top.y) * k; cx = (srcLm.top.x + srcLm.chin.x) / 2 * k; cy = ((srcLm.top.y + srcLm.chin.y) / 2) * k - fh * 0.1; hh = Math.min(fh * 2.2, src.height); }
  let ww = hh * dw / dh; if (ww > src.width) { ww = src.width; hh = ww * dh / dw; }
  cx = clamp(cx, ww / 2, src.width - ww / 2); cy = clamp(cy, hh / 2, src.height - hh / 2);
  if (mirrorIt) { x.translate(dx + dw, dy); x.scale(-1, 1); x.drawImage(src, cx - ww / 2, cy - hh / 2, ww, hh, 0, 0, dw, dh); }
  else x.drawImage(src, cx - ww / 2, cy - hh / 2, ww, hh, dx, dy, dw, dh);
  x.restore();
}
function shText(x, t, X, Y, font, color, maxW) { x.font = font; x.fillStyle = color; x.fillText(t, X, Y, maxW); }
function shSwatch(x, X, Y, r, c, c2) { x.save(); x.beginPath(); x.arc(X, Y, r, 0, Math.PI * 2); if (c2) { const g = x.createLinearGradient(X, Y - r, X, Y + r); g.addColorStop(0, c); g.addColorStop(1, c2); x.fillStyle = g; } else x.fillStyle = c; x.fill(); x.lineWidth = 2; x.strokeStyle = '#0000001a'; x.stroke(); x.restore(); }
const lookTexts = (hair, shape, frame) => {
  const sh = SHAPES.find((q) => q.id === shape), fr = FRAMES[frame];
  return { color: hair ? hair.n : '원래 컬러', colorC: hair && hair.c, glasses: shape && shape !== 'none' && sh && fr ? `${sh.n} · ${fr.n}` : '안경 없음', frameC: fr && (fr.c2 ? null : fr.c), frame: fr };
};
async function buildSheet() {
  try { await document.fonts.load('300 120px "HOW Serif"'); } catch (e) {}
  const T = TYPES[S.type], sub = T.subs.find((q) => q[0] === S.sub)?.[1] || '', an = rc.an, top = rc.combos && rc.combos.length && an ? rc.combos : null;
  const W = SH.W, pad = 64, H = top ? 1950 : 1580, c = mk(W, H), x = c.getContext('2d');
  x.fillStyle = SH.ivory; x.fillRect(0, 0, W, H);
  // header
  x.textBaseline = 'alphabetic'; x.textAlign = 'center';
  shText(x, 'H.O.W', W / 2, 150, '300 112px "HOW Serif", Georgia, serif', SH.ink);
  x.fillStyle = SH.ink; x.globalAlpha = 0.35; x.fillRect(W / 2 - 26, 184, 52, 2); x.globalAlpha = 1;
  shText(x, '퍼스널컬러 가상 피팅 결과', W / 2, 238, '500 30px "Pretendard", "Noto Sans KR", sans-serif', '#55514b');
  const d = new Date(), ds = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  shText(x, ds, W / 2, 282, '400 24px "Pretendard", "Noto Sans KR", sans-serif', SH.mute);
  // before / after (after = the composed look with full-res glasses)
  const iy = 320, iw = (W - pad * 2 - 24) / 2, ih = Math.round(iw * 1.25);
  const aft = mk(); const was = { compare: S.compare, holdBefore: S.holdBefore }; S.compare = 'after'; S.holdBefore = false;
  try { present(aft, false); } finally { Object.assign(S, was); }
  const k = rawC.width ? aft.width / rawC.width : 1;
  shCrop(rawC, lm, 1, mirror, c, pad, iy, iw, ih); shCrop(aft, lm, k, mirror, c, pad + iw + 24, iy, iw, ih); freeCanvas(aft);
  x.textAlign = 'left';
  for (const [t, X] of [['BEFORE', pad], ['AFTER', pad + iw + 24]]) { x.fillStyle = '#ffffffe0'; x.beginPath(); x.roundRect(X + 18, iy + ih - 62, t === 'BEFORE' ? 128 : 112, 42, 21); x.fill(); shText(x, t, X + 36, iy + ih - 32, '600 22px "Pretendard", sans-serif', SH.ink); }
  // diagnosis row
  let y = iy + ih + 48; x.textAlign = 'left';
  const chip = (X, w, lab, val) => { x.fillStyle = SH.card; x.strokeStyle = SH.line; x.lineWidth = 2; x.beginPath(); x.roundRect(X, y, w, 116, 20); x.fill(); x.stroke();
    shText(x, lab, X + 28, y + 42, '500 22px "Pretendard", sans-serif', SH.mute); shText(x, val, X + 28, y + 90, '700 36px "Pretendard", sans-serif', SH.ink, w - 56); };
  const cw = (W - pad * 2 - 24) / 2;
  chip(pad, cw, '퍼스널컬러', `${T.n} ${sub}`.trim()); chip(pad + cw + 24, cw, '얼굴형', an && an.fc ? SHAPES_KO[an.fc.shape] : '—');
  y += 116 + 40;
  // final look
  const L = lookTexts(S.hair, S.shape, S.frame);
  shText(x, '최종 선택', pad, y + 30, '700 30px "Pretendard", sans-serif', SH.ink); y += 52;
  x.fillStyle = SH.card; x.strokeStyle = SH.line; x.beginPath(); x.roundRect(pad, y, W - pad * 2, 150, 20); x.fill(); x.stroke();
  const row = (yy, lab, val, sw) => { shText(x, lab, pad + 28, yy, '500 24px "Pretendard", sans-serif', SH.mute); if (sw) shSwatch(x, pad + 200, yy - 8, 15, sw[0], sw[1]); shText(x, val, pad + (sw ? 228 : 190), yy, '600 28px "Pretendard", sans-serif', SH.ink, W - pad * 2 - 260); };
  row(y + 56, '헤어 컬러', L.color, L.colorC ? [L.colorC] : null);
  row(y + 118, '안경', L.glasses, L.frame && S.shape !== 'none' ? [L.frame.c, L.frame.c2] : null);
  y += 150 + 40;
  if (top) { // the analysis' top-3
    shText(x, '추천 TOP 3', pad, y + 30, '700 30px "Pretendard", sans-serif', SH.ink); y += 52;
    x.fillStyle = SH.card; x.strokeStyle = SH.line; x.beginPath(); x.roundRect(pad, y, W - pad * 2, 3 * 96 + 16, 20); x.fill(); x.stroke();
    top.slice(0, 3).forEach((cb, i) => { const t = lookTexts(cb.c.hair, cb.g.shape, cb.g.frame), yy = y + 60 + i * 96;
      shText(x, String(i + 1), pad + 30, yy, '400 40px "HOW Serif", Georgia, serif', SH.ink);
      shSwatch(x, pad + 100, yy - 8, 13, cb.c.hair.c); shText(x, '헤어 ' + t.color, pad + 124, yy, '600 26px "Pretendard", sans-serif', SH.ink, 330);
      shSwatch(x, pad + 480, yy - 8, 13, t.frame ? t.frame.c : '#ccc', t.frame && t.frame.c2); shText(x, t.glasses, pad + 504, yy, '500 26px "Pretendard", sans-serif', SH.ink, W - pad * 2 - 530);
      if (i < 2) { x.fillStyle = SH.line; x.fillRect(pad + 24, yy + 50, W - pad * 2 - 48, 2); } });
    y += 3 * 96 + 16 + 34;
  }
  // note + footer
  x.textAlign = 'center';
  shText(x, '얼굴 비율과 피부·모발 색을 기기 안에서 분석한 참고용 결과입니다.', W / 2, H - 112, '400 22px "Pretendard", sans-serif', SH.mute);
  shText(x, '조명·카메라에 따라 달라질 수 있으니 최종 선택은 컨설턴트와 상의해 주세요.', W / 2, H - 78, '400 22px "Pretendard", sans-serif', SH.mute);
  shText(x, 'H.O.W  ·  ' + ds, W / 2, H - 30, '400 22px "HOW Serif", Georgia, serif', '#b5afa6');
  return c;
}
let sharing = false; // the share sheet is open (or the sheet is being built): idle timer + double taps stay away
async function shareSheet(from) {
  if (sharing || exporting || !lm || rawC.width < 2) { if (!lm && !sharing) toast('얼굴이 보일 때 공유할 수 있어요'); return; }
  sharing = true; crumb('share'); let c = null;
  try {
    if (from === 'reco' && rc.sel && !ULTRA) await rcQueue(() => rcRender(rc.sel, $('rcMain'), 'main')); // outC = the selected combo
    c = await buildSheet();
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92)); freeCanvas(c); c = null;
    const name = `HOW_퍼스널컬러_${new Date().toISOString().slice(0, 10)}.jpg`, file = new File([blob], name, { type: 'image/jpeg' });
    window.__pc.lastSheet = { size: blob.size, name };
    if (window.__pc.sheetHook) { await window.__pc.sheetHook(blob); return; } // tests
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'H.O.W 퍼스널컬러 결과', text: 'H.O.W 퍼스널컬러 가상 피팅 결과' }); return; }
      catch (e) { if (e.name === 'AbortError') return; console.warn('share failed, saving instead', e); }
    }
    const url = URL.createObjectURL(blob), aEl = document.createElement('a'); aEl.href = url; aEl.download = name; document.body.appendChild(aEl); aEl.click(); aEl.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000); toast('결과 이미지를 저장했어요 (갤러리 · 다운로드)');
  } catch (e) { console.warn(e); toast('결과 이미지를 만들지 못했어요 · 다시 눌러 주세요'); }
  finally { if (c) freeCanvas(c); sharing = false; lastActive = Date.now(); }
}
window.__pc.buildSheet = buildSheet; window.__pc.shareSheet = shareSheet;

/* ------------------------------------------------------------------ UI */
function rerender() { if (S.mode === 'still') renderStill(); }
initGlasses3D(() => rerender());
function renderTypes() {
  $('types').innerHTML = Object.entries(TYPES).map(([k, t]) => `<button class="type ${S.type === k ? 'on' : ''}" data-type="${k}" style="background:${t.bg}">${t.e}<span>${t.n}</span></button>`).join('');
  $('subs').innerHTML = TYPES[S.type].subs.map(([k, n]) => `<button class="sub ${S.sub === k ? 'on' : ''}" data-sub="${k}">${TYPES[S.type].n.split(' ')[0]} ${n}</button>`).join('');
}
function hairBtn(h, worst) {
  const on = S.hair && S.hair.n === h.n, best = !worst && h.t.includes(S.sub);
  return `<button class="sw ${on ? 'on' : ''} ${worst ? 'worst' : ''}" data-hair="${h.n}">${best ? '<span class="best">BEST</span>' : ''}<span class="chip" style="background:radial-gradient(circle at 35% 30%, ${mix(h.c, '#ffffff', 0.35)}, ${h.c} 60%, ${mix(h.c, '#000000', 0.35)})"></span><span class="lbl">${h.n}</span></button>`;
}
function renderHair() {
  const T = TYPES[S.type];
  let html = `<button class="sw ${!S.hair ? 'on' : ''}" data-hair=""><span class="chip" style="background:repeating-linear-gradient(45deg,#eee,#eee 4px,#fff 4px,#fff 8px)"></span><span class="lbl">원래 컬러</span></button>`;
  html += T.hair.map((h) => hairBtn(h, false)).join('');
  if (S.showWorst) { const WT = TYPES[T.worst]; html += `<div class="sep">비교용 워스트 (${WT.n})</div>` + WT.hair.map((h) => hairBtn(h, true)).join(''); }
  $('hairList').innerHTML = html;
}
function frameChip(F) {
  if (F.kind === 'metal') return `linear-gradient(180deg, ${F.hi}, ${F.c} 45%, ${F.lo})`;
  if (F.kind === 'tortoise') return `radial-gradient(circle at 30% 40%, ${F.spot} 0 18%, transparent 30%), radial-gradient(circle at 70% 65%, ${F.spot} 0 14%, transparent 26%), ${F.c}`;
  if (F.kind === 'clear') return `linear-gradient(135deg, ${rgba(F.c, 0.55)}, ${rgba(F.c, 0.9)})`;
  if (F.kind === 'grad') return `linear-gradient(180deg, ${F.c}, ${F.c} 30%, ${rgba(F.c2, 0.7)})`;
  return F.matte ? `linear-gradient(180deg,#2c2b2e,${F.c})` : `linear-gradient(180deg, ${mix(F.c, '#ffffff', 0.18)}, ${F.c})`;
}
function renderFrames() {
  const T = TYPES[S.type];
  let ids = T.frames.map((f) => [f, false]);
  if (S.showWorst) ids = ids.concat(TYPES[T.worst].frames.filter((f) => !T.frames.includes(f)).map((f) => [f, true]));
  $('frameList').innerHTML = ids.map(([id, worst], i) => (worst && !ids[i - 1][1] ? `<div class="sep">비교용 워스트 (${TYPES[T.worst].n})</div>` : '') +
    `<button class="sw ${S.frame === id ? 'on' : ''} ${worst ? 'worst' : ''}" data-frame="${id}"><span class="chip" style="background:${frameChip(FRAMES[id])}"></span><span class="lbl">${FRAMES[id].n}</span></button>`).join('');
}
function renderShapes() { $('shapeList').innerHTML = SHAPES.map((s) => `<button class="shape ${S.shape === s.id ? 'on' : ''}" data-shape="${s.id}">${shapeIconSVG(s)}<span>${s.n}</span></button>`).join(''); }
function selectType(k) {
  S.type = k; S.sub = TYPES[k].subs[0][0];
  S.hair = TYPES[k].hair.find((h) => h.t.includes(S.sub)) || TYPES[k].hair[0]; S.frame = TYPES[k].frames[0];
  renderTypes(); renderHair(); renderFrames(); rerender();
}
function bindUI() {
  $('types').addEventListener('click', (ev) => { const b = ev.target.closest('[data-type]'); if (b) selectType(b.dataset.type); });
  $('subs').addEventListener('click', (ev) => { const b = ev.target.closest('[data-sub]'); if (!b) return; S.sub = b.dataset.sub; renderTypes(); renderHair(); });
  $('hairList').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-hair]'); if (!b) return; const n = b.dataset.hair;
    S.hair = n ? Object.values(TYPES).flatMap((t) => t.hair).find((h) => h.n === n) : null;
    if (S.hair && S.mode === 'live' && !hairMask) frameNo = stats.segEvery - 1;
    renderHair(); rerender();
  });
  $('frameList').addEventListener('click', (ev) => { const b = ev.target.closest('[data-frame]'); if (!b) return; S.frame = b.dataset.frame; if (S.shape === 'none') S.shape = 'round'; renderFrames(); renderShapes(); rerender(); });
  $('shapeList').addEventListener('click', (ev) => { const b = ev.target.closest('[data-shape]'); if (!b) return; S.shape = b.dataset.shape; renderShapes(); rerender(); });
  $('hairPick').addEventListener('input', (ev) => {
    const c = ev.target.value;
    $('hairPickVal').textContent = c;
    S.hair = { n: '직접 선택', c, t: [S.sub] };
    renderHair(); throttled();
  });
  $('worstToggle').addEventListener('change', (ev) => { S.showWorst = ev.target.checked; renderHair(); renderFrames(); });
  let rq = 0; const throttled = () => { if (!rq) rq = requestAnimationFrame(() => { rq = 0; rerender(); }); };
  $('intensity').addEventListener('input', (ev) => { S.intensity = ev.target.value / 100; $('intensityVal').textContent = ev.target.value + '%'; throttled(); });
  $('gSize').addEventListener('input', (ev) => { S.gScale = ev.target.value / 100; $('gSizeVal').textContent = ev.target.value + '%'; throttled(); });
  const hold = (el) => {
    const on = (e) => { e.preventDefault(); S.holdBefore = true; rerender(); }, off = () => { if (S.holdBefore) { S.holdBefore = false; rerender(); } };
    el.addEventListener('pointerdown', on); ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => el.addEventListener(t, off)); el.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  hold($('btnHold')); hold($('btnHold2'));
  $('cmpAfter').onclick = () => { S.compare = 'after'; $('cmpAfter').classList.add('on'); $('cmpSplit').classList.remove('on'); stage.classList.remove('split'); rerender(); };
  $('cmpSplit').onclick = () => { S.compare = 'split'; $('cmpSplit').classList.add('on'); $('cmpAfter').classList.remove('on'); stage.classList.add('split'); rerender(); };
  // phone layout: the sticky stage sits right under the (sticky) header, whose height depends on the width
  { const top = document.querySelector('header.top'), setH = () => document.documentElement.style.setProperty('--hdrH', (top ? top.offsetHeight : 60) + 'px');
    setH(); if (top && window.ResizeObserver) new ResizeObserver(setH).observe(top); }
  if (QP0.has('debug')) document.body.classList.add('dbg');
  $('btnCapture').onclick = capture; $('btnRelive').onclick = goLive; $('btnLive').onclick = goLive; $('phCamera').onclick = goLive;
  $('btnPhoto').onclick = showPhotoMode; $('phSample').onclick = loadSample;
  $('btnFlip').onclick = async () => { if (camP) return; S.facing = S.facing === 'user' ? 'environment' : 'user'; cameraOK = false; await goLive(); };
  $('fileInput').onchange = (e) => loadFile(e.target.files[0]); $('fileInput2').onchange = (e) => loadFile(e.target.files[0]);
  $('btnSave').onclick = save; $('btnSheet').onclick = () => shareSheet('main');
}

/* ------------------------------------------------------------------ boot */

/* ------------------------------------------------------------------ recommendation step (cover -> capture -> analysis -> result -> live) */
const rc = { el: $('reco'), raf: 0, res: null, an: null, combos: [], cur: 0, sel: null, done: null, gender: 'f', busy: false, camWanted: false, gen: 0, q: Promise.resolve() };
window.__pc.reco = rc;
const RC_MAX = ULTRA ? 640 : LITE ? 768 : 1024; // analysis photo size (long side); also what the previews are cropped from
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// let the browser paint (progress text) between heavy steps; setTimeout fallback when rAF is throttled
const yieldUI = () => new Promise((r) => { let d = 0; const f = () => { if (!d) { d = 1; r(); } }; requestAnimationFrame(() => setTimeout(f, 0)); setTimeout(f, 150); });
function rcProgress(t) { const p = $('rcBusy') && $('rcBusy').querySelector('p'); if (p) p.textContent = t; }
function rcShow(part) { for (const id of ['rcCap', 'rcBusy', 'rcRes']) $(id).hidden = id !== part; $('rcStep').textContent = part === 'rcRes' ? '추천 결과' : part === 'rcBusy' ? '분석 중' : '추천 진단'; }
function rcPreviewLoop() {
  rc.raf = requestAnimationFrame(rcPreviewLoop);
  const cs = camSrc(); if (!cs) return; const c = $('rcVideo'), vw = cs[1], vh = cs[2];
  const dpr = LITE ? 1 : Math.min(devicePixelRatio || 1, 2);
  const cw = c.clientWidth * dpr, ch = c.clientHeight * dpr; if (!cw || !ch) return;
  if (c.width !== Math.round(cw) || c.height !== Math.round(ch)) { c.width = Math.round(cw); c.height = Math.round(ch); }
  const x = c.getContext('2d'), s = Math.max(c.width / vw, c.height / vh);
  x.save(); if (mirror) { x.translate(c.width, 0); x.scale(-1, 1); } x.drawImage(cs[0], (c.width - vw * s) / 2, (c.height - vh * s) / 2, vw * s, vh * s); x.restore();
}
function rcStopPreview() { if (rc.raf) cancelAnimationFrame(rc.raf); rc.raf = 0; }
// camera + live loop off while analysing (frees the video decoder buffers and the per-frame model work)
function rcReleaseCamera() {
  rcStopPreview(); stopLoop(); releaseCamera();
}
function rcFreeCanvases() {
  for (const c of $('rcThumbs').querySelectorAll('canvas')) freeCanvas(c);
  freeCanvas($('rcMain')); freeCanvas($('rcVideo'));
}
async function rcBackToCapture() {
  rc.gen++; rcShow('rcCap');
  if (rc.camWanted && !cameraOK) { $('rcHint').textContent = '카메라를 다시 켜는 중…'; try { await startCamera(); } catch (e) { console.warn(e); } }
  $('rcShot').disabled = !cameraOK; $('rcHint').textContent = cameraOK ? '정면을 바라봐 주세요' : '카메라를 쓸 수 없어요 · 사진을 올려 주세요';
  if (cameraOK && !rc.raf) rcPreviewLoop();
}
function recoFlow() { // resolves with 'live' | 'skip'
  if (crashedAt && !rc.noticed) { rc.noticed = true; toast('이전 실행에서 메모리가 부족했어요. 이 기기에서는 가벼운 모드로 진행할게요.', 5000); }
  rc.el.hidden = false; document.body.classList.add('reco-on'); rcShow('rcCap'); rc.gender = S.gender || 'f'; rc.gEst = null; rc.camWanted = cameraOK;
  loadGender().catch((e) => console.warn('gender model', e)); // ~430 KB, cached offline by the SW; loads while the customer poses
  $('rcShot').disabled = !cameraOK; $('rcHint').textContent = (cameraOK ? '정면을 바라봐 주세요' : (rc.camErr || '카메라를 쓸 수 없어요 · 사진을 올려 주세요')) + (ULTRA ? ' · 가벼운 모드' : ''); rc.camErr = '';
  if (cameraOK) rcPreviewLoop();
  return new Promise((r) => { rc.done = r; });
}
function rcClose(how) { rc.gen++; rcStopPreview(); rcFreeCanvases(); rc.el.hidden = true; document.body.classList.remove('reco-on'); const d = rc.done; rc.done = null; d && d(how); }
// one preview at a time: renders share S / outC, so they are serialised; stale jobs (older generation) are skipped
function rcQueue(fn, gen) {
  const p = rc.q.then(async () => { if (gen !== undefined && gen !== rc.gen) return; try { await fn(); } catch (e) { console.warn('preview failed (results stay usable)', e); } });
  rc.q = p; return p;
}
async function rcAnalyze(src, sw, sh, mir, bmp) {
  if (rc.busy) return; rc.busy = true; rc.gen++; rcStopPreview(); rcShow('rcBusy'); rcProgress('사진을 준비하는 중…');
  let snap = null;
  try {
    // 1) freeze the frame at analysis size, then release camera / live loop before any model work
    crumb('capture');
    const s = Math.min(1, RC_MAX / Math.max(sw, sh));
    snap = document.createElement('canvas'); snap.width = Math.max(1, Math.round(sw * s)); snap.height = Math.max(1, Math.round(sh * s));
    const sx = snap.getContext('2d'); sx.imageSmoothingQuality = 'high'; sx.drawImage(src, 0, 0, snap.width, snap.height);
    if (bmp && bmp.close) { try { bmp.close(); } catch (e) {} }
    rcReleaseCamera(); window.__pc.rcCamReleased = (window.__pc.rcCamReleased || 0) + 1;
    await yieldUI();
    // 2) face landmarks + hair segmentation (same model instances, IMAGE mode)
    rcProgress('얼굴형을 분석하는 중…'); await yieldUI(); crumb('analysis');
    Object.assign(S, { style: 'none', bang: null, hair: null, shape: 'none' });
    await loadStillFrom(snap, snap.width, snap.height, mir, { cap: RC_MAX, quiet: true });
    freeCanvas(snap); snap = null;
    const p = window.__pc.rawLm;
    if (!lm || !p) { toast('얼굴을 찾지 못했어요. 정면으로 다시 찍어 주세요.'); await rcBackToCapture(); return; }
    // 3) gender estimate (on device) -> default 남성/여성 for hair + glasses; unsure -> 여성 as before, toggle highlighted
    rcProgress('얼굴을 분석하는 중…'); await yieldUI();
    rc.gManual = false;
    if (SET.gender !== 'auto') { rc.gEst = { pMale: NaN, g: SET.gender, sure: true, fixed: true }; rc.gender = SET.gender; } // settings: fixed default, no estimate
    else { rc.gEst = await rcEstimateGender(p); rc.gender = rc.gEst && rc.gEst.sure ? rc.gEst.g : 'f'; }
    // 4) face shape + colour
    rcProgress('퍼스널컬러를 분석하는 중…'); await yieldUI();
    let fm = null, fc, cm = null, cc;
    try { fm = faceMetrics(p); fc = classifyFace(fm); } catch (e) { console.warn('face shape failed', e); fc = { shape: 'oval', scores: {} }; }
    if (!FACE_WHY[fc.shape]) fc = { shape: 'oval', scores: {} };
    try { const img = rawX.getImageData(0, 0, rawC.width, rawC.height); cm = colorMetrics(img, rawC.width, rawC.height, p, hairMask && hairMask.meanRGB); cc = classifyColor(cm); }
    catch (e) { console.warn('colour analysis failed', e); }
    if (!cc || !TYPES[cc.type]) { const t = TYPES[S.type] ? S.type : 'spring'; cc = { type: t, sub: TYPES[t].subs[0][0], warm: TYPES[t].warm ? 1 : -1, conf: 0 }; }
    mark('color-done'); rc.an = { fm, fc, cm, cc, type: cc.type, sub: cc.sub };
    window.__pc.reco = rc;
    // 4) results: text first, then the #1 preview, then (full mode) small thumbnails one by one
    rcProgress('추천 룩을 그리는 중…'); await yieldUI();
    await rcBuild();
    rcShow('rcRes'); crumb('results', true);
    rcThumbsLazy();
  } catch (e) { console.error(e); toast('분석 중 오류가 났어요. 다시 찍어 주세요.'); await rcBackToCapture(); }
  finally { if (snap) freeCanvas(snap); rc.busy = false; }
}
// P(male) from face-api.js's AgeGenderNet (gender.js) on a detector-like square face crop from the landmarks, averaged with the
// mirrored crop. Thresholds: >= 0.7 남성, <= 0.3 여성, else unsure.
async function rcEstimateGender(p) {
  try {
    crumb('gender');
    await Promise.race([loadGender(), sleep(8000).then(() => { throw new Error('gender model timeout'); })]);
    if (!genderReady() || !rawC || !p) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of p) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
    const bw = x1 - x0, bh = y1 - y0;
    // test-time augmentation: the net is sensitive to the exact crop, so average a few detector-like crops (+ mirrored on full mode)
    // [side pad, top pad, bottom pad] as fractions of the landmark box; ~0.15-0.3 s per pass on a phone, ultra-lite: one pass
    const crops = ULTRA ? [[0.06, 0.15, -0.02]] : [[0, 0, 0], [0.1, 0.15, 0.05], [0.06, 0.15, -0.02]], flip = !LITE && !ULTRA;
    const c = document.createElement('canvas'); c.width = c.height = 112; const cx = c.getContext('2d', { willReadFrequently: true });
    let sum = 0, n = 0, age = 0; const passes = [];
    for (const [ex, et, eb] of crops) {
      const X = x0 - ex * bw, Y = y0 - et * bh, Wb = bw * (1 + 2 * ex), Hb = bh * (1 + et + eb), sz = Math.max(Wb, Hb), sc = 112 / sz;
      for (const fl of flip ? [false, true] : [false]) {
        cx.setTransform(1, 0, 0, 1, 0, 0); cx.fillStyle = '#000'; cx.fillRect(0, 0, 112, 112); cx.imageSmoothingQuality = 'high';
        if (fl) { cx.translate(112, 0); cx.scale(-1, 1); }
        cx.drawImage(rawC, X, Y, Wb, Hb, (sz - Wb) / 2 * sc, (sz - Hb) / 2 * sc, Wb * sc, Hb * sc);
        const r = predictGender(cx.getImageData(0, 0, 112, 112).data); sum += r.male; age += r.age; n++; passes.push(+r.male.toFixed(3)); await yieldUI();
      }
    }
    freeCanvas(c); const pm = sum / n, a = { age: age / n };
    const g = pm >= 0.5 ? 'm' : 'f', sure = pm >= 0.7 || pm <= 0.3;
    window.__pc.genderEst = { pMale: pm, g, sure, age: a.age, passes, src: [rawC.width, rawC.height] };
    return { pMale: pm, g, sure };
  } catch (e) { console.warn('gender estimate failed', e); return null; }
}
async function rcBuild() {
  const a = rc.an, gen = ++rc.gen;
  rc.res = recommend({ shape: a.fc.shape, type: a.type, sub: a.sub, gender: rc.gender, TYPES, FRAMES, SHAPE_BY_ID });
  rc.combos = [0, 1, 2].map((i) => ({ g: rc.res.glasses[i] || rc.res.glasses[0], c: rc.res.colors[i] || rc.res.colors[0] }));
  rc.sel = { ...rc.combos[0] }; rc.cur = 0;
  rcRenderText();
  const th = $('rcThumbs'); for (const c of th.querySelectorAll('canvas')) freeCanvas(c);
  rc.el.classList.toggle('ultra', ULTRA);
  if (ULTRA) { th.innerHTML = ''; return; } // ultra-lite: text-only results, no preview rendering at all
  th.classList.toggle('lite', LITE);
  th.innerHTML = rc.combos.map((c, i) => `<button class="rc-th ${i === 0 ? 'on' : ''}" data-i="${i}">${LITE ? `<i class="rc-sw" style="background:${c.c.hair.c}"></i>` : '<canvas></canvas>'}<span>추천 ${i + 1}${LITE ? ' · ' + c.c.hair.n : ''}</span></button>`).join('');
  await rcQueue(() => rcRender(rc.sel, $('rcMain'), 'main'), gen);
}
function rcThumbsLazy() {
  if (LITE || ULTRA) return; const gen = rc.gen, th = $('rcThumbs');
  rc.combos.forEach((cb, i) => rcQueue(async () => { await yieldUI(); const b = th.children[i]; if (b) await rcRender(cb, b.querySelector('canvas'), 'thumb'); }, gen));
}
async function rcRender(cb, canvas, kind) {
  if (ULTRA || !canvas || !lm || S.mode !== 'still') return;
  crumb('preview');
  Object.assign(S, { type: rc.an.type, sub: rc.an.sub, gender: rc.gender, hair: cb.c.hair, shape: cb.g.shape, frame: cb.g.frame, noHiGlasses: true, compare: 'after', holdBefore: false });
  try {
    if (S.shape !== 'none') await preloadGlasses3D(S.shape, S.frame); // decode once, then a single compose
    mark('assets-ready'); if (!lm) return;
    compose(rawC.width, rawC.height, lm, hairMask); mark('compose-done');
  } finally { S.noHiGlasses = false; }
  const fh = Math.hypot(lm.chin.x - lm.top.x, lm.chin.y - lm.top.y); let cx = (lm.top.x + lm.chin.x) / 2, cy = (lm.top.y + lm.chin.y) / 2 - fh * 0.12;
  const ar = kind === 'main' ? 0.8 : 1; let hh = Math.min(fh * (kind === 'main' ? 2.3 : 1.85), outC.height), ww = hh * ar;
  if (ww > outC.width) { ww = outC.width; hh = ww / ar; }
  cx = clamp(cx, ww / 2, outC.width - ww / 2); cy = clamp(cy, hh / 2, outC.height - hh / 2);
  const dpr = devicePixelRatio || 1, maxW = kind === 'main' ? (LITE ? 600 : 1024) : 240;
  const cw = Math.max(32, Math.min(maxW, Math.round((canvas.clientWidth || (kind === 'main' ? 480 : 120)) * dpr)));
  if (canvas.width !== cw) canvas.width = cw; const chh = Math.round(cw / ar); if (canvas.height !== chh) canvas.height = chh;
  const x = canvas.getContext('2d'); x.imageSmoothingQuality = 'high'; x.fillStyle = '#eee9e2'; x.fillRect(0, 0, canvas.width, canvas.height);
  x.save(); if (mirror) { x.translate(canvas.width, 0); x.scale(-1, 1); }
  // crop rect around the face, clipped to the photo (keeps the mapping exact when the crop runs past an edge)
  const k = canvas.width / ww, X0 = cx - ww / 2, Y0 = cy - hh / 2;
  const ax = Math.max(0, X0), ay = Math.max(0, Y0), bx = Math.min(outC.width, X0 + ww), by = Math.min(outC.height, Y0 + hh);
  if (bx > ax && by > ay) x.drawImage(outC, ax, ay, bx - ax, by - ay, (ax - X0) * k, (ay - Y0) * k, (bx - ax) * k, (by - ay) * k);
  x.restore();
  window.__pc.rcRenders = (window.__pc.rcRenders || 0) + 1;
  crumb('results', true);
}
const FACE_WHY = { oval: '이마·광대·턱의 폭과 길이 비율이 고르게 균형 잡힌 얼굴형', round: '얼굴 길이가 짧고 턱선이 부드러운 곡선형', square: '턱 끝 폭이 넓고 턱 각이 또렷한 얼굴형', long: '얼굴 폭에 비해 세로 길이가 긴 얼굴형', heart: '이마가 넓고 턱으로 갈수록 좁아지는 얼굴형', diamond: '광대가 가장 넓고 이마·턱이 좁은 얼굴형' };
function rcRenderText() {
  const a = rc.an, T = TYPES[a.type], subN = T.subs.find((q) => q[0] === a.sub)?.[1] || '', est = TYPES[a.cc.type];
  const tone = a.cc.warm >= 0 ? '웜' : '쿨', conf = a.cc.conf > 0.6 ? '뚜렷함' : a.cc.conf > 0.25 ? '보통' : '경계(직접 확인 권장)';
  $('rcSum').innerHTML = (ULTRA ? '<p class="rc-note">가벼운 모드: 미리보기 이미지는 생략돼요. 「실시간 테스트 시작」에서 바로 확인할 수 있어요.</p>' : '') + `<div class="rc-chip"><small>얼굴형</small><b>${SHAPES_KO[a.fc.shape]}</b><span>${FACE_WHY[a.fc.shape]}</span></div>
    <div class="rc-chip"><small>퍼스널컬러 ${a.type === a.cc.type && a.sub === a.cc.sub ? '추정' : '선택'}</small><b>${T.n} ${subN}</b><span>분석 추정: ${est.n} · 언더톤 ${tone} (${conf})</span></div>`;
  $('rcTypes').innerHTML = Object.entries(TYPES).map(([k, t]) => `<button class="${a.type === k ? 'on' : ''}" data-type="${k}">${t.n}</button>`).join('');
  $('rcSubs').innerHTML = T.subs.map(([k, n]) => `<button class="${a.sub === k ? 'on' : ''}" data-sub="${k}">${n}</button>`).join('');
  { // gender bar at the top of the results: shows the automatic choice; highlighted when the estimate was unsure / unavailable
    const e = rc.gEst, KO = { m: '남성', f: '여성' }, manual = rc.gManual, unsure = !e || !e.sure;
    $('rcGBar').classList.toggle('ask', unsure && !manual);
    $('rcGBtns').innerHTML = [['f', '여성'], ['m', '남성']].map(([k, n]) => `<button class="${rc.gender === k ? 'on' : ''}" data-g="${k}" aria-pressed="${rc.gender === k}">${n}</button>`).join('');
    $('rcGNote').textContent = e && e.fixed && !manual ? `기본: ${KO[e.g]} (설정)` : manual ? `직접 선택: ${KO[rc.gender]}` + (e && e.sure && e.g !== rc.gender ? ` (자동: ${KO[e.g]})` : '') : unsure ? (e ? '자동 판단이 어려워요 · 성별을 선택해 주세요' : '성별을 선택해 주세요') : `자동: ${KO[e.g]}`;
  }
  const shN = (id) => SHAPES.find((q) => q.id === id)?.n || id;
  $('rcGlasses').innerHTML = rc.res.glasses.map((g, i) => `<li class="${rc.sel && rc.sel.g === g ? 'on' : ''}" data-k="g" data-i="${i}"><b>${shN(g.shape)} · ${FRAMES[g.frame].n}</b><span>${g.why}</span></li>`).join('');
  $('rcColors').innerHTML = rc.res.colors.map((c, i) => `<li class="${rc.sel && rc.sel.c === c ? 'on' : ''}" data-k="c" data-i="${i}"><i style="background:${c.hair.c}"></i><b>${c.hair.n}</b><span>${c.why}</span></li>`).join('');
}
async function rcSelect(next) { rc.sel = next; rcRenderText(); const sel = next; await rcQueue(() => rc.sel === sel ? rcRender(sel, $('rcMain'), 'main') : null); }
function rcBind() {
  if (!rc.el || !$('rcShot')) return; // stale cached index.html from an older version: no reco step
  $('rcSkip').onclick = () => rcClose('skip');
  $('rcShot').onclick = () => { const cs = camSrc(); if (cameraOK && cs) rcAnalyze(cs[0], cs[1], cs[2], mirror); };
  $('rcFile').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f || rc.busy) return; try { const bmp = await decodePhoto(f); rcAnalyze(bmp, bmp.width, bmp.height, false, bmp); } catch (er) { toast('사진을 열 수 없어요'); } };
  $('rcRetake').onclick = () => { if (!rc.busy) rcBackToCapture(); };
  $('rcShare').onclick = () => { if (!rc.busy) shareSheet('reco'); };
  $('rcThumbs').onclick = (e) => { const b = e.target.closest('[data-i]'); if (!b || rc.busy) return; [...$('rcThumbs').children].forEach((q) => q.classList.toggle('on', q === b)); rcSelect({ ...rc.combos[+b.dataset.i] }); };
  const lists = (e) => { const li = e.target.closest('li[data-k]'); if (!li || rc.busy) return; const k = li.dataset.k, i = +li.dataset.i; const src = k === 'g' ? rc.res.glasses : rc.res.colors; rcSelect({ ...rc.sel, [k]: src[i] }); };
  ['rcGlasses', 'rcColors'].forEach((id) => { $(id).onclick = lists; });
  $('rcTypes').onclick = async (e) => { const b = e.target.closest('[data-type]'); if (!b || rc.busy) return; rc.an.type = b.dataset.type; rc.an.sub = rc.an.type === rc.an.cc.type ? rc.an.cc.sub : TYPES[rc.an.type].subs[0][0]; rc.busy = true; try { await rcBuild(); rcThumbsLazy(); } finally { rc.busy = false; } };
  $('rcSubs').onclick = async (e) => { const b = e.target.closest('[data-sub]'); if (!b || rc.busy) return; rc.an.sub = b.dataset.sub; rc.busy = true; try { await rcBuild(); rcThumbsLazy(); } finally { rc.busy = false; } };
  const pickG = async (e) => { const b = e.target.closest('[data-g]'); if (!b || rc.busy) return; rc.gManual = true; rc.gender = b.dataset.g; rc.busy = true; try { await rcBuild(); rcThumbsLazy(); } finally { rc.busy = false; } };
  $('rcGBtns').onclick = pickG;
  $('rcGo').onclick = async () => { // apply the previewed combo to the main screen, then go live
    if (rc.going) return; rc.going = true; rc.gen++; await rc.q; rc.going = false; // let a running preview finish first
    const c = rc.sel; Object.assign(S, { type: rc.an.type, sub: rc.an.sub, gender: rc.gender, hair: c.c.hair, shape: c.g.shape, frame: c.g.frame });
    renderTypes(); renderHair(); renderFrames(); renderShapes();
    rcClose('live');
  };
}

/* ------------------------------------------------------------------ settings + idle auto-return */
// Hidden consultant settings (long-press the H.O.W wordmark 2 s): idle minutes (0 = off) and the default gender. localStorage.
const SET = (() => { let s = {}; try { s = JSON.parse(localStorage.getItem('pcSettings') || '{}') || {}; } catch (e) {}
  return { idle: [0, 1, 3, 5, 10].includes(s.idle) ? s.idle : 3, gender: ['auto', 'f', 'm'].includes(s.gender) ? s.gender : 'auto' }; })();
function saveSet() { try { localStorage.setItem('pcSettings', JSON.stringify(SET)); } catch (e) {} }
window.__pc.SET = SET;
const IDLE_MS = () => QP0.has('idle') ? +QP0.get('idle') * 1000 : SET.idle * 60000, IDLE_CD = QP0.has('idlecd') ? +QP0.get('idlecd') : 10;
let lastActive = Date.now(), idleCd = 0, idleT = 0;
const poke = (e) => { // any touch = still here; taps on the countdown card itself are left to its buttons
  lastActive = Date.now();
  if (idleCd && !(e && e.target && e.target.closest && e.target.closest('.idle-card'))) idleHide();
};
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((t) => addEventListener(t, poke, { capture: true, passive: true }));
function idleBlocked() { // never during the share sheet, an analysis, model loading or with the app in the background
  return !!coverResolve || sharing || exporting || rc.busy || homing || document.hidden || !modelsReady || !$('setSheet').hidden;
}
function idleHide() { if (!idleCd) return; idleCd = 0; $('idleBox').hidden = true; }
function idleTick() {
  const ms = IDLE_MS();
  if (!ms || idleBlocked()) { if (idleCd) idleHide(); if (document.hidden || coverResolve || sharing || rc.busy) lastActive = Date.now(); return; }
  if (!idleCd) { if (Date.now() - lastActive >= ms) { idleCd = IDLE_CD; $('idleBox').hidden = false; $('idleN').textContent = idleCd; } return; }
  idleCd--; $('idleN').textContent = Math.max(0, idleCd);
  if (idleCd <= 0) { idleCd = 0; $('idleBox').hidden = true; lastActive = Date.now(); crumb('idle'); nextCustomer('idle'); }
}
idleT = setInterval(idleTick, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) lastActive = Date.now(); });
function bindSettings() {
  $('idleBox').onclick = (e) => { if (e.target === e.currentTarget) { idleHide(); lastActive = Date.now(); } }; // backdrop = 계속하기
  $('idleGo').onclick = (e) => { e.stopPropagation(); idleHide(); lastActive = Date.now(); };
  $('idleNow').onclick = (e) => { e.stopPropagation(); idleHide(); nextCustomer('idle'); };
  const render = () => {
    $('setIdle').innerHTML = [[0, '끄기'], [1, '1분'], [3, '3분'], [5, '5분'], [10, '10분']].map(([v, n]) => `<button type="button" class="${SET.idle === v ? 'on' : ''}" data-idle="${v}" aria-pressed="${SET.idle === v}">${n}</button>`).join('');
    $('setGender').innerHTML = [['auto', '자동'], ['f', '여성'], ['m', '남성']].map(([v, n]) => `<button type="button" class="${SET.gender === v ? 'on' : ''}" data-sg="${v}" aria-pressed="${SET.gender === v}">${n}</button>`).join('');
  };
  $('setIdle').onclick = (e) => { const b = e.target.closest('[data-idle]'); if (!b) return; SET.idle = +b.dataset.idle; saveSet(); render(); };
  $('setGender').onclick = (e) => { const b = e.target.closest('[data-sg]'); if (!b) return; SET.gender = b.dataset.sg; saveSet(); render();
    if (SET.gender !== 'auto' && !rc.an && coverResolve == null && S.gender !== SET.gender) S.gender = SET.gender; };
  $('setClose').onclick = () => { $('setSheet').hidden = true; lastActive = Date.now(); };
  $('setSheet').addEventListener('click', (e) => { if (e.target === $('setSheet')) $('setSheet').hidden = true; });
  // 2 s long-press on any H.O.W wordmark (header, recommendation header, cover); the release after it must not start the cover
  let lpT = 0, swallow = false;
  const open = () => { render(); $('setVer').textContent = (self.APP_VERSION || '') + (self.APP_DATE ? ' · ' + self.APP_DATE : ''); $('setSheet').hidden = false; swallow = true; if (navigator.vibrate) try { navigator.vibrate(30); } catch (e) {} };
  for (const el of document.querySelectorAll('.wordmark, .cv-mark')) {
    el.addEventListener('pointerdown', () => { clearTimeout(lpT); lpT = setTimeout(open, 2000); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => el.addEventListener(t, () => clearTimeout(lpT)));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  coverEl.addEventListener('click', (e) => { if (swallow || !$('setSheet').hidden) { e.stopImmediatePropagation(); swallow = false; } }, true);
  window.__pc.openSettings = open;
}

/* ------------------------------------------------------------------ background / foreground */
// Android keeps (or silently freezes) the camera when the app goes to the background; the frozen track then shows a still frame
// on return. Release the camera while hidden and bring it back on return to the same screen.
let hiddenWhile = null;
document.addEventListener('visibilitychange', () => {
  const coverOn = !!coverResolve, recoOn = rc.el && !rc.el.hidden, rcCapOn = recoOn && !$('rcCap').hidden;
  if (document.hidden) {
    if (rc.busy || coverOn) return; // analysis keeps running (camera already off); the cover has no camera
    if (S.mode === 'live' && !recoOn && stream) { hiddenWhile = 'live'; stopLoop(); releaseCamera(); }
    else if (rcCapOn && stream) { hiddenWhile = 'rcCap'; rcReleaseCamera(); }
    return;
  }
  const w = hiddenWhile; hiddenWhile = null;
  if (w === 'live' && S.mode === 'live' && !coverOn && !recoOn) goLive();
  else if (w === 'rcCap' && rcCapOn && !rc.busy) rcBackToCapture();
  else if (!coverOn && !recoOn && S.mode === 'live' && !camHealthy() && !camP) goLive(); // track ended while away
});

/* ------------------------------------------------------------------ cover (intro) */
// shown on every launch (in-store: one cover per customer); models load in the background, the camera is only requested after the tap
const S0 = { ...S };
let modelsReady = false, modelsFailed = false, coverResolve = null;
const coverEl = $('cover');
function coverLoad(t) { const e = $('cvLoad'); if (e) e.textContent = t; }
function purgeStillCaches() { // next customer: drop all decoded / colourised hair and glasses layers
  try { purgeGlasses3D(); } catch (e) {}
  for (const c of [glassC, lensC, tintC, paneC, segIn, recC, darkC, shadowC, maskC]) { c.width = c.height = 1; }
}
let sessGen = 0, homing = false;
// 다음 고객 (home button) and the idle auto-return share this: photo wiped, camera off, back to the cover
async function nextCustomer(why = 'home') {
  if (coverResolve || homing || (rc.busy && why !== 'idle')) return; homing = true; try { await stillIdle(); } finally { homing = false; }
  idleHide();
  // browser memory outside the JS heap (WASM model heap, decoder caches) creeps up ~40 MB per customer in long sessions and only
  // a page load returns it: every RECYCLE customers, start the next one from a fresh page (models come from the SW cache; the
  // cover shows while they load, so the customer sees the same screen)
  const n = (+sessionStorage.getItem('pcCust') || 0) + 1, RECYCLE = ULTRA ? 4 : LITE ? 6 : 12;
  if (n >= RECYCLE && !QP0.has('norecycle')) { sessionStorage.setItem('pcCust', '0'); releaseCamera(); stopLoop(); const u = new URL(location.href); u.searchParams.delete('_u'); location.replace(u.toString()); return; }
  sessionStorage.setItem('pcCust', String(n));
  const recoOpen = rc.el && !rc.el.hidden; const p = showCover(); if (recoOpen) rcClose('idle'); await p; startSession();
} // bumped for every new customer: an older startSession that is still awaiting must not continue
function showCover() {
  sessGen++; stopLoop(); releaseCamera(); idleHide();
  Object.assign(rc, { an: null, res: null, combos: [], sel: null, gEst: null, gManual: false }); window.__pc.genderEst = null;
  // fresh session for the next customer: default selections, no photo left on screen
  purgeStillCaches();
  Object.assign(S, S0, { mode: 'still' }, SET.gender !== 'auto' ? { gender: SET.gender } : {}); hairMask = null; lm = null; lastStillMasks = null;
  rawC.width = rawC.height = 1; outC.width = outC.height = 1; const vx = view.getContext('2d'); vx.clearRect(0, 0, view.width, view.height);
  stage.classList.remove('is-still'); $('placeholder').classList.remove('hide'); $('phText').textContent = '카메라를 준비하는 중…';
  $('cmpAfter').classList.add('on'); $('cmpSplit').classList.remove('on'); stage.classList.remove('split', 'no-live'); // compare UI back to 결과만 (S.compare was reset, the buttons were not)
  $('intensity').value = 75; $('intensityVal').textContent = '75%'; $('gSize').value = 100; $('gSizeVal').textContent = '100%'; $('worstToggle').checked = false;
  renderTypes(); renderHair(); renderFrames(); renderShapes(); setStatus(''); $('fps').textContent = '';
  coverEl.classList.remove('hide'); coverEl.hidden = false; document.body.classList.add('cover-on'); scrollTo(0, 0);
  coverLoad(modelsReady ? '' : '준비 중…'); crumb('cover', true);
  return new Promise((r) => { coverResolve = r; });
}
function hideCover() {
  if (!coverResolve) return; const r = coverResolve; coverResolve = null;
  coverEl.classList.add('hide'); document.body.classList.remove('cover-on');
  r();
}
coverEl.addEventListener('click', hideCover);
coverEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hideCover(); } });
async function startSession() { // after the cover tap
  if (modelsFailed) return; const my = sessGen, stale = () => my !== sessGen;
  if (!modelsReady) { $('placeholder').classList.remove('hide'); $('phText').textContent = '모델을 불러오는 중이에요…'; await modelsP; if (modelsFailed || stale()) return; }
  if (navigator.mediaDevices?.getUserMedia) {
    $('phText').textContent = '카메라를 켜는 중… (권한을 허용해 주세요)';
    // ask for the camera right away (inside the tap), but start the heavy live loop only once the fade has finished
    const fade = new Promise((r) => setTimeout(r, 720));
    try { if (!cameraOK) await startCamera(); } catch (e) { console.warn(e); if (e && e.name !== 'StaleCamera') rc.camErr = camErrKo(e); }
    await fade; if (stale()) return;
  }
  const how = new URLSearchParams(location.search).has('noreco') || !rc.el || !$('rcShot') ? 'skip' : await recoFlow();
  if (stale()) return;
  if (cameraOK || rc.camWanted) await goLive(); // the camera was released for the analysis: goLive restarts it
  else if (how === 'live' && lm) { S.mode = 'still'; stage.classList.add('is-still'); $('placeholder').classList.add('hide'); renderStill(); showPhotoMode(); }
  else showPhotoMode();
}
let modelsP = null;
async function boot() {
  renderTypes(); renderHair(); renderFrames(); renderShapes(); bindUI(); rcBind(); bindSettings();
  if (SET.gender !== 'auto') S.gender = SET.gender;
  const params = new URLSearchParams(location.search);
  const skipCover = params.has('nocover') || params.has('photo') || params.has('sample');
  modelsP = loadModels().then(() => { modelsReady = true; coverLoad(''); setStatus(`모델 준비 완료 (${delegate})`); },
    (e) => { console.error(e); modelsFailed = true; coverLoad('AI 모델을 불러오지 못했어요 · 인터넷 연결 확인 후 새로고침'); $('phText').textContent = 'AI 모델을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침 해주세요.'; setStatus('모델 로딩 실패'); });
  $('btnHome').onclick = () => nextCustomer();
  if (skipCover) {
    coverEl.classList.add('hide'); coverEl.hidden = true; document.body.classList.remove('cover-on');
    await modelsP; if (modelsFailed) return;
    if (params.has('sample')) { await loadSample(); return; }
    if (navigator.mediaDevices?.getUserMedia && !params.has('photo')) { $('phText').textContent = '카메라를 켜는 중… (권한을 허용해 주세요)'; await goLive(); }
    else showPhotoMode();
    return;
  }
  const tap = new Promise((r) => { coverResolve = r; });
  window.__pc.coverShown = true;
  await tap; await startSession();
}
window.__pc.selectType = selectType;
window.__pc.setHairByName = (n) => { S.hair = n === 'orig' ? null : Object.values(TYPES).flatMap((t) => t.hair).find((h) => h.n === n) || S.hair; renderHair(); rerender(); };
window.__pc.set = (o) => { Object.assign(S, o); renderTypes(); renderHair(); renderFrames(); renderShapes(); rerender(); };
window.__pc.loadSample = loadSample;
window.__pc.estimateGender = () => rcEstimateGender(window.__pc.rawLm); // test hook (photo mode)
boot().then(() => { window.__pc.ready = true; });

// ---------- PWA: service worker + install button ----------
// (service worker registration + update check live in update.js)
{
  const btn = document.getElementById('btnInstall'), guide = document.getElementById('iosGuide');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ua = navigator.userAgent, isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let deferred = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; if (!standalone) btn.hidden = false; });
  addEventListener('appinstalled', () => { btn.hidden = true; deferred = null; });
  if (isIOS && !standalone) btn.hidden = false;
  btn.addEventListener('click', async () => {
    if (deferred) { deferred.prompt(); const r = await deferred.userChoice; if (r.outcome === 'accepted') btn.hidden = true; deferred = null; }
    else guide.hidden = false;
  });
  document.getElementById('iosClose').addEventListener('click', () => { guide.hidden = true; });
  guide.addEventListener('click', (e) => { if (e.target === guide) guide.hidden = true; });
  window.__pwa = { get deferred() { return !!deferred; }, isIOS, standalone };
}
