"""Item 9 and 8: place landmark rules (fill, set, turrets), terraces, props. Synthetic geometry, no network."""
import unittest

import _paths  # noqa: F401
from scene_builder import landmark_rules as L, props, terrace
from scene_builder.ctx import Ctx
from scene_builder.geom import ring_area


def rect(x0, z0, x1, z1):
    return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]


class Remainder(unittest.TestCase):
    def test_what_no_part_covers_comes_back_as_a_polygon_of_that_area(self):
        out = L.remainder(rect(0, 0, 40, 20), [], [rect(0, 0, 20, 20)])
        self.assertEqual(len(out), 1)
        ring, holes = out[0]
        self.assertAlmostEqual(abs(ring_area(ring)), 20 * 20, delta=25)
        self.assertEqual(holes, [])
        self.assertTrue(all(p[0] >= 19 for p in ring))

    def test_a_courtyard_is_not_filled(self):
        out = L.remainder(rect(0, 0, 40, 40), [rect(15, 15, 25, 25)], [rect(0, 0, 40, 10)])
        total = sum(abs(ring_area(r)) - sum(abs(ring_area(h)) for h in hs) for r, hs in out)
        self.assertAlmostEqual(total, 40 * 30 - 100, delta=60)

    def test_a_sliver_between_two_parts_is_dropped(self):
        self.assertEqual(L.remainder(rect(0, 0, 40, 20), [], [rect(0, 0, 19, 20), rect(21, 0, 40, 20)]), [])


class Turrets(unittest.TestCase):
    def test_an_outer_square_corner_takes_one_and_a_round_corner_none(self):
        outline = rect(0, 0, 30, 30)
        sites = L.turret_sites([outline], outline, [], {"radius": 3, "minEdge": 8, "cornerDeg": [80, 100]})
        self.assertEqual(len(sites), 4)
        for (x, z), _ in sites:
            self.assertTrue(0 < x < 30 and 0 < z < 30)
        self.assertEqual(L.turret_sites([L.circle((0, 0), 10, 16)], L.circle((0, 0), 10, 16), [], {"minEdge": 6}), [])

    def test_two_corners_closer_than_two_radii_make_one(self):
        outline = rect(0, 0, 30, 30)
        sites = L.turret_sites([outline], outline, [], {"radius": 20, "minEdge": 8, "cornerDeg": [80, 100]})
        self.assertEqual(len(sites), 1)


class Terrace(unittest.TestCase):
    def ctx(self, ground):
        return Ctx(place=None, style=None, osm=[], game=None, geo=None, ground=ground, surface_height=lambda x, z: None, ext={}, play={})

    def test_a_rail_runs_only_where_the_ground_drops_outside_and_is_moved_inside(self):
        ring = [(0, 0), (10, 0), (10, 40), (0, 40)]          # the ground falls away east of x = 10
        lines = terrace.rail_lines(self.ctx(lambda x, z: 50.0 if x <= 10 else 40.0), ring, [], 2.0, 0.25)
        self.assertEqual(len(lines), 1)
        for x, z in lines[0]:
            self.assertAlmostEqual(x, 9.75, places=3)
        self.assertAlmostEqual(abs(lines[0][-1][1] - lines[0][0][1]), 40, delta=4.5)
        self.assertEqual(terrace.rail_lines(self.ctx(lambda x, z: 50.0), ring, [], 2.0, 0.25), [])

    def test_lamps_every_spacing_along_a_line_starting_half_a_spacing_in(self):
        pts = terrace.along([(0, 0), (0, -100)], 25.0, 12.5)
        self.assertEqual(len(pts), 4)
        self.assertAlmostEqual(pts[0][2], 0.0, places=3)      # a line running north has bearing 0


class Props(unittest.TestCase):
    def test_a_compass_word_and_a_number_are_directions_and_nothing_else_is(self):
        self.assertEqual(props.direction({"direction": "E"}), 90.0)
        self.assertEqual(props.direction({"direction": "ESE"}), 112.5)
        self.assertEqual(props.direction({"direction": "450"}), 90.0)
        self.assertIsNone(props.direction({"direction": "forward"}))
        self.assertIsNone(props.direction({}))

    def test_a_bench_faces_the_nearest_rail_within_reach(self):
        self.assertAlmostEqual(props.facing_nearest([[(10, -50), (10, 50)]], 4, 0, 14), 90.0, places=3)
        self.assertIsNone(props.facing_nearest([[(100, -50), (100, 50)]], 4, 0, 14))


if __name__ == "__main__":
    unittest.main()
