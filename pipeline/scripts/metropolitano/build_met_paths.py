"""
Genera data/processed/metropolitano/metropolitano_paths.json: el trazado real
de cada servicio del Metropolitano y sentido, estación por estación, sobre la
vía exclusiva, y la distancia recorrida hasta cada estación.

Fuentes:
  metropolitano.json            export de OSM (Overpass) de la vía exclusiva:
                                ways highway=busway/service con sus nodos; las
                                calzadas de un solo sentido (oneway=yes) se
                                respetan
  metropolitano_services.json   estaciones de cada servicio y sentido
  metropolitano_stops.json      coordenadas de las estaciones
  trayectos-macro/A-*.geojson   respaldo para los tramos que el export no
                                cubre (la ampliación norte, Chimpu Ocllo –
                                Naranjal): el tramo de la macroruta entre las
                                dos estaciones

Cada estación se engancha a varios nodos cercanos de la vía (una calzada por
sentido: el más cercano puede ser el de la calzada contraria) y se toma el
camino más corto entre los de una estación y los de la siguiente.

Formato:
{
  "updated": "...",
  "paths": {
    "A:ns": {"coords": [[lat, lon], ...],   # trazado completo
             "at": [i, ...],                 # índice en coords de cada estación
             "m":  [0, 812, ...]},           # metros recorridos hasta cada estación
    ...
  }
}

Uso:
    python pipeline/scripts/metropolitano/build_met_paths.py
"""

from __future__ import annotations

import datetime as dt
import heapq
import json
import math
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MET = ROOT / 'data' / 'processed' / 'metropolitano'
OUT = MET / 'metropolitano_paths.json'

SNAP_M = 150          # hasta esto de la vía, la estación se engancha a ella
CANDIDATES = 10       # nodos candidatos por estación
MAX_DETOUR = 1.4      # un camino por la vía más largo que esto (+250 m) no calza

M_LAT = 110_574
M_LON = 111_320 * math.cos(math.radians(-12.05))


def dist(a, b):
    return math.hypot((a[1] - b[1]) * M_LON, (a[0] - b[0]) * M_LAT)


def load_busway():
    els = json.loads((MET / 'metropolitano.json').read_text(encoding='utf-8'))['elements']
    nodes = {e['id']: (e['lat'], e['lon']) for e in els if e['type'] == 'node'}
    graph = defaultdict(list)
    for w in (e for e in els if e['type'] == 'way'):
        oneway = (w.get('tags') or {}).get('oneway') == 'yes'
        for a, b in zip(w['nodes'], w['nodes'][1:]):
            if a in nodes and b in nodes:
                d = dist(nodes[a], nodes[b])
                graph[a].append((b, d))
                if not oneway:
                    graph[b].append((a, d))
    return nodes, graph


def load_macro(suffix):
    gj = json.loads((MET / 'trayectos-macro' / f'A-{suffix}.geojson').read_text(encoding='utf-8'))
    line = []
    for f in gj['features']:
        g = f.get('geometry') or {}
        if g.get('type') == 'LineString':
            line += [(lat, lon) for lon, lat in g['coordinates']]
    return line


def shortest(graph, sources, targets, limit):
    """Camino más corto desde cualquiera de sources a cualquiera de targets."""
    best = None
    targets = set(targets)
    for s in sources:
        dists, prev = {s: 0.0}, {}
        heap = [(0.0, s)]
        while heap:
            d, u = heapq.heappop(heap)
            if d > dists[u] or d > limit:
                continue
            if u in targets:
                if best is None or d < best[0]:
                    path = [u]
                    while path[-1] != s:
                        path.append(prev[path[-1]])
                    best = (d, path[::-1])
                break
            for v, w in graph[u]:
                if d + w < dists.get(v, math.inf):
                    dists[v] = d + w
                    prev[v] = u
                    heapq.heappush(heap, (d + w, v))
    return best


def macro_slice(line, a, b):
    near = lambda p: min(range(len(line)), key=lambda i: dist(line[i], p))
    i, j = near(a), near(b)
    part = line[i:j + 1] if i <= j else line[j:i + 1][::-1]
    return [a, *part, b]


def main() -> None:
    nodes, graph = load_busway()
    stations = {s['id']: (s['lat'], s['lon'])
                for s in json.loads((MET / 'metropolitano_stops.json').read_text(encoding='utf-8'))['stations']
                if s.get('lat') is not None}
    services = json.loads((MET / 'metropolitano_services.json').read_text(encoding='utf-8'))['services']
    macro = {'ns': load_macro('south'), 'sn': load_macro('north')}
    node_ids = [n for n in nodes if graph.get(n)]

    def candidates(p):
        near = sorted((dist(nodes[n], p), n) for n in node_ids)[:CANDIDATES]
        return [n for d, n in near if d <= SNAP_M]

    paths, fallback = {}, 0
    for svc in services:
        for key, dir_ in (('north_south', 'ns'), ('south_north', 'sn')):
            ids = [s for s in (svc.get(key) or []) if s in stations]
            if len(ids) < 2:
                continue
            coords, at, meters = [stations[ids[0]]], [0], [0.0]
            for x, y in zip(ids, ids[1:]):
                a, b = stations[x], stations[y]
                straight = dist(a, b)
                ca, cb = candidates(a), candidates(b)
                found = shortest(graph, ca, cb, straight * 3 + 2000) if ca and cb else None
                if found and found[0] <= straight * MAX_DETOUR + 250:
                    seg = [a, *(nodes[n] for n in found[1]), b]
                else:
                    seg = macro_slice(macro[dir_], a, b)
                    fallback += 1
                for p in seg[1:]:
                    if dist(p, coords[-1]) > 0.5:
                        coords.append(p)
                at.append(len(coords) - 1)
                meters.append(meters[-1] + sum(dist(p, q) for p, q in zip(seg, seg[1:])))
            paths[f"{svc['id']}:{dir_}"] = {
                'coords': [[round(lat, 6), round(lon, 6)] for lat, lon in coords],
                'at': at,
                'm': [round(m) for m in meters]
            }

    OUT.write_text(json.dumps({'updated': dt.date.today().isoformat(), 'paths': paths},
                              separators=(',', ':')), encoding='utf-8')
    n_pts = sum(len(p['coords']) for p in paths.values())
    print(f'{len(paths)} trazados · {n_pts} puntos · {fallback} tramos por la macroruta (fuera del export de OSM)')
    print(f'Escrito: {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
