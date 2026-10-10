"""Read current Wikiroutes outputs as editable drafts, preserving source data."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

from .model import attach_stops, coordinate, digest, new_route


def track_coordinates(collection):
    parts = []
    if collection.get('type') != 'FeatureCollection':
        raise ValueError('Se requiere un GeoJSON FeatureCollection')
    for feature in collection['features']:
        geom = feature.get('geometry') or {}
        if geom.get('type') == 'LineString':
            parts.append([coordinate(c[:2]) for c in geom['coordinates']])
        elif geom.get('type') == 'MultiLineString':
            parts.extend([[coordinate(c[:2]) for c in part] for part in geom['coordinates']])
    if not parts or any(len(part) < 2 for part in parts):
        raise ValueError('El GeoJSON no contiene un trazado válido')
    return parts


def stop_records(collection):
    if collection.get('type') != 'FeatureCollection':
        raise ValueError('Los paraderos deben ser un FeatureCollection')
    stops, occurrences = [], {}
    for index, feature in enumerate(collection['features']):
        geom = feature.get('geometry') or {}
        if geom.get('type') != 'Point':
            raise ValueError('Paradero sin geometría Point')
        properties = copy.deepcopy(feature.get('properties', {}))
        point = coordinate(geom['coordinates'][:2])
        sid = str(properties.get('stop_id') or properties.get('id') or 'source:' + digest([properties, point])[:20])
        occurrences[sid] = occurrences.get(sid, 0) + 1
        stops.append({'id': sid, 'occurrence': occurrences[sid], 'name': properties.get('name') or f'Paradero {index+1}',
                      'coordinates': point, 'properties': properties, 'sourceIndex': index})
    return stops


def import_bundle(engine, route_id, name, direction, track, stops, vias=None, matched=None, corrections=None, provenance=None):
    parts = track_coordinates(track)
    source = {'kind': 'wikiroutes', 'track': copy.deepcopy(track), 'stops': copy.deepcopy(stops),
              'vias': copy.deepcopy(vias), 'matched': copy.deepcopy(matched),
              'corrections': copy.deepcopy(corrections or []), 'provenance': copy.deepcopy(provenance or {})}
    source['snapshotHash'] = digest(source)
    route = new_route(route_id, name, direction, engine.network, source)
    route['stops'] = stop_records(stops)
    warnings = []
    if vias:
        line = [tuple(reversed(p)) for part in parts for p in part]
        record = engine.matcher.decode(vias, line)
        if record:
            for correction in corrections or []:
                try:
                    record = engine.matcher.corregir(record, correction)
                except ValueError as error:
                    warnings.append(str(error))
            route['path'] = engine.from_record(record)
        else:
            warnings.append('Las referencias de vías ya no encajan; requiere un nuevo ajuste explícito')
        if vias.get('osm') != engine.network.data['source'].get('timestamp', '')[:10]:
            warnings.append('La versión OSM de la fuente cambió; revisar la migración')
    if not route['path']:
        route['path'] = [{'type': 'gap', 'coordinates': part, 'reason': 'Fuente pendiente de ajuste'} for part in parts]
    route['source']['importWarnings'] = warnings
    return attach_stops(route, engine.network)


def import_existing(root, key, engine):
    root = Path(root).resolve()
    definitions = json.loads((root / 'pipeline/output/wr_map.json').read_text())['routes']
    if key not in definitions:
        raise ValueError('Ruta no encontrada en wr_map.json')
    definition = definitions[key]
    folder = (root / definition['folder']).resolve()
    if not folder.is_relative_to(root):
        raise ValueError('Carpeta de ruta fuera del repositorio')
    trip = definition.get('trip', 1)
    files = {'track': folder / f'route_track_trip{trip}.geojson',
             'stops': folder / f'stops_trip{trip}.geojson',
             'vias': folder / f'route_track_trip{trip}.vias.json',
             'matched': folder / f'route_track_trip{trip}.osm.geojson'}
    values, hashes = {}, {}
    for kind, path in files.items():
        if path.exists():
            raw = path.read_bytes()
            values[kind] = json.loads(raw)
            hashes[path.relative_to(root).as_posix()] = hashlib.sha256(raw).hexdigest()
    if 'track' not in values or 'stops' not in values:
        raise ValueError('Faltan el trazado original o los paraderos de la ruta')
    correction_file = root / 'config/recorridos_correcciones.json'
    corrections = [c for c in json.loads(correction_file.read_text()).get('rutas', []) if c.get('ruta') == key] if correction_file.exists() else []
    route = import_bundle(engine, key, definition.get('name', key),
                          key.rsplit('-', 1)[-1] if key.endswith(('-ida', '-vuelta')) else f'trip{trip}',
                          **values, corrections=corrections,
                          provenance={'files': hashes, 'definition': copy.deepcopy(definition), 'trip': trip})
    return route
