"""Repair feeder terminal access from named OSM platforms and directed lanes.

Only the terminal approach is certified here. The retained legacy body remains
subject to the native audit, independently of the verified access.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
from pathlib import Path

from .engine import Engine
from .model import attach_stops, digest, geometry, new_route, projection, validate
from .network import Network, metres, normal, profile_allows

PROFILE = {'mode': 'mixed', 'system': 'Alimentadores del Metropolitano'}


def name_tokens(name):
    ignored = {'alimentadora', 'alimentador', 'terminal', 'estacion', 'norte',
               'sur', 'ida', 'vuelta', 'de', 'el', 'la', 'los', 'las'}
    return {w.rstrip('s') for w in re.findall(r'[a-z]+', normal(name)) if w not in ignored}


def source_evidence(pbf, network, station, radius=500):
    import osmium
    if hashlib.sha256(Path(pbf).read_bytes()).hexdigest() != network.data['source']['sha256']:
        raise ValueError('El acceso y la red deben pertenecer al mismo extracto OSM')
    platforms, relations, stations = [], [], []
    class Handler(osmium.SimpleHandler):
        def node(self, node):
            tags = dict(node.tags)
            if tags.get('highway') != 'bus_stop' or tags.get('bus') != 'yes':
                return
            point = [node.location.lon, node.location.lat]
            if metres(point, station['point']) <= radius:
                platforms.append({'id': node.id, 'point': point, 'tags': tags})
        def way(self, way):
            tags = dict(way.tags)
            if tags.get('amenity') == 'bus_station' and name_tokens(tags.get('name', '')) == name_tokens(station['name']):
                points = [[n.lon, n.lat] for n in way.nodes]
                if any(metres(p, station['point']) <= radius for p in points):
                    stations.append({'id': way.id, 'coordinates': points, 'tags': tags})
        def relation(self, relation):
            tags = dict(relation.tags)
            if tags.get('network') == 'Metropolitano' and tags.get('route') == 'bus' and re.match(r'A[NS]-', tags.get('ref', '')):
                relations.append({'id': relation.id, 'tags': tags,
                                  'ways': sorted({m.ref for m in relation.members if m.type == 'w' and m.role not in ('platform', 'stop')})})
    Handler().apply_file(str(pbf), locations=True)
    if len(stations) != 1:
        raise ValueError('La terminal no tiene un recinto OSM inequívoco')
    return {'station': stations[0], 'platforms': platforms, 'relations': relations}


def access_network(network, station, evidence, radius=500):
    members = {w for r in evidence['relations'] for w in r['ways']}
    reserved = [e for e in network.edges.values() if not profile_allows(e, PROFILE)
                and max(metres(station['point'], p) for p in e['coordinates']) < radius
                and ((e.get('highway') == 'service' and ('Metropolitano' in e.get('transitSystems', []) or e['way'] in members))
                     or e.get('highway') == 'busway' and e['way'] in members)]
    private = {e['id'] for e in reserved if e.get('highway') == 'service'}
    if not private:
        raise ValueError('No hay circulación interna de alimentadores identificada')
    points = [p for e in reserved if e['id'] in private for p in e['coordinates']]
    # Include the access circle just outside the station footprint. This box is
    # only a source splice search envelope, never a license to use nearby BRT.
    zone = [min(p[0] for p in points)-.0003, min(p[1] for p in points)-.0003,
            max(p[0] for p in points)+.0003, max(p[1] for p in points)+.0003]
    allowed = {e['id'] for e in reserved}
    edges = [e for e in network.edges.values()
             if (profile_allows(e, PROFILE) or e['id'] in allowed)
             and any(metres(p, station['point']) < 3000 for p in e['coordinates'])]
    return Engine(Network({**network.data, 'edges': edges})), private, allowed, zone


def splice_path(engine, platform, board, profile, item, direction, zone):
    coords = [list(reversed(p)) for p in item['coords']]
    scan = coords if direction == 'ida' else list(reversed(coords))
    def inside(p):
        return zone[0] <= p[0] <= zone[2] and zone[1] <= p[1] <= zone[3]
    first = next((i for i, p in enumerate(scan) if not inside(p)), None)
    if first is None:
        raise ValueError('El trazado no sale del recinto')
    # A source point can have been drawn beyond the gate on the wrong
    # carriageway. Extend to a compatible join; later stop projections must
    # prove that this does not omit or reorder any boarding stop.
    for index in range(max(1, first), min(first+30, len(scan)-1)):
        target, neighbour = scan[index], scan[index+1]
        tangent = [neighbour[k]-target[k] for k in (0, 1)]
        if direction == 'vuelta':
            tangent = [-v for v in tangent]
        choices = []
        for candidate in engine.candidates(target, .2):
            edge = engine.network.edges[candidate['edge']]
            if not profile_allows(edge, PROFILE):
                continue
            a, b = edge['coordinates']
            dot = sum((b[k]-a[k])*tangent[k] for k in (0, 1))
            if not dot or not edge['forward' if dot > 0 else 'backward']:
                continue
            anchor = {'edge': candidate['edge'], 'fraction': candidate['fraction']}
            for at, endpoint in enumerate(edge['coordinates']):
                if metres(target, endpoint) <= .2:
                    anchor['fraction'] = at
                    break
            try:
                path = (engine.connect(board, anchor, profile=profile) if direction == 'ida'
                        else engine.connect(anchor, board, profile=profile))
            except ValueError:
                continue
            length = sum(metres(*engine.network.coordinates(r)) for r in path)
            public = [r for r in path if profile_allows(engine.network.edges[r['edge']], PROFILE)]
            public_length = sum(metres(*engine.network.coordinates(r)) for r in public)
            gate = (engine.network.coordinates(public[0])[0] if direction == 'ida'
                    else engine.network.coordinates(public[-1])[1]) if public else target
            # Measure detours outside the terminal independently. The internal
            # one-way circuit can legitimately travel away from the destination.
            if public_length > metres(gate, target)*2+400:
                continue
            choices.append((length, path))
        if choices:
            return index, min(choices, key=lambda c: c[0])[1]
    raise ValueError('No existe una unión legal próxima al trazado fuente')


def verified_access(item, network):
    access = item['terminalAccess']
    first, last = access['range']
    refs = access['references']
    if (access['network'] != network.id or access['hash'] != digest(refs)
            or not 0 <= first < last < len(item['coords'])
            or (first != 0 and last != len(item['coords'])-1)
            or [list(reversed(p)) for p in geometry({'path': refs}, network)] != item['coords'][first:last+1]):
        raise ValueError('El acceso de terminal no corresponde a sus referencias OSM')
    core = item['coords'][last+1:] if first == 0 else item['coords'][:first]
    if digest(core) != access['retainedGeometryHash']:
        raise ValueError('El cuerpo conservado del alimentador cambió sin revisión')
    boarding = access['boardingPoint']
    if boarding['network'] != network.id or boarding['kind'] != 'osm-platform':
        raise ValueError('Andén de terminal sin procedencia válida')
    endpoint = item['coords'][first if first == 0 else last]
    if metres(boarding['coordinates'], list(reversed(endpoint))) > 35:
        raise ValueError('El acceso no conecta con el andén documentado')
    profile = {**PROFILE, 'reservedEdges': sorted({r['edge'] for r in refs if not profile_allows(network.edges[r['edge']], PROFILE)})}
    piece = new_route('access', 'Acceso de terminal', 'access', network)
    piece.update(path=refs, profile=profile, stops=[
        {'id': 'start', 'name': 'Inicio', 'coordinates': list(reversed(item['coords'][first]))},
        {'id': 'end', 'name': 'Fin', 'coordinates': list(reversed(item['coords'][last]))}])
    if not validate(attach_stops(piece, network), network)['ready']:
        raise ValueError('El acceso de terminal viola la red dirigida')
    return refs, profile


def repair_service(service, identity, network, station, evidence, prepared=None):
    engine, private, allowed, zone = prepared or access_network(network, station, evidence)
    platforms = [p for p in evidence['platforms']
                 if name_tokens(p['tags'].get('name', '')) == name_tokens('Terminal '+station['name']+' '+service['name'])]
    if len(platforms) != 1:
        raise ValueError(f'{identity}: andén ausente o ambiguo; revisar la fuente')
    platform = platforms[0]
    candidates = [c for c in engine.candidates(platform['point'], 35) if c['edge'] in private]
    if not candidates:
        return copy.deepcopy(service), False  # A documented outside platform.
    nearest = candidates[0]
    board = {'edge': nearest['edge'], 'fraction': nearest['fraction']}
    result = copy.deepcopy(service)
    for direction in ('ida', 'vuelta'):
        item = service[direction]
        if item.get('terminalAccess'):
            verified_access(item, network)
            continue
        profile = {**PROFILE, 'reservedEdges': sorted(allowed)}
        join, refs = splice_path(engine, platform, board, profile, item, direction, zone)
        access_coords = [list(reversed(p)) for p in geometry({'path': refs}, network)]
        core = item['coords'][join+1:] if direction == 'ida' else item['coords'][:-join-1]
        coords = access_coords+core if direction == 'ida' else core+access_coords
        first = 0 if direction == 'ida' else len(core)
        last = first+len(access_coords)-1
        boarding = {'kind': 'osm-platform', 'id': platform['id'], 'coordinates': platform['point'],
                    'name': platform['tags']['name'], 'network': network.id}
        access = {'terminal': station['id'], 'stationWay': evidence['station']['id'],
                  'network': network.id, 'references': refs, 'hash': digest(refs), 'range': [first, last],
                  'boardingPoint': boarding, 'retainedGeometryHash': digest(core),
                  'sourceGeometryHash': digest(item['coords'])}
        rebuilt = {**item, 'coords': coords, 'terminalAccess': access}
        verified_access(rebuilt, network)
        # Project distances onto the new drawing, keeping source station/stop
        # coordinates and identities. The common station marker is not a lane.
        route = new_route(identity, service['name'], direction, network)
        route['path'] = [{'type': 'gap', 'coordinates': [list(reversed(p)) for p in coords]}]
        route['stops'] = [{'id': s['id'], 'name': s['name'], 'coordinates': [s['lon'], s['lat']],
                           **({'boardingPoint': boarding} if s['id'] == 'met:'+station['id'] else {})}
                          for s in item['stops']]
        placed = attach_stops(route, network)['stops']
        if any(s['position'] is None for s in placed) or [s['position']['alongM'] for s in placed] != sorted(s['position']['alongM'] for s in placed):
            raise ValueError(f'{identity}:{direction}: el acceso perdería un paradero')
        cumulative = [0.0]
        for a, b in zip(coords, coords[1:]):
            cumulative.append(cumulative[-1]+metres(list(reversed(a)), list(reversed(b))))
        old_distance = [0.0]
        for a, b in zip(item['coords'], item['coords'][1:]):
            old_distance.append(old_distance[-1]+metres(list(reversed(a)), list(reversed(b))))
        old_join = join if direction == 'ida' else len(item['coords'])-join-1
        offset = cumulative[last]-old_distance[old_join] if direction == 'ida' else 0
        rebuilt['stops'] = []
        for stop, position in zip(item['stops'], placed):
            retained = stop['at'] > old_join if direction == 'ida' else stop['at'] < old_join
            if retained:
                at = stop['at']+len(access_coords)-join-1 if direction == 'ida' else stop['at']
                m = round(stop['m']+offset)
            else:
                m = round(position['position']['alongM'])
                at = min(range(len(coords)), key=lambda i: abs(cumulative[i]-position['position']['alongM']))
            rebuilt['stops'].append({**stop, 'at': at, 'm': m})
        if [s['m'] for s in rebuilt['stops']] != sorted(s['m'] for s in rebuilt['stops']):
            raise ValueError(f'{identity}:{direction}: la unión cambia el orden de paraderos')
        # Legacy instructions for the replaced approach would describe the old
        # road. Do not keep stale turn instructions for this direction.
        rebuilt.pop('pasos', None)
        rebuilt.pop('sin_calle', None)
        result[direction] = rebuilt
    return result, True


def build(document, terminal, station, network, evidence):
    result, changed, external = copy.deepcopy(document), [], []
    prepared = access_network(network, station, evidence)
    for identity, service in document['services'].items():
        if service.get('terminal') != terminal:
            continue
        result['services'][identity], internal = repair_service(service, identity, network, station, evidence, prepared)
        (changed if internal else external).append(identity)
    result['updated'] = network.data['source']['timestamp'][:10]
    return result, {'terminal': terminal, 'network': network.id, 'internal': changed, 'external': external}


def refresh_instructions(document, refs, network):
    """Describe exact street runs; unresolved body geometry stays explicit."""
    from .trace import GeometryTrace
    engine = Engine(network)
    trace = GeometryTrace(engine)
    for identity in refs:
        for direction in ('ida', 'vuelta'):
            item = document['services'][identity][direction]
            access, _ = verified_access(item, network)
            first, last = item['terminalAccess']['range']
            if first == 0:
                body = trace.parts([[list(reversed(p)) for p in item['coords'][last:]]])
                path = access + body
            else:
                body = trace.parts([[list(reversed(p)) for p in item['coords'][:first+1]]])
                path = body + access
            runs, nodes, gaps = [], [], 0
            for ref in path:
                if ref['type'] == 'gap':
                    if len(nodes) > 1:
                        runs.append({'nodos': nodes})
                    nodes, gaps = [], gaps+1
                    continue
                a, b = network.edges[ref['edge']]['nodes']
                if ref['end'] < ref['start']:
                    a, b = b, a
                if nodes and nodes[-1] != a:
                    if len(nodes) > 1:
                        runs.append({'nodos': nodes})
                    nodes = []
                if not nodes:
                    nodes = [a]
                nodes.append(b)
            if len(nodes) > 1:
                runs.append({'nodos': nodes})
            item['pasos'] = engine.matcher.steps({'tramos': runs, 'sueltos': []})
            item['sin_calle'] = gaps


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('terminal')
    parser.add_argument('--network', default='pipeline/temp/authoring/network.json')
    parser.add_argument('--pbf', default='data/raw/osm/Lima.osm.pbf')
    parser.add_argument('--source', help='Contrato original de alimentadores; por defecto el publicado')
    parser.add_argument('--output', default='pipeline/temp/authoring/terminal-access')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    folder = root/'data/processed/metropolitano'
    record = next(s for s in json.loads((folder/'metropolitano_stops.json').read_text())['stations'] if s['id'] == args.terminal)
    station = {'id': record['id'], 'name': record['name'], 'point': [record['lon'], record['lat']]}
    net = Network(json.loads(Path(args.network).read_text()))
    evidence = source_evidence(args.pbf, net, station)
    source = Path(args.source) if args.source else folder/'alimentadores_paths.json'
    result, report = build(json.loads(source.read_text()), args.terminal, station, net, evidence)
    refresh_instructions(result, report['internal'], net)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    (output/'alimentadores_paths.json').write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'))+'\n')
    (output/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(report, ensure_ascii=False))
