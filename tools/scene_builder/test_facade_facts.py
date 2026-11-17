"""The `facades` enricher: zones and per-building facts to `fa`, `wc`, `dr`, `frm`. Synthetic contexts, no network."""
import json
import tempfile
import unittest
from pathlib import Path

import _paths
from scene_builder import buildings, facade_facts as ff
from scene_builder.ctx import Ctx
from scene_builder.style import FACADES
from test_buildings import ccw, ft, test_style

ZONE = {"id": "z1", "centre": [0.0, 0.0], "radius": 100,
        "walls": [{"material": "brick", "colour": "#a05e3d", "share": 0.5}, {"material": "painted_white", "colour": "#e3e2e1", "share": 0.3},
                  {"material": "stone", "colour": "#9d9a93", "share": 0.2}],
        "accents": [{"colour": "#2a5db0", "share": 0.6}, {"colour": "#c0392b", "share": 0.4}]}


def facts(zones=None, buildings_=None, centres=None):
    f = ff.Facts(zones if zones is not None else [ZONE], buildings_ or [], [{"id": "p1", "title": "A photograph", "author": "Someone", "licence": "CC BY 4.0", "url": "https://example.org/p1"}], "t", "derived")
    f.centres = centres if centres is not None else [(0.0, 0.0)]
    return f


def run(fts, f, st=None):
    ctx = Ctx(place=None, style=st or test_style(), osm=[], game=None, geo=None, ground=lambda x, z: 0.0, surface_height=lambda x, z: None, ext={}, play={})
    ctx.surface_model = False
    ctx.features = {"buildings": fts, "pois": []}
    ctx.layers = {"roads": []}
    ctx.facades = f
    return buildings.build(ctx)["buildings"], ctx


def houses(n, tags=None, at=(0, 0)):
    out = []
    for i in range(n):
        x0 = at[0] + i * 20
        out.append(ft(ccw(x0, at[1], x0 + 8, at[1] + 8), n=i + 1, tags=dict(tags or {"building": "yes"})))
    return out


class Decide(unittest.TestCase):
    def test_material_classes(self):
        got = {}
        for sid in range(1, 400):
            r = ff.decide(facts(), sid, sid, 1.0, 1.0, 0, None)
            got.setdefault(FACADES[r["fa"]], set()).add(r["wc"])
        self.assertEqual(set(got), {"brick", "stucco", "stone_ashlar"})
        self.assertEqual(got["brick"], {"#a05e3d"}); self.assertEqual(got["stucco"], {"#e3e2e1"}); self.assertEqual(got["stone_ashlar"], {"#9d9a93"})

    def test_the_colour_is_a_colour_of_the_chosen_material(self):
        for sid in range(1, 200):
            r = ff.decide(facts(), sid, sid, 0, 0, 0, None)
            w = [e for e in ZONE["walls"] if e["colour"] == r["wc"]]
            self.assertEqual(len(w), 1)
            self.assertEqual(r["fa"], {"brick": 3, "painted_white": 4}.get(w[0]["material"], r["fa"]))

    def test_stone_keeps_the_styles_own_class(self):
        only_stone = {"walls": [{"material": "stone", "colour": "#9d9a93", "share": 1}], "accents": [], "id": "s", "centre": [0, 0], "radius": 100}
        f = facts([only_stone])
        self.assertEqual(ff.decide(f, 1, 1, 0, 0, FACADES.index("stone_rubble"), {"stucco": 1})["fa"], FACADES.index("stone_rubble"))
        self.assertEqual(ff.decide(f, 1, 1, 0, 0, FACADES.index("brick"), {"stone_rubble": 1, "brick": 1})["fa"], FACADES.index("stone_rubble"))
        self.assertEqual(ff.decide(f, 1, 1, 0, 0, FACADES.index("brick"), {"stucco": 1})["fa"], FACADES.index("stone_ashlar"))

    def test_weight_falls_off_to_the_edge_and_outside_is_left_alone(self):
        self.assertEqual(ff.weight_at(0, 100), 1.0); self.assertEqual(ff.weight_at(60, 100), 1.0)
        self.assertAlmostEqual(ff.weight_at(80, 100), 0.5); self.assertEqual(ff.weight_at(100, 100), 0.0)
        inside = sum(ff.decide(facts(), s, s, 10, 0, 0, None) is not None for s in range(1, 301))
        edge = sum(ff.decide(facts(), s, s, 80, 0, 0, None) is not None for s in range(1, 301))
        out = sum(ff.decide(facts(), s, s, 101, 0, 0, None) is not None for s in range(1, 301))
        self.assertEqual(inside, 300); self.assertEqual(out, 0)
        self.assertTrue(110 < edge < 190, edge)

    def test_nearest_zone_wins(self):
        other = dict(ZONE, id="z2", centre=[0.0, 0.001], walls=[{"material": "brick", "colour": "#111111", "share": 1}])
        f = facts([ZONE, other], centres=[(0.0, 0.0), (50.0, 0.0)])
        self.assertEqual(ff.decide(f, 1, 1, 45.0, 0, 0, None)["wc"], "#111111")
        self.assertEqual(ff.decide(f, 1, 1, 5.0, 0, 0, None)["by"], "zone:z1")

    def test_seeded_and_the_outline_id_is_the_seed(self):
        a, b = ff.decide(facts(), 7, 100, 0, 0, 0, None), ff.decide(facts(), 7, 200, 0, 0, 0, None)
        self.assertEqual(a, b, "two parts of one building (same outline id 7) get the same look")
        self.assertEqual(ff.decide(facts(), 7, 100, 0, 0, 0, None), ff.decide(facts(), 7, 100, 0, 0, 0, None))

    def test_a_per_building_fact_wins_over_the_zone_but_not_below_its_confidence(self):
        b = {"buildingId": 42, "material": "brick", "colour": "#7a3b2e", "accents": ["#112233", "#445566"], "confidence": 0.8}
        f = facts(buildings_=[b])
        r = ff.decide(f, 42, 42, 0, 0, 0, None)
        self.assertEqual((r["by"], r["fa"], r["wc"], r["dr"], r["frm"]), ("building", 3, "#7a3b2e", "#112233", "#445566"))
        self.assertEqual(ff.decide(f, 43, 43, 0, 0, 0, None)["by"], "zone:z1")
        f2 = facts(buildings_=[dict(b, confidence=0.2)])
        self.assertEqual(ff.decide(f2, 42, 42, 0, 0, 0, None)["by"], "zone:z1")
        far = facts(buildings_=[b], centres=[(900.0, 900.0)])
        self.assertEqual(ff.decide(far, 42, 42, 0, 0, 0, None)["by"], "building", "a per-building fact needs no zone")

    def test_validation(self):
        good = {"format": ff.FORMAT, "zones": [ZONE], "buildings": []}
        ff.validate(good)
        for bad in ({"format": "x"}, {"format": ff.FORMAT, "zones": [dict(ZONE, walls=[{"material": "glass", "colour": "#000000", "share": 1}])]},
                    {"format": ff.FORMAT, "zones": [dict(ZONE, walls=[{"material": "brick", "colour": "red", "share": 1}])]},
                    {"format": ff.FORMAT, "buildings": [{"buildingId": 1, "colour": "nope"}]}):
            with self.assertRaises(SystemExit):
                ff.validate(bad)


class InTheLayer(unittest.TestCase):
    def test_buildings_in_a_zone_are_recoloured_and_the_rest_left(self):
        near = houses(4)
        far = houses(10, at=(1000, 0))
        recs, ctx = run(near + far, facts())
        got = [b for b in recs if "wc" in b]
        self.assertEqual(len(got), 4)
        self.assertTrue(all(b["r"][0] < 100 for b in got), "buildings outside the disc keep the style's rule")
        for b in got:
            self.assertEqual(b["fa"] in (3, 4, 1, 2), True)
            self.assertIn("pal", b, "the palette index stays for an old reader")
        self.assertIn("facade_facts", ctx.rules); self.assertIn("left to the style", ctx.rules["facade_facts"])
        self.assertEqual(ctx.stats_facades["recoloured"], len(got))

    def test_tagged_buildings_are_never_touched(self):
        for tags in ({"building": "yes", "building:material": "brick"}, {"building": "yes", "building:colour": "#aa0000"}):
            recs, _ = run(houses(10, tags), facts())
            self.assertTrue(all("wc" not in b for b in recs), tags)
        recs, _ = run(houses(4, {"building": "yes", "building:material": "limestone"}), facts())   # an unmapped word is no evidence
        self.assertTrue(any("wc" in b for b in recs))

    def test_a_landmark_rule_is_never_overridden(self):
        class Place:
            raw = {"landmarks": [{"id": "keep", "match": {"name": "Keep"}, "set": {"facade": "stone_ashlar", "palette": [0]}}]}
        part = ft(ccw(1, 1, 7, 7), n=99, tags={"building:part": "yes"}, is_part=True)
        fts = houses(1, {"building": "yes", "name": "Keep"}) + [part] + houses(3, at=(0, 50))
        ctx = Ctx(place=Place(), style=test_style(), osm=[], game=None, geo=None, ground=lambda x, z: 0.0, surface_height=lambda x, z: None, ext={}, play={})
        ctx.surface_model = False
        ctx.features = {"buildings": fts, "pois": []}
        ctx.layers = {"roads": []}
        ctx.facades = facts()
        recs = buildings.build(ctx)["buildings"]
        keep = [b for b in recs if b.get("lmid") == "keep"]
        self.assertEqual(len(keep), 1)
        self.assertNotIn("wc", keep[0], "the part the landmark rule shaped"); self.assertEqual(keep[0]["fa"], FACADES.index("stone_ashlar"))
        self.assertEqual(sum("wc" in b for b in recs if not b.get("parts")), 3, "the other three drawn records, in the zone, are recoloured (an outline drawn from its parts is not drawn)")

    def test_deterministic(self):
        a, _ = run(houses(20), facts()); b, _ = run(houses(20), facts())
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))

    def test_without_the_enricher_nothing_changes(self):
        a, _ = run(houses(10), None)
        self.assertTrue(all("wc" not in b for b in a))


class Loading(unittest.TestCase):
    def test_load_reads_the_file_beside_the_place_and_credits_the_photographs(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "enrichers").mkdir()
            (Path(d) / "enrichers" / "z.json").write_text(json.dumps({"format": ff.FORMAT, "zones": [ZONE], "buildings": [], "sources": [{"id": "p1", "title": "T", "author": "A", "licence": "CC BY-SA 4.0", "url": "u"}]}))
            spec = {"kind": "facades", "title": "From photographs", "licence": "derived facts", "file": "enrichers/z.json"}
            f = ff.load([spec, {"kind": "trees"}], Path(d) / "place.json", lambda la, lo: (la * 100, lo * 100))
            self.assertEqual(len(f.zones), 1); self.assertEqual(f.centres, [(0.0, 0.0)])
            e = ff.source_entry(f)
            self.assertEqual(e["credits"][0]["author"], "A"); self.assertEqual(e["layers"], ["buildings"])
            with self.assertRaises(SystemExit):
                ff.load([dict(spec, file="enrichers/missing.json")], Path(d) / "place.json")
            self.assertIsNone(ff.load([{"kind": "trees"}], Path(d) / "place.json"))


if __name__ == "__main__":
    unittest.main()
