"""A reader for the one kind of GeoTIFF the HRDEM WCS returns."""
from __future__ import annotations

import array
import struct
import sys


def read_float_tiff(raw: bytes) -> tuple[list[list[float]], tuple[float, float], tuple[float, float], float]:
    """An uncompressed, tiled or stripped, one-band 32-bit float GeoTIFF: rows, pixel size, the top-left corner
    and the no-data value. That is what the WCS returns; anything else stops the build."""
    bo = "<" if raw[:2] == b"II" else ">"
    if struct.unpack(bo + "H", raw[2:4])[0] != 42:
        raise SystemExit("terrain: not a classic TIFF")
    off = struct.unpack(bo + "I", raw[4:8])[0]
    count = struct.unpack(bo + "H", raw[off:off + 2])[0]
    sizes = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8}
    fmts = {1: "B", 3: "H", 4: "I", 11: "f", 12: "d"}
    tags: dict[int, object] = {}
    for i in range(count):
        tag, typ, n = struct.unpack(bo + "HHI", raw[off + 2 + i * 12: off + 10 + i * 12])
        field = raw[off + 10 + i * 12: off + 14 + i * 12]
        size = sizes.get(typ, 1) * n
        data = field[:size] if size <= 4 else raw[struct.unpack(bo + "I", field)[0]:][:size]
        tags[tag] = data.rstrip(b"\0").decode("latin-1") if typ == 2 else struct.unpack(bo + fmts[typ] * n, data) if typ in fmts else data
    w, h = tags[256][0], tags[257][0]
    if tags.get(259, (1,))[0] != 1 or tags[258][0] != 32 or tags.get(339, (1,))[0] != 3 or tags.get(277, (1,))[0] != 1:
        raise SystemExit("terrain: expected an uncompressed one-band 32-bit float TIFF")
    rows = [[0.0] * w for _ in range(h)]

    def floats(o: int, n: int) -> array.array:
        a = array.array("f")
        a.frombytes(raw[o:o + n * 4])
        if (bo == ">") != (sys.byteorder == "big"):
            a.byteswap()
        return a

    if 324 in tags:  # tiles
        tw, th = tags[322][0], tags[323][0]
        across = (w + tw - 1) // tw
        for i, o in enumerate(tags[324]):
            a = floats(o, tw * th)
            ty, tx = (i // across) * th, (i % across) * tw
            for r in range(min(th, h - ty)):
                n = min(tw, w - tx)
                rows[ty + r][tx:tx + n] = a[r * tw: r * tw + n]
    else:            # strips
        rps = tags.get(278, (h,))[0]
        for i, o in enumerate(tags[273]):
            n = min(rps, h - i * rps)
            a = floats(o, n * w)
            for r in range(n):
                rows[i * rps + r] = list(a[r * w:(r + 1) * w])
    scale, tie = tags[33550], tags[33922]
    nodata = float(tags[42113]) if 42113 in tags else -32767.0
    return rows, (scale[0], scale[1]), (tie[3] - tie[0] * scale[0], tie[4] + tie[1] * scale[1]), nodata
