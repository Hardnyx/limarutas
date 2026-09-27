"""
Genera data/processed/metropolitano/alimentadores_paths.json: cada
Alimentador del Metropolitano en dos sentidos, ida (del terminal al punto de
vuelta) y vuelta (de ahí al terminal), con su trazado y sus paraderos en
orden.

Fuente: alimentadores.json (export de OSM: relaciones route=bus con sus ways
como MultiLineString y sus paraderos como Point; vienen duplicados).

Casi todos son un circuito: una sola relación que sale del terminal, recorre
el barrio y vuelve. Se corta en dos:
  - terminal: el punto del trazado más cercano a la estación del
    Metropolitano más cercana (Naranjal, Izaguirre, Matellini…)
  - punto de vuelta: el punto del trazado más lejano del terminal
Los paraderos se ordenan por su posición a lo largo del circuito (proyección
sobre el trazado) y van a la ida o a la vuelta según de qué lado del punto de
vuelta caen. La estación del terminal abre la ida y cierra la vuelta, así el
grafo de viajes une el alimentador con el Metropolitano sin caminar.

Con dos relaciones abiertas (una por sentido), la ida es la que sale del
terminal y la vuelta la otra.

Formato:
{
  "updated": "...",
  "services": {
    "AN-01": {
      "terminal": "naranjal", "loop": true,
      "ida":    {"to": "…", "coords": [[lat, lon], ...],
                 "stops": [{"id": "met:naranjal"|"alim:<osm_id>", "name": "…",
                            "lat": …, "lon": …, "at": i_coord, "m": metros}, ...]},
      "vuelta": {...}
    }
  }
}

Uso:
    python pipeline/scripts/metropolitano/build_alim_paths.py
"""

from __future__ import annotations

import datetime as dt
import json
import math
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MET = ROOT / 'data' / 'processed' / 'metropolitano'
OUT = MET / 'alimentadores_paths.json'
WR_STOPS = ROOT / 'pipeline' / 'output' / 'wr_stops_index.json'

LOOP_M = 80          # extremos a menos de esto: es un circuito
MERGE_STOP_M = 40    # "stop" y "platform" de OSM del mismo paradero
MAX_STOP_M = 80      # paraderos más lejos del trazado no se usan
NAME_M = 150         # nombre del paradero: el de Wikiroutes más cercano, hasta esto

M_LAT = 110_574
M_LON = 111_320 * math.cos(math.radians(-12.05))


def dist(a, b):
    return math.hypot((a[1] - b[1]) * M_LON, (a[0] - b[0]) * M_LAT)


def chain(parts):
    """Une los ways de una relación en un solo camino (en el orden de la
    relación, invirtiendo los que vienen al revés)."""
    parts = [p[:] for p in parts if len(p) > 1]
    if not parts:
        return []
    path = parts.pop(0)
    # El primer way puede venir al revés respecto del segundo
    if parts and min(dist(path[0], parts[0][0]), dist(path[0], parts[0][-1])) < \
            min(dist(path[-1], parts[0][0]), dist(path[-1], parts[0][-1])):
        path.reverse()
    while parts:
        best = None
        for i, p in enumerate(parts):
            for rev in (False, True):
                q = p[::-1] if rev else p
                d = dist(path[-1], q[0])
                if best is None or d < best[0]:
                    best = (d, i, rev)
        _, i, rev = best
        p = parts.pop(i)
        p = p[::-1] if rev else p
        path += p[1:] if dist(path[-1], p[0]) < 1 else p
    return path


def cumulative(path):
    cum = [0.0]
    for a, b in zip(path, path[1:]):
        cum.append(cum[-1] + dist(a, b))
    return cum


def project(path, cum, p):
    """(distancia al trazado, metros a lo largo, índice del tramo)."""
    best = (math.inf, 0.0, 0)
    for i, (a, b) in enumerate(zip(path, path[1:])):
        ax, ay, bx, by = a[1] * M_LON, a[0] * M_LAT, b[1] * M_LON, b[0] * M_LAT
        px, py = p[1] * M_LON, p[0] * M_LAT
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
        d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
        if d < best[0]:
            best = (d, cum[i] + t * math.sqrt(l2), i)
    return best


def rotate(path, i):
    """Circuito que empieza en el vértice i."""
    core = path[:-1] if dist(path[0], path[-1]) < 1 else path
    return core[i:] + core[:i + 1]


def load():
    fc = json.loads((MET / 'alimentadores.json').read_text(encoding='utf-8'))
    rels = defaultdict(dict)       # ref -> osm_id -> {name, coords}
    stops = defaultdict(dict)      # ref -> osm_id -> {name, role, lat, lon}
    for f in fc['features']:
        p, g = f['properties'], f['geometry']
        ref = p.get('ref_norm') or p.get('ref')
        if not ref:
            continue
        if g['type'] == 'MultiLineString':
            rels[ref][p['_osm_id']] = {'name': p.get('name', ''),
                                       'parts': [[(lat, lon) for lon, lat in line] for line in g['coordinates']]}
        elif g['type'] == 'Point':
            lon, lat = g['coordinates'][:2]
            stops[ref][p['_osm_id']] = {'name': p.get('name', ''), 'role': p.get('stop_role'), 'lat': lat, 'lon': lon}
    return rels, stops


class Namer:
    """Los paraderos de OSM traen el nombre de la ruta, no el suyo: se toma
    el del paradero de Wikiroutes más cercano."""

    def __init__(self):
        idx = json.loads(WR_STOPS.read_text(encoding='utf-8'))
        self.stops = [(s[1], s[2], s[0]) for s in idx['stops'] if s[1] is not None]

    def near(self, lat, lon):
        best = min(self.stops, key=lambda s: dist((lat, lon), (s[0], s[1])))
        return best[2] if dist((lat, lon), (best[0], best[1])) <= NAME_M else ''


def route_destination(name):
    """'Alimentadora Norte Tahuantinsuyo' → 'Tahuantinsuyo' (sin "(Ida)")."""
    name = re.sub(r'\s*\((ida|vuelta)\)\s*$', '', name, flags=re.IGNORECASE)
    for prefix in ('Alimentadora Norte ', 'Alimentadora Sur ', 'Alimentadora '):
        if name.startswith(prefix):
            return name[len(prefix):].strip()
    return name


def merge_stops(items):
    """Un paradero por lugar: la plataforma y la posición de parada de OSM
    del mismo paradero se juntan."""
    out = []
    for osm_id, s in sorted(items.items(), key=lambda kv: kv[1]['role'] != 'platform'):
        p = (s['lat'], s['lon'])
        if any(dist(p, (o['lat'], o['lon'])) < MERGE_STOP_M for o in out):
            continue
        out.append({'id': f'alim:{osm_id}', 'name': NAMER.near(s['lat'], s['lon']) or 'Paradero',
                    'lat': s['lat'], 'lon': s['lon']})
    return out


def direction(path, stops, first=None, last=None):
    """Trazado y paraderos de un sentido; first/last: estación del terminal."""
    cum = cumulative(path)
    placed = []
    for s in stops:
        d, m, _ = project(path, cum, (s['lat'], s['lon']))
        if d <= MAX_STOP_M:
            placed.append((m, s))
    placed.sort(key=lambda x: x[0])
    seq = []
    if first:
        seq.append((0.0, first))
    seq += placed
    if last:
        seq.append((cum[-1], last))
    out = []
    for m, s in seq:
        # Índice del vértice del trazado más cercano a esa distancia recorrida
        at = min(range(len(cum)), key=lambda i: abs(cum[i] - m))
        if out and out[-1]['at'] > at:
            at = out[-1]['at']
        out.append({**s, 'at': at, 'm': round(m)})
    return {'coords': [[round(lat, 6), round(lon, 6)] for lat, lon in path], 'stops': out}


NAMER = None


def main() -> None:
    global NAMER
    NAMER = Namer()
    stations = [s for s in json.loads((MET / 'metropolitano_stops.json').read_text(encoding='utf-8'))['stations']
                if s.get('lat') is not None]
    rels, stops = load()
    out = {}
    for ref in sorted(rels):
        paths = [chain(r['parts']) for r in rels[ref].values()]
        paths = [p for p in paths if len(p) > 1]
        if not paths:
            continue
        points = [q for p in paths for q in p]
        term = min(stations, key=lambda s: min(dist((s['lat'], s['lon']), q) for q in points))
        tpt = (term['lat'], term['lon'])
        tstop = {'id': f"met:{term['id']}", 'name': term['name'], 'lat': term['lat'], 'lon': term['lon']}
        near = merge_stops(stops[ref])
        near = [s for s in near if dist((s['lat'], s['lon']), tpt) > MERGE_STOP_M]

        loops = [p for p in paths if dist(p[0], p[-1]) < LOOP_M]
        if loops:
            loop = max(loops, key=lambda p: len(p))
            start = min(range(len(loop)), key=lambda i: dist(loop[i], tpt))
            ring = rotate(loop, start)
            far = max(range(len(ring)), key=lambda i: dist(ring[i], tpt))
            ida_path, vta_path = ring[:far + 1], ring[far:]
            cum = cumulative(ring)
            split_m = cum[far]
            ida_s, vta_s = [], []
            for s in near:
                d, m, _ = project(ring, cum, (s['lat'], s['lon']))
                (ida_s if m <= split_m else vta_s).append(s)
            out[ref] = {'terminal': term['id'], 'loop': True,
                        'ida': direction(ida_path, ida_s, first=tstop),
                        'vuelta': direction(vta_path, vta_s, last=tstop)}
        else:
            # Una relación por sentido: la ida sale del terminal
            ordered = sorted(paths, key=lambda p: dist(p[0], tpt))
            ida_path = ordered[0]
            vta_path = ordered[1] if len(ordered) > 1 else ida_path[::-1]
            if dist(vta_path[-1], tpt) > dist(vta_path[0], tpt):
                vta_path = vta_path[::-1]
            def side(path):
                cum = cumulative(path)
                return [s for s in near if project(path, cum, (s['lat'], s['lon']))[0] <= MAX_STOP_M]
            out[ref] = {'terminal': term['id'], 'loop': False,
                        'ida': direction(ida_path, side(ida_path), first=tstop),
                        'vuelta': direction(vta_path, side(vta_path), last=tstop)}

        # Hacia dónde va cada sentido: la ida, al barrio que da nombre a la
        # ruta; la vuelta, a la estación
        name = next(iter(rels[ref].values()))['name']
        out[ref]['name'] = name
        out[ref]['ida']['to'] = route_destination(name)
        out[ref]['vuelta']['to'] = term['name']

    OUT.write_text(json.dumps({'updated': dt.date.today().isoformat(), 'services': out},
                              ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    for ref, s in out.items():
        print(f"{ref:24} {'circuito' if s['loop'] else '2 sentidos'} · terminal {s['terminal']:16} "
              f"ida {len(s['ida']['stops']):2} → {s['ida']['to'][:22]:22} · vuelta {len(s['vuelta']['stops']):2} · "
              + ' / '.join(x['name'] for x in s['ida']['stops'][1:4]))
    print(f'Escrito: {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
