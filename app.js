// 퍼스널컬러 가상 피팅 — 100% client-side. Photos/video never leave the device.
import { FRAMES, SHAPES, SHAPE_BY_ID, drawGlasses, shapeIconSVG, mix, rgba } from './frames.js';
import { initGlasses3D, drawGlasses3D } from './glasses3d.js';
import { faceMetrics, classifyFace, colorMetrics, classifyColor, recommend, SHAPES_KO } from './reco.js';
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
  frame: 'gold', shape: 'round', gScale: 1,
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
  const A = P.aff, X = A.a * 0.5 + A.c * 0.38 + A.e, Y = A.b * 0.5 + A.d * 0.38 + A.f;
  const sz = clamp(Math.round(Math.hypot(A.a, A.b) * 0.3), 24, 96), x0 = Math.round(X - sz / 2), y0 = Math.round(Y - sz / 2);
  if (x0 < 0 || y0 < 0 || x0 + sz > rawC.width || y0 + sz > rawC.height) return;
  const src = rawX.getImageData(x0, y0, sz, sz).data, Lm = new Float32Array(sz * sz);
  for (let i = 0; i < sz * sz; i++) Lm[i] = 0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2];
  const bl = boxBlur(Lm, sz, sz, 3);
  const c = mk(sz, sz), x = c.getContext('2d'), id = x.createImageData(sz, sz);
  for (let i = 0; i < sz * sz; i++) { const v = clamp(128 + (Lm[i] - bl[i]) * 1.6, 0, 255); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
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
window.__pc.dbg = () => ({ photoCache, colorCache, cur: currentStyle() });
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
  setStatus('얼굴 인식 모델 불러오는 중…');
  MP = await import(MP_URL);
  const files = await MP.FilesetResolver.forVisionTasks(WASM_URL);
  mkFace = (d) => MP.FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate: d }, runningMode: 'VIDEO', numFaces: 1,
    minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
  mkSeg = (d) => MP.ImageSegmenter.createFromOptions(files, {
    baseOptions: { modelAssetPath: SEG_MODEL, delegate: d }, runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false });
  const forceCPU = new URLSearchParams(location.search).has('cpu');
  try { if (forceCPU) throw 0; face = await mkFace('GPU'); seg = await mkSeg('GPU'); delegate = 'GPU'; }
  catch (e) { console.warn('GPU delegate failed, using CPU', e); face = face || await mkFace('CPU'); seg = await mkSeg('CPU'); delegate = 'CPU'; }
  faceMode = segMode = 'VIDEO'; stats.delegate = delegate;
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
  if (m != null && m < -1.0 && m > -1.6) return Math.max(clamp(m + 0.12, -1.35, -1.05) * 0.5 + anat * 0.5, -1.3);
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
      // live: smooth the estimate over frames (the low-res mask edge flickers)
      if (prev && prev.hairline != null && out.hairline != null && Math.abs(prev.hairline - out.hairline) < 0.3) out.hairline = prev.hairline * 0.8 + out.hairline * 0.2;
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
      const near = boxBlur(raw, w, h, Math.max(3, Math.round(w / 18)));
      const lidY = Math.max(...P.lids.map((q) => q.y)) / segScaleY, br = 0, fw2 = Math.hypot(P.eR.x - P.eL.x, P.eR.y - P.eL.y) / segScaleX;
      const sL = lumOf(skin);
      for (let y = 0; y < Math.min(h, Math.floor(lidY - br * 0.2)); y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; if (!inOval[i] || browP[i] > 0.25 || near[i] < 0.06) continue;
        const j = i * 4, dc = Math.abs(px[j] - skin[0]) + Math.abs(px[j + 1] - skin[1]) + Math.abs(px[j + 2] - skin[2]);
        const dl = sL - (0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]);
        fore[i] = clamp((Math.max(dc - 45, dl * 2 - 30)) / 45, 0, 1) * clamp((lidY - y) / Math.max(2, fw2 * 0.07), 0, 1);
      }
      const fb = boxBlur(fore, w, h, Math.max(1, Math.round(w / 160))); for (let i = 0; i < w * h; i++) fore[i] = clamp(Math.max(fore[i], fb[i] * 2.2), 0, 1);
    }
    const skinY = skin ? lumOf(skin) : 0, skinCr = skin ? [skin[0] / (skin[0] + skin[1] + skin[2] + 1), skin[1] / (skin[0] + skin[1] + skin[2] + 1)] : null;
    // below the brows the (blurry) segmenter bleeds onto real skin -> only remove confident hair there
    const browLowY = P && P.brows ? [...P.brows.slice(5, 10), ...P.brows.slice(15, 20)].reduce((s2, q) => s2 + q.y, 0) / 10 / segScaleY : 1e9;
    const known = new Float32Array(w * h), knownSkin = new Float32Array(w * h), hole = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      let hv = inOval && inOval[i] ? (Math.floor(i / w) > browLowY ? clamp(raw[i] * 2.6 - 1.0, 0, 1) : clamp(raw[i] * 3.5 - 0.45, 0, 1)) : clamp(dil[i] * 3.2 - 0.15, 0, 1);
      if (fore && fore[i] > hv) hv = fore[i];
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
    const filled = pushPull(px, w, h, known), skinFill = inOval ? pushPull(px, w, h, knownSkin) : null;
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
    const fid = new ImageData(w, h);
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
      if (n > 12) fhRGB = [r / n, g / n, b / n]; out.fhRGB = fhRGB; out.fhN = n; { let c1 = 0, c2 = 0, c3 = 0, c4 = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x, cx = IA.a * x + IA.c * y + IA.e, cy = IA.b * x + IA.d * y + IA.f; if (cy < -0.6 && cy > -1.1 && Math.abs(cx) < 0.55) { c1++; if (faceOnly[i]) c2++; if (hole[i] < 0.05) c3++; if (knownSkin[i]) c4++; } } out.fhDbg = [c1, c2, c3, c4]; }
    }
    for (let i = 0; i < w * h; i++) {
      const sk2 = skinFill && inOval[i], src = sk2 ? skinFill : refl;
      let m = 1, R = src[i * 3], G = src[i * 3 + 1], B = src[i * 3 + 2];
      if (sk2 && aff) { const dx = (i % w - fcx) / frx, dy = (Math.floor(i / w) - fcy) / fry, r2 = dx * dx + dy * dy; m = 1 + 0.03 * Math.exp(-r2 * 1.6) - 0.08 * Math.min(1, Math.max(0, r2 - 0.8)); }
      if (sk2 && fhRGB && hole[i] > 0.02) { // upper forehead / temples / cap: blend toward the forehead tone, very slightly darker toward the hair
        const x = i % w, y = (i - x) / w, cy = IA.b * x + IA.d * y + IA.f, t = clamp((-0.95 - cy) / 0.25, 0, 1);
        const k2 = faceOnly[i] ? 0.6 * clamp((-0.4 - cy) / 0.3, 0, 1) : 0.75 * t + 0.25;
        R = R * (1 - k2) + fhRGB[0] * k2; G = G * (1 - k2) + fhRGB[1] * k2; B = B * (1 - k2) + fhRGB[2] * k2; m = 1 - 0.05 * t;
      }
      fid.data[i * 4] = R * m; fid.data[i * 4 + 1] = G * m; fid.data[i * 4 + 2] = B * m; fid.data[i * 4 + 3] = hole[i] * 255;
      if (upH && IA && faceOnly[i]) { const x = i % w, y = (i - x) / w, cy = IA.b * x + IA.d * y + IA.f, cx = IA.a * x + IA.c * y + IA.e; upH.data[i * 4 + 3] = hole[i] * 255 * clamp((-0.35 - cy) / 0.2, 0, 1) * clamp((Math.abs(cx) - 0.5) / 0.15, 0, 1); }
    }
    out.upHole = upH; // synthesized (formerly hair-covered) skin inside the upper face oval: the new hair may show there
    out.fill = fid;
  }
  return out;
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
function photoEntry(id) { return !S.procHair && HAIRP && HAIRP[id] ? HAIRP[id] : null; }
function photoBang(e, bang) { return bang && e.bangs[bang] ? bang : e.def; }
function photoStyle(id, bang) {
  const e = photoEntry(id); if (!e) return null;
  const b = photoBang(e, bang), file = e.bangs[b], key = id + '|' + b;
  const pc = photoCache[key];
  if (pc && pc.ready) return pc.st;
  if (pc) return pc.failed ? null : 'loading';
  const ent = (photoCache[key] = { ready: false });
  const img = new Image();
  img.onload = () => {
    const st0 = STYLES.find((q) => q.id === id), TW = 1080, TH = 1332;
    const c = mk(TW, TH), x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, TW, TH);
    const src = x.getImageData(0, 0, TW, TH).data, bk = new ImageData(TW, TH), fr = new ImageData(TW, TH); let fsum = 0;
    for (let i = 0; i < src.length; i += 4) {
      const a = src[i + 3]; if (!a) continue; const f = src[i + 1] / 255;
      bk.data[i] = fr.data[i] = src[i]; bk.data[i + 1] = fr.data[i + 1] = 128;
      bk.data[i + 3] = a * (1 - f); fr.data[i + 3] = a * f; fsum += a * f;
    }
    const back = mk(TW, TH); back.getContext('2d').putImageData(bk, 0, 0);
    let front = null; if (fsum > 255 * 400) { front = mk(TW, TH); front.getContext('2d').putImageData(fr, 0, 0); }
    // underlay: a blurred, dilated copy of the hair next to the face (temples/sides/jaw), drawn darker underneath, so no skin/background
    // gap can open between the hair's inner edge and the customer's face oval (the oval occluder covers it where the face is)
    const q = 4, uw = TW / q, uh = TH / q, u = mk(uw, uh), ux = u.getContext('2d', { willReadFrequently: true });
    const all = mk(TW, TH); all.getContext('2d').drawImage(img, 0, 0, TW, TH);
    { const ax = all.getContext('2d'); const d = ax.getImageData(0, 0, TW, TH); for (let i = 0; i < d.data.length; i += 4) d.data[i + 1] = 128; ax.putImageData(d, 0, 0); }
    ux.filter = 'blur(12px)'; ux.drawImage(all, 0, 0, uw, uh); ux.filter = 'none';
    const ud = ux.getImageData(0, 0, uw, uh);
    for (let y = 0; y < uh; y++) for (let x = 0; x < uw; x++) {
      const i = (y * uw + x) * 4, cx = -3 + (x + 0.5) * q / 180, cy = -2.8 + (y + 0.5) * q / 180, ax2 = Math.abs(cx);
      const side = clamp((ax2 - (cy < -0.35 ? 0.58 : 0.42)) / 0.12, 0, 1), low = clamp((cy + 0.35) / 0.15, 0, 1), ex = cx / 1.18, ey = (cy - 0.15) / 1.5, band = clamp((1 - (ex * ex + ey * ey)) / 0.12, 0, 1);
      const a = ud.data[i + 3]; if (a) { const inv = 255 / a; ud.data[i] = Math.min(255, ud.data[i]); }
      const tz = clamp((ax2 - 0.5) / 0.15, 0, 1) * clamp((1.05 - ax2) / 0.1, 0, 1) * clamp((cy + 1.4) / 0.15, 0, 1) * clamp((-0.4 - cy) / 0.2, 0, 1); // upper temples
      ud.data[i + 3] = Math.min(255, a * (4 + 12 * tz)) * Math.max(side, low) * Math.max(band, tz); ud.data[i + 1] = 128;
    }
    ux.putImageData(ud, 0, 0);
    const under = mk(TW, TH); { const ux2 = under.getContext('2d'); ux2.imageSmoothingQuality = 'high'; ux2.drawImage(u, 0, 0, TW, TH); }
    ent.st = { back, front, under, id: 'p:' + id, bang: b, g: st0.g, ears: !!st0.ears, photo: true, hl: (e.hl || {})[b] }; ent.ready = true;
    if (S.style === id) rerender();
  };
  img.onerror = () => { ent.failed = true; };
  img.src = new URL('./assets/hair/' + file, import.meta.url).href;
  return 'loading';
}
function currentStyle() {
  if (S.style === 'none') return null;
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
    if (Object.keys(colorCache).length > 8) for (const k in colorCache) delete colorCache[k];
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
    let HA = P.aff;
    if (st.photo && st.hl && st.hl < -0.9) { // fit the template's hairline onto the customer's natural hairline (scale about the crown)
      const tgt = naturalHairline(P, mask);
      const k = clamp((tgt + 2.0) / (st.hl + 2.0), 1, 1.3), A = P.aff;
      HA = { a: A.a, b: A.b, c: A.c * k, d: A.d * k, e: A.e + A.c * -2.0 * (1 - k), f: A.f + A.d * -2.0 * (1 - k) };
      stats.hairFit = { tgt: +tgt.toFixed(3), hl: st.hl, k: +k.toFixed(3) };
    }
    const col = coloredStyle(st), T = templateTransform(HA);
    outX.drawImage(baseC, 0, 0);
    if (col.under && !S.dbgNoUnder) { outX.save(); outX.setTransform(...T); outX.filter = st.g === 'm' ? 'brightness(0.8) blur(2px)' : 'brightness(0.7)'; outX.drawImage(col.under, 0, 0); outX.restore(); }
    if (!S.dbgNoBack) { outX.save(); outX.setTransform(...T); outX.imageSmoothingQuality = 'high'; outX.drawImage(col.back, 0, 0); outX.restore(); }
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
    // feather the hairline: fade the top of the forehead so the hair behind shows through softly
    const fh = Math.hypot(P.chin.x - P.top.x, P.chin.y - P.top.y), ux = (P.chin.x - P.top.x) / fh, uy = (P.chin.y - P.top.y) / fh;
    const g = occ2X.createLinearGradient(P.top.x * kx, P.top.y * ky, (P.top.x + ux * fh * 0.09) * kx, (P.top.y + uy * fh * 0.09) * ky);
    g.addColorStop(0, 'rgba(0,0,0,0.8)'); g.addColorStop(0.45, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    if (!st.photo) { occ2X.globalCompositeOperation = 'destination-out'; occ2X.fillStyle = g; occ2X.fillRect(0, 0, ow, oh); occ2X.globalCompositeOperation = 'source-over'; }
    occFX.globalCompositeOperation = 'source-over'; occFX.clearRect(0, 0, W, H); occFX.drawImage(baseC, 0, 0);
    occFX.globalCompositeOperation = 'destination-in'; occFX.imageSmoothingEnabled = true; occFX.drawImage(occ2, 0, 0, W, H);
    occFX.globalCompositeOperation = 'source-over';
    outX.drawImage(occFC, 0, 0);
    // contact shadow on the face where hair meets it (temples/sides/forehead), not on the chin (procedural styles only; photo hair carries its own shading)
    if (!st.photo) {
      const sw2 = Math.round(W / 8), sh2 = Math.round(H / 8), kx2 = sw2 / W, ky2 = sh2 / H; ensure(cshC, sw2, sh2);
      cshX.globalCompositeOperation = 'source-over'; cshX.clearRect(0, 0, sw2, sh2);
      const ovalPath = () => { cshX.beginPath(); P.oval.forEach((p, i) => { i ? cshX.lineTo(p.x * kx2, p.y * ky2) : cshX.moveTo(p.x * kx2, p.y * ky2); }); cshX.closePath(); };
      cshX.strokeStyle = '#000'; cshX.lineWidth = fh * kx2 * (st.g === 'm' ? 0.07 : 0.11); ovalPath(); cshX.stroke();
      cshX.globalCompositeOperation = 'destination-in'; cshX.fillStyle = '#000'; ovalPath(); cshX.fill();
      const gg = cshX.createLinearGradient(P.top.x * kx2, P.top.y * ky2, P.chin.x * kx2, P.chin.y * ky2);
      gg.addColorStop(0, 'rgba(0,0,0,1)'); gg.addColorStop(0.4, 'rgba(0,0,0,0.55)'); gg.addColorStop(0.72, 'rgba(0,0,0,0)');
      cshX.fillStyle = gg; cshX.fillRect(0, 0, sw2, sh2);
      outX.save(); outX.globalAlpha = st.photo ? 0.12 : 0.18; outX.imageSmoothingEnabled = true; outX.drawImage(cshC, 0, 0, W, H); outX.restore();
    }
    if (col.front && !S.dbgNoFront) {
      // soft drop shadow of bangs / side locks onto the face
      const sw3 = Math.round(W / 6), sh3 = Math.round(H / 6); ensure(cshC2, sw3, sh3);
      cshX2.globalCompositeOperation = 'source-over'; cshX2.clearRect(0, 0, sw3, sh3);
      cshX2.setTransform(...T.map((v, i) => v * (i % 2 === 0 ? sw3 / W : sh3 / H)));
      cshX2.drawImage(col.front, 0, 0); cshX2.setTransform(1, 0, 0, 1, 0, 0);
      cshX2.globalCompositeOperation = 'source-in'; cshX2.fillStyle = 'rgb(30,15,10)'; cshX2.fillRect(0, 0, sw3, sh3);
      outX.save(); outX.globalAlpha = st.photo ? 0.16 : 0.3; outX.drawImage(cshC2, 0, fh * (st.photo ? 0.012 : 0.025), W, H); outX.restore();
      outX.save(); outX.setTransform(...T); outX.drawImage(col.front, 0, 0); outX.restore();
    }
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
  if (S.noHiGlasses || !stage.clientWidth) return 1;
  const tw = S.compare === 'split' ? W * 2 : W, fit = Math.min(stage.clientWidth / tw, stage.clientHeight / H) * (window.devicePixelRatio || 1);
  let s = Math.min(2.5, Math.max(1, fit), 2600 / Math.max(tw, H));
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
  const x = target.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  let after = outC;
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

/* ------------------------------------------------------------------ live mode */
const LIVE_CAP = +(new URLSearchParams(location.search).get('res') || 800);
let frameNo = 0, fpsT0 = 0, fpsN = 0;
function liveSize() { const vw = video.videoWidth, vh = video.videoHeight, s = Math.min(1, LIVE_CAP / Math.max(vw, vh)); return [Math.round(vw * s), Math.round(vh * s)]; }
function liveLoop() {
  liveRAF = requestAnimationFrame(liveLoop);
  if (S.mode !== 'live' || switching || video.readyState < 2 || !video.videoWidth) return;
  const t0 = performance.now(), [W, H] = liveSize();
  if (rawC.width !== W || rawC.height !== H) { rawC.width = W; rawC.height = H; hairMask = null; }
  rawX.drawImage(video, 0, 0, W, H);
  try { const r = face.detectForVideo(video, t0); const p = extractLm(r, W, H, t0); if (!p) resetFilters(); lm = p; } catch (e) { console.warn(e); }
  const t1 = performance.now(); stats.detMs = stats.detMs * 0.9 + (t1 - t0) * 0.1;
  frameNo++;
  const needSeg = S.hair || S.style !== 'none';
  if (needSeg && frameNo % stats.segEvery === 0) {
    segInputFrom(rawC, W, H, 256);
    try { seg.segmentForVideo(segIn, t0, (res) => { const ti = performance.now(); stats.inferMs = ti - t1; const m = takeMasks(res); stats.takeMs = performance.now() - ti; if (m) hairMask = buildSeg(m.masks, m.w, m.h, hairMask, lm); stats.postMs = performance.now() - ti; }); } catch (e) { console.warn(e); }
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
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error(window.isSecureContext ? '이 브라우저는 카메라를 지원하지 않아요' : 'HTTPS 주소에서만 카메라를 쓸 수 있어요');
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: S.facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
  video.srcObject = stream; await video.play();
  const st = stream.getVideoTracks()[0].getSettings(); mirror = (st.facingMode || S.facing) !== 'environment'; cameraOK = true;
}
async function goLive() {
  if (!face) return;
  try {
    if (!cameraOK) await startCamera();
    await ensureMode('VIDEO');
    S.mode = 'live'; hairMask = null; lm = null; origHex = null; grainC = null; look = null; resetFilters();
    stage.classList.remove('is-still', 'no-live'); $('placeholder').classList.add('hide');
    $('btnLive').classList.add('on'); $('btnPhoto').classList.remove('on');
    if (!liveRAF) liveLoop();
  } catch (e) { console.warn(e); cameraOK = false; toast('카메라를 쓸 수 없어요: ' + (e.message || e.name || e)); showPhotoMode(); }
}
function stopLoop() { if (liveRAF) cancelAnimationFrame(liveRAF); liveRAF = 0; }

/* ------------------------------------------------------------------ still (photo / captured) */
let lastStillMasks = null;
async function analyzeStill() {
  await ensureMode('IMAGE');
  const W = rawC.width, H = rawC.height;
  const r = face.detect(rawC);
  lm = extractLm(r, W, H);
  window.__pc.rawLm = r.faceLandmarks && r.faceLandmarks[0] ? r.faceLandmarks[0].map((q) => [q.x * W, q.y * H]) : null;
  segInputFrom(rawC, W, H, 640);
  hairMask = null;
  const res = seg.segment(segIn); const m = takeMasks(res);
  lastStillMasks = m;
  if (m) hairMask = buildSeg(m.masks, m.w, m.h, null, lm);
  if (res && res.close) res.close();
  window.__pc.lastAnalysis = { face: !!lm, hairCover: hairMask ? hairMask.cover : 0, W, H, maskW: m && m.w, maskH: m && m.h };
}
function rebuildStillSeg() { // style toggled on a still: recompute inpaint/neck from cached masks
  if (S.mode !== 'still' || !lastStillMasks) return;
  segInputFrom(rawC, rawC.width, rawC.height, 640);
  hairMask = buildSeg(lastStillMasks.masks, lastStillMasks.w, lastStillMasks.h, null, lm);
}
function renderStill() { if (S.mode !== 'still') return; compose(rawC.width, rawC.height, lm, hairMask); present(); }
async function loadStillFrom(src, sw, sh, mirrorIt) {
  stopLoop(); S.mode = 'still'; mirror = mirrorIt; origHex = null; grainC = null; look = null;
  const s = Math.min(1, 1600 / Math.max(sw, sh));
  rawC.width = Math.round(sw * s); rawC.height = Math.round(sh * s);
  rawX.drawImage(src, 0, 0, rawC.width, rawC.height);
  stage.classList.add('is-still'); $('placeholder').classList.add('hide');
  compose(rawC.width, rawC.height, null, null); present();
  setStatus('분석 중…'); $('fps').textContent = '';
  try { await analyzeStill(); } catch (e) { console.error(e); toast('분석 중 오류가 났어요'); }
  setStatus(lm ? '✓ 얼굴 인식 완료' : '얼굴을 찾지 못했어요 (헤어 컬러만 적용)');
  if (!lm) toast('얼굴을 찾지 못했어요. 정면 사진이 가장 잘 돼요.');
  renderStill();
}
async function capture() { if (S.mode !== 'live' || !video.videoWidth) return; await loadStillFrom(video, video.videoWidth, video.videoHeight, mirror); toast('촬영했어요! 저장하거나 컬러·스타일을 계속 바꿔보세요.'); }
async function loadFile(file) {
  if (!file) return;
  try { const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); await loadStillFrom(bmp, bmp.width, bmp.height, false); $('btnPhoto').classList.add('on'); $('btnLive').classList.remove('on'); }
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
  const c = mk(); present(c, true);
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
function exportBlob() { return new Promise((res) => buildExport().toBlob(res, 'image/png')); }
async function save() {
  const blob = await exportBlob(), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `personal-color_${S.type}_${Date.now()}.png`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000); toast('이미지를 저장했어요');
}
async function share() {
  const blob = await exportBlob(), file = new File([blob], 'personal-color.png', { type: 'image/png' });
  try { await navigator.share({ files: [file], title: '퍼스널컬러 가상 피팅' }); } catch (e) { if (e.name !== 'AbortError') toast('공유할 수 없어요'); }
}

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
  $('styleList').innerHTML = list.map((s) => `<button class="style ${S.style === s.id ? 'on' : ''}" data-style="${s.id}">${photoEntry(s.id) ? `<img src="assets/hair/thumbs/${s.id}.jpg" alt="" loading="lazy">` : styleIconSVG(s)}<span>${s.n}</span></button>`).join('');
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
  $('styleList').addEventListener('click', (ev) => { const b = ev.target.closest('[data-style]'); if (b) selectStyle(b.dataset.style); });
  $('bangList').addEventListener('click', (ev) => { const b = ev.target.closest('[data-bang]'); if (b) selectStyle(S.style, b.dataset.bang); });
  $('worstToggle').addEventListener('change', (ev) => { S.showWorst = ev.target.checked; renderHair(); renderFrames(); });
  let rq = 0; const throttled = () => { if (!rq) rq = requestAnimationFrame(() => { rq = 0; rerender(); }); };
  $('intensity').addEventListener('input', (ev) => { S.intensity = ev.target.value / 100; $('intensityVal').textContent = ev.target.value + '%'; throttled(); });
  $('gSize').addEventListener('input', (ev) => { S.gScale = ev.target.value / 100; $('gSizeVal').textContent = ev.target.value + '%'; throttled(); });
  const hold = (el) => {
    const on = (e) => { e.preventDefault(); S.holdBefore = true; rerender(); }, off = () => { if (S.holdBefore) { S.holdBefore = false; rerender(); } };
    el.addEventListener('pointerdown', on); ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => el.addEventListener(t, off)); el.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  hold($('btnHold')); hold($('btnHold2'));
  $('cmpAfter').onclick = () => { S.compare = 'after'; $('cmpAfter').classList.add('on'); $('cmpSplit').classList.remove('on'); rerender(); };
  $('cmpSplit').onclick = () => { S.compare = 'split'; $('cmpSplit').classList.add('on'); $('cmpAfter').classList.remove('on'); rerender(); };
  $('btnCapture').onclick = capture; $('btnRelive').onclick = goLive; $('btnLive').onclick = goLive; $('phCamera').onclick = goLive;
  $('btnPhoto').onclick = showPhotoMode; $('phSample').onclick = loadSample;
  $('btnFlip').onclick = async () => { S.facing = S.facing === 'user' ? 'environment' : 'user'; cameraOK = false; await goLive(); };
  $('fileInput').onchange = (e) => loadFile(e.target.files[0]); $('fileInput2').onchange = (e) => loadFile(e.target.files[0]);
  $('btnSave').onclick = save;
  if (navigator.canShare && navigator.canShare({ files: [new File([''], 'a.png', { type: 'image/png' })] })) { $('btnShare').hidden = false; $('btnShare').onclick = share; }
}

/* ------------------------------------------------------------------ boot */

/* ------------------------------------------------------------------ recommendation step (cover -> capture -> analysis -> result -> live) */
const rc = { el: $('reco'), raf: 0, res: null, an: null, combos: [], cur: 0, sel: null, done: null, gender: 'f', busy: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function rcShow(part) { for (const id of ['rcCap', 'rcBusy', 'rcRes']) $(id).hidden = id !== part; $('rcStep').textContent = part === 'rcRes' ? '추천 결과' : part === 'rcBusy' ? '분석 중' : '추천 진단'; }
function rcPreviewLoop() {
  rc.raf = requestAnimationFrame(rcPreviewLoop);
  if (!video.videoWidth) return; const c = $('rcVideo'), vw = video.videoWidth, vh = video.videoHeight;
  const cw = c.clientWidth * (devicePixelRatio || 1), ch = c.clientHeight * (devicePixelRatio || 1); if (!cw || !ch) return;
  if (c.width !== Math.round(cw) || c.height !== Math.round(ch)) { c.width = Math.round(cw); c.height = Math.round(ch); }
  const x = c.getContext('2d'), s = Math.max(c.width / vw, c.height / vh);
  x.save(); if (mirror) { x.translate(c.width, 0); x.scale(-1, 1); } x.drawImage(video, (c.width - vw * s) / 2, (c.height - vh * s) / 2, vw * s, vh * s); x.restore();
}
function rcStopPreview() { if (rc.raf) cancelAnimationFrame(rc.raf); rc.raf = 0; }
function recoFlow() { // resolves with 'live' | 'skip'
  rc.el.hidden = false; document.body.classList.add('reco-on'); rcShow('rcCap'); rc.gender = S.gender || 'f';
  $('rcShot').disabled = !cameraOK; $('rcHint').textContent = cameraOK ? '정면을 바라봐 주세요' : '카메라를 쓸 수 없어요 · 사진을 올려 주세요';
  if (cameraOK) rcPreviewLoop();
  return new Promise((r) => { rc.done = r; });
}
function rcClose(how) { rcStopPreview(); rc.el.hidden = true; document.body.classList.remove('reco-on'); const d = rc.done; rc.done = null; d && d(how); }
async function rcAnalyze(src, sw, sh, mir) {
  if (rc.busy) return; rc.busy = true; rcStopPreview(); rcShow('rcBusy');
  try {
    Object.assign(S, { style: 'none', bang: null, hair: null, shape: 'none' });
    await loadStillFrom(src, sw, sh, mir);
    const p = window.__pc.rawLm;
    if (!lm || !p) { toast('얼굴을 찾지 못했어요. 정면으로 다시 찍어 주세요.'); rcShow('rcCap'); if (cameraOK) rcPreviewLoop(); return; }
    const img = rawX.getImageData(0, 0, rawC.width, rawC.height);
    const fm = faceMetrics(p), fc = classifyFace(fm), cm = colorMetrics(img, rawC.width, rawC.height, p, hairMask && hairMask.meanRGB), cc = classifyColor(cm);
    rc.an = { fm, fc, cm, cc, type: cc.type, sub: cc.sub };
    window.__pc.reco = rc;
    await rcBuild(true);
    rcShow('rcRes');
  } catch (e) { console.error(e); toast('분석 중 오류가 났어요'); rcShow('rcCap'); if (cameraOK) rcPreviewLoop(); }
  finally { rc.busy = false; }
}
async function rcBuild(full) {
  const a = rc.an;
  rc.res = recommend({ shape: a.fc.shape, type: a.type, sub: a.sub, gender: rc.gender, TYPES, FRAMES, SHAPE_BY_ID });
  rc.combos = [0, 1, 2].map((i) => ({ g: rc.res.glasses[i] || rc.res.glasses[0], h: rc.res.hair[i] || rc.res.hair[0], c: rc.res.colors[i] || rc.res.colors[0] }));
  rc.sel = { ...rc.combos[0] }; rc.cur = 0;
  rcRenderText();
  // thumbnails of the three combos rendered on the customer's photo, then the #1 combo large
  const th = $('rcThumbs'); th.innerHTML = rc.combos.map((c, i) => `<button class="rc-th ${i === 0 ? 'on' : ''}" data-i="${i}"><canvas></canvas><span>추천 ${i + 1}</span></button>`).join('');
  for (let i = 0; i < 3; i++) await rcRender(rc.combos[i], th.children[i].querySelector('canvas'), 'thumb');
  await rcRender(rc.sel, $('rcMain'), 'main');
}
async function rcRender(cb, canvas, kind) {
  const was = S.style, wasBang = S.bang;
  Object.assign(S, { type: rc.an.type, sub: rc.an.sub, gender: rc.gender, style: cb.h.style, bang: cb.h.bang, hair: cb.c.hair, shape: cb.g.shape, frame: cb.g.frame, noHiGlasses: true, compare: 'after', holdBefore: false });
  for (let t = 0; t < 120 && !currentStyle(); t++) await sleep(50);
  if (was !== S.style || wasBang !== S.bang || !hairMask || !hairMask.fill) rebuildStillSeg();
  for (let t = 0; t < 60; t++) { compose(rawC.width, rawC.height, lm, hairMask); if (stats.glass3d) break; await sleep(50); }
  compose(rawC.width, rawC.height, lm, hairMask); S.noHiGlasses = false;
  const fh = Math.hypot(lm.chin.x - lm.top.x, lm.chin.y - lm.top.y); let cx = (lm.top.x + lm.chin.x) / 2, cy = (lm.top.y + lm.chin.y) / 2 - fh * 0.12;
  const ar = kind === 'main' ? 0.8 : 1; let hh = Math.min(fh * (kind === 'main' ? 2.3 : 1.85), outC.height), ww = hh * ar;
  if (ww > outC.width) { ww = outC.width; hh = ww / ar; }
  cx = clamp(cx, ww / 2, outC.width - ww / 2); cy = clamp(cy, hh / 2, outC.height - hh / 2);
  const dpr = devicePixelRatio || 1, cw = Math.round((canvas.clientWidth || (kind === 'main' ? 480 : 140)) * dpr);
  canvas.width = cw; canvas.height = Math.round(cw / ar);
  const x = canvas.getContext('2d'); x.imageSmoothingQuality = 'high'; x.fillStyle = '#eee9e2'; x.fillRect(0, 0, canvas.width, canvas.height);
  x.save(); if (mirror) { x.translate(canvas.width, 0); x.scale(-1, 1); }
  // crop rect around the face, clipped to the photo (keeps the mapping exact when the crop runs past an edge)
  const k = canvas.width / ww, X0 = cx - ww / 2, Y0 = cy - hh / 2;
  const ax = Math.max(0, X0), ay = Math.max(0, Y0), bx = Math.min(outC.width, X0 + ww), by = Math.min(outC.height, Y0 + hh);
  if (bx > ax && by > ay) x.drawImage(outC, ax, ay, bx - ax, by - ay, (ax - X0) * k, (ay - Y0) * k, (bx - ax) * k, (by - ay) * k);
  x.restore();
}
const FACE_WHY = { oval: '이마·광대·턱의 폭과 길이 비율이 고르게 균형 잡힌 얼굴형', round: '얼굴 길이가 짧고 턱선이 부드러운 곡선형', square: '턱 끝 폭이 넓고 턱 각이 또렷한 얼굴형', long: '얼굴 폭에 비해 세로 길이가 긴 얼굴형', heart: '이마가 넓고 턱으로 갈수록 좁아지는 얼굴형', diamond: '광대가 가장 넓고 이마·턱이 좁은 얼굴형' };
function rcRenderText() {
  const a = rc.an, T = TYPES[a.type], subN = T.subs.find((q) => q[0] === a.sub)?.[1] || '', est = TYPES[a.cc.type];
  const tone = a.cc.warm >= 0 ? '웜' : '쿨', conf = a.cc.conf > 0.6 ? '뚜렷함' : a.cc.conf > 0.25 ? '보통' : '경계(직접 확인 권장)';
  $('rcSum').innerHTML = `<div class="rc-chip"><small>얼굴형</small><b>${SHAPES_KO[a.fc.shape]}</b><span>${FACE_WHY[a.fc.shape]}</span></div>
    <div class="rc-chip"><small>퍼스널컬러 ${a.type === a.cc.type && a.sub === a.cc.sub ? '추정' : '선택'}</small><b>${T.n} ${subN}</b><span>분석 추정: ${est.n} · 언더톤 ${tone} (${conf})</span></div>`;
  $('rcTypes').innerHTML = Object.entries(TYPES).map(([k, t]) => `<button class="${a.type === k ? 'on' : ''}" data-type="${k}">${t.n}</button>`).join('');
  $('rcSubs').innerHTML = T.subs.map(([k, n]) => `<button class="${a.sub === k ? 'on' : ''}" data-sub="${k}">${n}</button>`).join('');
  $('rcGender').innerHTML = [['f', '여성'], ['m', '남성']].map(([k, n]) => `<button class="${rc.gender === k ? 'on' : ''}" data-g="${k}">${n}</button>`).join('');
  const shN = (id) => SHAPES.find((q) => q.id === id)?.n || id, stN = (id) => STYLES.find((q) => q.id === id)?.n || id;
  $('rcGlasses').innerHTML = rc.res.glasses.map((g, i) => `<li class="${rc.sel && rc.sel.g === g ? 'on' : ''}" data-k="g" data-i="${i}"><b>${shN(g.shape)} · ${FRAMES[g.frame].n}</b><span>${g.why}</span></li>`).join('');
  $('rcHair').innerHTML = rc.res.hair.map((h, i) => `<li class="${rc.sel && rc.sel.h === h ? 'on' : ''}" data-k="h" data-i="${i}"><b>${stN(h.style)}${h.bang && BANGS[h.bang] && h.bang !== 'none' ? ' · ' + BANGS[h.bang].n : ''}</b><span>${h.why}</span></li>`).join('');
  $('rcColors').innerHTML = rc.res.colors.map((c, i) => `<li class="${rc.sel && rc.sel.c === c ? 'on' : ''}" data-k="c" data-i="${i}"><i style="background:${c.hair.c}"></i><b>${c.hair.n}</b><span>${c.why}</span></li>`).join('');
}
async function rcSelect(next) { rc.sel = next; rcRenderText(); await rcRender(rc.sel, $('rcMain'), 'main'); }
function rcBind() {
  $('rcSkip').onclick = () => rcClose('skip');
  $('rcShot').onclick = () => { if (cameraOK && video.videoWidth) rcAnalyze(video, video.videoWidth, video.videoHeight, mirror); };
  $('rcFile').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }); rcAnalyze(bmp, bmp.width, bmp.height, false); } catch (er) { toast('사진을 열 수 없어요'); } };
  $('rcRetake').onclick = () => { rcShow('rcCap'); if (cameraOK) rcPreviewLoop(); };
  $('rcThumbs').onclick = (e) => { const b = e.target.closest('[data-i]'); if (!b || rc.busy) return; [...$('rcThumbs').children].forEach((q) => q.classList.toggle('on', q === b)); rcSelect({ ...rc.combos[+b.dataset.i] }); };
  const lists = (e) => { const li = e.target.closest('li[data-k]'); if (!li || rc.busy) return; const k = li.dataset.k, i = +li.dataset.i; const src = k === 'g' ? rc.res.glasses : k === 'h' ? rc.res.hair : rc.res.colors; rcSelect({ ...rc.sel, [k]: src[i] }); };
  ['rcGlasses', 'rcHair', 'rcColors'].forEach((id) => { $(id).onclick = lists; });
  $('rcTypes').onclick = async (e) => { const b = e.target.closest('[data-type]'); if (!b || rc.busy) return; rc.an.type = b.dataset.type; rc.an.sub = rc.an.type === rc.an.cc.type ? rc.an.cc.sub : TYPES[rc.an.type].subs[0][0]; rc.busy = true; try { await rcBuild(); } finally { rc.busy = false; } };
  $('rcSubs').onclick = async (e) => { const b = e.target.closest('[data-sub]'); if (!b || rc.busy) return; rc.an.sub = b.dataset.sub; rc.busy = true; try { await rcBuild(); } finally { rc.busy = false; } };
  $('rcGender').onclick = async (e) => { const b = e.target.closest('[data-g]'); if (!b || rc.busy) return; rc.gender = b.dataset.g; rc.busy = true; try { await rcBuild(); } finally { rc.busy = false; } };
  $('rcGo').onclick = () => { // apply the previewed combo to the main screen, then go live
    const c = rc.sel; Object.assign(S, { type: rc.an.type, sub: rc.an.sub, gender: rc.gender, style: c.h.style, bang: c.h.bang, hair: c.c.hair, shape: c.g.shape, frame: c.g.frame });
    renderTypes(); renderHair(); renderFrames(); renderShapes(); renderStyles();
    rcClose('live');
  };
}

/* ------------------------------------------------------------------ cover (intro) */
// shown on every launch (in-store: one cover per customer); models load in the background, the camera is only requested after the tap
const S0 = { ...S };
let modelsReady = false, modelsFailed = false, coverResolve = null;
const coverEl = $('cover');
function coverLoad(t) { const e = $('cvLoad'); if (e) e.textContent = t; }
function showCover() {
  stopLoop();
  if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; cameraOK = false; video.srcObject = null;
  // fresh session for the next customer: default selections, no photo left on screen
  Object.assign(S, S0, { mode: 'still' }); hairMask = null; lm = null; origHex = null; grainC = null; look = null; lastStillMasks = null;
  rawC.width = rawC.height = 1; const vx = view.getContext('2d'); vx.clearRect(0, 0, view.width, view.height);
  stage.classList.remove('is-still'); $('placeholder').classList.remove('hide'); $('phText').textContent = '카메라를 준비하는 중…';
  $('intensity').value = 75; $('intensityVal').textContent = '75%'; $('gSize').value = 100; $('gSizeVal').textContent = '100%'; $('worstToggle').checked = false;
  renderTypes(); renderHair(); renderFrames(); renderShapes(); renderStyles(); setStatus(''); $('fps').textContent = '';
  coverEl.classList.remove('hide'); coverEl.hidden = false; document.body.classList.add('cover-on'); scrollTo(0, 0);
  coverLoad(modelsReady ? '' : '준비 중…');
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
  if (modelsFailed) return;
  if (!modelsReady) { $('placeholder').classList.remove('hide'); $('phText').textContent = '모델을 불러오는 중이에요…'; await modelsP; if (modelsFailed) return; }
  if (navigator.mediaDevices?.getUserMedia) {
    $('phText').textContent = '카메라를 켜는 중… (권한을 허용해 주세요)';
    // ask for the camera right away (inside the tap), but start the heavy live loop only once the fade has finished
    const fade = new Promise((r) => setTimeout(r, 720));
    try { if (!cameraOK) await startCamera(); } catch (e) { console.warn(e); }
    await fade;
  }
  const how = new URLSearchParams(location.search).has('noreco') ? 'skip' : await recoFlow();
  if (cameraOK) await goLive();
  else if (how === 'live' && lm) { S.mode = 'still'; stage.classList.add('is-still'); $('placeholder').classList.add('hide'); rebuildStillSeg(); renderStill(); showPhotoMode(); }
  else showPhotoMode();
}
let modelsP = null;
async function boot() {
  renderTypes(); renderHair(); renderFrames(); renderShapes(); renderStyles(); bindUI(); rcBind();
  const params = new URLSearchParams(location.search);
  const skipCover = params.has('nocover') || params.has('photo') || params.has('sample');
  modelsP = loadModels().then(() => { modelsReady = true; coverLoad(''); setStatus(`모델 준비 완료 (${delegate})`); },
    (e) => { console.error(e); modelsFailed = true; coverLoad('AI 모델을 불러오지 못했어요 · 인터넷 연결 확인 후 새로고침'); $('phText').textContent = 'AI 모델을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침 해주세요.'; setStatus('모델 로딩 실패'); });
  $('btnHome').onclick = async () => { await showCover(); startSession(); };
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
boot().then(() => { window.__pc.ready = true; });

// ---------- PWA: service worker + install button ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !new URLSearchParams(location.search).has('nosw')) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW', e)));
}
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
