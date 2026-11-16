"""Buildings in data (item 2 of docs/plans/SCENE-DETAIL.md): measured heights, roof shape and direction, façade
class, storeys, use, blind and street-facing edges, a stable id.

Data: OSM tags (ODbL) and the HRDEM surface and terrain models (Open Government Licence – Canada) through
`ctx.surface_height`. Every value the builder has to invent is covered by a sentence in `rules`."""
from __future__ import annotations

import math
import re

from . import landmark_rules, parts as parts_mod
from .geom import bbox, flat, inside, num, obb, ring_area, ring_edges, seg_dist, seg_nearest
from .style import FACADES, ROOF_MATS, ROOF_SHAPES, USES, pick

SMALL = {"garage", "garages", "shed", "hut", "roof", "kiosk", "carport", "service"}
TALL = {"church", "cathedral", "chapel"}
CIVIC = {"hotel", "civic", "school", "university", "government", "public", "college", "hospital"}

SHAPE_TAG = {"flat": 0, "gabled": 1, "hipped": 2, "mansard": 3, "pyramidal": 4, "skillion": 5, "sheded": 5, "dome": 6,
             "round": 6, "onion": 6, "cone": 7, "gambrel": 8}
FACADE_TAG = {"stone": 1, "brick": 3, "plaster": 4, "stucco": 4, "cement_block": 4, "wood": 5, "concrete": 6, "glass": 7, "metal": 8}
ROOFMAT_TAG = {"metal": 1, "tin": 1, "zinc": 1, "copper": 2, "slate": 3, "shingle": 4, "asphalt": 4, "tile": 5, "roof_tiles": 5,
               "gravel": 6, "tar_paper": 6, "bitumen": 6, "concrete": 7, "thatch": 8}
USE_KIND = {
    4: {"church", "cathedral", "chapel", "place_of_worship"},
    2: {"retail", "commercial", "supermarket", "kiosk"},
    3: {"civic", "public", "government", "townhall", "school", "university", "hospital"},
    5: {"industrial", "warehouse"},
    7: {"train_station", "transportation"},
    1: {"house", "apartments", "residential", "detached", "terrace"},
}
NOT_FRONT = {"service", "steps", "path", "corridor"}
GRID = 25.0
PITCHED = {1, 2, 3, 4, 5, 7, 8}


def fnv1a32(s: str) -> int:
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


def pct(vals: list[float], q: float) -> float:
    """The q-quantile (0..1) of a list, linear between neighbouring ranks."""
    v = sorted(vals)
    if len(v) == 1:
        return v[0]
    i = q * (len(v) - 1)
    lo = int(math.floor(i))
    hi = min(lo + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (i - lo)


def assign_ids(src_keys: list[tuple]) -> list[int]:
    """FNV-1a 32 of "<osm type>/<osm id>/<ring index>"; on a clash +1 until free, assigned in ascending source-id
    order. Never 0. Returns the ids in the order of `src_keys`."""
    order = sorted(range(len(src_keys)), key=lambda i: (src_keys[i][1], src_keys[i][0], src_keys[i][2]))
    used: set[int] = set()
    ids = [0] * len(src_keys)
    for i in order:
        t, n, r = src_keys[i]
        v = fnv1a32(f"{t}/{n}/{r}") or 1
        while v in used or v == 0:
            v = (v + 1) & 0xFFFFFFFF
        used.add(v)
        ids[i] = v
    return ids


# ── the surface model ───────────────────────────────────────────────────────────────────────────────────────────
def lattice(ring: list, holes: list, step: float = 1.0) -> list[tuple[float, float, float]]:
    """Points of a 1 m lattice inside the ring (not in a hole) with their distance to the nearest edge."""
    x0, z0, x1, z1 = bbox(ring)
    edges = ring_edges(ring) + [e for h in holes for e in ring_edges(h)]
    out = []
    x = math.floor(x0) + 0.5
    while x <= x1:
        z = math.floor(z0) + 0.5
        while z <= z1:
            if x0 <= x and z0 <= z and inside((x, z), ring) and not any(inside((x, z), h) for h in holes):
                out.append((x, z, min(seg_dist(x, z, a[0], a[1], b[0], b[1]) for a, b in edges)))
            z += step
        x += step
    return out


def inradius(ring: list, holes: list, lat: list) -> float:
    """The footprint's true inradius: the largest distance from an interior point to the nearest edge. Found on the
    1 m lattice, then refined on a 0.1 m grid around the best point."""
    edges = ring_edges(ring) + [e for h in holes for e in ring_edges(h)]

    def d_at(x: float, z: float) -> float | None:
        if not inside((x, z), ring) or any(inside((x, z), h) for h in holes):
            return None
        return min(seg_dist(x, z, a[0], a[1], b[0], b[1]) for a, b in edges)

    if not lat:
        return 0.0
    bx, bz, best = max(lat, key=lambda p: p[2])
    for i in range(-10, 11):
        for j in range(-10, 11):
            d = d_at(bx + i * 0.1, bz + j * 0.1)
            if d is not None and d > best:
                best = d
    return best


def fit_line(pts: list[tuple[float, float]]) -> tuple[float, float] | None:
    """Least-squares height = a + b d, after dropping the points far from the median residual of the fit
    (chimneys, dormers, overhanging trees, the high ends of a ridge), in passes of 2.5, 1.0 and 0.5 m while at
    least 4 points on 2 distances remain. Returns (a, b)."""
    def ls(p):
        n = len(p)
        sx, sy = sum(q[0] for q in p), sum(q[1] for q in p)
        sxx, sxy = sum(q[0] * q[0] for q in p), sum(q[0] * q[1] for q in p)
        den = n * sxx - sx * sx
        if n < 3 or den < 1e-9:
            return None
        b = (n * sxy - sx * sy) / den
        return (sy - b * sx) / n, b

    f = ls(pts)
    if f is None:
        return None
    keep = pts
    for limit in (2.5, 1.0, 0.5):    # each pass drops what stands off the median residual by more than `limit`
        res = [q[1] - (f[0] + f[1] * q[0]) for q in keep]
        med = pct(res, 0.5)
        kept = [q for q, r in zip(keep, res) if abs(r - med) <= limit]
        g = ls(kept) if len(kept) >= 4 and len({round(q[0], 1) for q in kept}) >= 2 else None
        if g is None:
            break
        keep, f = kept, g
    return f


def measure(ctx, ring: list, holes: list, g: float) -> dict | None:
    """The roof from the surface model: ridge (top), eave and rise, or None when it does not give a usable roof.

    Samples are the 1 m lattice points at least 1 m inside the footprint (all inside points when fewer than 6).
    The eave is the value at d = 0 of a robust line fit of height against the distance d to the nearest edge; the
    ridge is the 95th percentile of the samples, or the fitted line carried to the true inradius when the lattice
    is too coarse to reach the middle of a narrow roof."""
    pts = lattice(ring, holes)
    core = [p for p in pts if p[2] >= 1.0]
    use = core if len(core) >= 6 else pts
    samples = []
    for x, z, d in use:
        s = ctx.surface_height(x, z)
        if s is not None:
            samples.append((x, z, s - g, d))
    if len(samples) < 6:
        return None
    hs = [s[2] for s in samples]
    ridge = pct(hs, 0.95)
    dmax = inradius(ring, holes, pts)
    band = [(s[3], s[2]) for s in samples if 1.0 <= s[3] <= min(4.0, 0.6 * dmax)]
    if len({round(q[0], 1) for q in band}) < 2:   # a 1 m lattice on a narrow roof can hit one distance only: reach further in
        band = [(s[3], s[2]) for s in samples if 1.0 <= s[3] <= min(4.0, 0.95 * dmax)]
    f = fit_line(band) if len(band) >= 4 else None
    p20 = pct(hs, 0.20)
    slope = f[1] if f else 0.0
    if f:
        eave = min(f[0], p20 + 0.5)
        if slope >= 0.25 and sum(1 for s in samples if s[3] >= 0.8 * dmax) < 2:
            ridge = max(ridge, f[0] + slope * dmax)
    else:
        eave = p20
    eave = max(eave, 2.2)
    if not 3.0 <= ridge <= 150.0:
        return None
    eave = min(eave, ridge)
    rise = max(0.0, ridge - eave)
    if slope < 0.08 and rise < 0.8:
        rise = 0.0
    return {"top": ridge, "eave": eave, "rise": rise, "slope": slope, "samples": samples}


def pitch_class(rise: float, w: float) -> str:
    if rise < 1.0 or (w > 0 and rise / w < 0.12):
        return "flat"
    if w > 0 and rise / w >= 0.6:
        return "steep"
    return "low"


def ridge_direction(samples: list, o: dict) -> int:
    """The bearing (0..179, from grid north) of the axis the roof falls away from, or 255. Heights are correlated
    with the distance from each axis's centre line; the ridge runs along the one with the more negative
    correlation, when it is below -0.3."""
    ux, uz = o["ux"], o["uz"]
    hs = [s[2] for s in samples]
    mh = sum(hs) / len(hs)
    sh = math.sqrt(sum((v - mh) ** 2 for v in hs))
    if sh < 1e-6:
        return 255

    def corr(dists: list[float]) -> float:
        md = sum(dists) / len(dists)
        sd = math.sqrt(sum((d - md) ** 2 for d in dists))
        if sd < 1e-6:
            return 0.0
        return sum((d - md) * (v - mh) for d, v in zip(dists, hs)) / (sd * sh)

    cx, cz = o["cx"], o["cz"]
    across_long = [abs(-(s[0] - cx) * uz + (s[1] - cz) * ux) for s in samples]   # distance from the long axis's line
    across_short = [abs((s[0] - cx) * ux + (s[1] - cz) * uz) for s in samples]   # distance from the short axis's line
    cl, cs = corr(across_long), corr(across_short)
    best, vec = (cl, (ux, uz)) if cl <= cs else (cs, (-uz, ux))
    if best >= -0.3:
        return 255
    return bearing(*vec)


def bearing(dx: float, dz: float) -> int:
    """Degrees from grid north (north is -z, east is +x), as a ridge direction: 0..179."""
    return int(round(math.degrees(math.atan2(dx, -dz)))) % 180


def parse_colour(v: str) -> tuple[int, int, int] | None:
    v = v.strip().lower()
    named = {"green": (0, 128, 0), "darkgreen": (0, 100, 0), "lightgreen": (144, 238, 144), "teal": (0, 128, 128)}
    if v in named:
        return named[v]
    m = re.fullmatch(r"#?([0-9a-f]{6})", v)
    if m:
        h = m.group(1)
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    m = re.fullmatch(r"#([0-9a-f]{3})", v)
    if m:
        return tuple(int(c * 2, 16) for c in m.group(1))  # type: ignore[return-value]
    return None


# ── neighbours ──────────────────────────────────────────────────────────────────────────────────────────────────
class Grid:
    """A uniform grid of 25 m cells holding indices, so neighbour tests are not quadratic."""

    def __init__(self):
        self.cells: dict[tuple[int, int], list[int]] = {}

    def add(self, i: int, x0: float, z0: float, x1: float, z1: float) -> None:
        for cx in range(int(math.floor(x0 / GRID)), int(math.floor(x1 / GRID)) + 1):
            for cz in range(int(math.floor(z0 / GRID)), int(math.floor(z1 / GRID)) + 1):
                self.cells.setdefault((cx, cz), []).append(i)

    def at(self, x: float, z: float) -> list[int]:
        return self.cells.get((int(math.floor(x / GRID)), int(math.floor(z / GRID))), [])


def outward(a: tuple, b: tuple, area: float) -> tuple[float, float]:
    """Unit outward normal of the edge a -> b of a ring whose shoelace area (x, z) is `area`."""
    dx, dz = b[0] - a[0], b[1] - a[1]
    l = math.hypot(dx, dz) or 1.0
    return (dz / l, -dx / l) if area > 0 else (-dz / l, dx / l)


def blind_edges(rings: list, groups: list, grid: Grid, i: int) -> list[int]:
    """Edges with no openings: at least two of the points at 1/4, 1/2, 3/4 of the edge, pushed 0.6 m outwards, lie
    inside a building ring of another building (parts of the same building do not count); edges under 1.2 m."""
    ring = rings[i]
    area = ring_area(ring)
    out = []
    for k, (a, b) in enumerate(ring_edges(ring)):
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        if length < 1.2:
            out.append(k)
            continue
        nx, nz = outward(a, b, area)
        hit = 0
        for t in (0.25, 0.5, 0.75):
            px, pz = a[0] + (b[0] - a[0]) * t + nx * 0.6, a[1] + (b[1] - a[1]) * t + nz * 0.6
            for j in grid.at(px, pz):
                if j != i and groups[j] != groups[i] and inside((px, pz), rings[j]):
                    hit += 1
                    break
        if hit >= 2:
            out.append(k)
    return out


def front_edges(ring: list, blind: list[int], roads: list) -> list[int]:
    """Edges that are not blind, at least 2.5 m long, whose midpoint is within `road width / 2 + 6` m of a road
    (not service, steps, path, corridor, not in a tunnel) and whose outward normal points towards that road."""
    area = ring_area(ring)
    out = []
    for k, (a, b) in enumerate(ring_edges(ring)):
        if k in blind or math.hypot(b[0] - a[0], b[1] - a[1]) < 2.5:
            continue
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        nx, nz = outward(a, b, area)
        for rd in roads:
            reach = rd["w"] / 2 + 6
            bx0, bz0, bx1, bz1 = rd["bbox"]
            if not (bx0 - reach <= mx <= bx1 + reach and bz0 - reach <= mz <= bz1 + reach):
                continue
            best = None
            for (p, q) in rd["segs"]:
                c = seg_nearest(mx, mz, p[0], p[1], q[0], q[1])
                d = math.hypot(c[0] - mx, c[1] - mz)
                if best is None or d < best[0]:
                    best = (d, c)
            if best and 1e-6 < best[0] <= reach:
                d, c = best
                if ((c[0] - mx) * nx + (c[1] - mz) * nz) / d > 0.3:
                    out.append(k)
                    break
    return out


def road_index(road_records: list) -> list[dict]:
    out = []
    for r in road_records:
        if r["k"] in NOT_FRONT or r.get("tn"):
            continue
        p = list(zip(r["p"][0::2], r["p"][1::2]))
        out.append({"w": r["w"], "segs": list(zip(p, p[1:])), "bbox": bbox(p)})
    return out


# ── the layer ───────────────────────────────────────────────────────────────────────────────────────────────────
def use_of(ft: dict, kind: str | None, pois: list) -> int:
    t = ft["tags"]
    if kind in USE_KIND[4]:
        return 4
    if kind in USE_KIND[2] or any(p["tags"] for p in pois):
        return 2
    for u in (3, 5, 7, 1):
        if kind in USE_KIND[u]:
            return u
    return 0


def poi_near(ring: list, pois_grid: Grid, pois: list) -> list:
    x0, z0, x1, z1 = bbox(ring)
    seen, out = set(), []
    for cx in range(int(math.floor((x0 - 3) / GRID)), int(math.floor((x1 + 3) / GRID)) + 1):
        for cz in range(int(math.floor((z0 - 3) / GRID)), int(math.floor((z1 + 3) / GRID)) + 1):
            for j in pois_grid.cells.get((cx, cz), []):
                if j in seen:
                    continue
                seen.add(j)
                p = pois[j]
                if inside((p["x"], p["z"]), ring) or min(seg_dist(p["x"], p["z"], a[0], a[1], b[0], b[1]) for a, b in ring_edges(ring)) <= 3.0:
                    out.append(p)
    return out


def build(ctx) -> dict:
    st = ctx.style
    storey = st.storey
    fts = ctx.features["buildings"]
    lm_found = landmark_rules.expand(ctx, fts)       # place landmark rules may add parts (the area the mapped parts leave)
    ids = assign_ids([ft["src"] for ft in fts])
    rings = [ft["ring"] for ft in fts]

    # building groups: an outline and its parts are one building; a lone part is its own
    outlines = [i for i, ft in enumerate(fts) if not ft["is_part"]]
    groups = list(range(len(fts)))
    for i, ft in enumerate(fts):
        if ft["is_part"]:
            for o in outlines:
                ox0, oz0, ox1, oz1 = bbox(rings[o])
                cx, cz = ft["centroid"]
                if ox0 <= cx <= ox1 and oz0 <= cz <= oz1 and inside(ft["centroid"], rings[o]):
                    groups[i] = o
                    break
    grid = Grid()
    for i, r in enumerate(rings):
        grid.add(i, *bbox(r))
    pois = ctx.features["pois"]
    pgrid = Grid()
    for j, p in enumerate(pois):
        pgrid.add(j, p["x"], p["z"], p["x"], p["z"])
    roads = road_index(ctx.layers.get("roads", []))
    have_surface = getattr(ctx, "surface_model", True)

    pitches = {"flat": 0, "low": 0, "steep": 0}
    stats = {"measured": 0, "roofShape": 0, "facade": 0, "blind": 0, "front": 0}
    buildings, parts, recs = [], [], {}
    for i, ft in enumerate(fts):
        t, ring, holes, kind, area = ft["tags"], ft["ring"], ft["holes"], ft["kind"], ft["area"]
        bid = ids[i]
        rnd = ctx.rng(bid)
        g = min(ctx.ground(p[0], p[1]) for p in ring)
        o = obb(ring)
        w_half = o["W"]
        blind = blind_edges(rings, groups, grid, i)
        front = front_edges(ring, blind, roads)
        near_pois = poi_near(ring, pgrid, pois)
        own_poi = bool(t.get("shop")) or t.get("amenity") in ("restaurant", "cafe", "bar", "pub", "fast_food", "bank", "pharmacy") \
            or t.get("tourism") in ("hotel", "museum")
        use = use_of(ft, kind, near_pois if not own_poi else near_pois + [{"tags": t}])
        use_name = USES[use]

        # height
        m = measure(ctx, ring, holes, g) if have_surface else None
        h_tag, lv_tag = num(t.get("height")), num(t.get("building:levels"))
        if h_tag is not None:
            h, hs = h_tag, "tag"
        elif m is not None:
            h, hs = m["top"], "measured"
        elif lv_tag is not None:
            h, hs = lv_tag * storey, "levels"
        else:
            hs = "rule"
            h = 18.0 if kind in TALL else 16.0 if kind in CIVIC else 3.0 if kind in SMALL else 15.0 if area > 1500 else 4.0 if area < 40 else 10.5
        h = max(2.0, h)
        rise = m["rise"] if m else None
        pitch = pitch_class(rise, w_half) if m else None
        if pitch:
            pitches[pitch] += 1
        if hs == "measured":
            stats["measured"] += 1

        # roof shape
        levels_est = int(lv_tag) if lv_tag is not None else max(1, round(h / storey))
        rule = st.rule_for({"building": kind or "yes", "use": use_name, "area": area, "levels": levels_est,
                            "attached": bool(blind), "pitch": pitch})
        # the draws are always made in the same order, so a tag never shifts the choices of another building
        shape_pick, mat_pick, facade_pick = pick(rule["roof"], rnd), pick(rule["roofMat"], rnd), pick(rule["facade"], rnd)
        pal_draw, rp_draw = rnd.random(), rnd.random()
        tagged_shape = SHAPE_TAG.get(str(t.get("roof:shape", "")).strip().lower())
        if tagged_shape is not None:
            rs = tagged_shape
        else:
            rs = ROOF_SHAPES.index(shape_pick)
            if len(ring) < 4 or area < 20:
                rs = 0
        if holes and rs not in (0, 2, 3):
            rs = 3
        if tagged_shape is None:
            stats["roofShape"] += 1

        # ridge direction
        rd = 255
        ro = str(t.get("roof:orientation", "")).strip().lower()
        direction = num(t.get("roof:direction"))
        if direction is not None:
            rd = int(round(direction + 90)) % 180     # OSM: the direction the roof faces; the ridge is across it
        elif ro == "along":
            rd = bearing(o["ux"], o["uz"])
        elif ro == "across":
            rd = bearing(-o["uz"], o["ux"])
        elif m is not None and rs in (1, 8, 5):
            rd = ridge_direction(m["samples"], o)

        # roof height
        rh_tag = num(t.get("roof:height"))
        if rs == 0:
            rh = 0.0
        elif rh_tag is not None:
            rh = rh_tag
        elif rs == 3:
            rh = min(rise or 3.2, 4.2)
        elif m is not None:
            rh = max(0.8, min(rise, 0.9 * h - 2.4))
        else:
            rh = min(max(w_half * math.tan(math.radians(st.pitch_deg(ROOF_SHAPES[rs]))), 1.2), 0.45 * h)
        rh = max(0.0, rh)
        eave_h = h - rh

        # levels
        lv = int(lv_tag) if lv_tag is not None else max(1, round(eave_h / storey))

        # façade and roof material
        fa = FACADE_TAG.get(str(t.get("building:material", "")).strip().lower())
        if fa is None:
            fa = FACADES.index(facade_pick)
        rmt = ROOFMAT_TAG.get(str(t.get("roof:material", "")).strip().lower())
        if rmt is None:
            rmt = ROOF_MATS.index(mat_pick)
        rc = parse_colour(t["roof:colour"]) if t.get("roof:colour") else None
        if rc and rc[1] > rc[0] and rc[1] > rc[2]:
            rmt = 2
        client = st.pack["client"]
        pal_list = client["palettes"].get(FACADES[fa]) or []
        rp_list = client["roofs"].get(ROOF_MATS[rmt]) or []
        pal = int(pal_draw * len(pal_list)) if pal_list else 0
        rp = int(rp_draw * len(rp_list)) if rp_list else 0
        stats["facade"] += 1

        gf = 1 if use == 2 and front else 2 if kind in ("garage", "garages", "carport") else 0
        # item 7: a road through the building is a passage; the building then has a flat roof, no shopfront, no street front
        gate = []
        for x1, z1, x2, z2, w, top in getattr(ctx, "passages", {}).get(ft["src"], []):
            rise = max(0.0, top - g)                        # the way climbs inside the footprint: the arch starts above its highest ground
            clear = min(0.7 * eave_h - rise, w + 1.0)
            if clear >= 2.2:
                gate.append([x1, z1, x2, z2, w, round(rise + clear, 1)])
        if gate:
            gf, front = 0, []
            if not ft["is_part"]:                       # a part keeps its measured roof: the passage runs under it
                rs, rh, rd = 0, 0.0, 255
        stats["blind"] += bool(blind)
        stats["front"] += bool(front)

        b = {"id": bid, "r": flat(ring), "g": round(g, 1), "h": round(h, 1), "hs": hs}
        if holes:
            b["holes"] = [flat(hh) for hh in holes]
        mh = num(t.get("min_height"))
        if mh is None and num(t.get("building:min_level")) is not None:
            mh = num(t.get("building:min_level")) * storey
        if mh:
            b["mh"] = round(mh, 1)
        if kind and kind != "yes":
            b["k"] = kind
        for src_key, key in (("roof:shape", "roof"), ("roof:colour", "rc"), ("roof:material", "rm"), ("building:colour", "col"),
                             ("building:material", "mat"), ("name", "n"), ("roof:orientation", "ro")):
            if t.get(src_key):
                b[key] = t[src_key]
        b.update({"rh": round(rh, 1), "rs": rs, "rd": rd, "rmt": rmt, "rp": rp, "fa": fa, "pal": pal, "use": use, "lv": lv})
        if blind:
            b["blind"] = blind
        if front:
            b["front"] = front
        b["gf"] = gf
        if gate:
            b["pass"] = gate
        (parts if ft["is_part"] else buildings).append(b)
        recs[i] = b

    parts += landmark_rules.finish(ctx, fts, recs, lm_found, set(ids))
    parts_mod.mark(buildings, parts)
    _rules(ctx, have_surface)
    ctx.stats = {"measured": stats["measured"], "roof_shape_from_style": stats["roofShape"], "facade": stats["facade"],
                 "with_blind_edges": stats["blind"], "with_front_edges": stats["front"], "records": len(fts), "pitch_classes": pitches,
                 "ridge_direction_measured": sum(1 for b in buildings + parts if b["rd"] != 255)}
    return {"buildings": buildings + parts}


def _rules(ctx, have_surface: bool) -> None:
    r = ctx.rules
    s = ctx.style.storey
    r["building_height"] = (
        "Height `h` is the top of the roof above `g`, the lowest ground at the footprint. In order: OSM height (`hs` tag); the "
        "measured height (`hs` measured): the 95th percentile of the HRDEM surface model minus `g` over a 1 m lattice inside the "
        "footprint, 1 m clear of its edges (on a narrow roof the fitted roof slope is carried to the footprint's inradius when "
        f"that is higher), kept when it lies between 3 and 150 m; building:levels × {s} m (levels); by kind: "
        "church/cathedral/chapel 18 m, hotel/civic/school/university/government/public 16 m, garage/shed/hut/roof/kiosk 3 m, "
        "footprint over 1500 m² 15 m, under 40 m² 4 m, otherwise 10.5 m (rule)."
        + ("" if have_surface else " No surface model covered this place, so nothing was measured."))
    r["roof"] = "OSM roof:shape where tagged; otherwise the style pack picks `rs` by weight, seeded by the building id."
    r["roof_shape"] = ("Roof shape: a tagged roof:shape wins; else the first rule of the style pack that matches the building kind, "
                       "use, area, storeys, attached walls and measured roof pitch (flat, low or steep, from the rise of the roof "
                       "against the half width of the footprint) picks by weight. Under 4 vertices or 20 m²: flat. A footprint "
                       "with a courtyard: flat, mansard or hipped.")
    r["ridge_direction"] = ("`rd` is a bearing 0-179 from grid north: roof:direction (+90°: OSM gives the way the roof faces) or "
                            "roof:orientation where tagged; else, for a measured gabled, gambrel or skillion roof, the axis of "
                            "the oriented footprint along which the roof stays level, when height and distance from that "
                            "axis correlate below -0.3; otherwise 255 (along the longest side).")
    r["roof_height"] = ("`rh` is the roof above the eave: roof:height where tagged; else the measured rise: the ridge minus the eave, "
                        "the eave being a straight line fitted to the surface height against the distance to the nearest wall "
                        "(samples 1 to 4 m in, outliers dropped) and read at the wall, at least 2.2 m above ground and at most "
                        "0.5 m above the 20th percentile of the roof; clamped to 0.8 m and 0.9 h - 2.4 m; a roof whose fit rises "
                        "less than 0.08 m per m and whose rise is under 0.8 m is flat (0). Mansard 3.2 m when not measured, at "
                        "most 4.2 m; else half the footprint width × tan of the style's pitch, between 1.2 m and 0.45 h.")
    r["levels"] = f"`lv` is building:levels where tagged, else the eave height divided by the style's storey height ({s} m), at least 1."
    r["facade"] = ("`fa` and `rmt`: building:material and roof:material where tagged (a green roof:colour means copper); else the "
                   "style pack's weighted pick. `pal` and `rp` are seeded picks within the style's colour list; the town is "
                   "the same on every build.")
    r["use"] = ("`use`: from the building kind, or retail/food/hotel/museum points of interest inside the footprint or within "
                "3 m of it (commercial).")
    r["blind_edges"] = ("`blind` lists the edges of a footprint with no openings: at least two of the points at a quarter, half and "
                        "three quarters of the edge, 0.6 m outwards, lie inside another building; edges under 1.2 m.")
    r["front_edges"] = ("`front` lists the edges that face a street: not blind, 2.5 m or more, within half a road width + 6 m of "
                        "a road (not service, steps, path, corridor or tunnel) with the outward normal pointing at it. `gf` is 1 "
                        "for a commercial building with a front edge, 2 for garages.")
    r["building_id"] = "`id`: FNV-1a 32 of \"<osm type>/<osm id>/<ring index>\", +1 on a clash, never 0."
