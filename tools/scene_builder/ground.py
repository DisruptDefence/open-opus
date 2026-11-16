"""Ground layers: roads and paths, squares (highway areas), green areas, water. Crossings, sidewalks and steps
are item 6 of docs/plans/SCENE-DETAIL.md."""
from __future__ import annotations

from .geom import flat, num

ROAD_WIDTH = {
    "primary": 10, "primary_link": 8, "secondary": 9, "secondary_link": 7, "tertiary": 8, "tertiary_link": 7,
    "residential": 7, "unclassified": 7, "living_street": 6, "service": 4, "pedestrian": 6, "footway": 2.6,
    "path": 2, "steps": 3, "cycleway": 2.5, "track": 3, "corridor": 2,
}


def build(ctx) -> dict:
    f = ctx.features
    ctx.rules["road_width"] = "OSM width, else by class (ROAD_WIDTH in tools/scene_builder/ground.py)."
    ctx.rules["water"] = ("OSM water polygons that close inside the data box; the river level is y = 0 (terrain cells under "
                          "0.8 m are river in HRDEM here).")
    roads = []
    for rd in f["roads"]:
        t, hw = rd["tags"], rd["tags"]["highway"]
        r = {"p": flat(rd["pts"]), "k": hw, "w": round(num(t.get("width")) or ROAD_WIDTH[hw], 1)}
        for src_key, key in (("name", "n"), ("surface", "s"), ("bridge", "br"), ("tunnel", "tn"), ("covered", "cv")):
            if t.get(src_key):
                r[key] = t[src_key]
        roads.append(r)
    areas = []
    for a in f["areas"]:
        rec = {"r": flat(a["ring"]), "k": a["tags"]["highway"], "s": a["tags"].get("surface", "")}
        if a["holes"]:
            rec["holes"] = [flat(h) for h in a["holes"]]
        if a["tags"].get("name"):
            rec["n"] = a["tags"]["name"]
        areas.append(rec)
    green = []
    for g in f["green"]:
        rec = {"r": flat(g["ring"]), "k": g["kind"]}
        if g["holes"]:
            rec["holes"] = [flat(h) for h in g["holes"]]
        if g["tags"].get("name"):
            rec["n"] = g["tags"]["name"]
        green.append(rec)
    water = [{"r": flat(w["ring"]), "n": w["tags"].get("name", "")} for w in f["water"]]
    return {"water": {"level": 0.0, "polygons": water}, "roads": roads, "areas": areas, "green": green}
