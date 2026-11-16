"""Buildings: one record per outline and per building part."""
from __future__ import annotations

from . import parts as parts_mod
from .geom import flat, num

SMALL = {"garage", "garages", "shed", "hut", "roof", "kiosk", "carport", "service"}
TALL = {"church", "cathedral", "chapel"}
CIVIC = {"hotel", "civic", "school", "university", "government", "public", "college", "hospital"}


def build(ctx) -> dict:
    ctx.rules["building_height"] = ("OSM height, else building:levels × 3.2 m, else by kind: church/cathedral/chapel 18 m, "
                                    "hotel/civic/school/university/government/public 16 m, garage/shed/hut/roof/kiosk 3 m, "
                                    "footprint over 1500 m² 15 m, footprint under 40 m² 4 m, otherwise 10.5 m (three storeys). "
                                    "`hs` says which: tag, levels or rule.")
    ctx.rules["roof"] = "OSM roof:shape and roof:height where tagged; otherwise the loader chooses (the engine's scene loader)."
    ground = ctx.ground
    buildings, parts = [], []
    for ft in ctx.features["buildings"]:
        t, ring, kind, area = ft["tags"], ft["ring"], ft["kind"], ft["area"]
        h, src = num(t.get("height")), "tag"
        lv = num(t.get("building:levels"))
        if h is None and lv is not None:
            h, src = lv * 3.2, "levels"
        if h is None:
            src = "rule"
            h = 18.0 if kind in TALL else 16.0 if kind in CIVIC else 3.0 if kind in SMALL else 15.0 if area > 1500 else 4.0 if area < 40 else 10.5
        b = {"r": flat(ring), "h": round(max(2.0, h), 1), "hs": src, "g": round(min(ground(p[0], p[1]) for p in ring), 1)}
        if ft["holes"]:
            b["holes"] = [flat(hh) for hh in ft["holes"]]
        mh = num(t.get("min_height"))
        if mh is None and num(t.get("building:min_level")) is not None:
            mh = num(t.get("building:min_level")) * 3.2
        if mh:
            b["mh"] = round(mh, 1)
        if lv is not None:
            b["lv"] = int(lv)
        if kind and kind != "yes":
            b["k"] = kind
        for src_key, key in (("roof:shape", "roof"), ("roof:colour", "rc"), ("roof:material", "rm"), ("building:colour", "col"),
                             ("building:material", "mat"), ("name", "n"), ("roof:orientation", "ro")):
            if t.get(src_key):
                b[key] = t[src_key]
        if num(t.get("roof:height")) is not None:
            b["rh"] = round(num(t.get("roof:height")), 1)
        (parts if ft["is_part"] else buildings).append(b)
    parts_mod.mark(buildings, parts)
    return {"buildings": buildings + parts}
