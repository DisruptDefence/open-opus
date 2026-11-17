"""No file under engine/ or tools/ names a place (docs/plans/SCENE-DETAIL.md section 2).

The names are read from `places/*.json` (id and name), so a new place is covered the day its file is added.
Allowed to name a place: places/, styles/, scenes/, docs/, engine/tools/viewpoints/.

Known exceptions: the engine's own tests, dev host and tools name the shipped scene by id to load it (a test
fixture, a scenario file name, a default argument). They are listed in KNOWN_ENGINE_FILES, owned by the engine's
authors, and the list must only shrink."""
import json
import re
import unicodedata
import unittest
from pathlib import Path

import _paths

REPO = _paths.REPO
SCAN = ("engine", "tools")
SKIP_DIRS = {"node_modules", "vendor", "__pycache__", ".git", "viewpoints", "scenes"}
KNOWN_ENGINE_FILES = {
    "engine/README.md", "engine/host/dev-host.js", "engine/host/scenarios/index.json",
    "engine/src/scene/source.js", "engine/test/georef.test.js", "engine/test/helpers.js", "engine/test/scene.test.js",
    "engine/test/world-api.test.js", "engine/tools/make-test-scene.mjs", "engine/tools/photo.mjs", "engine/tools/play.mjs",
}


# engine/test/no-place.test.js is the engine's own twin of this rule: its list of forbidden words must name the
# place it forbids, so that one exact file is exempt.
KNOWN_ENGINE_FILES.add("engine/test/no-place.test.js")

KNOWN_ENGINE_PREFIXES = ("engine/host/scenarios/",)   # a scenario file is named after its scene


def fold(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()


def names() -> set[str]:
    out = set()
    for f in sorted((REPO / "places").glob("*.json")):
        p = json.loads(f.read_text(encoding="utf-8"))
        for v in (p["id"], p["name"]):
            out |= {fold(v), fold(v).replace("-", " ")}
    return {n for n in out if len(n) >= 4}


def text_files():
    for top in SCAN:
        for p in sorted((REPO / top).rglob("*")):
            if p.is_file() and not (set(p.relative_to(REPO).parts) & SKIP_DIRS):
                yield p


class NoPlace(unittest.TestCase):
    def test_there_are_places_to_check(self):
        self.assertTrue(names())

    def test_no_place_name_in_engine_or_builder_code(self):
        ns = names()
        hits = []
        for p in text_files():
            rel = p.relative_to(REPO).as_posix()
            if rel in KNOWN_ENGINE_FILES or rel.startswith(KNOWN_ENGINE_PREFIXES):
                continue
            try:
                txt = fold(p.read_text(encoding="utf-8"))
            except (UnicodeDecodeError, OSError):
                continue
            txt = re.sub(r"[_]", "-", txt)
            for n in ns:
                if n in txt:
                    hits.append(f"{rel}: {n}")
        self.assertEqual(hits, [])

    def test_the_known_list_names_real_files(self):
        self.assertEqual([f for f in KNOWN_ENGINE_FILES if not (REPO / f).exists()], [])


if __name__ == "__main__":
    unittest.main()
