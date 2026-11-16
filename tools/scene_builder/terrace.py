"""Terraces: a mapped pedestrian platform that a place's landmark rule names (docs/plans/SCENE-DETAIL.md item 8, format 4.12).

A rule `{ "match": {"name"|"wikidata": …}, "terrace": { … } }` in the place file picks an area (a highway=pedestrian polygon with
its holes) and says what it is: a deck of boards (`boardWidth`, `dir`), its cliff-side balustrade (`rail`, `height`, `drop`: where the
ground outside the edge is lower than the ground inside by more than `drop` metres within 4 m) and its lamps along that rail
(`lamps` and `planters`: `kind`, `spacing`, `start`, `offset`); the outline is first cut back to the crest of the bank where the mapped edge lies down it (`crest`). The builder writes the deck as a `terraces` record, the balustrade as ordinary wall records with a
`rail` kind, and hands the lamps and the rail line to props.py (benches face the nearest rail). Nothing here names a place."""
from __future__ import annotations

import math

from .geom import flat, inside, ring_area
from .style import FACADES

STEP = 4.0


def _rules(ctx) -> list[dict]:
    pl = getattr(ctx, "place", None)
    return [r for r in ((getattr(pl, "raw", None) or {}).get("landmarks") or []) if r.get("terrace")]


def _match(m: dict, tags: dict) -> bool:
    return bool(m) and all(tags.get(k) == v for k, v in m.items())


def _outward(ring, p, q, d):
    """Unit normal of edge p-q pointing out of the ring."""
    l = math.hypot(q[0] - p[0], q[1] - p[1])
    nx, nz = (q[1] - p[1]) / l, -(q[0] - p[0]) / l
    mx, mz = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
    return (nx, nz) if not inside((mx + nx * d, mz + nz * d), ring) else (-nx, -nz)


CREST_REACH = 14.0     # m: how far in from the mapped edge the crest of the slope is looked for
CREST_SLACK = 0.6      # m: the crest is the first point from the outside within this of the highest ground on the way in


def _first_cross(ring):
    """The first pair of edges (i, j) that cross, with the crossing point, or None."""
    n = len(ring)

    def ccw(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        for j in range(i + 2, n):
            if (j + 1) % n == i:
                continue
            c, d = ring[j], ring[(j + 1) % n]
            if ccw(a, b, c) * ccw(a, b, d) < 0 and ccw(c, d, a) * ccw(c, d, b) < 0:
                t = ccw(c, d, a) / (ccw(c, d, a) - ccw(c, d, b))
                return i, j, (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    return None


def _untangle(ring):
    """A ring with its loops cut out: where edge i crosses edge j the vertices between them are dropped (the loop of the shorter way round)."""
    ring = list(ring)
    for _ in range(len(ring)):
        c = _first_cross(ring)
        if c is None:
            return ring
        i, j, pt = c
        inner = ring[i + 1:j + 1]
        outer = ring[j + 1:] + ring[:i + 1]
        ring = (outer + [pt]) if abs(ring_area(inner)) < abs(ring_area(outer)) or len(inner) < len(outer) else (inner + [pt])
        ring = [p for k, p in enumerate(ring) if k == 0 or p != ring[k - 1]]
    return ring


def crest_ring(ctx, ring, holes, drop: float):
    """The outer ring cut back to the crest. A mapped platform edge often lies down the bank (the survey of the outline is not the survey
    of the terrain), so a rail on it would stand below the walking surface. Edges whose outside drops by more than `drop` metres within 4 m
    are cut into pieces of about 5 m and each new vertex is moved in along the normal to the first point within 0.6 m of the highest
    ground in the next 14 m (the distances are smoothed along the edge); a vertex that would land within 1.5 m of a hole stays. Loops the moves make
    at corners are cut out. Other edges are untouched."""
    n = len(ring)
    pts: list[tuple[float, float, float, float, float]] = []      # x, z, normal x, normal z, distance to move in
    for i in range(n):
        p, q = ring[i], ring[(i + 1) % n]
        l = math.hypot(q[0] - p[0], q[1] - p[1])
        if l < 0.5:
            pts.append((p[0], p[1], 0.0, 0.0, 0.0))
            continue
        nx, nz = _outward(ring, p, q, 0.6)
        mx, mz = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
        dropping = ctx.ground(mx - nx * 0.5, mz - nz * 0.5) - ctx.ground(mx + nx * 4.0, mz + nz * 4.0) > drop
        k = max(1, math.ceil(l / 5.0)) if dropping else 1
        for s in range(k):
            x, z = p[0] + (q[0] - p[0]) * s / k, p[1] + (q[1] - p[1]) * s / k
            t_star = 0.0
            if dropping:
                prof = [ctx.ground(x - nx * t, z - nz * t) for t in [j * 0.5 for j in range(int(CREST_REACH / 0.5) + 1)]]
                top = max(prof)
                t_star = next(j * 0.5 for j, h in enumerate(prof) if h >= top - CREST_SLACK)
            pts.append((x, z, nx, nz, t_star))
    ts = [pt[4] for pt in pts]                                      # the median of three along the ring takes out single spikes
    sm = [sorted([ts[i - 1], ts[i], ts[(i + 1) % len(ts)]])[1] if ts[i] > 0 else 0.0 for i in range(len(ts))]
    out = []
    for (x, z, nx, nz, _), t in zip(pts, sm):
        x2, z2 = x - nx * t, z - nz * t
        if t > 0 and any(inside((x2, z2), h) or _near(x2, z2, h, 1.5) for h in holes):
            x2, z2 = x, z
        out.append((x2, z2))
    return _untangle(out)


def _near(x, z, ring, d) -> bool:
    from .geom import seg_dist
    return any(seg_dist(x, z, a[0], a[1], b[0], b[1]) < d for a, b in zip(ring, ring[1:] + ring[:1]))


def rail_lines(ctx, ring, holes, drop: float, inset: float) -> list[list[tuple[float, float]]]:
    """Polylines along the edges of the outer ring whose outside is lower than their inside by more than `drop`, moved in by `inset`."""
    pieces = []
    n = len(ring)
    for i in range(n):
        p, q = ring[i], ring[(i + 1) % n]
        l = math.hypot(q[0] - p[0], q[1] - p[1])
        if l < 0.5:
            continue
        k = max(1, math.ceil(l / STEP))
        nx, nz = _outward(ring, p, q, 0.6)
        for s in range(k):
            a, b = s / k, (s + 1) / k
            ax, az = p[0] + (q[0] - p[0]) * a, p[1] + (q[1] - p[1]) * a
            bx, bz = p[0] + (q[0] - p[0]) * b, p[1] + (q[1] - p[1]) * b
            mx, mz = (ax + bx) / 2, (az + bz) / 2
            if ctx.ground(mx - nx * 0.5, mz - nz * 0.5) - ctx.ground(mx + nx * 4.0, mz + nz * 4.0) > drop:
                pieces.append(((ax - nx * inset, az - nz * inset), (bx - nx * inset, bz - nz * inset)))
    lines: list[list[tuple[float, float]]] = []
    for a, b in pieces:
        if lines and math.hypot(lines[-1][-1][0] - a[0], lines[-1][-1][1] - a[1]) < 0.3:
            lines[-1].append(b)
        else:
            lines.append([a, b])
    return lines


def along(line, spacing: float, start: float):
    """(x, z, bearing-degrees-of-the-line) every `spacing` metres, the first at `start`."""
    out, d, nextp = [], 0.0, start
    for a, b in zip(line, line[1:]):
        l = math.hypot(b[0] - a[0], b[1] - a[1])
        while nextp <= d + l:
            t = (nextp - d) / l
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, math.degrees(math.atan2(b[0] - a[0], -(b[1] - a[1]))) % 360))
            nextp += spacing
        d += l
    return out


def build(ctx) -> dict:
    recs, edges, lamps, n_rail = [], [], [], 0
    ctx.terrace_edges, ctx.terrace_lamps = edges, lamps
    for rule in _rules(ctx):
        spec = rule["terrace"]
        for a in ctx.features["areas"]:
            if not _match(rule.get("match", {}), a["tags"]) or ring_area(a["ring"]) == 0:
                continue
            ring, holes = a["ring"], a["holes"]
            if spec.get("rail") and spec.get("crest", True):
                ring = crest_ring(ctx, ring, holes, float(spec.get("drop", 2.0)))
                for ar in ctx.layers.get("areas", []):            # the surface under the deck follows the new edge
                    if ar.get("n") == a["tags"].get("name") and ar.get("s") == "wood":
                        ar["r"] = flat(ring)
            rec = {"r": flat(ring), "d": int(spec.get("dir", 255)), "bw": spec.get("boardWidth", 0.14)}
            if holes:
                rec["holes"] = [flat(h) for h in holes]
            if a["tags"].get("name"):
                rec["n"] = a["tags"]["name"]
            recs.append(rec)
            lines = rail_lines(ctx, ring, holes, float(spec.get("drop", 2.0)), float(spec.get("railInset", 0.25))) if spec.get("rail") else []
            for line in lines:
                edges.append(line)
                n_rail += 1
                if ctx.layers.get("walls") is not None:
                    ctx.layers["walls"].append({"p": flat(line), "k": "handrail", "h": spec.get("height", 1.1), "t": 0.06, "m": FACADES.index("metal_panel"),
                                                "rail": spec["rail"], "n": a["tags"].get("name", "")})
                for key, dflt in (("lamps", "lamp_lantern"), ("planters", "planter")):   # furniture on the rail line, each its own spacing and offset
                    lp = spec.get(key)
                    if not lp:
                        continue
                    sp = float(lp.get("spacing", 24))
                    for x, z, bearing in along(line, sp, float(lp.get("start", sp / 2))):
                        nx, nz = math.cos(math.radians(bearing)), math.sin(math.radians(bearing))      # across the line: step towards the deck
                        off = float(lp.get("offset", 0.9))
                        for sgn in (1, -1):
                            q = (x + sgn * nx * off, z + sgn * nz * off)
                            if inside(q, ring) and not any(inside(q, h) for h in holes):
                                lamps.append((lp.get("kind", dflt), q[0], q[1], bearing))
                                break
    if recs:
        ctx.rules["terraces"] = ("Terrace rules of the place file: the matched pedestrian area is drawn as a deck of boards (`terraces`, board width "
                                 "and direction from the rule), its edges where the ground outside is lower than inside by the rule's drop within 4 m "
                                 f"carry a balustrade (written as wall records with `rail`; {n_rail} runs) and lamps stand on that line every rule spacing m.")
    return {"terraces": recs} if recs else {}
