"""
Red vial de Lima para trazar alimentadores: el grafo de calles de
OpenStreetMap (data/raw/osm/Lima.osm.pbf, pipeline/scripts/osm/descargar_lima.py).

Nodos y tramos reales de OSM: el camino va por las calles, nodo a nodo, sin
saltar entre calzadas. Solo vías por donde va un bus (de autopista a calle
residencial y de servicio; no veredas, escaleras ni la vía exclusiva del
Metropolitano), respetando el sentido de circulación (oneway, rotondas).
Las calles de servicio y residenciales cuestan algo más, para que el camino
prefiera las avenidas si da casi lo mismo.

ruta(waypoints) devuelve el camino más corto que pasa por los waypoints en
orden ([[lat, lon], ...]).
"""

from __future__ import annotations

import heapq
import math
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PBF = ROOT / 'data' / 'raw' / 'osm' / 'Lima.osm.pbf'

# Vías por donde va un bus y cuánto "cuesta" cada metro (las avenidas, menos)
COST = {
    'motorway': 1.0, 'trunk': 1.0, 'primary': 1.0, 'secondary': 1.0, 'tertiary': 1.05,
    'motorway_link': 1.0, 'trunk_link': 1.0, 'primary_link': 1.0, 'secondary_link': 1.0,
    'tertiary_link': 1.05, 'unclassified': 1.15, 'residential': 1.2, 'living_street': 1.4,
    'service': 1.6,
}
SNAP_M = 120          # waypoint: el nodo de la red más cercano, hasta esto
CAND_M = 40           # candidatos: hasta esto más lejos que el más cercano
SNAP_K = 3            # cada metro entre el waypoint y su nodo cuesta como 3 de calle
CELL_M = 100

M_LAT = 110_574
M_LON = 111_320 * math.cos(math.radians(-12.0))


def _d(a, b):
    return math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * M_LON)


class Red:
    def __init__(self, bbox):
        """bbox = (lat_min, lon_min, lat_max, lon_max)"""
        import osmium
        if not PBF.exists():
            raise SystemExit(f'Falta {PBF.relative_to(ROOT)}: python pipeline/scripts/osm/descargar_lima.py')
        s, w, n, e = bbox
        self.pos: dict[int, tuple[float, float]] = {}
        self.adj: dict[int, list] = defaultdict(list)
        self.way: dict[tuple[int, int], tuple] = {}     # (u, v) → (id de la vía, nombre, es rotonda)
        red = self

        class H(osmium.SimpleHandler):
            def way(self, way):
                t = way.tags
                hw = t.get('highway')
                if hw not in COST or t.get('access') in ('no', 'private') or t.get('area') == 'yes':
                    return
                if t.get('psv') == 'only' or t.get('bus') == 'designated' and hw == 'service':
                    return
                try:
                    pts = [(nd.ref, nd.lat, nd.lon) for nd in way.nodes]
                except osmium.InvalidLocationError:
                    return
                if not any(s <= la <= n and w <= lo <= e for _, la, lo in pts):
                    return
                ow = t.get('oneway')
                if t.get('junction') in ('roundabout', 'circular') and ow is None:
                    ow = 'yes'
                if ow == '-1':
                    pts.reverse()
                oneway = ow in ('yes', 'true', '1', '-1')
                k = COST[hw]
                # De qué vía es cada tramo (para las indicaciones: "por Av. X")
                info = (way.id, t.get('name') or '', t.get('junction') in ('roundabout', 'circular'))
                for (a, la, lo), (b, lb, lob) in zip(pts, pts[1:]):
                    red.pos[a] = (la, lo)
                    red.pos[b] = (lb, lob)
                    m = _d((la, lo), (lb, lob)) * k
                    red.adj[a].append((b, m))
                    red.way[a, b] = info
                    if not oneway:
                        red.adj[b].append((a, m))
                        red.way[b, a] = info

        H().apply_file(str(PBF), locations=True)
        self.grid = defaultdict(list)
        for nid, p in self.pos.items():
            if nid in self.adj:          # solo nodos desde los que se puede salir
                self.grid[self._cell(*p)].append(nid)

    @staticmethod
    def _cell(lat, lon):
        return (int(lat * M_LAT // CELL_M), int(lon * M_LON // CELL_M))

    def candidates(self, p):
        """Nodos donde puede caer el waypoint: el más cercano y los que estén
        hasta CAND_M más lejos (la otra calzada de una avenida, la calle del
        lado), con lo que se alejan del waypoint."""
        ci, cj = self._cell(*p)
        r = int(SNAP_M // CELL_M) + 1
        near = []
        for di in range(-r, r + 1):
            for dj in range(-r, r + 1):
                for nid in self.grid.get((ci + di, cj + dj), ()):
                    d = _d(self.pos[nid], p)
                    if d <= SNAP_M:
                        near.append((d, nid))
        if not near:
            raise ValueError(f'sin calle a menos de {SNAP_M} m de {p}')
        d0 = min(near)[0]
        return {nid: d for d, nid in near if d <= d0 + CAND_M}

    def _layer(self, start, targets):
        """Dijkstra desde varios nodos con su costo acumulado hasta que se
        asientan todos los targets. Devuelve {target: costo} y prev."""
        dist = dict(start)
        prev = {}
        heap = [(g, u) for u, g in start.items()]
        heapq.heapify(heap)
        left = set(targets)
        done = {}
        while heap and left:
            g, u = heapq.heappop(heap)
            if g > dist[u]:
                continue
            if u in left:
                left.discard(u)
                done[u] = g
            for v, w in self.adj.get(u, ()):
                ng = g + w
                if ng < dist.get(v, math.inf):
                    dist[v] = ng
                    prev[v] = u
                    heapq.heappush(heap, (ng, v))
        return done, prev

    def ruta(self, waypoints):
        """Camino más barato que pasa por los waypoints en orden. Cada
        waypoint elige su nodo entre los candidatos según el camino entero,
        no solo por cercanía: así no cae en la calzada contraria y obliga a
        dar la vuelta a la manzana por los sentidos únicos."""
        layers = [self.candidates(p) for p in waypoints]
        cost = {nid: d * SNAP_K for nid, d in layers[0].items()}
        back = []                      # por capa: (prev de Dijkstra, costo de llegada)
        for cand in layers[1:]:
            done, prev = self._layer(cost, cand)
            if not done:
                raise ValueError('sin camino entre waypoints')
            cost = {nid: g + cand[nid] * SNAP_K for nid, g in done.items()}
            back.append(prev)
        end = min(cost, key=cost.get)
        nodes = [end]
        for prev in reversed(back):    # de cada capa hacia la anterior
            u = nodes[-1]
            while u in prev:
                u = prev[u]
                nodes.append(u)
        nodes.reverse()
        out = [self.pos[n] for i, n in enumerate(nodes) if i == 0 or n != nodes[i - 1]]
        return [[round(lat, 6), round(lon, 6)] for lat, lon in simplify(out)]


def simplify(pts, tol_m=1.5):
    """Douglas-Peucker: los nodos en línea recta sobran (la forma de la calle queda)."""
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
                ax, ay = a[1] * M_LON, a[0] * M_LAT
                bx, by = b[1] * M_LON, b[0] * M_LAT
                px, py = p[1] * M_LON, p[0] * M_LAT
                dd = abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / ab
            if dd > best:
                best, bk = dd, k
        if bk is not None and best > tol_m:
            keep[bk] = True
            stack += [(i, bk), (bk, j)]
    return [p for p, k in zip(pts, keep) if k]
