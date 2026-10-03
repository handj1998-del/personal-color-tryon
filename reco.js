// On-device recommendation: face shape from landmarks + personal-colour estimate from skin/hair/eye colour, then rule tables.
// Honest heuristics only (reference for the consultant, who can override the colour type).
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------------- face shape ---------------- */
export function faceMetrics(p) {
  // p: 478 MediaPipe landmarks in px [[x,y],...]
  const cheekW = dist(p[234], p[454]);                 // bizygomatic
  const foreW = dist(p[54], p[284]);                   // upper forehead / temples
  const jawW = dist(p[172], p[397]);                   // gonial (jaw corners)
  const chinW = dist(p[136], p[365]);                  // lower jaw, toward the chin
  const len = dist(p[10], p[152]) * 1.18;              // lm10 sits below the hairline -> approx. hairline-to-chin
  // jaw angle at the gonion: between the ramus (up to the ear-side cheek point) and the jaw line toward the chin
  const ang = (o, a, b) => { const v1 = [a[0] - o[0], a[1] - o[1]], v2 = [b[0] - o[0], b[1] - o[1]]; return Math.acos(clamp((v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2)), -1, 1)) * 180 / Math.PI; };
  const jawAng = (ang(p[172], p[234], p[152]) + ang(p[397], p[454], p[152])) / 2;
  return { R: len / cheekW, fore: foreW / cheekW, jaw: jawW / cheekW, chin: chinW / cheekW, jawAng };
}
export const SHAPES_KO = { oval: '계란형', round: '둥근형', square: '각진형', long: '긴형', heart: '하트형', diamond: '다이아몬드형' };
export function classifyFace(m) {
  // z-scores against typical adult proportions (MediaPipe frontal), so each shape needs a clear deviation to win over 계란형
  const zR = (m.R - 1.43) / 0.07, zF = (m.fore - 0.86) / 0.025, zJ = (m.jaw - 0.8) / 0.02, zC = (m.chin - 0.7) / 0.02, zA = (m.jawAng - 136) / 4;
  const sc = {
    long: zR - 1.0,
    round: -zR * 0.8 + zA * 0.25 + zC * 0.25 - 0.6,
    square: zJ * 0.6 - zA * 0.45 + zC * 0.2 - 0.7,
    heart: zF * 0.55 - zJ * 0.45 - zC * 0.35 - 0.7,
    diamond: -zF * 0.55 - zJ * 0.35 - zC * 0.2 - 0.7,
    oval: 0.4 - 0.25 * Math.max(Math.abs(zR), Math.abs(zJ), Math.abs(zF)),
  };
  const order = Object.entries(sc).sort((a, b) => b[1] - a[1]);
  return { shape: order[0][0], scores: sc };
}

/* ---------------- colour ---------------- */
function srgb2lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
export function rgb2lab([r, g, b]) {
  const R = srgb2lin(r), G = srgb2lin(g), B = srgb2lin(b);
  let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; X = f(X); Y = f(Y); Z = f(Z);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
function sampleDisc(img, W, H, cx, cy, r, keep) {
  const out = []; const d = img.data;
  for (let y = Math.max(0, Math.round(cy - r)); y <= Math.min(H - 1, Math.round(cy + r)); y++)
    for (let x = Math.max(0, Math.round(cx - r)); x <= Math.min(W - 1, Math.round(cx + r)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue; const i = (y * W + x) * 4; const px = [d[i], d[i + 1], d[i + 2]]; if (!keep || keep(px, x, y)) out.push(px);
    }
  return out;
}
function robustMean(arr) { // drop the darkest/brightest 20 % by luminance
  if (!arr.length) return null; const s = arr.map((p) => [0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2], p]).sort((a, b) => a[0] - b[0]);
  const a = Math.floor(s.length * 0.2), b = Math.max(a + 1, Math.ceil(s.length * 0.8)); let r = 0, g = 0, bb = 0, n = 0;
  for (let i = a; i < b; i++) { r += s[i][1][0]; g += s[i][1][1]; bb += s[i][1][2]; n++; } return [r / n, g / n, bb / n];
}
// white balance: estimate the illuminant from the eye whites (sclera) when visible, else partial grey-world; returns per-channel gains
function whiteBalance(img, W, H, p) {
  const sc = [];
  for (const [a, b] of [[33, 133], [362, 263]]) { // eye corners -> sample between corner and iris
    const iris = a === 33 ? p[468] : p[473];
    for (const c of [p[a], p[b]]) { const x = (c[0] * 0.55 + iris[0] * 0.45), y = (c[1] * 0.55 + iris[1] * 0.45); sc.push(...sampleDisc(img, W, H, x, y, Math.max(1.5, dist(p[33], p[133]) * 0.06))); }
  }
  const br = sc.filter((q) => q[0] + q[1] + q[2] > 300).sort((u, v) => (v[0] + v[1] + v[2]) - (u[0] + u[1] + u[2])).slice(0, Math.max(3, Math.floor(sc.length * 0.4)));
  let ref = robustMean(br);
  if (ref) { const mx = Math.max(...ref); const sat = (mx - Math.min(...ref)) / mx; if (sat > 0.22) ref = null; } // sclera too coloured -> unreliable
  if (!ref) { let r = 0, g = 0, b = 0, n = 0; const d = img.data; for (let i = 0; i < d.length; i += 4 * 7) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } ref = [r / n, g / n, b / n]; }
  const m = (ref[0] + ref[1] + ref[2]) / 3; const k = 0.7; // correct 70 % of the cast (don't over-neutralise)
  return ref.map((v) => clamp(1 + k * (m / Math.max(1, v) - 1), 0.88, 1.12));
}
export function colorMetrics(img, W, H, p, hairRGB) {
  const g = whiteBalance(img, W, H, p), wb = (q) => q.map((v, i) => clamp(v * g[i], 0, 255));
  const fw = dist(p[234], p[454]), r = fw * 0.055;
  const skinPx = [];
  for (const i of [50, 280, 101, 330, 151, 9]) skinPx.push(...sampleDisc(img, W, H, p[i][0], p[i][1], i === 151 || i === 9 ? r * 0.8 : r));
  const skin = wb(robustMean(skinPx));
  const eyePx = []; for (const c of [468, 473]) eyePx.push(...sampleDisc(img, W, H, p[c][0], p[c][1], dist(p[469], p[471]) * 0.3));
  const eye = eyePx.length ? wb(robustMean(eyePx)) : null;
  const hair = hairRGB ? wb(hairRGB) : null;
  const sL = rgb2lab(skin), hL = hair ? rgb2lab(hair) : null, eL = eye ? rgb2lab(eye) : null;
  const hue = Math.atan2(sL[2], sL[1]) * 180 / Math.PI, chroma = Math.hypot(sL[1], sL[2]);
  return { skin, eye, hair, skinLab: sL, hairLab: hL, eyeLab: eL, hue, chroma, contrast: hL ? sL[0] - hL[0] : 40, gains: g };
}
export function classifyColor(c) {
  // undertone: skin hue angle in Lab (yellow-leaning = warm, pink/red-leaning = cool); eye/hair warmth adds a little
  let warm = c.chroma < 4 ? 0 : clamp((c.hue - 50) / 6, -3, 3); // near-grey skin reading (b/w or extreme light) -> no undertone vote
  if (c.hairLab) warm += clamp((Math.atan2(c.hairLab[2], c.hairLab[1]) * 180 / Math.PI - 62) / 25, -0.5, 0.5);
  if (c.eyeLab) warm += clamp(c.eyeLab[2] / 30, -0.3, 0.3);
  const L = c.skinLab[0], light = (L - 66) / 6, contrast = (c.contrast - 38) / 10, clear = (c.chroma - 22) / 5;
  let type, sub;
  if (warm >= 0) {
    const springS = light * 0.6 + clear * 0.5 - contrast * 0.6;
    type = springS >= 0 ? 'spring' : 'autumn';
    sub = type === 'spring' ? (clear > 0.3 ? 'bright' : 'light') : (contrast > 0.3 || L < 60 ? 'deep' : 'mute');
  } else {
    const winterS = contrast * 0.8 + clear * 0.4 - light * 0.3;
    type = winterS >= 0 ? 'winter' : 'summer';
    sub = type === 'winter' ? (clear > 0.2 ? 'bright' : 'deep') : (light > 0 ? 'light' : 'mute');
  }
  return { type, sub, warm, light, contrast, clear, conf: clamp(Math.abs(warm) / 2, 0, 1) };
}

/* ---------------- rule tables ---------------- */
export const GLASSES_BY_FACE = {
  round: [['wellington', '둥근 볼선에 직선 라인을 더해 얼굴을 갸름하게'], ['square', '각진 프레임이 부드러운 윤곽을 또렷하게 정리'], ['hexagon', '면이 나뉜 육각 라인으로 입체감과 세련미'], ['halfrim', '상테가 시선을 위로 올려 얼굴이 길어 보이게']],
  square: [['round', '각진 턱선을 부드럽게 보완하는 라운드'], ['boston', '곡선 위주의 보스턴이 강한 골격을 중화'], ['oval', '타원 라인이 얼굴선을 한결 온화하게'], ['combo', '원형 콤비로 부드러우면서 클래식하게']],
  long: [['oversize', '세로 폭이 큰 프레임이 긴 얼굴을 짧아 보이게'], ['boeing', '넓은 하단 라인이 얼굴 길이를 분산'], ['wellington', '높이 있는 웰링턴으로 중안부 길이 보완'], ['thicksquare', '두꺼운 가로 라인이 시선을 옆으로 넓혀줌']],
  heart: [['oval', '가벼운 오벌이 넓은 이마와 좁은 턱의 균형을'], ['rimless', '무테로 상단 볼륨을 덜어 시선을 아래로'], ['round', '둥근 하단 라인이 좁은 턱을 보완'], ['boeing', '아래로 넓어지는 라인이 하관에 무게감']],
  diamond: [['cateye', '눈꼬리 라인이 광대를 자연스럽게 분산'], ['browline', '하금테 상단이 좁은 이마 라인을 넓혀 보이게'], ['oval', '부드러운 오벌이 도드라진 광대를 완화'], ['rimless', '무테로 광대 부각 없이 깔끔하게']],
  oval: [['boston', '균형 잡힌 얼굴에 잘 맞는 클래식 보스턴'], ['wellington', '어떤 스타일에도 어울리는 웰링턴'], ['cateye', '포인트를 주는 캣아이로 세련되게'], ['round', '라운드로 부드럽고 지적인 인상']],
};
export const HAIR_BY_FACE = {
  f: {
    round: [['long', 'seethrough', '세로로 떨어지는 생머리가 얼굴을 갸름하게'], ['layered_bob', 'seethrough', '정수리 볼륨+레이어로 둥근 윤곽을 보완'], ['hush', 'seethrough', '얼굴선을 감싸는 레이어가 볼살을 커버']],
    square: [['wave', 'none', 'S컬 웨이브가 각진 턱선을 부드럽게'], ['ccurl', 'seethrough', '턱선에서 안으로 말리는 C컬이 골격을 완화'], ['hippie', 'seethrough', '풍성한 컬이 시선을 분산']],
    long: [['bob', 'full', '풀뱅+단발로 얼굴 길이를 짧아 보이게'], ['ccurl', 'full', '옆 볼륨이 있는 C컬로 가로 폭 보완'], ['hush', 'full', '앞머리와 레이어로 세로 길이 분산']],
    heart: [['ccurl', 'seethrough', '턱선 볼륨이 좁은 하관을 채워줌'], ['bob', 'seethrough', '턱 길이 단발로 상하 균형'], ['wave', 'none', '아래로 풍성해지는 웨이브로 균형']],
    diamond: [['bob', 'seethrough', '시스루뱅이 좁은 이마를 커버, 광대 완화'], ['hush', 'seethrough', '광대 옆 레이어가 윤곽을 부드럽게'], ['ccurl', 'none', '턱선 C컬로 하관에 볼륨']],
    oval: [['long', 'none', '균형 잡힌 얼굴형을 살리는 생머리'], ['bob', 'none', '깔끔한 단발로 세련된 인상'], ['wave', 'none', '여성스러운 S컬 웨이브']],
  },
  m: {
    round: [['twoblock', null, '옆은 짧게, 윗머리 볼륨으로 얼굴이 길어 보이게'], ['garma', null, '가르마로 세로 라인을 만들어 갸름하게'], ['comma', null, '이마 라인 포인트로 둥근 윤곽 보완']],
    square: [['garma', null, '부드러운 웨이브가 각진 골격을 완화'], ['leaf', null, '흐르는 리프컷이 턱선 인상을 부드럽게'], ['comma', null, '곡선 앞머리로 강한 인상을 중화']],
    long: [['dandy', null, '내린 앞머리가 얼굴 길이를 짧아 보이게'], ['leaf', null, '옆 볼륨이 가로 폭을 보완'], ['comma', null, '이마를 덮는 라인으로 길이 분산']],
    heart: [['dandy', null, '내린 앞머리가 넓은 이마를 자연스럽게 커버'], ['leaf', null, '옆머리 볼륨으로 하관과 균형'], ['comma', null, '사선 앞머리로 이마 면적 분산']],
    diamond: [['dandy', null, '앞머리로 좁은 이마를 커버, 광대 완화'], ['comma', null, '이마 라인을 채워 윤곽 균형'], ['leaf', null, '옆 볼륨으로 광대 부각 완화']],
    oval: [['garma', null, '균형 잡힌 얼굴형에 잘 맞는 가르마펌'], ['comma', null, '트렌디한 쉼표머리'], ['twoblock', null, '깔끔한 투블럭']],
  },
};
export const COLOR_REASON = { spring: '밝고 따뜻한 톤이 피부를 화사하게', summer: '부드럽고 차분한 쿨톤이 피부를 맑게', autumn: '깊고 따뜻한 톤이 피부에 윤기를', winter: '선명하고 차가운 톤이 이목구비를 또렷하게' };
const isMetal = (FRAMES, f) => FRAMES[f] && FRAMES[f].kind === 'metal';
export function recommend({ shape, type, sub, gender, TYPES, FRAMES, SHAPE_BY_ID }) {
  const T = TYPES[type];
  const gl = GLASSES_BY_FACE[shape].filter(([s]) => SHAPE_BY_ID[s]).slice(0, 3);
  // frame colours: alternate metal / acetate from the type palette so the three looks differ
  const metals = T.frames.filter((f) => isMetal(FRAMES, f)), aces = T.frames.filter((f) => !isMetal(FRAMES, f));
  const thinShapes = new Set(['rimless', 'halfrim', 'titanium', 'browline']);
  const glasses = gl.map(([s, why], i) => {
    const pref = thinShapes.has(s) ? metals : i % 2 === 0 ? aces : metals;
    const f = (pref.length ? pref : T.frames)[Math.floor(i / 2) % (pref.length || T.frames.length)];
    return { shape: s, frame: f, why, colorWhy: `${FRAMES[f].n} · ${T.n} 팔레트` };
  });
  const hair = HAIR_BY_FACE[gender][shape].slice(0, 3).map(([style, bang, why]) => ({ style, bang, why }));
  const colors = (T.hair.filter((h) => h.t.includes(sub)).concat(T.hair.filter((h) => !h.t.includes(sub)))).slice(0, 3).map((h) => ({ hair: h, why: COLOR_REASON[type] }));
  return { glasses, hair, colors };
}
