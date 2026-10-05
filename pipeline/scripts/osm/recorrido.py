"""
Recorrido de una ruta por la red de calles de OpenStreetMap (red_vial.Red,
data/raw/osm/Lima.osm.pbf), a partir de su dibujo.

El dibujo (Wikiroutes, OSM, un mapa QR) solo dice por dónde va la ruta: cada
punto se pega a un tramo de calle cercano y entre puntos seguidos se exige un
camino por la red (map matching, HMM / Viterbi). El resultado es la
secuencia de nodos de OSM por la que pasa, y de ella sale:

  - la geometría: los nodos unidos, la misma que dibuja el mapa de fondo
    (entra a los óvalos por el anillo, sigue la curva de la avenida);
  - los pasos: "por Av. X 420 m, a la derecha en Av. Y, en el óvalo toma la
    2.ª salida…", que sirven para leer y corregir la ruta.

Para pegar un dibujo a la calle no se mira el sentido de circulación (el bus
va por ahí: carril en contraflujo, o el sentido de OSM no es el de hoy).
Donde no hay calle a menos de CAND_M, o dos puntos seguidos solo se unen con
un rodeo de más de DETOUR_K veces la recta (+ DETOUR_M) —una vía nueva, un
carril exclusivo, una calle que falta en OSM—, se deja el dibujo original y
ese tramo queda marcado.
"""

from __future__ import annotations

import heapq
import math
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'metropolitano'))
from red_vial import Red, _d, simplify  # noqa: E402

STEP_M = 25            # un punto del dibujo cada esto
CAND_M = 35            # tramos de calle candidatos hasta esto del punto
MAX_CAND = 6
SIGMA = 10.0           # qué tan lejos de la calle suele estar el dibujo
BETA = 25.0            # diferencia aceptable entre el camino y la recta
DETOUR_K, DETOUR_M = 2.0, 60
SHORT_M = 25           # un paso más corto que esto se junta con el siguiente
CELL = 50

M_LAT = 110_574
M_LON = 111_320 * math.cos(math.radians(-12.0))
cell = lambda la, lo: (int(la * M_LAT // CELL), int(lo * M_LON // CELL))


def resample(line, step=STEP_M):
    out = [tuple(line[0])]
    acc = 0.0
    for a, b in zip(line, line[1:]):
        d = _d(a, b)
        if d == 0:
            continue
        t = step - acc
        while t <= d:
            f = t / d
            out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
            t += step
        acc = (acc + d) % step
    if out[-1] != tuple(line[-1]):
        out.append(tuple(line[-1]))
    return out


def _heading(a, b):
    return math.atan2((b[0] - a[0]) * M_LAT, (b[1] - a[1]) * M_LON)


class Recorridos:
    def __init__(self, bbox):
        self.red = red = Red(bbox)
        self.pos = red.pos
        # Sin sentido de circulación (ver arriba)
        self.adj = defaultdict(set)
        for u, outs in red.adj.items():
            for v, _w in outs:
                self.adj[u].add(v)
                self.adj[v].add(u)
        self.edges = []
        self.grid = defaultdict(list)
        seen = set()
        for u, outs in red.adj.items():
            for v, _w in outs:
                if (v, u) in seen:
                    continue
                seen.add((u, v))
                a, b = self.pos[u], self.pos[v]
                i = len(self.edges)
                self.edges.append((u, v, _d(a, b)))
                n = max(1, int(_d(a, b) // 25))
                for c in {cell(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n + 1)}:
                    self.grid[c].append(i)

    # ---------- de qué vía es un tramo ----------
    def way(self, u, v):
        return self.red.way.get((u, v)) or self.red.way.get((v, u)) or (None, '', False)

    # ---------- candidatas y caminos ----------
    def candidates(self, p):
        ci, cj = cell(*p)
        seen, out = set(), []
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for i in self.grid.get((ci + di, cj + dj), ()):
                    if i in seen:
                        continue
                    seen.add(i)
                    u, v, L = self.edges[i]
                    a, b = self.pos[u], self.pos[v]
                    ax, ay = (a[1] - p[1]) * M_LON, (a[0] - p[0]) * M_LAT
                    bx, by = (b[1] - p[1]) * M_LON, (b[0] - p[0]) * M_LAT
                    dx, dy = bx - ax, by - ay
                    l2 = dx * dx + dy * dy
                    t = 0.0 if l2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / l2))
                    d = math.hypot(ax + t * dx, ay + t * dy)
                    if d <= CAND_M:
                        out.append((d, i, t))
        out.sort()
        return out[:MAX_CAND]

    def dists_from(self, node, limit):
        dist = {node: 0.0}
        heap = [(0.0, node)]
        while heap:
            g, u = heapq.heappop(heap)
            if g > dist[u] or g > limit:
                continue
            for v in self.adj.get(u, ()):
                ng = g + _d(self.pos[u], self.pos[v])
                if ng < dist.get(v, math.inf):
                    dist[v] = ng
                    heapq.heappush(heap, (ng, v))
        return dist

    def path(self, a, b, limit=2500):
        """Nodos del camino más corto de a a b (incluidos), o None."""
        if a == b:
            return [a]
        dist, prev = {a: 0.0}, {}
        heap = [(0.0, a)]
        while heap:
            g, u = heapq.heappop(heap)
            if u == b:
                break
            if g > dist[u] or g > limit:
                continue
            for v in self.adj.get(u, ()):
                ng = g + _d(self.pos[u], self.pos[v])
                if ng < dist.get(v, math.inf):
                    dist[v], prev[v] = ng, u
                    heapq.heappush(heap, (ng, v))
        if b not in dist:
            return None
        out = [b]
        while out[-1] != a:
            out.append(prev[out[-1]])
        return out[::-1]

    # ---------- Viterbi ----------
    def _trans(self, pts, layers, a, b, ja, cache):
        dg = _d(pts[a], pts[b])
        limit = DETOUR_K * dg + DETOUR_M + 50
        _, ia, ta = layers[a][ja]
        ua, va, La = self.edges[ia]
        out = {}
        for jb, (db, ib, tb) in enumerate(layers[b]):
            ub, vb, Lb = self.edges[ib]
            if ia == ib:
                dn = abs(tb - ta) * La
            else:
                if ja not in cache:
                    cache[ja] = (self.dists_from(va, limit), self.dists_from(ua, limit))
                dv, du = cache[ja]
                opts = []
                for base, dd in ((La * (1 - ta), dv), (La * ta, du)):
                    for n, rest in ((ub, Lb * tb), (vb, Lb * (1 - tb))):
                        if n in dd:
                            opts.append(base + dd[n] + rest)
                if not opts:
                    continue
                dn = min(opts)
            if dn > DETOUR_K * dg + DETOUR_M:
                continue
            out[jb] = abs(dn - dg) / BETA + db / SIGMA
        return out

    def _viterbi(self, pts, layers, seg):
        runs = []
        score = {j: d / SIGMA for j, (d, i, t) in enumerate(layers[seg[0]])}
        back, start = [], 0

        def close(end, score):
            j = min(score, key=score.get)
            chosen = [(seg[end], j)]
            for idx in range(end, start, -1):
                j = back[idx - start - 1][j]
                chosen.append((seg[idx - 1], j))
            runs.append(chosen[::-1])

        for n in range(1, len(seg)):
            a, b = seg[n - 1], seg[n]
            cache, new, bp = {}, {}, {}
            for ja, sa in score.items():
                for jb, c in self._trans(pts, layers, a, b, ja, cache).items():
                    if sa + c < new.get(jb, math.inf):
                        new[jb], bp[jb] = sa + c, ja
            if not new:
                close(n - 1, score)
                start, back = n, []
                score = {j: d / SIGMA for j, (d, i, t) in enumerate(layers[b])}
                continue
            back.append(bp)
            score = new
        close(len(seg) - 1, score)
        return runs

    # ---------- de los puntos pegados a los nodos ----------
    def _point(self, layers, k, j):
        _, i, t = layers[k][j]
        u, v, _L = self.edges[i]
        a, b = self.pos[u], self.pos[v]
        return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

    def _link(self, layers, ka, ja, kb, jb):
        """Nodos entre dos puntos pegados en tramos distintos: sale del tramo a
        por uno de sus extremos y entra al b por uno de los suyos."""
        _, ia, ta = layers[ka][ja]
        _, ib, tb = layers[kb][jb]
        ua, va, La = self.edges[ia]
        ub, vb, Lb = self.edges[ib]
        best = None
        for x, cx in ((va, La * (1 - ta)), (ua, La * ta)):
            for y, cy in ((ub, Lb * tb), (vb, Lb * (1 - tb))):
                p = self.path(x, y)
                if p:
                    L = cx + cy + sum(_d(self.pos[q], self.pos[r]) for q, r in zip(p, p[1:]))
                    if best is None or L < best[0]:
                        best = (L, p)
        return best[1] if best else None

    def match(self, line):
        """{'tramos': [{'nodos': [...], 'desde': p, 'hasta': q}, ...],
            'sueltos': [[puntos del dibujo entre tramos], ...]}"""
        line = [tuple(p) for p in line]
        pts = resample(line)
        layers = [self.candidates(p) for p in pts]
        runs, seg = [], []
        for k, cands in enumerate(layers):
            if cands:
                seg.append(k)
            elif seg:
                runs += self._viterbi(pts, layers, seg)
                seg = []
        if seg:
            runs += self._viterbi(pts, layers, seg)

        tramos, sueltos, prev_k = [], [], None
        for run in runs:
            if prev_k is not None:
                sueltos.append([list(p) for p in pts[prev_k:run[0][0] + 1]])
            nodes = []
            for (ka, ja), (kb, jb) in zip(run, run[1:]):
                if layers[ka][ja][1] == layers[kb][jb][1]:
                    continue
                link = self._link(layers, ka, ja, kb, jb)
                if link:
                    nodes += link if not nodes or nodes[-1] != link[0] else link[1:]
            tramos.append({'nodos': nodes, 'desde': self._point(layers, *run[0]),
                           'hasta': self._point(layers, *run[-1])})
            prev_k = run[-1][0]
        return {'tramos': tramos, 'sueltos': sueltos}

    def join(self, a, b):
        """Puntos por la red de a a b (sin a ni b): para cerrar un circuito
        cuyos extremos no coinciden (sin cortar una manzana o un óvalo)."""
        def node(p):
            c = self.candidates(p)
            if not c:
                return None
            u, v, _L = self.edges[c[0][1]]
            return u if _d(self.pos[u], p) <= _d(self.pos[v], p) else v
        x, y = node(a), node(b)
        if x is None or y is None:
            return []
        nodes = self.path(x, y) or []
        return [self.pos[n] for n in nodes]

    # ---------- geometría y pasos ----------
    def geometry(self, rec):
        out = []
        for n, t in enumerate(rec['tramos']):
            if n and n - 1 < len(rec['sueltos']):
                out += [tuple(p) for p in rec['sueltos'][n - 1]]
            out.append(t['desde'])
            out += [self.pos[x] for x in t['nodos']]
            out.append(t['hasta'])
        return [[round(la, 6), round(lo, 6)] for la, lo in simplify(out)]

    def steps(self, rec):
        """Pasos de cada tramo pegado a la red: [{'accion', 'via', 'm', 'salida'?}]."""
        out = []
        for t in rec['tramos']:
            nodes = t['nodos']
            if len(nodes) < 2:
                continue
            # Tramos de la misma vía (por nombre) o de la misma rotonda, juntos
            groups = []
            for a, b in zip(nodes, nodes[1:]):
                wid, name, rb = self.way(a, b)
                key = ('rotonda', None) if rb else ('via', name)
                if groups and groups[-1]['key'] == key:
                    groups[-1]['nodes'].append(b)
                else:
                    groups.append({'key': key, 'name': name, 'nodes': [a, b], 'rb': rb})
            for n, g in enumerate(groups):
                m = round(sum(_d(self.pos[a], self.pos[b]) for a, b in zip(g['nodes'], g['nodes'][1:])))
                if g['rb']:
                    # Salidas que se pasan: nodos de la rotonda con otra calle
                    exits = sum(1 for x in g['nodes'][1:-1]
                                if any(not self.way(x, y)[2] for y in self.adj[x]))
                    nxt = groups[n + 1]['name'] if n + 1 < len(groups) else ''
                    out.append({'accion': 'rotonda', 'salida': exits + 1, 'via': nxt, 'm': m})
                    continue
                if out and out[-1]['accion'] == 'rotonda':
                    out.append({'accion': 'sigue', 'via': g['name'], 'm': m})
                    continue
                if not out:
                    out.append({'accion': 'inicio', 'via': g['name'], 'm': m})
                    continue
                prev = groups[n - 1]['nodes']
                h1 = _heading(self.pos[prev[max(0, len(prev) - 3)]], self.pos[prev[-1]])
                h2 = _heading(self.pos[g['nodes'][0]], self.pos[g['nodes'][min(2, len(g['nodes']) - 1)]])
                turn = math.degrees((h2 - h1 + math.pi) % (2 * math.pi) - math.pi)
                accion = ('sigue' if abs(turn) < 30 else 'vuelta' if abs(turn) > 150
                          else 'izquierda' if turn > 0 else 'derecha')
                # Mismo nombre tras un tramo sin nombre: se junta
                if accion == 'sigue' and out[-1]['via'] == g['name']:
                    out[-1]['m'] += m
                    continue
                out.append({'accion': accion, 'via': g['name'], 'm': m})
        # Tramos cortos sin nombre (una oreja, un enlace) y los de menos de
        # SHORT_M (el cruce de una calle de dos calzadas) se funden con el siguiente
        merged = []
        for s in out:
            last = merged[-1] if merged else None
            if last and last['accion'] != 'rotonda' and len(merged) > 1 and (
                    last['m'] < SHORT_M or (not last['via'] and last['m'] < 60)):
                s = {**s, 'm': s['m'] + merged.pop()['m']}
            if merged and s['accion'] == 'sigue' and merged[-1]['via'] == s['via'] and merged[-1]['accion'] != 'rotonda':
                merged[-1] = {**merged[-1], 'm': merged[-1]['m'] + s['m']}
                continue
            merged.append(s)
        return merged


def texto(step):
    via = step['via'] or 'una calle sin nombre'
    a = step['accion']
    if a == 'inicio':
        return f"Por {via} · {step['m']} m"
    if a == 'rotonda':
        return f"En el óvalo, toma la {step['salida']}.ª salida" + (f" hacia {step['via']}" if step['via'] else '')
    verb = {'sigue': 'Sigue por', 'izquierda': 'Gira a la izquierda en', 'derecha': 'Gira a la derecha en',
            'vuelta': 'Da la vuelta por'}[a]
    return f"{verb} {via} · {step['m']} m"
