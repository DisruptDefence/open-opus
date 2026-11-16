import unittest
from types import SimpleNamespace

import _paths  # noqa: F401
from scene_builder import ground


class Surface(unittest.TestCase):
    street = {"surface": {"footway": "paving", "residential": "asphalt"}}

    def test_words_map_to_the_format_classes(self):
        for word, cls in (("sett", 3), ("cobblestone", 3), ("asphalt", 1), ("concrete:plates", 2), ("paving_stones", 4), ("fine_gravel", 5),
                          ("mud", 6), ("grass", 7), ("rock", 9), ("wood", 12), ("metal_grid", 13)):
            self.assertEqual(ground.surface_class({"surface": word}, "residential", self.street), cls, word)

    def test_without_a_word_the_style_picks_then_asphalt(self):
        self.assertEqual(ground.surface_class({}, "footway", self.street), 4)
        self.assertEqual(ground.surface_class({"surface": "weird"}, "residential", self.street), 1)
        self.assertEqual(ground.surface_class({}, "primary", self.street), 1)


class Sidewalks(unittest.TestCase):
    def test_tags(self):
        side = lambda t: ground.sidewalk_side(t, "residential", {})  # noqa: E731
        self.assertEqual(side({"sidewalk": "no"}), "no")
        self.assertEqual(side({"sidewalk": "separate"}), "no")
        self.assertEqual(side({"sidewalk": "left"}), "left")
        self.assertEqual(side({"sidewalk:both": "separate"}), "no")
        self.assertEqual(side({"sidewalk:left": "yes", "sidewalk:right": "no"}), "left")
        self.assertEqual(side({"sidewalk:left": "yes", "sidewalk:right": "yes"}), "both")
        self.assertIsNone(side({}))

    def test_a_footway_sidewalk_3_m_away_means_none(self):
        road = [(0.0, 0.0), (60.0, 0.0)]
        grid = ground.sidewalk_grid([{"tags": {"footway": "sidewalk"}, "pts": [(0.0, 3.0), (60.0, 3.0)]}])
        self.assertTrue(ground.has_parallel_sidewalk(road, grid))
        far = ground.sidewalk_grid([{"tags": {"footway": "sidewalk"}, "pts": [(0.0, 9.0), (60.0, 9.0)]}])
        self.assertFalse(ground.has_parallel_sidewalk(road, far))


class Crossings(unittest.TestCase):
    def test_a_crossing_node_5_m_from_any_road_is_dropped_and_one_on_a_road_is_kept(self):
        roads = [{"pts": [(0.0, 0.0), (100.0, 0.0)], "tags": {"highway": "residential", "width": "8"}}]
        ctx = SimpleNamespace(features={"roads": roads, "crossings": [{"x": 50.0, "z": 5.0, "tags": {}}, {"x": 40.0, "z": 0.4, "tags": {}}]})
        out = ground.crossing_records(ctx)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0][0], 40.0)
        self.assertEqual(out[0][3], 8.0)
        self.assertEqual(out[0][2], 90)  # the road runs east: bearing 90 from grid north


class Steps(unittest.TestCase):
    def test_count_from_the_tag_else_from_the_rise(self):
        self.assertEqual(ground.step_record({"step_count": "14"}, [(0, 0), (1, 0)], lambda x, z: 0)["sc"], 14)
        self.assertEqual(ground.step_record({}, [(0, 0), (10, 0)], lambda x, z: x * 0.34)["sc"], 20)
        self.assertEqual(ground.step_record({"handrail": "yes"}, [(0, 0), (1, 0)], lambda x, z: 0)["hr"], 1)
        self.assertEqual(ground.step_record({"handrail:center": "yes"}, [(0, 0), (1, 0)], lambda x, z: 0)["hr"], 2)


if __name__ == "__main__":
    unittest.main()
