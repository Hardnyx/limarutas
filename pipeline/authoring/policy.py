"""Revalidate accepted references against a changed policy on the same extract."""
from __future__ import annotations
import copy
import json
from pathlib import Path
from .model import attach_stops, digest, geometry, validate
from .published import verify_published, folder_files
from .exporter import bundle


def candidate(route, network):
    if route['exported']['sourceSha256'] != network.data['source']['sha256']:
        raise ValueError('Cambió el extracto OSM; requiere migración geométrica explícita')
    proposed = copy.deepcopy(route)
    proposed['network'] = network.id
    if digest({'type': 'LineString', 'coordinates': geometry(proposed, network)}) != route['exported']['geometryHash']:
        raise ValueError('Las referencias cambiaron de geometría')
    proposed.pop('exported', None)
    proposed['review']['accepted'] = False
    return attach_stops(proposed, network)


def revalidate(root, engine, publish=False):
    root = Path(root)
    definitions = json.loads((root/'pipeline/output/wr_map.json').read_text())['routes']
    report, changes = {}, []
    for key, definition in sorted(definitions.items()):
        folder, trip, sidecar = folder_files(root, definition)
        if not sidecar.exists():
            continue
        route = json.loads(sidecar.read_text())
        if route['network'] == engine.network.id:
            continue
        original = json.loads((folder/f'route_track_trip{trip}.geojson').read_text())
        stops = json.loads((folder/f'stops_trip{trip}.geojson').read_text())
        track_path = folder/f'route_track_trip{trip}.osm.geojson'
        verify_published(route, json.loads(track_path.read_text()), original, stops, trip, key)
        proposed = candidate(route, engine.network)
        validation = validate(proposed, engine.network)
        report[key] = {'ready': validation['ready'], 'issues': validation['issues'],
                       'from': route['network'], 'to': engine.network.id}
        if not validation['ready']:
            continue
        proposed['revision'] += 1
        proposed['review']['accepted'] = True
        proposed['review']['notes'] += ' Revalidado con nueva política sobre el mismo extracto; geometría y paraderos intactos.'
        files = bundle(proposed, engine.network, trip=trip)['files']
        if files[f'stops_trip{trip}.geojson'] != stops:
            raise ValueError(f'{key}: los paraderos cambiaron')
        verify_published(files[sidecar.name], files[track_path.name], original, stops, trip, key)
        for path in (sidecar, track_path):
            changes.append((path, path.read_bytes(), json.dumps(files[path.name], ensure_ascii=False, separators=(',', ':')).encode()+b'\n'))
    if publish:
        written = []
        try:
            for path, before, after in changes:
                path.write_bytes(after)
                written.append((path, before))
        except BaseException:
            for path, before in reversed(written):
                path.write_bytes(before)
            raise
    return {'network': engine.network.id, 'published': publish, 'routes': report,
            'summary': {'ready': sum(v['ready'] for v in report.values()), 'blocked': sum(not v['ready'] for v in report.values())}}


if __name__ == '__main__':
    import argparse
    from .engine import Engine
    from .network import Network
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--network', default='pipeline/temp/authoring/network.json')
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--report', default='pipeline/temp/authoring/policy-revalidation.json')
    args = parser.parse_args()
    engine = Engine(Network(json.loads(Path(args.network).read_text())))
    result = revalidate(Path(__file__).resolve().parents[2], engine, args.publish)
    Path(args.report).write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(result['summary'])
