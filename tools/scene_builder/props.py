"""Street furniture as a prop layer: item 8 of docs/plans/SCENE-DETAIL.md (the kinds the landmark rules and the terraces need; the
rest of the plan's table waits). Mapped nodes (and round shelters, as pavilions) whose `key=value` is in the style pack's `props`
become items with source 0; the lamps a terrace rule asks for, source 1. A place's landmark rule may name a node by `match` and give it
a `prop` (kind, variant) of its own: that is how one monument is a tall one while the rest are plain plinths."""
from __future__ import annotations

import math

from .geom import centroid, inside, num, ring_area, seg_dist
from .ground import ROAD_WIDTH

BUILT = {"bench_slat", "lamp_lantern", "bollard_iron", "cannon", "flagpole", "plinth", "monument_tall", "pavilion", "planter"}
COMPASS = {"N": 0, "NNE": 22.5, "NE": 45, "ENE": 67.5, "E": 90, "ESE": 112.5, "SE": 135, "SSE": 157.5, "S": 180, "SSW": 202.5,
           "SW": 225, "WSW": 247.5, "W": 270, "WNW": 292.5, "NW": 315, "NNW": 337.5}


def direction(tags: dict) -> float | None:
    d = str(tags.get("direction", "")).strip().upper()
    if d in COMPASS:
        return float(COMPASS[d])
    try:
        return float(d) % 360
    except ValueError:
        return None


def kind_for(tags: dict, table: dict) -> str | None:
    for k, v in tags.items():
        kind = table.get(f"{k}={v}")
        if kind:
            return kind
    return None


def _rule_prop(ctx, tags: dict):
    pl = getattr(ctx, "place", None)
    for r in (getattr(pl, "raw", None) or {}).get("landmarks") or []:
        m = r.get("match") or {}
        if r.get("prop") and m and all(tags.get(k) == v for k, v in m.items() if k != "osm"):
            return r["prop"]
    return None


def facing_nearest(edges: list, x: float, z: float, within: float) -> float | None:
    """Bearing from (x, z) to the nearest point of the polylines `edges`, when within `within` m."""
    best = None
    for line in edges:
        for a, b in zip(line, line[1:]):
            dx, dz = b[0] - a[0], b[1] - a[1]
            l2 = dx * dx + dz * dz
            t = 0.0 if l2 < 1e-9 else max(0.0, min(1.0, ((x - a[0]) * dx + (z - a[1]) * dz) / l2))
            px, pz = a[0] + t * dx, a[1] + t * dz
            d = math.hypot(px - x, pz - z)
            if d <= within and (best is None or d < best[0]):
                best = (d, px, pz)
    return None if best is None else math.degrees(math.atan2(best[1] - x, -(best[2] - z))) % 360


def _footprints(ctx) -> dict:
    """Building footprints (not parts) on an 16 m bucket grid by bounding box: cell -> [(ring, holes)]."""
    grid: dict = {}
    for b in (getattr(ctx, "features", None) or {}).get("buildings", []):
        if b.get("is_part"):
            continue
        ring = b["ring"]
        xs, zs = [p[0] for p in ring], [p[1] for p in ring]
        for gx in range(int((min(xs) - 0.5) // 16), int((max(xs) + 0.5) // 16) + 1):
            for gz in range(int((min(zs) - 0.5) // 16), int((max(zs) + 0.5) // 16) + 1):
                grid.setdefault((gx, gz), []).append((ring, b.get("holes") or []))
    return grid


def _in_building(grid: dict, x: float, z: float, clear: float = 0.4) -> bool:
    for ring, holes in grid.get((int(x // 16), int(z // 16)), ()):
        if any(seg_dist(x, z, *ring[i - 1], *ring[i]) < clear for i in range(len(ring))):
            return True
        if inside((x, z), ring) and not any(inside((x, z), h) for h in holes):
            return True
    return False


def street_lamp_sites(roads: list, cfg: dict):
    """Candidate lamps by street rule: yields (first side (x, z), other side (x, z), bearing) at each position along each road."""
    spacing, offset, stagger = float(cfg["spacing"]), float(cfg.get("offset", 0.6)), bool(cfg.get("stagger", True))
    on = set(cfg.get("on", []))
    for idx, rd in enumerate(roads):
        t = rd["tags"]
        hw = t.get("highway")
        if hw not in on or hw == "steps" or t.get("footway") == "sidewalk":
            continue
        if (t.get("tunnel") or "no") != "no" or (t.get("bridge") or "no") != "no":
            continue
        pts = rd["pts"]
        total = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))
        if total < spacing / 2:
            continue
        rid = (rd.get("src") or (0, idx))[1]
        half = round(num(t.get("width")) or ROAD_WIDTH[hw], 1) / 2 + offset
        want, k, run = spacing / 2, 0, 0.0
        for a, b in zip(pts, pts[1:]):
            ln = math.hypot(b[0] - a[0], b[1] - a[1])
            while ln > 0 and want <= run + ln + 1e-9:
                if ln >= 4.0:
                    f = (want - run) / ln
                    px, pz = a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
                    tx, tz = (b[0] - a[0]) / ln, (b[1] - a[1]) / ln
                    nx, nz = tz, -tx                      # left of travel (north is -z, so travelling north the left is west)
                    sgn = 1 if not stagger else (1 if (rid + k) % 2 == 0 else -1)
                    bearing = math.degrees(math.atan2(tx, -tz)) % 360
                    yield ((px + nx * half * sgn, pz + nz * half * sgn), (px - nx * half * sgn, pz - nz * half * sgn), bearing)
                k += 1
                want += spacing
            run += ln


def street_lamps(ctx, items: list, kinds: list, add_item) -> None:
    cfg = ctx.style.pack.get("street", {}).get("lamps")
    if not cfg or not cfg.get("spacing"):
        return
    kind = cfg.get("kind")
    spacing, offset = float(cfg["spacing"]), float(cfg.get("offset", 0.6))
    if kind not in BUILT:
        ctx.rules["street_lamps"] = f"Street lamps by rule: the style pack's street.lamps kind `{kind}` is not built, so none are placed."
        return
    ext = ctx.ext
    grid = _footprints(ctx)
    near = {}

    def lamp_pos():
        return [(i[1], i[2]) for i in items if kinds[i[0]].startswith("lamp_")]

    def key(x, z):
        return int(x // 16), int(z // 16)

    for x, z in lamp_pos():
        near.setdefault(key(x, z), []).append((x, z))
    gap = spacing * 0.4

    def crowded(x, z):
        gx, gz = key(x, z)
        return any(math.hypot(x - qx, z - qz) < gap for dx in (-2, -1, 0, 1, 2) for dz in (-2, -1, 0, 1, 2)
                   for qx, qz in near.get((gx + dx, gz + dz), ()))

    placed = d_build = d_close = d_out = 0
    roads = (getattr(ctx, "features", None) or {}).get("roads", [])
    for first, other, bearing in street_lamp_sites(roads, cfg):
        pick = None
        for cand in (first, other):
            x, z = cand
            if not (ext["minX"] <= x <= ext["maxX"] and ext["minZ"] <= z <= ext["maxZ"]):
                d_out += 1
                pick = None
                break
            if _in_building(grid, x, z):
                pick = "b"
                continue
            pick = cand
            break
        if pick is None:
            continue
        if pick == "b":
            d_build += 1
            continue
        if crowded(*pick):
            d_close += 1
            continue
        add_item(kind, pick[0], pick[1], bearing, 0, 2)
        near.setdefault(key(*pick), []).append(pick)
        placed += 1
    ctx.rules["street_lamps"] = (f"Street lamps by rule (source 2): every {spacing:g} m along each road of the style pack's street.lamps `on` classes "
                                 f"(not tunnels, bridges or steps), {offset:g} m behind the kerb line, alternating sides when `stagger`; a lamp inside a "
                                 f"building footprint (or within 0.4 m of it) moves to the other side once; none within {gap:g} m of another lamp. "
                                 f"{placed} placed, dropped: {d_build} inside a building, {d_close} too close to another lamp, {d_out} outside the extent.")


def build(ctx) -> dict:
    table = ctx.style.pack.get("props", {})
    ext, edges = ctx.ext, getattr(ctx, "terrace_edges", [])
    kinds: list[str] = []
    items: list[list] = []

    def add(kind, x, z, yaw, variant, source):
        if kind not in BUILT or not (ext["minX"] <= x <= ext["maxX"] and ext["minZ"] <= z <= ext["maxZ"]):
            return
        if kind not in kinds:
            kinds.append(kind)
        items.append([kinds.index(kind), round(x, 1), round(z, 1), int(round(yaw)) % 360, variant, source])

    for el in ctx.osm:
        t = el.get("tags") or {}
        if not t:
            continue
        if el["type"] == "node" and "lat" in el:
            x, z = ctx.game(el["lat"], el["lon"])
            rp = _rule_prop(ctx, t)
            kind = rp["kind"] if rp else kind_for(t, table)
            if not kind:
                continue
            yaw = direction(t)
            if yaw is None and kind == "bench_slat":
                yaw = facing_nearest(edges, x, z, 14.0)
            if yaw is None:
                yaw = (ctx.rng(int(abs(x * 31 + z * 17)) + 1).random() * 360) if kind == "flagpole" else 0.0
            variant = int(rp.get("variant", 0)) if rp else (1 if t.get("colour") == "brown" else 0)
            if kind == "flagpole":
                variant = int(abs(x * 7 + z * 3)) % 4
            add(kind, x, z, yaw, variant, 0)
        elif el["type"] == "way" and t.get("amenity") == "shelter" and len(el.get("geometry") or []) >= 8 and el["geometry"][0] == el["geometry"][-1]:
            pts = [ctx.game(g["lat"], g["lon"]) for g in el["geometry"] if g]
            c = centroid(pts)
            r = sum(math.hypot(p[0] - c[0], p[1] - c[1]) for p in pts) / len(pts)
            if 2.0 <= r <= 7.0 and abs(ring_area(pts)) > 10:
                add("pavilion", c[0], c[1], 0.0, int(round(r * 2)), 0)
    for kind, x, z, bearing in getattr(ctx, "terrace_lamps", []):
        add(kind, x, z, bearing, 0, 1)
    street_lamps(ctx, items, kinds, add)
    rules = ctx.rules
    if items:
        rules["props"] = ("Props: OSM nodes whose key=value is in the style pack's `props` (and shelters with a round footprint, as open pavilions) become "
                          "prop items (source 0); direction from the `direction` tag, benches face the nearest terrace balustrade within 14 m; "
                          f"terrace lamps (source 1) stand on the rail line every rule spacing, street lamps (source 2) along the roads. {sum(1 for i in items if i[5])} items are placed by rule.")
    return {"props": {"kinds": kinds, "items": items}} if items else {}
