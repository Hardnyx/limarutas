"""Read-only validation of every Wikiroutes direction on the current shared graph."""
from __future__ import annotations
import json
from collections import Counter
from pathlib import Path
from .importer import import_existing, track_coordinates
from .model import validate, geometry, digest
from .network import metres


def audit(root, engine):
    root = Path(root)
    definitions = json.loads((root/'pipeline/output/wr_map.json').read_text())['routes']
    results = {}
    for index, (key, definition) in enumerate(sorted(definitions.items())):
        try:
            route = import_existing(root, key, engine)
            original_network = route['network']
            if original_network != engine.network.id:
                from .policy import candidate
                route = candidate(json.loads((root/definition['folder']/f"route_track_trip{definition.get('trip',1)}.route.json").read_text()), engine.network)
            validation = validate(route, engine.network)
            result = {'ready': validation['ready'], 'issues': dict(Counter(i['code'] for i in validation['issues'])),
                      'segments': len(route['path']), 'stops': len(route['stops']), 'sourceHash': route['source'].get('snapshotHash'),
                      'originalNetwork': original_network}
            if validation['ready']:
                path = root/definition['folder']/f"route_track_trip{definition.get('trip',1)}.osm.geojson"
                old = track_coordinates(json.loads(path.read_text()))[0] if path.exists() else []
                new = geometry(route, engine.network)
                result['preservesPublished'] = len(old) == len(new) and all(metres(a,b)<.05 for a,b in zip(old,new))
        except (ValueError, KeyError, OSError) as error:
            result = {'ready': False, 'issues': {'importFailure': 1}, 'error': str(error)}
        results[key] = result
        if (index+1)%100 == 0:
            print(index+1, sum(r['ready'] for r in results.values()), flush=True)
    return {'version': 1, 'network': engine.network.id, 'kind': 'read-only-route-audit', 'publishedFilesChanged': False,
            'graphHash': digest(engine.network.data), 'routes': results,
            'summary': {'total': len(results), 'ready': sum(r['ready'] for r in results.values()),
                        'blockers': dict(sum((Counter(r['issues']) for r in results.values()), Counter()))}}


if __name__ == '__main__':
    import argparse
    from .engine import Engine
    from .network import Network
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--network', default='pipeline/temp/authoring/network.json')
    parser.add_argument('--report', default='pipeline/temp/authoring/migration/audit-all.json')
    args = parser.parse_args()
    engine = Engine(Network(json.loads(Path(args.network).read_text())))
    result = audit(Path(__file__).resolve().parents[2], engine)
    path = Path(args.report)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(result['summary'], flush=True)
