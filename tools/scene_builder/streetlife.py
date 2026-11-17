"""Street life as static props, by rule: parked vehicles (source 4) and standing bystanders (source 5), appended to the props
layer after props.py has built it. A style pack without `street.parking` / `street.people` places none.

    parking: { "on": [highway classes], "share": 0.3, "minWidth": 6.5, "kinds": { "car_hatch": 4, ... }, "bikes": 0.08, "max": 250 }
    people:  { "density": 0.6, "squares": 2.0, "groups": [1, 1, 2, 2, 3], "max": 300 }

Static only: nothing here moves. Every choice is seeded from OpenStreetMap ids and positions (random.Random on integers made
from them), so a rebuild from the same extract is byte-identical. Moving traffic and walking civilians are not part of this."""
from __future__ import annotations

import math

from .geom import inside, num, ring_area, seg_dist
from .ground import ROAD_WIDTH, VEHICLE

SOURCE_CAR, SOURCE_PERSON = 4, 5
CARS = {"car_hatch": (4.0, 1.75), "car_sedan": (4.6, 1.8), "car_suv": (4.5, 1.85), "van_delivery": (5.4, 2.0)}   # length, width
SLOT = 6.0
KERB_GAP = 0.25            # the car's side to the kerb line
MIN_BESIDE = 3.0           # carriageway that must stay free beside a parked car
JUNCTION = 8.0             # no vehicle within this of a junction, a crossing, a road end, steps, a tunnel or a bridge
PROP_CLEAR = {"bench_slat": 1.1, "planter": 0.9, "plinth": 1.2, "monument_tall": 4.2, "pavilion": 4.2, "cannon": 1.6,
              "flagpole": 0.6, "lamp_lantern": 0.6, "lamp_cobra": 0.6, "bollard_iron": 0.6}
PERSON_R = 0.25


# ---- small geometry --------------------------------------------------------------------------------------------------

def _bearing(dx: float, dz: float) -> float:
    """Compass bearing in degrees, clockwise from grid north (-z), of a direction."""
    return math.degrees(math.atan2(dx, -dz)) % 360


def _seg_x(a, b, c, d):
    """Intersection point of segments ab and cd, or None."""
    rx, rz, sx, sz = b[0] - a[0], b[1] - a[1], d[0] - c[0], d[1] - c[1]
    den = rx * sz - rz * sx
    if abs(den) < 1e-9:
        return None
    t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den
    u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den
    if 0 <= t <= 1 and 0 <= u <= 1:
        return a[0] + t * rx, a[1] + t * rz
    return None


def _length(pts) -> float:
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))


def _at(pts, s: float):
    """Point and unit tangent at arc length s along a polyline (clamped)."""
    run = 0.0
    for a, b in zip(pts, pts[1:]):
        ln = math.hypot(b[0] - a[0], b[1] - a[1])
        if ln > 1e-9 and run + ln >= s:
            f = (s - run) / ln
            return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f), ((b[0] - a[0]) / ln, (b[1] - a[1]) / ln)
        run += ln
    a, b = pts[-2], pts[-1]
    ln = math.hypot(b[0] - a[0], b[1] - a[1]) or 1.0
    return pts[-1], ((b[0] - a[0]) / ln, (b[1] - a[1]) / ln)


class Grid:
    """Bucket grid of boxes: query(x, z, r) yields the items whose box is near."""

    def __init__(self, cell: float = 16.0):
        self.cell, self.map = cell, {}

    def add(self, item, x0, z0, x1, z1):
        c = self.cell
        for gx in range(int(x0 // c), int(x1 // c) + 1):
            for gz in range(int(z0 // c), int(z1 // c) + 1):
                self.map.setdefault((gx, gz), []).append(item)

    def near(self, x, z, r):
        c, seen = self.cell, set()
        for gx in range(int((x - r) // c), int((x + r) // c) + 1):
            for gz in range(int((z - r) // c), int((z + r) // c) + 1):
                for it in self.map.get((gx, gz), ()):
                    if id(it) not in seen:
                        seen.add(id(it))
                        yield it


class World:
    """What a placement must keep clear of, read from the features and the layers built so far."""

    def __init__(self, ctx, roads: list):
        self.ext = ctx.ext
        self.ground = ctx.ground if callable(getattr(ctx, "ground", None)) else None
        f = getattr(ctx, "features", None) or {}
        layers = getattr(ctx, "layers", None) or {}
        self.roads = roads          # [{pts, tags, src, w, vehicle, idx}]
        self.build_grid = Grid()
        for b in f.get("buildings", []):
            if b.get("is_part"):
                continue
            xs, zs = [p[0] for p in b["ring"]], [p[1] for p in b["ring"]]
            self.build_grid.add((b["ring"], b.get("holes") or []), min(xs) - 1, min(zs) - 1, max(xs) + 1, max(zs) + 1)
        self.wall_grid = Grid()
        for w in layers.get("walls", []) or []:
            p = w["p"]
            pts = list(zip(p[0::2], p[1::2]))
            for a, b in zip(pts, pts[1:]):
                self.wall_grid.add((a, b), min(a[0], b[0]) - 1, min(a[1], b[1]) - 1, max(a[0], b[0]) + 1, max(a[1], b[1]) + 1)
        self.road_grid = Grid()
        for r in roads:
            for a, b in zip(r["pts"], r["pts"][1:]):
                self.road_grid.add((r, a, b), min(a[0], b[0]) - 1, min(a[1], b[1]) - 1, max(a[0], b[0]) + 1, max(a[1], b[1]) + 1)
        self.circles = Grid(8.0)    # things already standing: (x, z, r)
        self.trees = [(t[0], t[1]) for t in layers.get("trees", []) or []]
        self.tree_grid = Grid()
        for t in self.trees:
            self.tree_grid.add(t, t[0], t[1], t[0], t[1])
        self.crossings = [(c[0], c[1]) for c in layers.get("crossings", []) or []]
        pl = layers.get("props") or {}
        kinds = pl.get("kinds", [])
        for it in pl.get("items", []):
            self.occupy(it[1], it[2], PROP_CLEAR.get(kinds[it[0]], 0.8))

    def occupy(self, x, z, r):
        self.circles.add((x, z, r), x - r, z - r, x + r, z + r)

    def in_extent(self, x, z):
        e = self.ext
        return e["minX"] <= x <= e["maxX"] and e["minZ"] <= z <= e["maxZ"]

    def in_building(self, x, z, clear):
        for ring, holes in self.build_grid.near(x, z, clear + 1):
            if any(seg_dist(x, z, *ring[i - 1], *ring[i]) < clear for i in range(len(ring))):
                return True
            if inside((x, z), ring) and not any(inside((x, z), h) for h in holes):
                return True
        return False

    def near_wall(self, x, z, clear):
        return any(seg_dist(x, z, *a, *b) < clear for a, b in self.wall_grid.near(x, z, clear + 1))

    def on_carriageway(self, x, z, clear, skip=None):
        for r, a, b in self.road_grid.near(x, z, clear + 8.0):
            if r is skip or not r["vehicle"]:
                continue
            if seg_dist(x, z, *a, *b) < r["w"] / 2 + clear:
                return True
        return False

    def near_tree(self, x, z, clear):
        return any(math.hypot(x - t[0], z - t[1]) < clear for t in self.tree_grid.near(x, z, clear))

    def crowded(self, x, z, r):
        return any(math.hypot(x - cx, z - cz) < cr + r for cx, cz, cr in self.circles.near(x, z, r + 6))

    def near_steps(self, x, z, clear):
        return any(r["tags"].get("highway") == "steps" and seg_dist(x, z, *a, *b) < clear for r, a, b in self.road_grid.near(x, z, clear + 2))


def _road_records(ctx):
    feats = (getattr(ctx, "features", None) or {}).get("roads", [])
    recs = (getattr(ctx, "layers", None) or {}).get("roads") or []
    out = []
    for i, rd in enumerate(feats):
        t = rd["tags"]
        hw = t.get("highway")
        rec = recs[i] if i < len(recs) else {}
        out.append({"pts": rd["pts"], "tags": t, "src": rd.get("src") or ("way", i), "idx": i, "hw": hw,
                    "w": rec.get("w") or round(num(t.get("width")) or ROAD_WIDTH.get(hw, 4), 1), "sw": rec.get("sw"),
                    "vehicle": hw in VEHICLE and t.get("footway") != "sidewalk",
                    "special": (t.get("tunnel") or "no") != "no" or (t.get("bridge") or "no") != "no"})
    return out


def _junction_points(road, world) -> list:
    """Where other ways meet or cross this one: crossings of the lines, and vertices of either lying on the other."""
    pts, out = road["pts"], []
    for a, b in zip(pts, pts[1:]):
        for other, c, d in world.road_grid.near((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, math.hypot(b[0] - a[0], b[1] - a[1]) / 2 + 2):
            if other is road or other["tags"].get("footway") == "sidewalk":
                continue
            x = _seg_x(a, b, c, d)
            if x:
                out.append(x)
            for v in (c, d):
                if seg_dist(v[0], v[1], a[0], a[1], b[0], b[1]) < 1.5:
                    out.append(v)
            for v in (a, b):
                if seg_dist(v[0], v[1], c[0], c[1], d[0], d[1]) < 1.5:
                    out.append(v)
    return out


def _weighted(rng, table: dict) -> str:
    names = sorted(table)
    total = sum(float(table[n]) for n in names)
    pick = rng.random() * total
    for n in names:
        pick -= float(table[n])
        if pick < 0:
            return n
    return names[-1]


# ---- parked vehicles ---------------------------------------------------------------------------------------------------

def _footprint(cx, cz, ux, uz, length, width):
    """Eight points round a car's outline (corners and edge midpoints), u the direction of its length."""
    vx, vz = -uz, ux
    hl, hw = length / 2, width / 2
    return [(cx + ux * a + vx * b, cz + uz * a + vz * b) for a, b in
            ((-hl, -hw), (0, -hw), (hl, -hw), (hl, 0), (hl, hw), (0, hw), (-hl, hw), (-hl, 0))]


def parking(ctx, world: World, roads: list, cfg: dict, items: list, add) -> dict:
    on = set(cfg.get("on", []))
    share, min_w, table = float(cfg.get("share", 0.3)), float(cfg.get("minWidth", 6.5)), cfg.get("kinds") or {"car_hatch": 1}
    bikes, cap = float(cfg.get("bikes", 0)), int(cfg.get("max", 250))
    table = {k: v for k, v in table.items() if k in CARS and float(v) > 0} or {"car_hatch": 1}
    stats = {"slots": 0, "filled": 0}
    drops: dict = {}

    def drop(reason):
        drops[reason] = drops.get(reason, 0) + 1

    steps = [r for r in roads if r["hw"] == "steps"]
    special = [r for r in roads if r["special"]]
    cand = []
    for road in roads:
        t = road["tags"]
        if road["hw"] not in on or not road["vehicle"] or road["special"] or road["w"] < min_w:
            continue
        pts, total, rid = road["pts"], _length(road["pts"]), road["src"][1]
        if total < SLOT:
            continue
        junctions = _junction_points(road, world) + [road["pts"][0], road["pts"][-1]] + world.crossings
        side = 1 if rid % 2 == 0 else -1          # +1 the left of travel, by the id's parity
        k = 0
        while 3.0 + SLOT * k <= total - 3.0 + 1e-9:
            s = 3.0 + SLOT * k
            k += 1
            rng = ctx.rng(int(rid) * 1000003 + k * 7919 + 17)
            if rng.random() >= share:
                continue
            kind = _weighted(rng, table)
            length, width = CARS[kind]
            stats["slots"] += 1
            (px, pz), (tx, tz) = _at(pts, s)
            (_, _), (t0x, t0z) = _at(pts, max(0.0, s - length / 2))
            (_, _), (t1x, t1z) = _at(pts, min(total, s + length / 2))
            if abs((_bearing(t1x, t1z) - _bearing(t0x, t0z) + 180) % 360 - 180) > 8:
                drop("a bend")
                continue
            if road["w"] - KERB_GAP - width < MIN_BESIDE:
                drop("carriageway too narrow")
                continue
            if any(math.hypot(px - j[0], pz - j[1]) < JUNCTION for j in junctions):
                drop("near a junction, a crossing or a road end")
                continue
            if any(seg_dist(px, pz, *a, *b) < JUNCTION for r in steps for a, b in zip(r["pts"], r["pts"][1:])) or \
               any(r is not road and seg_dist(px, pz, *a, *b) < JUNCTION for r in special for a, b in zip(r["pts"], r["pts"][1:])):
                drop("near steps, a tunnel or a bridge")
                continue
            nx, nz = tz, -tx                                    # left of travel
            off = road["w"] / 2 - KERB_GAP - width / 2
            cx, cz = round(px + nx * side * off, 1), round(pz + nz * side * off, 1)
            yaw_dir = (tx, tz) if side < 0 else (-tx, -tz)      # nose with the traffic of its side (drive on the right)
            heading = (_bearing(*yaw_dir) + rng.uniform(-2.0, 2.0)) % 360
            ux, uz = math.sin(math.radians(heading)), -math.cos(math.radians(heading))
            outline = _footprint(cx, cz, ux, uz, length, width)
            if not all(world.in_extent(*p) for p in outline):
                drop("outside the extent")
                continue
            if any(world.in_building(x, z, 0.1) or world.near_wall(x, z, 0.2) or world.on_carriageway(x, z, 0.0, skip=road) for x, z in outline) \
               or any(world.near_tree(x, z, 0.4) for x, z in outline):
                drop("a building, wall, tree or other street in the way")
                continue
            if world.ground:
                h = [world.ground(*p) for p in (outline[0], outline[2], outline[4], outline[6])]
                if max(h) - min(h) > 0.45 or abs(h[0] + h[1] - h[2] - h[3]) > 0.9:
                    drop("too steep")
                    continue
            variant = rng.randrange(8)
            cand.append((rng.random(), kind, cx, cz, heading, variant, length, width, ux, uz))
    placed = 0
    cand.sort(key=lambda c: c[0])
    taken: list = []
    for key, kind, cx, cz, heading, variant, length, width, ux, uz in cand:
        if placed >= cap:
            drop("over the cap")
            continue
        if any(math.hypot(cx - o[0], cz - o[1]) < (length + o[2]) / 2 + 0.4 for o in taken):
            drop("overlaps another vehicle")
            continue
        taken.append((cx, cz, length))
        add(kind, cx, cz, heading, variant, SOURCE_CAR)
        world.occupy(cx, cz, length / 2)
        placed += 1
    stats["filled"] = placed
    stats["bikes"] = _bikes(ctx, world, roads, bikes, add, drops) if bikes > 0 else 0
    stats["drops"] = drops
    return stats


def sidewalk_width(ctx, default=1.6) -> float:
    pack = getattr(ctx.style, "pack", {}) or {}
    return float((pack.get("street", {}).get("sidewalk", {}) or {}).get("width", default))


def _strips(ctx, roads):
    """The sidewalks the engine lays: (road, side, lateral from the centreline lo, hi) — side +1 left, -1 right; 'self' ways are their own strip."""
    width = sidewalk_width(ctx)
    for r in roads:
        if r["special"] or r["hw"] == "steps" or not r["sw"]:
            continue
        if r["sw"] == "self":
            yield r, 0, -r["w"] / 2, r["w"] / 2     # a mapped sidewalk way: lateral measured either way from its line
        elif r["vehicle"]:
            for side, name in ((1, "left"), (-1, "right")):
                if r["sw"] in ("both", name):
                    yield r, side, r["w"] / 2, r["w"] / 2 + width


def _bikes(ctx, world, roads, chance, add, drops) -> int:
    """Bicycles on sidewalks 1.8 m wide or more, against the wall (the outer edge), leaning towards it."""
    n = 0
    for r, side, lo, hi in _strips(ctx, roads):
        if side == 0 or hi - lo < 1.8:
            continue
        pts, total, rid = r["pts"], _length(r["pts"]), r["src"][1]
        junctions = _junction_points(r, world) + [pts[0], pts[-1]] + world.crossings
        for k in range(int(total // 10)):
            rng = ctx.rng(int(rid) * 1000003 + k * 104729 + side * 31 + 5)
            if rng.random() >= chance:
                continue
            s = 5.0 + 10.0 * k
            (px, pz), (tx, tz) = _at(pts, s)
            lat = hi - 0.5
            x, z = round(px + tz * side * lat, 1), round(pz - tx * side * lat, 1)
            if any(math.hypot(px - j[0], pz - j[1]) < 6.0 for j in junctions) or not world.in_extent(x, z):
                drops["bicycle: near a junction or outside"] = drops.get("bicycle: near a junction or outside", 0) + 1
                continue
            if world.in_building(x, z, 0.3) or world.on_carriageway(x, z, 0.3) or world.crowded(x, z, 0.5) or world.near_tree(x, z, 0.5):
                drops["bicycle: in the way"] = drops.get("bicycle: in the way", 0) + 1
                continue
            # the bicycle leans to its right: its right hand points at the wall (side * normal), so it faces the travel direction when the wall is on the right
            fx, fz = (tx, tz) if side < 0 else (-tx, -tz)
            add("bicycle", x, z, (_bearing(fx, fz) + rng.uniform(-4, 4)) % 360, rng.randrange(8), SOURCE_CAR)
            world.occupy(x, z, 0.9)
            n += 1
    return n


# ---- bystanders ------------------------------------------------------------------------------------------------------

def _person_ok(world, x, z, kerb_free=True) -> str | None:
    """None when a person may stand at (x, z), else the reason."""
    if not world.in_extent(x, z):
        return "outside the extent"
    if world.in_building(x, z, 0.5):
        return "in or within 0.5 m of a building"
    if world.near_wall(x, z, 0.5):
        return "within 0.5 m of a wall"
    if world.on_carriageway(x, z, 0.5):
        return "on or within 0.5 m of a carriageway"
    if world.near_tree(x, z, 0.8):
        return "against a tree"
    if world.near_steps(x, z, 1.0):
        return "on steps"
    if world.crowded(x, z, PERSON_R):
        return "against another prop or vehicle"
    return None


def _group(rng, size: int, x: float, z: float, axis, roomy: bool):
    """People of one group: [(x, z, facing bearing)], 0.6-0.9 m apart, facing each other (pairs, triples) or along the street (singles)."""
    ax, az = axis
    jitter = lambda: rng.uniform(-8, 8)   # noqa: E731
    if size == 1:
        d = (ax, az) if rng.random() < 0.5 else (-ax, -az)
        return [(x, z, (_bearing(*d) + jitter()) % 360)]
    sep = rng.uniform(0.6, 0.9)
    if size == 3 and roomy:
        r, base = sep / math.sqrt(3), rng.uniform(0, 360)
        out = []
        for k in range(3):
            a = math.radians(base + 120 * k)
            px, pz = x + r * math.sin(a), z - r * math.cos(a)
            out.append((px, pz, (_bearing(x - px, z - pz) + jitter()) % 360))
        return out
    return [(x - ax * sep / 2, z - az * sep / 2, (_bearing(ax, az) + jitter()) % 360),
            (x + ax * sep / 2, z + az * sep / 2, (_bearing(-ax, -az) + jitter()) % 360)]


def people(ctx, world: World, roads: list, cfg: dict, add) -> dict:
    density, squares = float(cfg.get("density", 0.6)), float(cfg.get("squares", 2.0))
    sizes = [int(g) for g in cfg.get("groups", [1, 1, 2, 2, 3]) if 1 <= int(g) <= 3] or [1]
    cap = int(cfg.get("max", 300))
    drops: dict = {}
    cand = []          # (key, [(x, z, yaw)], variants)

    def consider(rng, size, x, z, axis, roomy):
        members = _group(rng, size, round(x, 1), round(z, 1), axis, roomy)
        members = [(round(a, 1), round(b, 1), c) for a, b, c in members]
        for a, b, _ in members:
            why = _person_ok(world, a, b)
            if why:
                drops[why] = drops.get(why, 0) + 1
                return
        cand.append((rng.random(), members, [rng.randrange(1 << 20) for _ in members], (round(x, 1), round(z, 1))))

    step, sw_groups = 5.0, 0
    for r, side, lo, hi in _strips(ctx, roads):
        band_lo, band_hi = lo + 0.6, hi - 0.6
        if band_hi < band_lo:
            continue
        pts, total, rid = r["pts"], _length(r["pts"]), r["src"][1]
        roomy = (hi - lo) >= 2.6
        for k in range(int(total // step)):
            rng = ctx.rng(int(rid) * 1000003 + k * 6151 + side * 37 + 101)
            if rng.random() >= density * step / 100.0:
                continue
            sw_groups += 1
            (px, pz), (tx, tz) = _at(pts, min(total, step * k + rng.uniform(0.0, step)))
            off = rng.uniform(band_lo, band_hi) * (side or 1)
            consider(rng, rng.choice(sizes), px + tz * off, pz - tx * off, (tx, tz), roomy)
    sq_groups = 0
    for a in (getattr(ctx, "layers", None) or {}).get("areas", []):
        if a.get("k") != "pedestrian":
            continue
        ring = list(zip(a["r"][0::2], a["r"][1::2]))
        holes = [list(zip(h[0::2], h[1::2])) for h in a.get("holes", [])]
        area = abs(ring_area(ring)) - sum(abs(ring_area(h)) for h in holes)
        rng = ctx.rng(int(abs(ring[0][0] * 31 + ring[0][1] * 17) * 10) + 7)
        want = squares * area / 1000.0
        n = int(want) + (1 if rng.random() < want - int(want) else 0)
        xs, zs = [p[0] for p in ring], [p[1] for p in ring]
        for _ in range(n):
            for _try in range(24):
                x, z = rng.uniform(min(xs), max(xs)), rng.uniform(min(zs), max(zs))
                if not inside((x, z), ring) or any(inside((x, z), h) for h in holes):
                    continue
                edge = min(seg_dist(x, z, *ring[i - 1], *ring[i]) for i in range(len(ring)))
                if edge < 0.6:
                    continue
                ang = math.radians(rng.uniform(0, 180))
                sq_groups += 1
                consider(rng, rng.choice(sizes), x, z, (math.sin(ang), -math.cos(ang)), True)
                break
    for r in roads:
        if r["hw"] != "pedestrian" or r["special"]:
            continue
        pts, total, rid = r["pts"], _length(r["pts"]), r["src"][1]
        rng = ctx.rng(int(rid) * 1000003 + 29)
        want = squares * total * r["w"] / 1000.0
        n = int(want) + (1 if rng.random() < want - int(want) else 0)
        for _ in range(n):
            (px, pz), (tx, tz) = _at(pts, rng.uniform(2.0, max(2.0, total - 2.0)))
            lat = rng.uniform(-(r["w"] / 2 - 0.8), r["w"] / 2 - 0.8)
            sq_groups += 1
            consider(rng, rng.choice(sizes), px + tz * lat, pz - tx * lat, (tx, tz), r["w"] >= 4.0)
    cand.sort(key=lambda c: c[0])
    placed_people = placed_groups = 0
    keep: list = []
    for _, members, variants, centre in cand:
        if placed_people + len(members) > cap:
            drops["over the cap"] = drops.get("over the cap", 0) + 1
            continue
        if any(math.hypot(centre[0] - c[0], centre[1] - c[1]) < 1.6 for c in keep):
            drops["too near another group"] = drops.get("too near another group", 0) + 1
            continue
        keep.append(centre)
        for (x, z, yaw), v in zip(members, variants):
            add("person_stand", x, z, yaw, v, SOURCE_PERSON)
            world.occupy(x, z, PERSON_R)
        placed_people += len(members)
        placed_groups += 1
    return {"people": placed_people, "groups": placed_groups, "sidewalk_groups": sw_groups, "square_groups": sq_groups, "drops": drops}


# ---- the layer ---------------------------------------------------------------------------------------------------------

def _count(d: dict) -> str:
    return ", ".join(f"{n} {k}" for k, n in sorted(d.items())) or "none"


def build(ctx) -> dict:
    street = (getattr(ctx.style, "pack", {}) or {}).get("street", {}) or {}
    pk, pp = street.get("parking"), street.get("people")
    if not pk and not pp:
        return {}
    layer = (getattr(ctx, "layers", None) or {}).get("props") or {"kinds": [], "items": []}
    kinds, items = list(layer.get("kinds", [])), [list(i) for i in layer.get("items", [])]
    ext = ctx.ext

    def add(kind, x, z, yaw, variant, source):
        if not (ext["minX"] <= x <= ext["maxX"] and ext["minZ"] <= z <= ext["maxZ"]):
            return
        if kind not in kinds:
            kinds.append(kind)
        items.append([kinds.index(kind), round(x, 1), round(z, 1), int(round(yaw)) % 360, int(variant), source])

    roads = _road_records(ctx)
    world = World(ctx, roads)
    if pk:
        st = parking(ctx, world, roads, pk, items, add)
        ctx.rules["street_parking"] = (
            f"Parked vehicles by rule (source 4, static): along the style pack's street.parking `on` classes at least {float(pk.get('minWidth', 6.5)):g} m wide "
            f"(not tunnels or bridges), on one side only (the left of travel for an even way id, else the right), parallel to the kerb with the car's side "
            f"{KERB_GAP:g} m off the kerb line, in {SLOT:g} m slots each filled with chance {float(pk.get('share', 0.3)):g}; never within {JUNCTION:g} m of a junction, "
            f"crossing, road end, steps, tunnel or bridge, nor where less than {MIN_BESIDE:g} m of carriageway would be left beside the car; heading along the road "
            f"within 2 degrees. Bicycles (chance {float(pk.get('bikes', 0)):g} per 10 m) on sidewalks 1.8 m wide or more, against the wall. "
            f"{st['filled']} vehicles and {st['bikes']} bicycles placed from {st['slots']} filled slots; dropped: {_count(st['drops'])}.")
    if pp:
        st = people(ctx, world, roads, pp, add)
        ctx.rules["street_people"] = (
            f"Bystanders by rule (source 5, static, scenery: not threats, never scored): {float(pp.get('density', 0.6)):g} groups per 100 m of sidewalk and "
            f"{float(pp.get('squares', 2.0)):g} per 1 000 m2 of pedestrian area (squares, pedestrian streets), a group of 1 to 3 people 0.6 to 0.9 m apart facing "
            f"each other (singles along the street), at least 0.5 m from walls, kerbs and buildings, never on a carriageway, 1.6 m between groups. "
            f"{st['people']} people in {st['groups']} groups placed ({st['sidewalk_groups']} sidewalk and {st['square_groups']} square candidates); dropped: {_count(st['drops'])}.")
    if not items:
        return {}
    return {"props": {"kinds": kinds, "items": items}}
