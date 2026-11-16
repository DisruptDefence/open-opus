import tempfile
import unittest
from pathlib import Path

import _paths
from scene_builder import fetch


class CacheTests(unittest.TestCase):
    def test_offline_names_the_missing_file(self):
        with tempfile.TemporaryDirectory() as t:
            c = fetch.Cache(Path(t), offline=True)
            with self.assertRaisesRegex(SystemExit, "osm.json"):
                c.get("osm.json", "http://127.0.0.1:1/never")

    def test_an_earlier_cache_name_is_read(self):
        with tempfile.TemporaryDirectory() as t:
            (Path(t) / "osm-all.json").write_bytes(b"{}")
            (Path(t) / "hrdem-dtm-1m.tif").write_bytes(b"x")
            c = fetch.Cache(Path(t), offline=True)
            self.assertEqual(c.get("osm.json"), b"{}")
            self.assertEqual(c.get("hrdem-dtm.tif"), b"x")

    def test_query_and_urls(self):
        q = fetch.overpass_query(46.0, -71.0, 47.0, -70.0)
        self.assertIn('nwr[~"."~"."](46.000000,-71.000000,47.000000,-70.000000)', q)
        u = fetch.hrdem_url("dsm", (1, 2, 3, 4))
        self.assertIn("identifier=dsm", u)
        self.assertIn("GridOffsets=1.0%2C-1.0", u)

    def test_ckan_resource_pick(self):
        pkg = {"result": {"resources": [{"format": "PDF", "url": "a"}, {"format": "csv", "url": "b"}]}}
        self.assertEqual(fetch.pick_resource(pkg, "CSV"), "b")
        with self.assertRaises(SystemExit):
            fetch.pick_resource(pkg, "XLSX")


if __name__ == "__main__":
    unittest.main()
