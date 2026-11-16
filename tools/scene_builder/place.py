"""A place: `places/<id>.json`. Name, anchor, box, sources, style pack, optional enrichers. UTM zone, band and
convergence come from the anchor; the anchor is snapped to a whole UTM metre."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from . import geo

REQUIRED = ("id", "name", "anchor", "play", "terrain", "vertical", "style")


@dataclass
class Place:
    raw: dict
    zone: int
    band: str
    e0: int
    n0: int
    lat0: float
    lon0: float
    play: dict
    ext: dict
    id: str = ""
    name: str = ""
    style: str = ""
    season: str = "summer"
    cell: float = 2.5
    vertical: dict = field(default_factory=dict)
    ambience: dict | None = None
    enrichers: list = field(default_factory=list)

    def game(self, lat: float, lon: float) -> tuple[float, float]:
        e, n = geo.to_utm(lat, lon, self.zone)
        return e - self.e0, -(n - self.n0)

    def geo(self, x: float, z: float) -> tuple[float, float]:
        return geo.from_utm(self.e0 + x, self.n0 - z, self.zone)

    def georef(self) -> dict:
        return geo.georef_block(self.e0, self.n0, self.zone, self.play, self.ext, self.vertical)


def from_dict(raw: dict) -> Place:
    for k in REQUIRED:
        if k not in raw:
            raise SystemExit(f"place: missing key '{k}'")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", raw["id"]):
        raise SystemExit("place: id must be lower-case letters, digits and hyphens")
    a, p = raw["anchor"], raw["play"]
    if not (-84 < a["lat"] < 84 and a["lat"] > 0):
        raise SystemExit("place: the anchor must be in the northern hemisphere")
    zone = geo.zone_of(a["lon"])
    e0, n0 = (round(v) for v in geo.to_utm(a["lat"], a["lon"], zone))
    lat0, lon0 = geo.from_utm(e0, n0, zone)
    hw, hh, margin = float(p["halfWidth"]), float(p["halfHeight"]), float(raw.get("margin", 120))
    play = {"minX": -hw, "maxX": hw, "minZ": -hh, "maxZ": hh}
    ext = {"minX": -hw - margin, "maxX": hw + margin, "minZ": -hh - margin, "maxZ": hh + margin}
    t = raw["terrain"]
    if t.get("source", "hrdem") != "hrdem":
        raise SystemExit("place: terrain.source must be 'hrdem'")
    if "geoid_undulation" not in raw["vertical"]:
        raise SystemExit("place: vertical.geoid_undulation is required (docs/SCENE-FORMAT.md 2.2)")
    return Place(raw=raw, zone=zone, band=geo.band_of(lat0), e0=e0, n0=n0, lat0=lat0, lon0=lon0, play=play, ext=ext,
                 id=raw["id"], name=raw["name"], style=raw["style"], season=raw.get("season", "summer"),
                 cell=float(t.get("cell", 2.5)), vertical=raw["vertical"], ambience=raw.get("ambience"),
                 enrichers=list(raw.get("enrichers", [])))


def load(path: Path) -> Place:
    return from_dict(json.loads(Path(path).read_text(encoding="utf-8")))
