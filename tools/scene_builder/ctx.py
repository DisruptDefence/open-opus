"""What every layer module gets: the place, the style, the parsed OpenStreetMap elements, and the helpers that
turn lat/lon into game metres and ask the terrain and the surface model."""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Callable


@dataclass
class Ctx:
    place: object
    style: object
    osm: list
    game: Callable[[float, float], tuple[float, float]]
    geo: Callable[[float, float], tuple[float, float]]
    ground: Callable[[float, float], float]
    surface_height: Callable[[float, float], float | None]
    ext: dict
    play: dict
    carve: Callable[..., None] | None = None       # terrain.Terrain.carve: levels the ground along a way (gate passages)
    rules: dict = field(default_factory=dict)
    sources: list = field(default_factory=list)
    features: dict = field(default_factory=dict)   # filled by osm.classify
    layers: dict = field(default_factory=dict)     # scene keys already built, for layers that need another (roads for buildings)

    def rng(self, seed: int) -> random.Random:
        return random.Random(seed)
