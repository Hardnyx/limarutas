"""
Demora por congestión de cada tramo de bus (config/congestion.json).

Las avenidas congestionadas son los ways de OSM con su nombre dentro del
rectángulo del tramo crítico. Cada tramo entre dos paraderos consecutivos se
recorre en recta cada SAMPLE_M; lo que pasa a menos de NEAR_M de una de esas
avenidas suma (factor - 1). El resultado es el porcentaje extra del tramo en
hora punta: 40 = dura 1,4 veces lo normal.
"""

from __future__ import annotations

import json
import math
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CONFIG = ROOT / 'config' / 'congestion.json'
OSM_ZIP = ROOT / 'data' / 'raw' / 'osm' / 'transporte.zip'

CELL_M = 25
SAMPLE_M = 20
NEAR_M = 30

M_LAT = 110_574
M_LON = 111_320 * math.cos(math.radians(-12.05))


def _cell(lat, lon):
    return (int(lat * M_LAT // CELL_M), int(lon * M_LON // CELL_M))


class Congestion:
    def __init__(self):
        cfg = json.loads(CONFIG.read_text(encoding='utf-8'))['avenidas']
        with zipfile.ZipFile(OSM_ZIP) as z:
            osm = json.loads(z.read('transporte.json'))
        self.points: dict[tuple[int, int], list] = {}
        for av in cfg:
            names = set(av['nombres'])
            s, w, n, e = av['bbox']
            extra = av['factor'] - 1
            for el in osm['elements']:
                if el['type'] != 'way' or 'geometry' not in el or el.get('tags', {}).get('name') not in names:
                    continue
                pts = [(g['lat'], g['lon']) for g in el['geometry']]
                for a, b in zip(pts, pts[1:]):
                    d = math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * M_LON)
                    k = max(1, int(d / 8))
                    for i in range(k + 1):
                        p = (a[0] + (b[0] - a[0]) * i / k, a[1] + (b[1] - a[1]) * i / k)
                        if s <= p[0] <= n and w <= p[1] <= e:
                            c = _cell(*p)
                            self.points.setdefault(c, []).append((p, extra))

    def _extra_at(self, lat, lon):
        ci, cj = _cell(lat, lon)
        best = 0.0
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for (p, extra) in self.points.get((ci + di, cj + dj), ()):
                    if extra > best and math.hypot((p[0] - lat) * M_LAT, (p[1] - lon) * M_LON) <= NEAR_M:
                        best = extra
        return best

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
        ninguno pasa por una avenida congestionada."""
        out = [self.segment(a, b) for a, b in zip(coords, coords[1:])]
        return out if any(out) else None
