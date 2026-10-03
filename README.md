# 퍼스널컬러 가상 피팅 (안경테 · 헤어 컬러 · 헤어스타일)

Static, 100% client-side web app (index.html / style.css / app.js / frames.js / hairstyle.js). Camera frames and photos are processed on the device and never uploaded.

- MediaPipe Tasks Vision 1.0.1 (jsDelivr CDN): FaceLandmarker (478 pts) + ImageSegmenter (hair_segmenter)
- Live mode (default when a camera exists): landmarks every frame (One-Euro smoothing), hair mask every 2–4 frames, GPU delegate with auto-switch to CPU when the GPU path is slow
- Glasses: 20 procedural frame shapes × 30 colors/materials (metal, acetate, tortoise, clear, matte, two-tone gradient)
- Hairstyles: 13 procedural templates (8 women + 5 men) + bangs options, anchored with a least-squares affine to face landmarks; original hair is inpainted (push-pull fill), the face oval/neck occlude the new hair, and the chosen color tints the template
- URL flags: `?photo`, `?sample`, `?cpu`, `?res=640`
