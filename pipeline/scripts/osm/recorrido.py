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
TINY_RB_M = 20         # una «rotonda» más corta (un pedazo de anillo en un cruce), también
UNNAMED_M = 120        # un paso sin nombre más corto que esto (un enlace, una oreja), también
ON_STREET_M = 100      # corrección «por Av. Z»: al menos esto seguido por ella
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

    def steps(self, rec, idx=False):
        """Pasos de cada tramo pegado a la red: [{'accion', 'via', 'm', 'salida'?}].
        Con idx, cada paso dice también dónde empieza y termina en los nodos
        del recorrido ('_a', '_b': (tramo, índice)), para corregirlo."""
        out = []
        for ti, t in enumerate(rec['tramos']):
            nodes = t['nodos']
            if len(nodes) < 2:
                continue
            # Tramos de la misma vía (por nombre) o de la misma rotonda, juntos
            groups = []
            for j, (a, b) in enumerate(zip(nodes, nodes[1:])):
                wid, name, rb = self.way(a, b)
                key = ('rotonda', None) if rb else ('via', name)
                if groups and groups[-1]['key'] == key:
                    groups[-1]['nodes'].append(b)
                else:
                    groups.append({'key': key, 'name': name, 'nodes': [a, b], 'rb': rb, 'i0': j})
            for n, g in enumerate(groups):
                m = round(sum(_d(self.pos[a], self.pos[b]) for a, b in zip(g['nodes'], g['nodes'][1:])))
                span = {'_a': (ti, g['i0']), '_b': (ti, g['i0'] + len(g['nodes']) - 1)}
                if g['rb']:
                    # Salidas que se pasan: nodos de la rotonda con otra calle
                    exits = sum(1 for x in g['nodes'][1:-1]
                                if any(not self.way(x, y)[2] for y in self.adj[x]))
                    nxt = groups[n + 1]['name'] if n + 1 < len(groups) else ''
                    out.append({'accion': 'rotonda', 'salida': exits + 1, 'via': nxt, 'm': m, **span})
                    continue
                if out and out[-1]['accion'] == 'rotonda':
                    out.append({'accion': 'sigue', 'via': g['name'], 'm': m, **span})
                    continue
                if not out:
                    out.append({'accion': 'inicio', 'via': g['name'], 'm': m, **span})
                    continue
                prev = groups[n - 1]['nodes'] if n else None
                if prev is None:
                    # Primer grupo de otro tramo (después de un pedazo sin calle)
                    out.append({'accion': 'sigue', 'via': g['name'], 'm': m, **span})
                    continue
                h1 = _heading(self.pos[prev[max(0, len(prev) - 3)]], self.pos[prev[-1]])
                h2 = _heading(self.pos[g['nodes'][0]], self.pos[g['nodes'][min(2, len(g['nodes']) - 1)]])
                turn = math.degrees((h2 - h1 + math.pi) % (2 * math.pi) - math.pi)
                accion = ('sigue' if abs(turn) < 30 else 'vuelta' if abs(turn) > 150
                          else 'izquierda' if turn > 0 else 'derecha')
                # Mismo nombre tras un tramo sin nombre: se junta
                if accion == 'sigue' and out[-1]['via'] == g['name']:
                    out[-1]['m'] += m
                    out[-1]['_b'] = span['_b']
                    continue
                out.append({'accion': accion, 'via': g['name'], 'm': m, **span})
        # Tramos cortos sin nombre (una oreja, un enlace) y los de menos de
        # SHORT_M (el cruce de una calle de dos calzadas) se funden con el siguiente
        merged = []
        for s in out:
            last = merged[-1] if merged else None
            if last and len(merged) > 1 and (
                    (last['accion'] == 'rotonda' and last['m'] < TINY_RB_M)
                    or (last['accion'] != 'rotonda' and (last['m'] < SHORT_M or (not last['via'] and last['m'] < UNNAMED_M)))):
                gone = merged.pop()
                s = {**s, 'm': s['m'] + gone['m'], '_a': gone['_a']}
            # Otra vez la misma calle (se pasó a la otra calzada, o el pedazo
            # del medio se juntó): sigue en ella, salvo que dé la vuelta
            if (merged and merged[-1]['via'] == s['via'] and s['via'] and s['accion'] != 'vuelta'
                    and 'rotonda' not in (s['accion'], merged[-1]['accion'])):
                merged[-1] = {**merged[-1], 'm': merged[-1]['m'] + s['m'], '_b': s['_b']}
                continue
            merged.append(s)
        if not idx:
            merged = [{k: v for k, v in s.items() if not k.startswith('_')} for s in merged]
        return merged

    # ---------- el recorrido guardado: vías de OSM ----------
    def _base(self, w):
        nodes = self.red.way_nodes.get(w)
        if not nodes:
            return None, False
        closed = len(nodes) > 2 and nodes[0] == nodes[-1]
        return (nodes[:-1] if closed else nodes), closed

    def _step(self, base, closed, i, sign):
        j = i + sign
        if closed:
            return j % len(base)
        return j if 0 <= j < len(base) else None

    def encode(self, rec):
        """El recorrido como vías de OSM: por tramo, su primer nodo y
        [[vía, tramos recorridos en ella (con signo: + en el orden de la vía,
        − al revés)], …]; cada vía empieza donde terminó la anterior. Ocupa
        una fracción de la lista de nodos y de ahí se rehace igual."""
        tramos = []
        for t in rec['tramos']:
            nodes = t['nodos']
            item = {'desde': [round(x, 6) for x in t['desde']], 'hasta': [round(x, 6) for x in t['hasta']]}
            if len(nodes) < 2:
                item['nodos'] = list(nodes)
                tramos.append(item)
                continue
            vias, cur = [], None          # cur = [vía, k, índice actual]
            for u, v in zip(nodes, nodes[1:]):
                w = self.way(u, v)[0]
                base, closed = self._base(w)
                if cur and cur[0] == w:
                    sign = 1 if cur[1] > 0 else -1
                    j = self._step(base, closed, cur[2], sign)
                    if j is not None and base[j] == v:
                        cur[1] += sign
                        cur[2] = j
                        continue
                if cur:
                    vias.append(cur[:2])
                cur = None
                for i in (i for i, x in enumerate(base or ()) if x == u):
                    for sign in (1, -1):
                        j = self._step(base, closed, i, sign)
                        if j is not None and base[j] == v:
                            cur = [w, sign, j]
                            break
                    if cur:
                        break
                if cur is None:
                    raise ValueError(f'el tramo {u}→{v} no es de la vía {w}')
            vias.append(cur[:2])
            item['nodo'] = nodes[0]
            item['vias'] = vias
            tramos.append(item)
        return {'osm': self.red.fecha, 'tramos': tramos,
                'sueltos': [[[round(x, 6) for x in p] for p in s] for s in rec['sueltos']]}

    def _walk(self, a, vias):
        """Nodos desde a por las vías [[vía, k], …], o None si no se puede.
        Si a está dos veces en una vía, la que deja seguir por la siguiente."""
        if not vias:
            return [a]
        w, k = vias[0]
        base, closed = self._base(w)
        if base is None:
            return None
        sign = 1 if k > 0 else -1
        for i in (i for i, x in enumerate(base) if x == a):
            run, j = [a], i
            for _ in range(abs(k)):
                j = self._step(base, closed, j, sign)
                if j is None:
                    break
                run.append(base[j])
            else:
                rest = self._walk(run[-1], vias[1:])
                if rest is not None:
                    return run + rest[1:]
        return None

    def _walk_iter(self, a, vias):
        """_walk por partes (sin pasar el límite de recursión de Python)."""
        out = [a]
        for n in range(0, len(vias), 300):
            part = self._walk(out[-1], vias[n:n + 300])
            if part is None:
                return None
            out += part[1:]
        return out

    def decode(self, data):
        """El recorrido guardado (encode) con la red actual; None si alguna vía
        o nodo ya no está o dejó de unirse (OSM cambió): hay que volver a
        pegar el dibujo."""
        tramos = []
        for item in data['tramos']:
            if 'vias' not in item:
                nodes = list(item.get('nodos', []))
            else:
                nodes = self._walk_iter(item['nodo'], item['vias'])
                if nodes is None or any(b not in self.adj.get(a, ()) for a, b in zip(nodes, nodes[1:])):
                    return None
            tramos.append({'nodos': nodes, 'desde': tuple(item['desde']), 'hasta': tuple(item['hasta'])})
        return {'tramos': tramos, 'sueltos': [[list(p) for p in s] for s in data.get('sueltos', [])]}

    # ---------- correcciones ----------
    def corregir(self, rec, corr):
        """Rehace un pedazo del recorrido: desde el final del paso «desde» hasta
        el comienzo del paso «hasta», pasando, en orden, por las calles y
        puntos de «por». desde/hasta: el número del paso (1, 2, …) o el nombre
        de su vía (la primera vez que aparece; «desde_vez» para otra). Sin
        desde, desde el comienzo del tramo; sin hasta, hasta su final. Si
        desde y hasta caen en tramos distintos (entre ellos el dibujo no tenía
        calle), se unen en uno. Devuelve el recorrido nuevo."""
        steps = self.steps(rec, idx=True)

        def find(ref, after=-1, vez=1):
            if ref is None:
                return None
            if isinstance(ref, int):
                if not 1 <= ref <= len(steps):
                    raise CorreccionError(f'no hay paso {ref} (son {len(steps)})')
                return ref - 1
            for n in range(after + 1, len(steps)):
                if steps[n]['via'] and _same_street(ref, steps[n]['via']):
                    vez -= 1
                    if not vez:
                        return n
            raise CorreccionError(f'ningún paso por «{ref}»' + (' después del paso «desde»' if after >= 0 else ''))

        i_desde = find(corr.get('desde'), vez=corr.get('desde_vez', 1))
        i_hasta = find(corr.get('hasta'), after=-1 if i_desde is None else i_desde)
        if i_desde is None and i_hasta is None:
            raise CorreccionError('falta «desde» o «hasta»')
        if i_desde is not None:
            t1, j1 = steps[i_desde]['_b']
        else:
            t1, j1 = steps[i_hasta]['_a'][0], 0
        if i_hasta is not None:
            t2, j2 = steps[i_hasta]['_a']
        else:
            t2 = t1
            j2 = len(rec['tramos'][t2]['nodos']) - 1
        if (t2, j2) < (t1, j1):
            raise CorreccionError('«hasta» está antes que «desde»')
        n1 = rec['tramos'][t1]['nodos'][j1]
        n2 = rec['tramos'][t2]['nodos'][j2]
        path = self.via(n1, n2, corr.get('por', []))
        if path is None:
            raise CorreccionError('no hay camino por la red con esas calles')
        tramos = [dict(t) for t in rec['tramos']]
        joined = {'desde': tramos[t1]['desde'], 'hasta': tramos[t2]['hasta'],
                  'nodos': tramos[t1]['nodos'][:j1] + path + tramos[t2]['nodos'][j2 + 1:]}
        # Entre los tramos t y t+1 está el suelto t
        sueltos = rec['sueltos'][:t1] + rec['sueltos'][t2:]
        return {'tramos': tramos[:t1] + [joined] + tramos[t2 + 1:], 'sueltos': sueltos}

    def via(self, a, b, por):
        """Nodos del camino de a a b que pasa, en orden, por cada elemento de
        por: una calle («Av. Z», o {"calle": "Av. Z", "m": 300}: la recorre
        seguida al menos ON_STREET_M, o esos metros; no basta cruzarla) o un
        punto [lat, lon] (el nodo de la red más cercano). Respeta los
        sentidos de circulación; si así no hay camino, sin ellos."""
        items = []
        for x in por:
            if isinstance(x, str) or isinstance(x, dict):
                name = x if isinstance(x, str) else x['calle']
                items.append(('calle', name, (x.get('m') if isinstance(x, dict) else None) or ON_STREET_M))
            else:
                c = self.candidates(tuple(x))
                if not c:
                    raise CorreccionError(f'sin calle a menos de {CAND_M} m de {x}')
                u, v, _L = self.edges[c[0][1]]
                items.append(('punto', u if _d(self.pos[u], x) <= _d(self.pos[v], x) else v, 0))
        names = {}

        def on_street(val, u, v):
            name = self.way(u, v)[1]
            if (val, name) not in names:
                names[val, name] = bool(name) and _same_street(val, name)
            return names[val, name]

        if not hasattr(self, '_und'):
            self._und = {u: [(v, _d(self.pos[u], self.pos[v])) for v in vs] for u, vs in self.adj.items()}
        m = len(items)
        for graph in (self.red.adj, self._und):
            # Estado: (nodo, elementos ya cumplidos, metros seguidos por la calle del siguiente)
            ph0 = 1 if m and items[0][0] == 'punto' and items[0][1] == a else 0
            start = (a, ph0, 0)
            dist, prev = {start: 0.0}, {}
            heap = [(0.0, start)]
            goal = None
            while heap:
                g, st = heapq.heappop(heap)
                if g > dist[st]:
                    continue
                u, ph, acc = st
                if u == b and ph == m:
                    goal = st
                    break
                for v, w in graph.get(u, ()):
                    nph, nacc = ph, 0
                    if ph < m:
                        kind, val, need = items[ph]
                        if kind == 'punto':
                            nph = ph + 1 if v == val else ph
                        elif on_street(val, u, v):
                            nacc = acc + int(_d(self.pos[u], self.pos[v]) + 0.5)
                            if nacc >= need:
                                nph, nacc = ph + 1, 0
                    ns = (v, nph, nacc)
                    ng = g + w
                    if ng < dist.get(ns, math.inf):
                        dist[ns], prev[ns] = ng, st
                        heapq.heappush(heap, (ng, ns))
            if goal:
                out = [goal]
                while out[-1] != start:
                    out.append(prev[out[-1]])
                return [n for n, _, _ in reversed(out)]
        return None


class CorreccionError(ValueError):
    pass


_PREFIX = {'avenida', 'av', 'jiron', 'jr', 'calle', 'ca', 'pasaje', 'psje', 'via', 'carretera', 'ovalo',
           'prolongacion', 'prol', 'de', 'la', 'el', 'los', 'las', 'del'}


def _words(s):
    import unicodedata
    s = unicodedata.normalize('NFKD', s.lower())
    s = ''.join(c if c.isalnum() else ' ' for c in s if not unicodedata.combining(c))
    return [w for w in s.split() if w not in _PREFIX]


def _same_street(query, name):
    """«Av. Brasil» es «Avenida Brasil»; «Javier Prado» es «Avenida Javier
    Prado Este»: las palabras de la consulta (sin Av., Jr., de, la…) están
    todas en el nombre."""
    q = _words(query)
    return bool(q) and set(q) <= set(_words(name))


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
