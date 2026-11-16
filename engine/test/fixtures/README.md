# Fixture scenes

Small hand-written scenes in the single-file packaging, for the reader, the mesher and the collision.

- `scene-old.json` — records as scenes were written before `formatMinor: 1`: none of the keys of
  `docs/plans/SCENE-DETAIL.md` section 3. It must keep decoding to the picture the engine drew before.
- `scene-new.json` — the same ground with every addition of section 3, written exactly as that section says:
  resolved roofs, façades and palettes, blind and front edges, a passage, an outline with parts, a floating part,
  road keys, crossings, wall keys, six-number trees, props, `style`, `season`, `ambience`.

The place is nowhere: the georeference is the synthetic one of `engine/scenes/test/`. The terrain is not written
out; `terrain.plane` gives a tilted plane (`y = y0 + sx (x − minX) + sz (z − minZ)`) and `test/helpers.js`
`fixture()` fills in the samples. The box spans four chunks (their corner is at x = −100, z = 50) so a record can
cross a chunk edge.
