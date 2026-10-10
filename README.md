# 퍼스널컬러 가상 피팅 (안경테 · 헤어 컬러)

Static, 100% client-side web app (index.html / style.css / app.js / frames.js / glasses3d.js / face.js / reco.js). Camera frames and photos are processed on the device and never uploaded.

- MediaPipe Tasks Vision 1.0.1 (jsDelivr CDN): FaceLandmarker (478 pts) + ImageSegmenter (hair_segmenter)
- Live mode (default when a camera exists): landmarks every frame (One-Euro smoothing), hair mask every 2–4 frames, GPU delegate with auto-switch to CPU when the GPU path is slow
- Glasses (v3): photoreal front-view layers pre-rendered in Blender/Cycles (`assets/glasses`, 34 shape variants) recoloured per material in the browser (metal gradient-map, acetate/tortoise/clear/gradient tints keeping the rendered highlights), warped onto the face from iris/nose-bridge landmarks, with lens reflections (screen), slight lens darkening and a soft contact shadow. The old procedural renderer (`frames.js`) is the fallback while assets load (`?proc` forces it).
- Hair colour (v44): the customer's own hair is dyed on-device (MediaPipe hair_segmenter, self-hosted + service-worker cached). Hairstyle templates were removed in v44.
- URL flags: `?photo`, `?sample`, `?cpu`, `?res=640`

## 앱 설치 (PWA)
- Android/Chrome: 상단 **📲 앱 설치** 버튼 (또는 메뉴 → 앱 설치)
- iPhone/iPad Safari: 공유 버튼 → **홈 화면에 추가**
- 첫 실행 후에는 인터넷 없이도 동작합니다 (앱 화면 + MediaPipe 런타임/모델을 서비스 워커가 캐시).
- `vendor/mediapipe`: Google MediaPipe Tasks Vision 1.0.1 런타임과 face_landmarker / hair_segmenter 모델 (Apache License 2.0).


See `assets/CREDITS.md` for asset sources and licenses. Everything runs on-device; there is no server/API feature.

## 실제 안경 · 내 머리 염색 (v44)
- 헤어스타일 합성 기능 삭제: 헤어스타일 이미지·UI·추천, 이마 지우기/다시 칠하기 전부 제거 (결과 시트에서도 제외). `hairstyle.js`, `assets/hair` 삭제, 얼굴 좌표 함수는 `face.js`.
- 헤어 컬러 = 고객 본인 머리 염색: MediaPipe 헤어 세그멘테이션(오프라인 캐시) → 부드러운 마스크(가이디드 필터로 모발 경계에 맞춤, 잔머리는 모발색 유사도로 보강, 얼굴 안쪽 피부색·눈썹 아래는 제외) → 휘도·결 유지 염색(원래 밝기 대비를 유지한 채 염색 색의 밝기로 이동, 크로마는 염색 색으로 블렌드, 그림자·광택은 채도 감소). 강도 슬라이더 = 염색 세기. 라이브(마스크 2~4프레임마다, 라이트 모드) · 사진 · 결과 시트 · 저장 이미지 모두 동일.
- 계절별 헤어 컬러 팔레트와 추천 TOP 3 컬러 유지.
- 안경 (Blender/Cycles 재렌더): 실제 비율 (뿔테 앞면 ~4 mm, 위쪽이 두껍고 아래가 얇은 형태, 둥근 모서리 / 메탈 ~1.6 mm), 키 라이트 + 스튜디오 HDRI로 광택·입체감. 브라우저에서 테 깎기(slim) 제거.
- 크기: 얼굴 폭(234/454)의 ~86% (동공 거리 기준 0.86~1.04배로 제한), 코받침 위치 그대로.
- 다리(템플): 경첩에서 귀 쪽으로 가늘어지며, 얼굴 뒤로 가는 쪽은 얼굴 윤곽 안에서 가려짐, 끝은 귀/머리 뒤로 사라짐.
- 렌즈: 투명 (뿌연 채움 없음), 약한 반사 + 오목렌즈 굴절(렌즈 안이 ~2% 작게 보임). 그림자: 테 바로 아래 짧은 접촉 그림자 + 부드러운 그림자 + 코받침 그림자.
- 호피(tortoise)도 사진 레이어로 렌더 (예전엔 절차적 테로 대체).

## 이마 자연스럽게 (v23)
- 남성 헤어(투블럭·댄디·리프·가르마·쉼표) 착용 시 이마에 생기던 밝고 각진 덧칠 자국과 원래 머리 비침을 고쳤습니다.
- 원인: 앞머리 정리 규칙이 이마의 주름·햇빛 반사까지 머리카락으로 보고 이마 전체를 지운 뒤 매끈한 색으로 다시 칠했고, 반대로 머리선 근처의 가는 잔머리는 일부만 지워 비쳐 보였습니다.
- 이제 머리 바로 아래의 회색·어두운 잔머리와 세로로 내려온 앞머리만 지우고, 가로 주름은 실제 피부로 남깁니다. 다시 칠하는 부분은 주변 피부 밝기·결을 이어받아 경계가 보이지 않습니다. 라이브·사진·추천 결과·결과 공유 이미지·저장 이미지에 모두 적용됩니다.

## 결과 공유 · 자동 초기화 (v22)
- **결과 공유**: 라이브/사진 화면의 「📤 결과 공유」, 추천 결과 화면의 「📤 결과 공유」 버튼으로 H.O.W 결과 카드(퍼스널컬러·얼굴형·최종 선택·추천 TOP 3·전/후·날짜)를 이미지 1장으로 만들어 안드로이드 공유창(카카오톡 등)으로 보냅니다. 공유를 지원하지 않으면 이미지가 갤러리/다운로드에 저장됩니다. 이미지는 한 번만 그리고 바로 메모리에서 해제합니다.
- **자동 처음으로**: 설정한 시간 동안 터치가 없으면 10초 카운트다운(「곧 처음으로 돌아갑니다 · 계속하기」) 후 「다음 고객」과 똑같이 초기화합니다(사진 삭제, 카메라 끔). 공유창이 열려 있거나 분석 중일 때는 작동하지 않습니다.
- **숨은 설정**: H.O.W 로고(첫 화면·상단·추천 화면)를 **2초간 길게 누르면** 「상담 설정」이 열립니다. 자동 처음으로(끄기/1/3/5/10분, 기본 3분), 기본 성별(자동/여성/남성)을 고를 수 있고 이 기기에 저장됩니다.

## 장시간 사용 (v21)
- 브라우저 메모리(WASM 모델 힙·디코더 캐시)가 고객당 약 40 MB씩 늘어 페이지를 새로 열어야만 회수됨 → 「다음 고객」을 누를 때 가벼운 모드는 6명(초경량 4명, 일반 12명)마다 표지에서 페이지를 새로 엽니다(모델은 SW 캐시). `?norecycle`로 끌 수 있음.

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
