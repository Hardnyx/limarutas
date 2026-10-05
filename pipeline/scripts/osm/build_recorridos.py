"""
Recorridos de las rutas de Wikiroutes por la red de calles de OSM
(recorrido.py): cada trazado dibujado (route_track_trip<N>.geojson) se pega
nodo a nodo a sus calles y se guarda al lado como
route_track_trip<N>.osm.geojson, con los pasos ("por Av. X 420 m, a la
derecha en Av. Y…") en sus propiedades. El dibujo original no se toca: es de
donde se vuelve a calcular.

Se usa el recorrido solo si se parece al dibujo (largo entre MIN_RATIO y
MAX_RATIO del original y a lo más MAX_GAP del largo sin calle); si no, la
ruta sigue con su dibujo y queda en el reporte para revisarla a mano.
pipeline/output/wr_map.json marca con "osm": true las que lo usan (el mapa
carga ese archivo en vez del dibujo).

    python pipeline/scripts/osm/build_recorridos.py            # todas
    python pipeline/scripts/osm/build_recorridos.py 1087-ida   # algunas
    python pipeline/scripts/osm/build_recorridos.py --marcar   # tras regenerar wr_map.json
"""

from __future__ import annotations

import json
import math
import multiprocessing as mp
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from recorrido import Recorridos  # noqa: E402

WR_MAP = ROOT / 'pipeline' / 'output' / 'wr_map.json'
REPORT = ROOT / 'pipeline' / 'output' / 'recorridos_reporte.json'
LIMA = (-12.42, -77.26, -11.70, -76.56)

MIN_RATIO, MAX_RATIO = 0.85, 1.15
MAX_GAP = 0.30

M_LAT = 110_574
M_LON = 111_320 * math.cos(math.radians(-12.05))

R = None          # la red, compartida por los procesos (fork)


def length(c):
    return sum(math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * M_LON) for a, b in zip(c, c[1:]))


def track_of(path):
    """Puntos [lat, lon] del dibujo (LineString o MultiLineString encadenado)."""
    fc = json.loads(path.read_text(encoding='utf-8'))
    line = []
    for ft in fc.get('features', []):
        g = ft.get('geometry') or {}
        parts = [g['coordinates']] if g.get('type') == 'LineString' else g.get('coordinates', [])
        for part in parts:
            line += [(y, x) for x, y, *_ in part]
    return line


def work(item):
    key, folder, trip = item
    src = ROOT / folder / f'route_track_trip{trip}.geojson'
    dst = ROOT / folder / f'route_track_trip{trip}.osm.geojson'
    if not src.exists():
        return key, {'error': 'sin dibujo'}
    line = track_of(src)
    if len(line) < 2:
        return key, {'error': 'dibujo vacío'}
    rec = R.match(line)
    geom = R.geometry(rec)
    lo, ln = length(line), length(geom)
    gap = sum(length(s) for s in rec['sueltos'])
    stats = {'m': round(lo), 'm_osm': round(ln), 'ratio': round(ln / lo, 3) if lo else 0,
             'sin_calle': len(rec['sueltos']), 'm_sin_calle': round(gap)}
    ok = lo > 0 and MIN_RATIO <= ln / lo <= MAX_RATIO and gap <= MAX_GAP * lo
    stats['usa'] = ok
    if ok:
        fc = {'type': 'FeatureCollection', 'features': [{
            'type': 'Feature',
            'properties': {'fuente': 'OpenStreetMap (recorrido.py)', 'pasos': R.steps(rec),
                           'sin_calle': len(rec['sueltos'])},
            'geometry': {'type': 'LineString', 'coordinates': [[lon, lat] for lat, lon in geom]}}]}
        dst.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    elif dst.exists():
        dst.unlink()
    return key, stats


def mark_only():
    """Vuelve a marcar en wr_map.json las rutas con recorrido (tras regenerar
    wr_map con los scripts de Wikiroutes), sin recalcular nada."""
    wr = json.loads(WR_MAP.read_text(encoding='utf-8'))
    report = json.loads(REPORT.read_text(encoding='utf-8'))
    n = 0
    for key, conf in wr['routes'].items():
        f = ROOT / conf['folder'] / f"route_track_trip{conf.get('trip', 1)}.osm.geojson"
        if report.get(key, {}).get('usa') and f.exists():
            conf['osm'] = True
            n += 1
        else:
            conf.pop('osm', None)
    WR_MAP.write_text(json.dumps(wr, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{n} rutas marcadas con recorrido en {WR_MAP.relative_to(ROOT)}')


def main(argv):
    global R
    if argv[:1] == ['--marcar']:
        return mark_only()
    wr = json.loads(WR_MAP.read_text(encoding='utf-8'))
    routes = wr['routes']
    keys = argv or sorted(routes)
    items = [(k, routes[k]['folder'], routes[k].get('trip', 1)) for k in keys if k in routes]
    t = time.time()
    R = Recorridos(LIMA)
    print(f'Red de Lima: {len(R.edges)} tramos · {time.time() - t:.0f} s', flush=True)
    t = time.time()
    report = json.loads(REPORT.read_text(encoding='utf-8')) if REPORT.exists() and argv else {}
    with mp.get_context('fork').Pool(4) as pool:
        for n, (key, stats) in enumerate(pool.imap_unordered(work, items, chunksize=8), 1):
            report[key] = stats
            if stats.get('usa'):
                routes[key]['osm'] = True
            else:
                routes[key].pop('osm', None)
            if n % 200 == 0:
                print(f'  {n}/{len(items)} · {time.time() - t:.0f} s', flush=True)
    WR_MAP.write_text(json.dumps(wr, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    REPORT.write_text(json.dumps(dict(sorted(report.items())), ensure_ascii=False, indent=0), encoding='utf-8')
    used = sum(1 for s in report.values() if s.get('usa'))
    print(f'{used} de {len(report)} trazados por la red de OSM · {time.time() - t:.0f} s · '
          f'{REPORT.relative_to(ROOT)}')


if __name__ == '__main__':
    main(sys.argv[1:])
