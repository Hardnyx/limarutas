"""
Cruce de cada paradero: la calle transversal donde está, para distinguir
paraderos con el mismo nombre en el buscador ("Universitaria con Colonial",
"Universitaria con Izaguirre", "Trébol de Universitaria con Panamericana
Norte"). El nombre del paradero no cambia: en el mapa y en los pasos del
viaje sigue siendo "Universitaria".

Fuente: las calles con nombre de OSM (data/raw/osm/transporte.zip). El
paradero se llama como una de las dos calles del cruce; la otra, la más
cercana a menos de NEAR_M, es el cruce. Si el paradero no está sobre una
calle de su nombre (se llama como la transversal), el cruce es la calle donde
está. Cerca de rampas de una vía rápida (≥ LINKS ways *_link), es un trébol.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OSM_ZIP = ROOT / 'data' / 'raw' / 'osm' / 'transporte.zip'

NEAR_M = 60
TREBOL_M = 150
LINKS = 6
CELL_M = 50

M_LAT = 110_574
M_LON = 111_320 * math.cos(math.radians(-12.05))

STOPWORDS = {'av', 'avenida', 'jr', 'jiron', 'calle', 'ca', 'psje', 'pasaje', 'prolongacion', 'prol',
             'ovalo', 'de', 'del', 'la', 'las', 'los', 'el', 'y', 'auxiliar', 'carretera', 'via'}
PREFIX = re.compile(r'^(Avenida|Av\.|Jirón|Jr\.|Calle|Pasaje|Prolongación|Carretera|Vía de|Vía|Óvalo|Alameda|Malecón)\s+', re.I)
FAST = {'motorway', 'trunk'}


def _norm(s: str) -> str:
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9 ]', ' ', s)


def tokens(s: str) -> frozenset:
    return frozenset(w for w in _norm(s).split() if w not in STOPWORDS)


def short(name: str) -> str:
    """'Avenida Carlos Alberto Izaguirre' → 'Carlos Alberto Izaguirre'; 'Avenida A'
    se queda ('A' solo no dice nada)."""
    name = ' '.join(name.split())
    out = name
    while PREFIX.match(out):                 # 'Prolongación Avenida …'
        out = PREFIX.sub('', out, count=1).strip()
    return out if len(out) > 2 else name


def _segd(p, a, b):
    ax, ay = (a[1] - p[1]) * M_LON, (a[0] - p[0]) * M_LAT
    bx, by = (b[1] - p[1]) * M_LON, (b[0] - p[0]) * M_LAT
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / l2))
    return math.hypot(ax + t * dx, ay + t * dy)


class Cruces:
    def __init__(self):
        with zipfile.ZipFile(OSM_ZIP) as z:
            osm = json.loads(z.read('transporte.json'))
        self.grid = defaultdict(list)
        self.street_names = set()        # tokens de cada nombre de calle de OSM
        for e in osm['elements']:
            if e['type'] != 'way' or 'geometry' not in e:
                continue
            t = e.get('tags', {})
            hw = t.get('highway', '')
            if not hw:
                continue
            if t.get('name'):
                self.street_names.add(tokens(t['name']))
            pts = [(g['lat'], g['lon']) for g in e['geometry']]
            for a, b in zip(pts, pts[1:]):
                self.grid[self._cell(*a)].append((a, b, t.get('name', ''), hw))

    @staticmethod
    def _cell(lat, lon):
        return (int(lat * M_LAT // CELL_M), int(lon * M_LON // CELL_M))

    def _near(self, lat, lon, radius):
        ci, cj = self._cell(lat, lon)
        r = int(radius // CELL_M) + 1
        best, links = {}, 0
        for di in range(-r, r + 1):
            for dj in range(-r, r + 1):
                for a, b, name, hw in self.grid.get((ci + di, cj + dj), ()):
                    d = _segd((lat, lon), a, b)
                    if d > radius:
                        continue
                    if hw.endswith('_link'):
                        links += 1
                    if name and (name not in best or d < best[name][0]):
                        best[name] = (d, hw)
        return best, links

    def of(self, name: str, lat: float, lon: float) -> tuple[str, bool, bool] | None:
        """(calle del cruce, es trébol, el nombre del paradero es una calle de
        ese cruce) o None."""
        want = tokens(name)
        if not want:
            return None
        near, links = self._near(lat, lon, TREBOL_M)
        same = lambda n: want <= tokens(n) or tokens(n) <= want
        # ¿El paradero se llama como una calle (la de este cruce u otra que
        # OSM tenga en otra parte)? Si no, es un lugar ("Senati", "Plaza Vea")
        street = any(same(n) for n, (d, _) in near.items() if d <= NEAR_M) \
            or any(want <= t for t in self.street_names if t)
        if links >= LINKS:
            fast = sorted((d, n) for n, (d, hw) in near.items() if hw in FAST and not same(n))
            if fast:
                return short(fast[0][1]), True, street
        close = sorted((d, n) for n, (d, hw) in near.items() if d <= NEAR_M and not same(n) and tokens(n))
        return (short(close[0][1]), False, street) if close else None


def label(name: str, cruce) -> str | None:
    """Cómo se muestra en el buscador: 'Universitaria con Naranjal', 'Trébol
    Caquetá con Evitamiento', 'Habich · trébol con Panamericana Norte',
    'Plaza Norte · Alfredo Mendiola' (el paradero se llama como un lugar)."""
    if not cruce:
        return None
    cross, trebol, street = cruce
    if trebol:
        return f'Trébol {name} con {cross}' if street else f'{name} · trébol con {cross}'
    return f'{name} con {cross}' if street else f'{name} · {cross}'
