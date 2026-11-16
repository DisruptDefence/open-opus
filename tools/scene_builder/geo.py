"""WGS 84 / UTM (Snyder's series; the engine's geo module implements the same independently), MGRS, and the
Canada Atlas Lambert (EPSG:3979) grid the HRDEM mosaic is served in. Moved from the first builder; the zone now
comes from the anchor instead of being a constant."""
from __future__ import annotations

import math

WGS_A, WGS_F, K0 = 6378137.0, 1 / 298.257223563, 0.9996
E2 = WGS_F * (2 - WGS_F)
EP2 = E2 / (1 - E2)

BANDS = "CDEFGHJKLMNPQRSTUVWXX"


def zone_of(lon: float) -> int:
    return int(math.floor((lon + 180) / 6)) + 1


def band_of(lat: float) -> str:
    return BANDS[int((lat + 80) // 8)]


def central_meridian(zone: int) -> float:
    return math.radians((zone - 1) * 6 - 180 + 3)


def to_utm(lat: float, lon: float, zone: int | None = None) -> tuple[float, float]:
    zone = zone or zone_of(lon)
    lon0 = central_meridian(zone)
    phi, lam = math.radians(lat), math.radians(lon)
    s, c, t = math.sin(phi), math.cos(phi), math.tan(phi)
    n = WGS_A / math.sqrt(1 - E2 * s * s)
    tt, cc, a = t * t, EP2 * c * c, c * (lam - lon0)
    m = WGS_A * ((1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * phi
                 - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * math.sin(2 * phi)
                 + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * math.sin(4 * phi)
                 - (35 * E2 ** 3 / 3072) * math.sin(6 * phi))
    e = K0 * n * (a + (1 - tt + cc) * a ** 3 / 6 + (5 - 18 * tt + tt * tt + 72 * cc - 58 * EP2) * a ** 5 / 120) + 500000
    nn = K0 * (m + n * t * (a * a / 2 + (5 - tt + 9 * cc + 4 * cc * cc) * a ** 4 / 24
                            + (61 - 58 * tt + tt * tt + 600 * cc - 330 * EP2) * a ** 6 / 720))
    return e, nn


def from_utm(e: float, n: float, zone: int) -> tuple[float, float]:
    lon0 = central_meridian(zone)
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
    lon = lon0 + (d - (1 + 2 * t1 + c1) * d ** 3 / 6
                  + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5 / 120) / c
    return math.degrees(lat), math.degrees(lon)


def mgrs(e: float, n: float, lat: float, zone: int, digits: int = 5) -> str:
    """MGRS straight from UTM (docs/SCENE-FORMAT.md 2.3): 100 km square letters from the zone, digits truncated."""
    cols = ("STUVWXYZ", "ABCDEFGH", "JKLMNPQR")[zone % 3]
    rows = "ABCDEFGHJKLMNPQRSTUV"
    col = cols[int(e // 100000) - 1]
    row = rows[(int(n // 100000) + (5 if zone % 2 == 0 else 0)) % 20]
    cut = lambda v: str(int(v % 100000) // 10 ** (5 - digits)).zfill(digits)  # noqa: E731
    return f"{zone}{band_of(lat)}{col}{row}{cut(e)}{cut(n)}"


def georef_block(e0: int, n0: int, zone: int, play: dict, ext: dict, vertical: dict) -> dict:
    """The georeference exactly as docs/SCENE-FORMAT.md 2.2 writes it, with its check points.

    The check points are computed with this file's own UTM series, not with a reference library (the builder is
    standard library only). They pin the engine's independent implementation to this one.
    """
    lat0, lon0 = from_utm(e0, n0, zone)
    conv = math.degrees(math.atan(math.tan(math.radians(lon0) - central_meridian(zone)) * math.sin(math.radians(lat0))))
    points = [(0.0, 0.0)] + [(play[a], play[b]) for a in ("minX", "maxX") for b in ("minZ", "maxZ")] \
        + [(ext["minX"], ext["minZ"]), (ext["maxX"], ext["maxZ"])]
    checks = []
    for x, z in points:
        lat, lon = from_utm(e0 + x, n0 - z, zone)
        checks.append({"x": x, "z": z, "lat": round(lat, 8), "lon": round(lon, 8), "mgrs": mgrs(e0 + x, n0 - z, lat, zone)})
    return {
        "crs": f"EPSG:326{zone:02d}", "projection": "utm", "zone": zone, "band": band_of(lat0), "hemisphere": "N",
        "easting": e0, "northing": n0, "h0": 0,
        "anchor": {"lat": round(lat0, 8), "lon": round(lon0, 8)},
        "vertical": dict(vertical),
        "convergence_deg": round(conv, 4),
        "checks": checks,
    }


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
