"""Trees: mapped `natural=tree` nodes (source 0) and, when the style pack has `trees.fill`, trees placed by seeded rules:
`tree_row` ways (1), woods and scrub (2), parks, gardens, cemeteries and grass (3), steep unbuilt ground (4), street trees (5).

A record is `[x, z, height, crownRadius, kind, form, source]` (docs/SCENE-FORMAT.md 4.5). Without `trees.fill` a style places no
rule trees and the mapped nodes keep the old short record `[x, z]`. Every amount (densities, spacing, sizes, species weights) is
style data; every seed is fixed, so a rebuild from one extract is byte-identical. Height and crown come from the measured canopy
(`dsm - dtm`) where there is one and no building is near, else from the style's size table by kind; ±15 % seeded variation."""
from __future__ import annotations

import math

from .geom import inside, num, seg_dist
from .style import pick

KINDS = {"broadleaf": 1, "conifer": 2, "palm": 3, "shrub": 4, "dead": 5}
FORMS = {"round": 0, "vase": 1, "column": 2, "cone": 3, "spreading": 4}
SRC_MAPPED, SRC_ROW, SRC_WOOD, SRC_PARK, SRC_SLOPE, SRC_STREET = 0, 1, 2, 3, 4, 5
WOOD_KINDS = {"wood": "wood", "forest": "wood", "scrub": "scrub"}
PARK_KINDS = {"park", "garden", "cemetery", "grass", "village_green"}
VERGE_KINDS = {"grass", "village_green", "park", "garden"}
CELL = 5.0       # the bare-ground cell of ground.py
DEFAULTS = {"max": 4000, "rowSpacing": 8, "woodDensity": 1.2, "scrubDensity": 0.5, "parkDensity": 0.35, "slopeMin": 0.45,
            "slopeDensity": 0.8, "slopeScale": 0.7, "streetOn": [], "streetMinSidewalk": 2.2, "streetSpacing": 14,
            "streetOffset": 0.8, "minGap": 1.8}
G = 16.0         # bucket size of the spatial grids, metres


class Grid:
    def __init__(self):
        self.c: dict = {}

    def add(self, item, x0: float, z0: float, x1: float, z1: float, pad: float) -> None:
        for gx in range(int((x0 - pad) // G), int((x1 + pad) // G) + 1):
            for gz in range(int((z0 - pad) // G), int((z1 + pad) // G) + 1):
                self.c.setdefault((gx, gz), []).append(item)

    def at(self, x: float, z: float):
        return self.c.get((int(x // G), int(z // G)), ())


def _ring_dist(x: float, z: float, ring) -> float:
    return min(seg_dist(x, z, *ring[i - 1], *ring[i]) for i in range(len(ring)))


class Ground:
    """What a tree may not stand on or against: buildings, roads and their sidewalks, water, squares, walls, props."""

    def __init__(self, ctx, roads_out: list):
        f = ctx.features
        self.ctx = ctx
        self.sw_w = float(ctx.style.pack.get("street", {}).get("sidewalk", {}).get("width", 1.6))
        self.buildings, self.water, self.paved, self.segs, self.walls, self.props = Grid(), Grid(), Grid(), Grid(), Grid(), Grid()
        for b in f.get("buildings", []):
            if b.get("is_part"):
                continue
            xs, zs = [p[0] for p in b["ring"]], [p[1] for p in b["ring"]]
            self.buildings.add((b["ring"], b.get("holes") or []), min(xs), min(zs), max(xs), max(zs), 8)
        for w in f.get("water", []):
            xs, zs = [p[0] for p in w["ring"]], [p[1] for p in w["ring"]]
            self.water.add(w["ring"], min(xs), min(zs), max(xs), max(zs), 0)
        for a in f.get("areas", []):
            xs, zs = [p[0] for p in a["ring"]], [p[1] for p in a["ring"]]
            self.paved.add((a["ring"], a.get("holes") or []), min(xs), min(zs), max(xs), max(zs), 0)
        for i, rd in enumerate(f.get("roads", [])):
            t = rd["tags"]
            if (t.get("tunnel") or "no") != "no":
                continue
            rec = roads_out[i] if i < len(roads_out) else {}
            sw = rec.get("sw")
            reach = float(rec.get("w") or num(t.get("width")) or 3.0) / 2 + (self.sw_w if sw in ("both", "left", "right") else 0.0)
            vehicle = t.get("highway") in ("primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link",
                                           "residential", "unclassified", "living_street", "service")
            for a, b in zip(rd["pts"], rd["pts"][1:]):
                self.segs.add((a[0], a[1], b[0], b[1], reach, i, vehicle, sw == "self"), min(a[0], b[0]), min(a[1], b[1]),
                              max(a[0], b[0]), max(a[1], b[1]), reach + 8)
        for w in f.get("walls", []):
            for a, b in zip(w["pts"], w["pts"][1:]):
                self.walls.add((a[0], a[1], b[0], b[1]), min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1]), 2)
        for it in (getattr(ctx, "layers", {}).get("props") or {}).get("items", []):
            self.props.add((it[1], it[2]), it[1], it[2], it[1], it[2], 4)
        kinds = (getattr(ctx, "layers", {}).get("props") or {}).get("kinds", [])
        self.lamps = Grid()
        for it in (getattr(ctx, "layers", {}).get("props") or {}).get("items", []):
            if kinds[it[0]].startswith("lamp_"):
                self.lamps.add((it[1], it[2]), it[1], it[2], it[1], it[2], 4)

    def in_water(self, x: float, z: float) -> bool:
        if self.ctx.ground is not None and self.ctx.ground(x, z) < 0.8:
            return True
        return any(inside((x, z), r) for r in self.water.at(x, z))

    def on_square(self, x: float, z: float) -> bool:
        return any(inside((x, z), r) and not any(inside((x, z), h) for h in hs) for r, hs in self.paved.at(x, z))

    def building_dist(self, x: float, z: float, within: float) -> float:
        """0 inside a footprint, else the distance to the nearest one when under `within`, else `within`."""
        best = within
        for ring, holes in self.buildings.at(x, z):
            if inside((x, z), ring) and not any(inside((x, z), h) for h in holes):
                return 0.0
            best = min(best, _ring_dist(x, z, ring))
        return best

    def road_hit(self, x: float, z: float, clear: float, skip: int | None = None, vehicle_extra: float = 0.0) -> bool:
        for ax, az, bx, bz, reach, i, vehicle, own_sw in self.segs.at(x, z):
            if i == skip:
                continue
            extra = vehicle_extra if (vehicle and not own_sw) else 0.0
            if seg_dist(x, z, ax, az, bx, bz) < reach + clear + extra:
                return True
        return False

    def wall_hit(self, x: float, z: float, clear: float) -> bool:
        return any(seg_dist(x, z, *s) < clear for s in self.walls.at(x, z))

    def prop_hit(self, x: float, z: float, clear: float) -> bool:
        return any(math.hypot(x - px, z - pz) < clear for px, pz in self.props.at(x, z))

    def lamp_hit(self, x: float, z: float, clear: float) -> bool:
        return any(math.hypot(x - px, z - pz) < clear for px, pz in self.lamps.at(x, z))


def _in_polygon(x: float, z: float, ring, holes) -> bool:
    return inside((x, z), ring) and not any(inside((x, z), h) for h in holes)


def _bbox(ring):
    xs, zs = [p[0] for p in ring], [p[1] for p in ring]
    return min(xs), min(zs), max(xs), max(zs)


class Planter:
    """Holds the trees placed so far, picks kind, form and size from the style, and counts what each rule dropped."""

    def __init__(self, ctx, fill: dict, ground: Ground):
        self.ctx, self.fill, self.g = ctx, fill, ground
        self.ext = ctx.ext
        self.recs: list[list] = []
        self.near = Grid()
        self.dropped: dict = {}
        self.stats: dict = {}

    def cfg(self, k: str):
        return self.fill.get(k, DEFAULTS.get(k))

    def count(self, rule: str, reason: str) -> None:
        d = self.dropped.setdefault(rule, {})
        d[reason] = d.get(reason, 0) + 1

    def crowded(self, x: float, z: float) -> bool:
        gap = float(self.cfg("minGap"))
        return any(math.hypot(x - px, z - pz) < gap for px, pz in self.near.at(x, z))

    def canopy(self, x: float, z: float):
        """Measured crown height above the ground (dsm - dtm, the highest of 3 x 3 samples a metre apart), or None."""
        sh = self.ctx.surface_height
        if sh is None or self.g.building_dist(x, z, 4.0) < 4.0:
            return None
        top = None
        for dx in (-1.0, 0.0, 1.0):
            for dz in (-1.0, 0.0, 1.0):
                v = sh(x + dx, z + dz)
                if v is not None and (top is None or v > top):
                    top = v
        if top is None:
            return None
        h = top - self.ctx.ground(x, z)
        return h if 2.5 <= h <= 30.0 else None

    def make(self, x: float, z: float, table: dict, rnd, scale: float = 1.0):
        kind = pick(table, rnd)
        form = pick(self.fill["forms"].get(kind) or {"round": 1}, rnd)
        v_h, v_c = 1 + (rnd.random() * 2 - 1) * 0.15, 1 + (rnd.random() * 2 - 1) * 0.15
        size = self.fill["size"][kind]
        lo, hi = size["height"]
        measured = self.canopy(x, z) if kind != "shrub" else None
        if measured is not None:
            h = measured
        else:
            h = (lo + (hi - lo) * rnd.random()) * v_h * scale
        crown = h * float(size["crown"]) * v_c
        return kind, form, h, crown

    def add(self, rule: str, src: int, x: float, z: float, kind: str, form: str, h: float, crown: float) -> None:
        h = min(63.75, max(0.5, round(h * 4) / 4))
        crown = min(63.75, max(0.25, round(crown * 4) / 4))
        self.recs.append([round(x, 1), round(z, 1), h, crown, KINDS[kind], FORMS.get(form, 0), src])
        self.near.add((x, z), x, z, x, z, float(self.cfg("minGap")))
        self.stats[rule] = self.stats.get(rule, 0) + 1

    def check(self, rule: str, x: float, z: float, build: float, road: float, wall: float = 0.5, skip: int | None = None) -> bool:
        e = self.ext
        if not (e["minX"] <= x <= e["maxX"] and e["minZ"] <= z <= e["maxZ"]):
            self.count(rule, "outside the extent")
        elif self.g.in_water(x, z):
            self.count(rule, "in water")
        elif self.g.on_square(x, z):
            self.count(rule, "on a paved square")
        elif self.g.building_dist(x, z, build) < build:
            self.count(rule, "at a building")
        elif self.g.road_hit(x, z, road, skip):
            self.count(rule, "on a road or sidewalk")
        elif self.g.wall_hit(x, z, wall):
            self.count(rule, "at a wall")
        elif self.g.prop_hit(x, z, 1.0):
            self.count(rule, "at a prop")
        elif self.crowded(x, z):
            self.count(rule, "too close to a tree")
        else:
            return True
        return False


def _scatter(ring, holes, density: float, rnd):
    """A jittered grid over a polygon: one point per cell of 100 / density square metres, moved up to 40 % of the cell."""
    step = math.sqrt(100.0 / density)
    x0, z0, x1, z1 = _bbox(ring)
    ox, oz = rnd.random() * step, rnd.random() * step
    nx, nz = int((x1 - x0) // step) + 1, int((z1 - z0) // step) + 1
    for j in range(nz):
        for i in range(nx):
            x = x0 + ox + i * step + (rnd.random() - 0.5) * 0.8 * step
            z = z0 + oz + j * step + (rnd.random() - 0.5) * 0.8 * step
            if x0 <= x <= x1 and z0 <= z <= z1 and _in_polygon(x, z, ring, holes):
                yield x, z


def _mapped(ctx, fill: dict | None, pl: Planter | None) -> list:
    trees = ctx.features.get("trees", [])
    if pl is None:
        return [[round(t["x"], 1), round(t["z"], 1)] for t in trees]
    tcfg = ctx.style.pack.get("trees", {})
    out = []
    for t in trees:
        tags = t.get("tags") or {}
        genus = (tags.get("genus") or (tags.get("species") or "").split(" ")[0]).strip()
        spec = dict(tcfg.get("default", {"kind": "broadleaf", "form": "round"}))
        spec.update(tcfg.get("genus", {}).get(genus, {}))
        if (tags.get("leaf_type") or "") == "needleleaved" and "kind" not in tcfg.get("genus", {}).get(genus, {}):
            spec.update({"kind": "conifer", "form": "cone"})
        kind = spec.get("kind", "broadleaf") if spec.get("kind") in KINDS else "broadleaf"
        size = fill["size"][kind]
        h = num(tags.get("height"))
        if not h or not 1.0 <= h <= 45.0:
            h = pl.canopy(t["x"], t["z"])
        if not h:
            lo, hi = size["height"]
            h = (lo + hi) / 2
        crown = num(tags.get("diameter_crown"))
        crown = crown / 2 if crown and 0.5 <= crown <= 40 else h * float(size["crown"])
        out.append([round(t["x"], 1), round(t["z"], 1), min(63.75, round(h * 4) / 4), min(63.75, max(0.25, round(crown * 4) / 4)),
                    KINDS[kind], FORMS.get(spec.get("form", "round"), 0), SRC_MAPPED])
    return out


def _rows(ctx, pl: Planter) -> None:
    spacing = float(pl.cfg("rowSpacing"))
    for n, row in enumerate(ctx.features.get("tree_rows", [])):
        rnd = ctx.rng(SRC_ROW * 100003 + n)
        carry = 0.0
        for a, b in zip(row["pts"], row["pts"][1:]):
            ln = math.hypot(b[0] - a[0], b[1] - a[1])
            d = carry
            while d <= ln + 1e-9:
                f = d / ln if ln else 0.0
                x, z = a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
                kind, form, h, crown = pl.make(x, z, pl.fill["kinds"].get("row", {"broadleaf": 1}), rnd)
                if pl.check("rows", x, z, 0.0, -100.0, 0.0):  # a mapped row stands where it is mapped: only the extent and crowding count
                    pl.add("rows", SRC_ROW, x, z, kind, form, h, crown)
                d += spacing
            carry = d - ln


def _areas(ctx, pl: Planter, rule: str, src: int, kinds_of: dict, density_key: str, build: float, road: float, seed: int) -> None:
    for n, g in enumerate(ctx.features.get("green", [])):
        group = kinds_of.get(g["kind"])
        if not group:
            continue
        density = float(pl.cfg("scrubDensity" if group == "scrub" else density_key))
        if density <= 0:
            continue
        rnd = ctx.rng(seed * 100003 + n)
        table = pl.fill["kinds"].get(group if rule == "woods" else "park", {"broadleaf": 1})
        for x, z in _scatter(g["ring"], g["holes"], density, rnd):
            kind, form, h, crown = pl.make(x, z, table, rnd)
            if pl.check(rule, x, z, build, road):
                pl.add(rule, src, x, z, kind, form, h, crown)


def _slope(ctx, x: float, z: float) -> float:
    """Rise over run by central differences at 2.5 m, as ground.bare_areas."""
    h = 2.5
    return math.hypot((ctx.ground(x + h, z) - ctx.ground(x - h, z)) / (2 * h), (ctx.ground(x, z + h) - ctx.ground(x, z - h)) / (2 * h))


def _slopes(ctx, pl: Planter) -> None:
    """Cells ground.py wrote as bare (no building, road, square or water over them, steeper than 0.25) that are steeper than slopeMin."""
    ext = ctx.ext
    bare = set()
    for a in (getattr(ctx, "layers", {}) or {}).get("areas", []):
        if a.get("k") != "bare":
            continue
        r = a["r"]
        for j in range(int(round((r[1] - ext["minZ"]) / CELL)), int(round((r[5] - ext["minZ"]) / CELL))):
            for i in range(int(round((r[0] - ext["minX"]) / CELL)), int(round((r[2] - ext["minX"]) / CELL))):
                bare.add((i, j))
    density, smin, scale = float(pl.cfg("slopeDensity")), float(pl.cfg("slopeMin")), float(pl.cfg("slopeScale"))
    if density <= 0 or not bare:
        return
    step = math.sqrt(100.0 / density)
    rnd = ctx.rng(SRC_SLOPE * 100003)
    table = pl.fill["kinds"].get("slope", {"broadleaf": 1})
    ox, oz = rnd.random() * step, rnd.random() * step
    nx, nz = int((ext["maxX"] - ext["minX"]) // step) + 1, int((ext["maxZ"] - ext["minZ"]) // step) + 1
    for j in range(nz):
        for i in range(nx):
            x = ext["minX"] + ox + i * step + (rnd.random() - 0.5) * 0.8 * step
            z = ext["minZ"] + oz + j * step + (rnd.random() - 0.5) * 0.8 * step
            kind, form, h, crown = pl.make(x, z, table, rnd, scale)
            if (int((x - ext["minX"]) // CELL), int((z - ext["minZ"]) // CELL)) not in bare or _slope(ctx, x, z) <= smin:
                continue
            if pl.check("slope", x, z, 1.0, 1.0):
                pl.add("slope", SRC_SLOPE, x, z, kind, form, h, crown)


def _streets(ctx, pl: Planter, roads_out: list) -> None:
    on = set(pl.cfg("streetOn"))
    spacing, off, minsw = float(pl.cfg("streetSpacing")), float(pl.cfg("streetOffset")), float(pl.cfg("streetMinSidewalk"))
    if not on or spacing <= 0:
        return
    sw_w = pl.g.sw_w
    verges = [(g["ring"], g["holes"]) for g in ctx.features.get("green", []) if g["kind"] in VERGE_KINDS]
    vgrid = Grid()
    for r, h in verges:
        x0, z0, x1, z1 = _bbox(r)
        vgrid.add((r, h), x0, z0, x1, z1, 0)
    table = pl.fill["kinds"].get("street", {"broadleaf": 1})
    for i, rd in enumerate(ctx.features.get("roads", [])):
        t = rd["tags"]
        if t.get("highway") not in on or t.get("footway") == "sidewalk" or (t.get("tunnel") or "no") != "no" or (t.get("bridge") or "no") != "no":
            continue
        rec = roads_out[i] if i < len(roads_out) else {}
        sw = rec.get("sw")
        half = float(rec.get("w") or num(t.get("width")) or 6.0) / 2 + off
        rnd = ctx.rng(SRC_STREET * 100003 + i)
        want, run = spacing / 2, 0.0
        for a, b in zip(rd["pts"], rd["pts"][1:]):
            ln = math.hypot(b[0] - a[0], b[1] - a[1])
            while ln > 0 and want <= run + ln + 1e-9:
                f = (want - run) / ln
                px, pz = a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
                tx, tz = (b[0] - a[0]) / ln, (b[1] - a[1]) / ln
                for side, nx, nz in ((1, tz, -tx), (-1, -tz, tx)):   # left of travel is (tz, -tx), as props.py and the engine
                    x, z = px + nx * half, pz + nz * half
                    on_walk = sw_w >= minsw and sw in ("both", "left" if side == 1 else "right")
                    kind, form, h, crown = pl.make(x, z, table, rnd)
                    if not on_walk and not any(_in_polygon(x, z, r, hs) for r, hs in vgrid.at(x, z)):
                        pl.count("street", "no wide sidewalk or verge")
                    elif pl.g.lamp_hit(x, z, 3.0):
                        pl.count("street", "near a lamp")
                    elif pl.g.road_hit(x, z, 0.5, skip=i, vehicle_extra=3.0):
                        pl.count("street", "at a junction mouth or another way")
                    elif pl.check("street", x, z, 1.2, -100.0, 0.5):
                        pl.add("street", SRC_STREET, x, z, kind, form, h, crown)
                want += spacing
            run += ln


def build(ctx) -> dict:
    fill = ctx.style.pack.get("trees", {}).get("fill")
    if not fill:
        return {"trees": _mapped(ctx, None, None)}
    for k in ("kinds", "forms", "size"):
        if k not in fill:
            raise SystemExit(f"style: trees.fill needs '{k}'")
    roads_out = (getattr(ctx, "layers", {}) or {}).get("roads", [])
    pl = Planter(ctx, fill, Ground(ctx, roads_out))
    mapped = _mapped(ctx, fill, pl)
    for r in mapped:
        pl.near.add((r[0], r[1]), r[0], r[1], r[0], r[1], float(pl.cfg("minGap")))
    _rows(ctx, pl)
    _areas(ctx, pl, "woods", SRC_WOOD, WOOD_KINDS, "woodDensity", 0.5, 0.5, SRC_WOOD)
    _areas(ctx, pl, "parks", SRC_PARK, {k: "park" for k in PARK_KINDS}, "parkDensity", 2.5, 2.5, SRC_PARK)
    _slopes(ctx, pl)
    _streets(ctx, pl, roads_out)
    recs, cap = pl.recs, int(pl.cfg("max"))
    room = max(0, cap - len(mapped))
    thinned = 0
    if len(recs) > room:
        thinned = len(recs) - room
        keep = set(ctx.rng(0x7EE5).sample(range(len(recs)), room))
        recs = [r for k, r in enumerate(recs) if k in keep]
    s = pl.stats
    drop = "; ".join(f"{rule}: " + ", ".join(f"{v} {k}" for k, v in sorted(d.items())) for rule, d in sorted(pl.dropped.items()))
    ctx.rules["trees"] = (
        f"Trees: {len(mapped)} mapped natural=tree nodes (source 0; kind and form from the style's trees.genus and the leaf_type tag, height and crown from "
        f"the tags, else the measured canopy dsm - dtm where no building is within 4 m, else the style's size table). By rule, each seeded and "
        f"style-driven (style trees.fill): {s.get('rows', 0)} along tree_row ways every {pl.cfg('rowSpacing'):g} m (source 1); {s.get('woods', 0)} in woods, "
        f"forest and scrub at {pl.cfg('woodDensity'):g} (scrub {pl.cfg('scrubDensity'):g}) per 100 m2 on a jittered grid (source 2); {s.get('parks', 0)} in parks, "
        f"gardens, cemeteries and grass at {pl.cfg('parkDensity'):g} per 100 m2, 2.5 m from buildings and ways (source 3); {s.get('slope', 0)} on unbuilt, "
        f"unpaved ground steeper than {pl.cfg('slopeMin'):g} at {pl.cfg('slopeDensity'):g} per 100 m2, at {pl.cfg('slopeScale'):g} of the size (source 4); "
        f"{s.get('street', 0)} street trees every {pl.cfg('streetSpacing'):g} m, {pl.cfg('streetOffset'):g} m behind the kerb, only where the sidewalk is "
        f"{pl.cfg('streetMinSidewalk'):g} m wide or a grass verge is, not within 3 m of a lamp, 1.2 m of a building or a junction mouth (source 5). "
        f"Never in a building, on a road or sidewalk, in water or on a mapped square; at least {pl.cfg('minGap'):g} m between trees. "
        f"Height and crown vary by ±15 % (seeded). Cap {cap}: " + (f"it bit, {thinned} rule trees were thinned at random (seeded)." if thinned else "not reached.")
        + (f" Dropped by rule: {drop}." if drop else ""))
    return {"trees": mapped + recs}
