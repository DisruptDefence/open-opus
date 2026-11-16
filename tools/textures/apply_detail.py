"""Copies the `client.detail` block of a style pack into a baked scene file (what the scene builder does on a rebuild).
usage: python3 -I tools/textures/apply_detail.py styles/quebec-historic.json scenes/old-quebec.json"""
import json, sys
pack = json.load(open(sys.argv[1], encoding='utf8')); p = sys.argv[2]
s = open(p, encoding='utf8').read(); d = json.loads(s)
d['style']['detail'] = pack['client']['detail']
open(p, 'w', encoding='utf8').write(json.dumps(d, separators=(',', ':'), ensure_ascii=False) + ('\n' if s.endswith('\n') else ''))
