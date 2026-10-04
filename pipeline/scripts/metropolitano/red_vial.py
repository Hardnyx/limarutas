"""
Red vial aproximada para trazar alimentadores que OSM no tiene.

No hay un grafo de calles en el repo, pero sí miles de recorridos que las
siguen: los ways de las rutas de bus de OSM (data/raw/osm/transporte.zip),
los tracks de Wikiroutes (data/processed/transporte/route_*/) y las
relaciones de los alimentadores (alimentadores.json). Se densifican cada
DENS_M metros y se encajan en celdas de CELL_M: dos recorridos que pasan por
la misma esquina comparten celda, y eso une la red.

Sentido: el de cada track de Wikiroutes y los ways oneway de OSM; los demás
ways de OSM en los dos sentidos. Ir contra el sentido de un track cuesta
REVERSE_COST veces más (puede ser una calle de doble sentido que nadie
recorre al revés), así un camino solo va contra la corriente si no hay otro.

ruta(waypoints) devuelve el camino más corto que pasa por los waypoints en
orden ([[lat, lon], ...]).
"""

from __future__ import annotations

import glob
import heapq
import json
import math
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OSM_ZIP = ROOT / 'data' / 'raw' / 'osm' / 'transporte.zip'
WR_DIR = ROOT / 'data' / 'processed' / 'transporte'
ALIM = ROOT / 'data' / 'processed' / 'metropolitano' / 'alimentadores.json'

CELL_M = 12
DENS_M = 6
REVERSE_COST = 3.0
SNAP_M = 120          # waypoint: la celda de la red más cercana, hasta esto

M_LAT = 110_574
M_LON = 111_320 * math.cos(math.radians(-12.0))


def _cell(lat, lon):
    return (round(lat * M_LAT / CELL_M), round(lon * M_LON / CELL_M))


def _center(c):
    return (c[0] * CELL_M / M_LAT, c[1] * CELL_M / M_LON)


def _d(a, b):
    return math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * M_LON)


class Red:
    def __init__(self, bbox):
        """bbox = (lat_min, lon_min, lat_max, lon_max)"""
        self.bbox = bbox
        self.adj: dict = {}
        self._load()

    def _inside(self, p):
        s, w, n, e = self.bbox
        return s <= p[0] <= n and w <= p[1] <= e

    def _edge(self, a, b, cost):
        if a == b:
            return
        row = self.adj.setdefault(a, {})
        if cost < row.get(b, math.inf):
            row[b] = cost
        self.adj.setdefault(b, {})

    def add(self, line, both=False):
        """line: [(lat, lon), ...] en el sentido en que se recorre."""
        cells = []
        for p, q in zip(line, line[1:]):
            if not (self._inside(p) or self._inside(q)):
                cells.append(None)
                continue
            n = max(1, int(_d(p, q) / DENS_M))
            for i in range(n):
                t = i / n
                cells.append(_cell(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
        if line and self._inside(line[-1]):
            cells.append(_cell(*line[-1]))
        for a, b in zip(cells, cells[1:]):
            if a is None or b is None or a == b:
                continue
            w = _d(_center(a), _center(b))
            self._edge(a, b, w)
            self._edge(b, a, w * (1 if both else REVERSE_COST))

    def _load(self):
        with zipfile.ZipFile(OSM_ZIP) as z:
            osm = json.loads(z.read('transporte.json'))
        for e in osm['elements']:
            if e['type'] == 'way' and 'geometry' in e:
                tags = e.get('tags', {})
                line = [(g['lat'], g['lon']) for g in e['geometry']]
                if tags.get('oneway') == '-1':
                    line.reverse()
                self.add(line, both=tags.get('oneway') not in ('yes', '-1', 'true')
                         and tags.get('junction') != 'roundabout')
        for f in sorted(glob.glob(str(WR_DIR / 'route_*' / 'route_track_trip*.geojson'))):
            for feat in json.loads(Path(f).read_text(encoding='utf-8'))['features']:
                g = feat['geometry']
                parts = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
                for part in parts:
                    self.add([(c[1], c[0]) for c in part])
        for feat in json.loads(ALIM.read_text(encoding='utf-8'))['features']:
            g = feat['geometry']
            if g['type'] == 'MultiLineString':
                for part in g['coordinates']:
                    self.add([(c[1], c[0]) for c in part])

    def snap(self, p):
        c0 = _cell(*p)
        r = int(SNAP_M / CELL_M)
        best, bd = None, math.inf
        for i in range(-r, r + 1):
            for j in range(-r, r + 1):
                c = (c0[0] + i, c0[1] + j)
                if c in self.adj and self.adj[c]:
                    d = _d(_center(c), p)
                    if d < bd:
                        best, bd = c, d
        if best is None:
            raise ValueError(f'sin calle a menos de {SNAP_M} m de {p}')
        return best

    def tramo(self, a, b):
        """A* de la celda a a la b."""
        goal = _center(b)
        dist = {a: 0.0}
        prev = {}
        heap = [(_d(_center(a), goal), 0.0, a)]
        while heap:
            _, g, u = heapq.heappop(heap)
            if u == b:
                break
            if g > dist[u]:
                continue
            for v, w in self.adj[u].items():
                ng = g + w
                if ng < dist.get(v, math.inf):
                    dist[v] = ng
                    prev[v] = u
                    heapq.heappush(heap, (ng + _d(_center(v), goal), ng, v))
        if b not in dist:
            raise ValueError(f'sin camino entre {_center(a)} y {goal}')
        path = [b]
        while path[-1] != a:
            path.append(prev[path[-1]])
        return [_center(c) for c in reversed(path)]

    def ruta(self, waypoints):
        cells = [self.snap(p) for p in waypoints]
        out = []
        for a, b in zip(cells, cells[1:]):
            seg = self.tramo(a, b)
            out.extend(seg if not out else seg[1:])
        return [[round(lat, 6), round(lon, 6)] for lat, lon in simplify(out)]


def simplify(pts, tol_m=6.0):
    """Douglas-Peucker: las celdas en línea recta sobran."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        a, b = pts[i], pts[j]
        ab = _d(a, b)
        best, bk = 0.0, None
        for k in range(i + 1, j):
            p = pts[k]
            if ab == 0:
                dd = _d(a, p)
            else:
                # distancia de p a la recta ab en metros
                ax, ay = (a[1]) * M_LON, a[0] * M_LAT
                bx, by = b[1] * M_LON, b[0] * M_LAT
                px, py = p[1] * M_LON, p[0] * M_LAT
                dd = abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / ab
            if dd > best:
                best, bk = dd, k
        if bk is not None and best > tol_m:
            keep[bk] = True
            stack += [(i, bk), (bk, j)]
    return [p for p, k in zip(pts, keep) if k]
