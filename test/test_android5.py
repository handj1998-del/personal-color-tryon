# Constrained Android emulation: 5 customers in a row (home -> cover -> capture -> results -> live), memory per round
import sys, time, os, subprocess, json
from playwright.sync_api import sync_playwright
UA = 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'
OUT = os.environ.get('OUT', '/workspace/pc-tryon/screens/v6'); os.makedirs(OUT, exist_ok=True)
def rss(kind):
    out = subprocess.run(f"ps -eo rss,args | grep -E 'chrom.*--type={kind}' | grep -v grep", shell=True, capture_output=True, text=True).stdout
    return max([int(l.split()[0]) for l in out.splitlines()] or [0]) // 1024
N = int(os.environ.get('N', 5))
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
        '--use-file-for-fake-video-capture=/workspace/pc-tryon/test/live.y4m','--enable-unsafe-swiftshader','--ignore-gpu-blocklist',
        '--js-flags=--max-old-space-size=256','--force-gpu-mem-available-mb=64','--enable-precise-memory-info','--renderer-process-limit=1'])
    ctx = b.new_context(viewport={'width':412,'height':915}, device_scale_factor=2.625, is_mobile=True, has_touch=True, user_agent=UA, permissions=['camera'])
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type in ('error','warning') else None)
    pg.on('crash', lambda: errs.append('PAGE CRASH'))
    pg.goto(os.environ.get('BASE', 'http://127.0.0.1:8830/') + '?source=pwa&nosw'); pg.wait_for_selector('#cover'); time.sleep(2)
    rows = []
    for n in range(N):
        if n: pg.tap('#btnHome'); time.sleep(1.2)
        pg.tap('#cover'); pg.wait_for_selector('#rcCap:not([hidden])', timeout=180000)
        pg.wait_for_function('document.getElementById("rcShot").disabled===false && document.querySelector("video").videoWidth>0', timeout=60000); time.sleep(1.5)
        t0 = time.time(); pg.tap('#rcShot')
        busy = pg.evaluate('new Promise(r=>setTimeout(()=>r([document.querySelector("#rcBusy p").textContent, !!document.querySelector("video").srcObject]),120))')
        pg.wait_for_selector('#rcRes:not([hidden])', timeout=180000); ta = time.time() - t0; time.sleep(2.5)
        info = pg.evaluate('({raw:[__pc.rawC.width,__pc.rawC.height], renders:__pc.rcRenders, rel:__pc.rcCamReleased, thumbs:document.querySelectorAll("#rcThumbs canvas").length, main:[rcMain.width,rcMain.height], heap:Math.round(performance.memory.usedJSHeapSize/1048576)})')
        if n == 0: pg.screenshot(path=f'{OUT}/android_lite_result.png')
        pg.tap('#rcGo'); time.sleep(6)
        live = pg.evaluate('({fps:__pc.stats.lastFps.slice(-3), cam:!!document.querySelector("video").srcObject, heap:Math.round(performance.memory.usedJSHeapSize/1048576)})')
        if n == 0: pg.screenshot(path=f'{OUT}/android_lite_live.png')
        r = dict(round=n+1, analysis_s=round(ta,1), busy_text_during=busy, **info, live=live, renderer_mb=rss('renderer'), gpu_mb=rss('gpu-process'))
        rows.append(r); print(json.dumps(r, ensure_ascii=False), flush=True)
    print('errors', [e for e in errs if 'GPU stall' not in e][:15])
    b.close()
