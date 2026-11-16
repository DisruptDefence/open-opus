import sys, os, json, glob, shutil
sys.path.insert(0, '/tmp/pbr/tools'); import lists
REPO = sys.argv[1]; STAGE = '/tmp/pbr/stage'
acg = {}
for f in glob.glob('/tmp/pbr/work/api/acg_[0-9]*.json'):
    for a in json.load(open(f))['foundAssets']: acg[a['assetId']] = a
ph = json.load(open('/tmp/pbr/work/api/ph_tex.json'))
DEF = dict(stone_ashlar=2.0, stone_rubble=2.0, stone_flag=2.0, brick=1.2, asphalt=2.0, cobble=1.0, paving=1.5, concrete=2.0, plaster=2.0, roof_slate=1.5, roof_tile=1.5, roof_metal=1.5,
           metal=1.0, wood=1.2, door=1.5, gravel=1.0, ground=1.5, grass=1.5, moss=1.0, snow=2.0, rock_cliff=3.0)
sets = {}; credits = []
out_root = f'{REPO}/assets/textures/pbr'; os.makedirs(out_root, exist_ok=True)
def add(kind, src, id_):
    name = id_.lower() if src == 'acg' else id_
    d = f'{STAGE}/{name}'
    if not os.path.exists(d + '/meta.json'): return
    meta = json.load(open(d + '/meta.json'))
    if src == 'acg':
        a = acg[id_]; dim = (a['dimensionX'] or 0) / 100.0; dimy = (a['dimensionY'] or 0) / 100.0
        tags = [t for t in a['tags'] if not t.isdigit() and t.lower() != id_.lower()][:8]
        url = f'https://ambientcg.com/view?id={id_}'; author = 'ambientCG contributors (ambientcg.com)'; page = a['shortLink']
    else:
        p = ph[id_]; dim = p['dimensions'][0] / 1000.0; dimy = p['dimensions'][1] / 1000.0
        tags = (p.get('tags') or [])[:8]; url = f'https://polyhaven.com/a/{id_}'; author = ', '.join(p['authors'].keys()) + ' (Poly Haven)'
    tile = [dim, dimy] if 0.1 <= dim <= 12 and 0.1 <= dimy <= 12 else [DEF[kind]] * 2
    res = max(m['w'] for m in meta['maps'].values())
    sets[name] = dict(kind=kind, tile=[round(tile[0], 3), round(tile[1], 3)], tags=tags, res=res, maps=[m for m in ('color', 'normal', 'rough', 'ao', 'height', 'metal') if m in meta['maps']],
                      ext='webp', avg=[round(v, 4) for v in meta['avg']], bytes=meta['bytes'], source=src and ('ambientcg' if src == 'acg' else 'polyhaven'), url=url)
    dst = f'{out_root}/{name}'; os.makedirs(dst, exist_ok=True)
    for m in sets[name]['maps']: shutil.copyfile(f'{d}/{m}.webp', f'{dst}/{m}.webp')
    credits.append(dict(file=f'pbr/{name}/', slot=name, author=author, licence='CC0 1.0', licenceUrl='https://creativecommons.org/publicdomain/zero/1.0/', source=url,
        modifications='all maps re-encoded to WebP (colour q86, normal q92, grey maps q80/72); %d px; normal map is OpenGL (Y up)' % res,
        licenceBasis='provider-wide CC0 policy (https://ambientcg.com/license)' if src == 'acg' else 'provider-wide CC0 policy (https://polyhaven.com/license)', **{'class': 'A'}))
for k, i in lists.acg(): add(k, 'acg', i)
for k, i in lists.ph(): add(k, 'ph', i)
total = sum(s['bytes'] for s in sets.values())
json.dump(dict(format='opus-textures/1', note='Image-based PBR sets, all CC0. tile = real-world size of one repeat in metres [u, v]; avg = mean linear colour of the colour map; maps are WebP files pbr/<name>/<map>.webp; normals are OpenGL (Y up).',
               base='pbr/', totalBytes=total, count=len(sets), sets=sets), open(f'{REPO}/assets/textures/catalogue.json', 'w'), indent=0, sort_keys=False)
c = json.load(open(f'{REPO}/assets/textures/CREDITS.json'))
c['files'] = [f for f in c['files'] if not f['file'].startswith('pbr/')] + credits
json.dump(c, open(f'{REPO}/assets/textures/CREDITS.json', 'w'), indent=1)
print(len(sets), total / 1e6)
