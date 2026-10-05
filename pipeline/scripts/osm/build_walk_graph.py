"""
Red peatonal de Lima para dibujar los tramos a pie del viaje
(assets/js/walkRoute.js), desde data/raw/osm/Lima.osm.pbf
(pipeline/scripts/osm/descargar_lima.py).

Se camina por veredas, cruces, escaleras, puentes peatonales, pasajes y por
las calles (en Lima muchas no tienen la vereda mapeada aparte). No se camina:

  - por la vía exclusiva del Metropolitano ni por las autopistas y vías
    expresas (salvo foot=yes), ni donde OSM dice foot=no (una avenida con sus
    veredas mapeadas aparte: se va por las veredas);
  - por las ciclovías (en Villa El Salvador van por el medio de la pista),
    salvo que también sean peatonales (foot=yes/designated);
  - por dentro de las estaciones: andenes, y los pasillos y escaleras que
    bajan a la vía del Metropolitano (a menos de STATION_M de ella, que no sean
    un cruce ni un puente). Pasar por una estación es entrar a la zona paga.

El grafo se guarda en cuadrículas de TILE grados (data/processed/caminata/),
para que el navegador cargue solo las de la zona del tramo a pie. Los nodos
son los cruces y extremos de las vías; cada arista guarda su forma.

    python pipeline/scripts/osm/build_walk_graph.py
"""

from __future__ import annotations

import json
import math
import shutil
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PBF = ROOT / 'data' / 'raw' / 'osm' / 'Lima.osm.pbf'
OUT = ROOT / 'data' / 'processed' / 'caminata'

TILE = 0.02            # grados (~2,2 km)
Q = 100_000            # coordenadas en enteros de 1e-5 grados (~1 m)
ISLAND_M = 20_000     # componentes sueltos más chicos que esto (metros de vía): fuera
STATION_M = 20         # pasillos a menos de esto de la vía del Metropolitano: dentro de la estación

# Cuánto "cuesta" cada metro (se prefieren las veredas y calles tranquilas)
COST = {
    'footway': 1.0, 'pedestrian': 1.0, 'path': 1.0, 'living_street': 1.0, 'steps': 1.3,
    'corridor': 1.0, 'track': 1.1, 'residential': 1.0, 'unclassified': 1.0, 'service': 1.05,
    'tertiary': 1.1, 'secondary': 1.15, 'primary': 1.2,
    'tertiary_link': 1.15, 'secondary_link': 1.2, 'primary_link': 1.25,
    'trunk': 1.4, 'trunk_link': 1.4,
    'crossing': 1.5,           # cruce del separador sin cruce mapeado
}
MEDIAN_M = 30
PARALLEL = math.radians(20)
DANGLE_M = 12
JOIN_M = 20
FAST = {'motorway', 'motorway_link', 'trunk', 'trunk_link'}
PEDESTRIAN = {'footway', 'path', 'steps', 'pedestrian', 'corridor'}
FOOT_OK = {'yes', 'designated', 'permissive'}

M_LAT = 110_574
M_LON = 111_320 * math.cos(math.radians(-12.05))


def _d(a, b):
    return math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * M_LON)


def simplify(pts, tol_m=1.5):
    """Douglas-Peucker: los puntos en línea recta sobran."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        (ay, ax), (by, bx) = pts[i], pts[j]
        ax, ay, bx, by = ax * M_LON, ay * M_LAT, bx * M_LON, by * M_LAT
        ab = math.hypot(bx - ax, by - ay)
        best, bk = 0.0, None
        for k in range(i + 1, j):
            px, py = pts[k][1] * M_LON, pts[k][0] * M_LAT
            dd = math.hypot(px - ax, py - ay) if ab == 0 else abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / ab
            if dd > best:
                best, bk = dd, k
        if bk is not None and best > tol_m:
            keep[bk] = True
            stack += [(i, bk), (bk, j)]
    return [p for p, k in zip(pts, keep) if k]


def walkable(t) -> str | None:
    """Tipo de vía para caminar o None."""
    hw = t.get('highway')
    foot = t.get('foot')
    if t.get('area') == 'yes' and hw != 'pedestrian':
        return None
    if t.get('public_transport') == 'platform' or t.get('railway') == 'platform' or hw == 'platform':
        return None
    if foot == 'no' or t.get('access') in ('no', 'private') and foot not in FOOT_OK:
        return None
    if hw == 'cycleway' or hw == 'path' and t.get('bicycle') == 'designated':
        return 'footway' if foot in FOOT_OK else None
    if hw in FAST:
        if foot in FOOT_OK:
            return 'footway' if hw.startswith('motorway') else hw
        if hw.startswith('motorway') or t.get('sidewalk') == 'no':
            return None
        return hw
    if hw == 'busway' or hw == 'service' and t.get('bus') == 'designated' and foot not in FOOT_OK:
        return None
    return hw if hw in COST else None


def main() -> None:
    import osmium
    if not PBF.exists():
        raise SystemExit(f'Falta {PBF.relative_to(ROOT)}: python pipeline/scripts/osm/descargar_lima.py')

    ways = []            # (tipo, [(id, lat, lon)], cerca del Metropolitano posible)
    busway = []          # tramos de la vía del Metropolitano

    class H(osmium.SimpleHandler):
        def way(self, w):
            t = w.tags
            hw = t.get('highway')
            if not hw:
                return
            try:
                pts = [(n.ref, n.lat, n.lon) for n in w.nodes]
            except osmium.InvalidLocationError:
                return
            if hw == 'busway' or hw == 'service' and t.get('bus') == 'designated':
                busway.extend(zip(pts, pts[1:]))
                return
            kind = walkable(t)
            if not kind:
                return
            # Pasillo o escalera de estación (se decide al final, cerca de la vía)
            inner = hw in PEDESTRIAN and t.get('footway') != 'crossing' and t.get('bridge') != 'yes'
            graded = not any(k in t for k in ('bridge', 'tunnel')) and t.get('layer', '0') == '0'
            ways.append((kind, pts, inner, None, graded))

    H().apply_file(str(PBF), locations=True)

    # Vía del Metropolitano por celdas, para saber qué pasillos están en una estación
    CELL = 50
    cell = lambda la, lo: (int(la * M_LAT // CELL), int(lo * M_LON // CELL))
    grid = defaultdict(list)
    for (_, la, lo), (_, lb, lob) in busway:
        for k in range(int(_d((la, lo), (lb, lob)) // 10) + 1):
            f = k / max(1, int(_d((la, lo), (lb, lob)) // 10))
            p = (la + (lb - la) * f, lo + (lob - lo) * f)
            grid[cell(*p)].append(p)

    def in_station(pts):
        for _, la, lo in pts:
            ci, cj = cell(la, lo)
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    if any(_d((la, lo), q) <= STATION_M for q in grid.get((ci + di, cj + dj), ())):
                        return True
        return False

    kept = [(k, pts, c) for k, pts, inner, c, _ in ways if not (inner and in_station(pts))]
    graded = [g for k, pts, inner, c, g in ways if not (inner and in_station(pts))]
    dropped = len(ways) - len(kept)
    MCELL = 50
    mcell = lambda la, lo: (int(la * M_LAT // MCELL), int(lo * M_LON // MCELL))

    def count_uses():
        u = defaultdict(int)
        for _, pts, _ in kept:
            for i, (nid, _, _) in enumerate(pts):
                u[nid] += 2 if i in (0, len(pts) - 1) else 1
        return u

    # Esquinas sueltas: en OSM una esquina solo toca las calles que llegan a
    # ella. La vereda mapeada aparte pasa a unos metros sin tocarla; la otra
    # calzada de una avenida, o la calle auxiliar de al lado, tampoco. Cada
    # esquina (a nivel) se une con un punto nuevo a la vereda más cercana
    # (hasta JOIN_M) y a la calle más cercana que no sea la suya (hasta
    # MEDIAN_M); nunca por encima de la vía del Metropolitano ni a una vía rápida
    uses = count_uses()
    road = lambda w: kept[w][0] not in PEDESTRIAN and kept[w][0] not in FAST and graded[w]
    walkway = lambda w: kept[w][0] in PEDESTRIAN and graded[w]

    def seg_grid(pred):
        g = defaultdict(list)            # celda → [(vía, i)]
        for w, (_, pts, _) in enumerate(kept):
            if pred(w):
                for i in range(len(pts) - 1):
                    (_, la, lo), (_, lb, lob) = pts[i], pts[i + 1]
                    n = max(1, int(_d((la, lo), (lb, lob)) // 25))
                    for c in {mcell(la + (lb - la) * k / n, lo + (lob - lo) * k / n) for k in range(n + 1)}:
                        g[c].append((w, i))
        return g

    def bearing(a, b):
        return math.atan2((b[1] - a[1]) * M_LAT, (b[2] - a[2]) * M_LON)

    def parallel(h1, h2):
        d = abs(h1 - h2) % math.pi
        return min(d, math.pi - d) <= PARALLEL

    def nearest(grid, nid, la, lo, maxd, heading=None):
        ci, cj = mcell(la, lo)
        best, touching = None, set()
        cand = [x for di in (-1, 0, 1) for dj in (-1, 0, 1) for x in grid.get((ci + di, cj + dj), ())]
        for w2, i in cand:                   # las vías que ya pasan por la esquina, no
            if nid in (kept[w2][1][i][0], kept[w2][1][i + 1][0]):
                touching.add(w2)
        for w2, i in cand:
            if w2 in touching:
                continue
            a, b = kept[w2][1][i], kept[w2][1][i + 1]
            ax, ay = (a[2] - lo) * M_LON, (a[1] - la) * M_LAT
            bx, by = (b[2] - lo) * M_LON, (b[1] - la) * M_LAT
            dx, dy = bx - ax, by - ay
            l2 = dx * dx + dy * dy
            f = 0.0 if l2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / l2))
            d = math.hypot(ax + f * dx, ay + f * dy)
            if heading is not None and not parallel(heading, bearing(a, b)):
                continue
            if 1 <= d <= maxd and (best is None or d < best[0]):
                best = (d, w2, i, f, (a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f))
        return best

    walk_grid, road_grid = seg_grid(walkway), seg_grid(road)
    joins, inserts, fake = [], defaultdict(list), -1
    for w, (_, pts, _) in enumerate(kept):
        if not road(w):
            continue
        for j, (nid, la, lo) in enumerate(pts):
            if uses[nid] < 3:                # solo esquinas
                continue
            # La otra calzada o la auxiliar: paralela a esta
            h = bearing(pts[max(0, j - 1)], pts[min(len(pts) - 1, j + 1)])
            for grid, maxd, hd in ((walk_grid, JOIN_M, None), (road_grid, MEDIAN_M, h)):
                best = nearest(grid, nid, la, lo, maxd, hd)
                if not best:
                    continue
                d, w2, i, f, q = best
                mid = ((la + q[0]) / 2, (lo + q[1]) / 2)
                if in_station([(None, *q), (None, *mid)]):
                    continue
                inserts[w2].append((i, f, fake, q))
                joins.append((d, [(nid, la, lo), (fake, *q)]))
                fake -= 1
    for w2, ins in inserts.items():
        kind, pts, c = kept[w2]
        by_i = defaultdict(list)
        for i, f, nid, q in ins:
            by_i[i].append((f, nid, q))
        out = []
        for i, pnt in enumerate(pts):
            out.append(pnt)
            out += [(nid, *q) for f, nid, q in sorted(by_i.get(i, ()))]
        kept[w2] = (kind, out, c)
    uses = count_uses()
    links = {(min(a[0], b[0]), max(a[0], b[0])): (d, [a, b]) for d, (a, b) in joins}

    # Veredas que terminan sueltas a unos metros de la esquina (frecuente en
    # Lima): se unen al nodo más cercano de otra vía, hasta DANGLE_M
    allpts = defaultdict(list)
    for w, (_, pts, _) in enumerate(kept):
        for nid, la, lo in pts:
            allpts[mcell(la, lo)].append((nid, la, lo, w))
    dangles = 0
    for w, (kind, pts, _) in enumerate(kept):
        if kind not in PEDESTRIAN:
            continue
        for nid, la, lo in (pts[0], pts[-1]):
            if uses[nid] != 2:           # extremo de una sola vía
                continue
            ci, cj = mcell(la, lo)
            best = None
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    for o, lb, lob, w2 in allpts.get((ci + di, cj + dj), ()):
                        if w2 == w or o == nid:
                            continue
                        d = _d((la, lo), (lb, lob))
                        if d <= DANGLE_M and (best is None or d < best[0]):
                            best = (d, o, lb, lob)
            if best and not in_station([(None, best[2], best[3])]):
                d, o, lb, lob = best
                links[min(nid, o), max(nid, o)] = (d, [(nid, la, lo), (o, lb, lob)])
                dangles += 1
    for _, seg in links.values():
        for nid, _, _ in seg:
            uses[nid] += 2
    # Aristas entre nodos, con su forma
    edges = {}
    for kind, pts in [(k, p) for k, p, _ in kept] + [('crossing', seg) for _, seg in links.values()]:
        start = 0
        for i in range(1, len(pts)):
            if i == len(pts) - 1 or uses[pts[i][0]] > 1:
                seg = pts[start:i + 1]
                a, b = seg[0][0], seg[-1][0]
                if a != b:
                    geom = [(round(la * Q), round(lo * Q)) for la, lo in simplify([(la, lo) for _, la, lo in seg])]
                    m = sum(_d((x[1], x[2]), (y[1], y[2])) for x, y in zip(seg, seg[1:]))
                    key = (min(a, b), max(a, b), geom[len(geom) // 2])
                    c = m * COST[kind]
                    if key not in edges or edges[key][0] > c:
                        edges[key] = (c, geom)
                start = i

    # Islas: veredas de un parque o un condominio que OSM no une a la calle.
    # Fuera las de menos de ISLAND_M: si no, el tramo a pie empieza en una de
    # ellas y no tiene por dónde salir
    parent = {}

    def find(x):
        while parent.get(x, x) != x:
            parent[x] = parent.get(parent[x], parent[x])
            x = parent[x]
        return x
    for a, b, _ in edges:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    size = defaultdict(float)
    for (a, _, _), (c, _) in edges.items():
        size[find(a)] += c
    before = len(edges)
    edges = {k: v for k, v in edges.items() if size[find(k[0])] >= ISLAND_M}
    islands = before - len(edges)

    # Cuadrículas: cada arista va en la de cada uno de sus extremos
    tiles = defaultdict(list)
    tkey = lambda q: (math.floor(q[0] / Q / TILE), math.floor(q[1] / Q / TILE))
    for c, geom in edges.values():
        for t in {tkey(geom[0]), tkey(geom[-1])}:
            tiles[t].append((c, geom))

    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / 't').mkdir(parents=True)
    total = 0
    for (ti, tj), es in tiles.items():
        # Forma en deltas desde el primer punto: [costo en dm, lat0, lon0, dlat1, dlon1, ...]
        rows = []
        for c, geom in es:
            row = [round(c * 10), geom[0][0], geom[0][1]]
            for p, q in zip(geom, geom[1:]):
                row += [q[0] - p[0], q[1] - p[1]]
            rows.append(row)
        body = json.dumps(rows, separators=(',', ':'))
        (OUT / 't' / f'{ti}_{tj}.json').write_text(body, encoding='utf-8')
        total += len(body)
    meta = {
        'tile': TILE, 'q': Q, 'fuente': 'OpenStreetMap (BBBike Lima.osm.pbf)',
        'tiles': sorted(f'{ti}_{tj}' for ti, tj in tiles),
    }
    (OUT / 'meta.json').write_text(json.dumps(meta, separators=(',', ':')), encoding='utf-8')
    print(f'{len(joins)} esquinas unidas a su vereda o a la calle de al lado · {dangles} veredas sueltas unidas · {len(kept)} vías para caminar ({dropped} pasillos y escaleras de estación fuera) · '
          f'{len(edges)} aristas ({islands} en islas sueltas, fuera) · {len(tiles)} cuadrículas · {total / 1e6:.1f} MB · {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
