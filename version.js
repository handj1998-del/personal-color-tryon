// Single source of truth for the app version. Read by the page (cover/footer label, update check) and by sw.js (cache name).
// Bump with: tools/bump-version.sh v18   (rewrites this file + version.json, which the update check fetches with no-store)
self.APP_VERSION = 'v42'; self.APP_DATE = '2026.10.05';
