"""Named landmarks: the first named feature of each name inside the data box."""
from __future__ import annotations


def build(ctx) -> dict:
    e, seen, out = ctx.ext, set(), []
    for lm in ctx.features["landmarks"]:
        name = lm["el"].get("tags", {}).get("name")
        x, z = lm["x"], lm["z"]
        if not name or not (e["minX"] <= x <= e["maxX"] and e["minZ"] <= z <= e["maxZ"]) or name in seen:
            continue
        seen.add(name)
        el = lm["el"]
        out.append({"n": name, "k": lm["kind"], "x": round(x, 1), "z": round(z, 1), "y": round(ctx.ground(x, z), 1),
                    "osm": f"{el['type']}/{el['id']}"})
    return {"landmarks": sorted(out, key=lambda m: m["n"])}
