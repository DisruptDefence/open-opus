#!/usr/bin/env bash
# The virtual phone that runs a real ATAK: create it, start it, stop it. Local development only.
#   ./phone.sh create | start | stop | status
# Needs the Android SDK (ANDROID_SDK_ROOT, default ~/Android/Sdk) with `emulator`, `cmdline-tools` and the system
# image below, /dev/kvm, adb, and Docker: the emulator runs in a small container (Dockerfile beside this file) so
# that its libraries need not be installed on the machine. The SDK and the virtual device stay on the machine.
set -euo pipefail
SDK="${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}"
AVD=opus-phone
IMAGE="system-images;android-${OPUS_ANDROID_API:-34};google_apis;x86_64"   # must be an x86 image that translates ARM64 apps
NAME=opus-phone
SERIAL=emulator-5564
case "${1:-status}" in
  create)
    AM="$(ls -d "$SDK"/cmdline-tools/*/bin | head -1)/avdmanager"
    echo no | "$AM" create avd --force -n "$AVD" -k "$IMAGE" -d pixel_5 >/dev/null
    CFG="$HOME/.android/avd/$AVD.avd/config.ini"
    # A rugged handset of 1080 x 2408 at density 2.625; half of that in pixels and density draws the same layout
    # at a quarter of the rendering cost.
    sed -i -e 's/^hw.lcd.width=.*/hw.lcd.width=540/' -e 's/^hw.lcd.height=.*/hw.lcd.height=1204/' \
           -e 's/^hw.lcd.density=.*/hw.lcd.density=213/' -e 's/^hw.ramSize=.*/hw.ramSize=3072/' \
           -e 's/^hw.keyboard=.*/hw.keyboard=yes/' "$CFG"
    grep -q '^hw.cpu.ncore' "$CFG" && sed -i 's/^hw.cpu.ncore=.*/hw.cpu.ncore=4/' "$CFG" || echo 'hw.cpu.ncore=4' >> "$CFG"
    echo "created $AVD" ;;
  start)
    docker build -q -t opus-emulator "$(dirname "$0")" >/dev/null
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    rm -rf "$HOME/.android/avd/$AVD.avd"/*.lock   # a killed emulator leaves its locks behind and the next one refuses to start
    # The emulator's console (port 5564) is how UDP reaches the phone. An empty token file turns its login off;
    # the console only listens on this machine.
    EMU_HOME="$HOME/.android/opus-home"; mkdir -p "$EMU_HOME"; : > "$EMU_HOME/.emulator_console_auth_token"
    docker run -d --name "$NAME" --network host --device /dev/kvm \
      --user "$(id -u):$(id -g)" --group-add "$(stat -c %g /dev/kvm)" \
      -e HOME="$EMU_HOME" -e ANDROID_SDK_ROOT=/sdk -e ANDROID_AVD_HOME="$HOME/.android/avd" \
      -v "$SDK":/sdk -v "$HOME/.android":"$HOME/.android" \
      opus-emulator -avd "$AVD" -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect \
      -accel on -ports 5564,5565 >/dev/null
    echo "starting; the adb device is $SERIAL"
    for _ in $(seq 1 90); do
      [ "$(adb -s $SERIAL shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break; sleep 2
    done
    # ATAK listens for GPS sentences on UDP 4349 (its "network GPS"); pass that port through to the phone.
    python3 - <<'PY'
import socket
s = socket.create_connection(("127.0.0.1", 5564), timeout=5)
s.recv(4096)
s.sendall(b"redir add udp:4349:4349\nquit\n")
print("console:", s.recv(4096).decode(errors="replace").strip().splitlines()[-1])
PY
    echo "booted" ;;
  stop) docker rm -f "$NAME" >/dev/null 2>&1 && echo stopped || echo "not running" ;;
  status) docker ps --filter "name=$NAME" --format '{{.Status}}'; adb -s $SERIAL shell getprop sys.boot_completed 2>/dev/null || true ;;
esac
