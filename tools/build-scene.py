#!/usr/bin/env python3
"""Build a scene file for the game from open data. Standard library only.

    python3 tools/build-scene.py                      # fetch, then write scenes/old-quebec.json
    python3 tools/build-scene.py --cache DIR          # keep / reuse the raw downloads in DIR
    python3 tools/build-scene.py --offline --cache DIR   # rebuild from the downloads, no network

What it reads
  OpenStreetMap through the Overpass API (ODbL, "© OpenStreetMap contributors"): buildings and building parts,
  roads and paths, barriers (the fortification walls, retaining walls, fences), city gates, green areas, water,
  single trees, named landmarks.
  HRDEM terrain mosaic of Natural Resources Canada through its WCS (Open Government Licence – Canada): the bare-
  earth height, because OpenStreetMap has none and Old Quebec is a town on a cliff.

What it writes
  One JSON file in real UTM metres (zone 19T, WGS 84): game x = easting − anchor easting, game z = −(northing −
  anchor northing), game y = height above the vertical datum (CGVD2013). A grid reference read off the scene is
  the true grid of the place. The scene holds the place only; where a mission starts and what its objectives are
  is in the level file beside it (scenes/<id>.level.json), written by hand.

Rules where OpenStreetMap is silent are stated in RULES below and copied into the scene file.
"""
from __future__ import annotations

import argparse
import array
import base64
import datetime
import json
import math
import struct
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

# ── the scene ────────────────────────────────────────────────────────────────────────────────────────────────
SCENE_ID = "old-quebec"
SCENE_NAME = "Vieux-Québec"
ANCHOR_LAT, ANCHOR_LON = 46.8118, -71.2068   # between Place d'Armes and the Ursulines; snapped to a whole UTM metre below
HALF_W, HALF_H = 350.0, 300.0                # the walkable box: 700 m east-west, 600 m north-south
MARGIN = 120.0                               # data kept around it, so the edge of the box is not the edge of the town
TERRAIN_CELL = 2.5                           # metres between terrain samples in the scene file
GEOID_SEP = -27.6                            # approximate geoid height at Québec (m): ellipsoid height = CGVD2013 height + this

OVERPASS = "https://overpass-api.de/api/interpreter"
HRDEM_WCS = "https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic"
USER_AGENT = "scene-builder/1.0"

RULES = {
    "building_height": "OSM height, else building:levels × 3.2 m, else by kind: church/cathedral/chapel 18 m, "
                       "hotel/civic/school/university/government/public 16 m, garage/shed/hut/roof/kiosk 3 m, "
                       "footprint over 1500 m² 15 m, footprint under 40 m² 4 m, otherwise 10.5 m (three storeys). "
                       "`hs` says which: tag, levels or rule.",
    "roof": "OSM roof:shape and roof:height where tagged; otherwise the loader chooses (the engine's scene loader).",
    "road_width": "OSM width, else by class (ROAD_WIDTH in tools/build-scene.py).",
    "wall_height": "OSM height, else city wall 6 m, retaining wall parapet 1.1 m, wall 2 m, fence and rails 1.1 m.",
    "water": "OSM water polygons that close inside the data box; the river level is y = 0 (terrain cells under "
             "0.8 m are river in HRDEM here).",
    "simplify": "Rings and lines simplified to 0.25 m (Douglas-Peucker), coordinates rounded to 0.1 m.",
}

ROAD_WIDTH = {
    "primary": 10, "primary_link": 8, "secondary": 9, "secondary_link": 7, "tertiary": 8, "tertiary_link": 7,
    "residential": 7, "unclassified": 7, "living_street": 6, "service": 4, "pedestrian": 6, "footway": 2.6,
    "path": 2, "steps": 3, "cycleway": 2.5, "track": 3, "corridor": 2,
}
SMALL = {"garage", "garages", "shed", "hut", "roof", "kiosk", "carport", "service"}
TALL = {"church", "cathedral", "chapel"}
CIVIC = {"hotel", "civic", "school", "university", "government", "public", "college", "hospital"}

# ── WGS 84 / UTM (Snyder, the same series as atak/geo.js) ───────────────────────────────────────────────────────
WGS_A, WGS_F, K0 = 6378137.0, 1 / 298.257223563, 0.9996
E2 = WGS_F * (2 - WGS_F)
EP2 = E2 / (1 - E2)
ZONE = 19
LON0 = math.radians((ZONE - 1) * 6 - 180 + 3)


def to_utm(lat: float, lon: float) -> tuple[float, float]:
    phi, lam = math.radians(lat), math.radians(lon)
    s, c, t = math.sin(phi), math.cos(phi), math.tan(phi)
    n = WGS_A / math.sqrt(1 - E2 * s * s)
    tt, cc, a = t * t, EP2 * c * c, c * (lam - LON0)
    m = WGS_A * ((1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * phi
                 - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * math.sin(2 * phi)
                 + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * math.sin(4 * phi)
                 - (35 * E2 ** 3 / 3072) * math.sin(6 * phi))
    e = K0 * n * (a + (1 - tt + cc) * a ** 3 / 6 + (5 - 18 * tt + tt * tt + 72 * cc - 58 * EP2) * a ** 5 / 120) + 500000
    nn = K0 * (m + n * t * (a * a / 2 + (5 - tt + 9 * cc + 4 * cc * cc) * a ** 4 / 24
                            + (61 - 58 * tt + tt * tt + 600 * cc - 330 * EP2) * a ** 6 / 720))
    return e, nn


def from_utm(e: float, n: float) -> tuple[float, float]:
    x, m = e - 500000, n / K0
    mu = m / (WGS_A * (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - E2)) / (1 + math.sqrt(1 - E2))
    p1 = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
          + (151 * e1 ** 3 / 96) * math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    s, c, t = math.sin(p1), math.cos(p1), math.tan(p1)
    c1, t1 = EP2 * c * c, t * t
    n1 = WGS_A / math.sqrt(1 - E2 * s * s)
    r1 = WGS_A * (1 - E2) / (1 - E2 * s * s) ** 1.5
    d = x / (n1 * K0)
    lat = p1 - (n1 * t / r1) * (d * d / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4 / 24
                                + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6 / 720)
    lon = LON0 + (d - (1 + 2 * t1 + c1) * d ** 3 / 6
                  + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5 / 120) / c
    return math.degrees(lat), math.degrees(lon)


# ── Canada Atlas Lambert (EPSG:3979), the HRDEM mosaic's own grid ───────────────────────────────────────────────
G_A, G_F = 6378137.0, 1 / 298.257222101
G_E = math.sqrt(G_F * (2 - G_F))


def _lcc_t(phi: float) -> float:
    return math.tan(math.pi / 4 - phi / 2) / ((1 - G_E * math.sin(phi)) / (1 + G_E * math.sin(phi))) ** (G_E / 2)


def _lcc_m(phi: float) -> float:
    return math.cos(phi) / math.sqrt(1 - G_E * G_E * math.sin(phi) ** 2)


_P1, _P2, _P0, _L0 = (math.radians(v) for v in (49.0, 77.0, 49.0, -95.0))
_LN = (math.log(_lcc_m(_P1)) - math.log(_lcc_m(_P2))) / (math.log(_lcc_t(_P1)) - math.log(_lcc_t(_P2)))
_LF = _lcc_m(_P1) / (_LN * _lcc_t(_P1) ** _LN)
_LR0 = G_A * _LF * _lcc_t(_P0) ** _LN


def to_lambert(lat: float, lon: float) -> tuple[float, float]:
    r = G_A * _LF * _lcc_t(math.radians(lat)) ** _LN
    th = _LN * (math.radians(lon) - _L0)
    return r * math.sin(th), _LR0 - r * math.cos(th)


# ── downloads ────────────────────────────────────────────────────────────────────────────────────────────────
def fetch(url: str, data: bytes | None = None, tries: int = 4) -> bytes:
    last: Exception | None = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except Exception as exc:  # noqa: BLE001 - any network failure is retried, then reported
            last = exc
            time.sleep(5 * (i + 1))
    raise SystemExit(f"download failed: {url[:90]}… ({last})")


def overpass_query(s: float, w: float, n: float, e: float) -> str:
    b = f"({s:.6f},{w:.6f},{n:.6f},{e:.6f})"
    return f"""[out:json][timeout:120];
(
  way["building"]{b}; relation["building"]{b};
  way["building:part"]{b}; relation["building:part"]{b};
  way["highway"]{b}; relation["highway"="pedestrian"]{b};
  way["barrier"]{b};
  nwr["historic"="city_gate"]{b};
  way["leisure"~"^(park|garden|playground|pitch)$"]{b}; relation["leisure"~"^(park|garden)$"]{b};
  way["landuse"~"^(grass|cemetery|forest|village_green|recreation_ground)$"]{b};
  way["natural"~"^(water|wood|scrub|cliff|tree_row)$"]{b};
  node["natural"="tree"]{b};
  nwr["name"]["tourism"~"^(attraction|hotel|museum|viewpoint|artwork)$"]{b};
  nwr["name"]["historic"]{b};
  nwr["name"]["amenity"~"^(place_of_worship|townhall|theatre|library|university)$"]{b};
  nwr["name"]["place"="square"]{b};
);
out body geom;"""


def read_float_tiff(raw: bytes) -> tuple[list[list[float]], tuple[float, float], tuple[float, float], float]:
    """An uncompressed, tiled or stripped, one-band 32-bit float GeoTIFF: rows, pixel size, the top-left corner
    and the no-data value. That is what the WCS returns; anything else stops the build."""
    bo = "<" if raw[:2] == b"II" else ">"
    if struct.unpack(bo + "H", raw[2:4])[0] != 42:
        raise SystemExit("terrain: not a classic TIFF")
    off = struct.unpack(bo + "I", raw[4:8])[0]
    count = struct.unpack(bo + "H", raw[off:off + 2])[0]
    sizes = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8}
    fmts = {1: "B", 3: "H", 4: "I", 11: "f", 12: "d"}
    tags: dict[int, object] = {}
    for i in range(count):
        tag, typ, n = struct.unpack(bo + "HHI", raw[off + 2 + i * 12: off + 10 + i * 12])
        field = raw[off + 10 + i * 12: off + 14 + i * 12]
        size = sizes.get(typ, 1) * n
        data = field[:size] if size <= 4 else raw[struct.unpack(bo + "I", field)[0]:][:size]
        tags[tag] = data.rstrip(b"\0").decode("latin-1") if typ == 2 else struct.unpack(bo + fmts[typ] * n, data) if typ in fmts else data
    w, h = tags[256][0], tags[257][0]
    if tags.get(259, (1,))[0] != 1 or tags[258][0] != 32 or tags.get(339, (1,))[0] != 3 or tags.get(277, (1,))[0] != 1:
        raise SystemExit("terrain: expected an uncompressed one-band 32-bit float TIFF")
    rows = [[0.0] * w for _ in range(h)]

    def floats(o: int, n: int) -> array.array:
        a = array.array("f")
        a.frombytes(raw[o:o + n * 4])
        if (bo == ">") != (sys.byteorder == "big"):
            a.byteswap()
        return a

    if 324 in tags:  # tiles
        tw, th = tags[322][0], tags[323][0]
        across = (w + tw - 1) // tw
        for i, o in enumerate(tags[324]):
            a = floats(o, tw * th)
            ty, tx = (i // across) * th, (i % across) * tw
            for r in range(min(th, h - ty)):
                n = min(tw, w - tx)
                rows[ty + r][tx:tx + n] = a[r * tw: r * tw + n]
    else:            # strips
        rps = tags.get(278, (h,))[0]
        for i, o in enumerate(tags[273]):
            n = min(rps, h - i * rps)
            a = floats(o, n * w)
            for r in range(n):
                rows[i * rps + r] = list(a[r * w:(r + 1) * w])
    scale, tie = tags[33550], tags[33922]
    nodata = float(tags[42113]) if 42113 in tags else -32767.0
    return rows, (scale[0], scale[1]), (tie[3] - tie[0] * scale[0], tie[4] + tie[1] * scale[1]), nodata


# ── geometry helpers (game metres) ───────────────────────────────────────────────────────────────────────────
def ring_area(p: list[tuple[float, float]]) -> float:
    return 0.5 * sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))


def centroid(p: list[tuple[float, float]]) -> tuple[float, float]:
    a = ring_area(p)
    if abs(a) < 1e-6:
        return sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p)
    cx = cy = 0.0
    for i in range(len(p)):
        x0, y0 = p[i]
        x1, y1 = p[(i + 1) % len(p)]
        f = x0 * y1 - x1 * y0
        cx += (x0 + x1) * f
        cy += (y0 + y1) * f
    return cx / (6 * a), cy / (6 * a)


def inside(pt: tuple[float, float], p: list[tuple[float, float]]) -> bool:
    x, y, hit = pt[0], pt[1], False
    for i in range(len(p)):
        x0, y0 = p[i]
        x1, y1 = p[i - 1]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            hit = not hit
    return hit


def simplify(p: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    if len(p) < 3:
        return p
    keep = [False] * len(p)
    keep[0] = keep[-1] = True
    stack = [(0, len(p) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay, bx, by = *p[a], *p[b]
        dx, dy = bx - ax, by - ay
        ln = math.hypot(dx, dy)
        worst, at = 0.0, -1
        for i in range(a + 1, b):
            # a closed line starts and ends on the same point: measure from that point instead of from a line
            d = abs((p[i][0] - ax) * dy - (p[i][1] - ay) * dx) / ln if ln > 1e-6 else math.hypot(p[i][0] - ax, p[i][1] - ay)
            if d > worst:
                worst, at = d, i
        if worst > tol:
            keep[at] = True
            stack += [(a, at), (at, b)]
    return [q for q, k in zip(p, keep) if k]


def clean_ring(p: list[tuple[float, float]], tol: float = 0.25) -> list[tuple[float, float]] | None:
    """An open ring (first point not repeated), counter-clockwise seen with +x east and north up, simplified."""
    if len(p) > 1 and p[0] == p[-1]:
        p = p[:-1]
    if len(p) < 3:
        return None
    # simplify as a closed line starting at the point farthest from the centroid, so that start is a real corner
    c = (sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p))
    k = max(range(len(p)), key=lambda i: (p[i][0] - c[0]) ** 2 + (p[i][1] - c[1]) ** 2)
    q = p[k:] + p[:k]
    q = simplify(q + [q[0]], tol)[:-1]
    out = [q[0]]
    for pt in q[1:]:
        if math.hypot(pt[0] - out[-1][0], pt[1] - out[-1][1]) > 0.05:
            out.append(pt)
    if len(out) < 3 or abs(ring_area(out)) < 1.0:
        return None
    # game z points south, so a ring that is counter-clockwise on the map has a NEGATIVE shoelace area in (x, z)
    if ring_area(out) > 0:
        out.reverse()
    return out


def flat(p: list[tuple[float, float]]) -> list[float]:
    return [round(v, 1) for q in p for v in q]


def join_rings(ways: list[list[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
    """Member ways of a multipolygon joined end to end into closed rings; open leftovers are dropped."""
    ways = [w[:] for w in ways if len(w) > 1]
    rings = []
    while ways:
        cur = ways.pop()
        grew = True
        while cur[0] != cur[-1] and grew:
            grew = False
            for i, w in enumerate(ways):
                if w[0] == cur[-1]:
                    cur += w[1:]
                elif w[-1] == cur[-1]:
                    cur += w[-2::-1]
                elif w[-1] == cur[0]:
                    cur = w[:-1] + cur
                elif w[0] == cur[0]:
                    cur = w[:0:-1] + cur
                else:
                    continue
                ways.pop(i)
                grew = True
                break
        if cur[0] == cur[-1] and len(cur) > 3:
            rings.append(cur)
    return rings


def num(v: object) -> float | None:
    try:
        return float(str(v).replace(",", ".").split()[0].rstrip("m"))
    except (ValueError, IndexError):
        return None


# ── the build ────────────────────────────────────────────────────────────────────────────────────────────────
def build(cache: Path | None, offline: bool, out: Path) -> None:
    e0, n0 = (round(v) for v in to_utm(ANCHOR_LAT, ANCHOR_LON))
    lat0, lon0 = from_utm(e0, n0)
    ext = {"minX": -HALF_W - MARGIN, "maxX": HALF_W + MARGIN, "minZ": -HALF_H - MARGIN, "maxZ": HALF_H + MARGIN}

    def game(lat: float, lon: float) -> tuple[float, float]:
        e, n = to_utm(lat, lon)
        return e - e0, -(n - n0)

    def geo(x: float, z: float) -> tuple[float, float]:
        return from_utm(e0 + x, n0 - z)

    corners = [geo(x, z) for x in (ext["minX"], ext["maxX"]) for z in (ext["minZ"], ext["maxZ"])]
    s, n = min(c[0] for c in corners), max(c[0] for c in corners)
    w, e = min(c[1] for c in corners), max(c[1] for c in corners)

    # ---- downloads (or the cache) ----
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    osm_file = cache / "osm.json" if cache else None
    dem_file = cache / "hrdem.tif" if cache else None
    meta_file = cache / "meta.json" if cache else None
    if offline:
        if not (osm_file and osm_file.exists() and dem_file.exists()):
            raise SystemExit("--offline needs --cache with osm.json and hrdem.tif")
        osm_raw, dem_raw = osm_file.read_bytes(), dem_file.read_bytes()
        stamp = json.loads(meta_file.read_text())["fetched"] if meta_file.exists() else stamp
    else:
        print("fetching OpenStreetMap (Overpass)…", file=sys.stderr)
        osm_raw = fetch(OVERPASS, urllib.parse.urlencode({"data": overpass_query(s, w, n, e)}).encode())
        lam = [to_lambert(la, lo) for la, lo in corners]
        bb = (min(p[0] for p in lam) - 6, min(p[1] for p in lam) - 6, max(p[0] for p in lam) + 6, max(p[1] for p in lam) + 6)
        print("fetching HRDEM terrain (NRCan WCS)…", file=sys.stderr)
        dem_raw = fetch(HRDEM_WCS + "?" + urllib.parse.urlencode({
            "service": "WCS", "version": "1.1.1", "request": "GetCoverage", "identifier": "dtm", "format": "image/geotiff",
            "BoundingBox": ",".join(f"{v:.1f}" for v in bb) + ",urn:ogc:def:crs:EPSG::3979",
            "GridBaseCRS": "urn:ogc:def:crs:EPSG::3979", "GridOffsets": "2.0,-2.0"}))
        if cache:
            cache.mkdir(parents=True, exist_ok=True)
            osm_file.write_bytes(osm_raw)
            dem_file.write_bytes(dem_raw)
            meta_file.write_text(json.dumps({"fetched": stamp}))
    osm = json.loads(osm_raw)
    osm_date = (osm.get("osm3s") or {}).get("timestamp_osm_base", stamp)

    # ---- terrain: the mosaic's Lambert grid resampled onto the scene's UTM grid ----
    rows, (px, py), (ox, oy), nodata = read_float_tiff(dem_raw)
    dh, dw = len(rows), len(rows[0])

    def dem_at(x: float, z: float) -> float:
        lx, ly = to_lambert(*geo(x, z))
        fx, fy = (lx - ox) / px - 0.5, (oy - ly) / py - 0.5
        ix, iy = max(0, min(dw - 2, int(math.floor(fx)))), max(0, min(dh - 2, int(math.floor(fy))))
        tx, ty = max(0.0, min(1.0, fx - ix)), max(0.0, min(1.0, fy - iy))
        v = [rows[iy][ix], rows[iy][ix + 1], rows[iy + 1][ix], rows[iy + 1][ix + 1]]
        good = [q for q in v if q > nodata + 1 and q < 1e6]
        if not good:
            return 0.0
        v = [q if (q > nodata + 1 and q < 1e6) else sum(good) / len(good) for q in v]
        return (v[0] * (1 - tx) + v[1] * tx) * (1 - ty) + (v[2] * (1 - tx) + v[3] * tx) * ty

    nx = int(round((ext["maxX"] - ext["minX"]) / TERRAIN_CELL)) + 1
    nz = int(round((ext["maxZ"] - ext["minZ"]) / TERRAIN_CELL)) + 1
    heights = array.array("H")
    lo, hi = 1e9, -1e9
    for j in range(nz):
        for i in range(nx):
            hgt = max(0.0, dem_at(ext["minX"] + i * TERRAIN_CELL, ext["minZ"] + j * TERRAIN_CELL))
            lo, hi = min(lo, hgt), max(hi, hgt)
            heights.append(min(65535, int(round(hgt * 10))))
    if sys.byteorder == "big":
        heights.byteswap()

    def ground(x: float, z: float) -> float:
        i = max(0, min(nx - 1, int(round((x - ext["minX"]) / TERRAIN_CELL))))
        j = max(0, min(nz - 1, int(round((z - ext["minZ"]) / TERRAIN_CELL))))
        v = heights[j * nx + i]
        return (((v & 255) << 8 | v >> 8) if sys.byteorder == "big" else v) / 10

    # ---- OpenStreetMap ----
    def pts(geom: list[dict | None]) -> list[tuple[float, float]]:
        return [game(g["lat"], g["lon"]) for g in geom if g]

    def in_ext(p: tuple[float, float], pad: float = 0.0) -> bool:
        return ext["minX"] - pad <= p[0] <= ext["maxX"] + pad and ext["minZ"] - pad <= p[1] <= ext["maxZ"] + pad

    def polygons(el: dict) -> list[tuple[list, list]]:
        """(outer ring, holes) for a closed way or a multipolygon relation."""
        if el["type"] == "way":
            p = pts(el.get("geometry") or [])
            r = clean_ring(p) if len(p) > 3 and p[0] == p[-1] else None
            return [(r, [])] if r else []
        if el["type"] != "relation":
            return []
        outer = join_rings([pts(m["geometry"]) for m in el.get("members", []) if m.get("type") == "way" and m.get("geometry") and m.get("role") != "inner"])
        inner = join_rings([pts(m["geometry"]) for m in el.get("members", []) if m.get("type") == "way" and m.get("geometry") and m.get("role") == "inner"])
        outs = [r for r in (clean_ring(o) for o in outer) if r]
        ins = [r for r in (clean_ring(i) for i in inner) if r]
        return [(o, [h for h in ins if inside(centroid(h), o)]) for o in outs]

    buildings, parts, roads, areas, walls, green, water, trees, landmarks, gates = [], [], [], [], [], [], [], [], [], []
    seen_lm: set[str] = set()

    def landmark(el: dict, x: float, z: float, kind: str) -> None:
        name = el["tags"].get("name")
        if not name or not in_ext((x, z)) or name in seen_lm:
            return
        seen_lm.add(name)
        landmarks.append({"n": name, "k": kind, "x": round(x, 1), "z": round(z, 1), "y": round(ground(x, z), 1),
                          "osm": f"{el['type']}/{el['id']}"})

    for el in osm["elements"]:
        t = el.get("tags") or {}
        if el["type"] == "node":
            if "lat" not in el:
                continue
            x, z = game(el["lat"], el["lon"])
            if t.get("natural") == "tree" and in_ext((x, z)):
                trees.append([round(x, 1), round(z, 1)])
            if t.get("historic") == "city_gate" and in_ext((x, z)):
                gates.append({"n": t.get("name", ""), "x": round(x, 1), "z": round(z, 1)})
            kind = t.get("historic") or t.get("tourism") or t.get("amenity") or t.get("place")
            if kind:
                landmark(el, x, z, kind)
            continue

        is_part = "building:part" in t and t["building:part"] != "no"
        if ("building" in t and t["building"] != "no") or is_part:
            for ring, holes in polygons(el):
                c = centroid(ring)
                if not in_ext(c):
                    continue
                area = abs(ring_area(ring))
                kind = t.get("building:part") if is_part else t.get("building")
                kind = (t.get("amenity") == "place_of_worship" and "church") or (t.get("tourism") == "hotel" and "hotel") or kind
                h, src = num(t.get("height")), "tag"
                lv = num(t.get("building:levels"))
                if h is None and lv is not None:
                    h, src = lv * 3.2, "levels"
                if h is None:
                    src = "rule"
                    h = 18.0 if kind in TALL else 16.0 if kind in CIVIC else 3.0 if kind in SMALL else 15.0 if area > 1500 else 4.0 if area < 40 else 10.5
                b = {"r": flat(ring), "h": round(max(2.0, h), 1), "hs": src, "g": round(min(ground(ring[i][0], ring[i][1]) for i in range(len(ring))), 1)}
                if holes:
                    b["holes"] = [flat(hh) for hh in holes]
                mh = num(t.get("min_height"))
                if mh is None and num(t.get("building:min_level")) is not None:
                    mh = num(t.get("building:min_level")) * 3.2
                if mh:
                    b["mh"] = round(mh, 1)
                if lv is not None:
                    b["lv"] = int(lv)
                if kind and kind != "yes":
                    b["k"] = kind
                for src_key, key in (("roof:shape", "roof"), ("roof:colour", "rc"), ("roof:material", "rm"), ("building:colour", "col"),
                                     ("building:material", "mat"), ("name", "n"), ("roof:orientation", "ro")):
                    if t.get(src_key):
                        b[key] = t[src_key]
                if num(t.get("roof:height")) is not None:
                    b["rh"] = round(num(t.get("roof:height")), 1)
                (parts if is_part else buildings).append(b)
                if t.get("name") and not is_part:
                    landmark(el, c[0], c[1], t.get("tourism") or t.get("amenity") or t.get("historic") or "building")
                if t.get("historic") == "city_gate":
                    gates.append({"n": t.get("name", ""), "x": round(c[0], 1), "z": round(c[1], 1)})
            continue

        hw = t.get("highway")
        if hw:
            if el["type"] == "relation" or t.get("area") == "yes":
                for ring, holes in polygons(el):
                    if in_ext(centroid(ring), 60):
                        a = {"r": flat(ring), "k": hw, "s": t.get("surface", "")}
                        if holes:
                            a["holes"] = [flat(hh) for hh in holes]
                        if t.get("name"):
                            a["n"] = t["name"]
                        areas.append(a)
                        if t.get("name"):
                            landmark(el, *centroid(ring), "square")
                continue
            if hw not in ROAD_WIDTH or t.get("tunnel") in ("yes", "building_passage") and hw == "corridor" or t.get("indoor") == "yes":
                continue
            p = simplify(pts(el.get("geometry") or []), 0.25)
            if len(p) < 2 or not any(in_ext(q) for q in p):
                continue
            r = {"p": flat(p), "k": hw, "w": round(num(t.get("width")) or ROAD_WIDTH[hw], 1)}
            for src_key, key in (("name", "n"), ("surface", "s"), ("bridge", "br"), ("tunnel", "tn"), ("covered", "cv")):
                if t.get(src_key):
                    r[key] = t[src_key]
            roads.append(r)
            continue

        bar = t.get("barrier")
        if bar in ("city_wall", "retaining_wall", "wall", "fence", "guard_rail", "handrail", "hedge"):
            p = simplify(pts(el.get("geometry") or []), 0.25)
            if len(p) >= 2 and any(in_ext(q) for q in p):
                default = {"city_wall": 6.0, "retaining_wall": 1.1, "wall": 2.0, "hedge": 1.4}.get(bar, 1.1)
                wl = {"p": flat(p), "k": bar, "h": round(num(t.get("height")) or default, 1)}
                if t.get("name"):
                    wl["n"] = t["name"]
                walls.append(wl)
            continue

        kind = t.get("leisure") or t.get("landuse") or t.get("natural")
        if kind in ("park", "garden", "playground", "pitch", "grass", "cemetery", "forest", "village_green", "recreation_ground", "wood", "scrub"):
            for ring, holes in polygons(el):
                if in_ext(centroid(ring), 80):
                    g = {"r": flat(ring), "k": kind}
                    if holes:
                        g["holes"] = [flat(hh) for hh in holes]
                    if t.get("name"):
                        g["n"] = t["name"]
                        landmark(el, *centroid(ring), "park")
                    green.append(g)
            continue
        if kind == "water":
            for ring, _ in polygons(el):
                water.append({"r": flat(ring), "n": t.get("name", "")})
            continue
        if kind == "tree_row":
            p = pts(el.get("geometry") or [])
            for a, b in zip(p, p[1:]):
                ln = math.hypot(b[0] - a[0], b[1] - a[1])
                for k in range(max(1, int(ln // 8))):
                    q = (a[0] + (b[0] - a[0]) * k / max(1, int(ln // 8)), a[1] + (b[1] - a[1]) * k / max(1, int(ln // 8)))
                    if in_ext(q):
                        trees.append([round(q[0], 1), round(q[1], 1)])
            continue
        lk = t.get("historic") or t.get("tourism") or t.get("amenity") or t.get("place")
        if lk and t.get("name"):
            g = [q for q in pts(el.get("geometry") or [])] or [q for m in el.get("members", []) for q in pts(m.get("geometry") or [])]
            if g:
                landmark(el, sum(q[0] for q in g) / len(g), sum(q[1] for q in g) / len(g), lk)

    # A building whose outline holds building parts is drawn from its parts (OSM "Simple 3D Buildings").
    part_centres = [centroid(list(zip(p["r"][0::2], p["r"][1::2]))) for p in parts]
    for b in buildings:
        ring = list(zip(b["r"][0::2], b["r"][1::2]))
        xs, zs = b["r"][0::2], b["r"][1::2]
        if any(min(xs) <= c[0] <= max(xs) and min(zs) <= c[1] <= max(zs) and inside(c, ring) for c in part_centres):
            b["parts"] = 1
    for p in parts:
        p["part"] = 1

    conv = math.degrees(math.atan(math.tan(math.radians(lon0) - LON0) * math.sin(math.radians(lat0))))
    scene = {
        "format": "opus-scene/1",
        "id": SCENE_ID,
        "name": SCENE_NAME,
        "georef": {
            "crs": "EPSG:32619", "projection": "utm", "zone": ZONE, "band": "T", "hemisphere": "N",
            "easting": e0, "northing": n0,
            "anchor": {"lat": round(lat0, 8), "lon": round(lon0, 8), "hae": GEOID_SEP},
            "convergence_deg": round(conv, 4),
            "vertical": "game y = metres above CGVD2013 (HRDEM); ellipsoid height = y + anchor.hae, where anchor.hae is "
                        "an approximate geoid height for Québec",
            "frame": "game x = easting - georef.easting; game z = -(northing - georef.northing); -z is GRID north",
        },
        "play": {"minX": -HALF_W, "maxX": HALF_W, "minZ": -HALF_H, "maxZ": HALF_H},
        "extent": ext,
        "sources": [
            {"name": "OpenStreetMap", "via": "Overpass API", "licence": "ODbL 1.0", "attribution": "© OpenStreetMap contributors",
             "url": "https://www.openstreetmap.org/copyright", "extract": osm_date, "fetched": stamp,
             "bbox": [round(s, 6), round(w, 6), round(n, 6), round(e, 6)]},
            {"name": "HRDEM Mosaic (CanElevation Series), terrain model", "via": "NRCan WCS", "licence": "Open Government Licence – Canada",
             "attribution": "Contains information licensed under the Open Government Licence – Canada.",
             "url": "https://open.canada.ca/data/dataset/0fe65119-e96e-4a57-8bfe-9d9245fba06b", "fetched": stamp},
        ],
        "rules": RULES,
        "terrain": {"cell": TERRAIN_CELL, "nx": nx, "nz": nz, "minX": ext["minX"], "minZ": ext["minZ"], "unit": 0.1,
                    "min": round(lo, 1), "max": round(hi, 1), "encoding": "base64 uint16 little-endian, rows north to south",
                    "data": base64.b64encode(heights.tobytes()).decode("ascii")},
        "water": {"level": 0.0, "polygons": water},
        "buildings": buildings + parts,
        "roads": roads,
        "areas": areas,
        "walls": walls,
        "gates": gates,
        "green": green,
        "trees": trees,
        "landmarks": sorted(landmarks, key=lambda m: m["n"]),
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(scene, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    hs = {k: sum(1 for b in scene["buildings"] if b["hs"] == k) for k in ("tag", "levels", "rule")}
    print(json.dumps({
        "out": str(out), "bytes": out.stat().st_size, "anchor": scene["georef"]["anchor"], "easting": e0, "northing": n0,
        "osm_extract": osm_date, "terrain": [nx, nz, round(lo, 1), round(hi, 1)],
        "buildings": len(buildings), "parts": len(parts), "height_source": hs, "roads": len(roads), "areas": len(areas),
        "walls": len(walls), "gates": len(gates), "green": len(green), "water": len(water), "trees": len(trees),
        "landmarks": len(landmarks)}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "scenes" / f"{SCENE_ID}.json")
    ap.add_argument("--cache", type=Path, help="directory for the raw downloads (osm.json, hrdem.tif)")
    ap.add_argument("--offline", action="store_true", help="use the cache only")
    a = ap.parse_args()
    build(a.cache, a.offline, a.out)
