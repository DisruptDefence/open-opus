"""The `facades` enricher: façade colours and materials read from open-licensed photographs (docs/plans/SCENE-DETAIL.md 2.1).

A place file names it:
    { "kind": "facades", "title": ..., "licence": "derived facts; sources listed in the file", "file": "enrichers/<id>-palette-zones.json" }
`file` is relative to the place file. It holds numbers and attributions only (format `opus-facade-facts/1`, written by
`tools/lookmatch` `facts`; docs/SCENE-FORMAT.md 4.2):
    zones:     [{ id, centre: [lat, lon], radius (m), walls: [{ material, colour "#rrggbb", share }], accents: [{ colour, share }], ... }]
    buildings: [{ buildingId, material, colour, accents: ["#rrggbb"...], confidence 0..1, storeys?, windowsPerStorey?, sources }]
    sources:   [{ id, title, author, licence, licenceUrl, url }]

What it does to a building (never to one with a mapped building:material or a building:colour tag, nor to one a place's
landmark rule shaped):
  * a per-building fact (confidence at least MIN_BUILDING_CONFIDENCE) wins over any zone;
  * else the nearest zone whose disc holds the building's centroid; the building takes part with weight 1 up to 0.6 of the
    radius, falling linearly to 0 at the radius (a seeded draw), so the edge of a zone blends back to the style's own rule;
  * material from the zone's wall shares (brick -> brick, render and painted_white -> stucco, stone -> the stone class the style's
    own rule for that building gives, ashlar when its rule has none), colour from the same wall entry (so it is a colour of that
    material), written as `wc`; the façade class `fa` is changed to match;
  * accent colours: `dr` (door) from the zone's accents by share, `frm` (window frame) in 35 % of buildings.
All draws are seeded by the id of the building's outline (a part takes its outline's), so the town is the same on every build."""
from __future__ import annotations

import json
import math
import random
import re
from pathlib import Path

from .style import FACADES

FORMAT = "opus-facade-facts/1"
KIND = "facades"
HEX = re.compile(r"#[0-9a-fA-F]{6}")
MIN_BUILDING_CONFIDENCE = 0.4
FULL_WEIGHT = 0.6         # share of the radius inside which a zone's weight is 1
FRAME_CHANCE = 0.35
FA = {"brick": FACADES.index("brick"), "render": FACADES.index("stucco"), "painted_white": FACADES.index("stucco")}
STONE = (FACADES.index("stone_ashlar"), FACADES.index("stone_rubble"))
MATERIALS = set(FA) | {"stone"}


def _fnv(s: str) -> int:
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


class Facts:
    def __init__(self, zones: list, buildings: list, sources: list, title: str = "", licence: str = ""):
        self.zones, self.sources, self.title, self.licence = zones, sources, title, licence
        self.buildings = {int(b["buildingId"]): b for b in buildings}
        self.centres: list[tuple[float, float]] = []

    def locate(self, game) -> "Facts":
        """Zone centres in game metres: `game(lat, lon) -> (x, z)`."""
        self.centres = [game(z["centre"][0], z["centre"][1]) for z in self.zones]
        return self


def validate(doc: dict, where: str = "facades") -> None:
    if doc.get("format") != FORMAT:
        raise SystemExit(f"{where}: format must be {FORMAT}")
    for i, z in enumerate(doc.get("zones", [])):
        if not (isinstance(z.get("centre"), list) and len(z["centre"]) == 2 and z.get("radius", 0) > 0):
            raise SystemExit(f"{where}: zones[{i}] needs centre [lat, lon] and a radius")
        for k in ("walls", "accents"):
            for e in z.get(k, []):
                if not HEX.fullmatch(e.get("colour", "")) or not (e.get("share", 0) > 0):
                    raise SystemExit(f"{where}: zones[{i}].{k} needs a #rrggbb colour and a positive share")
        for e in z.get("walls", []):
            if e.get("material") not in MATERIALS:
                raise SystemExit(f"{where}: zones[{i}].walls material must be one of {sorted(MATERIALS)}")
    for i, b in enumerate(doc.get("buildings", [])):
        if "buildingId" not in b or (b.get("colour") and not HEX.fullmatch(b["colour"])) or (b.get("material") and b["material"] not in MATERIALS):
            raise SystemExit(f"{where}: buildings[{i}] needs a buildingId, a #rrggbb colour and a known material")


def load(specs: list, place_path: Path, game=None) -> Facts | None:
    """Every `facades` enricher of the place, merged (a later file's per-building facts win). None when there is none."""
    zones, buildings, sources, titles, licences = [], [], [], [], []
    for spec in specs:
        if spec.get("kind") != KIND:
            continue
        p = Path(place_path).parent / spec["file"]
        if not p.exists():
            raise SystemExit(f"facades enricher: {p} is missing")
        doc = json.loads(p.read_text(encoding="utf-8"))
        validate(doc, str(p))
        zones += doc.get("zones", [])
        buildings += doc.get("buildings", [])
        sources += doc.get("sources", [])
        titles.append(spec.get("title", ""))
        licences.append(spec.get("licence", ""))
    if not zones and not buildings:
        return None
    f = Facts(zones, buildings, sources, "; ".join(t for t in titles if t), "; ".join(sorted(set(l for l in licences if l))))
    return f.locate(game) if game else f


def source_entry(f: Facts) -> dict:
    """The scene `sources` entry: one per enricher set, with every photograph credited."""
    credits = [{"title": s.get("title", ""), "author": s.get("author", ""), "licence": s.get("licence", ""), "url": s.get("url", "")} for s in f.sources]
    return {"name": f.title or "Façade colours and materials from photographs", "licence": f.licence or "derived facts; sources listed",
            "attribution": "Colours and materials are numbers derived from open-licensed photographs; each photograph's author and licence is in `credits`. No photograph or part of one is included.",
            "layers": ["buildings"], "credits": credits}


def weight_at(d: float, radius: float) -> float:
    """1 up to FULL_WEIGHT of the radius, then falling linearly to 0 at the radius."""
    if d >= radius:
        return 0.0
    f = d / radius
    return 1.0 if f <= FULL_WEIGHT else (1.0 - f) / (1.0 - FULL_WEIGHT)


def _pick(entries: list, u: float) -> dict | None:
    tot = sum(e["share"] for e in entries)
    if tot <= 0:
        return None
    u *= tot
    for e in entries:
        u -= e["share"]
        if u < 0:
            return e
    return entries[-1]


def decide(f: Facts, sid: int, bid: int, x: float, z: float, style_fa: int, rule_facade: dict | None) -> dict | None:
    """What the facts say about one building: {"fa", "wc", "dr"?, "frm"?, "by": "building"|"zone:<id>"} or None (leave it to the style)."""
    rnd = random.Random(_fnv(f"facades/{sid}"))
    u_zone, u_mat, u_dr, u_fp, u_fr, u_stone = (rnd.random() for _ in range(6))   # always the same draws in the same order
    fact = f.buildings.get(bid)
    if fact and fact.get("confidence", 1.0) >= MIN_BUILDING_CONFIDENCE and fact.get("material") and fact.get("colour"):
        out = {"fa": _fa(fact["material"], style_fa, rule_facade, u_stone), "wc": fact["colour"].lower(), "by": "building"}
        acc = fact.get("accents") or []
        if acc:
            out["dr"] = acc[0].lower()
        if len(acc) > 1:
            out["frm"] = acc[1].lower()
        return out
    best, bd = None, math.inf
    for k, (cx, cz) in enumerate(f.centres):
        d = math.hypot(x - cx, z - cz)
        if d <= f.zones[k]["radius"] and d < bd:
            best, bd = k, d
    if best is None:
        return None
    zone = f.zones[best]
    if u_zone >= weight_at(bd, zone["radius"]):
        return None
    wall = _pick(zone.get("walls", []), u_mat)
    if wall is None:
        return None
    out = {"fa": _fa(wall["material"], style_fa, rule_facade, u_stone), "wc": wall["colour"].lower(), "by": f"zone:{zone.get('id', best)}"}
    acc = zone.get("accents", [])
    d = _pick(acc, u_dr)
    if d:
        out["dr"] = d["colour"].lower()
    if u_fp < FRAME_CHANCE:
        fr = _pick(acc, u_fr)
        if fr:
            out["frm"] = fr["colour"].lower()
    return out


def _fa(material: str, style_fa: int, rule_facade: dict | None, u: float) -> int:
    if material != "stone":
        return FA[material]
    if style_fa in STONE:
        return style_fa
    stones = {k: v for k, v in (rule_facade or {}).items() if k in ("stone_ashlar", "stone_rubble")}
    if not stones:
        return STONE[0]
    tot = sum(stones.values())
    u *= tot
    for k, v in stones.items():
        u -= v
        if u < 0:
            return FACADES.index(k)
    return FACADES.index(next(reversed(stones)))


def apply_layer(ctx, f: Facts, fts: list, recs: dict, ids: list, groups: list, rule_facades: dict, tagged: set) -> None:
    """Write `fa`, `wc`, `dr`, `frm` on the records the facts reach. `tagged`: ft indices with a mapped material or colour tag."""
    counts: dict[str, int] = {}
    by_building = by_zone = left = 0
    zones_used: set = set()
    for i, b in recs.items():
        if i in tagged or "lmid" in b or b.get("syn"):
            left += 1
            continue
        o = groups[i]
        x, z = fts[i]["centroid"]
        r = decide(f, ids[o], b["id"], x, z, b["fa"], rule_facades.get(i))
        if r is None:
            left += 1
            continue
        b["fa"], b["wc"] = r["fa"], r["wc"]
        for k in ("dr", "frm"):
            if k in r:
                b[k] = r[k]
        name = FACADES[r["fa"]]
        counts[name] = counts.get(name, 0) + 1
        if r["by"] == "building":
            by_building += 1
        else:
            by_zone += 1
            zones_used.add(r["by"])
    total = by_building + by_zone
    mats = ", ".join(f"{k} {v}" for k, v in sorted(counts.items()))
    ctx.rules["facade_facts"] = (
        f"Façade enricher: {total} buildings and parts took their façade class and colour (`wc`, with `dr` door and `frm` frame accents) from photographs"
        f" ({by_building} from per-building facts, {by_zone} from palette zones; by class: {mats or 'none'}); {len(zones_used)} of {len(f.zones)} zones used;"
        f" {left} left to the style's own rule (outside every zone, drawn back at a zone's edge, tagged with a material or colour, or shaped by a landmark rule)."
        " The colour is the colour of the chosen wall entry; the draw is seeded by the outline's id.")
    ctx.stats_facades = {"recoloured": total, "by_class": counts, "zones_used": len(zones_used), "left": left}
