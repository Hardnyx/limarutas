"""Build continuous directed BRT backbones; services are slices, not stop links."""
from __future__ import annotations

import copy
import json
from pathlib import Path

from .engine import Engine
from .importer import stop_records, track_coordinates
from .model import attach_stops, digest, geometry, new_route, validate
from .network import Network, metres, normal

PROFILE = {'mode': 'brt', 'system': 'Metropolitano'}
A_STATIONS = ('ramon-castilla', 'tacna', 'jiron-de-la-union', 'colmena')


def macro_id(service, direction=None):
    if service.get('macro') in ('A', 'B'):
        return service['macro']
    field = {'ns': 'north_south', 'sn': 'south_north'}.get(direction)
    ids = service.get(field, service.get('stops', [])) if field else [*service.get('stops', []), *service.get('north_south', []), *service.get('south_north', [])]
    return 'A' if any(str(s).startswith(A_STATIONS) for s in ids) else 'B'


def brt_network(network):
    edges = [e for e in network.edges.values() if normal(e['name']) == 'metropolitano'
             or 'metropolitano' in {normal(s) for s in e.get('transitSystems', [])}]
    if not edges:
        raise ValueError('La red OSM no identifica las vías del Metropolitano')
    return Network({**network.data, 'edges': edges})


def build_backbone(engine, points, identity):
    """All macro guide points constrain one continuous path on actual BRT ways."""
    layers = []
    for point in points:
        candidates = engine.candidates(point, 150)
        closest = candidates[0]['distanceM'] if candidates else 150
        candidates = [c for c in candidates[:8] if c['distanceM'] <= closest+35]
        if not candidates:
            raise ValueError(f'{identity}: punto de la macrorruta sin calzada segregada OSM a menos de 150 m: {point}')
        layers.append(candidates)
    states = [(c['distanceM']*2, [], {'edge': c['edge'], 'fraction': c['fraction']}) for c in layers[0]]
    for index, layer in enumerate(layers[1:], 1):
        following = []
        for candidate in layer:
            target = {'edge': candidate['edge'], 'fraction': candidate['fraction']}
            choices = []
            for cost, history, start in states:
                if start == target:
                    choices.append((cost+candidate['distanceM']*2, history, target))
                    continue
                try:
                    refs = engine.connect(start, target, incoming=history[-1]['edge'] if history else None,
                                          profile=PROFILE, history=history)
                except ValueError:
                    continue
                length = sum(metres(*engine.network.coordinates(r)) for r in refs)
                # A missing network connection must fail, not route across half the city.
                if length > metres(points[index-1], points[index])*3 + 500:
                    continue
                choices.append((cost+length+candidate['distanceM']*2, history+refs, target))
            if choices:
                following.append(min(choices, key=lambda c: c[0]))
        if not following:
            raise ValueError(f'{identity}: no hay una conexión BRT continua en el paso {index}; requiere revisar OSM')
        states = following
    refs = min(states, key=lambda c: c[0])[1]
    route = new_route(identity, identity, identity.rsplit(':', 1)[-1], engine.network)
    route['profile'], route['path'] = copy.deepcopy(PROFILE), refs
    route['stops'] = [{'id': f'guide:{i}', 'name': f'Paso {i}', 'coordinates': point} for i, point in enumerate(points)]
    route = attach_stops(route, engine.network)
    validation = validate(route, engine.network)
    if not validation['ready']:
        raise ValueError(f'{identity}: la macrorruta no pasa la validación: {validation["issues"]}')
    return {'path': refs, 'coords': [list(reversed(p)) for p in geometry(route, engine.network)],
            'hash': digest(refs), 'network': engine.network.id}


def service_path(engine, backbone, service, direction, stations):
    field = 'north_south' if direction == 'ns' else 'south_north'
    ids = service.get(field, [])
    if not ids:
        return None
    if len(ids) < 2 or any(s not in stations or stations[s].get('lat') is None for s in ids):
        raise ValueError(f'{service["id"]}:{direction}: faltan estaciones con coordenadas')
    route = new_route(f'met:{service["id"]}:{direction}', service.get('name', str(service['id'])), direction, engine.network)
    route['profile'], route['path'] = copy.deepcopy(PROFILE), copy.deepcopy(backbone['path'])
    route['stops'] = [{'id': f'met:{sid}', 'name': stations[sid]['name'],
                       'coordinates': [stations[sid]['lon'], stations[sid]['lat']]} for sid in ids]
    route = attach_stops(route, engine.network)
    if not validate(route, engine.network)['ready']:
        raise ValueError(f'{route["id"]}: las estaciones no encajan en la macrorruta elegida')
    coords = backbone['coords']
    cumulative = [0.0]
    for a, b in zip(coords, coords[1:]):
        cumulative.append(cumulative[-1]+metres(list(reversed(a)), list(reversed(b))))
    indexes = [min(range(len(cumulative)), key=lambda i: abs(cumulative[i]-s['position']['alongM'])) for s in route['stops']]
    first, last = indexes[0], indexes[-1]
    if last <= first or any(a>b for a, b in zip(indexes, indexes[1:])):
        raise ValueError(f'{route["id"]}: estaciones fuera de orden en la macrorruta')
    return {'coords': copy.deepcopy(coords[first:last+1]), 'at': [i-first for i in indexes],
            'm': [round(cumulative[i]-cumulative[first]) for i in indexes],
            'macro': macro_id(service, direction), 'backboneHash': backbone['hash'], 'network': backbone['network'],
            'backboneRange': [first, last]}


def slice_references(backbone, first, last, network):
    """Cut only at retained OSM vertices, preserving the shared street references."""
    if backbone['network'] != network.id or digest(backbone['path']) != backbone['hash']:
        raise ValueError('La macrorruta pertenece a otra red o sus referencias cambiaron')
    route = {'path': backbone['path']}
    coords = [list(reversed(p)) for p in geometry(route, network)]
    if coords != backbone['coords'] or not 0 <= first < last < len(coords):
        raise ValueError('La geometría de la macrorruta no corresponde a sus referencias')
    refs, cursor = [], 0
    for ref in backbone['path']:
        a, b = network.coordinates(ref)
        step = int(a != b)
        if first <= cursor and cursor+step <= last:
            refs.append(copy.deepcopy(ref))
        cursor += step
    if [list(reversed(p)) for p in geometry({'path': refs}, network)] != coords[first:last+1]:
        raise ValueError('El recorte no conserva todos los vértices de la macrorruta')
    return refs


def build(root, network):
    root, engine = Path(root), Engine(brt_network(network))
    folder = root / 'data/processed/metropolitano'
    backbones, source_hashes = {}, {}
    for identity in ('A', 'B'):
        path = folder / 'trayectos-macro' / f'{identity}-mid.geojson'
        source = json.loads(path.read_text())
        parts = track_coordinates(source)
        if len(parts) != 1:
            raise ValueError('La guía de una macrorruta debe ser continua')
        points = parts[0]
        # Existing macro files may be stored south-to-north under both suffixes.
        northward = points if points[0][1] < points[-1][1] else list(reversed(points))
        for direction, line in [('sn', northward), ('ns', list(reversed(northward)))]:
            key = f'{identity}:{direction}'
            backbones[key] = build_backbone(engine, line, f'macro:{key}')
            print(key, len(backbones[key]['coords']), flush=True)
        source_hashes[path.relative_to(root).as_posix()] = digest(source)
    services = json.loads((folder / 'metropolitano_services.json').read_text())['services']
    stations = {s['id']: s for s in json.loads((folder / 'metropolitano_stops.json').read_text())['stations']}
    paths = {}
    for service in services:
        for direction in ('ns', 'sn'):
            value = service_path(engine, backbones[f'{macro_id(service, direction)}:{direction}'], service, direction, stations)
            if value:
                paths[f'{service["id"]}:{direction}'] = value
    result = {'version': 1, 'network': network.id, 'sourceGuides': source_hashes, 'backbones': backbones}
    return result, {'updated': network.data['source']['timestamp'][:10], 'paths': paths}


def verify_slices(backbones, paths, services):
    """Verify every service, including express gaps across the downtown fork."""
    expected = {f'{s["id"]}:{d}' for s in services for d, field in [('ns', 'north_south'), ('sn', 'south_north')] if s.get(field)}
    if set(paths['paths']) != expected:
        raise ValueError('Faltan sentidos del Metropolitano o hay sentidos inexistentes')
    definitions = {str(s['id']): s for s in services}
    for key, value in paths['paths'].items():
        sid, direction = key.rsplit(':', 1)
        macro = macro_id(definitions[sid], direction)
        base = backbones['backbones'][f'{macro}:{direction}']
        first, last = value['backboneRange']
        if (not 0 <= first < last < len(base['coords'])
                or value['macro'] != macro or value['backboneHash'] != base['hash']
                or value['network'] != base['network'] or value['coords'] != base['coords'][first:last+1]):
            raise ValueError(f'{key}: el recorrido dejó de seguir la macrorruta compartida')
        ids = definitions[sid]['north_south' if direction == 'ns' else 'south_north']
        if len(value['at']) != len(ids) or len(value['m']) != len(ids):
            raise ValueError(f'{key}: los índices no corresponden a las estaciones')
        if (value['at'][0] != 0 or value['at'][-1] != last-first
                or value['at'] != sorted(value['at']) or value['m'] != sorted(value['m'])):
            raise ValueError(f'{key}: las estaciones no respetan el orden de la macrorruta')
    return True
