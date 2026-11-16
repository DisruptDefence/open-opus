#!/usr/bin/env bash
# Downloads the scrcpy server the gateway uses for screen capture and input, and checks it is the file expected.
# scrcpy is by Genymobile, Apache-2.0: https://github.com/Genymobile/scrcpy . It is fetched, not kept in this
# repository; vendor/ is ignored by git.
set -euo pipefail
VERSION=3.3.3   # keep in step with SCRCPY_VERSION in gateway.py
SHA256=7e70323ba7f259649dd4acce97ac4fefbae8102b2c6d91e2e7be613fd5354be0
DIR="$(cd "$(dirname "$0")" && pwd)/vendor"
JAR="$DIR/scrcpy-server.jar"
check() { echo "$SHA256  $JAR" | sha256sum -c --quiet - 2>/dev/null; }
if [ -f "$JAR" ] && check; then exit 0; fi
mkdir -p "$DIR"
echo "fetching scrcpy-server $VERSION (Genymobile, Apache-2.0)"
curl -fsSL -o "$JAR.part" "https://github.com/Genymobile/scrcpy/releases/download/v$VERSION/scrcpy-server-v$VERSION"
mv "$JAR.part" "$JAR"
curl -fsSL -o "$DIR/scrcpy.LICENSE" "https://raw.githubusercontent.com/Genymobile/scrcpy/v$VERSION/LICENSE" || true
check || { echo "scrcpy-server: the downloaded file is not the one expected (sha256 differs); removed" >&2; rm -f "$JAR"; exit 1; }
