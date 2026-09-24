"""
Análisis ad hoc: cuántas rutas de Wikiroutes pasan por cada avenida.

Cruza los trazados de data/processed/transporte (route_track_trip*.geojson)
con las vías con nombre del export de OSM (data/raw/osm/transporte.zip).
Solo imprime en consola; no escribe archivos.

Método: se muestrea cada trazado cada SAMPLE_M metros, cada muestra se
asigna a la vía OSM con nombre más cercana (máx. MATCH_M metros) y una ruta
cuenta para una avenida si recorre al menos MIN_TRAMO_M metros por ella.
Así un cruce perpendicular no cuenta como "pasar por" la avenida.

Uso:
    python pipeline/scripts/analisis_avenidas.py [--grupo transporte|semiformal|todas] [--top 30]
"""

import argparse
import json
import math
import re
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WR_MAP = ROOT / 'pipeline/output/wr_map.json'
CATALOG = ROOT / 'config/catalog.json'
OSM_ZIP = ROOT / 'data/raw/osm/transporte.zip'

SAMPLE_M = 30        # distancia entre muestras sobre el trazado
MATCH_M = 25         # distancia máxima de una muestra a la vía
MIN_TRAMO_M = 300    # recorrido mínimo para contar que la ruta usa la avenida
CELL_DEG = 0.002     # celda del índice espacial (~220 m)
HOT_CELL_DEG = 0.001 # celda para puntos críticos (~110 m)

LAT0 = -12.05
M_PER_DEG_LAT = 110_574
M_PER_DEG_LON = 111_320 * math.cos(math.radians(LAT0))


def to_xy(lon, lat):
    return lon * M_PER_DEG_LON, lat * M_PER_DEG_LAT


def base_id(rid):
    return re.sub(r'-(ida|vuelta)$', '', rid, flags=re.I)


def route_key(rid, conf):
    """Código de ruta como lo muestra el mapa: 1004 y 1004_63006 son la misma."""
    code = conf.get('display_id') or base_id(rid)
    return re.sub(r'_\d+$', '', str(code)).upper()


def catalog_bases(grupo):
    cat = json.loads(CATALOG.read_text(encoding='utf-8'))
    if grupo == 'todas':
        return None
    return {str(x).upper() for x in cat[grupo]['only']}


def route_in_group(base, allowed):
    if allowed is None:
        return True
    b = base.upper()
    cands = {b, re.sub(r'_\d+$', '', b)}
    if re.fullmatch(r'\d+', b):
        cands.add(str(int(b)))
    return bool(cands & allowed)


def load_osm_segments():
    with zipfile.ZipFile(OSM_ZIP) as z:
        data = json.loads(z.read('transporte.json'))
    grid = defaultdict(list)
    n_ways = 0
    for el in data['elements']:
        if el['type'] != 'way':
            continue
        name = (el.get('tags') or {}).get('name')
        geom = el.get('geometry')
        if not name or not geom or len(geom) < 2:
            continue
        n_ways += 1
        pts = [to_xy(p['lon'], p['lat']) for p in geom]
        lonlat = [(p['lon'], p['lat']) for p in geom]
        for (a, b), (la, lb) in zip(zip(pts, pts[1:]), zip(lonlat, lonlat[1:])):
            seg = (a, b, name)
            lo_x, hi_x = sorted((la[0], lb[0]))
            lo_y, hi_y = sorted((la[1], lb[1]))
            pad = MATCH_M / M_PER_DEG_LAT
            for cx in range(int(math.floor((lo_x - pad) / CELL_DEG)), int(math.floor((hi_x + pad) / CELL_DEG)) + 1):
                for cy in range(int(math.floor((lo_y - pad) / CELL_DEG)), int(math.floor((hi_y + pad) / CELL_DEG)) + 1):
                    grid[(cx, cy)].append(seg)
    return grid, n_ways


def dist_point_seg(p, a, b):
    ax, ay = a
    bx, by = b
    px, py = p
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    qx, qy = ax + t * dx, ay + t * dy
    return math.hypot(px - qx, py - qy)


def nearest_name(lon, lat, grid):
    p = to_xy(lon, lat)
    best, best_d = None, MATCH_M
    for a, b, name in grid.get((int(math.floor(lon / CELL_DEG)), int(math.floor(lat / CELL_DEG))), ()):
        d = dist_point_seg(p, a, b)
        if d < best_d:
            best, best_d = name, d
    return best


def track_lines(path):
    gj = json.loads(path.read_text(encoding='utf-8'))
    for f in gj.get('features', []):
        g = f.get('geometry') or {}
        if g.get('type') == 'LineString':
            yield g['coordinates']
        elif g.get('type') == 'MultiLineString':
            yield from g['coordinates']


def sample_line(coords):
    """Puntos cada SAMPLE_M metros a lo largo de la línea."""
    for (lon1, lat1), (lon2, lat2) in zip(coords, coords[1:]):
        x1, y1 = to_xy(lon1, lat1)
        x2, y2 = to_xy(lon2, lat2)
        seg = math.hypot(x2 - x1, y2 - y1)
        n = max(1, int(seg // SAMPLE_M))
        for i in range(n):
            t = i / n
            yield lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t, seg / n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--grupo', default='transporte', choices=['transporte', 'semiformal', 'todas'])
    ap.add_argument('--top', type=int, default=30)
    args = ap.parse_args()

    routes = json.loads(WR_MAP.read_text(encoding='utf-8'))['routes']
    allowed = catalog_bases(args.grupo)
    grid, n_ways = load_osm_segments()

    # Paraderos: disponibilidad y densidad
    n_sub = n_stops_files = n_stops = 0
    km_total = 0.0

    per_route = defaultdict(lambda: defaultdict(float))   # ruta -> nombre -> metros
    per_cell = defaultdict(set)                            # celda ~110 m -> rutas
    cell_names = defaultdict(lambda: defaultdict(int))     # celda -> nombre -> muestras
    matched_m = total_m = 0.0
    seen_keys = set()

    for rid, conf in routes.items():
        base = base_id(rid)
        if not route_in_group(base, allowed):
            continue
        key = route_key(rid, conf)
        seen_keys.add(key)
        folder = ROOT / conf['folder']
        trip = conf.get('trip')
        track = folder / f'route_track_trip{trip}.geojson'
        stops = folder / f'stops_trip{trip}.geojson'
        if not track.exists():
            continue
        n_sub += 1
        if stops.exists():
            n_stops_files += 1
            n_stops += len(json.loads(stops.read_text(encoding='utf-8')).get('features', []))

        for coords in track_lines(track):
            for lon, lat, step in sample_line(coords):
                total_m += step
                cell = (int(math.floor(lon / HOT_CELL_DEG)), int(math.floor(lat / HOT_CELL_DEG)))
                per_cell[cell].add(key)
                name = nearest_name(lon, lat, grid)
                if name:
                    matched_m += step
                    per_route[key][name] += step
                    cell_names[cell][name] += 1
        km_total = total_m / 1000

    rutas_por_via = defaultdict(set)
    for base, by_name in per_route.items():
        for name, m in by_name.items():
            if m >= MIN_TRAMO_M:
                rutas_por_via[name].add(base)

    n_routes = len(seen_keys)
    print(f'Grupo: {args.grupo} | rutas: {n_routes} | subrutas con trazado: {n_sub}')
    print(f'Vías OSM con nombre: {n_ways}')
    print(f'Paraderos: {n_stops_files}/{n_sub} subrutas con archivo, {n_stops} paraderos, '
          f'{n_stops / max(km_total, 1e-9):.1f} por km de trazado')
    print(f'Trazado total: {km_total:,.0f} km | asignado a una vía OSM con nombre: '
          f'{100 * matched_m / max(total_m, 1e-9):.1f}%')
    print()
    print(f'{"#":>3}  {"rutas":>5}  vía')
    ranking = sorted(rutas_por_via.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    for i, (name, bases) in enumerate(ranking[:args.top], 1):
        print(f'{i:>3}  {len(bases):>5}  {name}')

    # Puntos críticos: celdas de ~110 m por donde pasan más rutas distintas.
    # Se agrupan celdas vecinas para no repetir el mismo punto.
    print()
    print(f'Puntos críticos (celdas de ~110 m con más rutas distintas):')
    print(f'{"#":>3}  {"rutas":>5}  {"lat, lon":<22}  vía más cercana')
    picked = []
    for cell, keys in sorted(per_cell.items(), key=lambda kv: -len(kv[1])):
        if any(abs(cell[0] - c[0]) <= 3 and abs(cell[1] - c[1]) <= 3 for c in picked):
            continue
        picked.append(cell)
        names = cell_names.get(cell) or {}
        name = max(names, key=names.get) if names else '(sin vía OSM)'
        lat = (cell[1] + 0.5) * HOT_CELL_DEG
        lon = (cell[0] + 0.5) * HOT_CELL_DEG
        print(f'{len(picked):>3}  {len(keys):>5}  {lat:.4f}, {lon:.4f}      {name}')
        if len(picked) >= 15:
            break


if __name__ == '__main__':
    main()
