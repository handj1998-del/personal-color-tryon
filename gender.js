// On-device gender estimate: plain-JS forward pass of face-api.js's AgeGenderNet (TinyXception, 112x112 input, ~430 KB uint8 weights,
// MIT licence, see assets/CREDITS.md). No ML runtime, no GPU, ~2 MB of Float32 weights + <1 MB activations, runs once per capture.
let NET = null, loading = null;

async function load(base) {
  const man = await (await fetch(base + 'age_gender_model-weights_manifest.json')).json();
  const buf = await (await fetch(base + 'age_gender_model.bin')).arrayBuffer();
  const W = {}; let off = 0;
  for (const w of man[0].weights) {
    const n = w.shape.reduce((a, b) => a * b, 1), q = w.quantization, out = new Float32Array(n);
    if (q && q.dtype === 'uint8') { const u = new Uint8Array(buf, off, n); for (let i = 0; i < n; i++) out[i] = u[i] * q.scale + q.min; off += n; }
    else { const f = new Float32Array(buf.slice(off, off + n * 4)); out.set(f); off += n * 4; }
    W[w.name] = { d: out, s: w.shape };
  }
  return W;
}
export function genderReady() { return !!NET; }
export function loadGender(base = './assets/models/') { return loading || (loading = load(base).then((w) => (NET = w)).catch((e) => { loading = null; throw e; })); }

// tensors: { h, w, c, d: Float32Array (HWC) }
const T = (h, w, c) => ({ h, w, c, d: new Float32Array(h * w * c) });
const padBefore = (n, k, s) => { const o = Math.ceil(n / s), tot = Math.max((o - 1) * s + k - n, 0); return [o, Math.floor(tot / 2)]; };
function conv3(x, f, b, s) { // full 3x3 conv, 'same'
  const [oh, ph] = padBefore(x.h, 3, s), [ow, pw] = padBefore(x.w, 3, s), co = f.s[3], ci = x.c, o = T(oh, ow, co), F = f.d;
  for (let y = 0; y < oh; y++) for (let xx = 0; xx < ow; xx++) { const ob = (y * ow + xx) * co; for (let k = 0; k < co; k++) o.d[ob + k] = b.d[k];
    for (let ky = 0; ky < 3; ky++) { const iy = y * s + ky - ph; if (iy < 0 || iy >= x.h) continue;
      for (let kx = 0; kx < 3; kx++) { const ix = xx * s + kx - pw; if (ix < 0 || ix >= x.w) continue; const ib = (iy * x.w + ix) * ci;
        for (let c = 0; c < ci; c++) { const v = x.d[ib + c]; if (!v) continue; const fb = ((ky * 3 + kx) * ci + c) * co; for (let k = 0; k < co; k++) o.d[ob + k] += v * F[fb + k]; } } } }
  return o;
}
function dw3(x, f) { // depthwise 3x3, stride 1, 'same'
  const o = T(x.h, x.w, x.c), C = x.c, F = f.d;
  for (let y = 0; y < x.h; y++) for (let xx = 0; xx < x.w; xx++) { const ob = (y * x.w + xx) * C;
    for (let ky = 0; ky < 3; ky++) { const iy = y + ky - 1; if (iy < 0 || iy >= x.h) continue;
      for (let kx = 0; kx < 3; kx++) { const ix = xx + kx - 1; if (ix < 0 || ix >= x.w) continue; const ib = (iy * x.w + ix) * C, fb = (ky * 3 + kx) * C;
        for (let c = 0; c < C; c++) o.d[ob + c] += x.d[ib + c] * F[fb + c]; } } }
  return o;
}
function pw(x, f, b, s = 1) { // 1x1 conv (+bias), optional stride (for the expansion convs)
  const oh = Math.ceil(x.h / s), ow = Math.ceil(x.w / s), ci = x.c, co = f.s[3], o = T(oh, ow, co), F = f.d;
  for (let y = 0; y < oh; y++) for (let xx = 0; xx < ow; xx++) { const ob = (y * ow + xx) * co, ib = ((y * s) * x.w + xx * s) * ci;
    for (let k = 0; k < co; k++) o.d[ob + k] = b.d[k];
    for (let c = 0; c < ci; c++) { const v = x.d[ib + c]; if (!v) continue; const fb = c * co; for (let k = 0; k < co; k++) o.d[ob + k] += v * F[fb + k]; } }
  return o;
}
const relu = (x) => { const o = T(x.h, x.w, x.c); for (let i = 0; i < x.d.length; i++) o.d[i] = x.d[i] > 0 ? x.d[i] : 0; return o; };
const add = (a, b) => { for (let i = 0; i < a.d.length; i++) a.d[i] += b.d[i]; return a; };
function maxPool(x) { // 3x3, stride 2, 'same'
  const [oh, ph] = padBefore(x.h, 3, 2), [ow, pw2] = padBefore(x.w, 3, 2), o = T(oh, ow, x.c);
  for (let y = 0; y < oh; y++) for (let xx = 0; xx < ow; xx++) for (let c = 0; c < x.c; c++) { let m = -Infinity;
    for (let ky = 0; ky < 3; ky++) { const iy = y * 2 + ky - ph; if (iy < 0 || iy >= x.h) continue; for (let kx = 0; kx < 3; kx++) { const ix = xx * 2 + kx - pw2; if (ix < 0 || ix >= x.w) continue; const v = x.d[(iy * x.w + ix) * x.c + c]; if (v > m) m = v; } }
    o.d[(y * ow + xx) * x.c + c] = m; }
  return o;
}
const sep = (x, p) => pw(dw3(x, NET[p + '/depthwise_filter']), NET[p + '/pointwise_filter'], NET[p + '/bias']);
function reduction(x, p, act = true) {
  let o = act ? relu(x) : x; o = sep(o, p + '/separable_conv0'); o = sep(relu(o), p + '/separable_conv1'); o = maxPool(o);
  return add(o, pw(x, NET[p + '/expansion_conv/filters'], NET[p + '/expansion_conv/bias'], 2));
}
function mainBlock(x, p) { let o = sep(relu(x), p + '/separable_conv0'); o = sep(relu(o), p + '/separable_conv1'); o = sep(relu(o), p + '/separable_conv2'); return add(o, x); }

// rgba: Uint8ClampedArray of a 112x112 face crop. Returns { male: P(male), age }
export function predictGender(rgba) {
  if (!NET) throw new Error('gender model not loaded');
  const x = T(112, 112, 3), mean = [122.782, 117.001, 104.298];
  for (let i = 0; i < 112 * 112; i++) for (let c = 0; c < 3; c++) x.d[i * 3 + c] = (rgba[i * 4 + c] - mean[c]) / 255;
  let o = relu(conv3(x, NET['entry_flow/conv_in/filters'], NET['entry_flow/conv_in/bias'], 2));
  o = reduction(o, 'entry_flow/reduction_block_0', false); o = reduction(o, 'entry_flow/reduction_block_1');
  o = mainBlock(o, 'middle_flow/main_block_0'); o = mainBlock(o, 'middle_flow/main_block_1');
  o = reduction(o, 'exit_flow/reduction_block'); o = relu(sep(o, 'exit_flow/separable_conv'));
  const C = o.c, f = new Float32Array(C); for (let i = 0; i < o.h * o.w; i++) for (let c = 0; c < C; c++) f[c] += o.d[i * C + c] / (o.h * o.w); // 7x7 avg pool
  const fc = (p, n) => { const w = NET[p + '/weights'].d, b = NET[p + '/bias'].d, r = new Float32Array(n); for (let k = 0; k < n; k++) { r[k] = b[k]; for (let c = 0; c < C; c++) r[k] += f[c] * w[c * n + k]; } return r; };
  const g = fc('fc/gender', 2), a = fc('fc/age', 1), m = Math.max(g[0], g[1]), e0 = Math.exp(g[0] - m), e1 = Math.exp(g[1] - m);
  return { male: e0 / (e0 + e1), age: a[0] };
}
