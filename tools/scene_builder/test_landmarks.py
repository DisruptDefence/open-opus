"""Item 9 and 8: place landmark rules (fill, set, turrets), terraces, props. Synthetic geometry, no network."""
import unittest

import _paths  # noqa: F401
from scene_builder import landmark_rules as L
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


if __name__ == "__main__":
    unittest.main()
