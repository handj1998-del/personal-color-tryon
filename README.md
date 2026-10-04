# 퍼스널컬러 가상 피팅 (안경테 · 헤어 컬러 · 헤어스타일)

Static, 100% client-side web app (index.html / style.css / app.js / frames.js / hairstyle.js). Camera frames and photos are processed on the device and never uploaded.

- MediaPipe Tasks Vision 1.0.1 (jsDelivr CDN): FaceLandmarker (478 pts) + ImageSegmenter (hair_segmenter)
- Live mode (default when a camera exists): landmarks every frame (One-Euro smoothing), hair mask every 2–4 frames, GPU delegate with auto-switch to CPU when the GPU path is slow
- Glasses (v3): photoreal front-view layers pre-rendered in Blender/Cycles (`assets/glasses`, 34 shape variants) recoloured per material in the browser (metal gradient-map, acetate/tortoise/clear/gradient tints keeping the rendered highlights), warped onto the face from iris/nose-bridge landmarks, with lens reflections (screen), slight lens darkening and a soft contact shadow. The old procedural renderer (`frames.js`) is the fallback while assets load (`?proc` forces it).
- Hairstyles (v3): photoreal hair cut-outs (`assets/hair`, 14 styles + bang variants) from locally generated portraits, matted with MediaPipe hair segmentation + closed-form matting, stored as luminance+alpha in a canonical face space and recoloured with the chosen hair colour; procedural templates (`hairstyle.js`) remain as fallback. Templates are anchored with a least-squares affine to face landmarks; original hair is inpainted (push-pull fill), the face oval/neck occlude the new hair, and the chosen color tints the template
- URL flags: `?photo`, `?sample`, `?cpu`, `?res=640`

## 앱 설치 (PWA)
- Android/Chrome: 상단 **📲 앱 설치** 버튼 (또는 메뉴 → 앱 설치)
- iPhone/iPad Safari: 공유 버튼 → **홈 화면에 추가**
- 첫 실행 후에는 인터넷 없이도 동작합니다 (앱 화면 + MediaPipe 런타임/모델을 서비스 워커가 캐시).
- `vendor/mediapipe`: Google MediaPipe Tasks Vision 1.0.1 런타임과 face_landmarker / hair_segmenter 모델 (Apache License 2.0).


See `assets/CREDITS.md` for asset sources and licenses. Everything runs on-device; there is no server/API feature.

## 버전 · 업데이트
- 버전은 `version.js` 한 곳에서 관리합니다 (`tools/bump-version.sh v18` 가 `version.js` + `version.json` 을 함께 갱신). `sw.js` 는 `version.js` 를 import 해서 캐시 이름(`pc-tryon-vN`)으로 쓰고, 표지·메인 하단에 `vN · 날짜` 가 표시됩니다.
- 표지 하단 **🔄 업데이트 확인** / 메인 하단 **🔄 새로고침**: 서비스 워커 업데이트(SKIP_WAITING) → 이전 캐시 삭제 → 캐시 우회 새로고침.
- 실행 시·앱 복귀 시 `version.json` 을 no-store 로 확인해 새 버전이 있으면 상단에 ‘새 버전이 있어요 · 업데이트’ 배너가 뜹니다.
