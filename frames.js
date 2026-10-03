// Procedural eyeglass frames. Lens outlines are SVG path strings in units*100 (1 unit = half the
// inter-pupil distance), centered on the lens, +x = outward (temple side), y down.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex2rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const rgba = (h, a) => { const [r, g, b] = hex2rgb(h); return `rgba(${r},${g},${b},${a})`; };
export const mix = (h1, h2, t) => { const a = hex2rgb(h1), b = hex2rgb(h2); return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join(''); };

export const FRAMES = {
  gold:          { n: '골드메탈',     kind: 'metal', c: '#C9A24E', hi: '#F6E3A6', lo: '#7D5F22' },
  champagne:     { n: '샴페인골드',   kind: 'metal', c: '#D4BC8C', hi: '#FBF1D8', lo: '#8E7848' },
  rosegold:      { n: '로즈골드메탈', kind: 'metal', c: '#C98F7E', hi: '#F5D2C6', lo: '#875448' },
  antiquegold:   { n: '앤틱골드메탈', kind: 'metal', c: '#A68A4E', hi: '#DCC892', lo: '#5E4A22' },
  silver:        { n: '실버메탈',     kind: 'metal', c: '#A9AFB7', hi: '#F4F6F8', lo: '#545A62' },
  gunmetal:      { n: '건메탈',       kind: 'metal', c: '#5B5E64', hi: '#A9ADB4', lo: '#2B2D31' },
  blackmetal:    { n: '블랙메탈',     kind: 'metal', c: '#2A2A2E', hi: '#7A7A82', lo: '#0E0E10' },
  tortoiselight: { n: '뿔테 라이트호피', kind: 'tortoise', c: '#C48A4C', spot: '#6E3D18' },
  tortoise:      { n: '뿔테 브라운호피', kind: 'tortoise', c: '#7A4824', spot: '#2A160A' },
  brown:         { n: '뿔테 브라운',  kind: 'acetate', c: '#6A4530' },
  camel:         { n: '뿔테 카멜',    kind: 'acetate', c: '#A8764A' },
  khaki:         { n: '뿔테 카키',    kind: 'acetate', c: '#6A6447' },
  ivory:         { n: '뿔테 아이보리', kind: 'acetate', c: '#E7DCC4' },
  grey:          { n: '뿔테 그레이',  kind: 'acetate', c: '#808390' },
  black:         { n: '뿔테 블랙',    kind: 'acetate', c: '#161517' },
  matteblack:    { n: '매트 블랙',    kind: 'acetate', c: '#232224', matte: true },
  wine:          { n: '뿔테 와인',    kind: 'acetate', c: '#5E1E2E' },
  navy:          { n: '뿔테 네이비',  kind: 'acetate', c: '#1F2A46' },
  clearpink:     { n: '투명 핑크',    kind: 'clear', c: '#F1A9BE' },
  clearpeach:    { n: '투명 피치',    kind: 'clear', c: '#F4B892' },
  clearhoney:    { n: '허니 클리어',  kind: 'clear', c: '#E0B062' },
  clearlav:      { n: '투명 라벤더',  kind: 'clear', c: '#BFA9E6' },
  clear:         { n: '투명 크리스탈', kind: 'clear', c: '#DCE6EE' },
  crystalgrey:   { n: '크리스탈 그레이', kind: 'clear', c: '#8E949D' },
  gradbrown:     { n: '브라운 그라데이션', kind: 'grad', c: '#5E3B26', c2: '#F2C9A6' },
  gradrose:      { n: '로즈 그라데이션',   kind: 'grad', c: '#A8667A', c2: '#F6CFDA' },
  gradblack:     { n: '블랙 투톤',         kind: 'grad', c: '#141316', c2: '#D9E2EA' },
  gradkhaki:     { n: '카키 투톤',         kind: 'grad', c: '#4F4A30', c2: '#E3D7AE' },
  gradlav:       { n: '라벤더 투톤',       kind: 'grad', c: '#6E5C93', c2: '#E4DDF5' },
};

// shape library. d: lens outline. sc: lens scale. rim: full|brow|combo|halfrim|rimless. thk: thickness multiplier.
// bridge: auto|double|metal. thin: render like metal wire even for acetate colors.
const SQ = 'M -56 -60 L 62 -62 Q 86 -62 86 -36 L 79 32 Q 79 56 55 56 L -49 56 Q -73 56 -73 32 L -80 -36 Q -80 -60 -56 -60 Z';
const RND = 'M -78 0 A 78 74 0 1 0 78 0 A 78 74 0 1 0 -78 0 Z';
const SOFTRECT = 'M -64 -52 Q 0 -60 66 -54 Q 86 -52 86 -22 Q 86 40 44 50 Q 0 56 -44 50 Q -80 44 -82 -8 Q -82 -48 -64 -52 Z';
export const SHAPES = [
  { id: 'none', n: '없음' },
  { id: 'round', n: '라운드', d: RND },
  { id: 'oval', n: '오벌', d: 'M -84 0 A 84 58 0 1 0 84 0 A 84 58 0 1 0 -84 0 Z' },
  { id: 'square', n: '스퀘어', d: SQ },
  { id: 'wellington', n: '웰링턴', d: 'M -60 -58 L 66 -62 Q 92 -62 90 -36 L 76 30 Q 72 54 46 54 L -44 54 Q -68 54 -70 30 L -82 -32 Q -84 -58 -60 -58 Z' },
  { id: 'boston', n: '보스턴', d: 'M -64 -54 Q 0 -64 68 -58 Q 88 -54 86 -18 Q 82 58 6 62 Q -74 58 -80 -8 Q -84 -48 -64 -54 Z' },
  { id: 'boeing', n: '보잉', d: 'M -80 -50 C -35 -66 45 -68 90 -58 C 104 -25 92 55 25 80 C -30 95 -72 55 -80 5 C -84 -20 -83 -40 -80 -50 Z', bridge: 'double', thin: true },
  { id: 'cateye', n: '캣아이', d: 'M -78 -36 Q -40 -54 30 -58 Q 82 -62 104 -80 Q 100 -12 72 28 Q 46 58 0 58 Q -62 56 -78 18 Q -84 -12 -78 -36 Z' },
  { id: 'crownpanto', n: '크라운판토', d: 'M -58 -58 L 58 -58 L 82 -34 Q 90 58 0 66 Q -90 58 -82 -34 Z' },
  { id: 'hexagon', n: '육각', d: 'M -82 0 L -44 -62 L 48 -62 L 88 0 L 48 58 L -44 58 Z' },
  { id: 'octagon', n: '팔각', d: 'M -80 -28 L -52 -60 L 54 -60 L 86 -28 L 86 24 L 54 56 L -52 56 L -80 24 Z' },
  { id: 'butterfly', n: '버터플라이', d: 'M -76 -48 Q -20 -62 50 -64 Q 100 -66 104 -34 Q 102 22 62 48 Q 30 66 -10 60 Q -66 52 -80 2 Q -86 -34 -76 -48 Z' },
  { id: 'heart', n: '하트', d: 'M 0 -34 C 22 -78 98 -72 90 -12 C 84 32 32 56 0 68 C -32 56 -84 32 -90 -12 C -98 -72 -22 -78 0 -34 Z', sc: 0.95 },
  { id: 'oversize', n: '오버사이즈', d: SQ, sc: 1.16, thk: 1.15 },
  { id: 'thicksquare', n: '두꺼운 뿔테', d: SQ, sc: 1.03, thk: 1.7 },
  { id: 'browline', n: '하금테', d: 'M -60 -58 L 66 -62 Q 92 -62 90 -36 L 76 30 Q 72 54 46 54 L -44 54 Q -68 54 -70 30 L -82 -32 Q -84 -58 -60 -58 Z', rim: 'brow' },
  { id: 'combo', n: '원형 콤비', d: RND, rim: 'combo' },
  { id: 'halfrim', n: '반무테 상테', d: SOFTRECT, rim: 'halfrim' },
  { id: 'rimless', n: '무테', d: SOFTRECT, rim: 'rimless', sc: 0.97 },
  { id: 'titanium', n: '얇은 티타늄', d: SOFTRECT, thin: true, thk: 0.62 },
  { id: 'doublebridge', n: '투브릿지', d: 'M -62 -56 L 70 -60 Q 92 -60 90 -30 Q 88 40 50 54 L -40 56 Q -76 54 -80 10 L -82 -30 Q -82 -54 -62 -56 Z', bridge: 'double', thin: true },
];
export const SHAPE_BY_ID = Object.fromEntries(SHAPES.map((s) => [s.id, s]));

const pathCache = {};
const CX = 1.08, CY = -0.04;
function lensPath(sh) {
  if (!pathCache[sh.id]) { const p = new Path2D(); p.addPath(new Path2D(sh.d), new DOMMatrix().translate(CX, CY).scale((sh.sc || 1) / 100)); pathCache[sh.id] = p; }
  return pathCache[sh.id];
}
const probe = document.createElement('canvas').getContext('2d');
const edgeCache = {};
// x of the lens edge at height y (local units), inner (nose side) or outer
function edgeX(sh, y, outer) {
  const k = sh.id + y + outer; if (edgeCache[k] !== undefined) return edgeCache[k];
  const p = lensPath(sh); let a = CX, b = outer ? CX + 1.4 : CX - 1.4;
  if (!probe.isPointInPath(p, a, y)) { edgeCache[k] = outer ? CX + 0.8 : CX - 0.8; return edgeCache[k]; }
  for (let i = 0; i < 18; i++) { const m = (a + b) / 2; if (probe.isPointInPath(p, m, y)) a = m; else b = m; }
  return (edgeCache[k] = a);
}
function lensBox(sh) {
  const k = sh.id + 'box'; if (edgeCache[k]) return edgeCache[k];
  let top = 0, bot = 0; for (let y = 0; y > -1.4; y -= 0.01) { if (probe.isPointInPath(lensPath(sh), CX, y)) top = y; else break; }
  for (let y = 0; y < 1.4; y += 0.01) { if (probe.isPointInPath(lensPath(sh), CX, y)) bot = y; else break; }
  return (edgeCache[k] = { top, bot });
}

const tortoiseCache = {};
function tortoisePattern(ctx, base, spot) {
  const key = base + spot;
  if (!tortoiseCache[key]) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    x.fillStyle = base; x.fillRect(0, 0, 128, 128);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 70; i++) {
      const px = rnd() * 128, py = rnd() * 128, r = 3 + rnd() * 12; const g = x.createRadialGradient(px, py, 0, px, py, r);
      const a = 0.35 + rnd() * 0.5; g.addColorStop(0, rgba(spot, a)); g.addColorStop(1, rgba(spot, 0));
      x.fillStyle = g; x.beginPath(); x.ellipse(px, py, r * 1.6, r, rnd() * 3, 0, Math.PI * 2); x.fill();
    }
    for (let i = 0; i < 25; i++) { const px = rnd() * 128, py = rnd() * 128, r = 2 + rnd() * 6; x.fillStyle = rgba('#E8B063', 0.25); x.beginPath(); x.arc(px, py, r, 0, 7); x.fill(); }
    tortoiseCache[key] = c;
  }
  const p = ctx.createPattern(tortoiseCache[key], 'repeat'); p.setTransform(new DOMMatrix().scale(1 / 110)); return p;
}
function metalOf(F) { return F.kind === 'metal' ? F : { c: F.c, hi: mix(F.c, '#ffffff', 0.55), lo: mix(F.c, '#000000', 0.45) }; }
function metalGrad(ctx, M, y0 = -0.8, y1 = 0.8) { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, M.hi); g.addColorStop(0.35, M.c); g.addColorStop(0.7, M.lo); g.addColorStop(1, M.c); return g; }
function paint(ctx, F, asMetal, box) {
  if (asMetal) return metalGrad(ctx, metalOf(F));
  if (F.kind === 'tortoise') return tortoisePattern(ctx, F.c, F.spot);
  if (F.kind === 'clear') return rgba(mix(F.c, '#000000', 0.15), 0.9);
  if (F.kind === 'grad') { const g = ctx.createLinearGradient(0, CY + box.top, 0, CY + box.bot); g.addColorStop(0, F.c); g.addColorStop(0.35, F.c); g.addColorStop(1, rgba(F.c2, 0.55)); return g; }
  return F.c;
}

// P: {iL,iR,B,eL,eR} pixel points. Draws into ctx (cleared first).
export function drawGlasses(ctx, P, frameId, shapeId, gScale, accentWarm) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
  const sh = SHAPE_BY_ID[shapeId]; if (!P || !sh || !sh.d || !frameId) return;
  const F = FRAMES[frameId];
  let L = P.iL, R = P.iR, eL = P.eL, eR = P.eR;
  if (L.x > R.x) { [L, R] = [R, L]; [eL, eR] = [eR, eL]; }
  const dx = R.x - L.x, dy = R.y - L.y, d = Math.hypot(dx, dy); if (d < 6) return;
  const e = { x: dx / d, y: dy / d }, n = { x: -e.y, y: e.x };
  const t = clamp((P.B.x - L.x) * e.x + (P.B.y - L.y) * e.y, d * 0.3, d * 0.7);
  const C = { x: L.x + e.x * t, y: L.y + e.y * t };
  gScale *= 0.94;
  const u = (d / 2) * gScale;
  const sides = [{ s: (d - t) * gScale, sign: 1, ear: eR }, { s: t * gScale, sign: -1, ear: eL }];
  const rim = sh.rim || 'full';
  const isMetalF = F.kind === 'metal';
  const wire = isMetalF || sh.thin || rim === 'rimless';
  const th = (wire ? 0.068 : 0.15) * (sh.thk || 1);
  const accent = accentWarm ? FRAMES.gold : FRAMES.silver;
  const box = lensBox(sh);
  const toScreen = (sd, x, y) => ({ x: C.x + e.x * x * sd.s * sd.sign + n.x * y * u, y: C.y + e.y * x * sd.s * sd.sign + n.y * y * u });
  const setT = (sd) => ctx.setTransform(e.x * sd.s * sd.sign, e.y * sd.s * sd.sign, n.x * u, n.y * u, C.x, C.y);
  const hingeY = CY + box.top * 0.62;
  const outerHinge = edgeX(sh, hingeY, true);

  // temples (behind the front)
  for (const sd of sides) {
    const hx = outerHinge + 0.12, hinge = toScreen(sd, hx, hingeY);
    const earLocal = ((sd.ear.x - C.x) * e.x + (sd.ear.y - C.y) * e.y) * sd.sign / sd.s;
    if (earLocal > hx + 0.02) {
      const end = toScreen(sd, hx + (earLocal - hx) * 0.9, hingeY + 0.08);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const base = isMetalF ? F.c : F.kind === 'grad' ? F.c : F.kind === 'clear' ? rgba(F.c, 0.8) : F.c;
      const g = ctx.createLinearGradient(hinge.x, hinge.y, end.x, end.y);
      g.addColorStop(0, base); g.addColorStop(0.75, base); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.strokeStyle = g; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.5, (wire ? 0.07 : 0.13) * u);
      ctx.beginPath(); ctx.moveTo(hinge.x, hinge.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    }
  }
  for (const sd of sides) {
    setT(sd);
    const lens = lensPath(sh);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // lens tint + reflections
    ctx.fillStyle = F.kind === 'clear' ? rgba(F.c, 0.10) : rim === 'rimless' ? 'rgba(220,232,245,0.13)' : 'rgba(225,235,245,0.08)'; ctx.fill(lens);
    ctx.save(); ctx.clip(lens);
    const rg = ctx.createLinearGradient(CX - 0.8, CY - 0.8, CX + 0.6, CY + 0.8);
    rg.addColorStop(0, 'rgba(255,255,255,0)'); rg.addColorStop(0.28, 'rgba(255,255,255,0.20)'); rg.addColorStop(0.36, 'rgba(255,255,255,0.04)');
    rg.addColorStop(0.5, 'rgba(255,255,255,0.12)'); rg.addColorStop(0.6, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg; ctx.fillRect(CX - 1.4, CY - 1.4, 2.8, 2.8); ctx.restore();

    // bridge
    const browTop = rim === 'brow' || rim === 'combo';
    const M = isMetalF ? F : browTop ? accent : metalOf(F);
    const bY = CY + box.top * 0.6;
    if (wire || browTop || sh.bridge === 'double') {
      const bx = edgeX(sh, bY, false) + 0.02;
      ctx.strokeStyle = metalGrad(ctx, M, -0.6, -0.2); ctx.lineWidth = 0.06;
      ctx.beginPath(); ctx.moveTo(0, bY + 0.04); ctx.quadraticCurveTo(bx * 0.5, bY - 0.06, bx, bY); ctx.stroke();
      if (sh.bridge === 'double') { const y2 = CY + box.top * 0.95, bx2 = edgeX(sh, y2 + 0.06, false) + 0.02; ctx.beginPath(); ctx.moveTo(0, y2 - 0.04); ctx.quadraticCurveTo(bx2 * 0.5, y2 - 0.06, bx2, y2 + 0.06); ctx.stroke(); }
      ctx.fillStyle = 'rgba(240,244,248,0.35)'; ctx.strokeStyle = 'rgba(160,170,180,0.5)'; ctx.lineWidth = 0.015;
      ctx.beginPath(); ctx.ellipse(0.30, 0.12, 0.07, 0.15, -0.3, 0, 7); ctx.fill(); ctx.stroke();
      const px0 = edgeX(sh, bY + 0.15, false) + 0.02; ctx.strokeStyle = metalGrad(ctx, M); ctx.lineWidth = 0.02;
      ctx.beginPath(); ctx.moveTo(px0, bY + 0.15); ctx.quadraticCurveTo(0.42, -0.1, 0.32, 0.0); ctx.stroke();
      if (rim === 'rimless') { ctx.fillStyle = metalGrad(ctx, M); ctx.beginPath(); ctx.arc(bx + 0.02, bY, 0.035, 0, 7); ctx.fill(); }
    } else {
      const bx = edgeX(sh, bY + 0.1, false) + th * 0.3;
      ctx.strokeStyle = paint(ctx, F, false, box); ctx.lineWidth = th * 0.95;
      ctx.beginPath(); ctx.moveTo(0, bY + 0.08); ctx.quadraticCurveTo(bx * 0.5, bY - 0.02, bx, bY + 0.1); ctx.stroke();
    }

    // rim
    const clipTop = (fn) => { ctx.save(); ctx.beginPath(); ctx.rect(CX - 1.6, CY - 1.6, 3.2, 1.6 + box.top * 0.18 + 0.02); ctx.clip(); fn(); ctx.restore(); };
    if (browTop) {
      ctx.strokeStyle = metalGrad(ctx, M); ctx.lineWidth = 0.045; ctx.stroke(lens);
      const topF = isMetalF ? FRAMES.black : F;
      clipTop(() => {
        ctx.strokeStyle = paint(ctx, topF, false, box); ctx.lineWidth = rim === 'combo' ? 0.17 : 0.21;
        ctx.save(); ctx.translate(0, -0.035); ctx.stroke(lens); ctx.restore();
        if (!topF.matte) { ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 0.04; ctx.save(); ctx.translate(0, -0.09); ctx.stroke(lens); ctx.restore(); }
      });
    } else if (rim === 'halfrim') {
      ctx.strokeStyle = 'rgba(30,30,30,0.18)'; ctx.lineWidth = 0.022; ctx.stroke(lens);           // nylon thread
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 0.01; ctx.stroke(lens);
      clipTop(() => { ctx.strokeStyle = paint(ctx, F, isMetalF, box); ctx.lineWidth = isMetalF ? 0.09 : 0.14; ctx.stroke(lens);
        ctx.strokeStyle = isMetalF ? rgba(F.hi, 0.7) : 'rgba(255,255,255,0.2)'; ctx.lineWidth = 0.03; ctx.save(); ctx.translate(0, -0.03); ctx.stroke(lens); ctx.restore(); });
    } else if (rim === 'rimless') {
      ctx.strokeStyle = 'rgba(40,50,60,0.16)'; ctx.lineWidth = 0.035; ctx.stroke(lens);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.014; ctx.save(); ctx.translate(-0.008, -0.01); ctx.stroke(lens); ctx.restore();
    } else {
      ctx.strokeStyle = paint(ctx, F, wire && !isMetalF ? true : isMetalF, box); ctx.lineWidth = th; ctx.stroke(lens);
      if (F.kind === 'clear' && !wire) {
        ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = th * 0.62; ctx.stroke(lens); ctx.restore();
        ctx.strokeStyle = rgba(F.c, 0.35); ctx.lineWidth = th * 0.62; ctx.stroke(lens);
      }
      if (F.kind === 'grad' && !wire) { ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = th * 0.5; ctx.stroke(lens); ctx.restore(); }
      if (!F.matte) {
        ctx.save(); ctx.translate(0, -th * 0.28);
        ctx.strokeStyle = wire ? rgba(metalOf(F).hi, 0.75) : rgba('#ffffff', F.kind === 'clear' ? 0.5 : 0.2);
        ctx.lineWidth = th * (wire ? 0.3 : 0.22); ctx.setLineDash([0.9, 0.5]); ctx.lineDashOffset = 0.2; ctx.stroke(lens); ctx.restore();
      }
    }
    // end piece / hinge block
    const metalEnd = wire || rim === 'rimless';
    ctx.fillStyle = metalEnd ? metalGrad(ctx, isMetalF ? F : metalOf(F)) : (F.kind === 'clear' ? rgba(mix(F.c, '#000000', 0.15), 0.85) : paint(ctx, browTop && isMetalF ? FRAMES.black : F, false, box));
    const ex0 = outerHinge - (metalEnd ? 0.03 : th * 0.4), eh = metalEnd ? 0.12 : 0.2;
    ctx.beginPath(); ctx.roundRect(ex0, hingeY - eh / 2, outerHinge + 0.14 - ex0, eh, 0.05); ctx.fill();
    if (rim === 'rimless') { ctx.fillStyle = 'rgba(230,235,240,0.9)'; ctx.beginPath(); ctx.arc(ex0 + 0.02, hingeY, 0.03, 0, 7); ctx.fill(); }
    if (!metalEnd && rim === 'full') { ctx.fillStyle = rgba('#e0e0e0', 0.55); ctx.beginPath(); ctx.arc(ex0 - 0.03, hingeY, 0.02, 0, 7); ctx.fill(); }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export function shapeIconSVG(sh) {
  if (!sh.d) return '<svg viewBox="-230 -100 460 200"><line x1="-120" y1="-60" x2="120" y2="60" stroke="#c9b9c4" stroke-width="10"/></svg>';
  const s = sh.sc || 1, sw = sh.thin || sh.rim === 'rimless' ? 7 : 13 * (sh.thk || 1);
  const dash = sh.rim === 'rimless' ? ' stroke-dasharray="4 6" stroke-opacity=".6"' : '';
  const lens = (m) => `<path d="${sh.d}" transform="${m}translate(108,-4) scale(${s})" stroke-width="${sw / s}"${dash}/>`;
  let extra = '';
  if (sh.rim === 'brow' || sh.rim === 'combo' || sh.rim === 'halfrim')
    extra = `<path d="M 30 -50 Q 108 -72 190 -56 M -30 -50 Q -108 -72 -190 -56" stroke-width="26"/>`;
  const br = sh.bridge === 'double' ? '<path d="M -30 -40 Q 0 -52 30 -40 M -36 -62 Q 0 -70 36 -62"/>' : '<path d="M -30 -34 Q 0 -50 30 -34"/>';
  return `<svg viewBox="-230 -100 460 200" fill="none" stroke="#3d3346" stroke-width="10" stroke-linejoin="round">${lens('')}${lens('scale(-1,1) ')}${br}${extra}</svg>`;
}
