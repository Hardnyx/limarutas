"""Recover only uniquely identifiable OSM geometry; never guess a nearby street."""
from __future__ import annotations

from collections import defaultdict

from .model import coordinate, projection
from .network import metres


class GeometryTrace:
    def __init__(self, engine, tolerance=.2):
        self.engine, self.network, self.tolerance = engine, engine.network, tolerance
        self.incident = defaultdict(list)
        for edge in self.network.edges.values():
            for node in edge['nodes']:
                self.incident[node].append(edge['id'])

    def segment(self, a, b):
        """Trace a straight source segment through collinear OSM vertices.

        The tolerance covers six-decimal rounding, not a change of calzada.
        Parallel ways, bridges and coincident geometries remain ambiguous.
        Direction and access are checked by the route validator afterward.
        """
        length = metres(a, b)
        if length < .05:
            return []
        solutions = {}
        def visit(node, progress, refs, visited):
            if len(solutions) > 1 or len(refs) > 2000:
                return
            for eid in self.incident.get(node, []):
                if eid in visited:
                    continue
                edge = self.network.edges[eid]
                start = edge['nodes'].index(node)
                walk(eid, start, progress, refs, visited)

        def walk(eid, start, progress, refs, visited):
            edge = self.network.edges[eid]
            # Only the endpoint in the direction of source progress may follow.
            for end in (0, 1):
                if end == start:
                    continue
                point = edge['coordinates'][end]
                along, deviation, _ = projection(point, a, b)
                t, distance, _ = projection(b, *edge['coordinates'])
                for at, endpoint in enumerate(edge['coordinates']):
                    if metres(b, endpoint) <= self.tolerance:
                        t = at
                        break
                if distance <= self.tolerance and (t-start)*(end-start) > 1e-9:
                    ref = {'type': 'street', 'edge': eid, 'start': start, 'end': t}
                    path = refs + [ref]
                    solutions[tuple((r['edge'], round(r['start'], 9), round(r['end'], 9)) for r in path)] = path
                    continue
                if deviation > self.tolerance or along <= progress + 1e-9:
                    continue
                ref = {'type': 'street', 'edge': eid, 'start': start, 'end': end}
                visit(edge['nodes'][end], along, refs + [ref], visited | {eid})

        for candidate in self.engine.candidates(a, self.tolerance):
            if candidate['distanceM'] > self.tolerance:
                continue
            eid, start = candidate['edge'], candidate['fraction']
            for at, endpoint in enumerate(self.network.edges[eid]['coordinates']):
                if metres(a, endpoint) <= self.tolerance:
                    start = at
                    break
            # A source point at a vertex is entered through its incident edges once.
            walk(eid, start, 0, [], set())
        return next(iter(solutions.values())) if len(solutions) == 1 else None

    def parts(self, parts):
        result = []
        for part in parts:
            for first, last in zip(part, part[1:]):
                a, b = coordinate(first), coordinate(last)
                refs = self.segment(a, b)
                if refs is None:
                    refs = [{'type': 'gap', 'coordinates': [a, b],
                             'reason': 'Geometría sin correspondencia única exacta con OSM'}]
                for ref in refs:
                    if result and ref['type'] == result[-1]['type'] == 'street':
                        previous = result[-1]
                        same_direction = ((previous['end'] > previous['start']) == (ref['end'] > ref['start']))
                        if (previous['edge'] == ref['edge'] and same_direction
                                and abs(previous['end']-ref['start']) < 1e-7):
                            previous['end'] = ref['end']
                            continue
                    if result and ref['type'] == result[-1]['type'] == 'gap' and result[-1]['coordinates'][-1] == ref['coordinates'][0]:
                        result[-1]['coordinates'].extend(ref['coordinates'][1:])
                    else:
                        result.append(ref)
        return result
