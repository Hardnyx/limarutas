"""Read-only Lima pilot: source preservation, shared geometry and busway policies."""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

from .engine import Engine
from .importer import import_existing
from .model import geometry, validate
from .network import Network, profile_allows


def audit(root, network):
    engine = Engine(network)
    keys = ['1087-ida', '1087-vuelta', '303-ida', '303-vuelta', '206-ida', '206-vuelta']
    routes, report = {}, {}
    for key in keys:
        route = import_existing(root, key, engine)
        original_stops = route['source']['stops']['features']
        assert [s['coordinates'] for s in route['stops']] == [s['geometry']['coordinates'][:2] for s in original_stops]
        assert [s['id'] for s in route['stops']] == [str(s['properties']['stop_id']) for s in original_stops]
        validation = validate(route, network)
        report[key] = {'segments': len(route['path']), 'stops': len(route['stops']),
                       'issues': dict(Counter(i['code'] for i in validation['issues'])),
                       'ready': validation['ready'], 'accepted': validation['accepted'],
                       'sourceStopsPreserved': True}
        routes[key] = {ref['edge'] for ref in route['path'] if ref['type'] == 'street'}
    shared = []
    for i, a in enumerate(keys):
        for b in keys[i+1:]:
            count = len(routes[a] & routes[b])
            if count:
                shared.append({'routes': [a, b], 'canonicalSegments': count})
    reserved = next(edge for edge in network.edges.values() if edge['facility'] == 'separate_busway'
                    and 'metropolitano' in edge['name'].casefold() and edge['forward'])
    assert not profile_allows(reserved, {'mode': 'mixed'})
    assert profile_allows(reserved, {'mode': 'brt', 'system': 'Metropolitano'})
    # Build an actual reserved OSM segment, using real endpoint nodes as evidence.
    request = {'id': 'audit-brt-ida', 'name': 'Auditoría de calzada', 'direction': 'ida',
               'anchors': [{'edge': reserved['id'], 'fraction': 0}, {'edge': reserved['id'], 'fraction': 1}],
               'allowedWays': [reserved['way']], 'profile': {'mode': 'brt', 'system': 'Metropolitano'},
               'stops': [{'id': f"osm:{node}", 'name': f'Nodo OSM {node}', 'coordinates': network.nodes[node]}
                         for node in reserved['nodes']]}
    built = engine.build(request)
    assert geometry(built, network) == reserved['coordinates']
    try:
        engine.build({**request, 'profile': {'mode': 'mixed'}})
    except ValueError:
        pass
    else:
        raise AssertionError('Un bus mixto pudo construir la calzada reservada')
    return {'network': network.id, 'kind': 'read-only-pilot', 'publishedFilesChanged': False,
            'routes': report, 'sharedSegments': shared,
            'buswayCheck': {'edge': reserved['id'], 'name': reserved['name'], 'facility': reserved['facility'],
                            'brtUsesActualGeometry': True, 'mixedBusRejected': True}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--network', default='pipeline/temp/authoring/network.json')
    parser.add_argument('--report', default='pipeline/temp/authoring/pilot.json')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    result = audit(root, Network(json.loads(Path(args.network).read_text())))
    Path(args.report).write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))
