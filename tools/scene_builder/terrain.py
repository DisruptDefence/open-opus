"""Terrain from the HRDEM 1 m rasters. The bare-earth model (`dtm`) is averaged into the scene's cell (the mean
of the 1 m samples inside each cell: it removes lidar speckle); the surface model (`dsm`) is kept at 1 m for
`surface_height`, which measures buildings and trees. The rasters are in the mosaic's own grid; a plane fitted
through three corners of the box maps game metres to its pixels (checked at the fourth corner)."""
from __future__ import annotations

import array
import base64
import math
import sys

from . import geo
from .tiff import read_float_tiff


class Raster:
    def __init__(self, raw: bytes, place):
        rows, (self.px, self.py), (self.ox, self.oy), self.nodata = read_float_tiff(raw)
        self.h, self.w = len(rows), len(rows[0])
        self.data = array.array("f")
        for r in rows:
            self.data.extend(r)
        self.valid_any = any(self._ok(v) for v in self.data[:: max(1, len(self.data) // 20000)])
        self._fit(place)

    def _ok(self, v: float) -> bool:
        return v > self.nodata + 1 and v < 1e6

    def _pix(self, place, x: float, z: float) -> tuple[float, float]:
        lx, ly = geo.to_lambert(*place.geo(x, z))
        return (lx - self.ox) / self.px, (self.oy - ly) / self.py

    def _fit(self, place) -> None:
        e = place.ext
        (ax, az), (bx, bz), (cx, cz) = (e["minX"], e["minZ"]), (e["maxX"], e["minZ"]), (e["minX"], e["maxZ"])
        pa, pb, pc = (self._pix(place, *q) for q in ((ax, az), (bx, bz), (cx, cz)))
        self.m = ((pb[0] - pa[0]) / (bx - ax), (pc[0] - pa[0]) / (cz - az), (pb[1] - pa[1]) / (bx - ax), (pc[1] - pa[1]) / (cz - az))
        self.o = (pa[0] - self.m[0] * ax - self.m[1] * az, pa[1] - self.m[2] * ax - self.m[3] * az)
        dx, dz = e["maxX"], e["maxZ"]
        want = self._pix(place, dx, dz)
        got = self.to_pixel(dx, dz)
        self.fit_error_m = max(abs(want[0] - got[0]) * self.px, abs(want[1] - got[1]) * self.py)
        if self.fit_error_m > 0.5:
            raise SystemExit(f"terrain: the raster grid does not fit the box by {self.fit_error_m:.2f} m")

    def to_pixel(self, x: float, z: float) -> tuple[float, float]:
        return self.o[0] + self.m[0] * x + self.m[1] * z, self.o[1] + self.m[2] * x + self.m[3] * z

    def at(self, x: float, z: float) -> float | None:
        """The nearest 1 m sample at game (x, z), or None outside the raster or on no-data."""
        fx, fy = self.to_pixel(x, z)
        ix, iy = int(math.floor(fx)), int(math.floor(fy))
        if ix < 0 or iy < 0 or ix >= self.w or iy >= self.h:
            return None
        v = self.data[iy * self.w + ix]
        return v if self._ok(v) else None


class Terrain:
    def __init__(self, dtm: Raster | None, place):
        self.place = place
        e, cell = place.ext, place.cell
        self.cell, self.minX, self.minZ = cell, e["minX"], e["minZ"]
        self.nx = int(round((e["maxX"] - e["minX"]) / cell)) + 1
        self.nz = int(round((e["maxZ"] - e["minZ"]) / cell)) + 1
        self.flat = dtm is None or not dtm.valid_any
        grid = self._average(dtm)
        self.heights = array.array("H")
        self.lo, self.hi = 1e9, -1e9
        for v in grid:
            v = max(0.0, v)
            self.lo, self.hi = min(self.lo, v), max(self.hi, v)
            self.heights.append(min(65535, int(round(v * 10))))
        if sys.byteorder == "big":
            self.heights.byteswap()

    def _average(self, dtm: Raster | None) -> list[float]:
        n = self.nx * self.nz
        if self.flat:
            print("warning: no terrain data in the answer, the ground is flat at 0", file=sys.stderr)
            return [0.0] * n
        k = max(1, int(math.ceil(self.cell)))
        offs = [((i + 0.5) / k - 0.5) * self.cell for i in range(k)]
        out: list[float | None] = []
        for j in range(self.nz):
            for i in range(self.nx):
                cx, cz = self.minX + i * self.cell, self.minZ + j * self.cell
                s, c = 0.0, 0
                for oz in offs:
                    for ox in offs:
                        v = dtm.at(cx + ox, cz + oz)
                        if v is not None:
                            s += v
                            c += 1
                out.append(s / c if c else None)
        for _ in range(8):  # holes take the mean of their valid neighbours
            fix = {}
            for idx, v in enumerate(out):
                if v is None:
                    j, i = divmod(idx, self.nx)
                    nb = [out[jj * self.nx + ii] for jj, ii in ((j - 1, i), (j + 1, i), (j, i - 1), (j, i + 1))
                          if 0 <= jj < self.nz and 0 <= ii < self.nx and out[jj * self.nx + ii] is not None]
                    if nb:
                        fix[idx] = sum(nb) / len(nb)
            for idx, v in fix.items():
                out[idx] = v
            if not fix:
                break
        return [v if v is not None else 0.0 for v in out]

    def ground(self, x: float, z: float) -> float:
        i = max(0, min(self.nx - 1, int(round((x - self.minX) / self.cell))))
        j = max(0, min(self.nz - 1, int(round((z - self.minZ) / self.cell))))
        v = self.heights[j * self.nx + i]
        return (((v & 255) << 8 | v >> 8) if sys.byteorder == "big" else v) / 10

    def scene_block(self) -> dict:
        return {"cell": self.cell, "nx": self.nx, "nz": self.nz, "minX": self.minX, "minZ": self.minZ, "unit": 0.1,
                "min": round(self.lo, 1), "max": round(self.hi, 1), "encoding": "base64 uint16 little-endian, rows north to south",
                "data": base64.b64encode(self.heights.tobytes()).decode("ascii")}


def load(dtm_raw: bytes, dsm_raw: bytes | None, place) -> tuple[Terrain, Raster | None]:
    """The terrain, and the surface model (None when the mosaic has no surface data here)."""
    dtm = Raster(dtm_raw, place)
    dsm = Raster(dsm_raw, place) if dsm_raw else None
    if dsm is not None and not dsm.valid_any:
        dsm = None
    return Terrain(dtm, place), dsm
