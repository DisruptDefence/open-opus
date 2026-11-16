"""Ground layers: roads and paths, squares (highway areas), green areas, water; and (item 6 of
docs/plans/SCENE-DETAIL.md) their surface class `sf`, sidewalks `sw`, steps `sc`/`hr`, lighting `lit`, markings
`mk`, the `crossings` layer and the `bare` ground (steep banks and rock) written into `areas`."""
from __future__ import annotations

import math

from .geom import flat, inside, num, seg_dist
from .style import SURFACES

ROAD_WIDTH = {
    "primary": 10, "primary_link": 8, "secondary": 9, "secondary_link": 7, "tertiary": 8, "tertiary_link": 7,
    "residential": 7, "unclassified": 7, "living_street": 6, "service": 4, "pedestrian": 6, "footway": 2.6,
    "path": 2, "steps": 3, "cycleway": 2.5, "track": 3, "corridor": 2,
}

# OSM `surface` words -> the surface enum of docs/SCENE-FORMAT.md 4.1 (SURFACES in style.py)
SURFACE_WORDS = {
    "asphalt": 1, "concrete": 2, "concrete:plates": 2, "concrete:lanes": 2, "sett": 3, "cobblestone": 3,
    "unhewn_cobblestone": 3, "paving_stones": 4, "paved": 4, "bricks": 4, "fine_gravel": 5, "gravel": 5, "compacted": 5,
    "pebblestone": 5, "dirt": 6, "ground": 6, "earth": 6, "mud": 6, "grass": 7, "sand": 8, "rock": 9, "wood": 12,
    "metal": 13, "metal_grid": 13,
}
NO_SIDEWALK_WORDS = {"no", "none", "separate"}
YES_SIDEWALK_WORDS = {"yes", "both", "left", "right"}
VEHICLE = {"primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "residential",
           "unclassified", "living_street", "service"}
MARKED = {"primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link"}
CELL = 5.0  # bare ground is decided on 5 m cells


def surface_class(t: dict, hw: str, street: dict) -> int:
    word = (t.get("surface") or "").lower()
    if word in SURFACE_WORDS:
        return SURFACE_WORDS[word]
    name = street.get("surface", {}).get(hw)
    return SURFACES.index(name) if name in SURFACES else 1


def sidewalk_side(t: dict, hw: str, street: dict) -> str | None:
    """The tagged sidewalks of a road: "both", "left", "right", "no", or None when nothing is tagged."""
    side = {}
    for k, key in (("both", "sidewalk:both"), ("left", "sidewalk:left"), ("right", "sidewalk:right")):
        v = (t.get(key) or "").lower()
        if v:
            side[k] = v
    whole = (t.get("sidewalk") or "").lower()
    if whole in NO_SIDEWALK_WORDS:
        return "no"
    if whole in ("both", "left", "right"):
        return whole
    if whole == "yes":
        return "both"
    b = side.get("both")
    if b in NO_SIDEWALK_WORDS:
        return "no"
    if b in YES_SIDEWALK_WORDS:
        return "both"
    left = side.get("left") in YES_SIDEWALK_WORDS
    right = side.get("right") in YES_SIDEWALK_WORDS
    if left or right:
        return "both" if left and right else ("left" if left else "right")
    if side.get("left") in NO_SIDEWALK_WORDS or side.get("right") in NO_SIDEWALK_WORDS:
        return "no"
    return None


def has_parallel_sidewalk(pts, others: dict, reach: float = 6.0) -> bool:
    """True when most of a road lies within `reach` of a mapped footway=sidewalk way (`others` is a bucket grid)."""
    n = hit = 0
    for a, b in zip(pts, pts[1:]):
        ln = math.hypot(b[0] - a[0], b[1] - a[1])
        for k in range(max(1, int(ln // 3))):
            q = (a[0] + (b[0] - a[0]) * (k + 0.5) / max(1, int(ln // 3)), a[1] + (b[1] - a[1]) * (k + 0.5) / max(1, int(ln // 3)))
            n += 1
            gx, gz = int(q[0] // 8), int(q[1] // 8)
            if any(seg_dist(q[0], q[1], *s) <= reach for dx in (-1, 0, 1) for dz in (-1, 0, 1) for s in others.get((gx + dx, gz + dz), ())):
                hit += 1
    return n > 0 and hit * 2 > n


def sidewalk_grid(roads: list) -> dict:
    grid: dict = {}
    for rd in roads:
        if rd["tags"].get("footway") != "sidewalk":
            continue
        for a, b in zip(rd["pts"], rd["pts"][1:]):
            seg = (a[0], a[1], b[0], b[1])
            for gx in range(int(min(a[0], b[0]) // 8), int(max(a[0], b[0]) // 8) + 1):
                for gz in range(int(min(a[1], b[1]) // 8), int(max(a[1], b[1]) // 8) + 1):
                    grid.setdefault((gx, gz), []).append(seg)
    return grid


def crossing_surface(rd: dict, vehicle: list) -> int | None:
    """The surface class of the street a footway=crossing way crosses (its midpoint within 1.5 m of the carriageway), or None."""
    pts = rd["pts"]
    mid = pts[len(pts) // 2]
    for v in vehicle:
        half = (num(v["tags"].get("width")) or ROAD_WIDTH[v["tags"]["highway"]]) / 2 + 1.5
        if any(seg_dist(mid[0], mid[1], a[0], a[1], b[0], b[1]) <= half for a, b in zip(v["pts"], v["pts"][1:])):
            return v["sf"]
    return None


def step_record(t: dict, pts, ground) -> dict:
    out = {}
    try:
        count = int(float(t.get("step_count")))
    except (TypeError, ValueError):
        rise = abs(ground(*pts[0]) - ground(*pts[-1]))
        count = max(2, round(rise / 0.17))
    out["sc"] = max(2, count)
    hr = 0
    if (t.get("handrail:center") or "") == "yes":
        hr = 2
    elif any((t.get(k) or "") == "yes" for k in ("handrail", "handrail:both", "handrail:left", "handrail:right")):
        hr = 1
    if hr:
        out["hr"] = hr
    return out


def crossing_records(ctx) -> list:
    """highway=crossing nodes snapped (1.5 m) to the nearest vertex or segment of a road a vehicle can drive: [x, z, bearing, width]."""
    roads = [r for r in ctx.features["roads"] if r["tags"]["highway"] in VEHICLE and r["tags"].get("footway") != "sidewalk"]
    grid: dict = {}
    for ri, rd in enumerate(roads):
        for a, b in zip(rd["pts"], rd["pts"][1:]):
            for gx in range(int((min(a[0], b[0]) - 2) // 8), int((max(a[0], b[0]) + 2) // 8) + 1):
                for gz in range(int((min(a[1], b[1]) - 2) // 8), int((max(a[1], b[1]) + 2) // 8) + 1):
                    grid.setdefault((gx, gz), []).append((ri, a, b))
    out, seen = [], set()
    for c in ctx.features["crossings"]:
        best = None
        for ri, a, b in grid.get((int(c["x"] // 8), int(c["z"] // 8)), ()):
            d = seg_dist(c["x"], c["z"], a[0], a[1], b[0], b[1])
            if d <= 1.5 and (best is None or d < best[0]):
                best = (d, ri, a, b)
        if not best:
            continue
        _, ri, a, b = best
        dx, dz = b[0] - a[0], b[1] - a[1]
        bearing = int(round(math.degrees(math.atan2(dx, -dz)))) % 180
        t = roads[ri]["tags"]
        w = round(num(t.get("width")) or ROAD_WIDTH[t["highway"]], 1)
        key = (round(c["x"]), round(c["z"]))
        if key in seen:
            continue
        seen.add(key)
        out.append([round(c["x"], 1), round(c["z"], 1), bearing, w])
    return out


def bare_areas(ctx, roads: list) -> list:
    """Ground nothing covers and that is steep: rock above slope 0.6, a grassy bank from 0.25 (outside any green)."""
    ext = ctx.ext
    x0, z0 = ext["minX"], ext["minZ"]
    nx, nz = int((ext["maxX"] - x0) // CELL), int((ext["maxZ"] - z0) // CELL)
    covered = bytearray(nx * nz)
    green = bytearray(nx * nz)

    def cells_in(box, pad=0.0):
        for j in range(max(0, int((box[2] - pad - z0) // CELL)), min(nz, int((box[3] + pad - z0) // CELL) + 1)):
            for i in range(max(0, int((box[0] - pad - x0) // CELL)), min(nx, int((box[1] + pad - x0) // CELL) + 1)):
                yield i, j, x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL

    def paint(target, ring, holes=()):
        xs, zs = [p[0] for p in ring], [p[1] for p in ring]
        for i, j, x, z in cells_in((min(xs), max(xs), min(zs), max(zs))):
            if inside((x, z), ring) and not any(inside((x, z), h) for h in holes):
                target[j * nx + i] = 1

    for b in ctx.features["buildings"]:
        paint(covered, b["ring"], b["holes"])
    for a in ctx.features["areas"]:
        paint(covered, a["ring"], a["holes"])
    for w in ctx.features["water"]:
        paint(covered, w["ring"])
    for g in ctx.features["green"]:
        paint(green, g["ring"], g["holes"])
    for rd in roads:
        half = round(num(rd["tags"].get("width")) or ROAD_WIDTH[rd["tags"]["highway"]], 1) / 2 + 1.0
        for a, b in zip(rd["pts"], rd["pts"][1:]):
            for i, j, x, z in cells_in((min(a[0], b[0]), max(a[0], b[0]), min(a[1], b[1]), max(a[1], b[1])), half + CELL):
                if seg_dist(x, z, a[0], a[1], b[0], b[1]) <= half + CELL * 0.5:
                    covered[j * nx + i] = 1
    kind = bytearray(nx * nz)  # 0 none, 1 rock, 2 grass
    for j in range(nz):
        for i in range(nx):
            if covered[j * nx + i]:
                continue
            x, z = x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL
            if ctx.ground(x, z) < 0.8:
                continue
            h = 2.5
            sx = (ctx.ground(x + h, z) - ctx.ground(x - h, z)) / (2 * h)
            sz = (ctx.ground(x, z + h) - ctx.ground(x, z - h)) / (2 * h)
            slope = math.hypot(sx, sz)
            if slope > 0.6:
                kind[j * nx + i] = 1
            elif slope >= 0.25 and not green[j * nx + i]:
                kind[j * nx + i] = 2
    out, used = [], bytearray(nx * nz)
    for j in range(nz):
        i = 0
        while i < nx:
            k = kind[j * nx + i]
            if not k or used[j * nx + i]:
                i += 1
                continue
            i1 = i
            while i1 + 1 < nx and kind[j * nx + i1 + 1] == k and not used[j * nx + i1 + 1]:
                i1 += 1
            j1 = j
            while j1 + 1 < nz and all(kind[(j1 + 1) * nx + q] == k and not used[(j1 + 1) * nx + q] for q in range(i, i1 + 1)):
                j1 += 1
            for jj in range(j, j1 + 1):
                for q in range(i, i1 + 1):
                    used[jj * nx + q] = 1
            ax, bx, az, bz = round(x0 + i * CELL, 1), round(x0 + (i1 + 1) * CELL, 1), round(z0 + j * CELL, 1), round(z0 + (j1 + 1) * CELL, 1)
            out.append({"r": [ax, az, bx, az, bx, bz, ax, bz], "k": "bare", "s": "rock" if k == 1 else "grass"})
            i = i1 + 1
    return out


def build(ctx) -> dict:
    f = ctx.features
    ctx.rules["road_width"] = "OSM width, else by class (ROAD_WIDTH in tools/scene_builder/ground.py)."
    ctx.rules["water"] = ("OSM water polygons that close inside the data box; the river level is y = 0 (terrain cells under "
                          "0.8 m are river in HRDEM here).")
    street = ctx.style.pack.get("street", {})
    sw_on = set(street.get("sidewalk", {}).get("on", []))
    ctx.rules["surface_class"] = ("`sf` is the OSM `surface` word mapped to the format's surface class (SURFACE_WORDS in "
                                  "tools/scene_builder/ground.py), else the style pack's street.surface for the road class, else asphalt.")
    ctx.rules["sidewalks"] = ("`sw`: none where tagged sidewalk=no|none|separate or where a mapped footway=sidewalk way runs within 6 m "
                              "along most of the road; the tagged side where tagged; else both for the classes in the style pack's "
                              "street.sidewalk.on, else none.")
    ctx.rules["steps"] = "`sc` step_count where tagged, else round(rise / 0.17) and at least 2; `hr` from handrail*= tags (0 none, 1 both sides, 2 centre)."
    ctx.rules["markings"] = "`mk` = 1 (centre line) on primary, secondary and tertiary roads with an asphalt surface; `lit` from lit=yes."
    ctx.rules["crossings"] = "highway=crossing nodes snapped to the nearest road vertex or segment within 1.5 m, [x, z, bearing, road width]; others dropped."
    ctx.rules["bare_ground"] = ("Ground no road, area, building or water covers, on 5 m cells: slope over 0.6 (rise over run, terrain model) "
                                "is rock, 0.25 to 0.6 outside any green is a grassy bank; merged into rectangles in `areas` with k 'bare'.")
    side_grid = sidewalk_grid(f["roads"])
    ctx.rules["crossing_ways"] = ("A footway=crossing way takes the surface class of the street it crosses, so the street stays one surface; "
                                  "the `crossings` layer draws the zebra.")
    vehicle = [{"pts": rd["pts"], "tags": rd["tags"], "sf": surface_class(rd["tags"], rd["tags"]["highway"], street)}
               for rd in f["roads"] if rd["tags"]["highway"] in VEHICLE and rd["tags"].get("footway") != "sidewalk"]
    roads = []
    for rd in f["roads"]:
        t, hw = rd["tags"], rd["tags"]["highway"]
        r = {"p": flat(rd["pts"]), "k": hw, "w": round(num(t.get("width")) or ROAD_WIDTH[hw], 1)}
        for src_key, key in (("name", "n"), ("surface", "s"), ("bridge", "br"), ("tunnel", "tn"), ("covered", "cv")):
            if t.get(src_key):
                r[key] = t[src_key]
        r["sf"] = surface_class(t, hw, street)
        if t.get("footway") == "crossing" and hw not in VEHICLE:
            r["sf"] = crossing_surface(rd, vehicle) or r["sf"]
        if hw in sw_on and t.get("footway") != "sidewalk":
            side = sidewalk_side(t, hw, street)
            if side is None:
                side = "no" if has_parallel_sidewalk(rd["pts"], side_grid) else "both"
            elif side != "no" and has_parallel_sidewalk(rd["pts"], side_grid):
                side = "no"
            if side != "no":
                r["sw"] = side
        if hw == "steps":
            r.update(step_record(t, rd["pts"], ctx.ground))
        if (t.get("lit") or "") == "yes":
            r["lit"] = 1
        if hw in MARKED and r["sf"] == 1:
            r["mk"] = 1
        roads.append(r)
    areas = []
    for a in f["areas"]:
        rec = {"r": flat(a["ring"]), "k": a["tags"]["highway"], "s": a["tags"].get("surface", "")}
        if a["holes"]:
            rec["holes"] = [flat(h) for h in a["holes"]]
        if a["tags"].get("name"):
            rec["n"] = a["tags"]["name"]
        areas.append(rec)
    areas.extend(bare_areas(ctx, f["roads"]))
    green = []
    for g in f["green"]:
        rec = {"r": flat(g["ring"]), "k": g["kind"]}
        if g["holes"]:
            rec["holes"] = [flat(h) for h in g["holes"]]
        if g["tags"].get("name"):
            rec["n"] = g["tags"]["name"]
        green.append(rec)
    water = [{"r": flat(w["ring"]), "n": w["tags"].get("name", "")} for w in f["water"]]
    out = {"water": {"level": 0.0, "polygons": water}, "roads": roads, "areas": areas, "green": green}
    crossings = crossing_records(ctx)
    if crossings:
        out["crossings"] = crossings
    return out
