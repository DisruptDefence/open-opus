#!/usr/bin/env bash
# One command for the local phone: an Android device with a real ATAK, and the gateway a game page connects to.
#
#   phone/local/run.sh                    the virtual phone (android/phone.sh): starts it, starts ATAK, runs the gateway
#   phone/local/run.sh --device SERIAL    a real phone or tablet on USB instead (see `adb devices`); NOT YET PROVEN
#   phone/local/run.sh --apk FILE         install this ATAK APK first when the device has none (default: .atak/*.apk
#                                         at the repository root; the unmodified APK is a download on the
#                                         atak-5.8.0-civ release of the repository, or your own copy from tak.gov)
#   any other option goes to gateway.py:  --codec av1   --port 9741   --allow-origin https://…   --gps HOST:PORT
#
# Stop the gateway with Ctrl-C. The virtual phone keeps running: phone/local/android/phone.sh stop
# What this needs is in phone/README.md.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
PKG=com.atakmap.app.civ
SERIAL=emulator-5564; DEVICE=""; APK=""; REST=()
while [ $# -gt 0 ]; do case "$1" in
  --device) DEVICE="$2"; SERIAL="$2"; shift 2 ;;
  --apk) APK="$2"; shift 2 ;;
  -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) REST+=("$1"); shift ;;
esac; done
say() { echo "[phone] $*"; }
trap 'echo "[phone] stopped: the command at line $LINENO of run.sh failed" >&2' ERR
command -v adb >/dev/null || { echo "adb is not installed (Android platform-tools)" >&2; exit 1; }
python3 -c 'import websockets, sys; sys.exit(0 if int(websockets.__version__.split(".")[0]) >= 15 else 1)' 2>/dev/null \
  || { echo "the gateway needs the Python package websockets, 15 or newer:  python3 -m pip install 'websockets>=15'" >&2; exit 1; }
"$HERE/fetch-scrcpy-server.sh"

GATEWAY_HOST=10.0.2.2; GPS=()
if [ -n "$DEVICE" ]; then
  adb -s "$SERIAL" get-state >/dev/null 2>&1 || { echo "no adb device $SERIAL (see: adb devices; USB debugging must be allowed on the device)" >&2; exit 1; }
  adb -s "$SERIAL" reverse tcp:8087 tcp:8087 >/dev/null   # the device reaches the gateway's TAK port through the cable
  GATEWAY_HOST=127.0.0.1
  # UDP does not travel over adb. The position reaches ATAK's network GPS only over a network the device shares
  # with this machine: pass --gps <device address>:4349. Without it the device keeps its own GPS.
  case " ${REST[*]:-} " in *" --gps "*) ;; *) GPS=(--gps none); say "no --gps given: the player's position is NOT fed to this device" ;; esac
elif [ "$(adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]; then
  [ -d "$HOME/.android/avd/opus-phone.avd" ] || { say "creating the virtual phone"; "$HERE/android/phone.sh" create; }
  say "starting the virtual phone (about a minute)"; "$HERE/android/phone.sh" start
fi

# A device that has just booted answers adb before its package manager and its storage are there: wait for both.
for _ in $(seq 1 60); do
  PACKAGES="$(adb -s "$SERIAL" shell pm list packages 2>/dev/null | tr -d '\r' || true)"
  [ -n "$PACKAGES" ] && adb -s "$SERIAL" shell ls /sdcard/Android >/dev/null 2>&1 && break; sleep 2
done
if ! grep -qx "package:$PKG" <<<"$PACKAGES"; then
  [ -n "$APK" ] || APK="$(ls "$REPO"/.atak/*.apk 2>/dev/null | grep -vi plugin | head -1 || true)"
  [ -n "$APK" ] && [ -f "$APK" ] || { echo "ATAK is not installed on $SERIAL. Put the ATAK-CIV APK in $REPO/.atak/ (a download on the atak-5.8.0-civ release of the repository, or your own copy from tak.gov), or pass --apk FILE." >&2; exit 1; }
  say "installing $(basename "$APK")"; adb -s "$SERIAL" install -r "$APK" >/dev/null
fi

# ATAK's TAK server is the gateway: what the trainee shares arrives there as Cursor-on-Target.
TMP="$(mktemp)"; sed "s/__GATEWAY__/$GATEWAY_HOST/" "$HERE/android/opus.pref" > "$TMP"
adb -s "$SERIAL" shell mkdir -p /sdcard/atak/config/prefs /sdcard/atak/grg >/dev/null 2>&1 || true
# a device that has just booted refuses writes to its storage for a few seconds
for i in $(seq 1 20); do
  adb -s "$SERIAL" push "$TMP" /sdcard/atak/config/prefs/defaults >/dev/null 2>&1 && break
  [ "$i" -lt 20 ] || { rm -f "$TMP"; echo "could not write ATAK's preference file on $SERIAL (/sdcard/atak/config/prefs/defaults)" >&2; exit 1; }
  sleep 2
done; rm -f "$TMP"
if [ -z "$(adb -s "$SERIAL" shell pidof "$PKG" 2>/dev/null | tr -d '\r' || true)" ]; then
  say "starting ATAK"; adb -s "$SERIAL" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
fi
say "gateway on ws://127.0.0.1:9741 — open the game page and press T. First run: accept ATAK's own dialogs on the phone."
cd "$HERE" && exec python3 gateway.py --serial "$SERIAL" "${GPS[@]}" "${REST[@]}"
