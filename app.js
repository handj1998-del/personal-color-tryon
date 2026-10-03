// 퍼스널컬러 가상 피팅 — 100% client-side. Photos/video never leave the device.
import { FRAMES, SHAPES, drawGlasses, shapeIconSVG, mix, rgba } from './frames.js';
import { PROVIDERS, loadSettings, saveSettings, modelOf, generate as aiGenerate, errorMessage as aiErrorMessage, buildPrompt } from './ai.js';
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
const recC = mk(), recX = recC.getContext('2d');
const glassC = mk(), glassX = glassC.getContext('2d');
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
  out.aff = fitAffine([[...CANON[234], out.eL.x, out.eL.y, 2], [...CANON[454], out.eR.x, out.eR.y, 2], [...CANON[10], out.top.x, out.top.y, 1], [...CANON[152], out.chin.x, out.chin.y, 1]]);
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
    let inOval = null;
    if (P) {
      ensure(occC, w, h); occX.clearRect(0, 0, w, h); occX.fillStyle = '#fff'; occX.beginPath();
      P.oval.forEach((q, i) => { const x = q.x / segScaleX, y = q.y / segScaleY; i ? occX.lineTo(x, y) : occX.moveTo(x, y); });
      occX.closePath(); occX.fill(); const od = occX.getImageData(0, 0, w, h).data; inOval = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) inOval[i] = od[i * 4 + 3] > 100 ? 1 : 0;
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
    const known = new Float32Array(w * h), knownSkin = new Float32Array(w * h), hole = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const hv = clamp(dil[i] * 3.2 - 0.15, 0, 1); hole[i] = hv;
      known[i] = hv > 0.05 || (inOval && inOval[i]) ? 0 : 1; // background/clothes only
      if (hv < 0.05 && inOval && inOval[i]) { // skin-coloured pixels only (no brows/eyes/lips)
        if (!skin) knownSkin[i] = 1; else { const j = i * 4, d = Math.abs(px[j] - skin[0]) + Math.abs(px[j + 1] - skin[1]) + Math.abs(px[j + 2] - skin[2]); knownSkin[i] = d < 70 ? 1 : 0; }
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
    for (let i = 0; i < w * h; i++) {
      const src = skinFill && inOval[i] ? skinFill : refl;
      fid.data[i * 4] = src[i * 3]; fid.data[i * 4 + 1] = src[i * 3 + 1]; fid.data[i * 4 + 2] = src[i * 3 + 2]; fid.data[i * 4 + 3] = hole[i] * 255;
    }
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
function currentStyle() {
  if (S.style === 'none') return null;
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
    colorCache[key] = { back: colorize(st.back, hex, hairLUT, lk), front: st.front ? colorize(st.front, hex, hairLUT, lk) : null };
  }
  return colorCache[key];
}

/* ------------------------------------------------------------------ compositing */
function ensure(c, W, H) { if (c.width !== W || c.height !== H) { c.width = W; c.height = H; } }
function compose(W, H, P, mask) {
  ensure(outC, W, H); ensure(glassC, W, H);
  const t0 = performance.now();
  const ai = aiCurrent();
  if (ai) P = ai.lm || P;
  const st = !ai && P && P.aff ? currentStyle() : null;
  if (ai) {
    outX.drawImage(ai.c, 0, 0);
  } else if (st) {
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
    const col = coloredStyle(st), T = templateTransform(P.aff);
    outX.drawImage(baseC, 0, 0);
    outX.save(); outX.setTransform(...T); outX.imageSmoothingQuality = 'high'; outX.drawImage(col.back, 0, 0); outX.restore();
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
    // feather the hairline: fade the top of the forehead so the hair behind shows through softly
    const fh = Math.hypot(P.chin.x - P.top.x, P.chin.y - P.top.y), ux = (P.chin.x - P.top.x) / fh, uy = (P.chin.y - P.top.y) / fh;
    const g = occ2X.createLinearGradient(P.top.x * kx, P.top.y * ky, (P.top.x + ux * fh * 0.09) * kx, (P.top.y + uy * fh * 0.09) * ky);
    g.addColorStop(0, 'rgba(0,0,0,0.8)'); g.addColorStop(0.45, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    occ2X.globalCompositeOperation = 'destination-out'; occ2X.fillStyle = g; occ2X.fillRect(0, 0, ow, oh); occ2X.globalCompositeOperation = 'source-over';
    occFX.globalCompositeOperation = 'source-over'; occFX.clearRect(0, 0, W, H); occFX.drawImage(baseC, 0, 0);
    occFX.globalCompositeOperation = 'destination-in'; occFX.imageSmoothingEnabled = true; occFX.drawImage(occ2, 0, 0, W, H);
    occFX.globalCompositeOperation = 'source-over';
    outX.drawImage(occFC, 0, 0);
    // contact shadow on the face where hair meets it (temples/sides/forehead), not on the chin
    {
      const sw2 = Math.round(W / 8), sh2 = Math.round(H / 8), kx2 = sw2 / W, ky2 = sh2 / H; ensure(cshC, sw2, sh2);
      cshX.globalCompositeOperation = 'source-over'; cshX.clearRect(0, 0, sw2, sh2);
      const ovalPath = () => { cshX.beginPath(); P.oval.forEach((p, i) => { i ? cshX.lineTo(p.x * kx2, p.y * ky2) : cshX.moveTo(p.x * kx2, p.y * ky2); }); cshX.closePath(); };
      cshX.strokeStyle = '#000'; cshX.lineWidth = fh * kx2 * (st.g === 'm' ? 0.07 : 0.11); ovalPath(); cshX.stroke();
      cshX.globalCompositeOperation = 'destination-in'; cshX.fillStyle = '#000'; ovalPath(); cshX.fill();
      const gg = cshX.createLinearGradient(P.top.x * kx2, P.top.y * ky2, P.chin.x * kx2, P.chin.y * ky2);
      gg.addColorStop(0, 'rgba(0,0,0,1)'); gg.addColorStop(0.4, 'rgba(0,0,0,0.55)'); gg.addColorStop(0.72, 'rgba(0,0,0,0)');
      cshX.fillStyle = gg; cshX.fillRect(0, 0, sw2, sh2);
      outX.save(); outX.globalAlpha = 0.18; outX.imageSmoothingEnabled = true; outX.drawImage(cshC, 0, 0, W, H); outX.restore();
    }
    if (col.front) {
      // soft drop shadow of bangs / side locks onto the face
      const sw3 = Math.round(W / 6), sh3 = Math.round(H / 6); ensure(cshC2, sw3, sh3);
      cshX2.globalCompositeOperation = 'source-over'; cshX2.clearRect(0, 0, sw3, sh3);
      cshX2.setTransform(...T.map((v, i) => v * (i % 2 === 0 ? sw3 / W : sh3 / H)));
      cshX2.drawImage(col.front, 0, 0); cshX2.setTransform(1, 0, 0, 1, 0, 0);
      cshX2.globalCompositeOperation = 'source-in'; cshX2.fillStyle = 'rgb(30,15,10)'; cshX2.fillRect(0, 0, sw3, sh3);
      outX.save(); outX.globalAlpha = 0.3; outX.drawImage(cshC2, 0, fh * 0.025, W, H); outX.restore();
      outX.save(); outX.setTransform(...T); outX.drawImage(col.front, 0, 0); outX.restore();
    }
  } else {
    outX.drawImage(rawC, 0, 0);
    if (S.hair) applyHair(outX, W, H, mask, S.hair.c, S.intensity);
  }
  const t1 = performance.now(); stats.hairMs = stats.hairMs * 0.9 + (t1 - t0) * 0.1;
  if (P && S.shape !== 'none') {
    const sdef = S.style !== 'none' ? STYLES.find((q) => q.id === S.style) : null;
    drawGlasses(glassX, P, S.frame, S.shape, S.gScale, TYPES[S.type].warm, !!(sdef && sdef.g === 'f' && !sdef.ears));
    const d = Math.hypot(P.iR.x - P.iL.x, P.iR.y - P.iL.y);
    const sw = Math.max(8, Math.round(W / 6)), sh = Math.max(8, Math.round(H / 6));
    ensure(shadowC, sw, sh);
    shadowX.globalCompositeOperation = 'source-over'; shadowX.clearRect(0, 0, sw, sh); shadowX.drawImage(glassC, 0, 0, sw, sh);
    shadowX.globalCompositeOperation = 'source-in'; shadowX.fillStyle = 'rgb(25,12,12)'; shadowX.fillRect(0, 0, sw, sh);
    outX.save(); outX.globalAlpha = 0.32; outX.imageSmoothingEnabled = true; outX.drawImage(shadowC, 0, d * 0.035, W, H); outX.restore();
    outX.drawImage(glassC, 0, 0);
  }
  stats.glassMs = stats.glassMs * 0.9 + (performance.now() - t1) * 0.1;
}
function present(target = view, labels = true) {
  const W = rawC.width, H = rawC.height, split = S.compare === 'split', tw = split ? W * 2 : W;
  if (target.width !== tw || target.height !== H) { target.width = tw; target.height = H; }
  const x = target.getContext('2d');
  const panes = split ? [[rawC, 0, '원본 BEFORE'], [outC, W, 'AFTER']] : [[S.holdBefore ? rawC : outC, 0, S.holdBefore ? '원본' : '']];
  for (const [src, ox, label] of panes) {
    x.save(); if (mirror) { x.translate(ox + W, 0); x.scale(-1, 1); x.drawImage(src, 0, 0); } else x.drawImage(src, ox, 0); x.restore();
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
    updateAIUI();
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
  stopLoop(); S.mode = 'still'; mirror = mirrorIt; origHex = null; grainC = null; look = null; photoId++; aiCache.clear();
  const s = Math.min(1, 1600 / Math.max(sw, sh));
  rawC.width = Math.round(sw * s); rawC.height = Math.round(sh * s);
  rawX.drawImage(src, 0, 0, rawC.width, rawC.height);
  stage.classList.add('is-still'); $('placeholder').classList.add('hide');
  compose(rawC.width, rawC.height, null, null); present();
  setStatus('분석 중…'); $('fps').textContent = '';
  try { await analyzeStill(); } catch (e) { console.error(e); toast('분석 중 오류가 났어요'); }
  setStatus(lm ? '✓ 얼굴 인식 완료' : '얼굴을 찾지 못했어요 (헤어 컬러만 적용)');
  if (!lm) toast('얼굴을 찾지 못했어요. 정면 사진이 가장 잘 돼요.');
  renderStill(); updateAIUI();
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
  updateAIUI();
  if (rawC.width < 2 || (!lm && !hairMask)) { $('placeholder').classList.remove('hide'); $('phText').textContent = '사진을 올리거나 샘플 사진으로 시작해 보세요'; stage.classList.add('no-live'); }
}

/* ------------------------------------------------------------------ AI 실제 합성 (cloud, opt-in) */
let photoId = 0, aiAbort = null, aiSettings = loadSettings();
const aiCache = new Map();
S.aiView = true;
function aiKey() {
  const m = modelOf(aiSettings);
  return [photoId, S.style, S.style !== 'none' ? (S.bang || '') : '', S.hair ? S.hair.n : '', S.hair ? (S.intensity < 0.5 ? 's' : 'f') : '', aiSettings.provider + ':' + m.id, aiSettings.keepFace ? 1 : 0].join('|');
}
function aiCurrent() { return S.mode === 'still' && S.aiView ? aiCache.get(aiKey()) || null : null; }
function aiOpts() { const sd = STYLES.find((q) => q.id === S.style); return { style: S.style, bang: S.bang || (sd && sd.bang), gender: sd ? sd.g : S.gender, hair: S.hair, intensity: S.intensity }; }
function updateAIUI() {
  const btn = $('btnAI'), note = $('aiNote'), still = S.mode === 'still' && rawC.width > 2 && $('placeholder').classList.contains('hide');
  const has = S.mode === 'still' && aiCache.has(aiKey()), anyForPhoto = [...aiCache.keys()].some((k) => k.startsWith(photoId + '|'));
  const m = modelOf(aiSettings);
  btn.disabled = !still || !navigator.onLine || !!aiAbort;
  btn.textContent = has ? '✨ 다시 합성' : '✨ AI 실제 합성';
  $('aiView').hidden = !has;
  $('aiViewAI').classList.toggle('on', S.aiView); $('aiViewPrev').classList.toggle('on', !S.aiView);
  note.classList.toggle('warn', !navigator.onLine);
  if (!navigator.onLine) note.textContent = '📴 오프라인이에요. AI 실제 합성은 인터넷 연결이 필요해요 (다른 기능은 그대로 사용 가능).';
  else if (S.mode !== 'still') note.textContent = '📷 촬영하거나 사진을 올리면 선택한 헤어스타일·컬러를 실제 사진처럼 AI로 합성할 수 있어요.';
  else if (!aiSettings.key) note.textContent = '⚙️ AI 설정에서 API 키를 넣으면 사진처럼 자연스러운 AI 합성을 쓸 수 있어요.';
  else if (has) note.textContent = `✨ AI 합성 결과예요 (${m.n.split(' ·')[0]}). 안경은 그 위에 다시 씌워져요. ‘미리보기’로 기존 합성과 비교할 수 있어요.`;
  else note.textContent = `선택한 스타일·컬러로 AI 합성 · 1장 약 $${m.usd.toFixed(3)} (${PROVIDERS[aiSettings.provider].n})${anyForPhoto ? ' · 이전 결과는 스타일을 되돌리면 다시 보여요' : ''}`;
}
function sheet(id, show) { $(id).hidden = !show; }
function openSettings() {
  const st = aiSettings, P = PROVIDERS[st.provider] || PROVIDERS.gemini;
  $('aiProvider').innerHTML = Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}" ${k === st.provider ? 'selected' : ''}>${v.n}</option>`).join('');
  const fillModels = (pk) => { const PP = PROVIDERS[pk]; $('aiModel').innerHTML = PP.models.map((m) => `<option value="${m.id}">${m.n} · 약 $${m.usd}/장</option>`).join('');
    $('aiKeyLabel').textContent = PP.keyName; $('aiKey').placeholder = PP.keyHint;
    $('aiKeyHelp').innerHTML = `키 발급: <a href="${PP.signup}" target="_blank" rel="noopener">${PP.signup.replace('https://', '')}</a> ${pk === 'gemini' ? '(Google AI Studio → API 키 만들기. 이미지 모델은 결제(유료 등급) 설정이 필요해요)' : '(fal 대시보드 → Keys → Add key, 크레딧 충전 필요)'}`; };
  fillModels(st.provider); $('aiModel').value = modelOf(st).id;
  $('aiProvider').onchange = () => { fillModels($('aiProvider').value); $('aiKey').value = $('aiProvider').value === st.provider ? st.key : (st.keys && st.keys[$('aiProvider').value]) || ''; };
  $('aiKey').value = st.key || ''; $('aiKey').type = 'password'; $('aiKeepFace').checked = st.keepFace !== false;
  sheet('aiSettings', true);
}
function closeSettings(saveIt) {
  if (saveIt) {
    const pv = $('aiProvider').value, key = $('aiKey').value.trim();
    const keys = { ...(aiSettings.keys || {}) }; keys[pv] = key;
    aiSettings = { ...aiSettings, provider: pv, model: $('aiModel').value, key, keys, keepFace: $('aiKeepFace').checked };
    saveSettings(aiSettings); toast(key ? 'AI 설정을 저장했어요 (이 기기에만 저장)' : 'API 키가 비어 있어요');
  }
  sheet('aiSettings', false); rerender();
}
function askConsent() {
  return new Promise((res) => {
    const m = modelOf(aiSettings); $('consentProv').textContent = PROVIDERS[aiSettings.provider].n; $('consentCost').textContent = '$' + m.usd.toFixed(3);
    sheet('aiConsent', true);
    $('consentYes').onclick = () => { sheet('aiConsent', false); aiSettings.consent = true; saveSettings(aiSettings); res(true); };
    $('consentNo').onclick = () => { sheet('aiConsent', false); res(false); };
  });
}
// paste the ORIGINAL inner face (eyes/brows/nose/mouth) back onto the AI result, aligned with a fitted affine,
// so the customer's face stays pixel-identical. Skipped if the AI changed pose/expression too much.
function keepOriginalFace(aiC, P0, P1, bangsCover) {
  const ks = Object.keys(KEYS), fw = Math.hypot(P1.eR.x - P1.eL.x, P1.eR.y - P1.eL.y);
  const T = fitAffine(ks.map((k) => [P0[k].x, P0[k].y, P1[k].x, P1[k].y, 1]));
  const res = ks.reduce((a, k) => a + Math.hypot(T.a * P0[k].x + T.c * P0[k].y + T.e - P1[k].x, T.b * P0[k].x + T.d * P0[k].y + T.f - P1[k].y), 0) / ks.length / fw;
  if (!(res < 0.04)) return { ok: false, res };
  const W = aiC.width, H = aiC.height, k = 1 / 8, mw = Math.max(8, Math.round(W * k)), mh = Math.max(8, Math.round(H * k));
  const mc = mk(mw, mh), mx = mc.getContext('2d'), A = P1.aff, top = bangsCover ? -0.1 : -0.36;
  const R = [[0.6, top], [0.82, top + 0.12], [0.88, 0.25], [0.82, 0.62], [0.66, 0.92], [0.4, 1.17], [0, 1.28]];
  const poly = R.concat(R.slice(0, -1).reverse().map(([x, y]) => [-x, y]));
  mx.fillStyle = '#fff'; mx.beginPath();
  poly.forEach(([x, y], i) => { const u = (A.a * x + A.c * y + A.e) * k, v = (A.b * x + A.d * y + A.f) * k; i ? mx.lineTo(u, v) : mx.moveTo(u, v); });
  mx.closePath(); mx.fill();
  const mc2 = mk(mw, mh), mx2 = mc2.getContext('2d'); mx2.filter = 'blur(1.5px)'; mx2.drawImage(mc, 0, 0); // feather (no-op where unsupported)
  const fc = mk(W, H), fx = fc.getContext('2d');
  fx.setTransform(T.a, T.b, T.c, T.d, T.e, T.f); fx.drawImage(rawC, 0, 0); fx.setTransform(1, 0, 0, 1, 0, 0);
  fx.globalCompositeOperation = 'destination-in'; fx.imageSmoothingEnabled = true; fx.drawImage(mc2, 0, 0, W, H);
  aiC.getContext('2d').drawImage(fc, 0, 0);
  return { ok: true, res };
}
async function runAI() {
  if (S.mode !== 'still' || rawC.width < 2) return toast('사진 모드에서 사용할 수 있어요');
  if (!navigator.onLine) { updateAIUI(); return toast('오프라인에서는 AI 합성을 쓸 수 없어요'); }
  if (!aiSettings.key) { toast('먼저 AI 설정에서 API 키를 넣어 주세요'); return openSettings(); }
  if (S.style === 'none' && !S.hair) return toast('헤어스타일이나 헤어 컬러를 먼저 골라 주세요');
  if (!aiSettings.consent && !(await askConsent())) return;
  const key = aiKey(), myPhoto = photoId, t0 = performance.now(), m = modelOf(aiSettings);
  const expect = /pro/.test(m.id) ? 30 : /lite/.test(m.id) ? 8 : 15;
  aiAbort = new AbortController(); updateAIUI(); sheet('aiBusy', true);
  const tick = setInterval(() => { const s = (performance.now() - t0) / 1000; $('aiBusyText').textContent = `AI 합성 중… ${Math.round(s)}초 (보통 ${expect}초 안팎)`; $('aiBar').style.width = (95 * (1 - Math.exp(-s / expect * 1.4))).toFixed(1) + '%'; }, 250);
  try {
    const opts = aiOpts();
    const out = await aiGenerate(aiSettings, rawC, opts, aiAbort.signal);
    if (myPhoto !== photoId) return;
    $('aiBar').style.width = '100%'; $('aiBusyText').textContent = '얼굴 맞추는 중…';
    const W = rawC.width, H = rawC.height, c = mk(W, H), x = c.getContext('2d'), b = out.bitmap;
    const sc = Math.max(W / b.width, H / b.height), dw = b.width * sc, dh = b.height * sc; // cover-fit (ratios are matched, so ~no crop)
    x.drawImage(b, (W - dw) / 2, (H - dh) / 2, dw, dh); const bw = b.width, bh = b.height; b.close && b.close();
    await ensureMode('IMAGE');
    let aiLm = extractLm(face.detect(c), W, H), kept = null;
    if (aiSettings.keepFace !== false && lm && aiLm) {
      kept = keepOriginalFace(c, lm, aiLm, ['full', 'seethrough', 'side'].includes(opts.bang) && opts.gender !== 'm' || ['dandy', 'twoblock', 'leaf', 'comma'].includes(opts.style));
    }
    aiCache.set(key, { c, lm: aiLm || lm, prompt: out.prompt, model: out.model, ms: performance.now() - t0, kept });
    window.__pc.lastAI = { key, ms: Math.round(performance.now() - t0), model: out.model, prompt: out.prompt, faceFound: !!aiLm, kept, w: bw, h: bh };
    S.aiView = true;
    toast(aiLm ? `✨ AI 합성 완료 (${((performance.now() - t0) / 1000).toFixed(1)}초)` : 'AI 합성 완료 (얼굴을 다시 찾지 못해 안경은 원래 위치에 표시돼요)', 3200);
  } catch (e) {
    console.warn('AI', e); toast(aiErrorMessage(e), 5200);
    window.__pc.lastAIError = { kind: e.kind || e.name, msg: String(e.message || e) };
    if (e.kind === 'auth') openSettings();
  } finally {
    clearInterval(tick); sheet('aiBusy', false); aiAbort = null; rerender();
  }
}
function bindAI() {
  $('btnAI').onclick = runAI; $('btnAISettings').onclick = openSettings;
  $('aiCancel').onclick = () => aiAbort && aiAbort.abort();
  $('aiSetClose').onclick = () => closeSettings(true);
  $('aiKeyClear').onclick = () => { $('aiKey').value = ''; closeSettings(true); };
  $('aiKeyShow').onclick = () => { const i = $('aiKey'); i.type = i.type === 'password' ? 'text' : 'password'; $('aiKeyShow').textContent = i.type === 'password' ? '보기' : '숨기기'; };
  $('aiSettings').addEventListener('click', (e) => { if (e.target.id === 'aiSettings') closeSettings(false); });
  $('aiViewAI').onclick = () => { S.aiView = true; rerender(); };
  $('aiViewPrev').onclick = () => { S.aiView = false; rerender(); };
  addEventListener('online', updateAIUI); addEventListener('offline', updateAIUI);
  updateAIUI();
}
window.__pc.ai = { buildPrompt: () => buildPrompt(aiOpts()), settings: () => ({ ...aiSettings, key: aiSettings.key ? '***' : '' }), run: runAI };

/* ------------------------------------------------------------------ save / share */
function buildExport() {
  const c = mk(); present(c, true);
  const W = c.width, H = c.height, fs = Math.max(16, Math.round(W / 42)), bar = Math.round(fs * 2.6);
  const ex = mk(W, H + bar), x = ex.getContext('2d');
  x.drawImage(c, 0, 0); x.fillStyle = '#fdf6f9'; x.fillRect(0, H, W, bar); x.fillStyle = '#3d3346'; x.font = `700 ${fs}px sans-serif`;
  const T = TYPES[S.type], sub = T.subs.find((s) => s[0] === S.sub)?.[1] || '';
  const stl = STYLES.find((s) => s.id === S.style);
  const parts = [`${T.e} ${T.n} ${sub}`, aiCurrent() ? '✨AI 합성' : null, S.style !== 'none' ? stl.n : null, S.hair ? `헤어 ${S.hair.n}` : null,
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
function rerender() { if (S.mode === 'still') renderStill(); updateAIUI(); }
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
  $('styleList').innerHTML = list.map((s) => `<button class="style ${S.style === s.id ? 'on' : ''}" data-style="${s.id}">${styleIconSVG(s)}<span>${s.n}</span></button>`).join('');
  const st = STYLES.find((s) => s.id === S.style);
  const bangRow = $('bangRow');
  if (!st || !st.mass) { bangRow.hidden = true; return; }
  bangRow.hidden = false;
  const opts = st.g === 'f' ? ['none', 'full', 'seethrough', 'side'] : ['none', st.bang];
  const cur = S.bang || st.bang;
  $('bangList').innerHTML = opts.map((b) => `<button class="sub ${cur === b ? 'on' : ''}" data-bang="${b}">${b === st.bang ? '기본 · ' : ''}${BANGS[b].n}</button>`).join('');
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
async function boot() {
  renderTypes(); renderHair(); renderFrames(); renderShapes(); renderStyles(); bindUI(); bindAI();
  try { await loadModels(); }
  catch (e) { console.error(e); $('phText').textContent = 'AI 모델을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침 해주세요.'; setStatus('모델 로딩 실패'); return; }
  setStatus(`모델 준비 완료 (${delegate})`);
  const params = new URLSearchParams(location.search);
  if (params.has('sample')) { await loadSample(); return; }
  if (navigator.mediaDevices?.getUserMedia && !params.has('photo')) { $('phText').textContent = '카메라를 켜는 중… (권한을 허용해 주세요)'; await goLive(); }
  else showPhotoMode();
}
window.__pc.selectType = selectType;
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
