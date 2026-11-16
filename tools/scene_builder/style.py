"""Style packs: what buildings, streets and trees look like in a region, as data (`styles/<name>.json`).

A pack may name `"extends": "<pack>"` (at most 4 levels, a cycle is an error); objects merge deeply, lists
replace. After the merge every key of `styles/canada.json` must be present, every weight table non-empty and
every enum word known. `client()` is the block copied into the scene; the rest never leaves the builder."""
from __future__ import annotations

import copy
import json
import random
from pathlib import Path

DEFAULT_PACK = "canada"
MAX_DEPTH = 4

# the words of docs/SCENE-FORMAT.md 4.2 / 4.1 (index = the enum value)
ROOF_SHAPES = ["flat", "gabled", "hipped", "mansard", "pyramidal", "skillion", "dome", "cone", "gambrel"]
ROOF_MATS = ["generic", "metal_seam", "copper", "slate", "shingle", "tile", "membrane", "concrete", "thatch", "sheet_metal"]
FACADES = ["generic", "stone_ashlar", "stone_rubble", "brick", "stucco", "wood_siding", "concrete", "glass", "metal_panel",
           "mud_brick", "block_unfinished"]
USES = ["unknown", "residential", "commercial", "civic", "religious", "industrial", "military", "transport", "ruin"]
SURFACES = ["unknown", "asphalt", "concrete", "cobble", "paving", "gravel", "dirt", "grass", "sand", "rock", "snow", "mud",
            "wood", "metal", "water", "vegetation_dense"]
WHEN_KEYS = {"building", "use", "areaMin", "areaMax", "levelsMin", "levelsMax", "attached", "pitch"}
PITCHES = ["flat", "low", "steep"]


def merge(base: dict, over: dict) -> dict:
    """Deep merge: objects merge, everything else (lists included) is replaced by `over`."""
    out = copy.deepcopy(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def _read(name: str, styles_dir: Path) -> dict:
    p = Path(styles_dir) / f"{name}.json"
    if not p.exists():
        raise SystemExit(f"style: no pack '{name}' ({p})")
    return json.loads(p.read_text(encoding="utf-8"))


def resolve(name: str, styles_dir: Path, _chain: tuple = ()) -> dict:
    if name in _chain:
        raise SystemExit(f"style: 'extends' cycle: {' -> '.join(_chain + (name,))}")
    if len(_chain) >= MAX_DEPTH:
        raise SystemExit(f"style: 'extends' is deeper than {MAX_DEPTH} levels at '{name}'")
    raw = _read(name, styles_dir)
    parent = raw.get("extends")
    merged = merge(resolve(parent, styles_dir, _chain + (name,)), raw) if parent else raw
    merged["id"] = raw.get("id", name)
    return merged


def _check_keys(pack: dict, ref: dict, where: str = "") -> None:
    for k in ref:
        if k not in pack:
            raise SystemExit(f"style: missing key '{where}{k}'")
    for k in ("client", "street"):
        for kk in ref.get(k, {}):
            if kk not in pack.get(k, {}):
                raise SystemExit(f"style: missing key '{k}.{kk}'")


def _weights(table: object, where: str, words: list[str] | None) -> None:
    if not isinstance(table, dict) or not table:
        raise SystemExit(f"style: weight table {where} is empty")
    for w, v in table.items():
        if words is not None and w not in words:
            raise SystemExit(f"style: unknown word '{w}' in {where}")
        if not isinstance(v, (int, float)) or v <= 0:
            raise SystemExit(f"style: weight of '{w}' in {where} must be positive")


def validate(pack: dict, ref: dict | None) -> None:
    if ref is not None:
        _check_keys(pack, ref)
    client = pack["client"]
    for i, rule in enumerate(pack["buildings"]):
        where = f"buildings[{i}]"
        for k in rule.get("when", {}):
            if k not in WHEN_KEYS:
                raise SystemExit(f"style: unknown 'when' key '{k}' in {where}")
        if rule.get("when", {}).get("pitch") not in (None, *PITCHES):
            raise SystemExit(f"style: unknown pitch in {where}")
        _weights(rule.get("roof"), f"{where}.roof", ROOF_SHAPES)
        _weights(rule.get("roofMat"), f"{where}.roofMat", ROOF_MATS)
        _weights(rule.get("facade"), f"{where}.facade", FACADES)
        for f in rule["facade"]:
            if f != "generic" and not client["palettes"].get(f):
                raise SystemExit(f"style: facade '{f}' in {where} has no client.palettes entry")
        for m in rule["roofMat"]:
            if m != "generic" and not client["roofs"].get(m):
                raise SystemExit(f"style: roof material '{m}' in {where} has no client.roofs entry")
    if not any(not r.get("when") for r in pack["buildings"]):
        raise SystemExit("style: buildings needs a final rule with an empty 'when'")
    for w in pack["roofPitchDeg"]:
        if w not in ROOF_SHAPES:
            raise SystemExit(f"style: unknown roof shape '{w}' in roofPitchDeg")
    for k in ("surface",):
        for cls, s in pack["street"][k].items():
            if s not in SURFACES:
                raise SystemExit(f"style: unknown surface '{s}' for '{cls}' in street.{k}")
    if pack["street"]["sidewalk"].get("surface") not in SURFACES:
        raise SystemExit("style: unknown surface in street.sidewalk")
    sh = pack["storeyHeight"]
    if not sh["min"] <= sh["default"] <= sh["max"]:
        raise SystemExit("style: storeyHeight.default must lie between min and max")


class Style:
    def __init__(self, pack: dict):
        self.pack = pack
        self.rules: list[dict] = pack["buildings"]
        self.storey: float = pack["storeyHeight"]["default"]

    def client(self) -> dict:
        out = copy.deepcopy(self.pack["client"])
        sw = self.pack.get("street", {}).get("sidewalk", {})  # item 6: the sidewalk the engine draws is the one the builder decided on
        out.setdefault("sidewalk", {"width": sw.get("width", 1.6), "surface": sw.get("surface", "concrete")})
        return out

    def pitch_deg(self, shape: str) -> float:
        return float(self.pack["roofPitchDeg"].get(shape, 40))

    def rule_for(self, ctx: dict) -> dict:
        """The first building rule whose `when` holds for `ctx` (keys: building, use, area, levels, attached,
        pitch; `pitch` is absent when the roof was not measured, and then a rule that asks for it does not match)."""
        for r in self.rules:
            if _matches(r.get("when", {}), ctx):
                return r
        raise SystemExit("style: no building rule matches")


def _matches(when: dict, c: dict) -> bool:
    for k, v in when.items():
        if k == "building":
            if c.get("building") not in v:
                return False
        elif k == "use":
            if c.get("use") not in (v if isinstance(v, list) else [v]):
                return False
        elif k == "areaMin":
            if c["area"] < v:
                return False
        elif k == "areaMax":
            if c["area"] > v:
                return False
        elif k == "levelsMin":
            if c["levels"] < v:
                return False
        elif k == "levelsMax":
            if c["levels"] > v:
                return False
        elif k == "attached":
            if bool(c["attached"]) != bool(v):
                return False
        elif k == "pitch":
            if c.get("pitch") != v:
                return False
    return True


def pick(table: dict, rnd: random.Random) -> str:
    """A weighted choice from {word: weight}; one draw from `rnd`, so a seeded stream gives the same town."""
    total = sum(table.values())
    x = rnd.random() * total
    for w, v in table.items():
        x -= v
        if x < 0:
            return w
    return next(reversed(table))


def load(name: str, styles_dir: Path) -> Style:
    pack = resolve(name, styles_dir)
    ref = None if name == DEFAULT_PACK else resolve(DEFAULT_PACK, styles_dir)
    validate(pack, ref)
    return Style(pack)
