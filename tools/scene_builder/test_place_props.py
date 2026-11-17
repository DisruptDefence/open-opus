"""Props the place file puts on the map by hand (source 3): position, bearing true -> grid, `on: water`, refusals. Synthetic, no network."""
import unittest

import _paths  # noqa: F401
from scene_builder import place as place_mod, props
from scene_builder.ctx import Ctx

EXT = {"minX": -500, "maxX": 500, "minZ": -500, "maxZ": 500}


class FakePlace:
    def __init__(self, specs, conv=-1.6094):
        self.props, self.raw, self._conv = specs, {}, conv

    def georef(self):
        return {"convergence_deg": self._conv}


class Pack:
    pack = {}


def run(specs, ground=lambda x, z: 5.0, water=(), conv=-1.6094):
    ctx = Ctx(place=FakePlace(specs, conv), style=Pack(), osm=[], game=lambda la, lo: (lo, la), geo=None, ground=ground,
              surface_height=lambda x, z: None, ext=EXT, play={})
    ctx.features = {"roads": [], "buildings": [], "water": [{"ring": r, "tags": {}} for r in water]}
    ctx.layers = {"water": {"level": 0.0, "polygons": []}}
    out = props.build(ctx)
    return ctx, out


SHIP = {"kind": "ship_cargo", "lat": 20.0, "lon": 300.0, "bearing": 11.8, "variant": 12, "on": "water"}
RIVER = lambda x, z: 0.0 if x > 250 else 4.0  # noqa: E731


class PlaceProps(unittest.TestCase):
    def test_a_place_prop_is_an_item_with_source_3_at_the_converted_position_and_grid_bearing(self):
        ctx, out = run([SHIP], ground=RIVER)
        kinds, items = out["props"]["kinds"], out["props"]["items"]
        self.assertEqual(len(items), 1)
        k, x, z, yaw, variant, source, y = items[0]
        self.assertEqual((kinds[k], x, z, variant, source, y), ("ship_cargo", 300.0, 20.0, 12, 3, 0.0))
        self.assertAlmostEqual(yaw, 13.4, places=1)                       # true 11.8 = grid 13.4094 + convergence -1.6094
        self.assertIn("place_props", ctx.rules)

    def test_the_bearing_wraps_and_follows_the_convergence_sign(self):
        _, out = run([dict(SHIP, bearing=359.0)], ground=RIVER, conv=1.5)
        self.assertAlmostEqual(out["props"]["items"][0][3], 357.5, places=1)
        _, out = run([dict(SHIP, bearing=0.5)], ground=RIVER, conv=1.5)
        self.assertAlmostEqual(out["props"]["items"][0][3], 359.0, places=1)

    def test_on_water_rejects_a_point_on_land_and_says_which(self):
        with self.assertRaises(SystemExit) as e:
            run([SHIP], ground=lambda x, z: 4.0)
        self.assertIn("not on water", str(e.exception))
        self.assertIn("props[0]", str(e.exception))

    def test_a_water_polygon_counts_as_water_where_the_terrain_is_high(self):
        pond = [(290, 10), (310, 10), (310, 30), (290, 30)]
        _, out = run([SHIP], ground=lambda x, z: 4.0, water=[pond])
        self.assertEqual(out["props"]["items"][0][6], 0.0)

    def test_the_height_is_the_scenes_water_level(self):
        ctx = Ctx(place=FakePlace([SHIP]), style=Pack(), osm=[], game=lambda la, lo: (lo, la), geo=None, ground=RIVER, surface_height=lambda x, z: None, ext=EXT, play={})
        ctx.features = {"roads": [], "buildings": [], "water": []}
        ctx.layers = {"water": {"level": 1.25, "polygons": []}}
        self.assertEqual(props.build(ctx)["props"]["items"][0][6], 1.25)

    def test_an_unknown_kind_is_rejected(self):
        with self.assertRaises(SystemExit) as e:
            run([dict(SHIP, kind="submarine")], ground=RIVER)
        self.assertIn("not built", str(e.exception))

    def test_a_point_outside_the_extent_is_rejected(self):
        with self.assertRaises(SystemExit) as e:
            run([dict(SHIP, lon=900.0)], ground=RIVER)
        self.assertIn("outside the scene's extent", str(e.exception))

    def test_without_on_there_is_no_height_and_a_place_without_props_builds_as_before(self):
        _, out = run([dict(SHIP, on=None)], ground=lambda x, z: 4.0)
        self.assertEqual(len(out["props"]["items"][0]), 6)
        ctx, out = run([], ground=RIVER)
        self.assertEqual(out, {})
        self.assertNotIn("place_props", ctx.rules)

    def test_the_place_file_shape_is_checked(self):
        base = {"id": "x", "name": "X", "anchor": {"lat": 46.8, "lon": -71.2}, "play": {"halfWidth": 10, "halfHeight": 10},
                "terrain": {"source": "hrdem"}, "vertical": {"geoid_undulation": 0}, "style": "s"}
        self.assertEqual(place_mod.from_dict(base).props, [])
        ok = place_mod.from_dict(dict(base, props=[{"kind": "ship_cargo", "lat": 1.0, "lon": 2.0, "bearing": 3}]))
        self.assertEqual(ok.props[0]["kind"], "ship_cargo")
        for bad in ([{"kind": "ship_cargo", "lat": 1.0, "lon": 2.0}], [{"lat": 1.0, "lon": 2.0, "bearing": 3}],
                    [{"kind": "ship_cargo", "lat": 1.0, "lon": 2.0, "bearing": 3, "on": "moon"}], "ship"):
            with self.assertRaises(SystemExit):
                place_mod.from_dict(dict(base, props=bad))


if __name__ == "__main__":
    unittest.main()
