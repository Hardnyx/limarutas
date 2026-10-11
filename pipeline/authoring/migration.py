"""Stage geometry-preserving migrations; never silently reroute a bus service."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from collections import Counter
from pathlib import Path

from .engine import Engine
from .exporter import bundle, write_bundle
from .importer import import_existing, track_coordinates
from .model import digest, validate
from .network import Network
from .published import folder_files, verify_published
from .store import Store


def legacy_equivalence(route, engine):
    source = route['source']
    matched, vias = source.get('matched'), source.get('vias')
    if not matched or not vias:
        return {'equivalent': False, 'reason': 'missing-published-osm-or-references'}
    line = [tuple(reversed(point)) for part in track_coordinates(source['track']) for point in part]
    record = engine.matcher.decode(vias, line)
    if record is None:
        return {'equivalent': False, 'reason': 'references-no-longer-decode'}
    for correction in source.get('corrections', []):
        record = engine.matcher.corregir(record, correction)
    reproduced = {'type': 'LineString', 'coordinates': [[lon, lat] for lat, lon in engine.matcher.geometry(record)]}
    features = matched.get('features', [])
    identical = len(features) == 1 and digest(reproduced) == digest(features[0].get('geometry'))
    # The editable references must be exactly the decoded itinerary, not a different valid path.
    path_identical = digest(route['path']) == digest(engine.from_record(record))
    return {'equivalent': identical and path_identical,
            'reason': 'same-published-itinerary' if identical and path_identical else 'published-itinerary-differs',
            'publishedGeometryHash': digest(features[0].get('geometry')) if len(features) == 1 else None,
            'reproducedGeometryHash': digest(reproduced), 'pathHash': digest(route['path'])}


def stage(root, engine, keys, directory):
    root, directory = Path(root).resolve(), Path(directory).resolve()
    if directory.is_relative_to(root) and not directory.is_relative_to(root / 'pipeline/temp'):
        raise ValueError('Prepara el lote en pipeline/temp o en una carpeta externa')
    if directory.exists():
        raise ValueError('Usa una carpeta nueva para preparar el lote')
    directory.mkdir(parents=True)
    store = Store(directory / 'drafts')
    report = {'version': 1, 'network': engine.network.id,
              'policy': 'preserve-published-itinerary-and-all-source-stops', 'routes': {}}
    for index, key in enumerate(keys):
        try:
            if Path(key).name != key or key in ('.', '..'):
                raise ValueError('Identificador de ruta inválido para exportación')
            route = import_existing(root, key, engine)
            validation = validate(route, engine.network)
            if not validation['ready']:
                result = {'status': 'blocked', 'issues': dict(Counter(i['code'] for i in validation['issues']))}
            else:
                proof = legacy_equivalence(route, engine)
                if not proof['equivalent']:
                    result = {'status': 'review-required', 'proof': proof}
                else:
                    route['review']['notes'] = ('Migración del itinerario publicado: referencias OSM reproducidas '
                        'sin cambios de calles; sentidos, giros, continuidad y paraderos validados. '
                        'Se restauran todos los vértices OSM. No certifica la vigencia comercial del servicio.')
                    route['migration'] = proof
                    accepted = store.save(route, 0, accept=True)
                    exported = bundle(accepted, engine.network)
                    write_bundle(exported, directory / 'exports' / key, root)
                    result = {'status': 'staged', 'proof': proof, 'stops': len(route['stops']),
                              'segments': len(route['path']), 'revision': accepted['revision']}
        except (ValueError, KeyError, OSError) as error:
            result = {'status': 'blocked', 'issues': {'importFailure': 1}, 'error': str(error)}
        report['routes'][key] = result
        if (index + 1) % 50 == 0:
            print(json.dumps({'processed': index + 1, 'staged': sum(r['status'] == 'staged'
                             for r in report['routes'].values())}), flush=True)
    report['summary'] = dict(Counter(r['status'] for r in report['routes'].values()))
    (directory / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    return report


def publish_staged(root, engine, directory, keys):
    """Preflight the entire selected batch, preserve sources, roll back failed writes."""
    root, directory = Path(root).resolve(), Path(directory).resolve()
    report = json.loads((directory / 'report.json').read_text())
    if report['network'] != engine.network.id:
        raise ValueError('El lote corresponde a otra versión de red')
    definitions = json.loads((root / 'pipeline/output/wr_map.json').read_text())['routes']
    corrections_file = root / 'config/recorridos_correcciones.json'
    corrections = json.loads(corrections_file.read_text()).get('rutas', []) if corrections_file.exists() else []
    changes = []
    for key in keys:
        if key not in report['routes'] or report['routes'][key]['status'] != 'staged':
            raise ValueError(f'{key}: recorrido no preparado')
        definition = definitions[key]
        folder, trip, sidecar = folder_files(root, definition)
        if sidecar.exists() or definition.get('osm') is not True:
            raise ValueError(f'{key}: solo se migra un itinerario OSM anterior sin definición aceptada')
        prepared = directory / 'exports' / key
        files = {name: json.loads((prepared / name).read_text()) for name in (
            f'route_track_trip{trip}.route.json', f'route_track_trip{trip}.osm.geojson', f'stops_trip{trip}.geojson')}
        route = files[sidecar.name]
        provenance = route['source']['provenance']
        if provenance['definition'] != definition:
            raise ValueError(f'{key}: cambió el catálogo desde la preparación')
        if route['source']['corrections'] != [c for c in corrections if c.get('ruta') == key]:
            raise ValueError(f'{key}: cambiaron las correcciones desde la preparación')
        for relative, expected in provenance['files'].items():
            source = (root / relative).resolve()
            if not source.is_relative_to(root) or hashlib.sha256(source.read_bytes()).hexdigest() != expected:
                raise ValueError(f'{key}: cambió la fuente {relative}')
        if route.get('migration') != report['routes'][key]['proof'] or not legacy_equivalence(route, engine)['equivalent']:
            raise ValueError(f'{key}: no reproduce el itinerario publicado')
        regenerated = bundle(route, engine.network, trip=trip)['files']
        if regenerated != files:
            raise ValueError(f'{key}: la exportación preparada ha sido modificada')
        original = json.loads((folder / f'route_track_trip{trip}.geojson').read_text())
        stops = json.loads((folder / f'stops_trip{trip}.geojson').read_text())
        verify_published(route, files[f'route_track_trip{trip}.osm.geojson'], original, stops, trip, key)
        # Stops are checked above and deliberately never rewritten, preserving exact bytes.
        for name in (f'route_track_trip{trip}.osm.geojson', sidecar.name):
            path = folder / name
            changes.append((path, json.dumps(files[name], ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()+b'\n',
                            path.read_bytes() if path.exists() else None))
    written = []
    try:
        for path, content, previous in changes:
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
                temporary.write(content)
                temporary_path = Path(temporary.name)
            try:
                os.replace(temporary_path, path)
            finally:
                temporary_path.unlink(missing_ok=True)
            written.append((path, previous))
    except BaseException:
        for path, previous in reversed(written):
            if previous is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(previous)
        raise
    return {'published': list(keys), 'files': len(changes), 'sourcesAndStopsChanged': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('keys', nargs='*')
    parser.add_argument('--network', default='pipeline/temp/authoring/network.json')
    parser.add_argument('--directory', required=True)
    parser.add_argument('--ready-report', help='Auditoría previa para seleccionar solo rutas listas')
    parser.add_argument('--publish-staged', action='store_true', help='Publicar un lote preparado tras verificar todas sus fuentes')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    engine = Engine(Network(json.loads(Path(args.network).read_text())))
    keys = args.keys or sorted(json.loads((root / 'pipeline/output/wr_map.json').read_text())['routes'])
    if args.publish_staged:
        if not args.keys:
            prepared = json.loads((Path(args.directory) / 'report.json').read_text())
            keys = sorted(k for k, r in prepared['routes'].items() if r['status'] == 'staged')
        print(json.dumps(publish_staged(root, engine, args.directory, keys), ensure_ascii=False))
        raise SystemExit(0)
    if args.ready_report:
        audited = json.loads(Path(args.ready_report).read_text())
        if audited.get('network') != engine.network.id:
            raise ValueError('La auditoría corresponde a otra versión de red')
        keys = [key for key in keys if audited['routes'][key]['ready']]
    report = stage(root, engine, keys, args.directory)
    print(json.dumps(report['summary'], ensure_ascii=False))
