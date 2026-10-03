// AI 실제 합성 (photo-realistic hair editing) — optional, cloud. The photo is sent to the provider the shop owner
// configured with THEIR OWN API key (stored only in this device's localStorage). Nothing is sent without consent.

export const PROVIDERS = {
  gemini: {
    n: 'Google Gemini (Nano Banana 2)', keyName: 'Gemini API key', keyHint: 'AIza…',
    signup: 'https://aistudio.google.com/apikey',
    models: [
      { id: 'gemini-3.1-flash-image', n: 'Nano Banana 2 · gemini-3.1-flash-image (추천)', usd: 0.068 },
      { id: 'gemini-3-pro-image', n: 'Nano Banana Pro · gemini-3-pro-image (최고 품질, 느림)', usd: 0.135 },
      { id: 'gemini-3.1-flash-lite-image', n: 'Nano Banana 2 Lite · gemini-3.1-flash-lite-image (저렴·빠름)', usd: 0.034 },
    ],
  },
  fal: {
    n: 'fal.ai', keyName: 'FAL API key', keyHint: 'xxxxxxxx-…:…',
    signup: 'https://fal.ai/dashboard/keys',
    models: [
      { id: 'fal-ai/nano-banana-2/edit', n: 'Nano Banana 2 edit (추천)', usd: 0.08 },
      { id: 'fal-ai/nano-banana-pro/edit', n: 'Nano Banana Pro edit (최고 품질)', usd: 0.15 },
    ],
  },
};

const LS = 'pc.ai.v1';
export function loadSettings() {
  try { const s = JSON.parse(localStorage.getItem(LS) || '{}'); return { provider: 'gemini', model: '', key: '', consent: false, keepFace: true, ...s }; }
  catch { return { provider: 'gemini', model: '', key: '', consent: false, keepFace: true }; }
}
export function saveSettings(s) { localStorage.setItem(LS, JSON.stringify(s)); }
export function modelOf(s) { const P = PROVIDERS[s.provider] || PROVIDERS.gemini; return P.models.find((m) => m.id === s.model) || P.models[0]; }

/* ---------------- prompt ---------------- */
const STYLE_EN = {
  short_f: "a chic Korean women's short cut (숏컷): cropped, pixie-like length ending around the ears and nape, soft natural texture",
  bob: 'a chin-length Korean bob (단발): one-length, ends falling at the jawline with a slight inward curve',
  layered_bob: 'a jaw-length layered bob: light, feathered layers with airy movement at the ends',
  ccurl: 'a shoulder-length Korean C-curl medium cut (C컬 중단발): ends softly curled inward in a C shape, smooth and glossy',
  hush: 'a Korean hush cut (허쉬컷): shoulder-length shaggy layered cut with wispy face-framing layers and light, airy volume',
  long: 'long, straight, sleek hair falling well below the shoulders to mid-chest',
  wave: 'long hair below the shoulders with soft, loose S-shaped waves (S컬), natural volume',
  hippie: 'a Korean hippie perm (히피펌): medium-long hair with voluminous, small, tight frizzy curls throughout',
  ponytail: 'hair pulled back neatly and tied into a ponytail at the back of the head, ears and hairline visible',
  dandy: "a Korean men's dandy cut (댄디컷): short, neat men's haircut, natural straight bangs lightly covering the upper forehead, tapered sides above the ears",
  twoblock: "a Korean men's two-block cut (투블럭): sides and back buzzed short with a visible clipper fade showing scalp, longer textured hair on top with the fringe falling forward",
  leaf: "a Korean men's leaf cut (리프컷): medium-short men's hair, fringe parted in the middle and swept outward to both sides like leaves, soft layered sides covering the tops of the ears",
  garma: "a Korean men's garma perm (가르마펌): men's hair side-parted about 6:4 with a soft volume perm, the forehead partly visible through the parted fringe",
  comma: "a Korean men's comma hair (쉼표머리): short men's hair whose fringe is swept to one side and curls inward at the forehead like a comma",
};
const BANG_EN = {
  none: 'no bangs: forehead visible, hair parted naturally',
  full: 'full, blunt, straight-across bangs that cover the eyebrows',
  seethrough: 'Korean see-through bangs (시스루뱅): thin, wispy, sparse bangs through which the forehead is visible',
  side: 'long side-swept bangs angled across the forehead to one side',
};
const COLOR_EN = {
  '밀크브라운': 'milk brown (a light, soft, milky beige-brown)', '허니브라운': 'honey brown (a warm, golden light brown)',
  '오렌지브라운': 'orange brown (a warm brown with orange undertones)', '골드브라운': 'gold brown (a warm golden brown)',
  '코랄브라운': 'coral brown (a warm brown with soft coral-pink undertones)', '카라멜브라운': 'caramel brown (a warm medium caramel brown)',
  '애쉬브라운': 'ash brown (a cool, muted greyish brown with no red or orange)', '애쉬베이지': 'ash beige (a light, cool greyish beige)',
  '로즈브라운': 'rose brown (a cool brown with a subtle rosy-pink tint)', '라벤더브라운': 'lavender brown (a cool brown with a subtle lavender-violet tint)',
  '애쉬그레이': 'ash grey (a cool, muted grey-brown)', '소프트블랙': 'soft black (a natural, slightly softened black)',
  '초코브라운': 'chocolate brown (a deep, rich brown)', '다크브라운': 'dark brown (a natural dark brown)',
  '카퍼브라운': 'copper brown (a warm coppery reddish brown)', '카키브라운': 'khaki brown (a muted olive-khaki brown)',
  '마호가니': 'mahogany (a deep reddish brown)', '올리브브라운': 'olive brown (a muted, slightly greenish brown)',
  '블루블랙': 'blue black (jet black with a subtle cool blue sheen)', '블랙': 'jet black (natural deep black)',
  '다크애쉬': 'dark ash (a very dark, cool ash brown)', '버건디': 'burgundy (a deep wine red)',
  '플럼퍼플': 'plum purple (a deep, dark purple-plum)', '쿨다크브라운': 'cool dark brown (a dark brown without warm tones)',
};
export function buildPrompt({ style, bang, gender, hair, intensity = 1 }) {
  const parts = [];
  const hasStyle = style && style !== 'none' && STYLE_EN[style];
  if (hasStyle) {
    let s = `Give this person ${STYLE_EN[style]}`;
    if (gender !== 'm' && bang && BANG_EN[bang]) s += `, with ${BANG_EN[bang]}`;
    parts.push(s + '.');
  } else parts.push('Keep the current haircut, length, parting and shape exactly as they are.');
  if (hair) {
    const desc = COLOR_EN[hair.n] || hair.n;
    parts.push(`${intensity < 0.5 ? 'Tint the hair subtly toward' : 'Dye the hair'} ${desc}, approximately ${hair.c} in the mid-lengths, with natural dimension (slightly deeper roots, soft highlights where light hits). Apply the color evenly to all of the hair.`);
  } else parts.push("Keep the person's natural hair color.");
  return [
    'Photo edit of a real person for a hair salon consultation. Change ONLY the hair.',
    ...parts,
    "Keep the face 100% identical: same identity, face shape, eyes, eyebrows, nose, lips, skin tone and texture, makeup, expression, age and head pose. Keep any glasses, earrings, clothing, background, lighting, camera angle, framing and image size exactly the same.",
    'The hair must be photorealistic: natural hairline, individual strands and flyaways, realistic volume, shine and shadows matching the existing lighting, and correct occlusion with the ears, neck and shoulders.',
    'Do not add new accessories, text, or watermarks. Do not beautify or retouch the face.',
  ].join(' ');
}

/* ---------------- request helpers ---------------- */
const RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9'];
export function nearestRatio(w, h) {
  const r = w / h; let best = '1:1', d = 1e9;
  for (const s of RATIOS) { const [a, b] = s.split(':').map(Number), e = Math.abs(Math.log(r / (a / b))); if (e < d) { d = e; best = s; } }
  return best;
}
export async function canvasToB64(canvas, maxSide = 1280, q = 0.92) {
  const s = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const c = document.createElement('canvas'); c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', q);
  return { mime: 'image/jpeg', b64: url.slice(url.indexOf(',') + 1), dataUrl: url, w: c.width, h: c.height };
}
class AIError extends Error { constructor(msg, kind) { super(msg); this.kind = kind; } }
async function errText(r) {
  let j = null; try { j = await r.json(); } catch { /* ignore */ }
  const m = j && (j.error?.message || j.detail?.[0]?.msg || j.detail || j.message);
  return typeof m === 'string' ? m : JSON.stringify(m || j || r.statusText);
}
function kindOf(status, msg) {
  if (status === 401 || status === 403 || /API key|api_key|Unauthorized|invalid key|authentication/i.test(msg)) return 'auth';
  if (status === 429) return 'quota';
  if (status === 402 || /billing|balance|credit|quota|exhausted/i.test(msg)) return 'billing';
  if (/safety|blocked|prohibited|SAFETY|IMAGE_SAFETY/i.test(msg)) return 'safety';
  return 'other';
}

async function callGemini({ key, model, img, prompt, ratio, signal }) {
  const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`;
  const body = (withFormat) => ({
    contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: img.mime, data: img.b64 } }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], ...(withFormat ? { imageConfig: { aspectRatio: ratio, imageSize: '1K' } } : {}) },
  });
  let r = await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body(true)) });
  if (r.status === 400) { // a model/API version that rejects imageConfig: retry without it
    const msg = await errText(r);
    if (/image_?config|aspect_?ratio|image_?size|Unknown name|Invalid JSON payload|Invalid value/i.test(msg)) r = await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body(false)) });
    else throw new AIError(msg, kindOf(400, msg));
  }
  if (!r.ok) { const msg = await errText(r); throw new AIError(msg, kindOf(r.status, msg)); }
  const j = await r.json();
  const cand = j.candidates && j.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const p = parts.find((q) => (q.inlineData || q.inline_data) && !q.thought) || parts.find((q) => q.inlineData || q.inline_data);
  if (!p) {
    const why = (j.promptFeedback && j.promptFeedback.blockReason) || (cand && cand.finishReason) || parts.map((q) => q.text).filter(Boolean).join(' ') || '이미지가 반환되지 않음';
    throw new AIError(String(why), kindOf(200, String(why)));
  }
  const d = p.inlineData || p.inline_data;
  return `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}`;
}

async function callFal({ key, model, img, prompt, ratio, signal }) {
  const r = await fetch(`https://fal.run/${model}`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Key ${key}` },
    body: JSON.stringify({ prompt, image_urls: [img.dataUrl], num_images: 1, aspect_ratio: ratio, output_format: 'jpeg', resolution: '1K', sync_mode: true, limit_generations: true }),
  });
  if (!r.ok) { const msg = await errText(r); throw new AIError(msg, kindOf(r.status, msg)); }
  const j = await r.json();
  const u = j.images && j.images[0] && j.images[0].url;
  if (!u) throw new AIError(j.description || '이미지가 반환되지 않음', 'other');
  return u; // data: URI with sync_mode, otherwise https URL on fal.media (CORS-enabled)
}

export async function generate(settings, canvas, opts, signal) {
  const img = await canvasToB64(canvas);
  const ratio = nearestRatio(canvas.width, canvas.height), model = modelOf(settings).id, prompt = buildPrompt(opts);
  const fn = settings.provider === 'fal' ? callFal : callGemini;
  const src = await fn({ key: settings.key.trim(), model, img, prompt, ratio, signal });
  const blob = await (await fetch(src, { signal })).blob();
  return { bitmap: await createImageBitmap(blob), prompt, model };
}
export const errorMessage = (e) => {
  if (e.name === 'AbortError') return '취소했어요';
  if (e instanceof TypeError) return '네트워크 오류예요. 인터넷 연결을 확인해 주세요.';
  switch (e.kind) {
    case 'auth': return 'API 키가 올바르지 않아요. ⚙️ AI 설정에서 키를 확인해 주세요.';
    case 'quota': return '요청이 너무 많아요(사용 한도). 잠시 후 다시 시도해 주세요.';
    case 'billing': return '결제/크레딧 설정이 필요해요. 제공사 대시보드에서 결제 수단을 확인해 주세요.';
    case 'safety': return 'AI가 이 사진의 편집을 거부했어요(안전 필터). 다른 사진으로 시도해 주세요.';
    default: return 'AI 합성 실패: ' + String(e.message || e).slice(0, 140);
  }
};
