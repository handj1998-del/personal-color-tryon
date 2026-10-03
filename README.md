# 퍼스널컬러 가상 피팅 (안경테 · 헤어 컬러 · 헤어스타일)

Static, 100% client-side web app (index.html / style.css / app.js / frames.js / hairstyle.js). Camera frames and photos are processed on the device and never uploaded.

- MediaPipe Tasks Vision 1.0.1 (jsDelivr CDN): FaceLandmarker (478 pts) + ImageSegmenter (hair_segmenter)
- Live mode (default when a camera exists): landmarks every frame (One-Euro smoothing), hair mask every 2–4 frames, GPU delegate with auto-switch to CPU when the GPU path is slow
- Glasses: 20 procedural frame shapes × 30 colors/materials (metal, acetate, tortoise, clear, matte, two-tone gradient)
- Hairstyles: 14 procedural templates (9 women + 5 men) + bangs options, anchored with a least-squares affine to face landmarks; original hair is inpainted (push-pull fill), the face oval/neck occlude the new hair, and the chosen color tints the template
- URL flags: `?photo`, `?sample`, `?cpu`, `?res=640`

## 앱 설치 (PWA)
- Android/Chrome: 상단 **📲 앱 설치** 버튼 (또는 메뉴 → 앱 설치)
- iPhone/iPad Safari: 공유 버튼 → **홈 화면에 추가**
- 첫 실행 후에는 인터넷 없이도 동작합니다 (앱 화면 + MediaPipe 런타임/모델을 서비스 워커가 캐시).
- `vendor/mediapipe`: Google MediaPipe Tasks Vision 1.0.1 런타임과 face_landmarker / hair_segmenter 모델 (Apache License 2.0).

## ✨ AI 실제 합성 (선택 기능, 클라우드)
- 사진 모드/촬영한 사진에서 **✨ AI 실제 합성** → 선택한 헤어스타일·앞머리·컬러를 사진처럼 합성 (라이브 모드는 계속 기기 내 처리).
- 첫 전송 전 동의 화면(‘사진이 AI 서버로 전송됩니다’). 오프라인이면 버튼 비활성.
- **⚙️ AI 설정**에서 사장님 본인 API 키 입력 → 이 기기 localStorage에만 저장 (저장소·서버에 키 없음).
  - Google Gemini (기본, `gemini-3.1-flash-image` ≈ $0.068/장): https://aistudio.google.com/apikey — 결제(유료 등급) 필요
  - fal.ai (`fal-ai/nano-banana-2/edit` $0.08/장): https://fal.ai/dashboard/keys
- ‘얼굴은 원본 그대로 유지’(기본 켜짐): AI 결과에 원본 눈·코·입 영역을 정렬해 다시 합쳐 얼굴이 바뀌지 않게 함.
- 안경은 AI 결과 위에 얼굴을 다시 인식해 씌움. 전/후 나란히 비교·저장 가능.
