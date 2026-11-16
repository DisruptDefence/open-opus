"""Single trees and tree rows as points. Species, size and form are item 8."""
from __future__ import annotations


def build(ctx) -> dict:
    return {"trees": [[round(t["x"], 1), round(t["z"], 1)] for t in ctx.features["trees"]]}
