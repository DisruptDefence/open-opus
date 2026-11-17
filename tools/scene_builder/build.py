"""The build: place + style + open data -> one scene file."""
from __future__ import annotations

import datetime
import json
import sys
import urllib.parse
from pathlib import Path

from . import buildings, fetch, geo, ground, landmarks, osm, place as place_mod, props, style as style_mod, terrace, terrain, trees, walls
from . import streetlife
from .ctx import Ctx

REPO = Path(__file__).resolve().parent.parent.parent

SIMPLIFY_RULE = "Rings and lines simplified to 0.25 m (Douglas-Peucker), coordinates rounded to 0.1 m."


def build(place_path: Path, cache_dir: Path | None, offline: bool, out: Path | None = None,
          styles_dir: Path | None = None) -> dict:
    pl = place_mod.load(place_path)
    st = style_mod.load(pl.style, styles_dir or REPO / "styles")
    ext, e0, n0 = pl.ext, pl.e0, pl.n0

    corners = [pl.geo(x, z) for x in (ext["minX"], ext["maxX"]) for z in (ext["minZ"], ext["maxZ"])]
    s, n = min(c[0] for c in corners), max(c[0] for c in corners)
    w, e = min(c[1] for c in corners), max(c[1] for c in corners)
    lam = [geo.to_lambert(la, lo) for la, lo in corners]
    bb = (min(p[0] for p in lam) - 6, min(p[1] for p in lam) - 6, max(p[0] for p in lam) + 6, max(p[1] for p in lam) + 6)

    cache = fetch.Cache(cache_dir, offline)
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    osm_raw = cache.get("osm.json", fetch.OVERPASS, urllib.parse.urlencode({"data": fetch.overpass_query(s, w, n, e)}).encode())
    dtm_raw = cache.get("hrdem-dtm.tif", fetch.hrdem_url("dtm", bb))
    dsm_raw = cache.get("hrdem-dsm.tif", fetch.hrdem_url("dsm", bb))
    enrich = [fetch.enricher_bytes(cache, i, spec) for i, spec in enumerate(pl.enrichers)]  # noqa: F841 (read by layer modules)
    osm_doc = json.loads(osm_raw)
    osm_date = (osm_doc.get("osm3s") or {}).get("timestamp_osm_base", now)
    stamp = cache.stamp(osm_date if offline else now)
    cache.save_meta(stamp)

    ter, dsm = terrain.load(dtm_raw, dsm_raw, pl)
    ctx = Ctx(place=pl, style=st, osm=osm_doc["elements"], game=pl.game, geo=pl.geo, ground=ter.ground,
              surface_height=(dsm.at if dsm else (lambda x, z: None)), ext=ext, play=pl.play, carve=ter.carve)
    ctx.surface_model = dsm is not None
    if dsm is None:
        print("warning: no surface model here, heights come from tags and rules", file=sys.stderr)

    osm.classify(ctx, ground.ROAD_WIDTH)
    layers: dict = {}
    for mod in (ground, walls, terrace, trees, props, landmarks):
        layers.update(mod.build(ctx))
        ctx.layers = layers
    layers.update(streetlife.build(ctx))   # parked vehicles and bystanders by rule: appended to the props layer (sources 4 and 5)
    layers.update(buildings.build(ctx))
    ctx.rules["simplify"] = SIMPLIFY_RULE

    sources = [
        {"name": "OpenStreetMap", "via": "Overpass API", "licence": "ODbL 1.0", "licenceUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
         "attribution": "© OpenStreetMap contributors", "url": "https://www.openstreetmap.org/copyright", "extract": osm_date,
         "fetched": stamp, "bbox": [round(s, 6), round(w, 6), round(n, 6), round(e, 6)],
         "layers": ["buildings", "roads", "areas", "walls", "gates", "green", "water", "trees", "landmarks"]},
        {"name": "HRDEM Mosaic (CanElevation Series), terrain model", "via": "NRCan WCS", "licence": "Open Government Licence – Canada",
         "licenceUrl": "https://open.canada.ca/en/open-government-licence-canada",
         "attribution": "Contains information licensed under the Open Government Licence – Canada.",
         "url": "https://open.canada.ca/data/dataset/0fe65119-e96e-4a57-8bfe-9d9245fba06b", "fetched": stamp, "layers": ["terrain"]},
    ] + ctx.sources

    scene = {
        "format": "opus-scene/1", "formatMinor": 1, "packaging": "single", "id": pl.id, "name": pl.name,
        "georef": pl.georef(), "play": pl.play, "extent": ext,
        "season": pl.season,
    }
    if pl.ambience:
        scene["ambience"] = pl.ambience
    scene["style"] = st.client()
    scene.update({"sources": sources, "rules": ctx.rules, "terrain": ter.scene_block()})
    for k in ("water", "buildings", "roads", "areas", "crossings", "walls", "gates", "green", "trees", "landmarks", "props", "terraces"):
        if k in layers:
            scene[k] = layers[k]

    out = out or REPO / "scenes" / f"{pl.id}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(scene, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    bl = scene["buildings"]
    summary = {
        "out": str(out), "bytes": out.stat().st_size, "anchor": scene["georef"]["anchor"], "easting": e0, "northing": n0,
        "zone": f"{pl.zone}{pl.band}", "osm_extract": osm_date, "terrain": [ter.nx, ter.nz, round(ter.lo, 1), round(ter.hi, 1)],
        "buildings": sum(1 for b in bl if not b.get("part")), "parts": sum(1 for b in bl if b.get("part")),
        "height_source": {k: sum(1 for b in bl if b["hs"] == k) for k in ("measured", "tag", "levels", "rule")},
        "roads": len(scene["roads"]), "areas": len(scene["areas"]), "walls": len(scene["walls"]), "gates": len(scene["gates"]),
        "green": len(scene["green"]), "water": len(scene["water"]["polygons"]), "trees": len(scene["trees"]),
        "landmarks": len(scene["landmarks"])}
    summary.update(getattr(ctx, "stats", {}))
    return summary


def regeoref(path: Path) -> None:
    """Rewrite only the georeference of an existing scene file (no download): for a change of spelling."""
    scene = json.loads(path.read_text(encoding="utf-8"))
    g = scene["georef"]
    scene["georef"] = geo.georef_block(g["easting"], g["northing"], g["zone"], scene["play"], scene["extent"], g["vertical"])
    path.write_text(json.dumps(scene, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps(scene["georef"], ensure_ascii=False, indent=1))
