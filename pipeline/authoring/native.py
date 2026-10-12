"""Import native Metropolitano/feeder contracts without moving source stations."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

from .importer import stop_records
from .model import attach_stops, coordinate, digest, geometry, new_route
from .reconcile import seal_source
from .trace import GeometryTrace

DIRECTORY = 'data/processed/metropolitano'


def read(root, name):
    path = Path(root) / DIRECTORY / name
    raw = path.read_bytes()
    return json.loads(raw), (path.relative_to(root).as_posix(), hashlib.sha256(raw).hexdigest())


def catalog(root):
    root = Path(root)
    result = {}
    for filename, field, prefix in [('metropolitano_paths.json', 'paths', 'met'),
                                    ('alimentadores_paths.json', 'services', 'alim')]:
        path = root / DIRECTORY / filename
        if not path.exists():
            continue
        data = json.loads(path.read_text())
        for key, value in data[field].items():
            for direction in (('ida', 'vuelta') if prefix == 'alim' else (None,)):
                if direction and not value.get(direction):
                    continue
                identity = f'{prefix}:{key}' + (f':{direction}' if direction else '')
                result[identity] = {'name': (value.get('name') or key) + (f' ({direction})' if direction else ''),
                                    'file': path.relative_to(root).as_posix(), 'kind': prefix}
    return result


def import_native(root, key, engine, trace=None):
    definitions = catalog(root)
    if key not in definitions:
        raise ValueError('Sentido nativo no encontrado')
    hashes, warnings, references = {}, [], None
    def load(name):
        data, (path, checksum) = read(root, name)
        hashes[path] = checksum
        return data
    prefix, service_id, direction = key.split(':', 2)
    if prefix == 'met':
        document = load('metropolitano_paths.json')
        item = document['paths'][f'{service_id}:{direction}']
        services = load('metropolitano_services.json')['services']
        service = next((s for s in services if str(s['id']) == service_id), None)
        if service is None:
            raise ValueError('Servicio del Metropolitano sin definición')
        ids = service.get('north_south' if direction == 'ns' else 'south_north', [])
        stations = {s['id']: s for s in load('metropolitano_stops.json')['stations']}
        records = []
        for sid in ids:
            station = stations.get(sid)
            if station is None or station.get('lat') is None or station.get('lon') is None:
                warnings.append(f'Estación sin coordenadas: {sid}')
                continue
            records.append({**station, 'id': f'met:{sid}'})
        if len(item.get('at', [])) != len(records) or len(item.get('m', [])) != len(records):
            warnings.append('Las estaciones de servicio y los índices del trazado no coinciden')
        profile = {'mode': 'brt', 'system': 'Metropolitano'}
        name = service.get('name', service_id)
        if item.get('backboneRange'):
            from .macros import macro_id, slice_references
            shared = load('metropolitano_backbones.json')
            macro = macro_id(service, direction)
            base = shared['backbones'][f'{macro}:{direction}']
            first, last = item['backboneRange']
            if (item.get('macro') != macro or item.get('backboneHash') != base['hash']
                    or item.get('network') != base['network'] or item['coords'] != base['coords'][first:last+1]):
                raise ValueError('El servicio no sigue su macrorruta compartida')
            references = slice_references(base, first, last, engine.network)
    else:
        document = load('alimentadores_paths.json')
        service = document['services'][service_id]
        item = service[direction]
        records = item['stops']
        profile = {'mode': 'mixed', 'system': 'Alimentadores del Metropolitano'}
        name = service.get('name', service_id)
        if item.get('pathReferences') is not None:
            references = item['pathReferences']
            if (item.get('network') != engine.network.id or item.get('pathHash') != digest(references)
                    or [list(reversed(p)) for p in geometry({'path': references}, engine.network)] != item['coords']):
                raise ValueError('El alimentador no corresponde a sus referencias OSM verificadas')
        elif item.get('terminalAccess'):
            from .terminals import verified_access
            access_refs, profile = verified_access(item, engine.network)
            first, last = item['terminalAccess']['range']
            access_trace = trace or GeometryTrace(engine)
            if first == 0:
                body = [list(reversed(p)) for p in item['coords'][last:]]
                references = access_refs + access_trace.parts([body])
            else:
                body = [list(reversed(p)) for p in item['coords'][:first+1]]
                references = access_trace.parts([body]) + access_refs
    points = [coordinate([p[1], p[0]]) for p in item['coords']]
    if len(points) < 2:
        raise ValueError('El sentido nativo no tiene un trazado válido')
    track = {'type': 'FeatureCollection', 'features': [{'type': 'Feature',
             'properties': {'nativeId': key}, 'geometry': {'type': 'LineString', 'coordinates': points}}]}
    stops = {'type': 'FeatureCollection', 'features': [{'type': 'Feature',
             'properties': {**copy.deepcopy(s), 'stop_id': str(s['id']), 'seq': i+1},
             'geometry': {'type': 'Point', 'coordinates': coordinate([s['lon'], s['lat']])}}
            for i, s in enumerate(records)]}
    source = {'kind': 'native-bus', 'nativeKind': prefix, 'nativeId': key,
              'track': track, 'stops': stops, 'native': copy.deepcopy(item),
              'service': copy.deepcopy(service), 'provenance': {'files': hashes},
              'importWarnings': warnings}
    route = new_route(key, name, direction, engine.network, source)
    route['profile'] = profile
    route['stops'] = stop_records(stops)
    if prefix == 'alim':
        for stop in route['stops']:
            if stop['properties'].get('boardingPoint'):
                stop['boardingPoint'] = copy.deepcopy(stop['properties']['boardingPoint'])
    if prefix == 'alim' and item.get('terminalAccess'):
        access = item['terminalAccess']
        for stop in route['stops']:
            if stop['id'] == 'met:' + access['terminal']:
                stop['boardingPoint'] = copy.deepcopy(access['boardingPoint'])
    route['importWarnings'] = warnings
    route['path'] = references if references is not None else (trace or GeometryTrace(engine)).parts([points])
    return seal_source(attach_stops(route, engine.network))


def audit(root, engine, directory=None):
    from collections import Counter
    from .model import digest, validate
    trace, routes = GeometryTrace(engine), {}
    for key in sorted(catalog(root)):
        try:
            route = import_native(root, key, engine, trace)
            validation = validate(route, engine.network)
            routes[key] = {'ready': validation['ready'],
                           'issues': dict(Counter(i['code'] for i in validation['issues'])),
                           'segments': len(route['path']), 'stops': len(route['stops']),
                           'profile': route['profile'], 'sourceHash': route['source']['snapshotHash'],
                           'sourceFiles': route['source']['provenance']['files'],
                           'sourceStopsPreserved': [s['coordinates'] for s in route['stops']] ==
                               [s['geometry']['coordinates'] for s in route['source']['stops']['features']]}
            if directory:
                path = Path(directory) / (digest(key)[:24] + '.json')
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(route, ensure_ascii=False, separators=(',', ':'))+'\n')
        except (ValueError, KeyError, OSError) as error:
            routes[key] = {'ready': False, 'issues': {'importFailure': 1}, 'error': str(error)}
        print(key, routes[key]['issues'], flush=True)
    return {'version': 1, 'network': engine.network.id, 'kind': 'read-only-native-audit',
            'publishedFilesChanged': False, 'routes': routes,
            'summary': {'total': len(routes), 'ready': sum(r['ready'] for r in routes.values()),
                        'blockers': dict(sum((Counter(r['issues']) for r in routes.values()), Counter()))}}


if __name__ == '__main__':
    import argparse
    from .engine import Engine
    from .network import Network
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--network', default='pipeline/temp/authoring/network.json')
    parser.add_argument('--root', default=str(Path(__file__).resolve().parents[2]))
    parser.add_argument('--drafts', default='pipeline/temp/authoring/native/drafts')
    parser.add_argument('--report', default='pipeline/temp/authoring/native/audit.json')
    args = parser.parse_args()
    engine = Engine(Network(json.loads(Path(args.network).read_text())))
    result = audit(args.root, engine, args.drafts)
    path = Path(args.report)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(result['summary'], ensure_ascii=False))
