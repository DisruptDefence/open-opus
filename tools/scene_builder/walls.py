"""Walls and barriers, and the gates through buildings (item 7 of docs/plans/SCENE-DETAIL.md).

A wall record gets its thickness, material, free height or parapet and crenels from the style pack's `walls` table;
a mapped `height` or `width` wins. A wall that holds ground back is written with `hp` (the parapet above the higher
ground) and no `h`. `passages(ctx)` finds the ways a road takes through a building; buildings.py writes them as `pass`."""
from __future__ import annotations

import math

from .geom import bbox, flat, inside, num, ring_edges, seg_dist
from .style import FACADES

SCARP_DROP = 1.5       # m of ground difference 1.5 m either side of the wall
SCARP_SHARE = 0.6      # of a run's length
MIN_RUN = 10.0         # m: a run shorter than this takes the character of its neighbour
SIDE = 1.5             # m from the wall to the ground it is sampled at
RAILS = {"handrail": "rail_iron", "guard_rail": "rail_iron"}
OLD_HEIGHT = {"city_wall": 6.0, "retaining_wall": 1.1, "wall": 2.0, "hedge": 1.4}
HOLDS = ("city_wall", "retaining_wall", "wall")    # a free-standing hedge, fence or rail never holds ground


def _spec(style, bar: str) -> dict | None:
    s = style.pack.get("walls", {}).get(bar)
    if s is None and bar in RAILS:
        s = {"material": "metal_panel", "thickness": 0.08, "freeHeight": 1.0, "rail": RAILS[bar]}
    return s


def _segment_scarp(ctx, a, b) -> bool:
    l = math.hypot(b[0] - a[0], b[1] - a[1])
    if l < 1e-6:
        return False
    mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    nx, nz = -(b[1] - a[1]) / l, (b[0] - a[0]) / l
    return abs(ctx.ground(mx + nx * SIDE, mz + nz * SIDE) - ctx.ground(mx - nx * SIDE, mz - nz * SIDE)) > SCARP_DROP


def runs(ctx, pts: list) -> list[tuple[list, bool]]:
    """A way cut at the vertices where its character changes: [(points, holds_ground)], each run 10 m or longer
    (a shorter one joins its neighbour), each a scarp when 60 % of its length is."""
    segs = [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    lens = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in segs]
    cls = [_segment_scarp(ctx, a, b) for a, b in segs]
    groups = []                                  # [first segment, last segment + 1, length, scarp length]
    for i, (c, l) in enumerate(zip(cls, lens)):
        if groups and groups[-1][4] == c:
            groups[-1][1], groups[-1][2] = i + 1, groups[-1][2] + l
        else:
            groups.append([i, i + 1, l, 0.0, c])
    while len(groups) > 1:                       # fold the shortest run into a neighbour until all are long enough
        k = min(range(len(groups)), key=lambda j: groups[j][2])
        if groups[k][2] >= MIN_RUN:
            break
        j = k - 1 if k > 0 and (k == len(groups) - 1 or groups[k - 1][2] >= groups[k + 1][2]) else k + 1
        lo, hi = min(j, k), max(j, k)
        merged = [groups[lo][0], groups[hi][1], groups[lo][2] + groups[hi][2], 0.0, groups[j][4]]
        groups[lo:hi + 1] = [merged]
        groups = _join(groups)
    out = []
    for g in groups:
        total = sum(lens[g[0]:g[1]])
        scarp = sum(l for l, c in zip(lens[g[0]:g[1]], cls[g[0]:g[1]]) if c)
        out.append((pts[g[0]:g[1] + 1], total > 0 and scarp >= SCARP_SHARE * total))
    return _rejoin(out)


def _join(groups: list) -> list:
    out = []
    for g in groups:
        if out and out[-1][4] == g[4]:
            out[-1][1], out[-1][2] = g[1], out[-1][2] + g[2]
        else:
            out.append(g)
    return out


def _rejoin(rs: list) -> list:
    out = []
    for p, s in rs:
        if out and out[-1][1] == s:
            out[-1] = (out[-1][0] + p[1:], s)
        else:
            out.append((p, s))
    return out


def build(ctx) -> dict:
    r = ctx.rules
    r["wall_height"] = ("A wall's thickness, material, free height and parapet come from the style pack (`walls`); OSM `height` and "
                        "`width` win. Where the ground differs by more than 1.5 m between 1.5 m either side of the wall along 60 % "
                        "of a run, the wall holds ground back: it is written with `hp` (its top stands that far above the higher "
                        "ground) and no `h`; a way is cut into such runs at the vertices where this changes, no run under 10 m. "
                        "Fences, handrails and guard rails are drawn as rails and never hold ground.")
    r["gates"] = ("A building passage: a road (not steps) tagged tunnel=building_passage, or any road under a building tagged "
                  "historic=city_gate, takes its width (at least 3 m, at most the footprint's width across the way minus 2 × 1.2 m "
                  "of pier) through the footprint, 0.5 m beyond it at each end, clear height the lower of 0.7 × the eave and the "
                  "width + 1 m. The building is then drawn flat roofed with no shopfront.")
    walls, held = [], 0
    for w in ctx.features["walls"]:
        t, bar = w["tags"], w["tags"]["barrier"]
        spec = _spec(ctx.style, bar)
        for pts, scarp in (runs(ctx, w["pts"]) if (spec and not spec.get("rail") and bar in HOLDS) else [(w["pts"], False)]):
            rec = {"p": flat(pts), "k": bar}
            free = num(t.get("height"))
            if spec is None:
                rec["h"] = round(free or OLD_HEIGHT.get(bar, 1.1), 1)
            else:
                if scarp and "parapet" in spec:
                    rec["hp"] = round(spec["parapet"], 1)
                    held += 1
                else:
                    rec["h"] = round(free or spec.get("freeHeight", spec.get("parapet", 1.1)), 1)
                rec["t"] = round(num(t.get("width")) or spec["thickness"], 2)
                rec["m"] = FACADES.index(spec["material"])
                if spec.get("crenels"):
                    rec["cr"] = 1
                if spec.get("rail"):
                    rec["rail"] = spec["rail"]
            if t.get("name"):
                rec["n"] = t["name"]
            walls.append(rec)
    ctx.stats = {**getattr(ctx, "stats", {}), "walls_holding_ground": held}
    ctx.passages = passages(ctx)
    gates = [{"n": g["n"], "x": round(g["x"], 1), "z": round(g["z"], 1)} for g in ctx.features["gates"]]
    return {"walls": walls, "gates": gates}


# ── passages ─────────────────────────────────────────────────────────────────────────────────────────────────────
def _inside_spans(a, b, ring) -> list[tuple[float, float]]:
    """The parts of segment a-b inside a ring, as parameter intervals (0..1)."""
    ts = [0.0, 1.0]
    for (p, q) in ring_edges(ring):
        d1, d2 = (b[0] - a[0], b[1] - a[1]), (q[0] - p[0], q[1] - p[1])
        den = d1[0] * d2[1] - d1[1] * d2[0]
        if abs(den) < 1e-12:
            continue
        t = ((p[0] - a[0]) * d2[1] - (p[1] - a[1]) * d2[0]) / den
        u = ((p[0] - a[0]) * d1[1] - (p[1] - a[1]) * d1[0]) / den
        if 0 < t < 1 and 0 <= u <= 1:
            ts.append(t)
    ts.sort()
    out = []
    for t0, t1 in zip(ts, ts[1:]):
        if t1 - t0 > 1e-9 and inside((a[0] + (b[0] - a[0]) * (t0 + t1) / 2, a[1] + (b[1] - a[1]) * (t0 + t1) / 2), ring):
            if out and abs(out[-1][1] - t0) < 1e-9:
                out[-1] = (out[-1][0], t1)
            else:
                out.append((t0, t1))
    return out


def _segs_near(a, b, d: float) -> bool:
    """Segments a and b (x1, z1, x2, z2, …) lie closer than d, or cross."""
    def cross(o, p, q):
        return (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
    p1, p2, q1, q2 = (a[0], a[1]), (a[2], a[3]), (b[0], b[1]), (b[2], b[3])
    if cross(p1, p2, q1) * cross(p1, p2, q2) < 0 and cross(q1, q2, p1) * cross(q1, q2, p2) < 0:
        return True
    return min(seg_dist(*p1, *q1, *q2), seg_dist(*p2, *q1, *q2), seg_dist(*q1, *p1, *p2), seg_dist(*q2, *p1, *p2)) < d


MAX_PER_BUILDING = 3
MIN_LENGTH = 3.0


def passages(ctx) -> dict:
    """{ building src: [(x1, z1, x2, z2, w)] }: the way a road takes through each building that has one, widest first,
    one way where roads run side by side. The clear height needs the eave, which buildings.py knows. A building that
    other building parts draw is left alone (its outline is not drawn)."""
    out: dict = {}
    roads = ctx.layers.get("roads", [])
    part_points = [ft["centroid"] for ft in ctx.features["buildings"] if ft["is_part"]]
    for ft in ctx.features["buildings"]:
        if ft["is_part"]:
            continue
        ring, tags = ft["ring"], ft["tags"]
        bx0, bz0, bx1, bz1 = bbox(ring)
        if any(bx0 <= c[0] <= bx1 and bz0 <= c[1] <= bz1 and inside(c, ring) for c in part_points):
            continue
        gate = tags.get("historic") == "city_gate"
        cands = []
        for rd in roads:
            if rd["k"] == "steps" or not (gate or rd.get("tn") == "building_passage"):
                continue
            p = list(zip(rd["p"][0::2], rd["p"][1::2]))
            for a, b in zip(p, p[1:]):
                if max(a[0], b[0]) < bx0 or min(a[0], b[0]) > bx1 or max(a[1], b[1]) < bz0 or min(a[1], b[1]) > bz1:
                    continue
                l = math.hypot(b[0] - a[0], b[1] - a[1])
                if l < 1e-6:
                    continue
                ux, uz = (b[0] - a[0]) / l, (b[1] - a[1]) / l
                for t0, t1 in _inside_spans(a, b, ring):
                    x1, z1 = a[0] + (b[0] - a[0]) * t0 - ux * 0.5, a[1] + (b[1] - a[1]) * t0 - uz * 0.5
                    x2, z2 = a[0] + (b[0] - a[0]) * t1 + ux * 0.5, a[1] + (b[1] - a[1]) * t1 + uz * 0.5
                    ln = math.hypot(x2 - x1, z2 - z1)
                    if ln < MIN_LENGTH:
                        continue
                    across = [-q[0] * uz + q[1] * ux for q in ring]
                    centre = -x1 * uz + z1 * ux
                    room = min(max(across) - centre, centre - min(across)) * 2 - 2 * 1.2   # piers of 1.2 m stay on both sides
                    w = min(max(rd["w"], 3.0), room)
                    if w >= 1.6:
                        cands.append((-w, -ln, (round(x1, 1), round(z1, 1), round(x2, 1), round(z2, 1), round(w, 1))))
        for _, _, c in sorted(cands):
            taken = out.get(ft["src"], [])
            if len(taken) < MAX_PER_BUILDING and not any(_segs_near(c, e, (c[4] + e[4]) / 2 + 0.5) for e in taken):
                out.setdefault(ft["src"], []).append(c)
    return out
