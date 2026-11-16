"""Downloads and the cache. One Overpass query for everything tagged in the box, the HRDEM mosaic twice (bare
earth `dtm`, surface `dsm`), each enricher once. Everything lands in the cache directory with a `meta.json`
(url, date, bytes, SHA-256). `--offline` reads only the cache and names the file that is missing."""
from __future__ import annotations

import datetime
import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

OVERPASS = "https://overpass-api.de/api/interpreter"
HRDEM_WCS = "https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic"
USER_AGENT = "scene-builder/1.0"

# canonical cache name -> other names an earlier fetch may have used (read, never written)
ALIASES = {
    "osm.json": ["osm-all.json"],
    "hrdem-dtm.tif": ["hrdem-dtm-1m.tif"],
    "hrdem-dsm.tif": ["hrdem-dsm-1m.tif"],
}


def fetch(url: str, data: bytes | None = None, tries: int = 4) -> bytes:
    last: Exception | None = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except Exception as exc:  # noqa: BLE001 - any network failure is retried, then reported
            last = exc
            time.sleep(5 * (i + 1))
    raise SystemExit(f"download failed: {url[:90]}… ({last})")


def overpass_query(s: float, w: float, n: float, e: float) -> str:
    b = f"({s:.6f},{w:.6f},{n:.6f},{e:.6f})"
    return f"[out:json][timeout:120];(nwr[~\".\"~\".\"]{b};);out body geom;"


def hrdem_url(identifier: str, bb: tuple[float, float, float, float]) -> str:
    return HRDEM_WCS + "?" + urllib.parse.urlencode({
        "service": "WCS", "version": "1.1.1", "request": "GetCoverage", "identifier": identifier, "format": "image/geotiff",
        "BoundingBox": ",".join(f"{v:.1f}" for v in bb) + ",urn:ogc:def:crs:EPSG::3979",
        "GridBaseCRS": "urn:ogc:def:crs:EPSG::3979", "GridOffsets": "1.0,-1.0"})


def pick_resource(package: dict, fmt: str) -> str:
    """The download URL of the first resource of a CKAN `package_show` answer whose format is `fmt`."""
    for r in (package.get("result") or {}).get("resources", []):
        if str(r.get("format", "")).upper() == fmt.upper() and r.get("url"):
            return r["url"]
    raise SystemExit(f"enricher: no {fmt} resource in the package")


class Cache:
    def __init__(self, directory: Path | None, offline: bool):
        self.dir, self.offline = directory, offline
        self.meta: dict = {"files": {}}
        if directory and (directory / "meta.json").exists():
            self.meta = json.loads((directory / "meta.json").read_text())
            self.meta.setdefault("files", {})

    def find(self, name: str) -> Path | None:
        if not self.dir:
            return None
        for n in [name] + ALIASES.get(name, []):
            if (self.dir / n).exists():
                return self.dir / n
        return None

    def get(self, name: str, url: str | None = None, data: bytes | None = None, required: bool = True) -> bytes | None:
        """The file from the cache; else (online) from `url`, stored under `name`."""
        p = self.find(name)
        if p:
            return p.read_bytes()
        if self.offline or url is None:
            if not required:
                return None
            where = self.dir or "(no --cache given)"
            raise SystemExit(f"--offline: {name} is missing from the cache {where}")
        print(f"fetching {name}…", file=sys.stderr)
        raw = fetch(url, data)
        if self.dir:
            self.dir.mkdir(parents=True, exist_ok=True)
            (self.dir / name).write_bytes(raw)
            self.meta["files"][name] = {
                "url": url, "date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        return raw

    def save_meta(self, fetched: str) -> None:
        if self.dir and not self.offline and self.meta["files"]:
            self.meta["fetched"] = fetched
            (self.dir / "meta.json").write_text(json.dumps(self.meta, indent=1))

    def stamp(self, fallback: str) -> str:
        return self.meta.get("fetched") or fallback


def enricher_bytes(cache: Cache, n: int, spec: dict) -> bytes:
    name = f"enrich-{n}.{str(spec.get('format', 'dat')).lower()}"
    if cache.find(name):
        return cache.find(name).read_bytes()  # type: ignore[union-attr]
    if cache.offline:
        return cache.get(name)  # raises, naming the file
    url = spec.get("url")
    if not url:
        package = json.loads(fetch(spec["ckan"]))
        url = pick_resource(package, spec.get("format", "CSV"))
    return cache.get(name, url)  # type: ignore[return-value]
