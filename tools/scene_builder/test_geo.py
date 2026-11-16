import json
import unittest

import _paths
from scene_builder import geo, place as place_mod

REPO = _paths.REPO


class Zones(unittest.TestCase):
    def test_zone_from_longitude(self):
        self.assertEqual(geo.zone_of(-71.2068), 19)
        self.assertEqual(geo.zone_of(-64.31), 20)
        self.assertEqual(geo.zone_of(-105.53), 13)

    def test_round_trip_within_a_millimetre(self):
        for lat, lon in ((46.8118, -71.2068), (44.377, -64.31), (50.39, -105.53), (64.06, -139.43)):
            z = geo.zone_of(lon)
            e, n = geo.to_utm(lat, lon, z)
            la, lo = geo.from_utm(e, n, z)
            e2, n2 = geo.to_utm(la, lo, z)
            self.assertLess(abs(e2 - e), 1e-3)
            self.assertLess(abs(n2 - n), 1e-3)
            self.assertLess(abs(la - lat) * 111_000, 1e-3)
            self.assertLess(abs(lo - lon) * 111_000 * 0.4, 1e-3)


class OldPlace(unittest.TestCase):
    def test_anchor_snaps_to_the_published_metre_and_checks_match_the_scene(self):
        # the place with this anchor: the fixture is the anchor and the scene it was built into, not a file name
        files = [f for f in sorted((REPO / "places").glob("*.json")) if abs(json.loads(f.read_text(encoding="utf-8"))["anchor"]["lat"] - 46.8118) < 1e-9]
        self.assertEqual(len(files), 1)
        place = place_mod.load(files[0])
        self.assertEqual((place.zone, place.band, place.e0, place.n0), (19, "T", 331641, 5186615))
        scene = json.loads((REPO / "scenes" / f"{place.id}.json").read_text(encoding="utf-8"))
        self.assertEqual(len(scene["georef"]["checks"]), 7)
        self.assertEqual(place.georef()["checks"], scene["georef"]["checks"])
        self.assertEqual(place.georef(), scene["georef"])

    def test_a_place_in_another_zone_gets_its_own_zone_and_crs(self):
        place = place_mod.from_dict({
            "id": "elsewhere", "name": "Elsewhere", "anchor": {"lat": 44.377, "lon": -64.31},
            "play": {"halfWidth": 100, "halfHeight": 100}, "terrain": {"cell": 2.5},
            "vertical": {"datum": "CGVD2013", "geoid_undulation": -20.0}, "style": "canada"})
        g = place.georef()
        self.assertEqual((g["zone"], g["crs"]), (20, "EPSG:32620"))
        lat, lon = place.geo(*place.game(44.38, -64.30))
        self.assertAlmostEqual(lat, 44.38, 7)


if __name__ == "__main__":
    unittest.main()
