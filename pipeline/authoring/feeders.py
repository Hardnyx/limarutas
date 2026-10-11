"""Rebuild feeder directions on their OSM itinerary with hard traffic constraints."""
from __future__ import annotations

import copy
import hashlib
from pathlib import Path

from .engine import Engine, MatcherNetwork
from .model import attach_stops, digest, geometry, new_route, projection, validate
from .network import Network, metres, profile_allows

PROFILE = {'mode': 'mixed', 'system': 'Alimentadores del Metropolitano'}


def relation_itineraries(pbf, refs, network):
    import osmium
    pbf = Path(pbf)
    if hashlib.sha256(pbf.read_bytes()).hexdigest() != network.data['source']['sha256']:
        raise ValueError('Las relaciones y la red deben pertenecer al mismo extracto OSM')
    result = {}
    class Handler(osmium.SimpleHandler):
        def relation(self, relation):
            tags = dict(relation.tags)
            ref = tags.get('ref')
            if ref not in refs or tags.get('network') != 'Metropolitano' or tags.get('route') != 'bus':
                return
            ways = sorted({m.ref for m in relation.members if m.type == 'w' and m.role not in ('platform', 'stop')})
            result.setdefault(ref, []).append({'relation': relation.id, 'ways': ways})
    Handler().apply_file(str(pbf))
    return result


def itinerary_network(network, service, evidence):
    ways = {w for relation in evidence for w in relation['ways']}
    names = {e['name'] for e in network.edges.values() if e['way'] in ways and e['name']}
    # The common station marker is inside the terminal. Its public access
    # carriageway can have been split off from the older feeder relation.
    for direction in ('ida', 'vuelta'):
        for stop in service[direction]['stops']:
            if not str(stop['id']).startswith('met:'):
                continue
            point = [stop['lon'], stop['lat']]
            nearby = [e for eid in network.near(point, 80) if profile_allows(e := network.edges[eid], PROFILE)
                      and projection(point, *e['coordinates'])[1] <= 80]
            if nearby:
                edge = min(nearby, key=lambda e: projection(point, *e['coordinates'])[1])
                ways.add(edge['way'])
                if edge['name']:
                    names.add(edge['name'])
    points = [p for d in ('ida', 'vuelta') for p in service[d]['coords']]
    points += [[s['lat'], s['lon']] for d in ('ida', 'vuelta') for s in service[d]['stops']]
    south, north = min(p[0] for p in points)-.003, max(p[0] for p in points)+.003
    west, east = min(p[1] for p in points)-.003, max(p[1] for p in points)+.003
    # Retain whole ways so restrictions keep their original topology. Same-name
    # adjacent ways cover updated OSM splits and the opposite carriageway.
    included = {e['way'] for e in network.edges.values()
                if (e['way'] in ways or e['name'] in names) and profile_allows(e, PROFILE)
                and any(west <= p[0] <= east and south <= p[1] <= north for p in e['coordinates'])}
    edges = [e for e in network.edges.values() if e['way'] in included and profile_allows(e, PROFILE)]
    if not edges:
        raise ValueError('El alimentador no tiene un itinerario OSM identificable')
    return Network({**network.data, 'edges': edges})


def directed_path(engine, points, identity):
    """Choose road projections jointly; never insert the station/stop itself."""
    layers = []
    for point in points:
        candidates, seen = [], set()
        for candidate in engine.candidates(point, 80):
            way = engine.network.edges[candidate['edge']]['way']
            if way not in seen:
                seen.add(way)
                candidates.append(candidate)
        if not candidates:
            raise ValueError(f'{identity}: punto sin calle del itinerario a menos de 80 m: {point}')
        layers.append(candidates[:6])
    states = [(c['distanceM']*3, [], {'edge': c['edge'], 'fraction': c['fraction']}) for c in layers[0]]
    for index, layer in enumerate(layers[1:], 1):
        following = []
        for candidate in layer:
            target = {'edge': candidate['edge'], 'fraction': candidate['fraction']}
            choices = []
            for cost, history, start in states:
                if start == target:
                    choices.append((cost+candidate['distanceM']*3, history, target))
                    continue
                try:
                    refs = engine.connect(start, target, incoming=history[-1]['edge'] if history else None,
                                          history=history, profile=PROFILE)
                except ValueError:
                    continue
                length = sum(metres(*engine.network.coordinates(r)) for r in refs)
                if length > metres(points[index-1], points[index])*3+200:
                    continue
                choices.append((cost+length+candidate['distanceM']*3, history+refs, target))
            if choices:
                following.append(min(choices, key=lambda item: item[0]))
        if not following:
            raise ValueError(f'{identity}: no hay una conexión legal continua en el paso {index}')
        states = following
    return min(states, key=lambda item: item[0])[1]


def rebuild(service, identity, network, evidence):
    from pipeline.scripts.osm.recorrido import Recorridos
    engine = Engine(itinerary_network(network, service, evidence))
    matcher = Recorridos((-90, -180, 90, 180), red=MatcherNetwork(engine.network))
    result = copy.deepcopy(service)
    # The turnaround remains the same physical point, not the farthest vertex
    # of a new shortest path. Both directions are rebuilt independently.
    if service['ida']['coords'][-1] != service['vuelta']['coords'][0]:
        raise ValueError(f'{identity}: la división original no comparte el punto de vuelta')
    for direction in ('ida', 'vuelta'):
        item = service[direction]
        points = [[s['lon'], s['lat']] for s in item['stops']]
        turnaround = list(reversed(service['ida']['coords'][-1]))
        if direction == 'ida':
            points.append(turnaround)
        else:
            points.insert(0, turnaround)
        route = new_route(f'alim:{identity}:{direction}', service['name'], direction, network)
        route['profile'] = copy.deepcopy(PROFILE)
        route['path'] = directed_path(engine, points, route['id'])
        route['stops'] = [{'id': s['id'], 'name': s['name'], 'coordinates': [s['lon'], s['lat']]}
                          for s in item['stops']]
        route = attach_stops(route, network)
        validation = validate(route, network)
        if not validation['ready']:
            raise ValueError(f'{route["id"]}: el recorrido no pasa la validación: {validation["issues"]}')
        coords = geometry(route, network)
        old = [list(reversed(p)) for p in item['coords']]
        if any(min(projection(p, a, b)[1] for a, b in zip(old, old[1:])) > 125 for p in coords):
            raise ValueError(f'{route["id"]}: la reconstrucción abandona el recorrido fuente')
        cumulative = [0.0]
        for a, b in zip(coords, coords[1:]):
            cumulative.append(cumulative[-1]+metres(a, b))
        stops = []
        for stop, placed in zip(item['stops'], route['stops']):
            m = placed['position']['alongM']
            at = min(range(len(coords)), key=lambda i: abs(cumulative[i]-m))
            stops.append({**stop, 'at': at, 'm': round(m)})
        if [s['at'] for s in stops] != sorted(s['at'] for s in stops):
            raise ValueError(f'{route["id"]}: los paraderos no conservan el orden')
        # Steps use the verified references directly, never run another match.
        nodes = []
        for ref in route['path']:
            edge = network.edges[ref['edge']]
            a, b = edge['nodes'] if ref['end'] > ref['start'] else list(reversed(edge['nodes']))
            if not nodes:
                nodes.append(a)
            if nodes[-1] != b:
                nodes.append(b)
        record = {'tramos': [{'nodos': nodes, 'desde': list(reversed(coords[0])),
                              'hasta': list(reversed(coords[-1]))}], 'sueltos': []}
        rebuilt = {**item, 'coords': [list(reversed(p)) for p in coords], 'stops': stops,
                   'pasos': matcher.steps(record), 'network': network.id,
                   'pathReferences': route['path'], 'pathHash': digest(route['path']),
                   'itinerary': {'kind': 'osm-feeder-relation', 'relations': copy.deepcopy(evidence),
                                 'sourceGeometryHash': digest(item['coords']),
                                 'sourceStopsHash': digest([{k: v for k, v in s.items() if k not in ('at', 'm')}
                                                           for s in item['stops']])}}
        rebuilt.pop('sin_calle', None)
        result[direction] = rebuilt
    if result['ida']['coords'][-1] != result['vuelta']['coords'][0]:
        raise ValueError(f'{identity}: la reconstrucción cambió el punto de división entre sentidos')
    return result


def build(document, refs, network, itineraries):
    result = copy.deepcopy(document)
    for ref in refs:
        if ref not in document['services'] or not itineraries.get(ref):
            raise ValueError(f'{ref}: falta el servicio o su relación OSM; requiere revisar la fuente')
        result['services'][ref] = rebuild(document['services'][ref], ref, network, itineraries[ref])
    result['updated'] = network.data['source']['timestamp'][:10]
    return result
