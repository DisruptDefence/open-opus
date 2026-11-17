"""Parked vehicles and bystanders by rule (props sources 4 and 5). Synthetic geometry, no network."""
import math
import unittest

import _paths  # noqa: F401
from scene_builder import streetlife
from scene_builder.ctx import Ctx

PARKING = {"on": ["residential"], "share": 1.0, "minWidth": 6.5, "kinds": {"car_hatch": 1}, "bikes": 0}
PEOPLE = {"density": 0.6, "squares": 2.0, "groups": [1, 2, 3]}


class Pack:
    def __init__(self, street):
        self.pack = {"street": street}


def road(pts, hw="residential", rid=2, w=7.0, sw=None, **tags):
    return {"pts": pts, "tags": {"highway": hw, "width": str(w), **tags}, "src": ("way", rid)}, {"k": hw, "w": w, **({"sw": sw} if sw else {})}


def rect(x0, z0, x1, z1):
    return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]


def run(roads, street=None, buildings=(), areas=(), walls=(), props=None, ext=None, crossings=(), ground=None):
    if street is None:
        street = {"sidewalk": {"width": 1.6}, "parking": PARKING}
    feats = [r[0] for r in roads]
    layers = {"roads": [r[1] for r in roads], "areas": list(areas), "walls": list(walls), "crossings": list(crossings)}
    if props:
        layers["props"] = props
    ctx = Ctx(place=None, style=Pack(street), osm=[], game=None, geo=None, ground=ground, surface_height=lambda x, z: None,
              ext=ext or {"minX": -500, "maxX": 500, "minZ": -500, "maxZ": 500}, play={})
    ctx.features = {"roads": feats, "buildings": [{"ring": b, "holes": [], "is_part": False} for b in buildings]}
    ctx.layers = layers
    out = streetlife.build(ctx)
    p = out.get("props", {"kinds": [], "items": []})
    return ctx, [(p["kinds"][i[0]], *i[1:]) for i in p["items"]], out


NORTH = [(0, 0), (0, -100)]   # runs north: its left is west (-x)


class Parking(unittest.TestCase):
    def test_slots_every_6_m_on_one_side_off_the_kerb_and_parallel(self):
        _, items, _ = run([road(NORTH)])
        cars = [i for i in items if i[5] == 4]
        zs = sorted(-i[2] for i in cars)
        self.assertEqual(zs[0], 9.0, "the first slot clear of the 8 m at the road end")
        self.assertTrue(all(abs((b - a) - 6.0) < 0.11 for a, b in zip(zs, zs[1:])), zs)
        self.assertGreaterEqual(len(cars), 10)
        self.assertEqual(len({i[1] < 0 for i in cars}), 1, "one side only")
        for c in cars:
            self.assertAlmostEqual(abs(c[1]), 3.5 - 0.25 - 1.75 / 2, delta=0.06)   # the car's side is 0.25 m off the kerb line (3.5 m)
            self.assertLessEqual(min(abs(c[3] - a) for a in (0, 180, 360)), 2)

    def test_side_follows_the_id_parity_and_the_nose_the_traffic_of_its_side(self):
        _, even, _ = run([road(NORTH, rid=2)])
        _, odd, _ = run([road(NORTH, rid=3)])
        self.assertTrue(all(i[1] < 0 for i in even if i[5] == 4), "even id: the left of travel (west)")
        self.assertTrue(all(i[1] > 0 for i in odd if i[5] == 4))
        # travelling north, the right side faces north (about 0 degrees), the left side faces south
        self.assertTrue(all(min(i[3], 360 - i[3]) <= 2 for i in odd if i[5] == 4))
        self.assertTrue(all(abs(i[3] - 180) <= 2 for i in even if i[5] == 4))

    def test_nothing_within_8_m_of_a_junction_or_a_road_end(self):
        cross = road([(-50, -50), (50, -50)], rid=4)
        _, items, _ = run([road(NORTH), cross])
        for c in (i for i in items if i[5] == 4 and abs(i[1]) < 20 and abs(i[2]) < 150 and i[2] > -100):
            self.assertGreaterEqual(math.hypot(c[1] - 0, c[2] + 50), 8.0)
            self.assertTrue(-92 < c[2] < -8, c)
        self.assertTrue(any(i[5] == 4 for i in items))

    def test_a_road_end_shared_with_another_way_and_a_crossing_node_keep_cars_away(self):
        a = road([(0, 0), (0, -50)], rid=2)
        b = road([(0, -50), (0, -100)], rid=4)
        _, items, _ = run([a, b], crossings=[[0, -25, 90, 7]])
        for c in (i for i in items if i[5] == 4):
            self.assertGreaterEqual(abs(c[2] + 50), 8.0 - 0.2)
            self.assertGreaterEqual(abs(c[2] + 25), 8.0 - 0.2)

    def test_narrow_roads_and_other_classes_get_none(self):
        _, items, _ = run([road(NORTH, w=6.0)])
        self.assertFalse(items)
        _, items, _ = run([road(NORTH, hw="pedestrian", w=9.0)])
        self.assertFalse(items)
        _, items, _ = run([road(NORTH, hw="service", w=9.0)])
        self.assertFalse(items)

    def test_not_on_a_tunnel_a_bridge_or_beside_steps(self):
        _, items, _ = run([road(NORTH, tunnel="yes")])
        self.assertFalse(items)
        _, items, _ = run([road(NORTH, bridge="yes")])
        self.assertFalse(items)
        steps = road([(30, -50), (35, -50)], hw="steps", rid=8, w=3.0)
        _, items, _ = run([road(NORTH, rid=3), steps])
        self.assertTrue(all(math.hypot(i[1] - 32.5, i[2] + 50) >= 8 for i in items if i[5] == 4 and abs(i[1]) < 20))

    def test_a_building_where_the_car_would_stand_blocks_it(self):
        wall_side = rect(-8, -60, -2.5, -30)     # on the west (left) side: the even-id parking side
        _, items, _ = run([road(NORTH)], buildings=[wall_side])
        self.assertFalse([i for i in items if i[5] == 4 and -62 < i[2] < -28])

    def test_deterministic_and_share_thins_the_slots(self):
        a = run([road(NORTH)], street={"sidewalk": {"width": 1.6}, "parking": dict(PARKING, share=0.3)})[1]
        b = run([road(NORTH)], street={"sidewalk": {"width": 1.6}, "parking": dict(PARKING, share=0.3)})[1]
        self.assertEqual(a, b)
        full = [i for i in run([road(NORTH)])[1] if i[5] == 4]
        self.assertLess(len([i for i in a if i[5] == 4]), len(full))

    def test_cap(self):
        _, items, _ = run([road([(0, 0), (0, -400)])], street={"sidewalk": {"width": 1.6}, "parking": dict(PARKING, max=7)})
        self.assertEqual(len([i for i in items if i[5] == 4]), 7)

    def test_steep_ground_drops_the_slot(self):
        _, items, _ = run([road(NORTH)], ground=lambda x, z: -z * 0.2)
        self.assertFalse(items)
        _, items, _ = run([road(NORTH)], ground=lambda x, z: 0.0)
        self.assertTrue(items)

    def test_vehicles_are_appended_to_the_existing_props_layer(self):
        _, items, out = run([road(NORTH)], props={"kinds": ["lamp_lantern"], "items": [[0, 5.0, -50.0, 0, 0, 2]]})
        self.assertEqual(out["props"]["kinds"][0], "lamp_lantern")
        self.assertIn(out["props"]["items"][0], [[0, 5.0, -50.0, 0, 0, 2]])
        self.assertTrue(any(i[5] == 4 for i in items))

    def test_a_style_without_the_keys_places_none(self):
        ctx, items, out = run([road(NORTH)], street={"sidewalk": {"width": 1.6}})
        self.assertEqual(out, {})
        self.assertNotIn("street_parking", ctx.rules)

    def test_rules_sentence_has_the_counts(self):
        ctx, items, _ = run([road(NORTH)])
        self.assertIn("vehicles", ctx.rules["street_parking"])
        self.assertIn("dropped", ctx.rules["street_parking"])

    def test_bicycles_only_on_wide_sidewalks_against_the_wall(self):
        street = {"sidewalk": {"width": 2.4}, "parking": dict(PARKING, share=0, bikes=1.0)}
        _, items, _ = run([road(NORTH, sw="both")], street=street)
        bikes = [i for i in items if i[0] == "bicycle"]
        self.assertGreaterEqual(len(bikes), 4)
        for b in bikes:
            self.assertAlmostEqual(abs(b[1]), 3.5 + 2.4 - 0.5, delta=0.06)
            self.assertEqual(b[5], 4)
        narrow = {"sidewalk": {"width": 1.6}, "parking": dict(PARKING, share=0, bikes=1.0)}
        self.assertFalse(run([road(NORTH, sw="both")], street=narrow)[1])


class People(unittest.TestCase):
    STREET = {"sidewalk": {"width": 2.4}, "people": dict(PEOPLE, density=30.0)}

    def test_groups_stay_on_the_sidewalk_strip_clear_of_kerb_and_wall(self):
        _, items, _ = run([road(NORTH, sw="both")], street=self.STREET)
        people = [i for i in items if i[0] == "person_stand"]
        self.assertGreater(len(people), 10)
        for p in people:
            self.assertEqual(p[5], 5)
            self.assertGreaterEqual(abs(p[1]), 3.5 + 0.5 - 0.06)
            self.assertLessEqual(abs(p[1]), 3.5 + 2.4 - 0.5 + 0.06)

    def test_pairs_face_each_other_0_6_to_0_9_m_apart(self):
        _, items, _ = run([road(NORTH, sw="both")], street={"sidewalk": {"width": 2.4}, "people": {"density": 30.0, "groups": [2]}})
        people = [i for i in items if i[0] == "person_stand"]
        self.assertEqual(len(people) % 2, 0)
        for a, b in zip(people[0::2], people[1::2]):
            self.assertTrue(0.55 <= math.hypot(a[1] - b[1], a[2] - b[2]) <= 0.95)
            diff = abs(((a[3] - b[3]) + 180) % 360 - 180)
            self.assertGreaterEqual(diff, 150 - 16)

    def test_never_in_a_building_never_on_a_carriageway(self):
        b = rect(-30, -60, -4.2, -20)           # to the west, behind the west sidewalk (its edge is 0.7 m off the strip)
        cross = road([(-60, -40), (60, -40)], rid=6, w=7.0)
        _, items, _ = run([road(NORTH, sw="both"), cross], street=self.STREET, buildings=[b])
        for p in (i for i in items if i[0] == "person_stand"):
            self.assertFalse(-30 < p[1] < -4.2 and -60 < p[2] < -20, p)
            self.assertGreater(abs(p[2] + 40), 3.5 + 0.45, "not on the cross street")

    def test_squares_get_groups_by_area_and_stay_inside(self):
        ring = [-20, -20, 20, -20, 20, 20, -20, 20]   # 1 600 m2: 3.2 groups
        area = {"r": ring, "k": "pedestrian"}
        _, items, _ = run([], street={"people": PEOPLE}, areas=[area])
        people = [i for i in items if i[0] == "person_stand"]
        self.assertTrue(2 <= len(people) <= 12, len(people))
        for p in people:
            self.assertTrue(-19.4 <= p[1] <= 19.4 and -19.4 <= p[2] <= 19.4)

    def test_a_pedestrian_street_counts_like_an_area(self):
        _, items, _ = run([road([(0, 0), (0, -400)], hw="pedestrian", w=6.0)], street={"people": PEOPLE})
        people = [i for i in items if i[0] == "person_stand"]
        self.assertGreater(len(people), 3)
        for p in people:
            self.assertLessEqual(abs(p[1]), 3.0 - 0.8 + 0.1 + 0.5)

    def test_cap_counts_people_and_extent_is_respected(self):
        _, items, _ = run([road([(0, 0), (0, -400)], sw="both")], street={"sidewalk": {"width": 2.4}, "people": dict(PEOPLE, density=30.0, max=9)})
        self.assertLessEqual(len([i for i in items if i[0] == "person_stand"]), 9)
        _, items, _ = run([road(NORTH, sw="both")], street=self.STREET, ext={"minX": -500, "maxX": 500, "minZ": -50, "maxZ": 500})
        self.assertTrue(all(i[2] >= -50 for i in items))

    def test_deterministic_and_none_without_the_key(self):
        a, b = run([road(NORTH, sw="both")], street=self.STREET)[1], run([road(NORTH, sw="both")], street=self.STREET)[1]
        self.assertEqual(a, b)
        _, items, out = run([road(NORTH, sw="both")], street={"sidewalk": {"width": 2.4}})
        self.assertEqual(out, {})

    def test_groups_keep_apart_and_off_props_and_cars(self):
        props = {"kinds": ["bench_slat"], "items": [[0, 4.9, -50.0, 90, 0, 0]]}
        _, items, _ = run([road(NORTH, sw="both")], street=self.STREET, props=props)
        for p in (i for i in items if i[0] == "person_stand"):
            self.assertGreater(math.hypot(p[1] - 4.9, p[2] + 50), 1.1)

    def test_rules_sentence_has_counts(self):
        ctx, _, _ = run([road(NORTH, sw="both")], street=self.STREET)
        self.assertIn("people in", ctx.rules["street_people"])
        self.assertIn("dropped", ctx.rules["street_people"])


if __name__ == "__main__":
    unittest.main()
