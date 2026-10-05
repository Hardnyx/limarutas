"""
Demora por congestión de cada tramo de bus.

Dos fuentes, y en cada punto vale la mayor:

  1. config/congestion.json, "avenidas": tramos con su factor medido o
     reportado (Abancay 1,4 = dura 1,4 veces lo normal en hora punta). Un
     factor menor que 1 es un carril exclusivo (Arequipa, Javier Prado):
     ahí el bus va más rápido y manda sobre todo lo demás. "nombres": ["*"]
     es una zona (Acho): cualquier calle dentro del rectángulo.
  2. Carga de la vía: cuántas líneas (rutas del PRR y corredores, por sus
     trazados de Wikiroutes) pasan por cada tramo de calle frente a cuántos
     carriles tiene en ese sentido (etiqueta "lanes" de OSM; sin ella, según
     el tipo de vía). Huanta o Huánuco: ~22 líneas en 2 carriles. Pasadas
     LOAD_FREE líneas por carril, cada una suma LOAD_STEP, hasta LOAD_MAX.

Cada tramo entre dos paraderos consecutivos se recorre en recta cada
SAMPLE_M; el resultado es el porcentaje extra del tramo en hora punta (40 =
dura 1,4 veces; -40 = carril exclusivo, dura 0,6 veces).
"""

from __future__ import annotations

import json
import math
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CONFIG = ROOT / 'config' / 'congestion.json'
CATALOG = ROOT / 'config' / 'catalog.json'
WR_MAP = ROOT / 'pipeline' / 'output' / 'wr_map.json'
OSM_ZIP = ROOT / 'data' / 'raw' / 'osm' / 'transporte.zip'

CELL_M = 20
SAMPLE_M = 20
NEAR_M = 30          # un punto está "en" la avenida curada hasta esto

LOAD_FREE = 8        # líneas por carril que la vía aguanta sin demora (la mediana de Lima es ~5, el cuartil alto ~9,5)
LOAD_STEP = 0.04     # cada línea por carril de más: +4 % (Huanta, 11 por carril: +12 %)
LOAD_MAX = 0.4       # tope de la demora por carga

# Carriles por sentido cuando OSM no trae "lanes"
DEFAULT_LANES = {'motorway': 3, 'trunk': 3, 'primary': 2, 'secondary': 2, 'tertiary': 1,
                 'unclassified': 1, 'residential': 1}

M_LAT = 110_574
M_LON = 111_320 * math.cos(math.radians(-12.05))


def _cell(lat, lon):
    return (int(lat * M_LAT // CELL_M), int(lon * M_LON // CELL_M))


def _dense(a, b, step=8):
    """Puntos cada ~step metros de a a b ([lat, lon])."""
    d = math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * M_LON)
    k = max(1, int(d / step))
    return [(a[0] + (b[0] - a[0]) * i / k, a[1] + (b[1] - a[1]) * i / k) for i in range(k + 1)]


class Congestion:
    def __init__(self):
        cfg = json.loads(CONFIG.read_text(encoding='utf-8'))['avenidas']
        with zipfile.ZipFile(OSM_ZIP) as z:
            osm = json.loads(z.read('transporte.json'))
        ways = [e for e in osm['elements'] if e['type'] == 'way' and 'geometry' in e]

        # 1. Avenidas curadas: puntos cada 8 m con su extra (negativo: carril exclusivo)
        self.points: dict[tuple[int, int], list] = defaultdict(list)
        for av in cfg:
            names = set(av['nombres'])
            s, w, n, e = av['bbox']
            extra = av['factor'] - 1
            for el in ways:
                if '*' not in names and el.get('tags', {}).get('name') not in names:
                    continue
                pts = [(g['lat'], g['lon']) for g in el['geometry']]
                for a, b in zip(pts, pts[1:]):
                    for p in _dense(a, b):
                        if s <= p[0] <= n and w <= p[1] <= e:
                            self.points[_cell(*p)].append((p, extra))

        # 2. Carga: líneas por celda (trazados de Wikiroutes de las rutas vigentes)
        cat = json.loads(CATALOG.read_text(encoding='utf-8'))
        active = set(cat['transporte']['only']) | {str(x) for x in cat['corredores']['only']}
        lines: dict[tuple[int, int], set] = defaultdict(set)
        for key, conf in json.loads(WR_MAP.read_text(encoding='utf-8'))['routes'].items():
            code = key.rsplit('-', 1)[0].split('_')[0]
            if code not in active:
                continue
            track = ROOT / conf['folder'] / f"route_track_trip{conf.get('trip', 1)}.geojson"
            if not track.exists():
                continue
            for ft in json.loads(track.read_text(encoding='utf-8'))['features']:
                g = ft['geometry']
                for part in ([g['coordinates']] if g['type'] == 'LineString' else g['coordinates']):
                    for (x1, y1), (x2, y2) in zip(part, part[1:]):
                        for p in _dense((y1, x1), (y2, x2)):
                            lines[_cell(*p)].add(code)
        # Carriles por sentido de cada celda (el menor de las vías que pasan: el cuello de botella)
        lanes: dict[tuple[int, int], int] = {}
        for el in ways:
            t = el.get('tags', {})
            hw = (t.get('highway') or '').replace('_link', '')
            if hw not in DEFAULT_LANES:
                continue
            oneway = t.get('oneway') in ('yes', '-1') or t.get('junction') == 'roundabout'
            try:
                total = int(t['lanes'])
            except (KeyError, ValueError):
                total = DEFAULT_LANES[hw] * (1 if oneway else 2)
            per = max(1, total if oneway else total // 2)
            pts = [(g['lat'], g['lon']) for g in el['geometry']]
            for a, b in zip(pts, pts[1:]):
                for p in _dense(a, b):
                    c = _cell(*p)
                    if per < lanes.get(c, 99):
                        lanes[c] = per
        self.street = set(lanes)
        self.load = {}
        for c, per in lanes.items():
            n = len(lines.get(c, ()))
            extra = min(LOAD_MAX, max(0.0, (n / per - LOAD_FREE) * LOAD_STEP))
            if extra:
                self.load[c] = extra

    def _extra_at(self, lat, lon):
        ci, cj = _cell(lat, lon)
        best, exclusive = 0.0, None
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for (p, extra) in self.points.get((ci + di, cj + dj), ()):
                    if math.hypot((p[0] - lat) * M_LAT, (p[1] - lon) * M_LON) > NEAR_M:
                        continue
                    if extra < 0:
                        exclusive = extra if exclusive is None else min(exclusive, extra)
                    elif extra > best:
                        best = extra
        if exclusive is not None:
            return exclusive
        # Carga: la de la calle en ese punto; si la recta entre paraderos
        # se salió de la calle, la de la calle vecina más cargada
        if (ci, cj) in self.street:
            load = self.load.get((ci, cj), 0.0)
        else:
            load = max((self.load.get((ci + di, cj + dj), 0.0) for di in (-1, 0, 1) for dj in (-1, 0, 1)),
                       default=0.0)
        return max(best, load)

    def segment(self, a, b):
        """Porcentaje extra del tramo a → b ([lat, lon]) en hora punta."""
        d = math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * M_LON)
        if d < 1:
            return 0
        k = max(1, int(d / SAMPLE_M))
        tot = 0.0
        for i in range(k):
            t = (i + 0.5) / k
            tot += self._extra_at(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        return round(100 * tot / k)

    def route(self, coords):
        """Porcentajes de cada tramo de una secuencia de paraderos; None si
        ninguno tiene demora ni carril exclusivo."""
        out = [self.segment(a, b) for a, b in zip(coords, coords[1:])]
        return out if any(out) else None
