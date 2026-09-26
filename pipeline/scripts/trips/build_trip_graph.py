"""
Genera pipeline/output/trip_graph.json: los datos físicos para calcular viajes
("Cómo llegar"): paraderos y, para cada ruta y sentido, los paraderos por los
que pasa en orden.

Solo guarda datos físicos. Qué rutas se ofrecen y a qué grupo pertenecen
(Transporte público, Rutas antiguas, etc.) lo decide el navegador con las
mismas casillas del sidebar (assets/js/tripData.js), para no repetir aquí la
lógica de config/catalog.json.

Fuentes:
  Wikiroutes     wr_map.json → carpeta y sentido de cada capa; sus paraderos
                 en stops_trip<N>.geojson (ya emparejados con nombre, stop_id
                 y seq por wr_build_stops_index.py --write-stops)
  Metropolitano  metropolitano_services.json: regulares con sus estaciones en
                 orden norte→sur (se agrega el sentido contrario) y expresos
                 con las de cada sentido; coordenadas de metropolitano_stops.json
  Metro          metro.geojson: estaciones (Point) ordenadas a lo largo del
                 trazo (LineString) de cada sentido

Alimentadores del Metropolitano: sus paraderos no traen orden y varios son
circuitos; quedan fuera hasta tener un orden confiable.

Paraderos: Wikiroutes comparte el stop_id entre las rutas que paran en el
mismo lugar, así que cada stop_id es un nodo. Los puntos sin stop_id se
identifican por su coordenada (~1 m). Dos paraderos distintos cercanos (los
de la vía principal y la auxiliar, los dos lados de la pista) NO se juntan:
el navegador los une con caminatas cortas.

Formato de salida (compacto, se carga al abrir "Cómo llegar"):
{
  "version": 1,
  "districts": ["Ate", ...],
  "stops":  [[lat, lon, nombre, i_distrito], ...],
  "routes": {"1240-ida": [i_paradero, ...],        # capa Wikiroutes
             "met:A:ns": [...], "met:A:sn": [...],  # servicio y sentido
             "metro:L1:0": [...], "metro:L1:1": [...]}
}

Uso:
    python pipeline/scripts/trips/build_trip_graph.py
"""

from __future__ import annotations

import json
import math
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'pipeline' / 'scripts' / 'wikiroutes'))
from distritos import Distritos  # noqa: E402

WR_MAP = ROOT / 'pipeline' / 'output' / 'wr_map.json'
MET = ROOT / 'data' / 'processed' / 'metropolitano'
METRO = ROOT / 'data' / 'processed' / 'metro' / 'metro.geojson'
OUT = ROOT / 'pipeline' / 'output' / 'trip_graph.json'


class Stops:
    """Nodos del grafo: una entrada por paradero físico."""

    def __init__(self):
        self.index: dict[str, int] = {}
        self.coords: list[tuple[float, float]] = []
        self.names: list[Counter] = []

    def get(self, key: str, lat: float, lon: float, name: str) -> int:
        i = self.index.get(key)
        if i is None:
            i = len(self.coords)
            self.index[key] = i
            self.coords.append((lat, lon))
            self.names.append(Counter())
        if name:
            self.names[i][name.strip()] += 1
        return i


def dedupe(seq: list[int]) -> list[int]:
    """Quita repeticiones seguidas (el mismo paradero dos veces)."""
    out: list[int] = []
    for i in seq:
        if not out or out[-1] != i:
            out.append(i)
    return out


def wikiroutes(stops: Stops, routes: dict) -> tuple[int, int]:
    layers = json.loads(WR_MAP.read_text(encoding='utf-8'))['routes']
    missing = 0
    for layer_id, conf in layers.items():
        folder = ROOT / conf.get('folder', f'data/processed/transporte/route_{layer_id}')
        path = folder / f"stops_trip{conf.get('trip', 1)}.geojson"
        if not path.exists():
            missing += 1
            continue
        feats = json.loads(path.read_text(encoding='utf-8')).get('features', [])
        feats = [f for f in feats if (f.get('geometry') or {}).get('type') == 'Point']
        feats.sort(key=lambda f: (f.get('properties') or {}).get('seq', 0))
        seq = []
        for f in feats:
            lon, lat = f['geometry']['coordinates'][:2]
            p = f.get('properties') or {}
            key = f"wr:{p['stop_id']}" if p.get('stop_id') else f'wr:@{lat:.5f},{lon:.5f}'
            seq.append(stops.get(key, lat, lon, p.get('name', '')))
        seq = dedupe(seq)
        if len(seq) >= 2:
            routes[layer_id] = seq
    return len(layers), missing


def metropolitano(stops: Stops, routes: dict) -> int:
    stations = json.loads((MET / 'metropolitano_stops.json').read_text(encoding='utf-8'))['stations']
    by_id = {s['id']: s for s in stations}
    services = json.loads((MET / 'metropolitano_services.json').read_text(encoding='utf-8'))['services']
    def seq_of(ids):
        # Las estaciones pendientes (sin coordenadas) se saltan
        return dedupe([stops.get(f'met:{sid}', by_id[sid]['lat'], by_id[sid]['lon'], by_id[sid]['name'])
                       for sid in ids or [] if sid in by_id and by_id[sid].get('lat') is not None])

    n = 0
    for svc in services:
        if svc.get('north_south') or svc.get('south_north'):
            # Expresos: cada sentido tiene sus propias estaciones
            ns, sn = seq_of(svc.get('north_south')), seq_of(svc.get('south_north'))
        else:
            # Regulares: la lista va de norte a sur y se recorre en ambos sentidos
            ns = seq_of(svc.get('stops'))
            sn = ns[::-1]
        for key, seq in (('ns', ns), ('sn', sn)):
            if len(seq) >= 2:
                routes[f"met:{svc['id']}:{key}"] = seq
        n += 1 if len(ns) >= 2 or len(sn) >= 2 else 0
    return n


def _project(line: list[list[float]], lat: float, lon: float) -> float:
    """Posición (en metros desde el inicio) del punto más cercano del trazo."""
    best_d, best_pos, pos = math.inf, 0.0, 0.0
    k = math.cos(math.radians(lat))
    for (x1, y1), (x2, y2) in zip(line, line[1:]):
        ax, ay = (x1 - lon) * 111_320 * k, (y1 - lat) * 110_574
        bx, by = (x2 - lon) * 111_320 * k, (y2 - lat) * 110_574
        dx, dy = bx - ax, by - ay
        seg = math.hypot(dx, dy)
        t = 0.0 if seg == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / (seg * seg)))
        d = math.hypot(ax + t * dx, ay + t * dy)
        if d < best_d:
            best_d, best_pos = d, pos + t * seg
        pos += seg
    return best_pos


def metro(stops: Stops, routes: dict) -> int:
    feats = json.loads(METRO.read_text(encoding='utf-8'))['features']
    lines: dict[str, list] = {}
    stations: dict[str, dict[str, tuple[float, float]]] = {}
    for f in feats:
        p, g = f.get('properties') or {}, f.get('geometry') or {}
        ref = p.get('ref')
        if not ref:
            continue
        if g.get('type') == 'LineString':
            lines.setdefault(ref, []).append(g['coordinates'])
        elif g.get('type') == 'Point' and p.get('name'):
            lon, lat = g['coordinates'][:2]
            stations.setdefault(ref, {}).setdefault(p['name'].strip(), (lat, lon))
    n = 0
    for ref, sts in sorted(stations.items()):
        if ref not in lines or len(sts) < 2:
            continue
        # El trazo más largo de la línea define el orden; el otro sentido es el inverso
        line = max(lines[ref], key=len)
        ordered = sorted(sts.items(), key=lambda kv: _project(line, kv[1][0], kv[1][1]))
        seq = dedupe([stops.get(f'metro:{ref}:{name}', lat, lon, name) for name, (lat, lon) in ordered])
        routes[f'metro:{ref}:0'] = seq
        routes[f'metro:{ref}:1'] = seq[::-1]
        n += 1
    return n


def main() -> None:
    stops = Stops()
    routes: dict[str, list[int]] = {}
    n_layers, missing = wikiroutes(stops, routes)
    n_met = metropolitano(stops, routes)
    n_metro = metro(stops, routes)

    dist = Distritos()
    districts: list[str] = []
    d_index: dict[str, int] = {}
    rows = []
    for (lat, lon), names in zip(stops.coords, stops.names):
        d = dist.at(lat, lon)
        if d not in d_index:
            d_index[d] = len(districts)
            districts.append(d)
        name = names.most_common(1)[0][0] if names else ''
        rows.append([round(lat, 6), round(lon, 6), name, d_index[d]])

    out = {'version': 1, 'districts': districts, 'stops': rows, 'routes': routes}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    wr = sum(1 for k in routes if ':' not in k)
    print(f'Wikiroutes: {wr} de {n_layers} capas con paraderos ({missing} sin archivo)')
    print(f'Metropolitano: {n_met} servicios · Metro: {n_metro} líneas (ambos sentidos)')
    print(f'Paraderos: {len(rows)} · {OUT.relative_to(ROOT)}: {OUT.stat().st_size / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
