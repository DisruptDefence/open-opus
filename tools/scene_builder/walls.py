"""Walls and barriers, and city gates. Thickness, materials, parapets and gates as arches are item 7."""
from __future__ import annotations

from .geom import flat, num


def build(ctx) -> dict:
    ctx.rules["wall_height"] = "OSM height, else city wall 6 m, retaining wall parapet 1.1 m, wall 2 m, fence and rails 1.1 m."
    walls = []
    for w in ctx.features["walls"]:
        t, bar = w["tags"], w["tags"]["barrier"]
        default = {"city_wall": 6.0, "retaining_wall": 1.1, "wall": 2.0, "hedge": 1.4}.get(bar, 1.1)
        rec = {"p": flat(w["pts"]), "k": bar, "h": round(num(t.get("height")) or default, 1)}
        if t.get("name"):
            rec["n"] = t["name"]
        walls.append(rec)
    gates = [{"n": g["n"], "x": round(g["x"], 1), "z": round(g["z"], 1)} for g in ctx.features["gates"]]
    return {"walls": walls, "gates": gates}
