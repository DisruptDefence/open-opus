"""Trees by rule (docs/SCENE-FORMAT.md 4.5 sources 1-5). Synthetic geometry, no network."""
import copy
import math
import unittest

import _paths  # noqa: F401
from scene_builder import trees
from scene_builder.ctx import Ctx

FILL = {"max": 4000, "rowSpacing": 8, "woodDensity": 1.2, "scrubDensity": 0.5, "parkDensity": 0.35, "slopeMin": 0.45, "slopeDensity": 0.8,
        "slopeScale": 0.7, "streetOn": ["residential"], "streetMinSidewalk": 2.2, "streetSpacing": 14, "streetOffset": 0.8, "minGap": 1.8,
        "kinds": {"row": {"broadleaf": 1}, "wood": {"broadleaf": 1}, "scrub": {"shrub": 1}, "park": {"broadleaf": 1}, "slope": {"conifer": 1},
                  "street": {"broadleaf": 1}},
        "forms": {"broadleaf": {"round": 1}, "conifer": {"cone": 1}, "shrub": {"round": 1}},
        "size": {"broadleaf": {"height": [10, 10], "crown": 0.3}, "conifer": {"height": [12, 12], "crown": 0.2}, "shrub": {"height": [2, 2], "crown": 0.5}}}


class Pack:
    def __init__(self, fill=FILL, sidewalk=1.6):
        self.pack = {"trees": {"default": {"kind": "broadleaf", "form": "round"}, "genus": {}}, "street": {"sidewalk": {"width": sidewalk}}}
        if fill is not None:
            self.pack["trees"]["fill"] = copy.deepcopy(fill)


def rect(x0, z0, x1, z1):
    return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]


def run(fill=FILL, sidewalk=1.6, ground=lambda x, z: 10.0, sh=lambda x, z: None, layers=None, **features):
    ctx = Ctx(place=None, style=Pack(fill, sidewalk), osm=[], game=None, geo=None, ground=ground, surface_height=sh,
              ext={"minX": -300, "maxX": 300, "minZ": -300, "maxZ": 300}, play={})
    base = {k: [] for k in ("trees", "tree_rows", "green", "buildings", "water", "areas", "roads", "walls")}
    base.update(features)
    ctx.features = base
    ctx.layers = layers or {}
    out = trees.build(ctx)["trees"]
    return ctx, out


def by(out, src):
    return [t for t in out if len(t) > 6 and t[6] == src]


def green(kind, ring):
    return {"ring": ring, "holes": [], "kind": kind, "tags": {}}


class Rules(unittest.TestCase):
    def test_style_without_fill_places_no_rule_trees_and_keeps_short_records(self):
        _, out = run(None, trees=[{"x": 1.04, "z": 2.0, "tags": {}, "node": 1}], tree_rows=[{"pts": [(0, 0), (80, 0)], "tags": {}}],
                     green=[green("wood", rect(0, 0, 100, 100))])
        self.assertEqual(out, [[1.0, 2.0]])

    def test_tree_row_spacing(self):
        _, out = run(tree_rows=[{"pts": [(0, 0), (80, 0)], "tags": {}}])
        row = by(out, 1)
        self.assertEqual(len(row), 11)
        xs = sorted(t[0] for t in row)
        for a, b in zip(xs, xs[1:]):
            self.assertAlmostEqual(b - a, 8, places=0)

    def test_tree_row_spacing_is_style_data(self):
        f = dict(FILL, rowSpacing=20)
        _, out = run(f, tree_rows=[{"pts": [(0, 0), (80, 0)], "tags": {}}])
        self.assertEqual(len(by(out, 1)), 5)

    def test_wood_density_and_exclusions(self):
        b = rect(40, 40, 60, 60)
        _, out = run(green=[green("wood", rect(0, 0, 100, 100))], buildings=[{"ring": b, "holes": [], "is_part": False}],
                     water=[{"ring": rect(0, 0, 20, 100), "tags": {}}],
                     roads=[{"pts": [(0, 80), (100, 80)], "tags": {"highway": "residential", "width": "6"}}],
                     layers={"roads": [{"w": 6.0}]})
        w = by(out, 2)
        self.assertGreater(len(w), 40)
        self.assertLess(len(w), 130)  # 1.2 per 100 m2 over 10 000 m2 is 120 before exclusions
        for t in w:
            x, z = t[0], t[1]
            self.assertFalse(40 <= x <= 60 and 40 <= z <= 60, "in the building")
            self.assertFalse(x <= 20, "in the water")
            self.assertGreater(abs(z - 80), 3.0, "on the road")
            self.assertEqual(t[4], 1)

    def test_scrub_is_sparser_and_shrub(self):
        _, out = run(green=[green("scrub", rect(0, 0, 100, 100))])
        s = by(out, 2)
        self.assertTrue(30 < len(s) < 60)
        self.assertTrue(all(t[4] == 4 for t in s))

    def test_park_keeps_2_5_m_from_paths_and_buildings(self):
        _, out = run(green=[green("park", rect(0, 0, 100, 100))],
                     buildings=[{"ring": rect(0, 0, 30, 30), "holes": [], "is_part": False}],
                     roads=[{"pts": [(0, 60), (100, 60)], "tags": {"highway": "footway"}}], layers={"roads": [{"w": 2.6}]})
        p = by(out, 3)
        self.assertGreater(len(p), 15)
        for t in p:
            self.assertGreaterEqual(abs(t[1] - 60), 2.5 + 1.3 - 1e-6)
            self.assertFalse(t[0] < 32.5 and t[1] < 32.5)

    def test_slope_trees_only_on_steep_bare_cells(self):
        ground = lambda x, z: 10.0 + max(0.0, x) * 0.8   # slope 0.8 for x > 0 (a little less at the edge)  # noqa: E731
        bare = [{"r": [20, 0, 80, 0, 80, 60, 20, 60], "k": "bare", "s": "rock"}]
        _, out = run(ground=ground, layers={"areas": bare})
        s = by(out, 4)
        self.assertGreater(len(s), 10)
        for t in s:
            self.assertTrue(20 <= t[0] <= 80 and 0 <= t[1] <= 60)
            self.assertEqual(t[4], 2)
            self.assertLess(t[2], 12)  # 0.7 of the size
        _, flat = run(layers={"areas": bare})
        self.assertEqual(by(flat, 4), [])
        _, gentle = run(ground=lambda x, z: 10.0 + x * 0.3, layers={"areas": bare})
        self.assertEqual(by(gentle, 4), [])

    def road(self):
        return [{"pts": [(0, 0), (0, -140)], "tags": {"highway": "residential", "width": "6"}}], {"roads": [{"w": 6.0, "sw": "both"}]}

    def test_street_trees_need_a_wide_sidewalk(self):
        roads, layers = self.road()
        _, narrow = run(roads=roads, layers=layers, sidewalk=1.6)
        self.assertEqual(by(narrow, 5), [])
        _, wide = run(roads=roads, layers=layers, sidewalk=2.4)
        st = by(wide, 5)
        self.assertEqual(len(st), 20)  # 10 positions, both sides
        for t in st:
            self.assertAlmostEqual(abs(t[0]), 3.8, places=1)
        zs = sorted({t[1] for t in st}, reverse=True)
        for a, b in zip(zs, zs[1:]):
            self.assertAlmostEqual(a - b, 14, places=0)

    def test_street_trees_skip_lamps_buildings_and_junctions(self):
        roads, layers = self.road()
        layers["props"] = {"kinds": ["lamp_lantern"], "items": [[0, -3.8, -7, 0, 0, 2]]}
        roads.append({"pts": [(0, -70), (60, -70)], "tags": {"highway": "residential", "width": "6"}})
        layers["roads"].append({"w": 6.0, "sw": "both"})
        _, out = run(sidewalk=2.4, roads=roads, layers=layers,
                     buildings=[{"ring": rect(-12, -50, -4.5, -40), "holes": [], "is_part": False}])
        st = by(out, 5)
        for t in st:
            self.assertGreater(math.hypot(t[0] + 3.8, t[1] + 7), 3.0)
            self.assertFalse(abs(t[0] + 3.8) < 0.1 and -52 < t[1] < -38, "next to the building")
            if abs(t[0]) < 5:
                self.assertGreater(abs(t[1] + 70), 6.0, "at the junction mouth")

    def test_a_grass_verge_allows_trees_where_the_sidewalk_is_narrow(self):
        roads, layers = self.road()
        _, out = run(roads=roads, layers=layers, sidewalk=1.6, green=[green("grass", rect(3, -140, 20, 0))])
        st = by(out, 5)
        self.assertGreater(len(st), 5)
        self.assertTrue(all(t[0] > 0 for t in st))

    def test_deterministic(self):
        kw = dict(green=[green("wood", rect(0, 0, 100, 100)), green("park", rect(120, 0, 200, 100))])
        self.assertEqual(run(**kw)[1], run(**kw)[1])

    def test_cap_thins_rule_trees_and_says_so(self):
        f = dict(FILL, max=30)
        ctx, out = run(f, green=[green("wood", rect(0, 0, 100, 100))], trees=[{"x": 5.0, "z": 5.0, "tags": {}, "node": 1}])
        self.assertEqual(len(out), 30)
        self.assertEqual(len(by(out, 0)), 1)
        self.assertIn("it bit", ctx.rules["trees"])
        self.assertNotIn("not reached", ctx.rules["trees"])

    def test_sizes_vary_by_15_percent_and_use_measured_canopy(self):
        _, out = run(green=[green("wood", rect(0, 0, 100, 100))])
        hs = [t[2] for t in by(out, 2)]
        self.assertTrue(all(8.5 - 0.25 <= h <= 11.5 + 0.25 for h in hs))
        self.assertGreater(max(hs) - min(hs), 1.0)
        _, m = run(green=[green("wood", rect(0, 0, 100, 100))], sh=lambda x, z: 10.0 + 17.0)
        self.assertTrue(all(t[2] == 17.0 for t in by(m, 2) if t[4] == 1))

    def test_rules_sentence_has_counts(self):
        ctx, out = run(tree_rows=[{"pts": [(0, 0), (80, 0)], "tags": {}}])
        self.assertIn("11 along tree_row ways", ctx.rules["trees"])


if __name__ == "__main__":
    unittest.main()
