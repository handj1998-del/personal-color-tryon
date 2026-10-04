#!/bin/sh
# usage: tools/bump-version.sh v18 [2026.10.05]  -> writes version.js (the source) and version.json (derived, polled by the app)
set -e; cd "$(dirname "$0")/.."; V="$1"; D="${2:-$(date +%Y.%m.%d)}"; [ -n "$V" ] || { echo "usage: $0 vN [YYYY.MM.DD]"; exit 1; }
sed -i "s/self.APP_VERSION = '[^']*'; self.APP_DATE = '[^']*';/self.APP_VERSION = '$V'; self.APP_DATE = '$D';/" version.js
printf '{"version":"%s","date":"%s"}\n' "$V" "$D" > version.json; grep APP_VERSION version.js; cat version.json
