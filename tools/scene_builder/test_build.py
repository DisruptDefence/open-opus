import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import _paths
from scene_builder import build

REPO = _paths.REPO


def cached_places():
    for f in sorted((REPO / "places").glob("*.json")):
        pid = json.loads(f.read_text(encoding="utf-8"))["id"]
        if (REPO / ".cache" / pid).is_dir():
            yield f, REPO / ".cache" / pid


class OfflineBuild(unittest.TestCase):
    def test_two_offline_builds_from_one_cache_are_byte_identical(self):
        found = list(cached_places())
        if not found:
            self.skipTest("no cache under .cache/ (it is not in git)")
        for place, cache in found:
            with tempfile.TemporaryDirectory() as t:
                a, b = Path(t) / "a.json", Path(t) / "b.json"
                build.build(place, cache, True, a)
                build.build(place, cache, True, b)
                self.assertEqual(hashlib.sha256(a.read_bytes()).hexdigest(), hashlib.sha256(b.read_bytes()).hexdigest())
                scene = json.loads(a.read_text(encoding="utf-8"))
                self.assertEqual(scene["formatMinor"], 1)
                for k in ("style", "season", "ambience", "sources", "rules"):
                    self.assertIn(k, scene)
                for s in scene["sources"]:
                    for k in ("licence", "licenceUrl", "attribution", "layers"):
                        self.assertIn(k, s)

    def test_offline_without_a_cache_names_the_missing_file(self):
        place = next(iter(sorted((REPO / "places").glob("*.json"))))
        with tempfile.TemporaryDirectory() as t:
            with self.assertRaisesRegex(SystemExit, "osm.json"):
                build.build(place, Path(t), True, Path(t) / "x.json")


if __name__ == "__main__":
    unittest.main()
