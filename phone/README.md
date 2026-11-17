# The phone

In Open OPUS the trainee works a TAK client on a phone inside the game. This folder is that phone, outside the
engine: it reaches the game through the world API (`docs/WORLD-API.md`) and nothing else.

| File | What |
|---|---|
| `core.js`, `host.js`, `phone.css` | The phone host. **T** (or Tab) holds the game with `world.hold()` and raises the phone; Esc or Tab lowers it and calls `world.release()`. It feeds the screen the player's true position and relays what the screen reports |
| `placeholder-screen.js` | The default screen: an empty phone that says "No phone connected", shows the player's grid reference, position and true heading, and how to connect a real ATAK. Needs nothing |
| `stream-screen.js` | A real ATAK, running on an Android device on your own machine, shown live |
| `either-screen.js` | Shows the real ATAK while the local gateway answers, the placeholder otherwise |
| `reports.js` | How a mission host hears the phone |
| `demo.html` | A page with all of it: Old Quebec, the engine's mission host, the phone |
| `local/` | The local phone: `run.sh`, `gateway.py`, the virtual phone scripts |

There is no imitation of ATAK in this repository and there will not be one: the phone shows a real ATAK or the
placeholder.

**The case.** The phone is drawn as a generic rugged handset in a dark-earth protective case, in CSS only (`phone.css`, plus sixteen
decorative `aria-hidden` elements that `host.js` adds): a chamfered, bevelled bumper with a stippled convex face, raised corner guards with
counterbored screws, one black gasket and the phone's own bezel, rubber side keys, a ribbed cable overmould with a curved cable, a lanyard
lug with webbing and a mount hinge. Everything scales with `--w`; the glass keeps its size and place. There is no `filter`, `backdrop-filter`
or `mask` on `.opus-phone` or the glass (a live stream repaints under them); the one blur is the cast shadow, on a static element behind the
phone. Pictures with no game: `flock /tmp/opus-heavy.lock env PLAYWRIGHT=… [BACKDROP=<png>] node phone/tools/case-shot.mjs <outDir> [prefix] [cssFile]`
(`BACKDROP` draws a still image behind the phone instead of the grey gradient; the tool also prints the glass's bounding box, compares it with
a `before` run and lists any filter or mask in the phone's subtree).

## Try it (nothing to set up)

```sh
python3 -m http.server 9771 --bind 127.0.0.1        # in the repository root
```

Open `http://127.0.0.1:9771/phone/demo.html`, press Deploy, walk (WASD), press **T**. The game pauses, the view
tilts down and the phone comes up with the placeholder. The switch above the phone chooses between pause and slow
motion. T, Tab or Esc puts it away and play goes on.

Tests: `node --test "phone/test/*.test.js"` (the host and screens on the engine's real simulation, no browser) and
`python3 -m unittest phone/local/test_gateway.py`. A headless check of the page: `phone/tools/check-phone.mjs`.

## A real ATAK on the phone

```sh
phone/local/run.sh            # the virtual phone + ATAK + the gateway on ws://127.0.0.1:9741
```

Leave it running, open (or keep open) the demo page and press T: the page finds the gateway by itself, within three
seconds, and the phone shows the device's ATAK, live. Stop the gateway and the placeholder is back.

What `run.sh` does, in order: checks `adb` and the Python package `websockets`; downloads the scrcpy server
(below); starts the virtual phone if it is not running (and creates it the first time); installs ATAK if the device
has none, from `--apk FILE` or `.atak/*.apk` in the repository root; tells ATAK that its TAK server is the gateway;
starts ATAK; runs the gateway. The first time, accept ATAK's own dialogs (licence, permissions) on the phone itself.

**The APK.** ATAK is not in this repository. Use your own copy of ATAK-CIV from tak.gov, or the unmodified
ATAK-CIV 5.8.0 APK attached to this repository's `atak-5.8.0-civ` release (`ATAK-5.8.0.10-…-civSmall-release.apk`;
the plugin APKs beside it are optional and installed by hand with `adb install`). Put it in `.atak/` (ignored by git).
Never commit an APK, and never take one apart (`AGENTS.md` rule 6).

### What it needs

Measured on one x86-64 Linux machine (WSL2), the only set-up that is proven:

| | |
|---|---|
| Android emulator binaries (SDK package `emulator`) | 0.9 GB on disk |
| System image `system-images;android-34;google_apis;x86_64` (Android 14) | 4.2 GB on disk |
| The virtual device after ATAK is installed | 2.6 GB on disk |
| Memory for the guest | 3 GB |
| Start | about 75 seconds |
| Hardware virtualisation | `/dev/kvm` |
| Docker | the emulator runs in a small container (338 MB image, `local/android/Dockerfile`); the SDK and the device stay on the machine |
| Also | `adb`, Python 3 with `websockets` 15 or newer, `curl` |

Install the SDK parts once: `sdkmanager --install emulator "system-images;android-34;google_apis;x86_64"`
(`ANDROID_SDK_ROOT`, default `~/Android/Sdk`).

**Which Android.** ATAK's APK is ARM64 only, so an x86 image must translate ARM code. Android 11 (API 30) starts
ATAK and then loses its map engine; Android 13 (API 33, google_apis) will not install it; **Android 14 (API 34)
works**. `OPUS_ANDROID_API` selects another image for `local/android/phone.sh create`.

| Machine | State |
|---|---|
| Linux x86-64 with KVM | **Proven** (as above) |
| Windows | **Proven through WSL2** with nested virtualisation (`/dev/kvm` inside WSL) and Docker. Run everything inside WSL; the browser on Windows reaches `127.0.0.1` in WSL through WSL's localhost forwarding. The Windows-native emulator is not tried |
| macOS, Intel | Not tried. The emulator there uses Hypervisor.framework, not KVM, and `phone.sh` as written (Docker, `/dev/kvm`) does not apply: start the same AVD with the SDK's own `emulator -ports 5564,5565`, add the UDP redirection `phone.sh` adds, then `run.sh` |
| macOS, Apple Silicon | Not tried. An arm64 system image (`…;google_apis;arm64-v8a`) would run ATAK natively, with no translation; expected to be the lightest of all, and unproven. Same remark about `phone.sh` |
| A real phone or tablet | Designed, not proven: see below |

### How the page finds the gateway

The stream screen opens `ws://127.0.0.1:9741` (`demo.html?gateway=ws://…` for another address) and tries again
every three seconds. Nothing is configured in the page.

- The gateway listens on 127.0.0.1 only and answers only pages whose origin is this machine
  (`http://127.0.0.1:*`, `http://localhost:*`). Whoever connects sees and touches the device, so another origin is
  let in only by name: `run.sh --allow-origin https://example.org`.
- **Proven:** a page served from `http://127.0.0.1` (the headless Chromium used for this repository's checks, and
  desktop Chrome). Loopback to loopback is not a cross-network request and needs no permission.
- **Not proven here, and expected to need the user's consent:** a page served from a public `https://` address.
  Browsers do exempt loopback from mixed-content blocking, so `ws://127.0.0.1` is not refused for being plain; but
  Chrome's Local Network Access asks the user for the loopback-network permission before a public page may connect
  to this machine (reported to cover WebSockets since Chrome 147, April 2026), and Safari has refused such
  connections in the past. A page opened from a file has the origin `null`, which the gateway refuses unless
  started with `--allow-origin null`.
- **Video.** H.264 by default (Chrome, Edge, Safari). A Chromium built without H.264 (the one Playwright ships)
  needs `run.sh --codec av1`. The browser needs WebCodecs.

### What flows

```
page  <── video (WebSocket) ───────────────  gateway.py  <── scrcpy server over adb ──  Android + ATAK
      ── taps, keys ───────────────────────►             ──► touch and key events
      ── position, twice a second ─────────►             ──► GPS sentences (UDP 4349, ATAK's network GPS)
      ── overhead picture of the scene ────►             ──► a KMZ in /sdcard/atak/grg
      <── what ATAK shared (Cursor-on-Target) ──         <── ATAK as a TAK client (TCP 8087)
```

- **Position.** The player's true latitude, longitude, height and true heading (`world.geo`) become GGA and RMC
  sentences. ATAK takes them with its default setting "External or Network GPS". The gateway repeats the last
  position while it runs, so ATAK does not fall back to the device's own GPS.
- **The scene on ATAK's map.** When the phone is first raised the page sends the world API's overhead picture of
  the ground round the player; the gateway writes it as a ground overlay (grid-north picture, rotated by the
  scene's convergence) into ATAK's `grg` folder. ATAK reads that folder when it starts: the overlay shows after
  ATAK is next restarted.
- **Keys.** While a real ATAK is up, every key but Esc and Tab goes to the device, T included. The Back button
  above the phone is Android's Back.

## Scoring from what ATAK shares

ATAK is told that its TAK server is the gateway, so everything the trainee **sends** (a marker's radial menu,
Send, Broadcast) arrives there as Cursor-on-Target and is passed to the page. A marker that is dropped and never
sent stays private to ATAK and cannot be seen. The device's own position reports arrive the same way.

In the page each event is the phone report `cot`: `{ uid, type, how, callsign, lat, lon, x, z, mgrs, self }`
(`x`, `z` in game metres through `world.geo.toGame`; `self` is true for the device's own position). A mission host
hears it as the event `phone`:

```js
const heard = withPhoneReports(world, phone, scenario.places);   // reports.js
runMission(heard, scenario);                                      // engine/host/mission.js, unchanged
```

`places` is the host's own list, `[{ id, x, z, radius }]`; the report is passed on with `near` set to the id of
each place it lies within, and `affiliation` read from the type. So a development scenario can say
(`scenarios/old-quebec-atak.json`):

```json
{ "when": { "event": "phone", "action": "cot", "affiliation": "hostile", "near": "place-darmes" },
  "do": [ { "op": "end", "result": "complete" } ] }
```

The places are never sent to the engine or to the screen. This scoring runs in the page and rests on the page's
word; it is a development stand-in. A hardened session host receives ATAK's Cursor-on-Target on its own endpoint
and judges it there (`docs/SESSION-PROTOCOL.md` 4, rule 5).

## A real phone or tablet instead of the emulator (designed, not proven)

The gateway needs only `adb` and the scrcpy server, so a device on USB with ATAK installed and USB debugging
allowed should work with no emulator: `phone/local/run.sh --device <serial from adb devices>`. No device has been
attached to this work; nothing in this section has been run.

| | Emulator | USB device |
|---|---|---|
| Picture, taps, keys | scrcpy server over adb | The same |
| What ATAK shares (CoT) | ATAK connects to `10.0.2.2:8087` | `adb reverse tcp:8087 tcp:8087`, and ATAK connects to `127.0.0.1:8087`. `run.sh` does both |
| Position | UDP 4349, redirected into the guest through the emulator console | **Open.** adb forwards TCP only, so the sentences cannot go down the cable. Either the device shares a network with the machine (`--gps <device address>:4349`; the gateway then sends over Wi-Fi), or the gateway sets a mock location through adb (`cmd location providers add-test-provider gps`, then `set-test-provider-location`, Android 12 and later), which is not written. Without either, `run.sh` feeds no position and the device shows where it really is |
| Map overlay | `adb push` to `/sdcard/atak/grg` | The same; newer Android versions may restrict that folder |
| Risk | none to anything real | The device's ATAK gets a TAK server entry named OPUS and its preference file `/sdcard/atak/config/prefs/defaults` is replaced. Use a device kept for this |

## Not done

- ATAK's first-run dialogs are accepted by hand, and the overlay needs an ATAK restart.
- The picture is the device's whole screen, status bar and gesture bar included; `--crop` leaves parts out.
- ATAK's heading comes from the device's own compass, not from the game: the grid reference follows the player,
  the heading shown in ATAK does not.
- The map overlay has been seen to arrive in ATAK's folder; that ATAK draws it in the right place, rotation
  included, has not been looked at.
- One page at a time is the intended use; several pages would all touch the same device.
