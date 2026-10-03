// Procedural hairstyle templates in a canonical face space, anchored to face landmarks.
// Canonical space: landmark 234 -> (-1,0), 454 -> (1,0), 10 (forehead top) -> (0,-0.98), 152 (chin) -> (0,1.39).
// Templates are rendered once (grayscale luminance + alpha), colorized per color, then drawn with an affine per frame.
export const CANON = { 234: [-1, 0], 454: [1, 0], 10: [0, -0.98], 152: [0, 1.39] };
export const OVAL_IDX = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const OVAL_R = [[0, -0.98], [0.24, -0.97], [0.48, -0.94], [0.7, -0.86], [0.85, -0.74], [0.94, -0.58], [0.98, -0.41], [1.0, -0.2], [1.0, 0], [0.99, 0.21], [0.95, 0.44], [0.89, 0.68], [0.79, 0.87], [0.69, 1.01], [0.55, 1.14], [0.43, 1.24], [0.16, 1.38], [0, 1.39]];
function ovalX(y) { // right face edge at height y (canonical)
  if (y <= -0.98) return 0.0; if (y >= 1.39) return 0.62;
  for (let i = 1; i < OVAL_R.length; i++) { const [x0, y0] = OVAL_R[i - 1], [x1, y1] = OVAL_R[i]; if (y <= y1) return x0 + (x1 - x0) * (y - y0) / (y1 - y0 || 1); }
  return 0.62;
}
const SC = 180, X0 = -3.0, Y0 = -2.8, TW = 1080, TH = 1332; // template px per unit and bounds

/* ---------------- style definitions ---------------- */
// mass: right-side outline from top center clockwise to bottom center (auto-mirrored).
// frame: face-framing front locks {cover, y0, y1}. flow: fall|back. bang: default bangs.
export const STYLES = [
  { id: 'none', n: '원래 헤어', g: 'fm' },
  { id: 'short_f', jag: 0.025, n: '숏컷', g: 'f', bang: 'side', len: [0.4, 1.0],
    mass: [[0, -2.03], [0.6, -1.98], [1.03, -1.73], [1.25, -1.25], [1.27, -0.6], [1.22, 0.0], [1.13, 0.42], [0.98, 0.58], [0.9, 0.38], [0.5, 0.9], [0, 0.95]],
    frame: { cover: 0.07, y0: -0.75, y1: 0.45 } },
  { id: 'bob', n: '단발(보브)', g: 'f', bang: 'none', cIn: 0.35, len: [0.7, 1.6],
    mass: [[0, -1.96], [0.58, -1.92], [1.0, -1.7], [1.25, -1.28], [1.33, -0.6], [1.35, 0.3], [1.32, 1.05], [1.22, 1.45], [0.97, 1.56], [0.8, 1.42], [0.55, 1.28], [0, 1.22]],
    frame: { cover: 0.1, y0: -0.78, y1: 1.45 } },
  { id: 'layered_bob', jag: 0.025, n: '레이어드 단발', g: 'f', bang: 'seethrough', out: 0.35, len: [0.6, 1.3],
    mass: [[0, -2.03], [0.6, -1.98], [1.03, -1.73], [1.29, -1.25], [1.37, -0.55], [1.4, 0.3], [1.45, 1.1], [1.55, 1.7], [1.42, 1.98], [1.27, 1.82], [1.13, 2.02], [0.96, 1.86], [0.83, 1.96], [0.76, 1.6], [0.4, 1.55], [0, 1.5]],
    frame: { cover: 0.11, y0: -0.75, y1: 0.9 } },
  { id: 'ccurl', n: 'C컬 중단발', g: 'f', bang: 'none', cIn: 0.6, len: [0.9, 1.9],
    mass: [[0, -2.0], [0.58, -1.95], [1.0, -1.7], [1.25, -1.25], [1.32, -0.6], [1.34, 0.3], [1.38, 1.3], [1.36, 2.1], [1.18, 2.52], [0.94, 2.48], [0.83, 2.22], [0.79, 1.9], [0.4, 1.85], [0, 1.85]],
    frame: { cover: 0.08, y0: -0.78, y1: 1.5 } },
  { id: 'hush', jag: 0.03, n: '허쉬컷', g: 'f', bang: 'seethrough', out: 0.25, len: [0.5, 1.2],
    mass: [[0, -2.1], [0.62, -2.04], [1.07, -1.76], [1.32, -1.25], [1.38, -0.6], [1.45, 0.2], [1.48, 0.8], [1.34, 1.3], [1.22, 1.72], [1.27, 2.3], [1.13, 2.72], [0.96, 2.6], [0.86, 2.2], [0.8, 1.8], [0.4, 1.75], [0, 1.7]],
    frame: { cover: 0.13, y0: -0.72, y1: 0.95 } },
  { id: 'long', n: '긴 생머리', g: 'f', bang: 'none', len: [1.2, 2.6],
    mass: [[0, -1.96], [0.55, -1.92], [0.98, -1.68], [1.22, -1.25], [1.3, -0.6], [1.3, 0.2], [1.33, 1.2], [1.4, 2.2], [1.48, 3.2], [1.45, 3.85], [1.2, 3.95], [0.92, 3.9], [0.82, 3.3], [0.8, 2.6], [0.5, 2.5], [0, 2.45]],
    frame: { cover: 0.07, y0: -0.78, y1: 1.6 } },
  { id: 'wave', n: '긴 웨이브(S컬)', g: 'f', bang: 'none', curl: { amp: 0.13, len: 0.8, y: 0.1 }, len: [1.2, 2.4],
    mass: [[0, -2.02], [0.6, -1.97], [1.02, -1.72], [1.26, -1.25], [1.34, -0.6], [1.38, 0.2], [1.5, 1.2], [1.64, 2.2], [1.72, 3.1], [1.62, 3.7], [1.32, 3.85], [0.96, 3.8], [0.83, 3.2], [0.8, 2.6], [0.5, 2.5], [0, 2.45]],
    frame: { cover: 0.07, y0: -0.78, y1: 1.5 } },
  { id: 'hippie', jag: 0.06, n: '히피펌', g: 'f', bang: 'seethrough', curl: { amp: 0.045, len: 0.2, y: -1.4 }, frizz: 1, len: [0.35, 0.8],
    mass: [[0, -2.16], [0.7, -2.1], [1.19, -1.85], [1.5, -1.3], [1.64, -0.5], [1.75, 0.4], [1.92, 1.4], [2.02, 2.3], [1.86, 3.0], [1.46, 3.2], [1.02, 3.1], [0.86, 2.6], [0.5, 2.45], [0, 2.4]],
    frame: { cover: 0.08, y0: -0.75, y1: 1.4 } },
  { id: 'ponytail', ears: true, n: '포니테일(묶음)', g: 'f', bang: 'none', flow: 'back', len: [0.5, 1.2],
    mass: [[0, -1.99], [0.55, -1.94], [0.97, -1.69], [1.16, -1.25], [1.18, -0.7], [1.1, -0.3], [1.0, -0.12], [0.94, -0.4], [0.5, -0.3], [0, -0.3]],
    extra: [{ layer: 'back', pts: [[1.0, -1.15], [1.3, -0.7], [1.45, 0.3], [1.5, 1.3], [1.4, 2.15], [1.22, 2.25], [1.16, 1.4], [1.12, 0.4], [1.02, -0.4]], src: [1.05, -1.3] }] },
  { id: 'dandy', flow: 'fwd', jag: 0.035, n: '댄디컷', g: 'm', bang: 'dandy', len: [0.3, 0.8],
    mass: [[0, -2.02], [0.6, -1.98], [1.0, -1.74], [1.15, -1.3], [1.14, -0.8], [1.07, -0.42], [1.03, -0.1], [0.99, 0.08], [0.95, -0.2], [0.5, -0.3], [0, -0.3]] },
  { id: 'twoblock', ears: true, flow: 'fwd', jag: 0.035, n: '투블럭', g: 'm', bang: 'dandy_short', len: [0.3, 0.8],
    mass: [[0, -2.06], [0.62, -2.01], [1.02, -1.77], [1.17, -1.36], [1.15, -1.02], [0.9, -0.97], [0, -0.92]],
    buzz: [[0.84, -1.3], [1.14, -1.2], [1.12, -0.55], [1.06, -0.12], [0.99, 0.1], [0.93, -0.4], [0.84, -0.9]] },
  { id: 'leaf', flow: 'fwd', jag: 0.035, n: '리프컷', g: 'm', bang: 'leaf', len: [0.4, 0.9],
    mass: [[0, -2.03], [0.62, -1.99], [1.02, -1.75], [1.18, -1.3], [1.2, -0.7], [1.14, -0.3], [1.06, 0.06], [0.98, 0.0], [0.5, -0.3], [0, -0.3]] },
  { id: 'garma', jag: 0.03, n: '가르마펌', g: 'm', bang: 'garma', part: 0.42, curl: { amp: 0.035, len: 0.55, y: -2.5 }, len: [0.4, 1.0],
    mass: [[0, -2.12], [0.65, -2.07], [1.06, -1.82], [1.21, -1.38], [1.19, -0.85], [1.1, -0.4], [1.04, -0.05], [0.98, 0.1], [0.95, -0.3], [0.5, -0.4], [0, -0.4]] },
  { id: 'comma', flow: 'fwd', jag: 0.035, n: '쉼표머리', g: 'm', bang: 'comma', part: 0.38, len: [0.4, 0.9],
    mass: [[0, -2.05], [0.62, -2.0], [1.02, -1.76], [1.16, -1.32], [1.15, -0.8], [1.08, -0.42], [1.03, -0.1], [0.99, 0.08], [0.95, -0.2], [0.5, -0.3], [0, -0.3]] },
];
export const BANGS = {
  none: { n: '없음' },
  full: { n: '풀뱅', g: 'f', flow: 'fan', src: [0, -1.9], dens: 1.25, len: [0.5, 1.1],
    pts: [[0, -1.85], [0.55, -1.75], [0.88, -1.4], [0.95, -0.9], [0.92, -0.62], [0.75, -0.5], [0.5, -0.45], [0.25, -0.48], [0, -0.44], [-0.25, -0.48], [-0.5, -0.45], [-0.75, -0.5], [-0.92, -0.62], [-0.95, -0.9], [-0.88, -1.4], [-0.55, -1.75]] },
  seethrough: { n: '시스루뱅', g: 'f', flow: 'fan', src: [0, -1.9], dens: 0.55, sparse: true, len: [0.5, 1.1],
    pts: [[0, -1.85], [0.5, -1.75], [0.8, -1.4], [0.86, -0.9], [0.8, -0.6], [0.55, -0.55], [0.25, -0.56], [0, -0.53], [-0.25, -0.56], [-0.55, -0.55], [-0.8, -0.6], [-0.86, -0.9], [-0.8, -1.4], [-0.5, -1.75]] },
  side: { n: '사이드뱅', g: 'f', flow: 'sweep', dir: [-1, 0.5], src: [0.45, -1.95], dens: 1.1, len: [0.6, 1.3],
    pts: [[0.35, -1.9], [0.8, -1.62], [0.92, -1.2], [0.62, -1.0], [0.15, -0.92], [-0.4, -0.78], [-0.78, -0.56], [-0.98, -0.42], [-1.06, -0.7], [-0.96, -1.25], [-0.55, -1.7], [0, -1.9]] },
  dandy: { n: '댄디 앞머리', g: 'm', flow: 'fan', src: [0.15, -1.95], bias: -0.18, dens: 1.2, len: [0.4, 0.9],
    pts: [[0, -1.98], [0.6, -1.88], [0.92, -1.45], [0.94, -0.98], [0.86, -0.72], [0.66, -0.68], [0.5, -0.62], [0.32, -0.66], [0.15, -0.6], [0, -0.64], [-0.17, -0.6], [-0.34, -0.66], [-0.5, -0.61], [-0.68, -0.68], [-0.86, -0.72], [-0.94, -0.98], [-0.92, -1.45], [-0.6, -1.88]] },
  dandy_short: { n: '짧은 앞머리', g: 'm', flow: 'fan', src: [0.1, -2.0], bias: -0.1, dens: 1.2, len: [0.3, 0.7],
    pts: [[0, -2.02], [0.6, -1.92], [0.92, -1.5], [0.94, -1.05], [0.84, -0.82], [0.6, -0.8], [0.4, -0.74], [0.2, -0.79], [0, -0.73], [-0.2, -0.79], [-0.4, -0.74], [-0.6, -0.8], [-0.84, -0.82], [-0.94, -1.05], [-0.92, -1.5], [-0.6, -1.92]] },
  leaf: { n: '리프 앞머리', g: 'm', flow: 'leaf', src: [0, -2.0], dens: 1.15, len: [0.5, 1.0],
    pts: [[0, -1.98], [0.6, -1.88], [0.98, -1.45], [1.08, -0.85], [1.02, -0.5], [0.85, -0.56], [0.55, -0.72], [0.22, -0.88], [0.04, -0.98], [-0.04, -0.98], [-0.22, -0.88], [-0.55, -0.72], [-0.85, -0.56], [-1.02, -0.5], [-1.08, -0.85], [-0.98, -1.45], [-0.6, -1.88]] },
  garma: { n: '가르마 앞머리', g: 'm', flow: 'sweep', dir: [-1, 0.28], src: [0.45, -2.05], dens: 1.1, len: [0.6, 1.2],
    pts: [[0.42, -2.05], [0.8, -1.85], [0.92, -1.5], [0.5, -1.28], [0.0, -1.18], [-0.5, -1.08], [-0.86, -0.93], [-1.07, -0.72], [-1.12, -1.1], [-0.96, -1.62], [-0.4, -2.0]] },
  comma: { n: '쉼표 앞머리', g: 'm', flow: 'comma', dir: [-0.9, 0.55], src: [0.38, -2.0], dens: 1.15, len: [0.6, 1.2],
    pts: [[0.32, -1.98], [0.76, -1.72], [0.82, -1.35], [0.45, -1.15], [0.1, -1.0], [-0.22, -0.86], [-0.42, -0.7], [-0.46, -0.52], [-0.36, -0.42], [-0.58, -0.42], [-0.84, -0.58], [-1.0, -0.85], [-1.02, -1.3], [-0.76, -1.72], [-0.2, -1.96]] },
};

/* ---------------- geometry helpers ---------------- */
function mirrorClosed(right) { // right: top center -> bottom center
  const left = right.slice(1, -1).reverse().map(([x, y]) => [-x, y]);
  return right.concat(left);
}
function catmullD(pts, closed = true) {
  const n = pts.length; const P = (i) => pts[(i + n) % n];
  let d = `M ${pts[0][0].toFixed(3)} ${pts[0][1].toFixed(3)}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0].toFixed(3)} ${c1[1].toFixed(3)} ${c2[0].toFixed(3)} ${c2[1].toFixed(3)} ${p2[0].toFixed(3)} ${p2[1].toFixed(3)}`;
  }
  return d + (closed ? ' Z' : '');
}
function jitter(pts, amp, seed, spiky = false) {
  if (!amp) return pts; const r = rng(seed), out = []; let kk = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]; const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / (spiky ? 0.055 : 0.09)));
    for (let k = 0; k < n; k++) { const t = k / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, j = (spiky && y > -1.05 ? ((kk++ % 2) ? 1 : -0.6) * (0.6 + 0.6 * r()) : (r() - 0.5) * 2) * amp * (y > -1.0 || Math.abs(x) > 0.8 ? 1 : 0.4);
      out.push([x + (dy / l) * j, y - (dx / l) * j]); }
  }
  return out;
}
function frameLock(fr, sign) { // face-framing lock, in canonical coords
  const N = 12, inner = [], outer = [];
  for (let i = 0; i <= N; i++) { const y = fr.y0 + (fr.y1 - fr.y0) * i / N; const xi = ovalX(Math.min(y, 0.42)) - fr.cover * (1 - 0.5 * Math.max(0, Math.min(1, (y - 0.42) / 0.8))); inner.push([xi, y]); outer.push([xi + 0.34 + 0.06 * Math.sin(i), y]); }
  const pts = [[inner[0][0] + 0.12, fr.y0 - 0.25], ...outer, ...inner.reverse()];
  return pts.map(([x, y]) => [x * sign, y]);
}

/* ---------------- rendering ---------------- */
const clamp255 = (v) => Math.max(0, Math.min(255, v));
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function gauss(r) { return (r() + r() + r() - 1.5) / 1.5; }
function blurF(src, w, h, r) { // separable box blur (2 passes ~ gaussian)
  let a = src;
  for (let pass = 0; pass < 2; pass++) {
    const t = new Float32Array(a.length), o = new Float32Array(a.length);
    for (let y = 0; y < h; y++) { let acc = 0; const row = y * w; for (let x = -r; x <= r; x++) acc += a[row + Math.max(0, Math.min(w - 1, x))];
      for (let x = 0; x < w; x++) { t[row + x] = acc / (2 * r + 1); acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)]; } }
    for (let x = 0; x < w; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += t[Math.max(0, Math.min(h - 1, y)) * w + x];
      for (let y = 0; y < h; y++) { o[y * w + x] = acc / (2 * r + 1); acc += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x]; } }
    a = o;
  }
  return a;
}
const MW = TW >> 2, MH = TH >> 2; // quarter-res helper fields
function regionMask(d) {
  const c = document.createElement('canvas'); c.width = TW; c.height = TH; const x = c.getContext('2d');
  x.setTransform(SC, 0, 0, SC, -X0 * SC, -Y0 * SC); x.fillStyle = '#fff'; const path = new Path2D(d); x.fill(path);
  const a = x.getImageData(0, 0, TW, TH).data, m = new Uint8Array(TW * TH); let n = 0;
  for (let i = 0; i < m.length; i++) { m[i] = a[i * 4 + 3] > 127 ? 1 : 0; n += m[i]; }
  // quarter-res soft field: ~1 deep inside, ->0 near/after the edge (used for shading + fuzzy edges)
  const q = new Float32Array(MW * MH);
  for (let y = 0; y < MH; y++) for (let xx = 0; xx < MW; xx++) q[y * MW + xx] = m[(y * 4 + 2) * TW + xx * 4 + 2];
  const soft = blurF(q, MW, MH, 6), soft2 = blurF(q, MW, MH, 2);
  return { m, area: n / (SC * SC), path, soft, soft2 };
}
const inM = (M, x, y) => { const u = Math.round((x - X0) * SC), v = Math.round((y - Y0) * SC); return u >= 0 && v >= 0 && u < TW && v < TH && M.m[v * TW + u] === 1; };
const fld = (F, x, y) => { const u = Math.round((x - X0) * SC / 4), v = Math.round((y - Y0) * SC / 4); return u >= 0 && v >= 0 && u < MW && v < MH ? F[v * MW + u] : 0; };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
function clumpN(c, ph) { return 0.5 + 0.22 * Math.sin(c + ph) + 0.16 * Math.sin(c * 2.37 + 1.7 * ph) + 0.12 * Math.sin(c * 5.3 + 0.4); }
function ovalTopY(x) { const ax = Math.min(0.99, Math.abs(x)); for (let i = 1; i < 8; i++) { const [x0, y0] = OVAL_R[i - 1], [x1, y1] = OVAL_R[i]; if (ax <= x1) return y0 + (y1 - y0) * (ax - x0) / (x1 - x0); } return -0.2; }

function makeFlow(kind, o) {
  const S = o.src;
  if (kind === 'back') return (x, y) => norm(o.tie[0] - x, o.tie[1] - y);
  if (kind === 'fan') return (x, y) => norm(x - S[0] + (o.bias || 0) * (y - S[1]), (y - S[1]) * 1.0 + 0.9);
  if (kind === 'leaf') return (x, y) => { const sx = x >= 0 ? 1 : -1; const t = smooth(-1.9, -0.6, y); return norm(sx * (0.25 + 1.1 * t) + (x - S[0]) * 0.3, 1.0 - 0.35 * t); };
  if (kind === 'sweep') return (x, y) => { const t = smooth(S[1], S[1] + 1.2, y); return norm(o.dir[0] * (1 - 0.35 * t) + (x - S[0]) * 0.15, o.dir[1] + 0.5 * t); };
  if (kind === 'comma') return (x, y) => { const t = smooth(-0.95, -0.45, y), a = -t * 2.0; const [dx, dy] = norm(o.dir[0], o.dir[1]); return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)]; };
  if (kind === 'fwd') return (x, y) => { const sx = x >= 0 ? 1 : -1; const [rx, ry] = norm(x - S[0] * 0.3, y + 2.6); const side = smooth(0.75, 1.1, Math.abs(x)) * smooth(-1.4, -0.6, y); return norm(rx * (1 - side) + sx * 0.15 * side, ry * (1 - side) + side); };
  if (kind === 'down') return (x, y) => { const sx = x >= 0 ? 1 : -1; return norm(sx * 0.08 - (o.cIn || 0) * sx * smooth(o.bottom - 0.5, o.bottom, y), 1); };
  // fall: hair leaves the part, follows the skull (tangent to circles around the head center) then falls with gravity
  const part = S[0];
  return (x, y) => {
    const sx = x >= part ? 1 : -1;
    const rx = x, ry = y + 0.55;
    let tx = -ry * sx, ty = rx * sx; if (ty < 0) { tx = sx * Math.abs(tx); ty *= 0.2; }
    [tx, ty] = norm(tx, ty + 0.25);
    const above = ovalTopY(x) - y; // distance above the front hairline
    const hw = Math.abs(x) < 0.95 ? smooth(0.32, 0.0, above) * smooth(-0.15, 0.05, above) : 0;
    if (hw > 0) { const [ux, uy] = norm((x - part) * 0.5 + sx * 0.25, -1); tx = tx * (1 - hw) + ux * hw; ty = ty * (1 - hw) + uy * hw; }
    const w = smooth(-0.7, 0.3, y);
    let gx = sx * 0.07 * (x >= 0 ? 1 : 1);
    if (o.cIn) gx -= sx * o.cIn * smooth(o.bottom - 0.6, o.bottom, y);
    if (o.out) gx += sx * o.out * smooth(o.bottom - 0.5, o.bottom, y);
    return norm(tx * (1 - w) + gx * w, ty * (1 - w) + w);
  };
}
function drawStrands(ctx, M, flow, o, r) {
  const N = Math.round(M.area * 430 * (o.dens || 1));
  const h = 0.016, S = o.src || [0, -1.9];
  const segs = [];
  for (let k = 0; k < N; k++) {
    let sx, sy, tries = 0;
    do { sx = X0 + r() * (TW / SC); sy = Y0 + r() * (TH / SC); tries++; } while (!inM(M, sx, sy) && tries < 60);
    if (tries >= 60) continue;
    const len = o.len[0] + r() * (o.len[1] - o.len[0]), steps = Math.round(len / h / 2);
    const fw = [[sx, sy]], bw = []; let x = sx, y = sy;
    for (let i = 0; i < steps; i++) { const [vx, vy] = flow(x, y); x += vx * h; y += vy * h; if (!inM(M, x, y)) break; fw.push([x, y]); }
    x = sx; y = sy;
    for (let i = 0; i < steps; i++) { const [vx, vy] = flow(x, y); x -= vx * h; y -= vy * h; if (!inM(M, x, y)) break; bw.push([x, y]); }
    const pts = bw.reverse().concat(fw); if (pts.length < 5) continue;
    const wv = smooth(-0.8, 0.2, sy);
    const cc = (Math.atan2(sx - S[0], sy + 0.55) * 11) * (1 - wv) + sx * 8 * wv;
    const cl = clumpN(cc, o.phase || 0);
    if (o.sparse && cl < 0.5) continue;
    if (o.curl) { // waves/curls along arc length, coherent within a clump
      const ph = o.frizz ? r() * 6.283 : cc * 0.25 + sx * 0.8, am = o.frizz ? 0.55 + r() * 0.9 : 1, ln = o.curl.len * (o.frizz ? 0.75 + r() * 0.5 : 1);
      let s = 0; const base = pts.map((p) => p.slice());
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = base[i - 1], [bx, by] = base[i]; s += Math.hypot(bx - ax, by - ay);
        const [vx, vy] = norm(bx - ax, by - ay); const ramp = smooth(o.curl.y, o.curl.y + 0.5, by) * smooth(0.1, 0.6, vy);
        const th = (o.frizz ? s : by) / ln * Math.PI * 2 + ph;
        const off = Math.sin(th) * o.curl.amp * am * ramp, al = o.frizz ? Math.cos(th) * o.curl.amp * am * 0.7 * ramp : 0; // frizz: looping coils
        pts[i] = [bx - vy * off + vx * al, by + vx * off + vy * al];
      }
    }
    // layer: 0 = dark under-layer (thicker), 1 = main, 2 = fine highlight strands on top
    const lr = r(), layer = lr < 0.3 ? 0 : lr < 0.88 ? 1 : 2;
    const L0 = (0.44 + gauss(r) * 0.08) * (0.65 + 0.7 * cl) * (layer === 0 ? 0.62 : layer === 2 ? 1.18 : 1);
    const A0 = (layer === 2 ? 0.25 : 0.35) + r() * 0.4, lw = (layer === 0 ? 1.5 + r() * 1.2 : layer === 2 ? 0.5 + r() * 0.4 : 0.7 + r() * 0.8) / SC * (o.wMul || 1);
    const tone = Math.round(clamp255(128 + (cl - 0.5) * 110 + gauss(r) * 38)); // highlight/lowlight variation
    // draw in chunks so brightness can vary along the strand (sheen band, root/edge shadows, faded tips)
    const n = pts.length, CH = 8;
    for (let i0 = 0; i0 < n - 1; i0 += CH) {
      const i1 = Math.min(n - 1, i0 + CH), [mx, my] = pts[(i0 + i1) >> 1];
      const ring = Math.exp(-Math.pow(Math.hypot(mx * 0.92, my + 0.5) - 1.3, 2) / 0.02) * (1 - smooth(-0.85, -0.35, my));
      const depth = fld(M.soft, mx, my);                    // ~0 near the silhouette, 1 deep inside
      const neck = Math.exp(-mx * mx / 0.9) * smooth(0.6, 1.5, my) * 0.62 * (1 - smooth(2.2, 2.8, my) * 0.4);
      const faceEdge = (my > -0.55 && my < 1.6) ? Math.max(0, 1 - Math.abs(Math.abs(mx) - ovalX(Math.min(my, 1.3))) / 0.22) * 0.3 : 0;
      const t0 = (i0 + i1) / 2 / n;
      let L = L0 * (0.55 + 0.45 * depth) * (1 - neck - faceEdge) * (0.74 + 0.26 * smooth(0, 0.35, t0)) + ring * (0.2 + 0.14 * cl * cl) * (layer === 0 ? 0.3 : 1);
      L = Math.max(0.05, Math.min(0.96, L));
      const t = (i0 + i1) / 2 / n, taper = smooth(0, 0.15, t) * smooth(1, 0.8, t);
      const edgeA = smooth(0.0, 0.35, fld(M.soft2, mx, my) + 0.12);
      const a = A0 * taper * edgeA; if (a < 0.02) continue;
      const v = Math.round(L * 255);
      segs.push([`rgba(${v},${tone},0,${a.toFixed(2)})`, lw, pts.slice(i0, i1 + 1), layer]);
    }
  }
  // flyaways: a few fine, slightly wandering strands that cross the silhouette so edges don't look cut out
  if (!o.noFly) {
    const NF = Math.round(M.area * (o.frizz ? 90 : 45));
    for (let k = 0; k < NF; k++) {
      let sx, sy, tries = 0;
      do { sx = X0 + r() * (TW / SC); sy = Y0 + r() * (TH / SC); tries++; } while (!(inM(M, sx, sy) && fld(M.soft2, sx, sy) < 0.6) && tries < 80);
      if (tries >= 80) continue;
      const pts = [[sx, sy]]; let x = sx, y = sy, wob = (r() - 0.5) * 1.1; const L = 0.35 + r() * 0.45;
      let out = 0; for (let i = 0; i < 25 + r() * 35; i++) { let [vx, vy] = flow(x, y); const c = Math.cos(wob), sn = Math.sin(wob); [vx, vy] = [vx * c - vy * sn, vx * sn + vy * c]; wob += (r() - 0.5) * 0.35; x += vx * 0.01; y += vy * 0.01; if (!inM(M, x, y) && ++out > 14) break; pts.push([x, y]); }
      if (pts.length < 6) continue;
      const v = Math.round(L * 255); segs.push([`rgba(${v},150,0,${(0.18 + r() * 0.22).toFixed(2)})`, (0.45 + r() * 0.35) / SC, pts, 3]);
    }
  }
  segs.sort((a, b) => a[3] - b[3]);
  for (const [col, lw, p] of segs) { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]); ctx.stroke(); }
}
function softBase(x, M, alpha, lum, scalp = 0, fadeY = null) { // eroded, feathered under-fill (darker gaps between strands, no hard outline)
  const id = x.createImageData(TW, TH), d = id.data, v = Math.round(lum * 255);
  for (let y = 0; y < TH; y++) for (let xx = 0; xx < TW; xx++) {
    const q = M.soft2[(y >> 2) * MW + (xx >> 2)]; const a = smooth(0.55, 0.95, q) * alpha; if (a <= 0) continue; const sw = fadeY ? scalp * (0.45 + 0.55 * smooth(fadeY[0], fadeY[1], Y0 + y / SC)) : scalp;
    const i = (y * TW + xx) * 4; d[i] = Math.round(v * (0.75 + 0.25 * M.soft[(y >> 2) * MW + (xx >> 2)])); d[i + 1] = 128; d[i + 2] = sw; d[i + 3] = a * 255;
  }
  const c = document.createElement('canvas'); c.width = TW; c.height = TH; c.getContext('2d').putImageData(id, 0, 0);
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(c, 0, 0); x.restore();
}
function renderLayer(regions) {
  const c = document.createElement('canvas'); c.width = TW; c.height = TH; const x = c.getContext('2d');
  x.setTransform(SC, 0, 0, SC, -X0 * SC, -Y0 * SC); x.lineCap = 'round'; x.lineJoin = 'round';
  for (const R of regions) {
    const M = regionMask(R.d), r = rng(R.seed || 1234);
    if (R.buzz) { // shaved sides: translucent stubble
      softBase(x, M, 1, 0.3, 230, [-1.1, -0.2]); x.save(); x.clip(M.path);
      for (let i = 0; i < M.area * 14000; i++) { const sx = X0 + r() * (TW / SC), sy = Y0 + r() * (TH / SC); if (!inM(M, sx, sy)) continue;
        const v = 40 + r() * 50, a = 0.5 * smooth(0, 0.5, fld(M.soft2, sx, sy) + 0.1) * (1 - 0.7 * smooth(-1.0, 0.0, sy)); x.strokeStyle = `rgba(${v},128,110,${a.toFixed(2)})`; x.lineWidth = 0.8 / SC;
        x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + (r() - 0.5) * 0.015, sy + 0.02 + r() * 0.02); x.stroke(); }
      x.restore(); continue;
    }
    if (R.base !== 0) softBase(x, M, R.base ?? 1, 0.3);
    drawStrands(x, M, R.flow, R.o, r);
    if (R.part !== undefined) { // natural parting: thin line where the scalp shows
      x.save(); x.clip(M.path); x.strokeStyle = 'rgba(150,128,255,0.55)'; x.lineWidth = 2.2 / SC; x.beginPath();
      for (let yy = -2.0, i = 0; yy <= -1.2; yy += 0.04, i++) { const xx = R.part + Math.sin(i * 1.7) * 0.008 + (yy + 2) * 0.03 * Math.sign(R.part || 0.01); i ? x.lineTo(xx, yy) : x.moveTo(xx, yy); }
      x.stroke(); x.restore();
    }
  }
  return c;
}
export function buildStyle(styleId, bangId) {
  const st = STYLES.find((s) => s.id === styleId); if (!st || !st.mass) return null;
  const part = st.part ?? (st.g === 'f' ? 0.1 : 0);
  const bottom = Math.max(...st.mass.map((p) => p[1]));
  const baseO = { src: [part, -1.95], len: st.len, curl: st.curl, frizz: st.frizz, cIn: st.cIn, out: st.out, bottom, tie: [0, -1.75] };
  const flowKind = st.flow || 'fall';
  const back = [{ d: catmullD(jitter(mirrorClosed(st.mass), st.jag || 0.012, 3)), flow: makeFlow(flowKind, baseO), o: { ...baseO, dens: st.frizz ? 1.3 : 1 }, seed: 11, part: st.g === 'f' && flowKind === 'fall' ? part : undefined }];
  for (const ex of st.extra || []) if (ex.layer === 'back') back.push({ d: catmullD(ex.pts), flow: makeFlow('fall', { ...baseO, src: ex.src }), o: { ...baseO, src: ex.src, len: [0.8, 1.6] }, seed: 21 });
  if (st.buzz) for (const sg of [1, -1]) back.push({ d: catmullD(st.buzz.map(([x, y]) => [x * sg, y])), buzz: true, seed: sg > 0 ? 5 : 6 });
  const front = [];
  if (st.frame) for (const sg of [1, -1]) {
    const fo = { ...baseO, len: [0.5, 1.2], dens: 0.9, wMul: 1 };
    front.push({ d: catmullD(frameLock(st.frame, sg)), flow: makeFlow('fall', fo), o: fo, seed: sg > 0 ? 31 : 37, base: 0.9 });
  }
  const b = BANGS[bangId || st.bang];
  if (b && b.pts) {
    const bo = { src: b.src, dir: b.dir, bias: b.bias, len: b.len, dens: b.dens, sparse: b.sparse, curl: st.curl && st.frizz ? { amp: 0.025, len: 0.22, y: -1.6 } : null };
    front.push({ d: catmullD(jitter(b.pts, b.jag ?? (st.g === 'm' ? 0.05 : 0.025), 9, st.g === 'm')), flow: makeFlow(b.flow, bo), o: bo, seed: 41, base: b.sparse ? 0 : 0.85 });
  }
  return { back: renderLayer(back), front: front.length ? renderLayer(front) : null, id: styleId, bang: bangId || st.bang, g: st.g, ears: !!st.ears };
}
// colorize a grayscale template with a hair color (same luminance->color LUT idea as the recolor)
// Colorize a template. R = luminance, G = tone (highlight/lowlight), B = scalp weight.
// opts: light (-1..1, side lighting taken from the photo), expo (exposure factor), skin [r,g,b]
export function colorize(src, hex, lutFn, opts = {}) {
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; const x = c.getContext('2d');
  x.drawImage(src, 0, 0); const id = x.getImageData(0, 0, c.width, c.height), d = id.data; const lut = lutFn(hex, 112);
  const n = parseInt(hex.slice(1), 16), tl = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  const con = tl > 110 ? 0.62 : tl > 70 ? 0.78 : 0.95;
  const conP = opts.photo ? (tl > 110 ? 0.95 : tl > 70 ? 1.1 : 1.2) : con;   // light colours: less strand contrast (no streaks)
  const light = opts.light || 0, expo = opts.expo || 1, sk = opts.skin || [150, 115, 95];
  const colF = new Float32Array(TW); for (let u = 0; u < TW; u++) { const xc = Math.max(-1, Math.min(1, (X0 + u / SC) / 1.4)); colF[u] = expo * (1 + light * 0.24 * xc); }
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (!d[i + 3]) continue;
    const L = Math.max(0, Math.min(255, Math.round(112 + (d[i] - 112) * conP))), j = L * 3;
    let r = lut[j], g = lut[j + 1], b = lut[j + 2];
    const k = (d[i + 1] - 128) / 128;
    if (k > 0) { r += (r * 0.3 + 22 - r * 0.0) * k * 0.55; g += (g * 0.26 + 16) * k * 0.55; b += (b * 0.18 + 8) * k * 0.55; }
    else { const m = 1 + k * 0.28; r *= m; g *= m; b *= m; }
    const f = colF[p % TW]; r *= f; g *= f; b *= f;
    const w = d[i + 2] / 255;
    if (w > 0.02) { r = r * (1 - w) + sk[0] * 0.8 * f * w; g = g * (1 - w) + sk[1] * 0.78 * f * w; b = b * (1 - w) + sk[2] * 0.78 * f * w; }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  x.putImageData(id, 0, 0); return c;
}
// least-squares affine canonical->screen from landmark correspondences
export function fitAffine(pairs) { // pairs: [[cx,cy,sx,sy,w]]
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
  for (const [x, y, X, Y, w] of pairs) { const v = [x, y, 1]; for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) A[i][j] += w * v[i] * v[j]; bx[i] += w * v[i] * X; by[i] += w * v[i] * Y; } }
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A); if (Math.abs(D) < 1e-9) return null;
  const solve = (b) => [0, 1, 2].map((k) => det(A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))) / D);
  const [a, c, e] = solve(bx), [b, d, f] = solve(by);
  return { a, b, c, d, e, f };
}
export function templateTransform(M) { // template px -> screen
  const s = 1 / SC, ox = X0, oy = Y0;
  return [M.a * s, M.b * s, M.c * s, M.d * s, M.a * ox + M.c * oy + M.e, M.b * ox + M.d * oy + M.f];
}
export function invAffine(M) { const det = M.a * M.d - M.b * M.c; return { a: M.d / det, b: -M.b / det, c: -M.c / det, d: M.a / det, e: (M.c * M.f - M.d * M.e) / det, f: (M.b * M.e - M.a * M.f) / det }; }
export function styleIconSVG(st, bangId) {
  const face = '<ellipse cx="0" cy="0.2" rx="0.98" ry="1.2" fill="#f6dccb"/><rect x="-0.5" y="1.1" width="1" height="1.2" fill="#f6dccb"/><path d="M -2.2 3.2 Q -1.6 2.1 0 2.2 Q 1.6 2.1 2.2 3.2 Z" fill="#dcd3ea"/>';
  if (!st.mass) return `<svg viewBox="-2.2 -2.4 4.4 5.2">${face}<text x="0" y="-1.2" font-size="0.9" text-anchor="middle" fill="#8a7f93">?</text></svg>`;
  const b = BANGS[bangId || st.bang];
  return `<svg viewBox="-2.2 -2.4 4.4 5.2"><path d="${catmullD(mirrorClosed(st.mass))}" fill="#5b4537"/>${face}${b && b.pts ? `<path d="${catmullD(b.pts)}" fill="#6a5040" ${b.sparse ? 'fill-opacity=".7"' : ''}/>` : ''}</svg>`;
}
