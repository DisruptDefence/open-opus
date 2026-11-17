"""Item 8: lamps by street rule (props source 2). Synthetic geometry, no network."""
import math
import unittest

import _paths  # noqa: F401
from scene_builder import props
from scene_builder.ctx import Ctx


class Pack:
    def __init__(self, lamps):
        self.pack = {"street": {"lamps": lamps} if lamps is not None else {}}


LAMPS = {"kind": "lamp_lantern", "spacing": 24, "offset": 0.6, "stagger": True, "on": ["residential"]}


def road(pts, hw="residential", rid=2, **tags):
    return {"pts": pts, "tags": {"highway": hw, "width": "6", **tags}, "src": ("way", rid)}


def rect(x0, z0, x1, z1):
    return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]


def run(roads, lamps=LAMPS, buildings=(), osm=(), ext=None):
    ctx = Ctx(place=None, style=Pack(lamps), osm=list(osm), game=lambda la, lo: (lo, la), geo=None, ground=None,
              surface_height=lambda x, z: None, ext=ext or {"minX": -500, "maxX": 500, "minZ": -500, "maxZ": 500}, play={})
    ctx.features = {"roads": roads, "buildings": [{"ring": r, "holes": [], "is_part": False} for r in buildings]}
    out = props.build(ctx)
    items = out.get("props", {}).get("items", [])
    return ctx, [i for i in items if i[5] == 2], out


NORTH = [(0, 0), (0, -100)]   # runs north, bearing 0; its left is west (-x)


class StreetLamps(unittest.TestCase):
    def test_straight_road_lamps_at_half_spacing_then_every_spacing_alternating(self):
        _, items, out = run([road(NORTH)])
        self.assertEqual([-i[2] for i in items], [12, 36, 60, 84])
        for i in items:
            self.assertAlmostEqual(abs(i[1]), 3.6, places=1)
            self.assertEqual(i[3], 0)
        self.assertEqual([i[1] < 0 for i in items], [True, False, True, False])  # id 2 starts on the left
        self.assertEqual(out["props"]["kinds"][items[0][0]], "lamp_lantern")

    def test_start_side_follows_the_road_id_parity(self):
        _, items, _ = run([road(NORTH, rid=3)])
        self.assertEqual([i[1] < 0 for i in items], [False, True, False, True])

    def test_no_stagger_keeps_one_side(self):
        _, items, _ = run([road(NORTH)], dict(LAMPS, stagger=False))
        self.assertEqual(len(items), 4)
        self.assertEqual(len({i[1] > 0 for i in items}), 1)

    def test_a_building_on_the_left_moves_the_lamp_right_and_both_sides_drop_it(self):
        left = rect(-10, -45, -2, -30)          # covers x = -3.6 at z = -36
        right = rect(2, -45, 10, -30)
        ctx, items, _ = run([road(NORTH)], buildings=[left])
        self.assertEqual(len(items), 4)
        self.assertTrue(any(abs(i[2] + 36) < 0.1 and i[1] > 0 for i in items))
        ctx, items, _ = run([road(NORTH)], buildings=[left, right])
        self.assertEqual(len(items), 3)
        self.assertIn("1 inside a building", ctx.rules["street_lamps"])
        self.assertIn("3 placed", ctx.rules["street_lamps"])

    def test_a_mapped_lamp_near_a_rule_position_suppresses_it(self):
        osm = [{"type": "node", "id": 1, "lat": -36.0, "lon": 8.0, "tags": {"highway": "street_lamp"}}]
        ctx = None
        ext = {"minX": -500, "maxX": 500, "minZ": -500, "maxZ": 500}
        c = Ctx(place=None, style=Pack(LAMPS), osm=osm, game=lambda la, lo: (lo, la), geo=None, ground=None,
                surface_height=lambda x, z: None, ext=ext, play={})
        c.style.pack["props"] = {"highway=street_lamp": "lamp_lantern"}
        c.features = {"roads": [road(NORTH)], "buildings": []}
        items = props.build(c)["props"]["items"]
        self.assertEqual(sum(1 for i in items if i[5] == 0), 1)
        self.assertEqual(sorted(-i[2] for i in items if i[5] == 2), [12, 60, 84])
        self.assertIn("1 too close", c.rules["street_lamps"])

    def test_steps_other_classes_tunnels_bridges_and_short_roads_get_none(self):
        lamps = dict(LAMPS, on=["residential", "steps"])
        self.assertEqual(run([road(NORTH, hw="steps")], lamps)[1], [])
        self.assertEqual(run([road(NORTH, hw="service")])[1], [])
        self.assertEqual(run([road(NORTH, tunnel="yes")])[1], [])
        self.assertEqual(run([road(NORTH, bridge="yes")])[1], [])
        self.assertEqual(run([road([(0, 0), (0, -11)])])[1], [])

    def test_no_street_lamps_in_the_style_places_none(self):
        ctx, items, _ = run([road(NORTH)], None)
        self.assertEqual(items, [])
        self.assertNotIn("street_lamps", ctx.rules)

    def test_a_kind_that_is_not_built_places_none_and_says_so(self):
        ctx, items, _ = run([road(NORTH)], dict(LAMPS, kind="lamp_cobra"))
        self.assertEqual(items, [])
        self.assertIn("not built", ctx.rules["street_lamps"])

    def test_outside_the_extent_is_dropped_and_counted(self):
        ctx, items, _ = run([road(NORTH)], ext={"minX": -50, "maxX": 50, "minZ": -50, "maxZ": 50})
        self.assertEqual(len(items), 2)
        self.assertIn("2 outside the extent", ctx.rules["street_lamps"])

    def test_two_runs_are_equal(self):
        r = [road([(0, 0), (40, -30), (90, -20)], rid=7)]
        self.assertEqual(run(r)[2], run(r)[2])


if __name__ == "__main__":
    unittest.main()
