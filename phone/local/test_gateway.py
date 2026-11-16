"""The gateway's own logic, without a device: python3 -m unittest phone/local/test_gateway.py"""
import io
import sys
import time
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gateway as g  # noqa: E402


class GatewayTest(unittest.TestCase):
    def test_nmea_says_where_the_player_is(self):
        out = g.nmea(46.8118, -71.2068, 358.4, 2.0, 25.0, time.gmtime(0)).decode().split("\r\n")
        self.assertTrue(out[0].startswith("$GPGGA,000000.00,4648.7080,N,07112.4080,W,1,10,0.8,25.0,M"))
        self.assertTrue(out[1].startswith("$GPRMC,000000.00,A,4648.7080,N,07112.4080,W,3.9,358.4,010170"))
        for line in out[:2]:  # the checksum is the XOR of what lies between $ and *
            body, cs = line[1:].split("*")
            x = 0
            for ch in body:
                x ^= ord(ch)
            self.assertEqual(f"{x:02X}", cs)

    def test_cot_events_are_cut_from_a_stream_and_read(self):
        a = b'<?xml version="1.0"?><event uid="m1" type="a-h-G" how="h-g-i-g-o"><point lat="46.81" lon="-71.20" hae="1" ce="1" le="1"/><detail><contact callsign="R.1"/></detail></event>'
        b = b'<event uid="x" type="t-x-c-t"><point lat="0" lon="0"/></event>'
        events, rest = g.split_events(a + b[:20])
        self.assertEqual(len(events), 1)
        self.assertEqual(g.parse_cot(events[0]), {"type": "cot", "uid": "m1", "cot": "a-h-G", "how": "h-g-i-g-o", "lat": 46.81, "lon": -71.2, "callsign": "R.1"})
        events, rest = g.split_events(rest + b[20:])
        self.assertEqual(g.parse_cot(events[0])["callsign"], None)
        self.assertEqual(rest, b"")
        self.assertIsNone(g.parse_cot(b"<event uid='y'></event>"))
        self.assertIsNone(g.parse_cot(b"<event"))

    def test_overlay_is_a_kmz_with_the_picture_and_its_box(self):
        data = g.kmz("Vieux-Québec & co", b"\xff\xd8rest", 46.82, 46.81, -71.19, -71.21, 1.6094)
        z = zipfile.ZipFile(io.BytesIO(data))
        self.assertEqual(sorted(z.namelist()), ["doc.kml", "ground.jpg"])
        kml = z.read("doc.kml").decode()
        self.assertIn("<north>46.82000000</north>", kml)
        self.assertIn("<rotation>1.60940</rotation>", kml)
        self.assertIn("&amp;", kml)
        with self.assertRaises(ValueError):
            g.kmz("x", b"\xff\xd8", 46.81, 46.82, -71.19, -71.21)  # north below south
        with self.assertRaises(ValueError):
            g.kmz("x", b"PNG", 46.82, 46.81, -71.19, -71.21)

    def test_overlay_names_cannot_leave_the_folder(self):
        self.assertEqual(g.overlay_name("old-quebec_0_-100"), "opus_old-quebec_0_-100.kmz")
        for bad in ("../x", "a/b", "", "a b", None, "x" * 81):
            self.assertIsNone(g.overlay_name(bad))

    def test_only_this_machines_pages_are_local(self):
        for ok in ("http://127.0.0.1:9771", "http://localhost", "https://localhost:8443", "http://[::1]:80"):
            self.assertTrue(g.LOCAL_ORIGIN.fullmatch(ok), ok)
        for bad in ("https://example.org", "http://127.0.0.1.example.org", "http://localhost.evil.test:80", "null"):
            self.assertFalse(g.LOCAL_ORIGIN.fullmatch(bad), bad)


if __name__ == "__main__":
    unittest.main()
