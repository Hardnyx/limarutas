"""
Cruce de cada paradero: la calle transversal donde está, para distinguir
paraderos con el mismo nombre en el buscador ("Universitaria con Colonial",
"Universitaria con La Marina", "Trébol Universitaria con Panamericana
Norte"). El nombre del paradero no cambia: en el mapa y en los pasos del
viaje sigue siendo "Universitaria".

Fuente: las calles con nombre de OpenStreetMap (data/raw/osm/Lima.osm.pbf,
pipeline/scripts/osm/descargar_lima.py). El paradero se llama como una de las
dos calles del cruce; la otra, la más cercana a menos de NEAR_M (una avenida
gana a una calle chica que esté hasta MAJOR_BONUS_M más cerca), es el cruce.
Si el paradero no está sobre una calle de su nombre (se llama como la
transversal), el cruce es la calle donde está.

Tipo del cruce:
  - trébol: cerca de una vía rápida, con una rampa en bucle (gira ≥ LOOP_DEG:
    la hoja del trébol) y un puente o un túnel;
  - bypass: una de las dos avenidas pasa en puente o en túnel (paso a
    desnivel) a menos de BYPASS_M;
  - si no, un cruce a nivel.

Los cruces con nombre propio de uso común (Trébol de Javier Prado, Puente
Atocongo, Bypass del Óvalo Monitor…) están en config/cruces_nombres.json:
dos calles que se cruzan, o el nombre de una vía de OSM; el paradero a menos
de su radio lo lleva.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PBF = ROOT / 'data' / 'raw' / 'osm' / 'Lima.osm.pbf'
NOMBRES = ROOT / 'config' / 'cruces_nombres.json'
CALLES = ROOT / 'config' / 'nombres_calles.json'

NEAR_M = 60
MAJOR_BONUS_M = 25
TREBOL_M = 150
BYPASS_M = 120
LOOP_DEG = 200       # una rampa que gira esto o más es la hoja de un trébol
CELL_M = 50
NAMED_R = 350

M_LAT = 110_574
M_LON = 111_320 * math.cos(math.radians(-12.05))

STOPWORDS = {'av', 'avenida', 'jr', 'jiron', 'calle', 'ca', 'psje', 'pasaje', 'prolongacion', 'prol',
             'ovalo', 'de', 'del', 'la', 'las', 'los', 'el', 'y', 'auxiliar', 'carretera', 'via'}
PREFIX = re.compile(r'^(Avenida|Av\.|Jirón|Jr\.|Calle|Pasaje|Prolongación|Carretera|Vía de|Vía|Óvalo|Alameda|Malecón)\s+', re.I)
FAST = {'motorway', 'trunk'}
MAJOR = {'motorway', 'trunk', 'primary', 'secondary'}
ROADS = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
         'living_street', 'service', 'pedestrian', 'motorway_link', 'trunk_link', 'primary_link',
         'secondary_link', 'tertiary_link'}


def _norm(s: str) -> str:
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    s = s.replace('z', 's')                  # 'Garcilazo' y 'Garcilaso' son la misma
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
    out = re.sub(r'^(de|del)\s+', '', out)     # 'Avenida de La Marina' → 'La Marina'
    out = out[:1].upper() + out[1:]          # 'de los Insurgentes' → 'Los Insurgentes'
    return out if len(out) > 2 else name


class Nombres:
    """Cómo se conoce cada calle (config/nombres_calles.json): 'José de la
    Riva Agüero' → 'Riva Agüero', 'Óscar R. Benavides' → 'Colonial' (en su
    tramo). canon() da el nombre que se muestra y los otros con que se busca."""

    def __init__(self):
        self.calles = []
        self.paraderos = {}
        if not CALLES.exists():
            return
        cfg = json.loads(CALLES.read_text(encoding='utf-8'))
        for c in cfg.get('calles', []):
            keys = {tokens(a) for a in c['alias']} | {tokens(c['nombre'])}
            self.calles.append((keys, c['nombre'], c.get('bbox'), c.get('mostrar', True), c['alias']))
        for c in cfg.get('paraderos', []):
            self.paraderos[tokens(c['nombre'])] = c['alias']

    def canon(self, name: str, lat=None, lon=None) -> tuple[str, list]:
        """(nombre que se muestra, otros nombres para buscar). 'Wilson -
        Garcilaso de la Vega': cada parte; si son la misma calle, una."""
        parts = [x.strip() for x in re.split(r'\s+-\s+', name) if x.strip()]
        shown, extra = [], []
        for part in parts:
            sh = short(part)
            t = tokens(sh)
            for keys, nombre, bbox, mostrar, alias in self.calles:
                if t not in keys:
                    continue
                if bbox and lat is not None and not (bbox[0] <= lat <= bbox[2] and bbox[1] <= lon <= bbox[3]):
                    continue
                extra += [a for a in alias + [nombre] if tokens(a) != tokens(nombre if mostrar else sh)]
                if mostrar:
                    extra.append(sh)
                    sh = nombre
                break
            if all(tokens(sh) != tokens(x) for x in shown):
                shown.append(sh)
        extra += self.paraderos.get(tokens(name), [])
        out = ' - '.join(shown) if len(parts) > 1 else (shown[0] if shown and tokens(shown[0]) != tokens(short(name)) else name)
        return out, sorted({e for e in extra if tokens(e) != tokens(out)}, key=str)


def _segd(p, a, b):
    ax, ay = (a[1] - p[1]) * M_LON, (a[0] - p[0]) * M_LAT
    bx, by = (b[1] - p[1]) * M_LON, (b[0] - p[0]) * M_LAT
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / l2))
    return math.hypot(ax + t * dx, ay + t * dy)


def _d(a, b):
    return math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * M_LON)


class Cruces:
    def __init__(self):
        import osmium
        if not PBF.exists():
            raise SystemExit(f'Falta {PBF.relative_to(ROOT)}: python pipeline/scripts/osm/descargar_lima.py')
        self.grid = defaultdict(list)
        self._over_memo = {}
        self.street_names = set()        # tokens de cada nombre de calle de OSM
        by_name = defaultdict(list)      # nombre completo → segmentos (para los nombres propios)
        self.loops = defaultdict(list)
        grid, names, cell, loops = self.grid, self.street_names, self._cell, self.loops

        class H(osmium.SimpleHandler):
            def way(self, w):
                t = w.tags
                hw = t.get('highway')
                if hw not in ROADS:
                    return
                try:
                    pts = [(n.lat, n.lon) for n in w.nodes]
                except osmium.InvalidLocationError:
                    return
                name = t.get('name', '')
                if name:
                    names.add(tokens(name))
                # Paso a desnivel: la vía en puente o en túnel
                sep = (t.get('bridge') not in (None, 'no') or t.get('tunnel') not in (None, 'no', 'building_passage')
                       or t.get('layer', '0') not in ('0', ''))
                if hw.endswith('_link') and len(pts) > 3:
                    # Rampa en bucle (gira ≥ LOOP_DEG): la hoja del trébol
                    turn, prev = 0.0, None
                    for a, b in zip(pts, pts[1:]):
                        h = math.atan2((b[0] - a[0]) * M_LAT, (b[1] - a[1]) * M_LON)
                        if prev is not None:
                            turn += (h - prev + math.pi) % (2 * math.pi) - math.pi
                        prev = h
                    if abs(math.degrees(turn)) >= LOOP_DEG:
                        m = pts[len(pts) // 2]
                        loops[cell(*m)].append(m)
                for a, b in zip(pts, pts[1:]):
                    grid[cell(*a)].append((a, b, name, hw, sep))
                    if name:
                        by_name[name].append((a, b))

        H().apply_file(str(PBF), locations=True)
        self.named = self._named(by_name)
        self.nombres = Nombres()

    @staticmethod
    def _cell(lat, lon):
        return (int(lat * M_LAT // CELL_M), int(lon * M_LON // CELL_M))

    @staticmethod
    def _named(by_name):
        """Cruces con nombre propio: [(nombre, tipo, (lat, lon), radio)]."""
        if not NOMBRES.exists():
            return []
        out = []
        for c in json.loads(NOMBRES.read_text(encoding='utf-8'))['cruces']:
            if 'punto' in c:
                at = tuple(c['punto'])
            elif 'osm' in c:
                segs = by_name.get(c['osm'])
                if not segs:
                    print(f"  cruces_nombres: sin vía '{c['osm']}' en OSM")
                    continue
                pts = [p for s in segs for p in s]
                at = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
            else:
                a, b = (by_name.get(n, []) for n in c['calles'])
                if not a or not b:
                    print(f"  cruces_nombres: sin {c['calles']} en OSM")
                    continue
                # Donde las dos calles pasan más cerca (puntos de cada una)
                pa = [p for s in a for p in s]
                pb = [p for s in b for p in s]
                best = None
                gb = defaultdict(list)
                for p in pb:
                    gb[(round(p[0], 2), round(p[1], 2))].append(p)
                for p in pa:
                    for di in (-0.01, 0, 0.01):
                        for dj in (-0.01, 0, 0.01):
                            for q in gb.get((round(p[0] + di, 2), round(p[1] + dj, 2)), ()):
                                d = _d(p, q)
                                if best is None or d < best[0]:
                                    best = (d, ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2))
                if best is None or best[0] > 100:
                    print(f"  cruces_nombres: {c['calles']} no se cruzan")
                    continue
                at = best[1]
            out.append((c['nombre'], c.get('tipo'), at, c.get('radio', NAMED_R)))
        return out

    def _near(self, lat, lon, radius):
        ci, cj = self._cell(lat, lon)
        r = int(radius // CELL_M) + 1
        best, links, seps = {}, 0, []
        for di in range(-r, r + 1):
            for dj in range(-r, r + 1):
                for a, b, name, hw, sep in self.grid.get((ci + di, cj + dj), ()):
                    d = _segd((lat, lon), a, b)
                    if d > radius:
                        continue
                    if hw.endswith('_link'):
                        links += 1
                    if sep and (hw in MAJOR or hw == 'tertiary') and d <= BYPASS_M and self._over(a, b, name):
                        seps.append((d, name, hw))
                    if name and not hw.endswith('_link') and (name not in best or d < best[name][0]):
                        best[name] = (d, hw)
        return best, links, seps

    def _over(self, a, b, name):
        """¿El tramo a-b (en puente o túnel) pasa sobre o bajo otra calle?
        (Un puente sobre el río no es un paso a desnivel)"""
        k = (a, b)
        if k not in self._over_memo:
            self._over_memo[k] = self._over_calc(a, b, name)
        return self._over_memo[k]

    def _over_calc(self, a, b, name):
        def cross(p1, p2, q1, q2):
            o = lambda u, v, w: (v[1] - u[1]) * (w[0] - u[0]) - (v[0] - u[0]) * (w[1] - u[1])
            return o(p1, p2, q1) * o(p1, p2, q2) < 0 and o(q1, q2, p1) * o(q1, q2, p2) < 0
        cells = {self._cell(*a), self._cell(*b), self._cell((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)}
        for ci, cj in cells:
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    for q1, q2, n2, hw2, sep2 in self.grid.get((ci + di, cj + dj), ()):
                        if not sep2 and n2 != name and hw2 in ROADS and hw2 != 'service' and cross(a, b, q1, q2):
                            return True
        return False

    def of(self, name: str, lat: float, lon: float) -> dict | None:
        """{'paradero' (el nombre como se muestra: 'Riva Agüero'), 'cruce',
        'tipo' ('trebol' | 'bypass' | None), 'calle' (el nombre del paradero es
        una calle de ese cruce), 'nombre' (propio, o None), 'alias' (otros
        nombres para buscar)} o None."""
        want = tokens(name)
        if not want:
            return None
        canon = lambda n: self.nombres.canon(n, lat, lon)
        shown, alias = canon(name)
        cwant = tokens(shown)
        near, links, seps = self._near(lat, lon, TREBOL_M)
        ci, cj = self._cell(lat, lon)
        r = int(TREBOL_M // CELL_M) + 1
        loops = sum(1 for di in range(-r, r + 1) for dj in range(-r, r + 1)
                    for m in self.loops.get((ci + di, cj + dj), ()) if _d(m, (lat, lon)) <= TREBOL_M)
        # La misma calle, también con otro de sus nombres ('Colonial' y 'Óscar
        # Raimundo Benavides' no son un cruce)
        same = lambda n: (want <= tokens(n) or tokens(n) <= want
                          or bool(tokens(n)) and tokens(canon(short(n))[0]) == cwant)
        # ¿El paradero se llama como una calle (la de este cruce u otra que
        # OSM tenga en otra parte)? Si no, es un lugar ("Senati", "Plaza Vea")
        street = any(same(n) for n, (d, _) in near.items() if d <= NEAR_M) \
            or any(want <= t for t in self.street_names if t)
        proper, ptype = None, None
        for nm, tp, at, radius in self.named:
            if _d(at, (lat, lon)) <= radius:
                proper, ptype = nm, tp
                break
        fast_near = any(hw in FAST and d <= TREBOL_M for n, (d, hw) in near.items())
        kind = None
        if loops and fast_near and seps:
            kind = 'trebol'
        elif seps:
            kind = 'bypass'
        if ptype:
            kind = ptype

        def out(cross, kind):
            if cross is None:
                return {'paradero': shown, 'cruce': None, 'tipo': None, 'calle': street,
                        'nombre': proper, 'alias': alias} if proper or alias else None
            cshown, calias = canon(short(cross))
            return {'paradero': shown, 'cruce': cshown, 'tipo': kind, 'calle': street,
                    'nombre': proper, 'alias': sorted(set(alias) | set(calias))}

        if kind == 'trebol':
            # La otra vía del trébol: la principal más cercana que no sea la suya
            fast = sorted((d, n) for n, (d, hw) in near.items() if hw in MAJOR and not same(n) and tokens(n))
            if fast:
                return out(fast[0][1], kind)
            kind = None
        # Una avenida gana a una calle chica que esté un poco más cerca
        close = sorted((d - (MAJOR_BONUS_M if hw in MAJOR else 0), d, n)
                       for n, (d, hw) in near.items() if d <= NEAR_M and not same(n) and tokens(n))
        if not close:
            return out(None, None)
        cross = close[0][2]
        if kind == 'bypass':
            # Bypass solo si el puente o el túnel es de una de las dos calles
            # del cruce (o de una sin nombre: la rampa del paso a desnivel)
            if not ptype and not any(not n or same(n) or n == cross for _, n, _ in seps):
                kind = None
        return out(cross, kind)


_WORD = {'trebol': 'Trébol', 'bypass': 'Bypass'}


def label(name: str, cruce) -> str | None:
    """Cómo se muestra en el buscador: 'Universitaria con Naranjal', 'Trébol
    Caquetá con Evitamiento', 'Bypass Javier Prado con Aviación', 'Habich ·
    trébol con Panamericana Norte', 'Plaza Norte · Alfredo Mendiola' (el
    paradero se llama como un lugar)."""
    if not cruce:
        return None
    shown = cruce.get('paradero') or name
    if not cruce.get('cruce'):
        return shown if shown != name else None     # 'Garcilaso' → 'Wilson'
    name = shown
    cross, kind, street = cruce['cruce'], cruce['tipo'], cruce['calle']
    word = _WORD.get(kind)
    if street:
        return f'{word} {name} con {cross}' if word else f'{name} con {cross}'
    return f'{name} · {word.lower()} con {cross}' if word else f'{name} · {cross}'


def swapped(name: str, cruce) -> str | None:
    """El mismo cruce empezando por la otra calle, para quien busca esa:
    'Brasil con Javier Prado' → 'Javier Prado con Brasil'. Solo si el
    paradero se llama como una calle."""
    if not cruce or not cruce.get('cruce') or not cruce['calle']:
        return None
    name = cruce.get('paradero') or name
    word = _WORD.get(cruce['tipo'])
    return f"{word} {cruce['cruce']} con {name}" if word else f"{cruce['cruce']} con {name}"


def search_alias(cruce) -> str | None:
    """Otros nombres con que se busca: el nombre propio del cruce y los
    oficiales o populares de sus calles."""
    if not cruce:
        return None
    extra = ([cruce['nombre']] if cruce.get('nombre') else []) + list(cruce.get('alias') or [])
    return ' · '.join(extra) or None
