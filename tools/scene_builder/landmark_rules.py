"""Place-level landmark rules (docs/plans/SCENE-DETAIL.md item 9): what a place file says about one named building so
that it is drawn as itself and not as a box. The rules are DATA in `places/<id>.json` under `landmarks`; this module
knows no place. A rule names the building it applies to (`match`: an OSM `osm` "type/id", a `wikidata` id or a
`name`) and may carry:

  fill     the part of the outline that no building:part covers becomes parts of its own (measured like any part), so
           a wing that is mapped as outline only is not left a hole once the outline is skipped
  set      look of the building and all its parts: facade, palette (indices into the pack's list), roofMat, roofColor
           ("style" = take the pack's roof colours, not the tagged one), look (a name in the style's `looks`)
  turrets  round corner turrets with conical roofs on the outer corners of the parts (the OSM data has none)
  source   where the numbers come from (kept in `rules`)

Everything a rule adds that no source measured is marked: a synthetic part carries `syn: 1` and `hs: "rule"`, and
`rules.landmarks` lists each one, so the estimated is never silent."""
from __future__ import annotations

import math

from .geom import bbox, centroid, flat, inside, ring_area, seg_dist, simplify
from .style import FACADES, ROOF_MATS, ROOF_SHAPES

CELL = 0.5            # m: the raster the uncovered remainder is cut on
MIN_FILL = 60.0       # m²: a remainder smaller than this is left out
MIN_WIDTH = 3.5       # m: and one narrower than this (an erosion of 1.75 m must leave something)
Pt = tuple[float, float]


def rules_of(ctx) -> list[dict]:
    pl = getattr(ctx, "place", None)
    return list((getattr(pl, "raw", None) or {}).get("landmarks") or [])


def _matches(rule: dict, ft: dict) -> bool:
    m = rule.get("match") or {}
    if ft["is_part"]:
        return False
    t, src = ft["tags"], ft["src"]
    if "osm" in m and f"{src[0]}/{src[1]}" != m["osm"]:
        return False
    if "wikidata" in m and t.get("wikidata") != m["wikidata"]:
        return False
    if "name" in m and t.get("name") != m["name"]:
        return False
    return bool(m)


def children_of(fts: list[dict], o: int) -> list[int]:
    ring = fts[o]["ring"]
    x0, z0, x1, z1 = bbox(ring)
    out = []
    for i, ft in enumerate(fts):
        c = ft["centroid"]
        if ft["is_part"] and x0 <= c[0] <= x1 and z0 <= c[1] <= z1 and inside(c, ring):
            out.append(i)
    return out


# ── the remainder: outline minus parts ──────────────────────────────────────────────────────────────────────────
def _near_ring(p: Pt, ring: list[Pt], d: float) -> bool:
    return any(seg_dist(p[0], p[1], a[0], a[1], b[0], b[1]) < d for a, b in zip(ring, ring[1:] + ring[:1]))


def remainder(outline: list[Pt], holes: list[list[Pt]], parts: list[list[Pt]]) -> list[tuple[list[Pt], list[list[Pt]]]]:
    """The area of `outline` (less its holes) that no ring of `parts` covers, as (ring, holes) polygons: found on a
    0.5 m raster, traced, simplified to 0.6 m."""
    x0, z0, x1, z1 = bbox(outline)
    nx, nz = int((x1 - x0) / CELL) + 2, int((z1 - z0) / CELL) + 2
    boxes = [bbox(p) for p in parts]
    cells: set[tuple[int, int]] = set()
    for j in range(nz):
        for i in range(nx):
            p = (x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL)
            if not inside(p, outline) or any(inside(p, h) for h in holes):
                continue
            covered = False
            for (bx0, bz0, bx1, bz1), r in zip(boxes, parts):
                if bx0 - 0.4 <= p[0] <= bx1 + 0.4 and bz0 - 0.4 <= p[1] <= bz1 + 0.4 and (inside(p, r) or _near_ring(p, r, 0.4)):
                    covered = True
                    break
            if not covered:
                cells.add((i, j))
    # erode by 3 cells so strips between two parts, left by an inexact map, do not become buildings
    k = int(MIN_WIDTH / 2 / CELL)
    core = {c for c in cells if all((c[0] + a, c[1] + b) in cells for a in range(-k, k + 1) for b in range(-k, k + 1))}
    keep, seen = set(), set()
    for c in core:                                   # grow the core back to the cells it came from
        if c in seen:
            continue
        stack, comp = [c], []
        seen.add(c)
        while stack:
            q = stack.pop()
            comp.append(q)
            for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (q[0] + d[0], q[1] + d[1])
                if n in core and n not in seen:
                    seen.add(n)
                    stack.append(n)
        if len(comp) * CELL * CELL >= MIN_FILL * 0.4:
            for q in comp:
                for a in range(-k, k + 1):
                    for b in range(-k, k + 1):
                        if (q[0] + a, q[1] + b) in cells:
                            keep.add((q[0] + a, q[1] + b))
    loops = _trace(keep)
    polys = []
    for lp in loops:
        pts = simplify([(x0 + u * CELL, z0 + v * CELL) for u, v in lp], 0.6)
        if len(pts) >= 3:
            polys.append(pts)
    if not polys:
        return []
    sign = 1 if ring_area(max(polys, key=lambda q: abs(ring_area(q)))) > 0 else -1   # the biggest loop is an outer; holes run the other way
    outers = [p for p in polys if ring_area(p) * sign > 0]
    holes_out = [p for p in polys if ring_area(p) * sign < 0]
    res = []
    for o in outers:
        if abs(ring_area(o)) < MIN_FILL:
            continue
        res.append((o, [h for h in holes_out if inside(centroid(h), o)]))
    return res


def _trace(cells: set[tuple[int, int]]) -> list[list[tuple[int, int]]]:
    """Boundary loops of a set of unit cells, corners in cell units. Outer loops and hole loops run in opposite directions."""
    nxt: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for (i, j) in cells:
        if (i, j - 1) not in cells:
            nxt.setdefault((i, j), []).append((i + 1, j))
        if (i + 1, j) not in cells:
            nxt.setdefault((i + 1, j), []).append((i + 1, j + 1))
        if (i, j + 1) not in cells:
            nxt.setdefault((i + 1, j + 1), []).append((i, j + 1))
        if (i - 1, j) not in cells:
            nxt.setdefault((i, j + 1), []).append((i, j))
    loops = []
    while nxt:
        start = next(iter(nxt))
        lp, cur, prev = [start], start, None
        while True:
            outs = nxt.get(cur)
            if not outs:
                break
            if len(outs) > 1 and prev is not None:       # a pinch: turn the same way as the loop came in (keeps loops simple)
                dx, dz = cur[0] - prev[0], cur[1] - prev[1]
                outs.sort(key=lambda o: (dx * (o[1] - cur[1]) - dz * (o[0] - cur[0])))
            n = outs.pop(0)
            if not outs:
                del nxt[cur]
            prev, cur = cur, n
            if cur == start:
                break
            lp.append(cur)
        if len(lp) >= 4:
            loops.append(lp)
    return loops


# ── turrets ─────────────────────────────────────────────────────────────────────────────────────────────────────
def _angle_deg(a: Pt, b: Pt, c: Pt) -> float:
    v1, v2 = (a[0] - b[0], a[1] - b[1]), (c[0] - b[0], c[1] - b[1])
    n = math.hypot(*v1) * math.hypot(*v2)
    return 180.0 if n < 1e-9 else math.degrees(math.acos(max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / n))))


def turret_sites(rings: list[list[Pt]], outline: list[Pt], holes: list[list[Pt]], spec: dict) -> list[tuple[Pt, int]]:
    """(centre, index of the part ring) for each outer corner that takes a turret: an angle within `cornerDeg`, both
    edges at least `minEdge` long, on the outline or a courtyard wall, not inside another part, not within 2 radii of
    a turret already placed. Corners are taken part by part in the order the file lists them, so a rebuild is the same."""
    r, lo, hi = float(spec.get("radius", 3.0)), *spec.get("cornerDeg", [75, 105])
    min_edge, inset, cap = float(spec.get("minEdge", 9.0)), float(spec.get("inset", 0.7)), int(spec.get("max", 12))
    walls = [outline] + holes
    sites: list[tuple[Pt, int]] = []
    for k, ring in enumerate(rings):
        n = len(ring)
        sg = 1 if ring_area(ring) > 0 else -1
        for i in range(n):
            a, b, c = ring[i - 1], ring[i], ring[(i + 1) % n]
            if math.hypot(b[0] - a[0], b[1] - a[1]) < min_edge or math.hypot(c[0] - b[0], c[1] - b[1]) < min_edge:
                continue
            ang = _angle_deg(a, b, c)
            cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
            if not lo <= ang <= hi or cross * sg <= 0:       # convex corners only
                continue
            if not any(_near_ring(b, w, 1.5) for w in walls):
                continue
            u1, u2 = (a[0] - b[0], a[1] - b[1]), (c[0] - b[0], c[1] - b[1])
            l1, l2 = math.hypot(*u1), math.hypot(*u2)
            bis = (u1[0] / l1 + u2[0] / l2, u1[1] / l1 + u2[1] / l2)
            lb = math.hypot(*bis)
            if lb < 1e-6:
                continue
            ctr = (b[0] + bis[0] / lb * inset * r, b[1] + bis[1] / lb * inset * r)
            if any(j != k and _deeper(ctr, rings[j], 1.0) for j in range(len(rings))):
                continue
            if any(math.hypot(ctr[0] - s[0][0], ctr[1] - s[0][1]) < 2 * r + 0.5 for s in sites):
                continue
            sites.append((ctr, k))
            if len(sites) >= cap:
                return sites
    return sites


def _deeper(p: Pt, ring: list[Pt], d: float) -> bool:
    """p lies inside ring by more than d."""
    return inside(p, ring) and not _near_ring(p, ring, d)


def circle(c: Pt, r: float, sides: int) -> list[Pt]:
    return [(round(c[0] + r * math.cos(2 * math.pi * k / sides), 2), round(c[1] + r * math.sin(2 * math.pi * k / sides), 2)) for k in range(sides)]


# ── the two entry points buildings.build calls ──────────────────────────────────────────────────────────────────
def expand(ctx, fts: list[dict]) -> list[dict]:
    from .buildings import fnv1a32
    """Before the records are made: add the parts that fill what the mapped parts leave uncovered. Returns the rules
    that found their building, each with `outline` and `children` (indices into `fts`, the added ones included)."""
    found = []
    for rule in rules_of(ctx):
        hits = [i for i, ft in enumerate(fts) if _matches(rule, ft)]
        if not hits:
            continue
        o = hits[0]
        kids = children_of(fts, o)
        info = {"rule": rule, "outline": o, "children": kids, "added": []}
        if rule.get("fill") and kids:
            out = fts[o]
            added = []
            for n, (ring, holes) in enumerate(remainder(out["ring"], out["holes"], [fts[k]["ring"] for k in kids])):
                tags = {k: v for k, v in out["tags"].items() if k in ("roof:colour", "roof:material", "building:levels")}
                tags["building:part"] = "yes"
                if rule["fill"].get("roof"):
                    tags["roof:shape"] = rule["fill"]["roof"]
                ft = {"src": ("landmark", fnv1a32(f"{rule.get('id', 'lm')}-fill"), n), "tags": tags, "ring": ring, "holes": holes,
                      "centroid": centroid(ring), "area": abs(ring_area(ring)), "is_part": True, "kind": out["kind"], "syn": True}
                fts.append(ft)
                added.append(len(fts) - 1)
            info["added"], info["children"] = added, kids + added
        found.append(info)
    return found


def finish(ctx, fts: list[dict], recs: dict[int, dict], found: list[dict], ids_used: set[int]) -> list[dict]:
    """After the records are made (`recs`: ft index -> record): apply `set`, mark the estimated, add the turrets.
    Returns the new records."""
    from .buildings import fnv1a32
    new: list[dict] = []
    notes: list[str] = []
    for info in found:
        rule = info["rule"]
        st = rule.get("set") or {}
        kids = [recs[k] for k in info["children"] if k in recs]
        for b in kids:
            rnd = ctx.rng(b["id"])
            if "facade" in st:
                b["fa"] = FACADES.index(st["facade"])
            if "palette" in st:
                b["pal"] = rnd.choice(st["palette"]) if isinstance(st["palette"], list) else int(st["palette"])
            if "roofMat" in st:
                b["rmt"] = ROOF_MATS.index(st["roofMat"])
                client = ctx.style.pack["client"]["roofs"].get(st["roofMat"]) or []
                b["rp"] = rnd.randrange(len(client)) if client else 0
            if st.get("roofColor") == "style":
                b.pop("rc", None)
            if st.get("look"):
                b["lm"] = st["look"]
            b["lmid"] = rule.get("id", "")
        for k in info["added"]:
            if k in recs:
                recs[k]["syn"] = 1
                recs[k]["hs"] = recs[k]["hs"]       # a fill part is measured like any part; `syn` says its outline is estimated
        if info["added"]:
            notes.append(f"{rule.get('id')}: {len(info['added'])} part(s) fill the outline's uncovered area "
                         f"({sum(round(abs(ring_area(fts[k]['ring']))) for k in info['added'])} m²), measured like any part")
        sp = rule.get("turrets")
        if sp and kids:
            rings = [fts[k]["ring"] for k in info["children"] if k in recs and recs[k].get("h", 0) <= float(sp.get("hMax", 60))]
            idx = [k for k in info["children"] if k in recs and recs[k].get("h", 0) <= float(sp.get("hMax", 60))]
            sites = turret_sites(rings, fts[info["outline"]]["ring"], fts[info["outline"]]["holes"], sp)
            r, sides = float(sp.get("radius", 3.0)), int(sp.get("sides", 16))
            for n, (ctr, k) in enumerate(sites):
                host = recs[idx[k]]
                ring = circle(ctr, r, sides)
                g = min(ctx.ground(p[0], p[1]) for p in ring)
                eave_abs = host["g"] + host["h"] - host.get("rh", 0.0) + float(sp.get("above", 2.5))
                eave = max(4.0, eave_abs - g)
                cone = float(sp.get("cone", 8.0))
                bid = fnv1a32(f"landmark/{rule.get('id')}-turret/{n}") or 1
                while bid in ids_used:
                    bid = (bid + 1) & 0xFFFFFFFF
                ids_used.add(bid)
                rec = {"id": bid, "r": flat(ring), "g": round(g, 1), "h": round(eave + cone, 1), "hs": "rule", "rh": round(cone, 1),
                       "rs": ROOF_SHAPES.index("cone"), "rd": 255, "rmt": host["rmt"], "rp": host["rp"], "fa": host["fa"], "pal": host["pal"],
                       "use": host["use"], "lv": max(2, round(eave / ctx.style.storey)), "gf": 0, "part": 1, "syn": 1, "lm": sp.get("look", "turret"),
                       "lmid": rule.get("id", "")}
                if "rc" in host:
                    rec["rc"] = host["rc"]
                new.append(rec)
            if sites:
                notes.append(f"{rule.get('id')}: {len(sites)} round corner turrets (radius {r} m, conical roof {cone} m) are an estimate: "
                             f"the map has none; they stand on the outer corners of the parts between {sp.get('cornerDeg', [75, 105])} degrees")
        if rule.get("source"):
            notes.append(f"{rule.get('id')}: {rule['source']}")
    if notes:
        ctx.rules["landmarks"] = "Place landmark rules (places/<id>.json `landmarks`): " + " | ".join(notes)
    return new
