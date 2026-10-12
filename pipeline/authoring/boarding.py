"""Bind boarding-platform evidence to outbound feeder trips and directed access."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

from .model import coordinate
from .network import Network, metres, profile_allows
from .terminals import (PROFILE, access_network, name_tokens, refresh_instructions,
                        replace_access, source_evidence, splice_path, verified_access)


def apply_boarding(document, collection, station, network, evidence, provenance):
    if collection.get('type') != 'FeatureCollection':
        raise ValueError('Los embarques deben ser un GeoJSON FeatureCollection')
    result, assigned = copy.deepcopy(document), {}
    engine, private, allowed, zone = access_network(network, station, evidence)
    osm = {p['id']: p for p in evidence['platforms']}
    for feature in collection['features']:
        props = feature['properties']
        if props.get('status') != 'current' or props.get('point_type') != 'boarding_platform':
            continue
        if feature.get('geometry', {}).get('type') != 'Point':
            raise ValueError('El embarque requiere una geometría Point')
        point = coordinate(feature['geometry']['coordinates'])
        matches = [key for key, svc in document['services'].items()
                   if svc.get('terminal') == station['id'] and name_tokens(svc['name']) == name_tokens(props['route_name'])]
        if len(matches) != 1 or matches[0] in assigned:
            raise ValueError(f'{props["route_name"]}: asociación de embarque ausente o ambigua')
        key = matches[0]
        node = props['osm_node']
        if node not in osm or metres(point, osm[node]['point']) > 3:
            raise ValueError(f'{key}: la plataforma no corresponde al nodo OSM declarado')
        if type(props['boarding_number']) is not int or props['boarding_number'] < 1:
            raise ValueError('Número de embarque inválido')
        boarding = {'kind': 'osm-platform', 'id': node, 'coordinates': point, 'network': network.id,
                    'role': 'boarding', 'number': props['boarding_number'], 'routeCode': props['route_code'],
                    'name': f'{station["name"]} · Embarque {props["boarding_number"]} · {props["route_name"]}',
                    'codeAuthority': copy.deepcopy(props.get('route_code_authority', {})),
                    'source': {**provenance, 'feature': feature.get('id') or props['id']}}
        service = result['services'][key]
        item = service['ida']
        if item.get('terminalAccess'):
            item['terminalAccess']['boardingPoint'] = copy.deepcopy(boarding)
            verified_access(item, network)
        else:
            # External platforms must start on their adjacent public roadway,
            # rather than be pulled through the internal terminal circuit.
            candidates = [c for c in engine.candidates(point, 35)
                          if profile_allows(engine.network.edges[c['edge']], PROFILE)]
            choices = []
            for candidate in candidates[:4]:
                try:
                    join, refs = splice_path(engine, {'point': point},
                                            {'edge': candidate['edge'], 'fraction': candidate['fraction']},
                                            PROFILE, item, 'ida', zone)
                    choices.append((join, candidate['distanceM'], refs))
                except ValueError:
                    continue
            if not choices:
                raise ValueError(f'{key}: no existe una salida legal desde el embarque')
            join, _, refs = min(choices, key=lambda c: (c[0], c[1]))
            item = replace_access(item, key, service['name'], network, station, 'ida', join, refs,
                                  boarding, evidence['station']['id'])
            service['ida'] = item
        terminal = next((s for s in item['stops'] if s['id'] == 'met:'+station['id']), None)
        if terminal is None or terminal is not item['stops'][0]:
            raise ValueError(f'{key}: el sentido de salida no comienza en la terminal')
        terminal['boardingPoint'] = copy.deepcopy(boarding)
        service['boarding'] = copy.deepcopy(boarding)
        assigned[key] = {'sourceRouteCode': props['route_code'], 'number': props['boarding_number'],
                         'point': point, 'platform': node}
    expected = {key for key, svc in document['services'].items() if svc.get('terminal') == station['id']}
    if set(assigned) != expected:
        raise ValueError('La capa de embarques no cubre todos los alimentadores de esta terminal')
    refresh_instructions(result, assigned, network, directions=('ida',))
    return result, {'terminal': station['id'], 'network': network.id, 'scope': 'outbound-boarding-only',
                    'source': provenance, 'routes': assigned, 'arrivalGeometryChanged': False}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('terminal')
    parser.add_argument('--platforms', default='data/raw/metropolitano/naranjal_boarding_platforms.geojson')
    parser.add_argument('--network', default='pipeline/temp/authoring/network.json')
    parser.add_argument('--pbf', default='data/raw/osm/Lima.osm.pbf')
    parser.add_argument('--output', default='pipeline/temp/authoring/boarding')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    folder = root/'data/processed/metropolitano'
    station = next(s for s in json.loads((folder/'metropolitano_stops.json').read_text())['stations'] if s['id'] == args.terminal)
    station = {'id': station['id'], 'name': station['name'], 'point': [station['lon'], station['lat']]}
    raw = Path(args.platforms).read_bytes()
    file = Path(args.platforms).resolve()
    provenance = {'file': file.relative_to(root).as_posix() if file.is_relative_to(root) else file.name,
                  'sha256': hashlib.sha256(raw).hexdigest()}
    network = Network(json.loads(Path(args.network).read_text()))
    evidence = source_evidence(args.pbf, network, station)
    result, report = apply_boarding(json.loads((folder/'alimentadores_paths.json').read_text()),
                                    json.loads(raw), station, network, evidence, provenance)
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    (out/'alimentadores_paths.json').write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'))+'\n')
    (out/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(report, ensure_ascii=False), flush=True)
