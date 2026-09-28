"""
Compara el largo de cada trazado de Wikiroutes con los km de su ficha
técnica del PRR (prr_fichas.json) y escribe pipeline/output/prr_wr_km.csv.

La mayoría calza (mediana 1,00): un trazado mucho más corto o más largo
(fuera de ±30 %) probablemente es de otra ruta, de una variante o está
incompleto. Se compara el más parecido de los dos sentidos de la ficha,
porque "trip1" de Wikiroutes no siempre es la ida del PRR.

Uso:
    python pipeline/scripts/atu/check_wr_km.py
"""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FICHAS = ROOT / 'pipeline' / 'output' / 'prr_fichas.json'
WR_MAP = ROOT / 'pipeline' / 'output' / 'wr_map.json'
OUT = ROOT / 'pipeline' / 'output' / 'prr_wr_km.csv'

TOLERANCIA = 0.3

M_LAT = 110_574
M_LON = 111_320 * math.cos(math.radians(-12.05))


def track_km(folder: Path, trip: int):
    path = folder / f'route_track_trip{trip}.geojson'
    if not path.exists():
        return None
    km = 0.0
    for f in json.loads(path.read_text(encoding='utf-8')).get('features', []):
        g = f.get('geometry') or {}
        lines = [g['coordinates']] if g.get('type') == 'LineString' else \
            g.get('coordinates', []) if g.get('type') == 'MultiLineString' else []
        for line in lines:
            km += sum(math.hypot((b[0] - a[0]) * M_LON, (b[1] - a[1]) * M_LAT)
                      for a, b in zip(line, line[1:])) / 1000
    return km


def main() -> None:
    fichas = json.loads(FICHAS.read_text(encoding='utf-8'))['rutas']
    layers = json.loads(WR_MAP.read_text(encoding='utf-8'))['routes']
    rows = []
    for key, conf in layers.items():
        code = key.rsplit('-', 1)[0].split('_')[0]
        f = fichas.get(code)
        if not f or not (f.get('km_ida') or f.get('km_vuelta')):
            continue
        km = track_km(ROOT / conf['folder'], conf.get('trip', 1))
        if not km:
            continue
        ref = min((x for x in (f.get('km_ida'), f.get('km_vuelta')) if x), key=lambda x: abs(km / x - 1))
        ratio = km / ref
        rows.append({'capa': key, 'codigo': code, 'km_wikiroutes': round(km, 2), 'km_ficha': ref,
                     'razon': round(ratio, 2), 'revisar': 'si' if abs(ratio - 1) > TOLERANCIA else ''})
    rows.sort(key=lambda r: (r['revisar'] != 'si', abs(r['razon'] - 1) * -1))
    with open(OUT, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    bad = [r for r in rows if r['revisar']]
    print(f'{len(rows)} capas comparadas · {len(bad)} fuera de ±{TOLERANCIA:.0%}: '
          + ', '.join(f"{r['capa']} ({r['razon']})" for r in bad))
    print(f'Escrito: {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
