import sys, os, json, subprocess, zipfile, concurrent.futures as cf
sys.path.insert(0, '/tmp/pbr/tools'); import lists
ROOT = '/tmp/pbr/dl'
def curl(url, out, tries=3):
    for _ in range(tries):
        r = subprocess.run(['curl', '-sSL', '-m', '240', '-o', out, '-w', '%{http_code}', url], capture_output=True, text=True)
        if r.stdout.strip() == '200' and os.path.getsize(out) > 500: return True
    return False
MAPS_ACG = {'Color': 'color', 'NormalGL': 'normal', 'Roughness': 'rough', 'AmbientOcclusion': 'ao', 'Displacement': 'height', 'Metalness': 'metal'}
def do_acg(item):
    kind, i = item; hero = i in lists.ACG_HERO; res = '2K' if hero else '1K'
    d = f'{ROOT}/acg/{i}'
    if os.path.exists(d + '/done'): return i, 'cached'
    os.makedirs(d + '/raw', exist_ok=True)
    z = d + '/z.zip'
    if not curl(f'https://ambientcg.com/get?file={i}_{res}-JPG.zip', z): return i, 'FAIL zip'
    try:
        zf = zipfile.ZipFile(z)
        for info in zf.infolist():
            for suf, name in MAPS_ACG.items():
                if info.filename == f'{i}_{res}-JPG_{suf}.jpg' and info.file_size < 80_000_000:
                    open(f'{d}/raw/{name}.jpg', 'wb').write(zf.read(info))
    except Exception as e: return i, 'FAIL ' + str(e)
    os.remove(z); open(d + '/done', 'w').write(res)
    return i, 'ok ' + ','.join(sorted(os.listdir(d + '/raw')))
def do_ph(item):
    kind, i = item; hero = i in lists.PH_HERO; res = '2k' if hero else '1k'
    d = f'{ROOT}/ph/{i}'
    if os.path.exists(d + '/done'): return i, 'cached'
    os.makedirs(d + '/raw', exist_ok=True)
    if not curl(f'https://api.polyhaven.com/files/{i}', d + '/files.json'): return i, 'FAIL files'
    f = json.load(open(d + '/files.json')); got = []
    for key, name in (('Diffuse', 'color'), ('nor_gl', 'normal'), ('Rough', 'rough'), ('AO', 'ao'), ('Displacement', 'height')):
        try: u = f[key][res]['jpg']['url']
        except KeyError:
            try: u = f[key]['1k']['jpg']['url']
            except KeyError: continue
        if curl(u, f'{d}/raw/{name}.jpg'): got.append(name)
    open(d + '/done', 'w').write(res)
    return i, 'ok ' + ','.join(got)
if __name__ == '__main__':
    which = sys.argv[1]
    items = lists.acg() if which == 'acg' else lists.ph()
    fn = do_acg if which == 'acg' else do_ph
    with cf.ThreadPoolExecutor(5) as ex:
        for i, s in ex.map(fn, items): print(i, s, flush=True)
