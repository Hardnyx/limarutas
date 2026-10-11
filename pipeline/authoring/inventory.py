"""Read-only migration inventory; an old OSM drawing is not an accepted route."""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path


def inventory(root, audited=None):
    root = Path(root).resolve()
    catalog = root / 'pipeline/output/wr_map.json'
    definitions = json.loads(catalog.read_text())['routes']
    routes = {}
    for key, definition in sorted(definitions.items()):
        folder, trip = definition['folder'], definition.get('trip', 1)
        base = (root / folder).resolve()
        if not base.is_relative_to(root):
            raise ValueError(f'Carpeta fuera del repositorio: {key}')
        paths = {kind: base / filename for kind, filename in {
            'original': f'route_track_trip{trip}.geojson',
            'stops': f'stops_trip{trip}.geojson',
            'legacyReferences': f'route_track_trip{trip}.vias.json',
            'osm': f'route_track_trip{trip}.osm.geojson',
            'editable': f'route_track_trip{trip}.route.json'}.items()}
        files = {kind for kind, path in paths.items() if path.is_file()}
        issues = [f'missing:{kind}' for kind in ('original', 'stops') if kind not in files]
        accepted = False
        if 'editable' in files:
            from .published import verify_published
            try:
                route = json.loads(paths['editable'].read_text())
                verify_published(route, *[json.loads(paths[kind].read_text())
                                   for kind in ('osm', 'original', 'stops')], trip, key)
                if definition.get('osm') is not True:
                    raise ValueError('La definición aceptada no está activa')
                accepted = True
            except (ValueError, KeyError, FileNotFoundError) as error:
                issues.append(f'invalidPublished:{error}')
        review = audited['routes'][key] if audited else None
        if accepted and audited and route['network'] != audited['network']:
            raise ValueError(f'La auditoría corresponde a otra red: {key}')
        routes[key] = {'geometry': 'canonical' if accepted else 'legacy-osm' if definition.get('osm') else 'original',
                       'migration': 'accepted' if accepted else 'blocked-source' if issues else 'pending-review',
                       'hasReferences': 'legacyReferences' in files, 'issues': issues}
        if review:
            routes[key]['validation'] = {'ready': review['ready'], 'issues': review['issues']}
            if not accepted and not issues and not review['ready']:
                routes[key]['migration'] = 'blocked-validation'
    native = {}
    for filename, field, prefix in [
        ('metropolitano_paths.json', 'paths', 'met'),
        ('alimentadores_paths.json', 'services', 'alim')]:
        path = root / 'data/processed/metropolitano' / filename
        if not path.exists():
            continue
        for key in json.loads(path.read_text())[field]:
            directions = ('ida', 'vuelta') if prefix == 'alim' else (None,)
            for direction in directions:
                native[f'{prefix}:{key}' + (f':{direction}' if direction else '')] = {
                    'migration': 'native-adapter-required', 'file': path.relative_to(root).as_posix()}
    result = {'version': 1, 'kind': 'read-only-migration-inventory', 'publishedFilesChanged': False,
            'catalogSha256': hashlib.sha256(catalog.read_bytes()).hexdigest(),
            'summary': {'wikiroutes': len(routes), 'nativeBusDirections': len(native),
                        'geometry': dict(Counter(r['geometry'] for r in routes.values())),
                        'migration': dict(Counter(r['migration'] for r in routes.values()))},
            'routes': routes, 'native': native,
            'excludedModes': ['metro:rail-not-bus-network']}
    if audited:
        result['audit'] = {'network': audited['network'], 'directions': len(audited['routes']),
                           'ready': sum(r['ready'] for r in audited['routes'].values()),
                           'issueOccurrences': audited['summary']['blockers']}
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default=str(Path(__file__).resolve().parents[2]))
    parser.add_argument('--report', default='pipeline/temp/authoring/migration/inventory.json')
    parser.add_argument('--audit', help='Auditoría completa con incidencias por sentido')
    args = parser.parse_args()
    audited = json.loads(Path(args.audit).read_text()) if args.audit else None
    report = inventory(args.root, audited)
    path = Path(args.report)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report['summary'], ensure_ascii=False))
