"""Check accepted exports and preflight legacy regeneration before any writes."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .exporter import bundle
from .model import digest
from .network import Network, POLICY


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def verify_source(route, original, stops, trip):
    export = route.get('exported', {})
    if route.get('version') != 1 or not route.get('review', {}).get('accepted') or export.get('preview') is not False:
        raise ValueError('La definición publicada debe estar aceptada y no ser una vista previa')
    if export.get('trip') != trip or digest(stops) != export.get('stopsHash'):
        raise ValueError('Los paraderos publicados difieren de la definición aceptada; importa su actualización')
    source = route.get('source', {})
    if source.get('kind') == 'wikiroutes' and digest(original) != digest(source.get('track')):
        raise ValueError('El trazado fuente cambió; importa su actualización antes de regenerar')
    if source.get('snapshotHash'):
        raw = {k: v for k, v in source.items() if k not in ('snapshotHash', 'importWarnings')}
        if digest(raw) != source['snapshotHash']:
            raise ValueError('La copia de la fuente ha sido modificada')
    network_id = f"osm:{export.get('sourceSha256')}:{export.get('policy')}"
    if route.get('network') != network_id:
        raise ValueError('La versión de red del archivo aceptado no coincide')


def verify_published(route, track, original, stops, trip, route_id=None):
    verify_source(route, original, stops, trip)
    features = track.get('features', [])
    if len(features) != 1 or features[0].get('geometry', {}).get('type') != 'LineString':
        raise ValueError('Geometría publicada inválida')
    feature = features[0]
    authoring = feature.get('properties', {}).get('authoring', {})
    if (authoring.get('preview') is not False or authoring.get('accepted') is not True
            or authoring.get('routeHash') != digest(route)
            or authoring.get('network') != route['network'] or authoring.get('id') != route['id']
            or authoring.get('revision') != route['revision']
            or digest(feature['geometry']) != route['exported']['geometryHash']):
        raise ValueError('El GeoJSON publicado no corresponde a la revisión aceptada')
    if route_id is not None and route['id'] != route_id:
        raise ValueError('La identidad del recorrido no coincide con el catálogo')
    return True


def folder_files(root, definition):
    root = Path(root).resolve()
    folder = (root / definition['folder']).resolve()
    if not folder.is_relative_to(root):
        raise ValueError('Carpeta de ruta fuera del repositorio')
    trip = definition.get('trip', 1)
    return folder, trip, folder / f'route_track_trip{trip}.route.json'


def preflight(root, items, network=None):
    """All edited routes are checked before the caller changes any output."""
    root = Path(root)
    found = []
    for key, folder, trip in items:
        directory, _, sidecar = folder_files(root, {'folder': folder, 'trip': trip})
        if sidecar.exists():
            route = load(sidecar)
            verify_source(route, load(directory / f'route_track_trip{trip}.geojson'),
                          load(directory / f'stops_trip{trip}.geojson'), trip)
            if route['id'] != key:
                raise ValueError(f'{key}: la identidad de la definición aceptada no coincide')
            found.append((key, trip, route))
    if not found:
        return {}
    if network is None:
        pbf = root / 'data/raw/osm/Lima.osm.pbf'
        sha = hashlib.sha256(pbf.read_bytes()).hexdigest()
        cache = load(root / 'pipeline/temp/authoring/network.json')
        if cache.get('policy') != POLICY or cache['source']['sha256'] != sha:
            raise ValueError('Prepara la red de edición con el extracto OSM actual antes de regenerar')
        network = Network(cache)
    exports = {}
    for key, trip, route in found:
        if route['network'] != network.id:
            raise ValueError(f'{key}: cambió OSM; migra y acepta el recorrido antes de regenerar')
        exported = bundle(route, network, trip=trip)
        if exported['files'][f'route_track_trip{trip}.route.json'] != route:
            raise ValueError(f'{key}: la definición aceptada no coincide con la geometría regenerada')
        exports[key] = exported
    return exports
