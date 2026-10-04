"""
Genera data/processed/metropolitano/alimentadores_paths.json: cada
Alimentador del Metropolitano en dos sentidos, ida (del terminal al punto de
vuelta) y vuelta (de ahí al terminal), con su trazado y sus paraderos en
orden.

Paraderos: los oficiales de la ATU (config/alim_paraderos.json) donde los
hay. Cada uno se ubica en el paradero de Wikiroutes del mismo nombre junto al
trazado; si no hay ninguno, entre sus vecinos ("aprox": true). Sin lista
oficial, los paraderos de OSM con el nombre del de Wikiroutes más cercano.

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

Los que OSM no tiene, o tiene con su recorrido viejo (config/alim_trazados.json,
de los mapas QR de la ATU), se trazan por la red vial de red_vial.py pasando
por sus puntos en orden y reemplazan al de OSM del mismo código. Sin lista
oficial, sus paraderos son los de Wikiroutes junto al trazado ("aprox").

Formato:
{
  "updated": "...",
  "services": {
    "AN-01": {
      "terminal": "naranjal", "loop": true,
      "ida":    {"to": "…", "coords": [[lat, lon], ...],
                 "stops": [{"id": "met:naranjal"|"alim:<osm_id>", "name": "…",
                            "lat": …, "lon": …, "at": i_coord, "m": metros,
                            "aprox": true (solo si se interpoló)}, ...],
                 "horario": "L-S 05:30-00:00 · D 05:30-23:00" (si es oficial)},
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
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MET = ROOT / 'data' / 'processed' / 'metropolitano'
OUT = MET / 'alimentadores_paths.json'
WR_STOPS = ROOT / 'pipeline' / 'output' / 'wr_stops_index.json'
OFFICIAL = ROOT / 'config' / 'alim_paraderos.json'
TRAZADOS = ROOT / 'config' / 'alim_trazados.json'

LOOP_M = 80          # extremos a menos de esto: es un circuito
MERGE_STOP_M = 40    # "stop" y "platform" de OSM del mismo paradero
MAX_STOP_M = 80      # paraderos más lejos del trazado no se usan
NAME_M = 150         # nombre del paradero: el de Wikiroutes más cercano, hasta esto
OFFICIAL_M = 150     # paradero oficial: el de Wikiroutes de su nombre, hasta esto del trazado
WR_ALONG_M = 30      # trazado sin lista oficial: paraderos de Wikiroutes hasta esto del trazado
WR_GAP_M = 250       # ...y uno cada esto como mínimo (los de enfrente o de la misma cuadra se juntan)

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
        # Con cuántas rutas pasan (el más usado de una cuadra es el de verdad)
        self.full = [(s[1], s[2], s[0], len(s[3])) for s in idx['stops'] if s[1] is not None]

    def near(self, lat, lon):
        best = min(self.stops, key=lambda s: dist((lat, lon), (s[0], s[1])))
        return best[2] if dist((lat, lon), (best[0], best[1])) <= NAME_M else ''


STOPWORDS = {'av', 'avenida', 'jr', 'ca', 'ovalo', 'parque', 'la', 'el', 'los', 'las',
             'de', 'del', 'y', 'd'}


def tokens(name):
    """'Óvalo La Curva' → {'curva'}; 'Machu Picchu' y 'Machupicchu' igual."""
    s = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'[^a-z0-9 ]', ' ', s).replace('machu picchu', 'machupicchu')
    return frozenset(re.sub(r's\b', '', w) for w in s.split() if w not in STOPWORDS)


def same_name(official, wr):
    """Todas las palabras del oficial en el de Wikiroutes ('Plaza Vea' →
    'Plaza Vea (Alameda Sur)'), o al revés si no es una sola letra."""
    return bool(official) and (official <= wr or (wr and wr <= official and max(map(len, wr)) > 3))


def official(path, names, notes, dir_ref, first=None, last=None):
    """Paraderos oficiales de un sentido, en orden sobre el trazado."""
    cum = cumulative(path)
    lats = [p[0] for p in path]
    lons = [p[1] for p in path]
    pad = 0.002
    near = []
    for lat, lon, name in NAMER.stops:
        if not (min(lats) - pad <= lat <= max(lats) + pad and min(lons) - pad <= lon <= max(lons) + pad):
            continue
        d, m, _ = project(path, cum, (lat, lon))
        if d <= OFFICIAL_M:
            near.append((tokens(name), m, lat, lon))
    # Cada uno, el primero de su nombre después del anterior (con 50 m de
    # margen: dos paraderos pueden compartir esquina)
    placed, last_m = [], 0.0
    for name in names:
        want = tokens(name)
        hit = min((c for c in near if c[1] >= last_m - 50 and same_name(want, c[0])),
                  key=lambda c: c[1], default=None)
        if hit:
            last_m = hit[1]
        placed.append(hit)
    # Sin paradero de Wikiroutes: repartidos entre sus vecinos; al empezar la
    # vuelta, en el punto de vuelta; al terminar la ida, en su final
    ms = [c[1] if c else None for c in placed]
    i = 0
    while i < len(ms):
        if ms[i] is not None:
            i += 1
            continue
        j = i
        while j < len(ms) and ms[j] is None:
            j += 1
        lo = ms[i - 1] if i else 0.0
        hi = ms[j] if j < len(ms) else cum[-1]
        n = j - i
        for k in range(n):
            f = (k / n if i == 0 and first is None else
                 (k + 1) / n if j == len(ms) and last is None else (k + 1) / (n + 1))
            ms[i + k] = lo + (hi - lo) * f
        i = j
    stops = []
    for n, (name, hit, m) in enumerate(zip(names, placed, ms)):
        if hit:
            lat, lon = hit[2], hit[3]
        else:
            at = min(range(len(cum)), key=lambda x: abs(cum[x] - m))
            lat, lon = path[at]
        s = {'id': f'alim:{dir_ref}:{n}', 'name': name, 'lat': lat, 'lon': lon, '_m': m}
        if not hit:
            s['aprox'] = True
        if name in notes:
            s['horario'] = notes[name]
        stops.append(s)
    return stops


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
        if '_m' in s:          # oficial, ya ubicado y en orden
            placed.append((s.pop('_m'), s))
            continue
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


def along(path, skip, n=None):
    """Paraderos de Wikiroutes sobre el trazado, en orden, uno cada WR_GAP_M
    como mínimo (de los cercanos, el que más rutas usan). skip: el terminal;
    n: cuántos numera el mapa oficial en este sentido (separa más si sobran)."""
    cum = cumulative(path)
    gap = max(WR_GAP_M, 0.8 * cum[-1] / n) if n else WR_GAP_M
    lats = [p[0] for p in path]
    lons = [p[1] for p in path]
    pad = 0.001
    hits = []
    for lat, lon, name, n in NAMER.full:
        if not (min(lats) - pad <= lat <= max(lats) + pad and min(lons) - pad <= lon <= max(lons) + pad):
            continue
        if dist((lat, lon), skip) < 150:
            continue
        d, m, _ = project(path, cum, (lat, lon))
        if d <= WR_ALONG_M:
            hits.append((m, -n, lat, lon, name))
    hits.sort()
    out = []
    for m, neg, lat, lon, name in hits:
        if out and m - out[-1][0] < gap:
            if neg < out[-1][1]:
                out[-1] = (out[-1][0], neg, lat, lon, name)
            continue
        out.append((m, neg, lat, lon, name))
    return out


def trazados(stations, oficiales):
    """Alimentadores de config/alim_trazados.json, por la red vial."""
    cfg = {k: v for k, v in json.loads(TRAZADOS.read_text(encoding='utf-8')).items()
           if not k.startswith('_')}
    if not cfg:
        return {}
    from red_vial import Red
    pts = [p for c in cfg.values() for p in c['ida'] + c.get('vuelta', [])]
    pad = 0.01
    red = Red((min(p[0] for p in pts) - pad, min(p[1] for p in pts) - pad,
               max(p[0] for p in pts) + pad, max(p[1] for p in pts) + pad))
    by_id = {s['id']: s for s in stations}
    out = {}
    for ref, c in cfg.items():
        term = by_id[c['terminal']]
        tpt = (term['lat'], term['lon'])
        tstop = {'id': f"met:{term['id']}", 'name': term['name'], 'lat': term['lat'], 'lon': term['lon']}
        svc = {'terminal': term['id'], 'loop': True, 'name': c['name'], 'mapa': c.get('mapa')}
        if c.get('aprox'):
            svc['aprox'] = True
        of = oficiales.get(ref)
        for key, first, last in (('ida', tstop, None), ('vuelta', None, tstop)):
            way = c.get(key) or (c['ida'][::-1] if key == 'vuelta' else None)
            path = [tuple(p) for p in red.ruta([(p[0], p[1]) for p in way])]
            if of:
                st = official(path, of[key], of.get('notas', {}), f'{ref}:{key}', first, last)
            else:
                st = [{'id': f'alim:{ref}:{key}:{i}', 'name': name, 'lat': lat, 'lon': lon,
                       '_m': m, 'aprox': True}
                      for i, (m, _, lat, lon, name) in enumerate(
                          along(path, tpt, c.get('paraderos', 0) // 2 or None))]
            svc[key] = direction(path, st, first=first, last=last)
            if of and of.get('horario', {}).get(key):
                svc[key]['horario'] = of['horario'][key]
        svc['ida']['to'] = (of or {}).get('nombre') or c['nombre']
        svc['vuelta']['to'] = term['name']
        out[ref] = svc
    return out


NAMER = None


def main() -> None:
    global NAMER
    NAMER = Namer()
    stations = [s for s in json.loads((MET / 'metropolitano_stops.json').read_text(encoding='utf-8'))['stations']
                if s.get('lat') is not None]
    rels, stops = load()
    oficiales = {k: v for k, v in json.loads(OFFICIAL.read_text(encoding='utf-8')).items()
                 if not k.startswith('_')}
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

        of = oficiales.get(ref)
        if of:
            for key, first, last in (('ida', tstop, None), ('vuelta', None, tstop)):
                path = [tuple(p) for p in out[ref][key]['coords']]
                stops_of = official(path, of[key], of.get('notas', {}), f'{ref}:{key}', first, last)
                out[ref][key] = direction(path, stops_of, first=first, last=last)
                if of.get('horario', {}).get(key):
                    out[ref][key]['horario'] = of['horario'][key]

        # Hacia dónde va cada sentido: la ida, al barrio que da nombre a la
        # ruta; la vuelta, a la estación
        name = next(iter(rels[ref].values()))['name']
        out[ref]['name'] = name
        out[ref]['ida']['to'] = (of or {}).get('nombre') or route_destination(name)
        out[ref]['vuelta']['to'] = term['name']

    # Los de los mapas QR reemplazan al de OSM del mismo código
    out.update(trazados(stations, oficiales))

    OUT.write_text(json.dumps({'updated': dt.date.today().isoformat(), 'services': out},
                              ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    for ref, s in out.items():
        print(f"{ref:24} {'circuito' if s['loop'] else '2 sentidos'} · terminal {s['terminal']:16} "
              f"ida {len(s['ida']['stops']):2} → {s['ida']['to'][:22]:22} · vuelta {len(s['vuelta']['stops']):2} · "
              + ' / '.join(x['name'] for x in s['ida']['stops'][1:4]))
    print(f'Escrito: {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
