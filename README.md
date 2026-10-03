# 퍼스널컬러 가상 피팅 (안경테 + 헤어 컬러)

Pure client-side web app (index.html / style.css / app.js). Camera frames and photos are processed on the device only; nothing gets uploaded.

- MediaPipe Tasks Vision 1.0.1 (jsDelivr CDN): FaceLandmarker (478 pts, VIDEO/IMAGE) + ImageSegmenter (hair_segmenter.tflite)
- Live mode (default when a camera is available): rAF loop, landmarks every frame (One-Euro smoothed), hair mask every 2–4 frames at 256px with temporal EMA, GPU delegate with automatic CPU fallback/auto-switch when GPU is slow
- Photo mode: upload a photo or use `?sample`; capture freezes the live frame and re-analyzes it at full resolution
- URL flags: `?photo` (start in photo mode), `?sample` (load sample photo), `?cpu` (force CPU delegate), `?res=640` (live processing resolution, default 800)

Run: `python3 -m http.server 8830 --directory /workspace/pc-tryon` (camera needs HTTPS or localhost).
Tests: test/test_photo.py, test/test_combos.py, test/test_live.py (fake camera from test/live.y4m).
