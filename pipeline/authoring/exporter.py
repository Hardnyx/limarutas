"""Deterministic compatible exports; draft previews never update site data."""
from __future__ import annotations

import copy
import json
import math
import shutil
import tempfile
from pathlib import Path

from .model import attach_stops, digest, geometry, path_parts, validate
from .network import metres


def steps(route, network):
    result, previous_heading = [], None
    for item, part in zip(route['path'], path_parts(route, network)):
        if item['type'] != 'street':
            previous_heading = None
            continue
        edge = network.edges[item['edge']]
        a, b = part
        heading = math.atan2(b[1]-a[1], (b[0]-a[0])*math.cos(math.radians(a[1])))
        turn = 0 if previous_heading is None else math.degrees((heading-previous_heading+math.pi) % (2*math.pi)-math.pi)
        action = 'inicio' if not result else 'sigue' if abs(turn) < 30 else 'vuelta' if abs(turn) > 150 else 'izquierda' if turn > 0 else 'derecha'
        if result and result[-1]['via'] == edge['name']:
            result[-1]['m'] += metres(a, b)
        else:
            result.append({'accion': action, 'via': edge['name'], 'm': metres(a, b)})
        previous_heading = heading
    return [{**step, 'm': round(step['m'])} for step in result]


def bundle(route, network, preview=False, trip=None):
    route = attach_stops(route, network)
    result = validate(route, network)
    if not preview and not result['accepted']:
        raise ValueError('La exportación publicable requiere un recorrido validado y aceptado')
    trip = trip if trip is not None else route['source'].get('provenance', {}).get('trip', 1)
    if type(trip) is not int or trip < 1:
        raise ValueError('Número de sentido inválido')
    coordinates = geometry(route, network)
    if len(coordinates) < 2:
        raise ValueError('No hay geometría suficiente para exportar')
    track = {'type': 'FeatureCollection', 'features': [{'type': 'Feature',
             'properties': {'fuente': f"OpenStreetMap {network.data['source'].get('timestamp', '')[:10]} (route-authoring)",
                            'pasos': steps(route, network), 'sin_calle': sum(p['type'] == 'gap' for p in route['path']),
                            'authoring': {'id': route['id'], 'revision': route['revision'], 'network': network.id,
                                          'preview': preview, 'accepted': result['accepted']}},
             'geometry': {'type': 'LineString', 'coordinates': coordinates}}]}
    stop_features = []
    for i, stop in enumerate(route['stops']):
        properties = copy.deepcopy(stop.get('properties', {}))
        properties.update(name=stop['name'], stop_id=stop['id'], seq=i+1)
        stop_features.append({'type': 'Feature', 'properties': properties,
                              'geometry': {'type': 'Point', 'coordinates': stop['coordinates']}})
    files = {f'route_track_trip{trip}.osm.geojson': track,
             f'stops_trip{trip}.geojson': {'type': 'FeatureCollection', 'features': stop_features},
             f'route_track_trip{trip}.route.json': route}
    # Existing original files must retain their exact bytes. The sidecar carries a copy for review.
    if route['source'].get('kind') != 'wikiroutes':
        files[f'route_track_trip{trip}.geojson'] = copy.deepcopy(track)
    return {'version': 1, 'routeId': route['id'], 'revision': route['revision'], 'network': network.data['source'],
            'preview': preview, 'validation': result, 'files': files,
            'checksums': {name: digest(value) for name, value in files.items()}}


def write_bundle(export, directory, repository):
    target, root = Path(directory).resolve(), Path(repository).resolve()
    if target.is_relative_to(root) and not target.is_relative_to(root / 'pipeline/temp'):
        raise ValueError('La exportación debe ir a pipeline/temp o a una carpeta externa; no sobrescribe el sitio')
    if target.exists():
        raise ValueError('La carpeta de exportación ya existe; selecciona una nueva')
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.route-export-', dir=target.parent))
    try:
        for name, value in export['files'].items():
            (staging / name).write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)+'\n')
        manifest = {k: v for k, v in export.items() if k != 'files'}
        (staging / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
        staging.rename(target)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return manifest
