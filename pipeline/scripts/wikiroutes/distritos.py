"""
Distrito de Lima o Callao en el que cae un punto (lat, lon).

Límites: data/raw/ign/lima_callao_distritos.geojson (IGN), tomado de
https://github.com/joseluisq/peru-geojson-datasets (lima_callao_distritos.geojson).
El archivo trae los nombres en mayúsculas y sin tildes; aquí se mapean al
nombre para mostrar.

Uso:
    from distritos import Distritos
    d = Distritos()
    d.at(-12.0464, -77.0428)   # 'Lima'
"""

from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / 'data' / 'raw' / 'ign' / 'lima_callao_distritos.geojson'

# Puntos fuera de todo polígono (orilla, bordes mal trazados) se asignan al
# distrito más cercano si está a menos de esto
MAX_OUTSIDE_M = 1500

DISPLAY = {
    'ANCON': 'Ancón', 'ATE': 'Ate', 'BARRANCO': 'Barranco', 'BELLAVISTA': 'Bellavista',
    'BREÑA': 'Breña', 'CALLAO': 'Callao', 'CARABAYLLO': 'Carabayllo',
    'CARMEN DE LA LEGUA REYNOSO': 'Carmen de la Legua-Reynoso', 'CHACLACAYO': 'Chaclacayo',
    'CHORRILLOS': 'Chorrillos', 'CIENEGUILLA': 'Cieneguilla', 'COMAS': 'Comas',
    'EL AGUSTINO': 'El Agustino', 'INDEPENDENCIA': 'Independencia', 'JESUS MARIA': 'Jesús María',
    'LA MOLINA': 'La Molina', 'LA PERLA': 'La Perla', 'LA PUNTA': 'La Punta',
    'LA VICTORIA': 'La Victoria', 'LIMA': 'Lima', 'LINCE': 'Lince', 'LOS OLIVOS': 'Los Olivos',
    'LURIGANCHO': 'Lurigancho-Chosica', 'LURIN': 'Lurín', 'MAGDALENA DEL MAR': 'Magdalena del Mar',
    'MI PERU': 'Mi Perú', 'MIRAFLORES': 'Miraflores', 'PACHACAMAC': 'Pachacámac',
    'PUCUSANA': 'Pucusana', 'PUEBLO LIBRE': 'Pueblo Libre', 'PUENTE PIEDRA': 'Puente Piedra',
    'PUNTA HERMOSA': 'Punta Hermosa', 'PUNTA NEGRA': 'Punta Negra', 'RIMAC': 'Rímac',
    'SAN BARTOLO': 'San Bartolo', 'SAN BORJA': 'San Borja', 'SAN ISIDRO': 'San Isidro',
    'SAN JUAN DE LURIGANCHO': 'San Juan de Lurigancho',
    'SAN JUAN DE MIRAFLORES': 'San Juan de Miraflores', 'SAN LUIS': 'San Luis',
    'SAN MARTIN DE PORRES': 'San Martín de Porres', 'SAN MIGUEL': 'San Miguel',
    'SANTA ANITA': 'Santa Anita', 'SANTA MARIA DEL MAR': 'Santa María del Mar',
    'SANTA ROSA': 'Santa Rosa', 'SANTIAGO DE SURCO': 'Santiago de Surco',
    'SURQUILLO': 'Surquillo', 'VENTANILLA': 'Ventanilla', 'VILLA EL SALVADOR': 'Villa El Salvador',
    'VILLA MARIA DEL TRIUNFO': 'Villa María del Triunfo',
}


def _display(raw: str) -> str:
    # El archivo trae "MI PERÃz" (Perú con la codificación rota)
    key = 'MI PERU' if raw.startswith('MI PER') else raw
    return DISPLAY.get(key, raw.title())


def _in_ring(lon, lat, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _in_polygon(lon, lat, poly):
    # poly = [anillo exterior, huecos...]
    if not _in_ring(lon, lat, poly[0]):
        return False
    return not any(_in_ring(lon, lat, hole) for hole in poly[1:])


def _dist_m(lat1, lon1, lat2, lon2):
    lat = math.radians((lat1 + lat2) / 2)
    return math.hypot((lon1 - lon2) * 111_320 * math.cos(lat), (lat1 - lat2) * 110_574)


class Distritos:
    def __init__(self, path: Path = SRC):
        gj = json.loads(path.read_text(encoding='utf-8'))
        self.items = []
        for f in gj['features']:
            g = f.get('geometry') or {}
            polys = g['coordinates'] if g.get('type') == 'MultiPolygon' else [g.get('coordinates')]
            polys = [p for p in polys if p]
            if not polys:
                continue
            xs = [c[0] for p in polys for c in p[0]]
            ys = [c[1] for p in polys for c in p[0]]
            self.items.append({
                'name': _display(f['properties']['distrito']),
                'polys': polys,
                'bbox': (min(xs), min(ys), max(xs), max(ys)),
            })

    def at(self, lat: float, lon: float) -> str:
        """Nombre del distrito que contiene el punto ('' si está lejos de todos)."""
        for d in self.items:
            x0, y0, x1, y1 = d['bbox']
            if x0 <= lon <= x1 and y0 <= lat <= y1 and any(_in_polygon(lon, lat, p) for p in d['polys']):
                return d['name']
        # Fuera de todo polígono: el más cercano por vértices, si está cerca
        best, best_d = '', MAX_OUTSIDE_M
        for d in self.items:
            for p in d['polys']:
                for x, y in p[0][::5]:
                    dd = _dist_m(lat, lon, y, x)
                    if dd < best_d:
                        best, best_d = d['name'], dd
        return best
