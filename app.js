// 퍼스널컬러 가상 피팅 — 100% client-side. Photos/video never leave the device.
import { FRAMES, SHAPES, SHAPE_BY_ID, drawGlasses, shapeIconSVG, mix, rgba } from './frames.js';
import { initGlasses3D, drawGlasses3D, preloadGlasses3D, purgeGlasses3D } from './glasses3d.js';
import { faceMetrics, classifyFace, colorMetrics, classifyColor, recommend, SHAPES_KO } from './reco.js';
import { loadGender, predictGender, genderReady } from './gender.js';
import { STYLES, BANGS, OVAL_IDX, CANON, buildStyle, colorize, fitAffine, templateTransform, invAffine, styleIconSVG } from './hairstyle.js';

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
  frame: 'gold', shape: 'round', gScale: 1, hScale: 1,
  style: 'none', bang: null, gender: 'f',
  showWorst: false, compare: 'after', holdBefore: false,
  mode: 'live', facing: 'user',
};
const $ = (id) => document.getElementById(id);
const view = $('view');
const video = $('video');
const stage = $('stage');
const mk = (w = 1, h = 1) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const rawC = mk(), rawX = rawC.getContext('2d', { willReadFrequently: true });
const baseC = mk(), baseX = baseC.getContext('2d', { willReadFrequently: true });
const outC = mk(), outX = outC.getContext('2d');
const upC = mk(), upX = upC.getContext('2d');
const recC = mk(), recX = recC.getContext('2d');
const glassC = mk(), glassX = glassC.getContext('2d');
const lensC = mk(), lensX = lensC.getContext('2d');
const tintC = mk(), tintX = tintC.getContext('2d');
const darkC = mk(), darkX = darkC.getContext('2d');
function lensDark() { ensure(darkC, lensC.width, lensC.height); darkX.globalCompositeOperation = 'source-over'; darkX.clearRect(0, 0, darkC.width, darkC.height); darkX.drawImage(lensC, 0, 0); darkX.globalCompositeOperation = 'source-in'; darkX.fillStyle = '#000'; darkX.fillRect(0, 0, darkC.width, darkC.height); return darkC; }
const shadowC = mk(), shadowX = shadowC.getContext('2d');
const maskC = mk(), maskX = maskC.getContext('2d');
const fillC = mk(), fillX = fillC.getContext('2d');
const occC = mk(), occX = occC.getContext('2d');
const occFC = mk(), occFX = occFC.getContext('2d');
const occ2 = mk(), occ2X = occ2.getContext('2d');
const cshC = mk(), cshX = cshC.getContext('2d'), cshC2 = mk(), cshX2 = cshC2.getContext('2d');
const grainL = mk(), grainLX = grainL.getContext('2d');
let grainC = null;
// grain texture: high-pass of a cheek patch (gray 128 = no change) used with soft-light over filled areas
function makeGrain(P) {
  if (!P || !P.aff || rawC.width < 64) return;
  // skin texture source: the cheek. Features in the patch (moles, a stray hair, a fold) would repeat as a visible tiled pattern
  // over the fill -> the high-pass is clamped to ~1.5 sigma so only the fine pore texture survives
  const A = P.aff, gx = 0.5, gy = 0.38, X = A.a * gx + A.c * gy + A.e, Y = A.b * gx + A.d * gy + A.f;
  const sz = clamp(Math.round(Math.hypot(A.a, A.b) * 0.3), 24, 96), x0 = Math.round(X - sz / 2), y0 = Math.round(Y - sz / 2);
  if (x0 < 0 || y0 < 0 || x0 + sz > rawC.width || y0 + sz > rawC.height) return;
  const src = rawX.getImageData(x0, y0, sz, sz).data, Lm = new Float32Array(sz * sz);
  for (let i = 0; i < sz * sz; i++) Lm[i] = 0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2];
  const bl = boxBlur(Lm, sz, sz, 3);
  const c = mk(sz, sz), x = c.getContext('2d'), id = x.createImageData(sz, sz);
  let sd = 0; for (let i = 0; i < sz * sz; i++) sd += (Lm[i] - bl[i]) ** 2; sd = Math.sqrt(sd / (sz * sz)) + 0.5;
  // heal outliers (moles, spots) + 2px around them, then soft-clamp the rest
  const ol = new Uint8Array(sz * sz); for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) if (Math.abs(Lm[y * sz + x] - bl[y * sz + x]) > 2.2 * sd)
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && xx >= 0 && yy < sz && xx < sz) ol[yy * sz + xx] = 1; }
  sd *= 1.5;
  // v23: older cheeks carry long diagonal folds that survive the clamp and tile into a hatch pattern over the forehead fill ->
  // make the tile direction-free: average with its transposed / mirrored copies, then restore the original strength
  const hp = new Float32Array(sz * sz); for (let i = 0; i < sz * sz; i++) hp[i] = ol[i] ? 0 : sd * Math.tanh((Lm[i] - bl[i]) / sd);
  const iso = new Float32Array(sz * sz); let s0 = 0, s1 = 0;
  for (let y = 0; y < sz; y++) for (let x2 = 0; x2 < sz; x2++) { const v = (hp[y * sz + x2] + hp[x2 * sz + y] + hp[y * sz + (sz - 1 - x2)] + hp[(sz - 1 - x2) * sz + (sz - 1 - y)]) / 4; iso[y * sz + x2] = v; s0 += hp[y * sz + x2] ** 2; s1 += v * v; }
  const gn = s1 > 0 ? Math.sqrt(s0 / s1) * 0.8 : 1;
  for (let i = 0; i < sz * sz; i++) { const v = clamp(128 + iso[i] * gn * 1.6, 0, 255); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
  x.putImageData(id, 0, 0); grainC = c;
}
const segIn = mk(), segX = segIn.getContext('2d', { willReadFrequently: true });

let MP = null, face = null, seg = null, faceMode = null, segMode = null, delegate = 'GPU';
let stream = null, liveRAF = 0, cameraOK = false, mkFace = null, mkSeg = null, switching = false, tuned = false;
let mirror = false;
let lm = null;        // landmarks (key points + oval) in raw pixel coords
let hairMask = null;  // {id, meanY, meanRGB, bbox, ...} + seg extras (fill, neck)
const stats = { fps: 0, detMs: 0, segMs: 0, renderMs: 0, hairMs: 0, glassMs: 0, segEvery: 2, delegate: '', lastFps: [] };
window.__pc = { S, stats, get lm() { return lm; }, get hairMask() { return hairMask; }, get origHex() { return origHex; }, render: () => renderStill() };
window.__pc.marks = MARKS; window.__pc.mark = mark;
window.__pc.flags = { IS_ANDROID, LOWMEM, LITE, ULTRA, get crashedAt() { return crashedAt; }, dpr: devicePixelRatio, deviceMemory: navigator.deviceMemory };
window.__pc.dbg = () => ({ photoCache, colorCache, cur: currentStyle() });
window.__pc.layers = () => ({ base: baseC, fill: fillC, occ: occFC, mask: hairMask });
if (new URLSearchParams(location.search).has('proc')) { S.procGlasses = true; S.procHair = true; }
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
// push-pull inpainting: fills holes with smoothly interpolated surrounding colors
function pushPull(px, w, h, known) {
  const levels = [];
  let cw = w, ch = h, C = new Float32Array(w * h * 3), Wt = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { Wt[i] = known[i]; C[i * 3] = px[i * 4]; C[i * 3 + 1] = px[i * 4 + 1]; C[i * 3 + 2] = px[i * 4 + 2]; }
  levels.push({ C, Wt, w: cw, h: ch });
  while (cw > 2 && ch > 2) {
    const nw = Math.ceil(cw / 2), nh = Math.ceil(ch / 2), NC = new Float32Array(nw * nh * 3), NW = new Float32Array(nw * nh);
    const P = levels[levels.length - 1];
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      let sw = 0, r = 0, g = 0, b = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const xx = Math.min(cw - 1, x * 2 + dx), yy = Math.min(ch - 1, y * 2 + dy), j = yy * cw + xx, ww = P.Wt[j]; sw += ww; r += P.C[j * 3] * ww; g += P.C[j * 3 + 1] * ww; b += P.C[j * 3 + 2] * ww; }
      const k = y * nw + x; if (sw > 0) { NC[k * 3] = r / sw; NC[k * 3 + 1] = g / sw; NC[k * 3 + 2] = b / sw; } NW[k] = Math.min(1, sw);
    }
    cw = nw; ch = nh; levels.push({ C: NC, Wt: NW, w: cw, h: ch });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const L = levels[l], U = levels[l + 1];
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const k = y * L.w + x, wv = L.Wt[k]; if (wv >= 1) continue;
      const fx = clamp((x - 0.5) / 2, 0, U.w - 1), fy = clamp((y - 0.5) / 2, 0, U.h - 1), x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(U.w - 1, x0 + 1), y1 = Math.min(U.h - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
      for (let c = 0; c < 3; c++) {
        const v = (U.C[(y0 * U.w + x0) * 3 + c] * (1 - ax) + U.C[(y0 * U.w + x1) * 3 + c] * ax) * (1 - ay) + (U.C[(y1 * U.w + x0) * 3 + c] * (1 - ax) + U.C[(y1 * U.w + x1) * 3 + c] * ax) * ay;
        L.C[k * 3 + c] = L.C[k * 3 + c] * wv + v * (1 - wv);
      }
      L.Wt[k] = 1;
    }
  }
  return levels[0].C;
}
// customer's natural hairline (canonical y; lm10 = -0.98, chin = 1.39):
//  - visible hairline from the hair mask when the forehead is open (mask edge sits a touch above the real roots -> bias down)
//  - otherwise (bangs / no mask) the anatomical thirds rule from the brows: trichion ~ brow - (chin - brow) / 2
function naturalHairline(P, mask) {
  let browC = -0.42;
  if (P && P.brows && P.aff) { const I = invAffine(P.aff); let a = 0; for (const q of P.brows) a += I.b * q.x + I.d * q.y + I.f; browC = a / P.brows.length; }
  const anat = clamp(browC - (1.39 - browC) * 0.4, -1.3, -1.08);
  const m = mask && mask.hairline;
  // the segmenter only marks dense hair -> the visible hairline is a bit lower than its edge; prefer slight overlap over a skin gap
  if (m != null && m < -1.0 && m > -1.6) { const own = clamp(m + 0.09, -1.38, -1.05), w = Math.abs(own - anat) < 0.18 ? 0.8 : 0.5; return Math.max(own * w + anat * (1 - w), -1.33); }
  return anat;
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
  // hairstyle support: inpaint the original hair (dilated) and build a neck occluder
  const P = lmP, aff = P && P.aff;
  if (S.style !== 'none') {
    const dil = boxBlur(raw, w, h, Math.max(2, Math.round(w / 45)));
    // face-oval mask at seg resolution (inside the oval we fill with skin only, outside with background/clothes)
    let inOval = null, faceOnly = null;
    if (P) {
      ensure(occC, w, h); occX.clearRect(0, 0, w, h); occX.fillStyle = '#fff'; occX.beginPath();
      P.oval.forEach((q, i) => { const x = q.x / segScaleX, y = q.y / segScaleY; i ? occX.lineTo(x, y) : occX.moveTo(x, y); });
      occX.closePath(); occX.fill();
      { const od0 = occX.getImageData(0, 0, w, h).data; faceOnly = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) faceOnly[i] = od0[i * 4 + 3] > 100 ? 1 : 0; }
      if (aff) { // forehead cap above the landmark oval (skin up to the real hairline)
        occX.beginPath(); [[-0.9, -0.75], [-0.86, -1.15], [-0.62, -1.42], [0, -1.55], [0.62, -1.42], [0.86, -1.15], [0.9, -0.75]].forEach(([cx, cy], i) => {
          const x = (aff.a * cx + aff.c * cy + aff.e) / segScaleX, y = (aff.b * cx + aff.d * cy + aff.f) / segScaleY; i ? occX.lineTo(x, y) : occX.moveTo(x, y); });
        occX.closePath(); occX.fill();
      }
      const od = occX.getImageData(0, 0, w, h).data; inOval = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) inOval[i] = od[i * 4 + 3] > 100 ? 1 : 0;
    }
    // skin reference sampled from both cheeks + forehead centre (not hair); also gives the photo's lighting
    const smp = (cx, cy) => { if (!aff) return null; const X = (aff.a * cx + aff.c * cy + aff.e) / segScaleX, Y = (aff.b * cx + aff.d * cy + aff.f) / segScaleY;
      const r = Math.max(2, Math.round(w / 90)); let n = 0, R = 0, G = 0, B = 0;
      for (let yy = Math.round(Y) - r; yy <= Math.round(Y) + r; yy++) for (let xx = Math.round(X) - r; xx <= Math.round(X) + r; xx++) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || raw[yy * w + xx] > 0.3) continue; const j = (yy * w + xx) * 4; R += px[j]; G += px[j + 1]; B += px[j + 2]; n++; }
      return n ? [R / n, G / n, B / n] : null; };
    const cl = smp(-0.52, 0.35), cr = smp(0.52, 0.35), fc = smp(0, -0.62);
    const refs = [cl, cr, fc].filter(Boolean);
    const skin = refs.length ? [0, 1, 2].map((k) => refs.reduce((a2, r2) => a2 + r2[k], 0) / refs.length) : null;
    const lumOf = (c) => c ? 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] : 0;
    out.skin = skin; out.light = cl && cr ? clamp((lumOf(cr) - lumOf(cl)) / (lumOf(cr) + lumOf(cl) + 1) * 2.5, -1, 1) : 0;
    out.expo = skin ? clamp(lumOf(skin) / 165, 0.55, 1.25) : 1;
    // customer's hairline height at the forehead centre (canonical y), used to fit photo hairstyles
    if (aff) {
      let acc = 0, cnt = 0;
      for (const cx of [-0.25, 0, 0.25]) for (let cy = -0.35; cy > -1.8; cy -= 0.02) {
        const X = Math.round((aff.a * cx + aff.c * cy + aff.e) / segScaleX), Y = Math.round((aff.b * cx + aff.d * cy + aff.f) / segScaleY);
        if (X < 0 || Y < 0 || X >= w || Y >= h) break; if (raw[Y * w + X] > 0.5) { acc += cy; cnt++; break; }
      }
      out.hairline = cnt ? Math.round(acc / cnt * 50) / 50 : null;
      // per-column edge of the customer's hair across the forehead (13 samples, cx -0.72..0.72): the new hair must cover it everywhere
      const prof = new Float32Array(13).fill(NaN);
      for (let q = 0; q < 13; q++) { const cx = -0.72 + q * 0.12;
        for (let cy = -0.5; cy > -1.8; cy -= 0.015) { const X = Math.round((aff.a * cx + aff.c * cy + aff.e) / segScaleX), Y = Math.round((aff.b * cx + aff.d * cy + aff.f) / segScaleY);
          if (X < 0 || Y < 0 || X >= w || Y >= h) break; if (raw[Y * w + X] > 0.5) { prof[q] = cy; break; } } }
      if (prev && prev.hlProf) for (let q = 0; q < 13; q++) if (prof[q] === prof[q] && prev.hlProf[q] === prev.hlProf[q] && Math.abs(prof[q] - prev.hlProf[q]) < 0.2) prof[q] = prev.hlProf[q] * 0.5 + prof[q] * 0.5;
      out.hlProf = prof;
      // live: smooth the estimate over frames (the low-res mask edge flickers)
      if (prev && prev.hairline != null && out.hairline != null && Math.abs(prev.hairline - out.hairline) < 0.3) out.hairline = prev.hairline * 0.6 + out.hairline * 0.4;
    }
    // forehead cleanup: thin fringe strands are often missed by the (low-res) segmenter -> inside the forehead zone (above the eyelids,
    // outside the brows) any clearly non-skin pixel near the hair is treated as hair too, so the old fringe doesn't ghost through
    let fore = null, prot = null;
    if (inOval && P.brows && P.eyes) { // brows + eyes are never "hair" (dark thick brows are often half-segmented as hair)
      ensure(occC, w, h); occX.clearRect(0, 0, w, h); occX.fillStyle = '#fff';
      const fw = Math.hypot(P.eR.x - P.eL.x, P.eR.y - P.eL.y) / segScaleX, rb = Math.max(2, fw * 0.045), re = Math.max(1.5, fw * 0.028);
      for (const q of P.eyes) { occX.beginPath(); occX.arc(q.x / segScaleX, q.y / segScaleY, re, 0, 7); occX.fill(); }
      const pd = occX.getImageData(0, 0, w, h).data; prot = new Float32Array(w * h); for (let i = 0; i < w * h; i++) prot[i] = pd[i * 4 + 3] / 255;
      const pb = boxBlur(prot, w, h, Math.max(1, Math.round(fw / 40))); for (let i = 0; i < w * h; i++) prot[i] = clamp(pb[i] * 1.6, 0, 1);
      // brows: only shielded from the colour-based forehead cleanup (narrow), not from the segmenter
      // brows: brow-shaped polygons (upper contour + lower contour) are kept from the original photo
      occX.clearRect(0, 0, w, h); occX.filter = `blur(${Math.max(0.5, fw / 160)}px)`;
      for (const k of [0, 10]) { const B = P.brows.slice(k, k + 10); occX.beginPath(); [...B.slice(0, 5), ...B.slice(5).reverse()].forEach((q, i) => { const x = q.x / segScaleX, y = q.y / segScaleY; i ? occX.lineTo(x, y) : occX.moveTo(x, y); }); occX.closePath(); occX.fill(); }
      occX.filter = 'none';
      const bdd = occX.getImageData(0, 0, w, h).data; var browP = new Float32Array(w * h); for (let i = 0; i < w * h; i++) { const bv = bdd[i * 4 + 3] / 255; browP[i] = Math.max(prot[i], bv); prot[i] = Math.max(prot[i], bv); }
    }
    if (inOval && skin && prot && P.lids) {
      fore = new Float32Array(w * h);
      // v23: only a narrow band under the segmented hair (the old w/18 reach covered whole foreheads), and only pixels that look like
      // HAIR (grey / clearly dark / yellowish), not merely shaded skin: forehead lines and sunlit skin used to be erased and refilled
      // with flat push-pull skin -> a lighter boxy patch between the brows and the new hairline
      const lidY = Math.max(...P.lids.map((q) => q.y)) / segScaleY, br = 0, fw2 = Math.hypot(P.eR.x - P.eL.x, P.eR.y - P.eL.y) / segScaleX;
      const near = boxBlur(raw, w, h, Math.max(2, Math.round(fw2 * 0.06))), nearW = boxBlur(raw, w, h, Math.max(3, Math.round(w / 18))); // narrow / old wide reach
      const sL = lumOf(skin), sSum = skin[0] + skin[1] + skin[2] + 1, sRB = (skin[0] - skin[2]) / (sL + 1), sG = skin[1] / sSum;
      // orientation: fringe strands hang vertically (strong horizontal gradient), forehead lines / creases run horizontally
      const Lg = new Float32Array(w * h); for (let i = 0; i < w * h; i++) { const j = i * 4; Lg[i] = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]; }
      const Gx = new Float32Array(w * h), Gy = new Float32Array(w * h);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; Gx[i] = Math.abs(Lg[i + 1] - Lg[i - 1]); Gy[i] = Math.abs(Lg[i + w] - Lg[i - w]); }
      const rG = Math.max(1, Math.round(fw2 * 0.025)), Gxb = boxBlur(Gx, w, h, rG), Gyb = boxBlur(Gy, w, h, rG), oldC = new Float32Array(w * h), vertC = new Float32Array(w * h);
      for (let y = 0; y < Math.min(h, Math.floor(lidY - br * 0.2)); y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; if (!inOval[i] || browP[i] > 0.25 || nearW[i] < 0.06) continue;
        const j = i * 4, L = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2], sum = px[j] + px[j + 1] + px[j + 2] + 1;
        const grey = clamp((sRB - (px[j] - px[j + 2]) / (L + 1) - 0.1) / 0.1, 0, 1), dark = clamp(((sL - L) / sL - 0.3) / 0.15, 0, 1), yel = clamp((px[j + 1] / sum - sG - 0.025) / 0.025, 0, 1);
        // grey / clearly dark / yellowish pixels right under the hair; very dark ones (dark bangs on fair skin) anywhere in reach
        const vdark = clamp(((sL - L) / sL - 0.42) / 0.12, 0, 1);
        const dc = Math.abs(px[j] - skin[0]) + Math.abs(px[j + 1] - skin[1]) + Math.abs(px[j + 2] - skin[2]), dl = sL - L;
        oldC[i] = clamp((Math.max(dc - 45, dl * 2 - 30)) / 45, 0, 1) * clamp((lidY - y) / Math.max(2, fw2 * 0.07), 0, 1); // the v18 wide colour rule
        fore[i] = Math.max(Math.max(grey, dark, yel) * clamp((near[i] - 0.1) / 0.15, 0, 1), vdark) * clamp((lidY - y) / Math.max(2, fw2 * 0.07), 0, 1);
      }
      // the old wide colour rule (v18) only on strand texture: more horizontal gradient (vertical strands of a fringe) than vertical
      // gradient (horizontal forehead lines / creases), and some structure at all (smooth lit skin is never "hair"); its spread
      // then covers the skin between the strands
      for (let i = 0; i < w * h; i++) vertC[i] = oldC[i] * clamp((Gxb[i] - 0.78 * Gyb[i] - 1.8) / 3.5, 0, 1);
      const fbv = boxBlur(vertC, w, h, Math.max(1, Math.round(w / 160)));
      for (let i = 0; i < w * h; i++) fore[i] = Math.max(fore[i], clamp(Math.max(vertC[i], fbv[i] * 2.2), 0, 1));
      const fb = boxBlur(fore, w, h, Math.max(1, Math.round(w / 200))); for (let i = 0; i < w * h; i++) fore[i] = clamp(Math.max(fore[i], fb[i] * 1.6), 0, 1);
    }
    const skinY = skin ? lumOf(skin) : 0, skinCr = skin ? [skin[0] / (skin[0] + skin[1] + skin[2] + 1), skin[1] / (skin[0] + skin[1] + skin[2] + 1)] : null;
    // below the brows the (blurry) segmenter bleeds onto real skin -> only remove confident hair there
    const browLowY = P && P.brows ? [...P.brows.slice(5, 10), ...P.brows.slice(15, 20)].reduce((s2, q) => s2 + q.y, 0) / 10 / segScaleY : 1e9;
    const known = new Float32Array(w * h), knownSkin = new Float32Array(w * h), hole = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      let hv = inOval && inOval[i] ? (Math.floor(i / w) > browLowY ? clamp(raw[i] * 2.6 - 1.0, 0, 1) : clamp(raw[i] * 3.5 - 0.45, 0, 1)) : clamp(dil[i] * 3.2 - 0.15, 0, 1);
      if (fore && fore[i] > hv && !S.dbgNoFore) hv = fore[i];
      if (prot && inOval[i]) hv *= 1 - prot[i];
      if (skin && faceOnly && inOval[i] && !faceOnly[i] && hv < 1) { // cap above the face oval: anything not clearly skin (faint hair edges) is replaced
        const j = i * 4, d = Math.abs(px[j] - skin[0]) + Math.abs(px[j + 1] - skin[1]) + Math.abs(px[j + 2] - skin[2]);
        hv = Math.max(hv, clamp((d - 40) / 40, 0, 1));
      }
      hole[i] = hv;
      known[i] = hv > 0.05 || (inOval && inOval[i]) ? 0 : 1; // background/clothes only
      if (hv < 0.05 && faceOnly && faceOnly[i]) { // skin-coloured pixels only (no brows/eyes/lips); real face only (the cap above may hold wall/background)
        if (!skin) knownSkin[i] = 1; else if (!(prot && prot[i] > 0.2)) { // skin by chromaticity (lighting-independent) + a luminance window (no brows/lashes/shadows)
          const j = i * 4, sum = px[j] + px[j + 1] + px[j + 2] + 1, Ly = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];
          const dc = Math.abs(px[j] / sum - skinCr[0]) + Math.abs(px[j + 1] / sum - skinCr[1]);
          knownSkin[i] = dc < 0.07 && Ly > skinY * 0.62 && Ly < Math.min(250, skinY * 1.9) ? 1 : 0; }
      }
    }
    if (aff && out.hairline != null) { // around the customer's own hairline thin remnant strands get only a partial hole value and ghost
      // through under the new hair edge -> make the hole decisive there
      const IA2 = invAffine({ a: aff.a / segScaleX, b: aff.b / segScaleY, c: aff.c / segScaleX, d: aff.d / segScaleY, e: aff.e / segScaleX, f: aff.f / segScaleY }), h0 = out.hairline;
      for (let i = 0; i < w * h; i++) { const hv = hole[i]; if (hv < 0.1 || hv >= 1) continue; const x = i % w, y = (i - x) / w, cy = IA2.b * x + IA2.d * y + IA2.f;
        if (cy > h0 - 0.1 && cy < h0 + 0.25) hole[i] = Math.min(1, hv * (1 + 1.4 * clamp(1 - Math.abs(cy - (h0 + 0.07)) / 0.18, 0, 1))); }
      // wispy grey / dark strand tips just below the segmented hair get no hole at all (low segmenter confidence) and stayed as a dark
      // smudge between the new hairline and the brows: grow the hole a few px onto pixels that don't look like skin, in that band only
      { let Ls = []; for (let i = 0; i < w * h; i += 3) if ((faceOnly ? faceOnly[i] : 1) && hole[i] < 0.02) { const j = i * 4; Ls.push(0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]); }
        Ls.sort((p, q) => p - q); const Lr = Ls.length ? Ls[Math.floor(Ls.length * 0.6)] : 0; Ls = null;
        const rd = Math.max(1, Math.round(w / 90)), T = new Float32Array(w * h), D = new Float32Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = -rd; k <= rd; k++) { const xx = x + k; if (xx >= 0 && xx < w) m = Math.max(m, hole[y * w + xx]); } T[y * w + x] = m; }
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = -rd; k <= rd; k++) { const yy = y + k; if (yy >= 0 && yy < h) m = Math.max(m, T[yy * w + x]); } D[y * w + x] = m; }
        if (Lr > 0) for (let i = 0; i < w * h; i++) { if (D[i] <= hole[i]) continue; const x = i % w, y = (i - x) / w, cy = IA2.b * x + IA2.d * y + IA2.f, cx = IA2.a * x + IA2.c * y + IA2.e;
          if (cy < h0 - 0.12 || cy > Math.min(h0 + 0.2, -0.66) || Math.abs(cx) > 0.8) continue; const j = i * 4, L = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];
          const ns = Math.max(clamp((0.86 * Lr - L) / (0.18 * Lr), 0, 1), clamp((0.08 * L - (px[j] - px[j + 2])) / (0.06 * L + 1), 0, 1)); // darker than skin, or grey
          if (ns > 0) hole[i] = Math.max(hole[i], D[i] * ns); } }
      // v23: close the hole along the customer's hairline (dilate then erode): wispy strands only partly segmented left a speckled
      // edge that showed through as original grey/dark hair under the new hairline
      if (!S.dbgNoClose) { const rc2 = Math.max(1, Math.round(w / 120)), band = (i) => { const x = i % w, y = (i - x) / w, cy = IA2.b * x + IA2.d * y + IA2.f, cx = IA2.a * x + IA2.c * y + IA2.e; return cy > h0 - 0.25 && cy < Math.min(h0 + 0.3, -0.62) && Math.abs(cx) < 0.95; };
        // soft (blur-based) closing: round shapes, no square steps
        const D2 = boxBlur(hole, w, h, rc2); for (let i = 0; i < w * h; i++) D2[i] = 1 - clamp(D2[i] * 2.2, 0, 1);
        const E2 = boxBlur(D2, w, h, rc2);
        for (let i = 0; i < w * h; i++) { const v = clamp(1 - E2[i] * 2.2, 0, 1); if (v > hole[i] && inOval && inOval[i] && !(prot && prot[i] > 0.3) && band(i)) hole[i] = v; }
        // isolated partial-hole dots (single pores flagged as strand tips) dithered the fill -> smooth the partial values in the band
        const Sm = boxBlur(hole, w, h, Math.max(1, Math.round(rc2 / 2)));
        for (let i = 0; i < w * h; i++) if (hole[i] < 0.5 && inOval && inOval[i] && band(i)) hole[i] = Math.min(hole[i], Sm[i] * 1.15) * 0.5 + Math.min(Sm[i], 0.5) * 0.5; } // confident (thin) strands stay fully removed
    }
    if (aff) { // per-column lower edge of the synthesized (hole) area across the forehead: the new hair must reach it (no fill band)
      const hp = new Float32Array(13).fill(NaN);
      for (let q = 0; q < 13; q++) { const cx = -0.72 + q * 0.12;
        for (let cy = -0.5; cy > -1.8; cy -= 0.015) { const X = Math.round((aff.a * cx + aff.c * cy + aff.e) / segScaleX), Y = Math.round((aff.b * cx + aff.d * cy + aff.f) / segScaleY);
          if (X < 0 || Y < 0 || X >= w || Y >= h) break; if (hole[Y * w + X] > 0.5) { hp[q] = cy; break; } } }
      if (prev && prev.holeProf) for (let q = 0; q < 13; q++) if (hp[q] === hp[q] && prev.holeProf[q] === prev.holeProf[q] && Math.abs(hp[q] - prev.holeProf[q]) < 0.2) hp[q] = prev.holeProf[q] * 0.5 + hp[q] * 0.5;
      out.holeProf = hp;
      // colour of the real skin just BELOW the synthesized area (what the fill must continue seamlessly; the mid-forehead average is lighter)
      // skin-likeness: a reference luminance from the mid face, then reject pixels that are much darker or grey (thin grey/dark hair
      // remnants the segmenter missed near the customer's hairline used to drag the reference down -> dark bands / blocks in the fill)
      let Lref = 0; { const ls = []; for (let i = 0; i < w * h; i += 3) if (knownSkin[i] && hole[i] <= 0.02) { const j = i * 4; ls.push(0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]); }
        ls.sort((p, q) => p - q); Lref = ls.length ? ls[Math.floor(ls.length * 0.6)] : 0; }
      const skinLike = (j) => { const L = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]; return L > 0.72 * Lref && px[j] - px[j + 2] > 0.06 * L; };
      let r = 0, g = 0, b = 0, n = 0;
      for (let q = 0; q < 13; q++) { if (hp[q] !== hp[q]) continue; const cx = -0.72 + q * 0.12;
        for (let cy = hp[q] + 0.03; cy < hp[q] + 0.12; cy += 0.01) for (const dx of [-0.04, 0, 0.04]) {
          const X = Math.round((aff.a * (cx + dx) + aff.c * cy + aff.e) / segScaleX), Y = Math.round((aff.b * (cx + dx) + aff.d * cy + aff.f) / segScaleY);
          if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const i = Y * w + X; if (hole[i] > 0.02 || !knownSkin[i]) continue; const j = i * 4; if (!skinLike(j)) continue; r += px[j]; g += px[j + 1]; b += px[j + 2]; n++; } }
      out.edgeRGB = n > 15 ? [r / n, g / n, b / n] : null;
      // per-height reference: mean real forehead skin per 0.02 band of cy (rows with none take the nearest band BELOW), so the fill
      // continues the forehead's own vertical shading and matches the real skin next to it at the same height
      const IA3 = invAffine({ a: aff.a / segScaleX, b: aff.b / segScaleY, c: aff.c / segScaleX, d: aff.d / segScaleY, e: aff.e / segScaleX, f: aff.f / segScaleY });
      // three lateral zones (left temple / centre / right temple): the centre is usually the brightest (frontal highlight) and must
      // not be what the temples are filled with
      const NB = 50, acc = new Float32Array(3 * NB * 4), zoneOf = (cx) => (cx < -0.28 ? 0 : cx > 0.28 ? 2 : 1);
      for (let i = 0; i < w * h; i++) { if (!knownSkin[i] || hole[i] > 0.02) continue; const x = i % w, y = (i - x) / w, cx = IA3.a * x + IA3.c * y + IA3.e, cy = IA3.b * x + IA3.d * y + IA3.f;
        if (Math.abs(cx) > 0.85 || cy < -1.6 || cy >= -0.6) continue; const k = (zoneOf(cx) * NB + Math.floor((cy + 1.6) / 0.02)) * 4, j = i * 4; if (!skinLike(j)) continue; acc[k] += px[j]; acc[k + 1] += px[j + 1]; acc[k + 2] += px[j + 2]; acc[k + 3]++; }
      // count-weighted smoothing over +-4 bands (single noisy bands showed as horizontal steps), then rows with too few samples take
      // the nearest smoothed band below
      const rows = [0, 1, 2].map((z) => { const r = new Array(NB).fill(null); let last = null;
        for (let k = NB - 1; k >= 0; k--) { let sr = 0, sg = 0, sb = 0, sn = 0, own = acc[(z * NB + k) * 4 + 3];
          for (let d = -4; d <= 4; d++) { const kk = k + d; if (kk < 0 || kk >= NB) continue; const q = (z * NB + kk) * 4, wgt = 1 - Math.abs(d) / 5; sr += acc[q] * wgt; sg += acc[q + 1] * wgt; sb += acc[q + 2] * wgt; sn += acc[q + 3] * wgt; }
          if (own >= 4 && sn >= 20) last = [sr / sn, sg / sn, sb / sn]; r[k] = last; } return r; });
      for (const z of [0, 2]) for (let k = 0; k < NB; k++) if (!rows[z][k]) rows[z][k] = rows[1][k];
      out.rowRGB = rows[1].some(Boolean) ? rows : null; out.zoneOf = zoneOf;
    }
    let seedSkin = knownSkin;
    if (inOval && skin && !S.dbgNoSeed) { // v23: the push-pull fill is seeded by the real pixels at its edge; right under the old hairline those are often
      // a crease / leftover wisps / the hair's own shadow -> smeared upward they became a dark band along the fill edge. Seed only from
      // pixels that are not darker than the local skin around them
      const r0 = Math.max(2, Math.round(w / 64)), Lk = new Float32Array(w * h), Kk = new Float32Array(w * h), Hb = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) { const j = i * 4; Kk[i] = knownSkin[i]; Lk[i] = knownSkin[i] * (0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]); Hb[i] = hole[i] > 0.5 ? 1 : 0; }
      const Lkb = boxBlur(Lk, w, h, r0 * 2), Kkb = boxBlur(Kk, w, h, r0 * 2), nearH = boxBlur(Hb, w, h, r0);
      seedSkin = new Float32Array(knownSkin);
      for (let i = 0; i < w * h; i++) { if (!knownSkin[i] || nearH[i] <= 0.001 || Kkb[i] < 0.05) continue; const j = i * 4, L = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2], loc = Lkb[i] / Kkb[i];
        if (L < loc * 0.9) { seedSkin[i] = 0;
          // ... and dark wisps touching the hole above the brows join it softly (left alone they outlined the fill edge as a thin dark line)
          if (Math.floor(i / w) < browLowY && !(prot && prot[i] > 0.2) && nearH[i] > 0.12) hole[i] = Math.max(hole[i], clamp((loc * 0.9 - L) / (loc * 0.12), 0, 1) * clamp((nearH[i] - 0.12) / 0.25, 0, 1)); } }
    }
    const filled = pushPull(px, w, h, known), skinFill = inOval ? pushPull(px, w, h, seedSkin) : null;
    // background: mirror the texture from just outside each hole run (keeps wall/clothes texture), blended with the smooth fill
    const refl = new Float32Array(filled);
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        const i0 = y * w + x;
        if (!(hole[i0] > 0.05 && !(inOval && inOval[i0]))) { x++; continue; }
        let e = x; while (e + 1 < w && hole[y * w + e + 1] > 0.05 && !(inOval && inOval[y * w + e + 1])) e++;
        const lk = x > 0 && known[y * w + x - 1] > 0, rk = e + 1 < w && known[y * w + e + 1] > 0;
        for (let xx = x; xx <= e; xx++) {
          let src = -1;
          if (lk && (!rk || xx - x <= e - xx)) src = x - 1 - (xx - x); else if (rk) src = e + 1 + (e - xx);
          if (src >= 0 && src < w && known[y * w + src] > 0) { const k = y * w + xx, j = (y * w + src) * 4; refl[k * 3] = px[j] * 0.7 + filled[k * 3] * 0.3; refl[k * 3 + 1] = px[j + 1] * 0.7 + filled[k * 3 + 1] * 0.3; refl[k * 3 + 2] = px[j + 2] * 0.7 + filled[k * 3 + 2] * 0.3; }
        }
        x = e + 1;
      }
    }
    let ovS = null; if (inOval) { const f = new Float32Array(w * h); for (let i = 0; i < w * h; i++) f[i] = inOval[i]; ovS = boxBlur(boxBlur(f, w, h, Math.max(2, Math.round(w / 40))), w, h, Math.max(2, Math.round(w / 40))); }
    const fid = new ImageData(w, h), hb = boxBlur(hole, w, h, Math.max(2, Math.round(w / 50))); // blurred hole ~ distance from the fill boundary
    // synthesized forehead skin isn't flat: soft frontal highlight in the middle, slight falloff toward the temples/hairline
    let fcx = 0, fcy = 0, frx = 1, fry = 1;
    if (aff) { fcx = (aff.c * -0.7 + aff.e) / segScaleX; fcy = (aff.d * -0.7 + aff.f) / segScaleY; frx = Math.hypot(aff.a, aff.b) / segScaleX * 0.75; fry = Math.hypot(aff.c, aff.d) / segScaleY * 0.5; }
    // forehead skin tone (upper forehead, real skin only): the cap above the landmark oval continues this tone instead of a muddy average
    let fhRGB = null, IA = null; const upH = aff ? new ImageData(w, h) : null;
    if (aff && skinFill) {
      IA = invAffine({ a: aff.a / segScaleX, b: aff.b / segScaleY, c: aff.c / segScaleX, d: aff.d / segScaleY, e: aff.e / segScaleX, f: aff.f / segScaleY });
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!knownSkin[i]) continue; const cx = IA.a * x + IA.c * y + IA.e, cy = IA.b * x + IA.d * y + IA.f;
        if (cy < -0.6 && cy > -1.1 && Math.abs(cx) < 0.55) { const j = i * 4; r += px[j]; g += px[j + 1]; b += px[j + 2]; n++; } }
      if (n > 12) fhRGB = [r / n, g / n, b / n]; if (out.edgeRGB) fhRGB = out.edgeRGB; out.fhRGB = fhRGB; out.fhN = n; { let c1 = 0, c2 = 0, c3 = 0, c4 = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x, cx = IA.a * x + IA.c * y + IA.e, cy = IA.b * x + IA.d * y + IA.f; if (cy < -0.6 && cy > -1.1 && Math.abs(cx) < 0.55) { c1++; if (faceOnly[i]) c2++; if (hole[i] < 0.05) c3++; if (knownSkin[i]) c4++; } } out.fhDbg = [c1, c2, c3, c4]; }
    }
    for (let i = 0; i < w * h; i++) {
      // skin path vs background path, blended by the blurred (oval + cap) weight: the cap polygon's straight sides no longer show as a
      // hard pale strip at the temples
      const ws = skinFill && ovS ? clamp((ovS[i] - 0.05) / 0.9, 0, 1) : (skinFill && inOval[i] ? 1 : 0), sk2 = ws > 0, src = sk2 ? skinFill : refl;
      let m = 1, R = src[i * 3], G = src[i * 3 + 1], B = src[i * 3 + 2], Rr = refl[i * 3], Gr = refl[i * 3 + 1], Br = refl[i * 3 + 2];
      if (sk2 && aff) { const dx = (i % w - fcx) / frx, dy = (Math.floor(i / w) - fcy) / fry, r2 = dx * dx + dy * dy; m = 1 + 0.03 * Math.exp(-r2 * 1.6) - 0.08 * Math.min(1, Math.max(0, r2 - 0.8)); }
      if (sk2 && fhRGB && hole[i] > 0.02) { // upper forehead / temples / cap: blend toward the forehead tone, very slightly darker toward the hair
        const x = i % w, y = (i - x) / w, cy = IA.b * x + IA.d * y + IA.f, t = clamp((-0.95 - cy) / 0.25, 0, 1);
        // continuous across the oval boundary (the old jump 0.6 -> 0.34 showed as blocky lighter patches at the temples)
        const k2 = (faceOnly[i] ? 0.8 * clamp((-0.4 - cy) / 0.3, 0, 1) : 0.8 + 0.15 * t) * clamp((hb[i] - 0.4) / 0.5, 0, 1); // continuous with the local real skin at the fill boundary
        const rr0 = out.rowRGB && rowRef(out.rowRGB, IA.a * x + IA.c * y + IA.e, cy), ref = rr0 ? [0.7 * rr0[0] + 0.3 * fhRGB[0], 0.7 * rr0[1] + 0.3 * fhRGB[1], 0.7 * rr0[2] + 0.3 * fhRGB[2]] : fhRGB;
        R = R * (1 - k2) + ref[0] * k2; G = G * (1 - k2) + ref[1] * k2; B = B * (1 - k2) + ref[2] * k2;
        { // chroma from the real skin at this height (the pushed-pull fill tends to grey out -> whitish/pale look next to real skin)
          const kc = 0.85 * clamp((hb[i] - 0.15) / 0.5, 0, 1), Lf = 0.299 * R + 0.587 * G + 0.114 * B, Lr = 0.299 * ref[0] + 0.587 * ref[1] + 0.114 * ref[2];
          R += (Lf + ref[0] - Lr - R) * kc; G += (Lf + ref[1] - Lr - G) * kc; B += (Lf + ref[2] - Lr - B) * kc; } m = Math.min(m, 1) * (1 - 0.05 * t) * (1 - 0.1 * clamp((Math.abs(IA.a * x + IA.c * y + IA.e) - 0.45) / 0.25, 0, 1) * clamp((hb[i] - 0.3) / 0.6, 0, 1)); // temples are darker than the forehead centre
        // well above the hairline the fill is scalp under the new hair: darker, so thin/parted template hair never shows a bright skin patch
        m *= 1 - (0.09 * clamp((-1.0 - cy) / 0.12, 0, 1) + 0.23 * clamp((-1.17 - cy) / 0.28, 0, 1)) * clamp((hb[i] - 0.3) / 0.6, 0, 1); // ramps in from the fill boundary (no step where the hole edge is blocky)
      }
      if (sk2 && fhRGB && hole[i] > 0.02 && faceOnly[i] && !S.dbgNoCap) { // v23: never brighter than the local interpolation of the neighbouring real skin
        // (the face-wide reference is the lit forehead centre -> temples / sides of the forehead turned into lighter flat patches)
        const Lp = 0.299 * skinFill[i * 3] + 0.587 * skinFill[i * 3 + 1] + 0.114 * skinFill[i * 3 + 2], Lc = (0.299 * R + 0.587 * G + 0.114 * B) * m, cap = Lp * 1.03 + 2;
        if (Lc > cap) { const f = cap / Lc, kb = clamp((hb[i] - 0.1) / 0.4, 0, 1), q = 1 - (1 - f) * kb; R *= q; G *= q; B *= q; }
        // chroma: drift back toward the local skin's own hue at the sides (the centre reference reads orange on shaded temples)
        const cxp = Math.abs(IA.a * (i % w) + IA.c * Math.floor(i / w) + IA.e), kh = 0.5 * clamp((cxp - 0.35) / 0.3, 0, 1) * clamp((hb[i] - 0.1) / 0.4, 0, 1);
        if (kh > 0) { const L2 = 0.299 * R + 0.587 * G + 0.114 * B, Lq = Lp + 0.01; R += (skinFill[i * 3] * L2 / Lq - R) * kh; G += (skinFill[i * 3 + 1] * L2 / Lq - G) * kh; B += (skinFill[i * 3 + 2] * L2 / Lq - B) * kh; }
      }
      if (ws < 1 && fhRGB && IA && hole[i] > 0.02) { // just outside the face at temples/cap: not the (often light) background but
        // dim temple skin, so translucent temple hair over it never shows a pale halo
        const x = i % w, y = (i - x) / w, cy = IA.b * x + IA.d * y + IA.f, cx = IA.a * x + IA.c * y + IA.e, wt = 0.75 * clamp((1.02 - Math.abs(cx)) / 0.2, 0, 1) * clamp((-0.3 - cy) / 0.2, 0, 1) * clamp((cy + 1.7) / 0.2, 0, 1);
        Rr = Rr * (1 - wt) + fhRGB[0] * 0.7 * wt; Gr = Gr * (1 - wt) + fhRGB[1] * 0.67 * wt; Br = Br * (1 - wt) + fhRGB[2] * 0.66 * wt;
      }
      if (sk2 && IA && !faceOnly[i]) { const x = i % w, y = (i - x) / w, cx = IA.a * x + IA.c * y + IA.e; m *= 1 - 0.14 * clamp((Math.abs(cx) - 0.62) / 0.25, 0, 1); } // outer temples: shadowed
      if (ws < 1) { R = R * m * ws + Rr * (1 - ws); G = G * m * ws + Gr * (1 - ws); B = B * m * ws + Br * (1 - ws); m = 1; }
      fid.data[i * 4] = R * m; fid.data[i * 4 + 1] = G * m; fid.data[i * 4 + 2] = B * m; fid.data[i * 4 + 3] = (ws * Math.max(hole[i] * 0.6 + hb[i] * 0.4, hole[i] * hb[i]) + (1 - ws) * hole[i]) * 255; // feathered edge on skin
      if (upH && IA && faceOnly[i]) { const x = i % w, y = (i - x) / w, cy = IA.b * x + IA.d * y + IA.f, cx = IA.a * x + IA.c * y + IA.e; upH.data[i * 4 + 3] = hb[i] * 255 * clamp((-0.35 - cy) / 0.2, 0, 1) * clamp((Math.abs(cx) - 0.5) / 0.15, 0, 1); }
    }
    // v23: the push-pull fill is flat, so next to real (lined, pored) forehead skin it read as a smooth lighter patch. Continue the real
    // skin's fine luminance detail into the fill: per column, mirror (ping-pong) the high-pass of the real-skin strip just below the
    // fill's lower edge, fading out higher up (under the new hair)
    if (IA && inOval && !S.dbgNoTex && S.mode === 'still') { // stills only (live masks are 256 px: no pore detail to carry, and it costs per frame)
      const Lm = new Float32Array(w * h); for (let i = 0; i < w * h; i++) { const j = i * 4; Lm[i] = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]; }
      const Lb = boxBlur(Lm, w, h, Math.max(1, Math.round(w / 220))), per = Math.max(4, Math.round(Math.hypot(IA.b, IA.d) ? 0.1 / Math.hypot(IA.b, IA.d) : 8));
      const lidY2 = P.lids ? Math.max(...P.lids.map((q) => q.y)) / segScaleY : h;
      for (let x = 0; x < w; x++) {
        let yb = -1; for (let y = Math.min(h - 1, Math.floor(lidY2)); y >= 0; y--) { const i = y * w + x; if (inOval[i] && hole[i] > 0.5) { yb = y; break; } }
        if (yb < 0) continue;
        let y0 = yb + 1; while (y0 < h && y0 < yb + per && (hole[y0 * w + x] > 0.05 || !knownSkin[y0 * w + x])) y0++; // first real-skin row below the edge
        let n = 0; for (let y = y0; y < Math.min(h, y0 + per); y++) { const i = y * w + x; if (hole[i] > 0.05 || !knownSkin[i] || (prot && prot[i] > 0.2)) break; n++; }
        if (n < 3) continue;
        for (let y = yb; y >= 0; y--) { const i = y * w + x, a = fid.data[i * 4 + 3] / 255; if (a < 0.02 || !inOval[i]) { if (y < yb - per * 6) break; continue; }
          const d = yb - y, ph = d % (2 * n), sy = y0 + (ph < n ? ph : 2 * n - 1 - ph), si = sy * w + x, dr = Lm[si] - Lb[si], lim = (dr > 0 ? 0.018 : 0.045) * Lb[si] + 1, dt = lim * Math.tanh(dr / lim) * clamp(1 - d / (per * 5), 0.35, 1); // pore-level only (a mirrored crease read as a dark band; bright highlights / sweat would repeat as specks)
          for (let c = 0; c < 3; c++) fid.data[i * 4 + c] = fid.data[i * 4 + c] + dt * (fid.data[i * 4 + c] / (Lb[si] + 1)) ; }
      }
    }
    out.upHole = upH; // synthesized (formerly hair-covered) skin inside the upper face oval: the new hair may show there
    out.fill = fid;
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

/* ------------------------------------------------------------------ hairstyle templates */
const styleCache = {}, colorCache = {};
let origHex = null;
// photoreal hair templates (assets/hair/*.png: R=luminance, G=front weight, A=alpha, canonical space at half res)
let HAIRP = null; const photoCache = {};
fetch(new URL('./assets/hair/hair.json', import.meta.url)).then((r) => r.json()).then((j) => { HAIRP = j; renderStyles(); rerender(); }).catch(() => {});

/* ------------------------------------------------------------------ natural hairline (precomputed once per photo template) */
// The templates end in a smooth, softly faded arc. Real hairlines are irregular (small widow's peak, temple recession),
// thin out over a few % of the face height as individual strands, show darker roots with bits of scalp between them and
// have fine baby hairs crossing onto the forehead. All of it is baked into the template layers once (cheap on lite: no
// per-frame work except one quarter-res shadow draw).
const hsh = (n) => { let x = (Math.imul(n | 0, 374761393) + 668265263) >>> 0; x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
function seedRnd(str) { let s0 = 7; for (const ch of str) s0 = (Math.imul(s0, 31) + ch.charCodeAt(0)) >>> 0; let sd = s0 % 2147483646 + 1; return () => (sd = (sd * 16807) % 2147483647) / 2147483647; }
// smooth 1D value noise in [0,1] (strand clumps without per-column comb teeth)
function vnoise(x, s) { const i = Math.floor(x), f = x - i, w = f * f * (3 - 2 * f); return hsh(i * 31 + s) * (1 - w) + hsh((i + 1) * 31 + s) * w; }
function naturalizeHairline(src, bk, fr, TW, TH, sid, hl, male) {
  const ppu = TW / 6, toV = (cy) => (cy + 2.8) * ppu, toU = (cx) => (cx + 3) * ppu, rnd = seedRnd(sid);
  const u0 = Math.max(1, Math.floor(toU(-1.05))), u1 = Math.min(TW - 2, Math.ceil(toU(1.05)));
  const vLo = Math.min(TH - 1, Math.round(toV(-0.55))), vHi = Math.max(0, Math.round(toV(-1.95))), hlv = toV(hl);
  // 1) the template's own front edge per column: first dense row scanning up from the forehead (open-forehead part only)
  const E = new Float32Array(TW).fill(NaN);
  for (let u = u0; u <= u1; u++) for (let v = vLo; v >= vHi; v--) if (src[(v * TW + u) * 4 + 3] > 128) { if (v > hlv - 0.4 * ppu && v < hlv + 0.3 * ppu) E[u] = v; break; }
  const r = Math.max(1, Math.round(0.12 * ppu)), Es = new Float32Array(TW).fill(NaN);
  { // part lines / gaps: columns without a dense edge near the hairline take the contour interpolated from their neighbours
    let pu = -1;
    for (let u = u0; u <= u1; u++) if (E[u] === E[u]) { if (pu >= 0 && u - pu > 1 && u - pu < 0.45 * ppu) for (let q = pu + 1; q < u; q++) E[q] = E[pu] + (E[u] - E[pu]) * (q - pu) / (u - pu); pu = u; }
  }
  // heavy smoothing (2 passes): ledges in the template's own edge must not become steps in the new hairline; the organic shape comes from off()
  { let S0 = E; for (let pass = 0; pass < 2; pass++) { const D = new Float32Array(TW).fill(NaN);
      for (let u = u0; u <= u1; u++) { if (E[u] !== E[u]) continue; let sm = 0, n = 0; for (let k = -r; k <= r; k++) { const e = S0[u + k]; if (e === e && e !== undefined) { sm += e; n++; } } D[u] = sm / n; }
      S0 = D; } Es.set(S0); }
  // 2) organic contour (canonical units, + = down onto the forehead): two wavelengths of irregularity, a small widow's peak,
  //    temple recession (stronger on men's styles); seeded per style so every template has its own shape
  const ph1 = rnd() * 7, ph2 = rnd() * 7, ph3 = rnd() * 7, peak = male ? 0.006 + rnd() * 0.012 : 0.012 + rnd() * 0.018, rec = male ? 0.035 + rnd() * 0.025 : 0.012 + rnd() * 0.014;
  const off = (cx) => 0.01 * Math.sin(cx / 0.37 * 6.283 + ph1) + 0.005 * Math.sin(cx / 0.13 * 6.283 + ph2) + 0.0025 * Math.sin(cx / 0.045 * 6.283 + ph3)
    + peak * Math.exp(-((cx / 0.085) ** 2)) - rec * Math.exp(-(((Math.abs(cx) - 0.62) / 0.13) ** 2));
  const band = (male ? 0.048 : 0.07) * ppu, tip = (male ? 0.012 : 0.018) * ppu, taper = Math.max(2.5, 0.05 * ppu), cont = new Float32Array(TW).fill(NaN);
  // per-column strength: ramps in over ~0.08 units from both ends of each processed run, so the edit never ends in a vertical cut
  // next to unprocessed columns (e.g. long side hair hanging below the detection window)
  const wc = new Float32Array(TW), ramp = 0.08 * ppu;
  for (let u = u0; u <= u1; u++) { if (Es[u] !== Es[u]) continue; let a = u; while (a > u0 && Es[a - 1] === Es[a - 1]) a--; let b = u; while (b < u1 && Es[b + 1] === Es[b + 1]) b++;
    for (let q = a; q <= b; q++) wc[q] = clamp(Math.min(q - a, b - q) / ramp, 0, 1); u = b; }
  for (let u = u0; u <= u1; u++) {
    const e0 = Es[u]; if (e0 !== e0) continue; const wu = wc[u]; let er = E[u] === E[u] ? E[u] : e0; // er: this column's real template edge
    // ... moved up to the first DENSE row: the template's soft edge pixels must not be mirrored into the extension (they left a
    // semi-transparent, lighter seam inside the new hair = the pale rim)
    let erD = er; { const lim = Math.max(0, Math.floor(er - 0.1 * ppu)); let v = Math.floor(er); while (v > lim && src[(v * TW + u) * 4 + 3] < 230) v--; erD = v; }
    const cx = -3 + (u + 0.5) / ppu, e = e0 + off(cx) * ppu + 0.55 * band; cont[u] = e; // feather OUTWARD onto the forehead (eating into the dense hair would reveal the cap fill)
    // strand reach: per-column variation + clumps of 2-4 columns -> a fringe of strands of different length, not a fade
    // smooth incommensurate sines (value noise with smoothstep gave flat plateaus + steep sides = castellated edge)
    const reach = 0.5 + 0.22 * Math.sin(cx * 61 + ph1) + 0.16 * Math.sin(cx * 143 + ph2) + 0.12 * Math.sin(cx * 311 + ph3);
    const vEnd = e - 0.3 * band + reach * (0.3 * band + tip) + 0.5 * taper; // long soft taper -> wisps fade out instead of blunt steps
    const vTop = Math.max(0, Math.floor(e - band - 1)), vBot = Math.min(TH - 1, Math.ceil(Math.max(e + tip, er) + 2));
    for (let v = Math.floor(erD) + 1; v <= Math.min(vBot, vEnd + 1); v++) { // below the dense edge (soft band + peak / notch extension): hair colour from
      // the soft edge itself (mirrored below it), alpha raised to dense -> no see-through seam, no dark copied root blocks
      const i = (v * TW + u) * 4, j = v <= er ? i : (Math.max(0, Math.round(2 * er - v - 1)) * TW + u) * 4;
      const ca = bk.data[i + 3] + fr.data[i + 3], sa = bk.data[j + 3] + fr.data[j + 3], tgt = Math.max(ca, (235 * wu + ca * (1 - wu))); if (tgt <= ca + 1) continue;
      const fb = sa > 4 ? bk.data[j + 3] / sa : 0.5;
      for (const [L, f] of [[bk, fb], [fr, 1 - fb]]) { const d = L.data; d[i] = sa > 4 ? d[j] : d[i]; d[i + 1] = 128; d[i + 3] = tgt * f; }
    }
    for (let v = vTop; v <= vBot; v++) {
      const dd = (v - (e - band)) / band; if (dd <= 0) continue; // 0 = dense hair, 1 = contour
      const i = (v * TW + u) * 4;
      const m = 1 - wu * (1 - clamp((vEnd - v) / taper, 0, 1) * (1 - 0.45 * Math.min(1, dd) ** 1.5));
      const rt = dd < 0.75 ? 1 - 0.07 * Math.sin(Math.PI * dd / 0.75) : 0.9; // tips: no light matte halo // slightly darker roots inside the dense hair only
      for (const L of [bk, fr]) { const d = L.data; if (!d[i + 3]) continue; d[i + 3] *= m; d[i] *= rt; }
    }
  }
  // 3) underpaint: part lines / thin strands inside the hair mass (between the top of the hair and the hairline contour) must not
  //    expose the customer's skin (reads as a bright patch with the hair floating over it) -> back-layer hair at >= ~0.8
  for (let u = u0; u <= u1; u++) {
    const e = cont[u]; if (e !== e) continue;
    let vt = -1; for (let v = 0; v < e; v++) if (src[(v * TW + u) * 4 + 3] > 150) { vt = v; break; }
    if (vt < 0) continue;
    let Lr = -1; const vb = Math.floor(e - band);
    for (let v = vt; v <= vb; v++) {
      const i = (v * TW + u) * 4, a = src[i + 3];
      if (a > 150) Lr = Lr < 0 ? src[i] : Lr * 0.9 + src[i] * 0.1;
      const tot = bk.data[i + 3] + fr.data[i + 3], need = 205 * clamp((vb - v) / (0.03 * ppu), 0, 1);
      if (tot < need && Lr >= 0) { const d = bk.data; d[i] = (d[i] * d[i + 3] + Lr * 0.85 * (need - tot)) / (d[i + 3] + need - tot); d[i + 1] = 128; d[i + 3] += need - tot; }
    }
  }
  // 4) anti-alias the new edge: premultiplied separable box blur (2 passes) of alpha + luminance in the hairline band only,
  //    so the low-res lite template upscales to a soft continuous edge instead of per-column stair steps
  let vMin = TH, vMax = 0; for (let u = u0; u <= u1; u++) { const e = cont[u]; if (e === e) { vMin = Math.min(vMin, e - band); vMax = Math.max(vMax, e + tip); } }
  if (vMax > vMin) {
    const ya = Math.max(1, Math.floor(vMin - 6)), yb = Math.min(TH - 2, Math.ceil(vMax + 6)), xa = Math.max(1, u0 - 4), xb = Math.min(TW - 2, u1 + 4), bw = xb - xa + 1, bh = yb - ya + 1;
    const rr = Math.max(1, Math.round(0.012 * ppu));
    for (const L of [bk, fr]) {
      const d = L.data, A = new Float32Array(bw * bh), C = new Float32Array(bw * bh), T1 = new Float32Array(bw * bh), T2 = new Float32Array(bw * bh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const i = ((y + ya) * TW + x + xa) * 4; A[y * bw + x] = d[i + 3]; C[y * bw + x] = d[i] * d[i + 3]; }
      for (let pass = 0; pass < 2; pass++) for (const [S1, S2] of [[A, T1], [C, T2]]) {
        for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { let sm = 0, n = 0; for (let k = -rr; k <= rr; k++) { const xx = x + k; if (xx >= 0 && xx < bw) { sm += S1[y * bw + xx]; n++; } } S2[y * bw + x] = sm / n; }
        for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { let sm = 0, n = 0; for (let k = -rr; k <= rr; k++) { const yy = y + k; if (yy >= 0 && yy < bh) { sm += S2[yy * bw + x]; n++; } } S1[y * bw + x] = sm / n; }
      }
      // blend in only near the edge rows (vertical weight), so the hair body keeps its strand detail
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const u = x + xa, v = y + ya, e = cont[u]; if (e !== e) continue;
        const wgt = clamp(1 - Math.abs(v - (e - band * 0.3)) / (band * 0.9 + 4), 0, 1); if (!wgt) continue;
        const i = (v * TW + u) * 4, a2 = A[y * bw + x], c2 = a2 > 0.5 ? C[y * bw + x] / a2 : d[i];
        const a0 = d[i + 3]; d[i + 3] = a0 * (1 - wgt) + a2 * wgt; if (d[i + 3] > 0.5) { const wc = (a2 * wgt) / (a0 * (1 - wgt) + a2 * wgt + 1e-3); d[i] = d[i] * (1 - wc) + c2 * wc; d[i + 1] = 128; } // colour weighted by alpha contribution (no dark fringe from empty pixels)
      }
    }
  }
  return cont;
}
function babyHairs(x, cont, TW, sid, male, lumAt) {
  const ppu = TW / 6, rnd = seedRnd(sid + '#bh'), n = male ? 18 : 45, k = TW / 1080;
  x.lineCap = 'round';
  for (let q = 0; q < n; q++) {
    let cx = (rnd() * 2 - 1) * 0.8; if (rnd() < 0.75) cx = (rnd() < 0.5 ? -1 : 1) * (0.4 + rnd() * 0.42); // denser toward the temples
    const u = Math.round((cx + 3) * ppu), e = cont[u]; if (e !== e) continue;
    const side = Math.abs(cx) > 0.32, len = (0.015 + rnd() * (side ? 0.05 : 0.025)) * ppu;
    const ang = Math.PI / 2 - Math.sign(cx) * (0.2 + Math.abs(cx) * 0.95) * (0.6 + rnd() * 0.7); // grows down + outward
    const x0 = u + (rnd() - 0.5) * 2, y0 = e - (0.004 + rnd() * 0.014) * ppu, x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
    const cu = (rnd() - 0.5) * len * 0.5, mx = (x0 + x1) / 2 - Math.sin(ang) * cu, my = (y0 + y1) / 2 + Math.cos(ang) * cu;
    const L = clamp(lumAt(u, Math.round(e - 0.04 * ppu)) * (0.8 + rnd() * 0.3), 10, 250);
    x.strokeStyle = `rgba(${L | 0},128,0,${(0.14 + rnd() * 0.22).toFixed(2)})`; x.lineWidth = Math.max(0.5, (0.3 + rnd() * 0.4) * 1.6 * k);
    x.beginPath(); x.moveTo(x0, y0); x.quadraticCurveTo(mx, my, x1, y1); x.stroke();
  }
}
// soft contact shadow just below the hair mass on the forehead (quarter res, drawn after the face occluder)

// Screen-space hairline: a few translucent root gaps plus baby hairs along the fitted line.
// Cheap (strokes only, no readback) so live mode can follow the customer's forehead each frame.

// Dark scalp cap under the crown so the hair mass sits on the head instead of floating over a skin gap.

// Keep the cutout inside this skull. The source photo's hair is wider than the customer and has a face hole.
function clipHairToSkull(ctx, P, W, H) {
  const dx = P.eR.x - P.eL.x, dy = P.eR.y - P.eL.y, ear = Math.hypot(dx, dy) || 1;
  const cx = (P.eL.x + P.eR.x) / 2, cy = (P.eL.y + P.eR.y) / 2;
  const nx = -dy / ear, ny = dx / ear;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  const g = ctx.createRadialGradient(cx + nx * ear * -0.42, cy + ny * ear * -0.42, ear * 0.2, cx + nx * ear * -0.35, cy + ny * ear * -0.35, ear * 0.78);
  g.addColorStop(0, '#fff'); g.addColorStop(0.55, 'rgba(255,255,255,0.95)'); g.addColorStop(0.82, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(cx + nx * ear * -0.42, cy + ny * ear * -0.42, ear * 0.82, ear * 0.66, Math.atan2(dy, dx), 0, 7); ctx.fill();
  ctx.restore();
}
function paintCrownSeat(ctx, A, hex) {
  const col = hex || '#3a2a22';
  ctx.save();
  ctx.setTransform(A.a, A.b, A.c, A.d, A.e, A.f);
  const g = ctx.createRadialGradient(0, -1.35, 0.08, 0, -1.2, 1.25);
  g.addColorStop(0, col); g.addColorStop(0.62, col); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.96; ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(0, -1.15, 0.92, 0.78, 0, 0, 7); ctx.fill();
  ctx.restore();
}
function paintLiveHairline(ctx, P, fitT, hex) {
  if (!P || !P.aff || fitT == null) return;
  const A = P.aff, col = hex || '#3a2a22';
  ctx.save();
  ctx.setTransform(A.a, A.b, A.c, A.d, A.e, A.f);
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 26; i++) {
    const x = -1.02 + (i / 25) * 2.04, n = vnoise(i * 0.85, 11);
    ctx.globalAlpha = 0.1 + n * 0.16;
    ctx.beginPath(); ctx.ellipse(x, fitT + 0.004 + n * 0.02, 0.028 + n * 0.018, 0.01, 0, 0, 7); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over'; ctx.lineCap = 'round'; ctx.strokeStyle = col;
  for (let q = 0; q < 24; q++) {
    const x = -0.9 + (q / 23) * 1.8, side = Math.abs(x) > 0.28, n = vnoise(q * 1.3, 17);
    const len = (side ? 0.045 : 0.026) * (0.65 + n);
    ctx.globalAlpha = 0.22 + n * 0.28; ctx.lineWidth = side ? 0.006 : 0.004;
    ctx.beginPath(); ctx.moveTo(x, fitT - 0.008);
    ctx.quadraticCurveTo(x + Math.sign(x || 1) * len * 0.45, fitT + len * 0.35, x + Math.sign(x || 1) * len * 0.7, fitT + len);
    ctx.stroke();
  }
  ctx.restore();
}
function hairShade(bk, fr, TW, TH) {
  const q = TW / 270, sw = 270, sh = 333, A = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const u = Math.min(TW - 1, Math.floor((x + 0.5) * q)), v = Math.min(TH - 1, Math.floor((y + 0.5) * q)), i = (v * TW + u) * 4;
    A[y * sw + x] = Math.min(1, (bk.data[i + 3] + fr.data[i + 3]) / 255);
  }
  const sft = 3, Sh = new Float32Array(sw * sh); for (let y = sft; y < sh; y++) for (let x = 0; x < sw; x++) Sh[y * sw + x] = A[(y - sft) * sw + x];
  const B = boxBlur(boxBlur(Sh, sw, sh, 4), sw, sh, 4), c = mk(sw, sh), cx2 = c.getContext('2d'), id = cx2.createImageData(sw, sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const i = y * sw + x, cx = -3 + (x + 0.5) * 4 / 180, cy = -2.8 + (y + 0.5) * 4 / 180;
    const box = clamp((1.05 - Math.abs(cx)) / 0.15, 0, 1) * clamp((cy + 1.75) / 0.1, 0, 1) * clamp((-0.8 - cy) / 0.15, 0, 1);
    const v = clamp(B[i] * 1.15 - A[i], 0, 1) * 0.75 * box; id.data[i * 4] = 42; id.data[i * 4 + 1] = 27; id.data[i * 4 + 2] = 21; id.data[i * 4 + 3] = v * 255;
  }
  cx2.putImageData(id, 0, 0); return c;
}
function photoEntry(id) { return !S.procHair && HAIRP && HAIRP[id] ? HAIRP[id] : null; }
function photoBang(e, bang) { return bang && e.bangs[bang] ? bang : e.def; }
function photoStyle(id, bang) {
  const e = photoEntry(id); if (!e) return null;
  const b = photoBang(e, bang), file = e.bangs[b], key = id + '|' + b;
  const pc = photoCache[key];
  if (pc && pc.ready) { pc.t = performance.now(); return pc.st; }
  if (pc) return pc.failed ? null : 'loading';
  const ent = (photoCache[key] = { ready: false });
  const img = new Image();
  img.onload = () => {
    mark('hair-img-loaded');
    const st0 = STYLES.find((q) => q.id === id), TW = LITE ? 540 : 1080, TH = LITE ? 666 : 1332; // canonical template space is 1080x1332; lite works at half
    const c = mk(TW, TH), x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, TW, TH);
    const src = x.getImageData(0, 0, TW, TH).data, bk = new ImageData(TW, TH), fr = new ImageData(TW, TH); let fsum = 0;
    for (let i = 0; i < src.length; i += 4) {
      const a = src[i + 3]; if (!a) continue; const f = src[i + 1] / 255;
      bk.data[i] = fr.data[i] = src[i]; bk.data[i + 1] = fr.data[i + 1] = 128;
      bk.data[i + 3] = a * (1 - f); fr.data[i + 3] = a * f; fsum += a * f;
    }
    const hlB = (e.hl || {})[b], natOK = !S.noNatHL && hlB != null && hlB < -0.9, male = st0.g === 'm';
    let cont = null, shade = null;
    if (natOK) { try { cont = naturalizeHairline(src, bk, fr, TW, TH, id + '|' + b, hlB, male); shade = hairShade(bk, fr, TW, TH); } catch (er) { console.warn('hairline', er); cont = null; } }
    let contC = null;
    if (cont) { const ppu = TW / 6; contC = new Float32Array(13).fill(NaN); for (let q = 0; q < 13; q++) { const u0 = Math.round((-0.72 + q * 0.12 + 3) * ppu); let mn = Infinity; for (let u = u0 - 2; u <= u0 + 2; u++) if (cont[u] === cont[u] && cont[u] < mn) mn = cont[u]; if (mn < Infinity) contC[q] = mn / ppu - 2.8; } }
    const back = mk(TW, TH); back.getContext('2d').putImageData(bk, 0, 0);
    if (cont) { const bd = bk.data; babyHairs(back.getContext('2d'), cont, TW, id + '|' + b, male, (u, v) => { const i = (clamp(v, 0, TH - 1) * TW + clamp(u, 0, TW - 1)) * 4; return bd[i + 3] ? bd[i] : 120; }); }
    let front = null; if (fsum > 255 * 400) { front = mk(TW, TH); front.getContext('2d').putImageData(fr, 0, 0); }
    // underlay: a blurred, dilated copy of the hair next to the face (temples/sides/jaw), drawn darker underneath, so no skin/background
    // gap can open between the hair's inner edge and the customer's face oval (the oval occluder covers it where the face is)
    const q = 4 * TW / 1080, uw = 270, uh = 333, u = mk(uw, uh), ux = u.getContext('2d', { willReadFrequently: true });
    const all = mk(TW, TH); all.getContext('2d').drawImage(img, 0, 0, TW, TH);
    { const ax = all.getContext('2d'); const d = ax.getImageData(0, 0, TW, TH); for (let i = 0; i < d.data.length; i += 4) d.data[i + 1] = 128; ax.putImageData(d, 0, 0); }
    // near-hair cap: the boosted wide blur used to extend ~0.15 face units INSIDE the template's own hair edge at the temples, which
    // showed through the temple openings as dark translucent rectangular bars down to the brows (short men's styles, e.g. 투블럭)
    ux.filter = 'blur(2px)'; ux.drawImage(all, 0, 0, uw, uh); ux.filter = 'none'; const nearA = ux.getImageData(0, 0, uw, uh).data; ux.clearRect(0, 0, uw, uh);
    ux.filter = 'blur(12px)'; ux.drawImage(all, 0, 0, uw, uh); ux.filter = 'none';
    const ud = ux.getImageData(0, 0, uw, uh);
    for (let y = 0; y < uh; y++) for (let x = 0; x < uw; x++) {
      const i = (y * uw + x) * 4, cx = -3 + (x + 0.5) * 4 / 180, cy = -2.8 + (y + 0.5) * 4 / 180, ax2 = Math.abs(cx);
      const side = clamp((ax2 - (cy < -0.35 ? 0.58 : 0.42)) / 0.12, 0, 1), low = clamp((cy + 0.35) / 0.15, 0, 1), ex = cx / 1.18, ey = (cy - 0.15) / 1.5, band = clamp((1 - (ex * ex + ey * ey)) / 0.12, 0, 1);
      const a = ud.data[i + 3]; if (a) { const inv = 255 / a; ud.data[i] = Math.min(255, ud.data[i]); }
      const tz = clamp((ax2 - 0.5) / 0.25, 0, 1) * clamp((1.05 - ax2) / 0.15, 0, 1) * clamp((cy + 1.4) / 0.3, 0, 1) * clamp((-0.4 - cy) / 0.35, 0, 1); // upper temples (soft box: no rectangular blocks)
      const cap = cy < -0.3 && ax2 < 0.95 ? Math.min(255, nearA[i + 3] * 3) : 255; // inside the upper face: only right next to real template hair
      ud.data[i + 3] = Math.min(cap, Math.min(255, a * (4 + 7 * tz)) * Math.max(side, low) * Math.max(band, tz)); ud.data[i + 1] = 128;
    }
    ux.putImageData(ud, 0, 0);
    const under = u; // kept at quarter resolution (it is a blurred layer anyway); drawn stretched to the template size
    freeCanvas(all); freeCanvas(c);
    ent.st = { back, front, under, shade, contC, id: 'p:' + id, bang: b, g: st0.g, ears: !!st0.ears, photo: true, hl: (e.hl || {})[b] }; ent.ready = true; ent.t = performance.now();
    { const ready = Object.entries(photoCache).filter(([k, v]) => v.ready && k !== key).sort((a, b) => a[1].t - b[1].t), maxP = LOWMEM ? 2 : 6;
      while (ready.length >= maxP) { const [k, v] = ready.shift(); freeCanvas(v.st.back); freeCanvas(v.st.front); freeCanvas(v.st.under); freeCanvas(v.st.shade); delete photoCache[k];
        for (const ck in colorCache) if (ck.startsWith('p:' + k.replace('|', '|'))) { const e2 = colorCache[ck]; freeCanvas(e2.back); freeCanvas(e2.front); freeCanvas(e2.under); delete colorCache[ck]; } } }
    if (S.style === id) rerender();
  };
  img.onerror = () => { ent.failed = true; };
  img.src = new URL('./assets/hair/' + (LITE ? 'lo/' : '') + file, import.meta.url).href;
  return 'loading';
}
let customStyle = null;

function useCustomHair(img) {
  const TW = LITE ? 540 : 1080, TH = LITE ? 666 : 1332;
  const c = mk(TW, TH), x = c.getContext('2d', { willReadFrequently: true });
  const s = Math.min(TW * 0.72 / img.width, TH * 0.42 / img.height);
  const w = img.width * s, h = img.height * s;
  x.drawImage(img, (TW - w) / 2, TH * 0.04, w, h);
  const id = x.getImageData(0, 0, TW, TH), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    d[i] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i + 1] = 128; d[i + 2] = 0;
  }
  x.putImageData(id, 0, 0);
  const thumb = mk(96, 120); thumb.getContext('2d').drawImage(img, 0, 0, 96, 120);
  customStyle = { back: c, photo: true, hl: -1.05, g: S.gender === 'm' ? 'm' : 'f', id: 'custom', bang: null, ears: true, thumb: thumb.toDataURL('image/jpeg', 0.7) };
  S.style = 'custom'; S.bang = null;
  renderStyles(); rerender();
  toast('내 헤어 이미지를 적용했어요');
}
function currentStyle() {
  if (S.style === 'none') return null;
  if (S.style === 'custom' && customStyle) return customStyle;
  const ph = photoStyle(S.style, S.bang);
  if (ph === 'loading') return null;
  if (ph) return ph;
  const key = S.style + '|' + (S.bang || '');
  if (!styleCache[key]) { const t0 = performance.now(); styleCache[key] = buildStyle(S.style, S.bang); stats.styleBuildMs = performance.now() - t0; }
  return styleCache[key];
}
function styleHex() {
  if (hairMask && hairMask.meanRGB) {
    const h = rgb2hex(...hairMask.meanRGB.map((v) => Math.round(v * 0.85 / 6) * 6)); // quantized so live doesn't recolor every frame
    if (!origHex || S.mode !== 'live') origHex = h;
  }
  const o = origHex || '#3b2b22';
  return S.hair ? mix(o, S.hair.c, clamp(S.intensity * 1.15, 0, 1)) : o;
}
let look = null; // lighting/exposure/skin taken from the photo (frozen during a live session to avoid re-colorizing)
function styleLook() {
  if (hairMask && hairMask.skin && (!look || S.mode !== 'live')) {
    look = { light: Math.round(hairMask.light * 4) / 4, expo: Math.round(hairMask.expo * 10) / 10, skin: hairMask.skin.map((v) => Math.round(v / 10) * 10) };
  }
  return look || { light: 0, expo: 1, skin: null };
}
function coloredStyle(st) {
  const hex = styleHex(), lk = styleLook(), key = st.id + '|' + st.bang + '|' + hex + '|' + lk.light + '|' + lk.expo + '|' + lk.skin;
  if (!colorCache[key]) {
    const keys = Object.keys(colorCache), maxC = LOWMEM ? 3 : 8;
    while (keys.length >= maxC) { const k = keys.shift(), e = colorCache[k]; if (e) { freeCanvas(e.back); freeCanvas(e.front); freeCanvas(e.under); } delete colorCache[k]; }
    const o = { ...lk, photo: !!st.photo }; colorCache[key] = { back: colorize(st.back, hex, hairLUT, o), front: st.front ? colorize(st.front, hex, hairLUT, o) : null, under: st.under ? colorize(st.under, hex, hairLUT, o) : null };
  }
  return colorCache[key];
}

/* ------------------------------------------------------------------ compositing */
function ensure(c, W, H) { if (c.width !== W || c.height !== H) { c.width = W; c.height = H; } }
function compose(W, H, P, mask) {
  ensure(outC, W, H); ensure(glassC, W, H); ensure(lensC, W, H); ensure(tintC, W, H);
  const t0 = performance.now();
  const st = P && P.aff ? currentStyle() : null;
  if (st) {
    ensure(baseC, W, H); ensure(occFC, W, H);
    baseX.drawImage(rawC, 0, 0);
    if (mask && mask.fill) {
      ensure(fillC, mask.w, mask.h); fillX.putImageData(mask.fill, 0, 0); baseX.imageSmoothingEnabled = true; baseX.drawImage(fillC, 0, 0, W, H);
      // re-add fine skin/photo grain (sampled from the cheek) where the fill is, so it doesn't look smeared
      if (!grainC) makeGrain(P);
      if (grainC) {
        ensure(grainL, W, H); grainLX.globalCompositeOperation = 'source-over'; grainLX.clearRect(0, 0, W, H);
        grainLX.fillStyle = grainLX.createPattern(grainC, 'repeat'); grainLX.fillRect(0, 0, W, H);
        grainLX.globalCompositeOperation = 'destination-in'; grainLX.drawImage(fillC, 0, 0, W, H);
        baseX.save(); baseX.globalCompositeOperation = 'soft-light'; baseX.drawImage(grainL, 0, 0); baseX.restore();
      }
    }
    let HA = P.aff, fitT = null;
    if (st.photo && st.hl && st.hl < -0.9) { // fit the template's hairline onto the customer's natural hairline (scale about the crown)
      const tgt = naturalHairline(P, mask);
      // scale about the crown (k <= 1.35 keeps proportions), then shift the rest so the hairline always reaches the forehead line
      const k = clamp((tgt + 2.0) / (st.hl + 2.0), 1, 1.35), A = P.aff; let sh = clamp(tgt - (-2.0 + (st.hl + 2.0) * k), 0, 0.15), cov = 0;
      // per column the fitted template edge must reach the customer's own hair edge (that area was erased -> it would show as a
      // skin band): extra shift = 2nd-largest deficit over the forehead columns (+0.015 overlap), capped
      const hpf = mask && mask.holeProf, pf = hpf || (mask && mask.hlProf), cc = st.contC, ad = hpf ? 0.01 : 0.03;
      if (pf && cc) { const df = []; for (let q = 0; q < 13; q++) { if (pf[q] !== pf[q] || cc[q] !== cc[q]) continue; const C = clamp(pf[q] + ad, tgt - 0.05, tgt + 0.12), Ef = -2.0 + (cc[q] + 2.0) * k + sh; df.push(C + 0.015 - Ef); }
        if (df.length >= 4) { df.sort((p, q) => q - p); cov = clamp(df[1], 0, mask.hairline != null && mask.hairline > -0.95 ? 0.04 : 0.12); sh += cov; } } // bangs: the profile measures the fringe, not the hairline
      sh = Math.max(0, sh + (st.g === 'm' ? 0.08 : 0));
      const ks = (st.g === 'm' ? 0.68 : 0.88) * (S.hScale || 1);
      HA = { a: A.a * ks, b: A.b * ks, c: A.c * k * ks, d: A.d * k * ks, e: A.e + A.c * (-2.0 * (1 - k) + sh), f: A.f + A.d * (-2.0 * (1 - k) + sh) };
      fitT = tgt; stats.hairFit = { tgt: +tgt.toFixed(3), hl: st.hl, k: +k.toFixed(3), sh: +sh.toFixed(3), cov: +cov.toFixed(3) };
    } else if (st.photo && st.hl) {
      // bang styles (리프컷 등) skipped the hairline fit and sat as a pasted bowl. Scale about the forehead and drop onto this skull.
      const leaf = st.id === 'p:leaf' || S.style === 'leaf'; const A = P.aff, k = (leaf ? 0.58 : 0.7) * (S.hScale || 1), cy = leaf ? -0.85 : -1.05, sh = leaf ? 0.34 : 0.2;
      HA = { a: A.a * k, b: A.b * k, c: A.c * k, d: A.d * k, e: A.e + A.c * ((1 - k) * cy + sh), f: A.f + A.d * ((1 - k) * cy + sh) };
      fitT = st.hl + sh; stats.hairFit = { tgt: fitT, hl: st.hl, k, sh, cov: 0, bang: 1 };
    }
    const col = coloredStyle(st), T = templateTransform(HA);
    outX.drawImage(baseC, 0, 0);
    ensure(recC, W, H); recX.setTransform(1, 0, 0, 1, 0, 0); recX.clearRect(0, 0, W, H);
    if (col.under && !S.dbgNoUnder && !st.photo) { recX.save(); recX.setTransform(...T); recX.filter = st.g === 'm' ? 'brightness(0.82)' : 'brightness(0.75)'; recX.drawImage(col.under, 0, 0, 1080, 1332); recX.restore(); recX.filter = 'none'; }
    if (!S.dbgNoBack) { recX.save(); recX.setTransform(...T); recX.imageSmoothingEnabled = true; recX.imageSmoothingQuality = 'high'; recX.drawImage(col.back, 0, 0, 1080, 1332); recX.restore(); }
    outX.drawImage(recC, 0, 0);
    // occluder = face oval (+ neck) from the hair-free base image
    const ow = Math.round(W / 4), oh = Math.round(H / 4);
    ensure(occ2, ow, oh); occ2X.globalCompositeOperation = 'source-over'; occ2X.clearRect(0, 0, ow, oh);
    { // neck: canonical trapezoid under the jaw, mapped with the face affine
      const A = P.aff, mp = (x, y) => [(A.a * x + A.c * y + A.e) * ow / W, (A.b * x + A.d * y + A.f) * oh / H];
      occ2X.fillStyle = '#fff'; occ2X.beginPath();
      [[-0.6, 0.7], [0.6, 0.7], [0.56, 1.6], [0.6, 2.35], [0.75, 2.65], [-0.75, 2.65], [-0.6, 2.35], [-0.56, 1.6]].forEach(([x, y], i) => { const [u, v] = mp(x, y); i ? occ2X.lineTo(u, v) : occ2X.moveTo(u, v); });
      occ2X.closePath(); occ2X.fill();
    }
    const kx = ow / W, ky = oh / H, cx = (P.top.x + P.chin.x) / 2, cy = (P.top.y + P.chin.y) / 2;
    occ2X.fillStyle = '#fff'; occ2X.beginPath();
    P.oval.forEach((p, i) => { const x = (p.x + (cx - p.x) * 0.02) * kx, y = (p.y + (cy - p.y) * 0.02) * ky; i ? occ2X.lineTo(x, y) : occ2X.moveTo(x, y); });
    occ2X.closePath(); occ2X.fill();
    if (st.photo && mask && mask.upHole) { ensure(upC, mask.w, mask.h); upX.putImageData(mask.upHole, 0, 0); occ2X.globalCompositeOperation = 'destination-out'; occ2X.imageSmoothingEnabled = true; occ2X.drawImage(upC, 0, 0, ow, oh); occ2X.globalCompositeOperation = 'source-over'; }
    // everything above the fitted hairline belongs to the hair: cut the face occluder there (fading out ~0.05 below the line) so the
    // new hair's front edge and strands lie ON the forehead instead of being repainted with skin (the "floating hair" gap)
    if (fitT != null && !S.dbgNoCut) {
      const A = P.aff; occ2X.save(); occ2X.setTransform(A.a * kx, A.b * ky, A.c * kx, A.d * ky, A.e * kx, A.f * ky);
      const gc = occ2X.createLinearGradient(0, fitT + 0.05, 0, fitT - 0.01); gc.addColorStop(0, 'rgba(0,0,0,0)'); gc.addColorStop(1, 'rgba(0,0,0,1)');
      occ2X.globalCompositeOperation = 'destination-out'; occ2X.fillStyle = gc; occ2X.fillRect(-3, -3.2, 6, fitT + 0.05 + 3.2); occ2X.restore(); occ2X.globalCompositeOperation = 'source-over';
    }
    // feather the hairline: fade the top of the forehead so the hair behind shows through softly
    const fh = Math.hypot(P.chin.x - P.top.x, P.chin.y - P.top.y), ux = (P.chin.x - P.top.x) / fh, uy = (P.chin.y - P.top.y) / fh;
    const g = occ2X.createLinearGradient(P.top.x * kx, P.top.y * ky, (P.top.x + ux * fh * 0.09) * kx, (P.top.y + uy * fh * 0.09) * ky);
    g.addColorStop(0, 'rgba(0,0,0,0.8)'); g.addColorStop(0.45, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    if (st.photo) { const gp = occ2X.createLinearGradient(P.top.x * kx, P.top.y * ky, (P.top.x + ux * fh * 0.05) * kx, (P.top.y + uy * fh * 0.05) * ky); gp.addColorStop(0, 'rgba(0,0,0,0.45)'); gp.addColorStop(0.55, 'rgba(0,0,0,0.12)'); gp.addColorStop(1, 'rgba(0,0,0,0)'); occ2X.globalCompositeOperation = 'destination-out'; occ2X.fillStyle = gp; occ2X.fillRect(0, 0, ow, oh); occ2X.globalCompositeOperation = 'source-over'; }
    else { occ2X.globalCompositeOperation = 'destination-out'; occ2X.fillStyle = g; occ2X.fillRect(0, 0, ow, oh); occ2X.globalCompositeOperation = 'source-over'; }
    occFX.globalCompositeOperation = 'source-over'; occFX.clearRect(0, 0, W, H); occFX.drawImage(baseC, 0, 0);
    occFX.globalCompositeOperation = 'destination-in'; occFX.imageSmoothingEnabled = true; occFX.drawImage(occ2, 0, 0, W, H);
    occFX.globalCompositeOperation = 'source-over';
    outX.drawImage(occFC, 0, 0);
    if (st.shade && !S.dbgNoShade) { outX.save(); outX.setTransform(...T); outX.globalAlpha = 0.3; outX.imageSmoothingEnabled = true; outX.drawImage(st.shade, 0, 0, 1080, 1332); outX.restore(); }
    // contact shadow on the face where hair meets it (temples/sides/forehead), not on the chin
    if (true) {
      const sw2 = Math.round(W / 8), sh2 = Math.round(H / 8), kx2 = sw2 / W, ky2 = sh2 / H; ensure(cshC, sw2, sh2);
      cshX.globalCompositeOperation = 'source-over'; cshX.clearRect(0, 0, sw2, sh2);
      const ovalPath = () => { cshX.beginPath(); P.oval.forEach((p, i) => { i ? cshX.lineTo(p.x * kx2, p.y * ky2) : cshX.moveTo(p.x * kx2, p.y * ky2); }); cshX.closePath(); };
      cshX.strokeStyle = '#000'; cshX.lineWidth = fh * kx2 * (st.g === 'm' ? 0.07 : 0.11); ovalPath(); cshX.stroke();
      cshX.globalCompositeOperation = 'destination-in'; cshX.fillStyle = '#000'; ovalPath(); cshX.fill();
      const gg = cshX.createLinearGradient(P.top.x * kx2, P.top.y * ky2, P.chin.x * kx2, P.chin.y * ky2);
      gg.addColorStop(0, 'rgba(0,0,0,1)'); gg.addColorStop(0.4, 'rgba(0,0,0,0.55)'); gg.addColorStop(0.72, 'rgba(0,0,0,0)');
      cshX.fillStyle = gg; cshX.fillRect(0, 0, sw2, sh2);
      outX.save(); outX.globalAlpha = st.photo ? 0.2 : 0.18; outX.imageSmoothingEnabled = true; outX.drawImage(cshC, 0, 0, W, H); outX.restore();
    }
    if (col.front && !S.dbgNoFront) {
      // soft drop shadow of bangs / side locks onto the face
      const sw3 = Math.round(W / 6), sh3 = Math.round(H / 6); ensure(cshC2, sw3, sh3);
      cshX2.globalCompositeOperation = 'source-over'; cshX2.clearRect(0, 0, sw3, sh3);
      cshX2.setTransform(...T.map((v, i) => v * (i % 2 === 0 ? sw3 / W : sh3 / H)));
      cshX2.drawImage(col.front, 0, 0, 1080, 1332); cshX2.setTransform(1, 0, 0, 1, 0, 0);
      cshX2.globalCompositeOperation = 'source-in'; cshX2.fillStyle = 'rgb(30,15,10)'; cshX2.fillRect(0, 0, sw3, sh3);
      outX.save(); outX.globalAlpha = st.photo ? 0.22 : 0.28; outX.drawImage(cshC2, 0, fh * (st.photo ? 0.012 : 0.025), W, H); outX.restore();
      recX.setTransform(1, 0, 0, 1, 0, 0); recX.clearRect(0, 0, W, H);
      recX.save(); recX.setTransform(...T); recX.drawImage(col.front, 0, 0, 1080, 1332); recX.restore();
        outX.drawImage(recC, 0, 0);
    }
    if (st.photo && fitT != null && !(stats.hairFit && stats.hairFit.bang)) paintLiveHairline(outX, P, fitT, S.hair && S.hair.c);
  } else {
    outX.drawImage(rawC, 0, 0);
    if (S.hair) applyHair(outX, W, H, mask, S.hair.c, S.intensity);
  }
  const t1 = performance.now(); stats.hairMs = stats.hairMs * 0.9 + (t1 - t0) * 0.1;
  hiScale = calcHiScale(W, H);
  if (hiScale === 1) glassesPass(outX, W, H, P);
  stats.glassMs = stats.glassMs * 0.9 + (performance.now() - t1) * 0.1;
}
function glassesPass(outX, W, H, P) {
  ensure(glassC, W, H); ensure(lensC, W, H); ensure(tintC, W, H);
  if (P && S.shape !== 'none') {
    const sdef = S.style !== 'none' ? STYLES.find((q) => q.id === S.style) : null;
    const hideT = !!(sdef && sdef.g === 'f' && !sdef.ears);
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
    outX.globalAlpha = photo ? 0.16 : 0.12; outX.drawImage(shadowC, 0, 0, sw, sh, -d * 0.02, d * 0.085, W + d * 0.04, H + d * 0.02);
    outX.globalAlpha = 0.3; outX.drawImage(shadowC, 0, d * 0.03, W, H); outX.restore();
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
  const needSeg = S.hair || S.style !== 'none';
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
    crumb('live'); S.mode = 'live'; hairMask = null; lastStillMasks = null; lm = null; origHex = null; grainC = null; look = null; resetFilters(); // still-only data (masks) not needed live
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
function rebuildStillSeg() { // style toggled on a still: recompute inpaint/neck from cached masks
  if (S.mode !== 'still' || !lastStillMasks) return;
  segInputFrom(rawC, rawC.width, rawC.height, 640);
  hairMask = buildSeg(lastStillMasks.masks, lastStillMasks.w, lastStillMasks.h, null, lm);
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
  stopLoop(); S.mode = 'still'; mirror = mirrorIt; origHex = null; grainC = null; look = null;
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
async function capture() { const cs = camSrc(); if (S.mode !== 'live' || !cs) return; await loadStillFrom(cs[0], cs[1], cs[2], mirror); toast('촬영했어요! 저장하거나 컬러·스타일을 계속 바꿔보세요.'); }
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
  const stl = STYLES.find((s) => s.id === S.style);
  const parts = [`${T.e} ${T.n} ${sub}`, S.style !== 'none' ? stl.n : null, S.hair ? `헤어 ${S.hair.n}` : null,
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
const lookTexts = (st, bang, hair, shape, frame) => {
  const stl = STYLES.find((q) => q.id === st), sh = SHAPES.find((q) => q.id === shape), fr = FRAMES[frame];
  return { hair: st && st !== 'none' && stl ? stl.n + (bang && BANGS[bang] && bang !== 'none' && bang !== stl.bang ? ' · ' + BANGS[bang].n : '') : '현재 헤어 유지',
    color: hair ? hair.n : '원래 컬러', colorC: hair && hair.c, glasses: shape && shape !== 'none' && sh && fr ? `${sh.n} · ${fr.n}` : '안경 없음', frameC: fr && (fr.c2 ? null : fr.c), frame: fr };
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
  const L = lookTexts(S.style, S.bang, S.hair, S.shape, S.frame);
  shText(x, '최종 선택', pad, y + 30, '700 30px "Pretendard", sans-serif', SH.ink); y += 52;
  x.fillStyle = SH.card; x.strokeStyle = SH.line; x.beginPath(); x.roundRect(pad, y, W - pad * 2, 212, 20); x.fill(); x.stroke();
  const row = (yy, lab, val, sw) => { shText(x, lab, pad + 28, yy, '500 24px "Pretendard", sans-serif', SH.mute); if (sw) shSwatch(x, pad + 200, yy - 8, 15, sw[0], sw[1]); shText(x, val, pad + (sw ? 228 : 190), yy, '600 28px "Pretendard", sans-serif', SH.ink, W - pad * 2 - 260); };
  row(y + 56, '헤어스타일', L.hair); row(y + 118, '헤어 컬러', L.color, L.colorC ? [L.colorC] : null);
  row(y + 180, '안경', L.glasses, L.frame && S.shape !== 'none' ? [L.frame.c, L.frame.c2] : null);
  y += 212 + 40;
  if (top) { // the analysis' top-3
    shText(x, '추천 TOP 3', pad, y + 30, '700 30px "Pretendard", sans-serif', SH.ink); y += 52;
    x.fillStyle = SH.card; x.strokeStyle = SH.line; x.beginPath(); x.roundRect(pad, y, W - pad * 2, 3 * 96 + 16, 20); x.fill(); x.stroke();
    top.slice(0, 3).forEach((cb, i) => { const t = lookTexts(cb.h.style, cb.h.bang, cb.c.hair, cb.g.shape, cb.g.frame), yy = y + 60 + i * 96;
      shText(x, String(i + 1), pad + 30, yy, '400 40px "HOW Serif", Georgia, serif', SH.ink);
      shText(x, t.hair, pad + 86, yy - 12, '600 26px "Pretendard", sans-serif', SH.ink, 330);
      shSwatch(x, pad + 98, yy + 22, 11, cb.c.hair.c); shText(x, t.color, pad + 118, yy + 30, '400 22px "Pretendard", sans-serif', '#55514b', 300);
      shSwatch(x, pad + 470, yy - 20, 11, t.frame ? t.frame.c : '#ccc', t.frame && t.frame.c2); shText(x, t.glasses, pad + 492, yy - 12, '500 24px "Pretendard", sans-serif', SH.ink, W - pad * 2 - 520);
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
function renderStyles() {
  $('genders').innerHTML = [['f', '여성'], ['m', '남성']].map(([k, n]) => `<button class="sub ${S.gender === k ? 'on' : ''}" data-gender="${k}">${n}</button>`).join('');
  const list = STYLES.filter((s) => s.id === 'none' || s.g.includes(S.gender));
  const customBtn = customStyle ? `<button class="style ${S.style === 'custom' ? 'on' : ''}" data-style="custom"><img src="${customStyle.thumb}" alt=""><span>내 이미지</span></button>` : '';
  $('styleList').innerHTML = customBtn + list.map((s) => `<button class="style ${S.style === s.id ? 'on' : ''}" data-style="${s.id}">${photoEntry(s.id) ? `<img src="assets/hair/thumbs/${s.id}.jpg" alt="" loading="lazy">` : styleIconSVG(s)}<span>${s.n}</span></button>`).join('');
  const st = STYLES.find((s) => s.id === S.style);
  const bangRow = $('bangRow');
  if (!st || !st.mass) { bangRow.hidden = true; return; }
  bangRow.hidden = false;
  const pe = photoEntry(st.id);
  const opts = pe ? ['none', 'full', 'seethrough', 'side', st.bang].filter((b, i, a) => pe.bangs[b] && a.indexOf(b) === i) : st.g === 'f' ? ['none', 'full', 'seethrough', 'side'] : ['none', st.bang];
  const cur = pe ? photoBang(pe, S.bang) : S.bang || st.bang;
  if (opts.length < 2) { bangRow.hidden = true; return; }
  $('bangList').innerHTML = opts.map((b) => `<button class="sub ${cur === b ? 'on' : ''}" data-bang="${b}">${b === (pe ? pe.def : st.bang) ? '기본 · ' : ''}${BANGS[b].n}</button>`).join('');
}
function selectType(k) {
  S.type = k; S.sub = TYPES[k].subs[0][0];
  S.hair = TYPES[k].hair.find((h) => h.t.includes(S.sub)) || TYPES[k].hair[0]; S.frame = TYPES[k].frames[0];
  renderTypes(); renderHair(); renderFrames(); rerender();
}
function selectStyle(id, bang = null) {
  const was = S.style; S.style = id; S.bang = bang;
  renderStyles();
  if (id !== 'none') { setStatus('헤어스타일 만드는 중…'); setTimeout(() => { currentStyle(); if (was === 'none') rebuildStillSeg(); rerender(); setStatus(lm ? '✓ 얼굴 인식' : ''); }, 30); }
  else rerender();
  if (S.mode === 'live') frameNo = stats.segEvery - 1;
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
  $('genders').addEventListener('click', (ev) => { const b = ev.target.closest('[data-gender]'); if (!b) return; S.gender = b.dataset.gender; renderStyles(); });
  $('styleList').addEventListener('click', (ev) => { const b = ev.target.closest('[data-style]'); if (!b) return; if (b.dataset.style === 'custom') { S.style = 'custom'; S.bang = null; renderStyles(); rerender(); return; } selectStyle(b.dataset.style); });
  $('hairPick').addEventListener('input', (ev) => {
    const c = ev.target.value;
    $('hairPickVal').textContent = c;
    S.hair = { n: '직접 선택', c, t: [S.sub] };
    renderHair(); throttled();
  });
  $('hairFile').addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0]; if (!f) return;
    const url = URL.createObjectURL(f), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); useCustomHair(img); };
    img.onerror = () => toast('이미지를 열 수 없어요');
    img.src = url;
  });
  $('bangList').addEventListener('click', (ev) => { const b = ev.target.closest('[data-bang]'); if (b) selectStyle(S.style, b.dataset.bang); });
  $('worstToggle').addEventListener('change', (ev) => { S.showWorst = ev.target.checked; renderHair(); renderFrames(); });
  let rq = 0; const throttled = () => { if (!rq) rq = requestAnimationFrame(() => { rq = 0; rerender(); }); };
  $('intensity').addEventListener('input', (ev) => { S.intensity = ev.target.value / 100; $('intensityVal').textContent = ev.target.value + '%'; throttled(); });
  $('gSize').addEventListener('input', (ev) => { S.gScale = ev.target.value / 100; $('gSizeVal').textContent = ev.target.value + '%'; throttled(); });
  $('hSize').addEventListener('input', (ev) => { S.hScale = ev.target.value / 100; $('hSizeVal').textContent = ev.target.value + '%'; throttled(); });
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
    rcProgress('추천 스타일을 그리는 중…'); await yieldUI();
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
  rc.combos = [0, 1, 2].map((i) => ({ g: rc.res.glasses[i] || rc.res.glasses[0], h: rc.res.hair[i] || rc.res.hair[0], c: rc.res.colors[i] || rc.res.colors[0] }));
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
  const was = S.style, wasBang = S.bang;
  Object.assign(S, { type: rc.an.type, sub: rc.an.sub, gender: rc.gender, style: cb.h.style, bang: cb.h.bang, hair: cb.c.hair, shape: cb.g.shape, frame: cb.g.frame, noHiGlasses: true, compare: 'after', holdBefore: false });
  try {
    for (let t = 0; t < 120 && S.style !== 'none' && !currentStyle(); t++) await sleep(50); // hair asset decode (bounded)
    mark('style-ready');
    if (S.shape !== 'none') await preloadGlasses3D(S.shape, S.frame); // decode once, then a single compose
    mark('assets-ready'); if (!lm) return;
    if (was !== S.style || wasBang !== S.bang || !hairMask || !hairMask.fill) rebuildStillSeg();
    mark('reseg-done'); compose(rawC.width, rawC.height, lm, hairMask); mark('compose-done');
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
  $('rcGender').innerHTML = [['f', '여성'], ['m', '남성']].map(([k, n]) => `<button class="${rc.gender === k ? 'on' : ''}" data-g="${k}">${n}</button>`).join('');
  { // gender bar at the top of the results: shows the automatic choice; highlighted when the estimate was unsure / unavailable
    const e = rc.gEst, KO = { m: '남성', f: '여성' }, manual = rc.gManual, unsure = !e || !e.sure;
    $('rcGBar').classList.toggle('ask', unsure && !manual);
    $('rcGBtns').innerHTML = [['f', '여성'], ['m', '남성']].map(([k, n]) => `<button class="${rc.gender === k ? 'on' : ''}" data-g="${k}" aria-pressed="${rc.gender === k}">${n}</button>`).join('');
    $('rcGNote').textContent = e && e.fixed && !manual ? `기본: ${KO[e.g]} (설정)` : manual ? `직접 선택: ${KO[rc.gender]}` + (e && e.sure && e.g !== rc.gender ? ` (자동: ${KO[e.g]})` : '') : unsure ? (e ? '자동 판단이 어려워요 · 성별을 선택해 주세요' : '성별을 선택해 주세요') : `자동: ${KO[e.g]}`;
  }
  const shN = (id) => SHAPES.find((q) => q.id === id)?.n || id, stN = (id) => STYLES.find((q) => q.id === id)?.n || id;
  $('rcGlasses').innerHTML = rc.res.glasses.map((g, i) => `<li class="${rc.sel && rc.sel.g === g ? 'on' : ''}" data-k="g" data-i="${i}"><b>${shN(g.shape)} · ${FRAMES[g.frame].n}</b><span>${g.why}</span></li>`).join('');
  $('rcHair').innerHTML = rc.res.hair.map((h, i) => `<li class="${rc.sel && rc.sel.h === h ? 'on' : ''}" data-k="h" data-i="${i}"><b>${stN(h.style)}${h.bang && BANGS[h.bang] && h.bang !== 'none' ? ' · ' + BANGS[h.bang].n : ''}</b><span>${h.why}</span></li>`).join('');
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
  const lists = (e) => { const li = e.target.closest('li[data-k]'); if (!li || rc.busy) return; const k = li.dataset.k, i = +li.dataset.i; const src = k === 'g' ? rc.res.glasses : k === 'h' ? rc.res.hair : rc.res.colors; rcSelect({ ...rc.sel, [k]: src[i] }); };
  ['rcGlasses', 'rcHair', 'rcColors'].forEach((id) => { $(id).onclick = lists; });
  $('rcTypes').onclick = async (e) => { const b = e.target.closest('[data-type]'); if (!b || rc.busy) return; rc.an.type = b.dataset.type; rc.an.sub = rc.an.type === rc.an.cc.type ? rc.an.cc.sub : TYPES[rc.an.type].subs[0][0]; rc.busy = true; try { await rcBuild(); rcThumbsLazy(); } finally { rc.busy = false; } };
  $('rcSubs').onclick = async (e) => { const b = e.target.closest('[data-sub]'); if (!b || rc.busy) return; rc.an.sub = b.dataset.sub; rc.busy = true; try { await rcBuild(); rcThumbsLazy(); } finally { rc.busy = false; } };
  const pickG = async (e) => { const b = e.target.closest('[data-g]'); if (!b || rc.busy) return; rc.gManual = true; rc.gender = b.dataset.g; rc.busy = true; try { await rcBuild(); rcThumbsLazy(); } finally { rc.busy = false; } };
  $('rcGender').onclick = pickG; $('rcGBtns').onclick = pickG;
  $('rcGo').onclick = async () => { // apply the previewed combo to the main screen, then go live
    if (rc.going) return; rc.going = true; rc.gen++; await rc.q; rc.going = false; // let a running preview finish first
    const c = rc.sel; Object.assign(S, { type: rc.an.type, sub: rc.an.sub, gender: rc.gender, style: c.h.style, bang: c.h.bang, hair: c.c.hair, shape: c.g.shape, frame: c.g.frame });
    renderTypes(); renderHair(); renderFrames(); renderShapes(); renderStyles();
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
    if (SET.gender !== 'auto' && !rc.an && coverResolve == null && S.gender !== SET.gender) { S.gender = SET.gender; renderStyles(); } };
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
  for (const k in colorCache) { const e = colorCache[k]; if (e) { freeCanvas(e.back); freeCanvas(e.front); freeCanvas(e.under); } delete colorCache[k]; }
  for (const k in photoCache) { const v = photoCache[k]; if (v && v.ready) { freeCanvas(v.st.back); freeCanvas(v.st.front); freeCanvas(v.st.under); freeCanvas(v.st.shade); } delete photoCache[k]; }
  try { purgeGlasses3D(); } catch (e) {}
  for (const c of [baseC, occFC, fillC, grainL, glassC, lensC, tintC, paneC, segIn, upC, recC, darkC, shadowC, maskC, occC, occ2, cshC, cshC2]) { c.width = c.height = 1; }
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
  Object.assign(S, S0, { mode: 'still' }, SET.gender !== 'auto' ? { gender: SET.gender } : {}); hairMask = null; lm = null; origHex = null; grainC = null; look = null; lastStillMasks = null;
  rawC.width = rawC.height = 1; outC.width = outC.height = 1; const vx = view.getContext('2d'); vx.clearRect(0, 0, view.width, view.height);
  stage.classList.remove('is-still'); $('placeholder').classList.remove('hide'); $('phText').textContent = '카메라를 준비하는 중…';
  $('cmpAfter').classList.add('on'); $('cmpSplit').classList.remove('on'); stage.classList.remove('split', 'no-live'); // compare UI back to 결과만 (S.compare was reset, the buttons were not)
  $('intensity').value = 75; $('intensityVal').textContent = '75%'; $('gSize').value = 100; $('gSizeVal').textContent = '100%'; $('hSize').value = 100; $('hSizeVal').textContent = '100%'; S.hScale = 1; $('worstToggle').checked = false;
  renderTypes(); renderHair(); renderFrames(); renderShapes(); renderStyles(); setStatus(''); $('fps').textContent = '';
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
  else if (how === 'live' && lm) { S.mode = 'still'; stage.classList.add('is-still'); $('placeholder').classList.add('hide'); rebuildStillSeg(); renderStill(); showPhotoMode(); }
  else showPhotoMode();
}
let modelsP = null;
async function boot() {
  renderTypes(); renderHair(); renderFrames(); renderShapes(); renderStyles(); bindUI(); rcBind(); bindSettings();
  if (SET.gender !== 'auto') { S.gender = SET.gender; renderStyles(); }
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
window.__pc.selectStyle = (id, bang) => { selectStyle(id, bang); return new Promise((r) => setTimeout(r, 60)).then(() => { currentStyle(); rerender(); }); };
window.__pc.set = (o) => { Object.assign(S, o); renderTypes(); renderHair(); renderFrames(); renderShapes(); renderStyles(); rerender(); };
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
