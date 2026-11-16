"""Building parts: an outline whose ring holds the centre of a part is drawn from its parts (OSM "Simple 3D
Buildings"). Landmarks from parts are item 9 of docs/plans/SCENE-DETAIL.md."""
from __future__ import annotations

from .geom import centroid, inside, unflat


def mark(buildings: list, parts: list) -> None:
    centres = [centroid(unflat(p["r"])) for p in parts]
    for b in buildings:
        ring, xs, zs = unflat(b["r"]), b["r"][0::2], b["r"][1::2]
        if any(min(xs) <= c[0] <= max(xs) and min(zs) <= c[1] <= max(zs) and inside(c, ring) for c in centres):
            b["parts"] = 1
    for p in parts:
        p["part"] = 1
