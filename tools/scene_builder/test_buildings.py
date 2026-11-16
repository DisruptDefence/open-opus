"""Item 2: buildings in data. Synthetic contexts, no network; the last class reads the real cache when present."""
import copy
import json
import statistics
import unittest
from pathlib import Path

import _paths
from scene_builder import buildings, style
from scene_builder.ctx import Ctx

REPO = _paths.REPO


def ccw(x0, z0, x1, z1):
    """A rectangle as the builder holds rings: counter-clockwise on the map, so negative area in (x, z)."""
    return [(x0, z0), (x0, z1), (x1, z1), (x1, z0)]


def test_style() -> style.Style:
    """canada, with rules that make the pitch class visible in the roof shape: steep gabled, low hipped, flat flat."""
    pack = style.resolve("canada", REPO / "styles")
    pack["buildings"] = [
        {"when": {"pitch": "steep"}, "roof": {"gabled": 1}, "roofMat": {"shingle": 1}, "facade": {"brick": 1}},
        {"when": {"pitch": "low"}, "roof": {"hipped": 1}, "roofMat": {"shingle": 1}, "facade": {"brick": 1}},
        {"when": {"pitch": "flat"}, "roof": {"flat": 1}, "roofMat": {"membrane": 1}, "facade": {"stucco": 1}},
        {"when": {}, "roof": {"skillion": 1}, "roofMat": {"shingle": 1}, "facade": {"wood_siding": 1}},
    ]
    style.validate(pack, None)
    return style.Style(pack)


def ft(ring, n=1, tags=None, is_part=False, kind="yes", holes=()):
    return {"src": ("way", n, 0), "tags": tags or {"building": kind}, "ring": ring, "holes": list(holes),
            "centroid": (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)),
            "area": abs(buildings.ring_area(ring)), "is_part": is_part, "kind": None if kind == "yes" else kind}


def run(features, surface=None, roads=(), pois=(), st=None):
    ctx = Ctx(place=None, style=st or test_style(), osm=[], game=None, geo=None, ground=lambda x, z: 0.0,
              surface_height=surface or (lambda x, z: None), ext={}, play={})
    ctx.surface_model = surface is not None
    ctx.features = {"buildings": features, "pois": list(pois)}
    ctx.layers = {"roads": list(roads)}
    return buildings.build(ctx)["buildings"], ctx


def mk_ctx(surface):
    return Ctx(place=None, style=test_style(), osm=[], game=None, geo=None, ground=lambda x, z: 0.0, surface_height=surface, ext={}, play={})


def gable(eave, ridge, half=4.0):
    """A roof whose ridge runs along x, centred on z = 0."""
    return lambda x, z: eave + (ridge - eave) * max(0.0, 1 - abs(z) / half)


class Heights(unittest.TestCase):
    def test_a_steep_gable_is_measured_and_gets_its_direction(self):
        # eave 6 m, ridge 12 m over a 10 x 8 footprint
        (b,), _ = run([ft(ccw(0, -4, 10, 4))], surface=gable(6, 12))
        self.assertEqual(b["hs"], "measured")
        self.assertLess(abs(b["h"] - 12), 1.0)
        self.assertEqual(b["rs"], 1, "steep: the style's steep rule gives a gable")
        self.assertEqual(b["rd"], 90, "ridge along x = east = 90 degrees from grid north")
        self.assertGreaterEqual(b["rh"], 2.5)
        self.assertEqual(b["lv"], max(1, round((b["h"] - b["rh"]) / 3.0)))

    def test_the_plans_gable_of_6_to_9_m(self):
        ring = ccw(0, -4, 10, 4)
        m = buildings.measure(mk_ctx(gable(6, 9)), ring, [], 0.0)
        self.assertLess(abs(m["eave"] - 6), 0.4)
        self.assertLess(abs(m["top"] - 9), 0.4)
        (b,), _ = run([ft(ring)], surface=gable(6, 9))
        self.assertEqual(b["hs"], "measured")
        self.assertLess(abs(b["rh"] - 3), 0.6)
        self.assertEqual(b["rs"], 1, "steep (rise / half width >= 0.6): the style's steep rule gives a gable")
        self.assertEqual(b["rd"], 90)
        self.assertEqual(b["lv"], 2)

    def test_a_mansard_reads_as_a_steep_slope_with_a_near_flat_top(self):
        def mansard(x, z):
            d = min(x, 16 - x, z + 6, 6 - z)
            return 6 + 1.5 * d if d < 3 else 10.5 + 0.05 * (d - 3)
        m = buildings.measure(mk_ctx(mansard), ccw(0, -6, 16, 6), [], 0.0)
        self.assertLess(abs(m["eave"] - 6), 0.8)
        self.assertLess(abs(m["top"] - 10.5), 0.6)
        self.assertGreaterEqual(m["rise"], 3.5)

    def test_a_flat_roof_with_a_parapet_and_a_rooftop_box_stays_flat(self):
        def roof(x, z):
            h = 7.0
            if min(x, 16 - x, z + 6, 6 - z) < 0.4:
                h += 1.5                                   # the parapet
            if 6 < x < 7.5 and -0.75 < z < 0.75:
                h += 2.5                                   # a mechanical box
            return h
        ring = ccw(0, -6, 16, 6)
        m = buildings.measure(mk_ctx(roof), ring, [], 0.0)
        self.assertEqual(m["rise"], 0.0)
        (b,), _ = run([ft(ring)], surface=roof)
        self.assertEqual((b["rs"], b["rh"]), (0, 0.0))

    def test_a_chimney_spike_does_not_move_the_ridge(self):
        g = gable(6, 9)
        spike = lambda x, z: g(x, z) + (3.0 if (x, z) == (5.5, 0.5) else 0.0)  # noqa: E731
        ring = ccw(0, -4, 10, 4)
        a, b = (buildings.measure(mk_ctx(f), ring, [], 0.0) for f in (g, spike))
        self.assertLess(abs(a["top"] - b["top"]), 0.3)

    def test_a_flat_roof(self):
        (b,), _ = run([ft(ccw(0, -4, 10, 4))], surface=lambda x, z: 7.0)
        self.assertEqual((b["hs"], b["rs"], b["rh"]), ("measured", 0, 0.0))
        self.assertLess(abs(b["h"] - 7.0), 0.2)

    def test_no_surface_model_means_levels_or_rule_and_no_pitch_rule(self):
        (b,), _ = run([ft(ccw(0, -4, 10, 4), tags={"building": "yes", "building:levels": "3"})])
        self.assertEqual((b["hs"], b["rd"]), ("levels", 255))
        self.assertEqual(b["rs"], 5, "the rules that ask for a pitch do not match; the last one does")
        (c,), _ = run([ft(ccw(0, -4, 10, 4))])
        self.assertEqual(c["hs"], "rule")

    def test_a_tag_wins_over_the_surface(self):
        (b,), _ = run([ft(ccw(0, -4, 10, 4), tags={"building": "yes", "height": "9", "roof:shape": "gambrel"})], surface=lambda x, z: 20.0)
        self.assertEqual((b["h"], b["hs"], b["rs"]), (9.0, "tag", 8))

    def test_a_green_roof_colour_means_copper(self):
        (b,), _ = run([ft(ccw(0, -4, 10, 4), tags={"building": "yes", "roof:colour": "#4f9a7a"})])
        self.assertEqual(b["rmt"], 2)


class Neighbours(unittest.TestCase):
    def test_a_shared_wall_is_blind_on_both_sides_and_only_there(self):
        a, b = ccw(0, 0, 10, 8), ccw(10, 0, 20, 8)
        (ra, rb), _ = run([ft(a, 1), ft(b, 2)])
        self.assertEqual(ra["blind"], [2])
        self.assertEqual(rb["blind"], [0])

    def test_a_road_in_front_makes_the_edge_a_front_and_a_shop_makes_a_shopfront(self):
        road = {"p": [-5, -20, -5, 20], "k": "residential", "w": 6}
        (b,), _ = run([ft(ccw(0, 0, 10, 8))], roads=[road])
        self.assertEqual(b["front"], [0])
        self.assertEqual(b["gf"], 0)
        (s,), _ = run([ft(ccw(0, 0, 10, 8))], roads=[road], pois=[{"x": 5, "z": 4, "tags": {"shop": "bakery"}}])
        self.assertEqual((s["use"], s["gf"], s["front"]), (2, 1, [0]))
        (alley,), _ = run([ft(ccw(0, 0, 10, 8))], roads=[dict(road, k="service")])
        self.assertNotIn("front", alley)

    def test_parts_of_one_building_are_not_blind_against_their_outline(self):
        outline, part = ft(ccw(0, 0, 10, 8), 1), ft(ccw(2, 2, 8, 6), 2, tags={"building:part": "yes"}, is_part=True)
        recs, _ = run([outline, part])
        self.assertNotIn("blind", recs[1])


class Ids(unittest.TestCase):
    def test_ids_are_stable_distinct_and_never_zero(self):
        fs = [ft(ccw(i * 12, 0, i * 12 + 10, 8), n) for i, n in enumerate((11, 12, 13, 14))]
        a, _ = run(fs)
        b, _ = run(fs)
        self.assertEqual([r["id"] for r in a], [r["id"] for r in b])
        self.assertEqual(len({r["id"] for r in a}), 4)
        self.assertTrue(all(r["id"] > 0 for r in a))
        self.assertEqual(a[0]["id"], buildings.fnv1a32("way/11/0"))

    def test_a_clash_moves_the_later_source_up_by_one(self):
        keys = [("way", 5, 0), ("way", 5, 0)]
        ids = buildings.assign_ids(keys)
        self.assertEqual(ids[1], ids[0] + 1)
        self.assertEqual(buildings.assign_ids([("way", 1, 0)])[0] or 1, buildings.fnv1a32("way/1/0"))


class Geometry(unittest.TestCase):
    def test_oriented_box_of_a_turned_rectangle(self):
        import math
        a = math.radians(30)
        pts = [(x * math.cos(a) - z * math.sin(a), x * math.sin(a) + z * math.cos(a)) for x, z in ccw(0, 0, 20, 6)]
        o = buildings.obb(pts)
        self.assertAlmostEqual(o["L"], 10, 4)
        self.assertAlmostEqual(o["W"], 3, 4)
        self.assertAlmostEqual(o["fill"], 1, 4)

    def test_percentile(self):
        self.assertEqual(buildings.pct([1, 2, 3, 4, 5], 0.5), 3)
        self.assertEqual(buildings.pct([7], 0.9), 7)


@unittest.skipUnless((REPO / ".cache").is_dir() and any(p.is_dir() for p in (REPO / ".cache").iterdir()), "no cache (it is not in git)")
class RealCache(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from scene_builder import build
        import tempfile
        cls.tmp = tempfile.TemporaryDirectory()
        cache = next(p for p in sorted((REPO / ".cache").iterdir()) if p.is_dir())
        place = next(f for f in sorted((REPO / "places").glob("*.json")) if json.loads(f.read_text(encoding="utf-8"))["id"] == cache.name)
        out = Path(cls.tmp.name) / "s.json"
        build.build(place, cache, True, out)
        cls.scene = json.loads(out.read_text(encoding="utf-8"))
        cls.bs = cls.scene["buildings"]

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_most_buildings_are_measured_and_not_absurdly_tall(self):
        n = len(self.bs)
        self.assertGreaterEqual(sum(b["hs"] == "measured" for b in self.bs) / n, 0.85)
        self.assertLessEqual(sum(b["h"] > 60 for b in self.bs) / n, 0.02)

    def test_the_town_is_no_longer_one_height(self):
        self.assertGreater(statistics.pstdev([b["h"] for b in self.bs]), 3.0)

    def test_indices_and_enums_are_in_range(self):
        for b in self.bs:
            n = len(b["r"]) // 2
            self.assertTrue(all(0 <= i < n for i in b.get("blind", []) + b.get("front", [])))
            self.assertTrue(set(b.get("blind", [])).isdisjoint(b.get("front", [])))
            self.assertTrue(0 <= b["rs"] <= 8 and 0 <= b["fa"] <= 10 and 0 <= b["rmt"] <= 9 and 0 <= b["use"] <= 8 and b["lv"] >= 1)
            self.assertTrue(b["rd"] == 255 or 0 <= b["rd"] < 180)
            self.assertGreater(b["id"], 0)
        self.assertEqual(len({b["id"] for b in self.bs}), len(self.bs))

    def test_the_rules_explain_what_was_invented(self):
        for k in ("building_height", "roof_shape", "ridge_direction", "roof_height", "blind_edges", "front_edges"):
            self.assertIn(k, self.scene["rules"])


if __name__ == "__main__":
    unittest.main()
