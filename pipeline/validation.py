"""Validate the static contracts consumed by the site, without network access."""
from __future__ import annotations

import csv
import json
import math
import re
from pathlib import Path


def require(condition, message):
    if not condition:
        raise ValueError(message)


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def index(value, size):
    return type(value) is int and 0 <= value < size


def coordinate(lat, lon, label):
    require(finite(lat) and -90 <= lat <= 90 and finite(lon) and -180 <= lon <= 180,
            f'{label}: invalid coordinates')


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def local_file(root, relative):
    path = (root / relative).resolve()
    require(path.is_relative_to(root.resolve()), f'Path escapes repository: {relative}')
    require(path.is_file(), f'Missing file: {relative}')
    return path


def validate_graph(graph):
    require(graph.get('version') == 1, 'Unsupported trip graph version')
    stops, routes = graph['stops'], graph['routes']
    require(bool(stops) and bool(routes), 'Empty trip graph')
    for i, stop in enumerate(stops):
        require(len(stop) >= 4, f'Stop {i}: incomplete record')
        coordinate(stop[0], stop[1], f'Stop {i}')
        require(isinstance(stop[2], str) and bool(stop[2]), f'Stop {i}: missing name')
        require(index(stop[3], len(graph['districts'])), f'Stop {i}: invalid district index')
        if len(stop) > 6 and stop[6] is not None:
            require(index(stop[6], len(graph.get('aliases', []))), f'Stop {i}: invalid alias index')
    for key, sequence in routes.items():
        require(len(sequence) >= 2, f'{key}: fewer than two stops')
        require(all(index(i, len(stops)) for i in sequence), f'{key}: invalid stop reference')
        require(all(a != b for a, b in zip(sequence, sequence[1:])), f'{key}: consecutive duplicate stops')
    for field in ['segM', 'slow']:
        for key, values in graph.get(field, {}).items():
            require(key in routes and len(values) == len(routes[key]) - 1,
                    f'{field}/{key}: segment count disagrees with route')
            require(all(finite(v) for v in values), f'{field}/{key}: non-finite value')
            if field == 'segM':
                require(all(v >= 0 for v in values), f'{field}/{key}: negative distance')
    for key, value in graph.get('headway', {}).items():
        require(key in routes and finite(value) and value > 0, f'headway/{key}: invalid interval')


def validate_site(root):
    root = Path(root)
    graph = read_json(local_file(root, 'pipeline/output/trip_graph.json'))
    validate_graph(graph)
    wr = read_json(local_file(root, 'pipeline/output/wr_map.json'))['routes']
    for key, definition in wr.items():
        folder = definition.get('folder', f'data/processed/transporte/route_{key}')
        if not folder.startswith('data/'):
            folder = f'data/processed/transporte/{folder}'
        trip = definition.get('trip', 1)
        require(type(trip) is int and trip > 0, f'{key}: invalid trip number')
        local_file(root, f'{folder}/stops_trip{trip}.geojson')
        suffix = '.osm' if definition.get('osm') else ''
        local_file(root, f'{folder}/route_track_trip{trip}{suffix}.geojson')
    for key in graph['routes']:
        require(key.startswith(('met:', 'metro:', 'alim:')) or key in wr,
                f'{key}: graph references an unknown Wikiroutes layer')
    stop_index = read_json(local_file(root, 'pipeline/output/wr_stops_index.json'))
    for i, stop in enumerate(stop_index['stops']):
        require(len(stop) >= 4, f'Search stop {i}: incomplete record')
        coordinate(stop[1], stop[2], f'Search stop {i}')
        require(all(index(j, len(stop_index['routes'])) for j in stop[3]),
                f'Search stop {i}: invalid folder index')
    for folder in stop_index['routes']:
        require(re.fullmatch(r'\d+', str(folder)), f'Invalid Wikiroutes folder: {folder}')
        require((root / 'data/processed/transporte' / f'route_{folder}').is_dir(),
                f'Search index references missing folder {folder}')
    approximations = 0
    feeders = read_json(local_file(root, 'data/processed/metropolitano/alimentadores_paths.json'))['services']
    for service, path in feeders.items():
        for direction in ['ida', 'vuelta']:
            segment = path[direction]
            positions = []
            for stop in segment['stops']:
                coordinate(stop['lat'], stop['lon'], f'{service}/{direction}')
                require(index(stop['at'], len(segment['coords'])), f'{service}/{direction}: invalid track position')
                require('aprox' not in stop or type(stop['aprox']) is bool,
                        f'{service}/{direction}: invalid approximation flag')
                approximations += bool(stop.get('aprox'))
                positions.append(stop['at'])
            require(positions == sorted(positions), f'{service}/{direction}: stops are out of order')
            for lat, lon in segment['coords']:
                coordinate(lat, lon, f'{service}/{direction} track')
    met_paths = read_json(local_file(root, 'data/processed/metropolitano/metropolitano_paths.json'))['paths']
    for service, path in met_paths.items():
        positions = path['at']
        require(all(index(i, len(path['coords'])) for i in positions) and positions == sorted(positions),
                f'Metropolitano {service}: invalid track positions')
        for lat, lon in path['coords']:
            coordinate(lat, lon, f'Metropolitano {service}')
    meta = read_json(local_file(root, 'data/processed/caminata/meta.json'))
    require(finite(meta['tile']) and meta['tile'] > 0 and finite(meta['q']) and meta['q'] > 0,
            'Invalid walking grid scale')
    require(len(meta['tiles']) == len(set(meta['tiles'])), 'Duplicate walking tiles')
    zero_edges = 0
    for tile in meta['tiles']:
        require(re.fullmatch(r'-?\d+_-?\d+', tile), f'Invalid walking tile: {tile}')
        for row in read_json(local_file(root, f'data/processed/caminata/t/{tile}.json')):
            require(len(row) >= 5 and len(row) % 2 == 1 and all(type(v) is int for v in row) and row[0] >= 0,
                    f'{tile}: invalid encoded walking edge')
            # The existing generator may quantize a collapsed edge to zero.
            # Report it without changing the walking network in this refactor.
            zero_edges += row[0] == 0
    with local_file(root, 'pipeline/output/lista_rutas_maestro.csv').open(encoding='utf-8-sig') as file:
        headers = csv.DictReader(file).fieldnames or []
        require({'codigo_nuevo', 'empresa_operadora'} <= set(headers), 'Missing master CSV columns')
    return {'stops': len(graph['stops']), 'routes': len(graph['routes']),
            'wrLayers': len(wr), 'walkingTiles': len(meta['tiles']),
            'feederStopApproximations': approximations, 'zeroLengthWalkingEdges': zero_edges}
