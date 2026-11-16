"""Street furniture as a prop layer: item 8 of docs/plans/SCENE-DETAIL.md (the kinds the landmark rules and the terraces need; the
rest of the plan's table waits). Mapped nodes (and round shelters, as pavilions) whose `key=value` is in the style pack's `props`
become items with source 0; the lamps a terrace rule asks for, source 1. A place's landmark rule may name a node by `match` and give it
a `prop` (kind, variant) of its own: that is how one monument is a tall one while the rest are plain plinths."""
from __future__ import annotations

import math

from .geom import centroid, ring_area

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
    rules = ctx.rules
    if items:
        rules["props"] = ("Props: OSM nodes whose key=value is in the style pack's `props` (and shelters with a round footprint, as open pavilions) become "
                          "prop items (source 0); direction from the `direction` tag, benches face the nearest terrace balustrade within 14 m; "
                          f"terrace lamps (source 1) stand on the rail line every rule spacing. {sum(1 for i in items if i[5])} items are placed by rule.")
    return {"props": {"kinds": kinds, "items": items}} if items else {}
