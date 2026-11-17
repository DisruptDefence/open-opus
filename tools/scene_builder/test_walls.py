"""Item 7: walls that hold ground back, and passages through buildings. Synthetic contexts, no network."""
import unittest

import _paths
from scene_builder import buildings, style, walls
from scene_builder.ctx import Ctx

REPO = _paths.REPO


def make_ctx(ground, wall_ways=(), buildings_=(), roads=(), pack="quebec-historic"):
    ctx = Ctx(place=None, style=style.load(pack, REPO / "styles"), osm=[], game=None, geo=None, ground=ground,
              surface_height=lambda x, z: None, ext={}, play={})
    ctx.features = {"walls": list(wall_ways), "gates": [], "buildings": list(buildings_), "pois": []}
    ctx.layers = {"roads": list(roads)}
    return ctx


def way(pts, bar="city_wall", **tags):
    return {"pts": pts, "tags": {"barrier": bar, **tags}}


def feature(ring, n=1, **tags):
    return {"src": ("way", n, 0), "tags": {"building": "yes", **tags}, "ring": ring, "holes": [], "centroid": (0, 0),
            "area": abs(buildings.ring_area(ring)), "is_part": False, "kind": None}


def rect(x0, z0, x1, z1):
    return [(x0, z0), (x0, z1), (x1, z1), (x1, z0)]


def road(pts, w, k="residential", **extra):
    return {"p": [v for q in pts for v in q], "k": k, "w": w, **extra}


class Walls(unittest.TestCase):
    def test_flat_ground_gives_a_free_height_and_no_parapet(self):
        ctx = make_ctx(lambda x, z: 10.0, [way([(0, 0), (40, 0)])])
        (w,) = walls.build(ctx)["walls"]
        self.assertEqual(w["h"], 5.0)
        self.assertNotIn("hp", w)
        self.assertEqual((w["t"], w["m"], w["cr"]), (2.4, 1, 1))

    def test_a_four_metre_step_holds_ground_back(self):
        ctx = make_ctx(lambda x, z: 14.0 if z > 0 else 10.0, [way([(0, 0), (40, 0)])])
        (w,) = walls.build(ctx)["walls"]
        self.assertEqual(w["hp"], 1.4)
        self.assertNotIn("h", w)

    def test_a_way_that_changes_character_is_cut_at_the_vertex(self):
        ground = lambda x, z: 14.0 if (z > 0 and x > 30) else 10.0
        ctx = make_ctx(ground, [way([(0, 0), (15, 0), (30, 0), (45, 0), (60, 0)])])
        out = walls.build(ctx)["walls"]
        self.assertEqual([("hp" in w) for w in out], [False, True])
        self.assertEqual(out[0]["p"][-2:], out[1]["p"][:2])

    def test_a_short_run_takes_its_neighbours_character(self):
        ground = lambda x, z: 14.0 if (z > 0 and 20 <= x < 26) else 10.0
        ctx = make_ctx(ground, [way([(0, 0), (20, 0), (26, 0), (60, 0)])])
        out = walls.build(ctx)["walls"]
        self.assertEqual(len(out), 1)
        self.assertNotIn("hp", out[0])

    def test_a_fence_is_a_rail_and_never_holds_ground(self):
        ctx = make_ctx(lambda x, z: 14.0 if z > 0 else 10.0, [way([(0, 0), (40, 0)], "fence")])
        (w,) = walls.build(ctx)["walls"]
        self.assertEqual(w["rail"], "rail_iron")
        self.assertNotIn("hp", w)
        self.assertEqual(w["h"], 1.1)

    def test_tags_win(self):
        ctx = make_ctx(lambda x, z: 0.0, [way([(0, 0), (40, 0)], "wall", height="3.2", width="0.6")])
        (w,) = walls.build(ctx)["walls"]
        self.assertEqual((w["h"], w["t"]), (3.2, 0.6))


class Passages(unittest.TestCase):
    def passage(self, ring, rd, **tags):
        ctx = make_ctx(lambda x, z: 0.0, buildings_=[feature(ring, historic="city_gate", **tags)], roads=[rd])
        return walls.passages(ctx)

    def test_a_road_through_a_gate_building_gives_its_width_and_piers_of_two_metres(self):
        out = self.passage(rect(-5, -5, 5, 5), road([(-20, 0), (20, 0)], 6))
        ((x1, z1, x2, z2, w, top),) = out[("way", 1, 0)]
        self.assertEqual(w, 6)
        self.assertAlmostEqual(x1, -5.5, 1)
        self.assertAlmostEqual(x2, 5.5, 1)

    def test_a_narrow_building_reduces_the_width_or_gives_no_passage(self):
        out = self.passage(rect(-5, -3.5, 5, 3.5), road([(-20, 0), (20, 0)], 6))
        self.assertAlmostEqual(out[("way", 1, 0)][0][4], 4.6, 1)       # 7 - 2 * 1.2
        self.assertEqual(self.passage(rect(-5, -1.5, 5, 1.5), road([(-20, 0), (20, 0)], 6)), {})

    def test_steps_and_unrelated_buildings_get_none(self):
        self.assertEqual(self.passage(rect(-5, -4, 5, 4), road([(-20, 0), (20, 0)], 3, "steps")), {})
        ctx = make_ctx(lambda x, z: 0.0, buildings_=[feature(rect(-5, -4, 5, 4))], roads=[road([(-20, 0), (20, 0)], 6)])
        self.assertEqual(walls.passages(ctx), {})

    def test_a_building_passage_tunnel_through_any_building(self):
        ctx = make_ctx(lambda x, z: 0.0, buildings_=[feature(rect(-5, -4, 5, 4))], roads=[road([(-20, 0), (20, 0)], 4, tn="building_passage")])
        self.assertEqual(len(walls.passages(ctx)[("way", 1, 0)]), 1)

    def test_roads_side_by_side_make_one_way(self):
        out = self.passage(rect(-5, -5, 5, 5), road([(-20, 0), (20, 0)], 6))
        ctx = make_ctx(lambda x, z: 0.0, buildings_=[feature(rect(-5, -4, 5, 4), historic="city_gate")],
                       roads=[road([(-20, 0), (20, 0)], 6), road([(-20, 1.5), (20, 1.5)], 3, "footway")])
        self.assertEqual(len(walls.passages(ctx)[("way", 1, 0)]), len(out[("way", 1, 0)]))

    def test_on_a_slope_the_arch_starts_above_the_highest_ground_of_the_way(self):
        ring = rect(-5, -5, 5, 5)
        ctx = make_ctx(lambda x, z: 3.0 + 0.2 * (x + 5) if x > -5 else 3.0, buildings_=[feature(ring, historic="city_gate", height="24")], roads=[road([(-20, 0), (20, 0)], 6)])
        ctx.passages = walls.passages(ctx)
        (b,) = buildings.build(ctx)["buildings"]
        self.assertGreaterEqual(b["pass"][0][5], 2.0 + 2.2)     # the way climbs 2 m inside the footprint (a steeper one is steps: walls.MAX_CLIMB), 2.2 m clear at least

    def test_the_building_record_carries_the_passage_a_flat_roof_and_no_front(self):
        ring = rect(-5, -5, 5, 5)
        ctx = make_ctx(lambda x, z: 0.0, buildings_=[feature(ring, historic="city_gate")], roads=[road([(-20, 0), (20, 0)], 6)])
        ctx.passages = walls.passages(ctx)
        (b,) = buildings.build(ctx)["buildings"]
        (p,) = b["pass"]
        self.assertEqual(p[4], 6)
        self.assertTrue(2.2 <= p[5] <= 7.0 and p[5] <= 0.7 * b["h"])
        self.assertEqual((b["rs"], b["gf"]), (0, 0))
        self.assertNotIn("front", b)


if __name__ == "__main__":
    unittest.main()
