#!/usr/bin/env python3
"""Build a scene file for the game from open data. Standard library only.

    python3 tools/build-scene.py --place places/<id>.json --cache DIR            # fetch (what the cache lacks), then write scenes/<id>.json
    python3 tools/build-scene.py --place places/<id>.json --cache DIR --offline  # rebuild from the cache, no network

A place file (`places/<id>.json`) names the anchor, the box, the terrain cell, the style pack and any enrichers; a
style pack (`styles/<name>.json`) says what buildings, streets and trees look like in a region. Nothing about one
place is in this code (docs/plans/SCENE-DETAIL.md section 2).

Reads
  OpenStreetMap through the Overpass API (ODbL, "© OpenStreetMap contributors"): everything tagged in the box.
  HRDEM mosaic of Natural Resources Canada through its WCS (Open Government Licence – Canada), 1 m: the bare-earth
  height (`dtm`) for the terrain and the surface height (`dsm`) that measures buildings.

Writes
  One JSON file in real UTM metres (zone from the anchor, WGS 84): game x = easting − anchor easting, game z =
  −(northing − anchor northing), game y = height above the vertical datum. The scene holds the place only: where a
  mission starts and what its objectives are belongs to a scenario. Rules where OpenStreetMap is silent are written
  into the scene's `rules`.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from scene_builder import build as builder  # noqa: E402

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--place", type=Path, help="the place file, places/<id>.json")
    ap.add_argument("--out", type=Path, help="default: scenes/<place id>.json")
    ap.add_argument("--cache", type=Path, help="directory for the raw downloads (osm.json, hrdem-dtm.tif, hrdem-dsm.tif, meta.json)")
    ap.add_argument("--offline", action="store_true", help="use the cache only")
    ap.add_argument("--georef-only", action="store_true", help="rewrite the georeference block of the existing --out file, nothing else")
    a = ap.parse_args()
    if a.georef_only:
        if not a.out:
            ap.error("--georef-only needs --out")
        builder.regeoref(a.out)
    else:
        if not a.place:
            ap.error("--place is required")
        print(json.dumps(builder.build(a.place, a.cache, a.offline, a.out), ensure_ascii=False, indent=1))
