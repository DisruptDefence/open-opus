"""OpenStreetMap elements -> typed features in game metres, in the order the elements come (so a rebuild from the
same extract is byte-identical). The layer modules turn features into scene records.

Relations are read for buildings, pedestrian areas, parks and gardens and named landmarks only, as the first
builder's query did; water and land-use relations are not read."""
from __future__ import annotations

import math

from .geom import centroid, clean_ring, inside, join_rings, ring_area, simplify

LANDMARK_TOURISM = {"attraction", "hotel", "museum", "viewpoint", "artwork"}
LANDMARK_AMENITY = {"place_of_worship", "townhall", "theatre", "library", "university"}
GREEN_KINDS = {"park", "garden", "playground", "pitch", "grass", "cemetery", "forest", "village_green", "recreation_ground",
               "wood", "scrub"}
BARRIERS = ("city_wall", "retaining_wall", "wall", "fence", "guard_rail", "handrail", "hedge")
# a point of interest that makes a building commercial (docs/plans/SCENE-DETAIL.md item 2, step 9)
POI_AMENITY = {"restaurant", "cafe", "bar", "pub", "fast_food", "bank", "pharmacy"}
POI_TOURISM = {"hotel", "museum"}


def is_poi(t: dict) -> bool:
    return bool(t.get("shop")) or t.get("amenity") in POI_AMENITY or t.get("tourism") in POI_TOURISM


def landmark_ok(t: dict) -> bool:
    return bool(t.get("historic")) or t.get("tourism") in LANDMARK_TOURISM or t.get("amenity") in LANDMARK_AMENITY \
        or t.get("place") == "square"


def classify(ctx, road_width: dict) -> dict:
    game, ext = ctx.game, ctx.ext

    def pts(geom: list) -> list[tuple[float, float]]:
        return [game(g["lat"], g["lon"]) for g in geom if g]

    def in_ext(p: tuple[float, float], pad: float = 0.0) -> bool:
        return ext["minX"] - pad <= p[0] <= ext["maxX"] + pad and ext["minZ"] - pad <= p[1] <= ext["maxZ"] + pad

    def polygons(el: dict) -> list[tuple[list, list]]:
        """(outer ring, holes) for a closed way or a multipolygon relation."""
        if el["type"] == "way":
            p = pts(el.get("geometry") or [])
            r = clean_ring(p) if len(p) > 3 and p[0] == p[-1] else None
            return [(r, [])] if r else []
        if el["type"] != "relation":
            return []
        outer = join_rings([pts(m["geometry"]) for m in el.get("members", []) if m.get("type") == "way" and m.get("geometry") and m.get("role") != "inner"])
        inner = join_rings([pts(m["geometry"]) for m in el.get("members", []) if m.get("type") == "way" and m.get("geometry") and m.get("role") == "inner"])
        outs = [r for r in (clean_ring(o) for o in outer) if r]
        ins = [r for r in (clean_ring(i) for i in inner) if r]
        return [(o, [h for h in ins if inside(centroid(h), o)]) for o in outs]

    f = {k: [] for k in ("buildings", "pois", "roads", "areas", "walls", "green", "water", "trees", "gates", "landmarks", "crossings", "tree_rows")}

    def landmark(el: dict, x: float, z: float, kind: str) -> None:
        f["landmarks"].append({"el": el, "x": x, "z": z, "kind": kind})

    for el in ctx.osm:
        t = el.get("tags") or {}
        rel = el["type"] == "relation"
        if el["type"] == "node":
            if "lat" not in el:
                continue
            x, z = game(el["lat"], el["lon"])
            if is_poi(t):
                f["pois"].append({"x": x, "z": z, "tags": t})
            if t.get("natural") == "tree" and in_ext((x, z)):
                f["trees"].append({"x": x, "z": z, "tags": t, "node": el["id"]})
            if t.get("highway") == "crossing" and in_ext((x, z)):  # item 6: snapped to a road by ground.py
                f["crossings"].append({"x": x, "z": z, "tags": t})
            if t.get("historic") == "city_gate" and in_ext((x, z)):
                f["gates"].append({"n": t.get("name", ""), "x": x, "z": z})
            kind = t.get("historic") or t.get("tourism") or t.get("amenity") or t.get("place")
            if kind and landmark_ok(t):
                landmark(el, x, z, kind)
            continue

        is_part = "building:part" in t and t["building:part"] != "no"
        if ("building" in t and t["building"] != "no") or is_part:
            for idx, (ring, holes) in enumerate(polygons(el)):
                c = centroid(ring)
                if not in_ext(c):
                    continue
                kind = t.get("building:part") if is_part else t.get("building")
                kind = (t.get("amenity") == "place_of_worship" and "church") or (t.get("tourism") == "hotel" and "hotel") or kind
                f["buildings"].append({"src": (el["type"], el["id"], idx), "tags": t, "ring": ring, "holes": holes, "centroid": c,
                                       "area": abs(ring_area(ring)), "is_part": is_part, "kind": kind})
                if t.get("name") and not is_part:
                    landmark(el, c[0], c[1], t.get("tourism") or t.get("amenity") or t.get("historic") or "building")
                if t.get("historic") == "city_gate":
                    f["gates"].append({"n": t.get("name", ""), "x": c[0], "z": c[1]})
            continue

        hw = t.get("highway")
        if hw:
            if rel or t.get("area") == "yes":
                if rel and hw != "pedestrian":
                    continue
                for ring, holes in polygons(el):
                    if in_ext(centroid(ring), 60):
                        f["areas"].append({"ring": ring, "holes": holes, "tags": t})
                        if t.get("name"):
                            landmark(el, *centroid(ring), "square")
                continue
            if hw not in road_width or t.get("tunnel") in ("yes", "building_passage") and hw == "corridor" or t.get("indoor") == "yes":
                continue
            p = simplify(pts(el.get("geometry") or []), 0.25)
            if len(p) < 2 or not any(in_ext(q) for q in p):
                continue
            f["roads"].append({"pts": p, "tags": t, "src": (el["type"], el["id"])})
            continue

        bar = t.get("barrier")
        if bar in BARRIERS and not rel:
            p = simplify(pts(el.get("geometry") or []), 0.25)
            if len(p) >= 2 and any(in_ext(q) for q in p):
                f["walls"].append({"pts": p, "tags": t})
            continue

        kind = t.get("leisure") or t.get("landuse") or t.get("natural")
        if kind in GREEN_KINDS and (not rel or t.get("leisure") in ("park", "garden")):
            for ring, holes in polygons(el):
                if in_ext(centroid(ring), 80):
                    f["green"].append({"ring": ring, "holes": holes, "kind": kind, "tags": t})
                    if t.get("name"):
                        landmark(el, *centroid(ring), "park")
            continue
        if kind == "water" and not rel:
            for ring, _ in polygons(el):
                f["water"].append({"ring": ring, "tags": t})
            continue
        if kind == "tree_row" and not rel:  # trees.py places them by rule (style trees.fill.rowSpacing)
            p = pts(el.get("geometry") or [])
            if len(p) >= 2 and any(in_ext(q) for q in p):
                f["tree_rows"].append({"pts": p, "tags": t})
            continue
        lk = t.get("historic") or t.get("tourism") or t.get("amenity") or t.get("place")
        if lk and t.get("name") and landmark_ok(t):
            g = [q for q in pts(el.get("geometry") or [])] or [q for m in el.get("members", []) for q in pts(m.get("geometry") or [])]
            if g:
                landmark(el, sum(q[0] for q in g) / len(g), sum(q[1] for q in g) / len(g), lk)
    ctx.features = f
    return f
