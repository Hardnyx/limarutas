"""Common street routing and matching operations; never writes site files."""
from __future__ import annotations

import copy
import heapq
import math
from collections import defaultdict

from .model import attach_stops, coordinate, new_route, projection, validate
from .network import metres, profile_allows


class Engine:
    def __init__(self, network):
        self.network = network
        self.pairs, self.incident = defaultdict(list), defaultdict(list)
        for edge in network.edges.values():
            a, b = edge['nodes']
            self.pairs[a, b].append({'type': 'street', 'edge': edge['id'], 'start': 0, 'end': 1})
            self.pairs[b, a].append({'type': 'street', 'edge': edge['id'], 'start': 1, 'end': 0})
            self.incident[a].append(edge['id'])
            self.incident[b].append(edge['id'])
        self._matcher = None

    def candidates(self, point, radius=50):
        point = coordinate(point)
        result = []
        for eid in self.network.near(point, radius):
            edge = self.network.edges[eid]
            t, distance, projected = projection(point, *edge['coordinates'])
            if distance <= radius:
                result.append({'edge': eid, 'fraction': round(t, 9), 'distanceM': round(distance, 2),
                               'coordinates': projected, 'name': edge['name']})
        return sorted(result, key=lambda c: (c['distanceM'], c['edge']))[:20]

    def anchor(self, anchor, leaving):
        if 'node' in anchor:
            if type(anchor['node']) is not int or anchor['node'] not in self.network.nodes:
                raise ValueError('Nodo OSM inexistente')
            return [(anchor['node'], [], 0)]
        if anchor.get('edge') not in self.network.edges:
            raise ValueError('Selecciona un tramo de calle válido')
        edge, t = self.network.edges[anchor['edge']], anchor.get('fraction', .5)
        if type(t) not in (int, float) or not math.isfinite(t) or not 0 <= t <= 1:
            raise ValueError('Posición sobre la calle inválida')
        if t in (0, 1):
            return [(edge['nodes'][int(t)], [], 0)]
        result = []
        for direction in (1, -1):
            if not edge['forward' if direction == 1 else 'backward']:
                continue
            end = 1 if direction == 1 else 0
            node = edge['nodes'][end if leaving else 1-end]
            start, stop = (t, end) if leaving else (1-end, t)
            refs = [] if start == stop else [{'type': 'street', 'edge': edge['id'], 'start': start, 'end': stop}]
            result.append((node, refs, metres(*edge['coordinates']) * abs(stop-start)))
        return result

    def shortest(self, start, end, incoming=None, final=None, allowed=None, via=None, profile=None):
        """Directed Dijkstra with turn state and ordered required street groups."""
        via = via or []
        initial = (start, incoming, 0)
        distances, previous, heap = {initial: 0}, {}, [(0, 0, initial)]
        serial, visited = 0, 0
        while heap:
            cost, _, state = heapq.heappop(heap)
            if cost != distances.get(state):
                continue
            node, prev_edge, phase = state
            visited += 1
            if visited > 400000:
                raise ValueError('Recorrido demasiado amplio; agrega cruces o tramos obligatorios')
            at_goal = node == end and phase == len(via)
            if at_goal and (final is None or self.network.turn_allowed(node, prev_edge, final)):
                refs = []
                while state != initial:
                    parent, ref = previous[state]
                    refs.append(ref)
                    state = parent
                return list(reversed(refs)), cost
            for neighbor, eid, sign in self.network.adj.get(node, []):
                edge = self.network.edges[eid]
                if not profile_allows(edge, profile):
                    continue
                if allowed is not None and edge['way'] not in allowed:
                    continue
                if not self.network.turn_allowed(node, prev_edge, eid):
                    continue
                next_phase = phase + 1 if phase < len(via) and edge['way'] in via[phase] else phase
                nxt = (neighbor, eid, next_phase)
                total = cost + metres(*edge['coordinates'])
                if total < distances.get(nxt, math.inf):
                    ref = {'type': 'street', 'edge': eid, 'start': 0 if sign == 1 else 1, 'end': 1 if sign == 1 else 0}
                    distances[nxt], previous[nxt] = total, (state, ref)
                    serial += 1
                    heapq.heappush(heap, (total, serial, nxt))
        return None

    def connect(self, a, b, incoming=None, allowed=None, via=None, profile=None):
        choices = []
        # A partial traversal within one physical segment must not detour via its endpoints.
        if a.get('edge') and a.get('edge') == b.get('edge') and not via:
            edge = self.network.edges[a['edge']]
            x, y = a.get('fraction', .5), b.get('fraction', .5)
            if x != y and profile_allows(edge, profile) and edge['forward' if y > x else 'backward'] and (allowed is None or edge['way'] in allowed):
                choices.append((metres(*edge['coordinates']) * abs(y-x),
                                [{'type': 'street', 'edge': edge['id'], 'start': x, 'end': y}]))
        for start, prefix, c1 in self.anchor(a, True):
            for end, suffix, c2 in self.anchor(b, False):
                if any(not profile_allows(self.network.edges[r['edge']], profile) for r in prefix + suffix):
                    continue
                if allowed is not None and any(self.network.edges[r['edge']]['way'] not in allowed for r in prefix + suffix):
                    continue
                prior = prefix[-1]['edge'] if prefix else incoming
                path = self.shortest(start, end, prior, suffix[0]['edge'] if suffix else None, allowed, via, profile)
                if path is not None:
                    refs, cost = path
                    choices.append((c1 + cost + c2, prefix + refs + suffix))
        if not choices:
            raise ValueError('No hay un recorrido conectado que respete los sentidos y restricciones indicados')
        return min(choices, key=lambda choice: choice[0])[1]

    def build(self, request):
        anchors = request.get('anchors', [])
        if len(anchors) < 2:
            raise ValueError('Selecciona al menos dos cruces o posiciones sobre calles')
        route = new_route(request['id'], request['name'], request['direction'], self.network,
                          request.get('source', {'kind': 'authored', 'request': copy.deepcopy(request)}))
        allowed = set(request['allowedWays']) if request.get('allowedWays') else None
        via = [set(group) for group in request.get('viaWays', [])]
        route['profile'] = copy.deepcopy(request.get('profile', {'mode': 'mixed'}))
        if via and len(anchors) != 2:
            raise ValueError('Divide el itinerario en etapas para combinar varios puntos y vías obligatorias')
        for a, b in zip(anchors, anchors[1:]):
            incoming = route['path'][-1]['edge'] if route['path'] else None
            route['path'].extend(self.connect(a, b, incoming, allowed, via, route['profile']))
        route['stops'] = copy.deepcopy(request.get('stops', []))
        route['anchors'] = copy.deepcopy(anchors)
        route['constraints'] = {k: copy.deepcopy(request[k]) for k in ('allowedWays', 'viaWays') if k in request}
        return attach_stops(route, self.network)

    @property
    def matcher(self):
        if self._matcher is None:
            from pipeline.scripts.osm.recorrido import Recorridos
            self._matcher = Recorridos((self.network.data['bbox'][1], self.network.data['bbox'][0],
                                        self.network.data['bbox'][3], self.network.data['bbox'][2]),
                                       red=MatcherNetwork(self.network))
        return self._matcher

    def from_record(self, record):
        path = []
        def append(item):
            part = self.network.coordinates(item) if item['type'] == 'street' else item['coordinates']
            if path:
                previous = self.network.coordinates(path[-1])[-1] if path[-1]['type'] == 'street' else path[-1]['coordinates'][-1]
                if metres(previous, part[0]) > 1:
                    path.append({'type': 'gap', 'coordinates': [previous, part[0]], 'reason': 'Conexión pendiente'})
            path.append(item)
        def gap(points):
            coords = [[p[1], p[0]] for p in points]
            if len(coords) > 1 and sum(metres(a, b) for a, b in zip(coords, coords[1:])) > 1:
                append({'type': 'gap', 'coordinates': coords, 'reason': 'Trazado original sin ajustar'})
        def endpoint(point, node, leaving):
            point = [point[1], point[0]]
            target = self.network.nodes[node]
            if metres(point, target) <= .2:
                return
            choices = []
            for eid in self.incident[node]:
                edge = self.network.edges[eid]
                t, distance, _ = projection(point, *edge['coordinates'])
                if distance <= 1:
                    at = edge['nodes'].index(node)
                    a, b = (t, at) if leaving else (at, t)
                    if abs(a-b) > 1e-9:
                        choices.append((distance, {'type': 'street', 'edge': eid, 'start': a, 'end': b}))
            if choices:
                append(min(choices, key=lambda c: c[0])[1])
            else:
                append({'type': 'gap', 'coordinates': [point, target] if leaving else [target, point],
                        'reason': 'Extremo sin vínculo exacto con la red'})
        gap(record.get('antes', []))
        for i, tramo in enumerate(record['tramos']):
            if i and i-1 < len(record['sueltos']):
                gap(record['sueltos'][i-1])
            nodes = tramo['nodos']
            if not nodes:
                gap([tramo['desde'], tramo['hasta']])
                continue
            endpoint(tramo['desde'], nodes[0], True)
            for a, b in zip(nodes, nodes[1:]):
                if not self.pairs.get((a, b)):
                    raise ValueError(f'Tramo OSM eliminado: {a} → {b}')
                append(copy.deepcopy(self.pairs[a, b][0]))
            endpoint(tramo['hasta'], nodes[-1], False)
        gap(record.get('despues', []))
        return path

    def match(self, route, coordinates):
        line = [tuple(reversed(coordinate(c))) for c in coordinates]
        if len(line) < 2:
            raise ValueError('El trazado requiere al menos dos coordenadas')
        record = self.matcher.limpiar(self.matcher.match(line, ends=True))
        route = copy.deepcopy(route)
        route['path'] = self.from_record(record)
        route['importWarnings'] = []
        route['review'] = {'accepted': False, 'notes': ''}
        return attach_stops(route, self.network)


class MatcherNetwork:
    """Adapt shared street geometry to the existing matching algorithm."""
    def __init__(self, network):
        self.pos = {node: (point[1], point[0]) for node, point in network.nodes.items()}
        self.adj, self.way, self.way_nodes = defaultdict(list), {}, {}
        self.fecha = network.data['source'].get('timestamp', '')[:10]
        for way, eids in network.ways.items():
            edges = sorted((network.edges[eid] for eid in eids), key=lambda e: int(e['id'].split(':')[1]))
            self.way_nodes[way] = [edges[0]['nodes'][0]] + [edge['nodes'][1] for edge in edges]
        for node, outgoing in network.adj.items():
            for neighbor, eid, _ in outgoing:
                edge = network.edges[eid]
                self.adj[node].append((neighbor, metres(*edge['coordinates'])))
                self.way[node, neighbor] = (edge['way'], edge['name'], edge.get('junction') in ('roundabout', 'circular'))
