#!/usr/bin/env python3
"""The one small service between a game page in the browser and the Android device that runs a real ATAK.

    page  <-- WebSocket: video frames, Cursor-on-Target -->  gateway  <-- scrcpy server over adb -->  Android + ATAK
    page  --- WebSocket: taps, keys, position, map overlay ->  gateway  --> touch events, NMEA over UDP, a KMZ file

    python3 gateway.py [--serial emulator-5564] [--port 9741] [--codec h264|av1]

It listens on 127.0.0.1 only, and answers only pages whose origin is this machine (http://127.0.0.1:*,
http://localhost:*) or one named with --allow-origin: whoever connects can see and touch the device.

To the page:
  {"type": "video", "codec", "width", "height"}   whenever the picture size changes; then binary messages whose first
                                                  byte is 0 (codec configuration), 1 (key frame) or 2 (frame); the
                                                  rest is H.264 in Annex B form, or AV1
  {"type": "cot", "uid", "cot", "how", "lat", "lon", "callsign"}   each Cursor-on-Target event ATAK shares
  {"type": "overlay", "name", "state": "present" | "pushed" | "failed"}
From the page (JSON):
  {"t": "touch", "a": "down|move|up", "x": 0..1, "y": 0..1, "w", "h"}   w, h: the size of the picture touched
  {"t": "key", "code": <Android key code>}   {"t": "text", "s": "..."}   {"t": "back"}
  {"t": "pos", "lat", "lon", "hdg", "spd", "alt"}   the player: becomes the device's GPS (ATAK's network GPS)
  {"t": "overlay", "name", "title", "jpeg": <base64>, "north", "south", "east", "west", "rotation"}
                                                  a picture of the ground: becomes a KMZ in ATAK's grg folder

Screen capture and input are done by the scrcpy server (Genymobile, Apache-2.0), which fetch-scrcpy-server.sh
downloads into vendor/; it is not part of this repository. Needs the `websockets` package (15 or newer) and adb.
"""
import argparse
import asyncio
import base64
import io
import json
import random
import re
import socket
import struct
import subprocess
import time
import zipfile
from pathlib import Path
from xml.etree import ElementTree
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent
JAR = HERE / "vendor/scrcpy-server.jar"
SCRCPY_VERSION = "3.3.3"  # the server refuses a client that names another version; keep in step with fetch-scrcpy-server.sh
PKT_CONFIG = 1 << 63
PKT_KEY = 1 << 62
GRG_DIR = "/sdcard/atak/grg"
LOCAL_ORIGIN = re.compile(r"https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?")


def adb(serial, *args, check=True):
    return subprocess.run(["adb", "-s", serial, *args], capture_output=True, text=True, check=check).stdout


class Phone:
    """One Android device: its screen as a stream of video packets, and a way to touch it."""

    def __init__(self, serial, max_size, fps, bitrate, codec="h264", crop=""):
        self.serial, self.max_size, self.fps, self.bitrate, self.codec = serial, max_size, fps, bitrate, codec
        self.crop = crop
        self.clients = set()
        self.config = None  # last codec configuration packet (SPS/PPS)
        self.size = (0, 0)
        self.control = None
        self.server = None

    async def start(self):
        if not JAR.is_file():
            raise SystemExit(f"{JAR} is missing: run {HERE / 'fetch-scrcpy-server.sh'} (or run.sh, which does)")
        scid = f"{random.randrange(1, 1 << 31):08x}"
        port = 27000 + random.randrange(0, 900)
        adb(self.serial, "push", str(JAR), "/data/local/tmp/scrcpy-server.jar")
        adb(self.serial, "forward", f"tcp:{port}", f"localabstract:scrcpy_{scid}")
        self.server = await asyncio.create_subprocess_exec(
            "adb", "-s", self.serial, "shell",
            f"CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / com.genymobile.scrcpy.Server {SCRCPY_VERSION} "
            f"scid={scid} log_level=info tunnel_forward=true audio=false control=true video_codec={self.codec} "
            f"max_size={self.max_size} max_fps={self.fps} video_bit_rate={self.bitrate} "
            "video_codec_options=i-frame-interval:int=2 send_device_meta=false send_frame_meta=true "
            "send_dummy_byte=true send_codec_meta=true cleanup=false power_on=true stay_awake=true"
            + (f" crop={self.crop}" if self.crop else ""),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        # The first connection is the video socket, the second the control socket. The server needs a moment.
        for _ in range(40):
            await asyncio.sleep(0.25)
            try:
                video_r, video_w = await asyncio.open_connection("127.0.0.1", port)
                if await asyncio.wait_for(video_r.readexactly(1), 2) == b"\x00":
                    break
                video_w.close()
            except (OSError, asyncio.IncompleteReadError, asyncio.TimeoutError):
                continue
        else:
            raise RuntimeError("the scrcpy server did not come up on the device")
        control_r, self.control = await asyncio.open_connection("127.0.0.1", port)
        # Keep every stream and task referenced: asyncio closes a connection whose writer is garbage collected.
        self._keep = [video_r, video_w, control_r, asyncio.create_task(self._pump(video_r)), asyncio.create_task(self._log())]

    async def _log(self):
        while line := await self.server.stdout.readline():
            print("[device]", line.decode(errors="replace").rstrip(), flush=True)

    async def _pump(self, reader):
        _codec, width, height = struct.unpack(">III", await reader.readexactly(12))
        self._set_size(width, height)
        while True:
            pts_flags, size = struct.unpack(">QI", await reader.readexactly(12))
            data = await reader.readexactly(size)
            if pts_flags & PKT_CONFIG:
                self.config = data
                kind = 0
            else:
                kind = 1 if pts_flags & PKT_KEY else 2
            self.broadcast(bytes([kind]) + data)

    def _set_size(self, width, height):
        if (width, height) != self.size:
            self.size = (width, height)
            self.broadcast(json.dumps({"type": "video", "codec": self.codec, "width": width, "height": height}))

    def broadcast(self, message):
        for ws in list(self.clients):
            asyncio.create_task(self._send(ws, message))

    async def _send(self, ws, message):
        try:
            await ws.send(message)
        except Exception:  # a page that went away
            self.clients.discard(ws)

    # ---- input (scrcpy control messages) -------------------------------------------------------------------
    def touch(self, action, x, y, size=None):
        # The device drops a touch whose stated screen size is not the current one, and the size changes when
        # the phone rotates. The page knows the size of the picture it is showing, so it says which.
        w, h = size or self.size
        code = {"down": 0, "up": 1, "move": 2}[action]
        px, py = int(max(0, min(1, x)) * w), int(max(0, min(1, y)) * h)
        pressure = 0 if action == "up" else 0xFFFF
        self.control.write(struct.pack(">BBqiiHHHII", 2, code, -2, px, py, w, h, pressure, 1, 0 if action == "up" else 1))

    def key(self, keycode):
        for action in (0, 1):
            self.control.write(struct.pack(">BBIII", 0, action, keycode, 0, 0))

    def text(self, s):
        raw = s.encode()[:300]
        self.control.write(struct.pack(">BI", 1, len(raw)) + raw)

    def reset_video(self):
        self.control.write(bytes([17]))  # ask the encoder for a fresh key frame


def nmea(lat, lon, hdg, spd_ms, alt, t=None):
    """GGA and RMC sentences for ATAK's network GPS input."""
    t = t or time.gmtime()

    def dm(v, pos, neg, width):
        hemi = pos if v >= 0 else neg
        v = abs(v)
        return f"{int(v):0{width}d}{(v - int(v)) * 60:07.4f},{hemi}"

    def frame(body):
        cs = 0
        for ch in body:
            cs ^= ord(ch)
        return f"${body}*{cs:02X}\r\n"

    hms = time.strftime("%H%M%S", t) + ".00"
    la, lo = dm(lat, "N", "S", 2), dm(lon, "E", "W", 3)
    gga = f"GPGGA,{hms},{la},{lo},1,10,0.8,{alt:.1f},M,0.0,M,,"
    rmc = f"GPRMC,{hms},A,{la},{lo},{spd_ms * 1.94384:.1f},{hdg % 360:.1f},{time.strftime('%d%m%y', t)},,,A"
    return (frame(gga) + frame(rmc)).encode()


def parse_cot(raw):
    """One Cursor-on-Target <event> as the message sent to the page, or None when it is not one with a point."""
    try:
        ev = ElementTree.fromstring(raw)
        pt, contact = ev.find("point"), ev.find("detail/contact")
        return {"type": "cot", "uid": ev.get("uid"), "cot": ev.get("type"), "how": ev.get("how"),
                "lat": float(pt.get("lat")), "lon": float(pt.get("lon")),
                "callsign": contact.get("callsign") if contact is not None else None}
    except (ElementTree.ParseError, AttributeError, TypeError, ValueError):
        return None


def split_events(buf):
    """Cut a TAK stream into whole <event> elements. Returns (events, the rest of the buffer)."""
    events = []
    while (end := buf.find(b"</event>")) >= 0:
        raw, buf = buf[: end + 8], buf[end + 8:]
        start = raw.find(b"<event")
        if start >= 0:
            events.append(raw[start:])
    return events, buf[-(1 << 20):]


def overlay_name(name):
    """The file name of an overlay on the device; None when the page's name is not a plain one."""
    return f"opus_{name}.kmz" if isinstance(name, str) and re.fullmatch(r"[\w-]{1,80}", name) else None


def kmz(title, jpeg, north, south, east, west, rotation=0.0):
    """A KMZ ground overlay: the picture, and where it lies. `rotation` is degrees counter-clockwise."""
    box = [float(v) for v in (north, south, east, west, rotation)]
    if not (-90 <= box[1] < box[0] <= 90 and -180 <= box[3] < box[2] <= 180 and -180 <= box[4] <= 180):
        raise ValueError("overlay: not a box on the Earth")
    if jpeg[:2] != b"\xff\xd8":
        raise ValueError("overlay: the picture is not a JPEG")
    kml = ('<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
           f"<name>{escape(title)}</name><GroundOverlay><name>{escape(title)}</name><Icon><href>ground.jpg</href></Icon>"
           f"<LatLonBox><north>{box[0]:.8f}</north><south>{box[1]:.8f}</south><east>{box[2]:.8f}</east>"
           f"<west>{box[3]:.8f}</west><rotation>{box[4]:.5f}</rotation></LatLonBox></GroundOverlay></Document></kml>\n")
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
        z.writestr("doc.kml", kml)
        z.writestr("ground.jpg", jpeg)
    return out.getvalue()


def push_overlay(serial, m, tmp_dir):
    """Put the page's picture of the ground into ATAK's grg folder, unless that stretch of ground is already there."""
    name = overlay_name(m.get("name"))
    if not name:
        raise ValueError("overlay: bad name")
    if name in adb(serial, "shell", "ls", GRG_DIR, check=False).split():
        return "present"
    data = kmz(str(m.get("title") or "Open OPUS scene")[:80], base64.b64decode(m["jpeg"], validate=True),
               m["north"], m["south"], m["east"], m["west"], m.get("rotation", 0))
    tmp = Path(tmp_dir) / name
    tmp.write_bytes(data)
    adb(serial, "shell", "mkdir", "-p", GRG_DIR)
    adb(serial, "push", str(tmp), f"{GRG_DIR}/{name}")
    return "pushed"


async def main():
    import tempfile

    import websockets

    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--serial", default="emulator-5564", help="the adb serial of the device (see `adb devices`)")
    ap.add_argument("--port", type=int, default=9741)
    ap.add_argument("--allow-origin", action="append", default=[], metavar="ORIGIN",
                    help="a page origin allowed to connect besides this machine's own, e.g. https://example.org; "
                         "`null` allows pages opened from files (and any sandboxed frame). May be repeated.")
    ap.add_argument("--max-size", type=int, default=1204)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--bitrate", type=int, default=4_000_000)
    ap.add_argument("--codec", default="h264", choices=["h264", "av1"],
                    help="h264 for Chrome, Edge and Safari; av1 for browsers built without H.264 (plain Chromium)")
    ap.add_argument("--cot-port", type=int, default=8087, help="where ATAK connects as a TAK client (plain TCP)")
    ap.add_argument("--crop", default="",
                    help="width:height:x:y of the part of the screen to show, in the device's upright orientation, "
                         "to leave out the status bar or gesture bar. Default: the whole screen.")
    ap.add_argument("--gps", default="127.0.0.1:4349",
                    help="where ATAK's network GPS listens (host:port, UDP); `none` to send no position")
    args = ap.parse_args()

    phone = Phone(args.serial, args.max_size, args.fps, args.bitrate, args.codec, args.crop)
    await phone.start()
    tmp_dir = tempfile.mkdtemp(prefix="opus-gateway-")
    gps, gps_addr = None, None
    if args.gps != "none":
        gps_host, gps_port = args.gps.rsplit(":", 1)
        # A plain socket, not a connected one: while ATAK restarts nothing listens on the port, and a connected
        # UDP socket would be closed by that error and silently drop everything afterwards.
        gps = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        gps.setblocking(False)
        gps_addr = (gps_host, int(gps_port))

    # ATAK drops back to its internal GPS when sentences stop for a few seconds. With the map locked on the
    # player that makes it jump to wherever the internal GPS says and lose its zoom. So once a position is
    # known the gateway repeats it twice a second for as long as it runs: with the page closed or busy, ATAK
    # stays where the player last stood.
    last_pos = []

    async def feed_gps():
        while True:
            await asyncio.sleep(0.5)
            if last_pos and gps:
                try:
                    gps.sendto(nmea(*last_pos), gps_addr)
                except OSError:
                    pass

    feeder = asyncio.create_task(feed_gps())

    # ATAK is told (android/opus.pref) that its TAK server is this gateway. Everything it shares arrives here as
    # Cursor-on-Target XML, one <event> after another; each is passed to the page, where a mission host can
    # judge what the trainee reported.
    async def cot_client(reader, writer):
        print("[gateway] ATAK connected as a TAK client", flush=True)
        buf = b""
        try:
            while chunk := await reader.read(65536):
                events, buf = split_events(buf + chunk)
                for raw in events:
                    if (m := parse_cot(raw)):
                        phone.broadcast(json.dumps(m))
        except OSError:
            pass
        finally:
            writer.close()

    cot_server = await asyncio.start_server(cot_client, "127.0.0.1", args.cot_port)

    async def serve(ws):
        phone.clients.add(ws)
        try:
            await ws.send(json.dumps({"type": "video", "codec": phone.codec, "width": phone.size[0], "height": phone.size[1]}))
            if phone.config:
                await ws.send(b"\x00" + phone.config)
            phone.reset_video()
            async for raw in ws:
                try:
                    m = json.loads(raw)
                    t = m.get("t")
                    if t == "touch":
                        size = (int(m["w"]), int(m["h"])) if m.get("w") and m.get("h") else None
                        phone.touch(m["a"], float(m["x"]), float(m["y"]), size)
                    elif t == "key":
                        phone.key(int(m["code"]))
                    elif t == "text":
                        phone.text(str(m["s"]))
                    elif t == "back":
                        phone.key(4)
                    elif t == "pos":
                        pos = [float(m["lat"]), float(m["lon"]), float(m.get("hdg", 0)), float(m.get("spd", 0)), float(m.get("alt", 0))]
                        if -90 <= pos[0] <= 90 and -180 <= pos[1] <= 180:
                            last_pos[:] = pos
                    elif t == "overlay":
                        try:
                            state = await asyncio.to_thread(push_overlay, args.serial, m, tmp_dir)
                        except (ValueError, KeyError, TypeError, subprocess.CalledProcessError) as e:
                            state = "failed"
                            print("[gateway] overlay:", e, flush=True)
                        if state == "pushed":
                            print(f"[gateway] map overlay {m.get('name')} is on the device; ATAK shows it after it restarts", flush=True)
                        await ws.send(json.dumps({"type": "overlay", "name": m.get("name"), "state": state}))
                except (ValueError, KeyError, TypeError, AttributeError) as e:
                    print("[gateway] bad message:", e, flush=True)
        finally:
            phone.clients.discard(ws)

    origins = [LOCAL_ORIGIN, *args.allow_origin]
    # No keep-alive pings: video flows all the time, and a browser busy drawing the game can be late answering
    # a ping, which would only get its connection closed.
    async with websockets.serve(serve, "127.0.0.1", args.port, max_size=4 << 20, ping_interval=None, origins=origins):
        print(f"[gateway] ws://127.0.0.1:{args.port}  device {args.serial}  picture {phone.size[0]}x{phone.size[1]}  codec {phone.codec}", flush=True)
        await asyncio.gather(feeder, cot_server.serve_forever())


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
