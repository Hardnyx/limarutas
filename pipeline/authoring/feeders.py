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
    review = service.get('sourceReview')
    forbidden = set(review.get('forbidden_names', [])) if review else set()
    if review:
        ways.update(review['additional_ways'])
        ways.difference_update(e['way'] for e in network.edges.values() if e['name'] in forbidden)
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
                if (e['way'] in ways or e['name'] in names) and e['name'] not in forbidden and profile_allows(e, PROFILE)
                and any(west <= p[0] <= east and south <= p[1] <= north for p in e['coordinates'])}
    edges = [e for e in network.edges.values() if e['way'] in included and profile_allows(e, PROFILE)]
    if not edges:
        raise ValueError('El alimentador no tiene un itinerario OSM identificable')
    return Network({**network.data, 'edges': edges})


def directed_path(engine, points, identity, anchor_ways=None):
    from .routing import directed_path as connect_projections
    return connect_projections(engine, points, identity, profile=PROFILE, anchor_ways=anchor_ways)


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
        review=service.get('sourceReview')
        anchor_ways = ({len(points)-1 if direction=='ida' else 0: [review['turnaround_way']]}
                       if review and review.get('turnaround_way') else None)
        route['path'] = directed_path(engine, points, route['id'], anchor_ways=anchor_ways)
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
        if review:
            rebuilt['itinerary'].update(kind='reviewed-atu-diagram', sourceReviewId=review['id'],
                                         sourceSha256=review['source_sha256'], reviewHash=review['reviewHash'])
        rebuilt.pop('sin_calle', None)
        result[direction] = rebuilt
    if result['ida']['coords'][-1] != result['vuelta']['coords'][0]:
        raise ValueError(f'{identity}: la reconstrucción cambió el punto de división entre sentidos')
    return result


def apply_source_review(service, review, network):
    """Replace a superseded source guide before routing; retain the prior hashes."""
    if review['network_source_sha256']!=network.data['source']['sha256']:
        raise ValueError('La revisión de fuente requiere cotejo con el nuevo snapshot OSM')
    previous=service.get('sourceReview')
    if not previous and any(digest(service[d]['coords'])!=review['original_geometry_hashes'][d] for d in ('ida','vuelta')):
        raise ValueError('La revisión de fuente pertenece a otro recorrido')
    if previous and previous.get('reviewHash')!=digest(review):
        raise ValueError('La revisión publicada y la revisión solicitada difieren')
    result=copy.deepcopy(service)
    result['sourceReview']={k:copy.deepcopy(v) for k,v in review.items() if k not in ('source_guides','stop_references')}
    result['sourceReview']['reviewHash']=digest(review)
    for direction in ('ida','vuelta'):
        item=result[direction]
        item['coords']=copy.deepcopy(review['source_guides'][direction])
        references=review['stop_references'][direction]
        if set(references)-{s['id'] for s in item['stops']}:raise ValueError('Referencia de paradero inexistente')
        for stop in item['stops']:
            if stop['id'] not in references:continue
            reference=references[stop['id']]
            if stop['name']!=reference['name']:raise ValueError('Cambió la identidad del paradero revisado')
            stop['lon'],stop['lat']=reference['coordinates']
            stop['aprox']=True
            stop['locationReference']={**copy.deepcopy(reference),'source_sha256':review['source_sha256']}
    if result['ida']['coords'][-1]!=list(reversed(review['turnaround'])) or result['vuelta']['coords'][0]!=result['ida']['coords'][-1]:
        raise ValueError('La guía revisada no comparte un punto de vuelta')
    return result


def build(document, refs, network, itineraries, reviews=None):
    result = copy.deepcopy(document)
    for ref in refs:
        if ref not in document['services'] or not itineraries.get(ref):
            raise ValueError(f'{ref}: falta el servicio o su relación OSM; requiere revisar la fuente')
        service=document['services'][ref]
        if reviews and ref in reviews:
            service=apply_source_review(service,reviews[ref],network)
        result['services'][ref] = rebuild(service, ref, network, itineraries[ref])
    result['updated'] = network.data['source']['timestamp'][:10]
    return result
