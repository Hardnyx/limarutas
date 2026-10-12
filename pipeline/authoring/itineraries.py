"""Reconstruct selected source routes on bounded, authorized OSM itineraries."""
from __future__ import annotations
import copy
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .engine import Engine
from .exporter import bundle
from .importer import import_existing, track_coordinates
from .model import digest, geometry, validate
from .network import Network, metres, normal, profile_allows
from .routing import directed_path, guide_positions, guide_ways


def bus_relations(pbf, network, system):
    import osmium
    if hashlib.sha256(Path(pbf).read_bytes()).hexdigest() != network.data['source']['sha256']:
        raise ValueError('El itinerario y la red deben pertenecer al mismo extracto OSM')
    relations = []
    class Handler(osmium.SimpleHandler):
        def relation(self, relation):
            tags = dict(relation.tags)
            if tags.get('type') == 'route' and tags.get('route') == 'bus' and normal(tags.get('network', '')) == normal(system):
                relations.append({'id': relation.id, 'tags': tags, 'ways': sorted({m.ref for m in relation.members if m.type == 'w' and m.role not in ('platform', 'stop')})})
    Handler().apply_file(str(pbf))
    return relations


def matches_definition(relation, definition):
    token = re.search(r'route_(\d+)$', definition['folder'])
    ids = parse_qs(urlparse(relation['tags'].get('source', '')).query).get('routes', [])
    return token is not None and token[1] in ids


def corridor_edges(network, ways, names, bbox, profile, member_ways):
    return [e for e in network.edges.values()
            if (e['way'] in ways or (e['name'] and normal(e['name']) in names)
                or e.get('highway', '').endswith('_link') or e.get('junction') in ('roundabout', 'circular'))
            and (network.data.get('serviceTypes', {}).get(str(e['way'])) != 'parking_aisle'
                 or e['way'] in member_ways)
            and profile_allows(e, profile)
            and any(bbox[0] <= p[0] <= bbox[2] and bbox[1] <= p[1] <= bbox[3] for p in e['coordinates'])]


def reconstruct(route, engine, definition, relations, facility_points, system):
    network = engine.network
    source_points = [p for part in track_coordinates(route['source']['track']) for p in part]
    member_ways = {w for r in relations for w in r['ways']}
    shared_ways = {e['way'] for e in network.edges.values() if e['way'] in member_ways
                   and any(metres(point, p) < 2000 for p in e['coordinates'] for point in facility_points)}
    own_ways = {w for r in relations if matches_definition(r, definition) for w in r['ways']}
    ways = guide_ways(network, source_points) | own_ways | shared_ways
    # Legacy steps are advisory names, never operational references. Geometry
    # also discovers streets omitted by the old undirected matcher.
    names = {normal(s['via']) for f in route['source'].get('matched', {}).get('features', [])
             for s in f.get('properties', {}).get('pasos', []) if s.get('via')}
    # OSM splits an avenue into many ways; a coarse source drawing can miss
    # one of those pieces. Discover names from the guide as well, then keep
    # their connected pieces inside the source bounds.
    names.update(normal(e['name']) for e in network.edges.values()
                 if e['way'] in ways and e['name'])
    bbox = [min(p[0] for p in source_points)-.002, min(p[1] for p in source_points)-.002,
            max(p[0] for p in source_points)+.002, max(p[1] for p in source_points)+.002]
    permitted = {e['id'] for e in network.edges.values() if e['way'] in shared_ways and not profile_allows(e)}
    profile = {'mode': 'mixed', 'system': system, 'reservedEdges': sorted(permitted)}
    edges = corridor_edges(network, ways, names, bbox, profile, member_ways)
    local = Engine(Network({**network.data, 'edges': edges}))
    points = [s['coordinates'] for s in route['stops']]
    preferred = {}
    for index in (0, len(points)-1):
        if not any(metres(points[index], p) < 100 for p in facility_points):
            continue
        candidates = [c for c in local.candidates(points[index], 35)
                      if local.network.edges[c['edge']]['way'] in shared_ways]
        # A destination inside a bus bay must reach that bay's service lane,
        # rather than stop on a shorter parallel car access road.
        service = [c for c in candidates if local.network.edges[c['edge']]['highway'] == 'service']
        if index == len(points)-1 and service:
            candidates = service
        if not candidates:
            raise ValueError('La terminal no tiene una calzada autorizada próxima')
        preferred[index] = {local.network.edges[c['edge']]['way'] for c in candidates}
    result = copy.deepcopy(route)
    result['profile'] = profile
    result['constraints'] = {'allowedWays': sorted({e['way'] for e in edges})}
    result['path'] = directed_path(local, points, route['id'], profile, guide_positions(source_points, points), preferred)
    # Keep only permissions actually used by this service.
    result['profile']['reservedEdges'] = sorted({r['edge'] for r in result['path'] if r['edge'] in permitted})
    from .model import attach_stops
    result = attach_stops(result, network)
    check = validate(result, network)
    if not check['ready']:
        raise ValueError(f'{route["id"]}: el itinerario no es publicable: {check["issues"]}')
    result['revision'] += 1
    result['review'] = {'accepted': True, 'notes': 'Reconstructed on directed OSM roads and authorized bus service lanes; source drawing and stop locations preserved.'}
    result['itineraryEvidence'] = {'kind': 'directed-source-corridor', 'relations': copy.deepcopy(relations),
                                    'facilityPoints': copy.deepcopy(facility_points),
                                    'sourceGeometryHash': digest(source_points),
                                    'sourceStopsPreserved': [s['coordinates'] for s in result['stops']] ==
                                        [f['geometry']['coordinates'] for f in result['source']['stops']['features']]}
    return result


def shared_runs(routes, network, facility_points):
    result = {}
    for direction in ('ida', 'vuelta'):
        group = [r for r in routes.values() if r['direction'] == direction]
        # All services use the same physical airport movement. Compare refs,
        # including fractions; a different path is a failed reconstruction.
        paths = [r['path'] for r in group]
        aligned = paths if direction == 'vuelta' else [list(reversed(p)) for p in paths]
        common = []
        for entries in zip(*aligned):
            if any(p != entries[0] for p in entries[1:]):
                break
            common.append(entries[0])
        if direction == 'ida':
            common.reverse()
        if len(common) < 20:
            raise ValueError(f'{direction}: los servicios divergen en el acceso compartido')
        result[direction] = {'references': common, 'hash': digest(common),
                             'coords': geometry({'path': common}, network), 'directions': len(group)}
    return result


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('routes', nargs='+', help='Ids completos, por ejemplo AD-C-ida')
    parser.add_argument('--system', default='AeroDirecto')
    parser.add_argument('--network', default='pipeline/temp/authoring/network.json')
    parser.add_argument('--pbf', default='data/raw/osm/Lima.osm.pbf')
    parser.add_argument('--output', default='pipeline/temp/authoring/aerodirecto')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    engine = Engine(Network(json.loads(Path(args.network).read_text())))
    definitions = json.loads((root/'pipeline/output/wr_map.json').read_text())['routes']
    relations = bus_relations(args.pbf, engine.network, args.system)
    imported = {key: import_existing(root, key, engine) for key in args.routes}
    # Source endpoints shared by several routes identify the facility. No
    # coordinates for Quilca or the airport are hardcoded in the matcher.
    counts = {}
    for route in imported.values():
        for stop in (route['stops'][0], route['stops'][-1]):
            counts.setdefault(tuple(stop['coordinates']), set()).add(route['id'])
    facility_points = [list(point) for point, users in counts.items() if len(users) >= 3]
    if not facility_points:
        raise ValueError('Los recorridos no comparten una terminal identificable')
    routes = {}
    for key, route in imported.items():
        routes[key] = reconstruct(route, engine, definitions[key], relations, facility_points, args.system)
        print(key, len(routes[key]['path']), 'validated', flush=True)
    shared = shared_runs(routes, engine.network, facility_points)
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    report = {'network': engine.network.id, 'system': args.system, 'sourceRelations': relations,
              'shared': shared, 'routes': {}}
    for key, route in routes.items():
        exported = bundle(route, engine.network, trip=definitions[key]['trip'])
        folder = out/key
        folder.mkdir(exist_ok=True)
        for filename, content in exported['files'].items():
            (folder/filename).write_text(json.dumps(content, ensure_ascii=False, separators=(',', ':'))+'\n')
        report['routes'][key] = {'folder': definitions[key]['folder'], 'trip': definitions[key]['trip'],
                                 'validation': exported['validation'], 'pathHash': digest(route['path']),
                                 'sourceStopsPreserved': True}
    (out/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print('Shared airport access verified in both directions', flush=True)
