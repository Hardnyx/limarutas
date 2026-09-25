"""
Genera pipeline/output/wr_stops_index.json: paraderos con nombre de Wikiroutes
y las rutas que paran en cada uno, para buscar rutas por paradero.

Fuente: la lista "Paradas" de cada route.html (un bloque por sentido, cada
paradero con nombre e id de Wikiroutes). Los route.html no están versionados
(.gitignore); se leen de data/processed/transporte/route_<id>/route.html si
existen y, si no, del historial de git (--git-rev).

Ubicación: los puntos de stops_trip<N>.geojson vienen en el orden del
recorrido, pero empiezan con 1 a 9 marcadores que no son paraderos. Se
emparejan los últimos len(nombres) puntos con la lista; si hay menos puntos
que nombres, ese sentido queda sin ubicación.

Paraderos con el mismo nombre a menos de MERGE_M metros se juntan en uno
(por ejemplo, los dos lados de la pista); si están más lejos, son lugares
distintos (hay "Santa Rosa" en varios distritos).

Cada lugar lleva su distrito (distritos.py, límites del IGN) y el paradero
vecino más frecuente en los recorridos, para distinguir lugares con el mismo
nombre ("Separadora Industrial" en Ate y en Villa El Salvador).

Formato de salida (compacto, se carga en el navegador al buscar):
{
  "routes": ["155549", ...],                   # id Wikiroutes = carpeta route_<id>
  "stops":  [[nombre, lat, lon, [i_ruta, ...], distrito, vecino], ...]
}

Con --write-stops además reescribe cada stops_trip<N>.geojson emparejado:
quita los marcadores del inicio que no son paraderos y agrega a cada punto
sus propiedades {name, stop_id, seq}. Las coordenadas se redondean a 7
decimales (~1 cm).

Uso:
    python pipeline/scripts/wikiroutes/wr_build_stops_index.py [--git-rev 1c1e782e^] [--write-stops]
"""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import unicodedata
from collections import defaultdict
from html import unescape
from pathlib import Path

from distritos import Distritos

ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = ROOT / 'data' / 'processed' / 'transporte'
OUT_PATH = ROOT / 'pipeline' / 'output' / 'wr_stops_index.json'

# Último commit que aún tenía los route.html versionados
DEFAULT_GIT_REV = '1c1e782e^'

MERGE_M = 400

BLOCK_SPLIT = '<div class="stops-list-block">'
ITEM_RE = re.compile(
    r'<a class="stops-list-item" href="/[a-z]{2}/stops/(\d+)">'
    r'<span class="stops-listDot"></span>\s*([^<]*)</a>'
)


def norm(s: str) -> str:
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()


def read_html(route_dir: Path, git_rev: str | None) -> str | None:
    local = route_dir / 'route.html'
    if local.is_file():
        return local.read_text(encoding='utf-8', errors='ignore')
    if not git_rev:
        return None
    rel = local.relative_to(ROOT).as_posix()
    r = subprocess.run(['git', '-C', str(ROOT), 'show', f'{git_rev}:{rel}'],
                       capture_output=True)
    if r.returncode != 0:
        return None
    return r.stdout.decode('utf-8', errors='ignore')


def parse_blocks(html: str) -> list[list[tuple[str, str]]]:
    """[(id_paradero, nombre), ...] por sentido, en orden."""
    blocks = []
    for chunk in html.split(BLOCK_SPLIT)[1:]:
        items = [(sid, ' '.join(unescape(name).split())) for sid, name in ITEM_RE.findall(chunk)]
        if items:
            blocks.append(items)
    return blocks


def load_points(route_dir: Path, trip: int):
    path = route_dir / f'stops_trip{trip}.geojson'
    if not path.is_file():
        return None
    gj = json.loads(path.read_text(encoding='utf-8'))
    return [f['geometry']['coordinates'] for f in gj.get('features', [])
            if (f.get('geometry') or {}).get('type') == 'Point']


def write_stops(route_dir: Path, trip: int, items, coords):
    features = [{
        'type': 'Feature',
        'geometry': {'type': 'Point', 'coordinates': [round(lon, 7), round(lat, 7)]},
        'properties': {'name': name, 'stop_id': sid, 'seq': i}
    } for i, ((sid, name), (lon, lat)) in enumerate(zip(items, coords), 1)]
    path = route_dir / f'stops_trip{trip}.geojson'
    path.write_text(json.dumps({'type': 'FeatureCollection', 'features': features},
                               ensure_ascii=False, separators=(',', ':')),
                    encoding='utf-8')


def dist_m(a, b):
    lat = math.radians((a[0] + b[0]) / 2)
    dx = (a[1] - b[1]) * 111_320 * math.cos(lat)
    dy = (a[0] - b[0]) * 110_574
    return math.hypot(dx, dy)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--git-rev', default=DEFAULT_GIT_REV,
                    help='commit del que leer route.html si no está en disco ("" para no usar git)')
    ap.add_argument('--write-stops', action='store_true',
                    help='anotar stops_trip<N>.geojson con nombre, id y orden')
    args = ap.parse_args()
    n_written = n_dropped = 0

    # id de paradero -> nombre, ubicación y rutas
    stop_name: dict[str, str] = {}
    stop_pos: dict[str, tuple[float, float]] = {}
    stop_routes: dict[str, set[str]] = defaultdict(set)
    # paradero anterior/siguiente en cada recorrido (para desambiguar)
    stop_neighbors: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    n_routes = n_no_html = n_no_list = 0
    n_dirs = n_located = 0
    mismatches = []

    for route_dir in sorted(DATA_DIR.glob('route_*')):
        if not route_dir.is_dir():
            continue
        wr_id = route_dir.name.split('_', 1)[1]
        html = read_html(route_dir, args.git_rev or None)
        if html is None:
            n_no_html += 1
            continue
        blocks = parse_blocks(html)
        if not blocks:
            n_no_list += 1
            continue
        n_routes += 1

        for trip, items in enumerate(blocks, 1):
            n_dirs += 1
            for i, (sid, name) in enumerate(items):
                stop_name.setdefault(sid, name)
                stop_routes[sid].add(wr_id)
                for j in (i - 1, i + 1):
                    if 0 <= j < len(items):
                        stop_neighbors[sid][items[j][1]] += 1

            pts = load_points(route_dir, trip)
            if pts is None or len(pts) < len(items):
                mismatches.append((wr_id, trip, len(items), None if pts is None else len(pts)))
                continue
            n_located += 1
            kept = pts[len(pts) - len(items):]
            for (sid, _), (lon, lat) in zip(items, kept):
                stop_pos.setdefault(sid, (lat, lon))

            if args.write_stops:
                n_dropped += len(pts) - len(items)
                write_stops(route_dir, trip, items, kept)
                n_written += 1

    # Juntar paraderos con el mismo nombre y cercanos (lados de la pista)
    by_name: dict[str, list[str]] = defaultdict(list)
    for sid in stop_name:
        by_name[norm(stop_name[sid])].append(sid)

    route_ids = sorted({r for rs in stop_routes.values() for r in rs}, key=int)
    route_idx = {r: i for i, r in enumerate(route_ids)}

    distritos = Distritos()
    places = []
    for key, sids in by_name.items():
        if not key:
            continue
        clusters: list[dict] = []
        for sid in sids:
            pos = stop_pos.get(sid)
            target = None
            if pos:
                target = next((c for c in clusters if c['pos'] and dist_m(c['pos'], pos) <= MERGE_M), None)
            elif clusters:
                target = clusters[0]   # sin ubicación: se asume el mismo lugar
            if target is None:
                target = {'pos': pos, 'names': defaultdict(int), 'routes': set(), 'neighbors': defaultdict(int)}
                clusters.append(target)
            if target['pos'] is None and pos:
                target['pos'] = pos
            target['names'][stop_name[sid]] += 1
            target['routes'] |= stop_routes[sid]
            for nb, c in stop_neighbors[sid].items():
                if norm(nb) != key:
                    target['neighbors'][nb] += c
        for c in clusters:
            name = max(c['names'], key=c['names'].get)
            lat, lon = c['pos'] if c['pos'] else (None, None)
            neighbor = max(c['neighbors'], key=c['neighbors'].get) if c['neighbors'] else ''
            places.append([
                name,
                round(lat, 6) if lat is not None else None,
                round(lon, 6) if lon is not None else None,
                sorted(route_idx[r] for r in c['routes']),
                distritos.at(lat, lon) if lat is not None else '',
                neighbor
            ])

    places.sort(key=lambda p: (-len(p[3]), norm(p[0])))
    OUT_PATH.write_text(json.dumps({'routes': route_ids, 'stops': places},
                                   ensure_ascii=False, separators=(',', ':')),
                        encoding='utf-8')

    print(f'Rutas con lista de paraderos: {n_routes} | sin route.html: {n_no_html} | sin lista: {n_no_list}')
    print(f'Sentidos: {n_dirs} | con ubicación emparejada: {n_located} | sin emparejar: {len(mismatches)}')
    for wr_id, trip, n_names, n_pts in mismatches[:15]:
        print(f'  route_{wr_id} sentido {trip}: {n_names} nombres, {n_pts} puntos')
    if args.write_stops:
        print(f'stops_trip<N>.geojson anotados: {n_written} | marcadores quitados (no eran paraderos): {n_dropped}')
    print(f'Paraderos (ids Wikiroutes): {len(stop_name)} | lugares tras juntar por nombre: {len(places)}')
    sin_distrito = sum(1 for pl in places if not pl[4])
    print(f'Lugares sin distrito (fuera de Lima y Callao): {sin_distrito}')
    print(f'Escrito: {OUT_PATH.relative_to(ROOT)} ({OUT_PATH.stat().st_size / 1024:.0f} KB)')
    print()
    print('Paraderos con más rutas:')
    for name, lat, lon, rs in places[:15]:
        print(f'  {len(rs):>4}  {name}')


if __name__ == '__main__':
    main()
