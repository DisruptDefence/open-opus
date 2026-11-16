"""Geometry helpers in game metres: rings, simplification, point tests, nearest points. Moved from the first
builder, plus `seg_dist`, `ring_edges`, `bbox` and `obb`."""
from __future__ import annotations

import math

Pt = tuple[float, float]


def ring_area(p: list[Pt]) -> float:
    return 0.5 * sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))


def centroid(p: list[Pt]) -> Pt:
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


def inside(pt: Pt, p: list[Pt]) -> bool:
    x, y, hit = pt[0], pt[1], False
    for i in range(len(p)):
        x0, y0 = p[i]
        x1, y1 = p[i - 1]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            hit = not hit
    return hit


def ring_edges(p: list[Pt]) -> list[tuple[Pt, Pt]]:
    """Edge `i` runs from vertex `i` to `i + 1`, wrapping (the numbering `blind` and `front` use)."""
    return [(p[i], p[(i + 1) % len(p)]) for i in range(len(p))]


def seg_nearest(px: float, pz: float, ax: float, az: float, bx: float, bz: float) -> Pt:
    dx, dz = bx - ax, bz - az
    l2 = dx * dx + dz * dz
    t = 0.0 if l2 < 1e-12 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / l2))
    return ax + t * dx, az + t * dz


def seg_dist(px: float, pz: float, ax: float, az: float, bx: float, bz: float) -> float:
    qx, qz = seg_nearest(px, pz, ax, az, bx, bz)
    return math.hypot(px - qx, pz - qz)


def bbox(p: list[Pt]) -> tuple[float, float, float, float]:
    xs, zs = [q[0] for q in p], [q[1] for q in p]
    return min(xs), min(zs), max(xs), max(zs)


def obb(p: list[Pt]) -> dict:
    """Oriented bounding box of least area, one frame per ring edge: centre, long axis unit (ux, uz), half sizes
    L >= W and fill = area / (4 L W). The engine uses the same rule (docs/plans/SCENE-DETAIL.md item 2, step 5)."""
    best = None
    for (ax, az), (bx, bz) in ring_edges(p):
        l = math.hypot(bx - ax, bz - az)
        if l < 1e-9:
            continue
        ux, uz = (bx - ax) / l, (bz - az) / l
        us = [(q[0] - ax) * ux + (q[1] - az) * uz for q in p]
        vs = [-(q[0] - ax) * uz + (q[1] - az) * ux for q in p]
        u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
        area = (u1 - u0) * (v1 - v0)
        if best is None or area < best[0] - 1e-9:
            best = (area, ax, az, ux, uz, u0, u1, v0, v1)
    if best is None:
        c = centroid(p)
        return {"cx": c[0], "cz": c[1], "ux": 1.0, "uz": 0.0, "L": 0.0, "W": 0.0, "fill": 0.0}
    _, ax, az, ux, uz, u0, u1, v0, v1 = best
    um, vm = (u0 + u1) / 2, (v0 + v1) / 2
    cx, cz = ax + um * ux - vm * uz, az + um * uz + vm * ux
    hl, hw = (u1 - u0) / 2, (v1 - v0) / 2
    if hw > hl:  # the long axis is the one with the larger half size
        hl, hw = hw, hl
        ux, uz = -uz, ux
    area = abs(ring_area(p))
    return {"cx": cx, "cz": cz, "ux": ux, "uz": uz, "L": hl, "W": hw, "fill": area / (4 * hl * hw) if hl * hw > 1e-9 else 0.0}


def simplify(p: list[Pt], tol: float) -> list[Pt]:
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


def clean_ring(p: list[Pt], tol: float = 0.25) -> list[Pt] | None:
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


def flat(p: list[Pt]) -> list[float]:
    return [round(v, 1) for q in p for v in q]


def unflat(v: list[float]) -> list[Pt]:
    return list(zip(v[0::2], v[1::2]))


def join_rings(ways: list[list[Pt]]) -> list[list[Pt]]:
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
