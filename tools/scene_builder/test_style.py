import json
import random
import tempfile
import unittest
from pathlib import Path

import _paths
from scene_builder import style

STYLES = _paths.REPO / "styles"


def write(d: Path, name: str, obj: dict) -> None:
    (d / f"{name}.json").write_text(json.dumps(obj))


class Merge(unittest.TestCase):
    def test_objects_merge_and_lists_replace(self):
        self.assertEqual(style.merge({"a": {"b": 1, "c": [1, 2]}}, {"a": {"c": [3]}}), {"a": {"b": 1, "c": [3]}})

    def test_a_cycle_raises(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t)
            write(d, "a", {"extends": "b"})
            write(d, "b", {"extends": "a"})
            with self.assertRaisesRegex(SystemExit, "cycle"):
                style.resolve("a", d)

    def test_a_pack_missing_a_key_of_canada_raises_naming_it(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t)
            canada = json.loads((STYLES / "canada.json").read_text())
            write(d, "canada", canada)
            broken = {k: v for k, v in canada.items() if k != "walls"}
            write(d, "broken", broken)
            with self.assertRaisesRegex(SystemExit, "walls"):
                style.load("broken", d)
            nested = json.loads(json.dumps(canada))
            del nested["client"]["cornice"]
            write(d, "nested", nested)
            with self.assertRaisesRegex(SystemExit, "client.cornice"):
                style.load("nested", d)

    def test_an_unknown_enum_word_and_an_empty_table_raise(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t)
            canada = json.loads((STYLES / "canada.json").read_text())
            write(d, "canada", canada)
            write(d, "odd", {"extends": "canada", "buildings": [{"when": {}, "roof": {"thatched_dome": 1}, "roofMat": {"slate": 1}, "facade": {"brick": 1}}]})
            with self.assertRaisesRegex(SystemExit, "thatched_dome"):
                style.load("odd", d)
            write(d, "empty", {"extends": "canada", "buildings": [{"when": {}, "roof": {}, "roofMat": {"slate": 1}, "facade": {"brick": 1}}]})
            with self.assertRaisesRegex(SystemExit, "empty"):
                style.load("empty", d)

    def test_the_shipped_packs_load(self):
        for name in ("canada", "quebec-historic"):
            s = style.load(name, STYLES)
            self.assertTrue(s.client()["palettes"])
        self.assertEqual(style.load("quebec-historic", STYLES).storey, 3.1)
        # inherited from the default pack, not repeated in the regional one
        self.assertIn("concrete", style.load("quebec-historic", STYLES).client()["palettes"])


class Pick(unittest.TestCase):
    def test_weights_and_determinism(self):
        rnd = random.Random(7)
        draws = [style.pick({"x": 1, "y": 3}, rnd) for _ in range(4000)]
        share = draws.count("y") / 4000
        self.assertTrue(0.70 <= share <= 0.80, share)
        again = random.Random(7)
        self.assertEqual(draws, [style.pick({"x": 1, "y": 3}, again) for _ in range(4000)])


if __name__ == "__main__":
    unittest.main()
