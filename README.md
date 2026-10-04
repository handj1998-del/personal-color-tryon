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

## 안정화 · 화면 정리 (v20)
- 카메라: 요청 직렬화(연타 시 카메라 스트림이 2~3개 열려 남던 문제), 홈/백그라운드 전환 시 늦게 도착한 스트림 정지, 앱이 백그라운드로 가면 카메라를 끄고 돌아오면 다시 켬, 권한 거부·사용 중 오류는 한국어 안내.
- 다음 고객(🏠) 연타·분석 중 탭 무시, 사진 분석은 한 번에 하나(다시 라이브/다음 고객이 분석 끝을 기다림), 저장/공유 연타 시 1회만, 다음 고객 때 전/후 비교 버튼 상태 초기화, 표지에서 작업용 캔버스 해제.
- 폰 화면: 터치 영역 44px 이상, 헤더 🏠 '다음 고객' 라벨 표시, 카메라 전환 아이콘 ⇄ (새로고침 🔄과 구분), fps 표시는 `?debug`에서만, 세로 화면에서 미리보기가 위에 고정되어 스타일/컬러/안경을 고르는 동안 계속 보임(4:3 프레임 꽉 채움, 전/후 나란히·세로 사진은 전체 표시).
- 테스트: `test/soak.py 20` (고객 20명 연속 + 연타/탭 전환/새로고침), `test/ui_audit.py` (44px 미만 터치 영역·가로 넘침 검사).

## 성별 자동 선택 (v19)
- 촬영 직후 기기 안에서 성별을 추정해(`gender.js`, face-api.js AgeGenderNet 가중치 430 KB, 순수 JS 추론 · 오프라인) 헤어/안경 추천의 기본 남성·여성을 정합니다.
- 남성: 캣아이 프레임과 핑크/라벤더/피치/로즈 계열 컬러는 추천 3개에서 제외.
- 추천 화면 상단의 `성별 [여성|남성]` 토글에 `자동: 남성` 처럼 표시. 확신이 낮으면(0.3 < P(남) < 0.7) 여성으로 두고 토글을 강조합니다. 탭하면 추천이 다시 계산되고 실시간 모드로도 이어집니다.
- 정확도 측정: `python3 test/gender_bench.py` (ALL=1 이면 faces 시트 112명 포함).

## 버전 · 업데이트
- 버전은 `version.js` 한 곳에서 관리합니다 (`tools/bump-version.sh v18` 가 `version.js` + `version.json` 을 함께 갱신). `sw.js` 는 `version.js` 를 import 해서 캐시 이름(`pc-tryon-vN`)으로 쓰고, 표지·메인 하단에 `vN · 날짜` 가 표시됩니다.
- 표지 하단 **🔄 업데이트 확인** / 메인 하단 **🔄 새로고침**: 서비스 워커 업데이트(SKIP_WAITING) → 이전 캐시 삭제 → 캐시 우회 새로고침.
- 실행 시·앱 복귀 시 `version.json` 을 no-store 로 확인해 새 버전이 있으면 상단에 ‘새 버전이 있어요 · 업데이트’ 배너가 뜹니다.
