# Asset credits & licenses

## assets/glasses/ — photoreal eyeglass layers
- Made for this app: each frame shape is modelled in 3D (Blender 4.2, Cycles path tracing) from the app's own lens outlines and
  rendered as a front-view product shot (orthographic, transparent background) in separate layers
  (acetate shading/specular, metal luminance, lens reflections). Colours/materials are applied in the browser by gradient-mapping
  / tinting these layers, so the highlights and reflections of the render are preserved.
- Lighting: "Studio Small 09" HDRI by Poly Haven (https://polyhaven.com/a/studio_small_09) — **CC0** (public domain).
- No third-party product photos are used.

## assets/hair/ — photoreal hairstyle overlays
- Source portraits were **AI-generated locally** for this app (no real people; no photos scraped):
  - Realistic Vision V5.1 (SG161222/Realistic_Vision_V5.1_noVAE) — CreativeML OpenRAIL-M license
  - stabilityai/sd-vae-ft-mse VAE — MIT license
  - latent-consistency/lcm-lora-sdv1-5 — OpenRAIL++ license
- The hair was cut out with MediaPipe hair segmentation + closed-form alpha matting (pymatting, MIT),
  converted to luminance (so any hair colour can be applied) and aligned to a canonical face space using MediaPipe face landmarks.
  The OpenRAIL-M use restrictions apply to these derived images.

## vendor/mediapipe/
- Google MediaPipe Tasks Vision 1.0.1 runtime, face_landmarker.task and hair_segmenter.tflite — Apache License 2.0.

## assets/sample.jpg
- Unchanged from earlier versions of the app.
