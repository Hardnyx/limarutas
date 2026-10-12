"""Official cartographic references, separate from road paths and operating trips."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

from .model import digest
from .network import metres
from pipeline.scripts.atu.sources import URLS, inspect, json_bytes

KIND = 'official-reference'


def requested(bundle):
    provenance = bundle.get('provenance', {})
    return provenance.get('sourceKind') == 'official_plan' or provenance.get('transportMode') == 'rail'


def is_reference(route):
    return route.get('source', {}).get('kind') == KIND


def source_hash(source):
    return digest({k: v for k, v in source.items() if k != 'snapshotHash'})


def import_reference(bundle, root):
    p = copy.deepcopy(bundle.get('provenance', {}))
    if (p.get('publisher') != 'ATU' or p.get('sourceKind') != 'official_plan'
            or p.get('transportMode') != 'rail' or p.get('geometryPolicy') != 'preserve'
            or p.get('plannerEligible') is not False or p.get('sourceUrl') != URLS['pmu']
            or p.get('sourceCrs') not in ('OGC:CRS84', 'EPSG:4326')):
        raise ValueError('La referencia requiere fuente ATU, CRS en grados y conservación cartográfica')
    track = copy.deepcopy(bundle['track'])
    inspect('pmu', json_bytes(track))
    if len(track['features']) != 1:
        raise ValueError('Importa un eje oficial por referencia, conservando sus partes')
    feature = track['features'][0]
    if (feature['properties']['tecnologia'] != 'Red Ferroviaria Urbana'
            or feature['properties']['OBJECTID'] != p.get('sourceObjectId')
            or digest(feature['geometry']) != p.get('sourceGeometrySha256')):
        raise ValueError('Geometría ferroviaria o identidad de origen incompatible')
    # Authenticate geometry against the exact acquired snapshot, not caller metadata.
    raw = (Path(root) / 'data/raw/atu_geovisor/pmu_sit.geojson').read_bytes()
    if hashlib.sha256(raw).hexdigest() != p.get('sourceFileSha256'):
        raise ValueError('El snapshot ATU cambió; revisa la solicitud contra la fuente vigente')
    original, _ = inspect('pmu', raw)
    matches = [f for f in original['features'] if f['properties']['OBJECTID'] == p['sourceObjectId']]
    if len(matches) != 1 or feature != matches[0]:
        raise ValueError('El eje no coincide exactamente con la fuente oficial adquirida')
    stops = copy.deepcopy(bundle['stops'])
    if stops != {'type': 'FeatureCollection', 'features': []}:
        raise ValueError('Esta fuente PMU no publica estaciones; no se aceptan puntos inferidos')
    identity = {k: bundle[k] for k in ('id', 'name', 'direction')}
    if not all(isinstance(v, str) and v.strip() for v in identity.values()):
        raise ValueError('Identidad de referencia incompleta')
    if identity['id'] in ('L1', 'L2') or identity['id'].startswith(('met:', 'metro:', 'alim:')):
        raise ValueError('La referencia no puede usar una identidad operativa')
    geometry = feature['geometry']
    parts = geometry['coordinates'] if geometry['type'] == 'MultiLineString' else [geometry['coordinates']]
    source = {'kind': KIND, 'track': track, 'stops': stops, 'provenance': p,
              'baselineName': identity['name']}
    source['snapshotHash'] = source_hash(source)
    return {'version': 1, **identity, 'network': 'atu:' + p['sourceFileSha256'], 'revision': 0,
            'profile': {'mode': 'reference', 'transportMode': 'rail'}, 'scope': 'cartographic-reference',
            'plannerEligible': False, 'operativo': False, 'ruteable': False,
            'path': [{'type': 'reference', 'featureIndex': 0, 'partIndex': i} for i in range(len(parts))],
            'stops': [], 'source': source, 'review': {'accepted': False, 'notes': ''}}


def pack(route):
    route = copy.deepcopy(route)
    source = route['source']
    if not is_reference(route) or source.get('snapshotHash') != source_hash(source):
        raise ValueError('La fuente de referencia es inmutable y requiere su hash íntegro')
    p = source['provenance']
    if (route.get('version') != 1 or type(route.get('revision')) is not int or route['revision'] < 0
            or route.get('network') != 'atu:' + p['sourceFileSha256']
            or route.get('scope') != 'cartographic-reference'
            or route.get('profile') != {'mode': 'reference', 'transportMode': 'rail'}
            or any(route.get(k) is not False for k in ('plannerEligible', 'operativo', 'ruteable'))
            or route.get('stops') != []):
        raise ValueError('Contrato cartográfico incompatible o promoción operativa no autorizada')
    if (p.get('publisher') != 'ATU' or p.get('sourceKind') != 'official_plan'
            or p.get('transportMode') != 'rail' or p.get('geometryPolicy') != 'preserve'
            or p.get('plannerEligible') is not False or p.get('sourceUrl') != URLS['pmu']
            or p.get('sourceCrs') not in ('OGC:CRS84', 'EPSG:4326')
            or source.get('stops') != {'type': 'FeatureCollection', 'features': []}):
        raise ValueError('Procedencia de referencia incompatible')
    if not all(isinstance(route.get(k), str) and route[k].strip() for k in ('id', 'name', 'direction')):
        raise ValueError('Identidad de referencia incompleta')
    inspect('pmu', json_bytes(source['track']))
    if len(source['track']['features']) != 1:
        raise ValueError('La referencia requiere exactamente un eje oficial')
    props = source['track']['features'][0]['properties']
    if props['tecnologia'] != 'Red Ferroviaria Urbana' or props['OBJECTID'] != p.get('sourceObjectId'):
        raise ValueError('Identidad ferroviaria incompatible')
    geometry = source['track']['features'][0]['geometry']
    if digest(geometry) != p['sourceGeometrySha256']:
        raise ValueError('La geometría oficial fue modificada')
    parts = geometry['coordinates'] if geometry['type'] == 'MultiLineString' else [geometry['coordinates']]
    expected = [{'type': 'reference', 'featureIndex': 0, 'partIndex': i} for i in range(len(parts))]
    if route.get('path') != expected:
        raise ValueError('Las partes oficiales no se pueden unir, reordenar ni ajustar a calles')
    segments = [{'index': i, 'type': 'reference', 'coordinates': copy.deepcopy(part),
                 'name': route['name'], 'facility': 'rail-reference'} for i, part in enumerate(parts)]
    distance = sum(metres(a[:2], b[:2]) for part in parts for a, b in zip(part, part[1:]))
    validation = {'issues': [], 'distanceM': round(distance, 2), 'ready': True,
                  'accepted': route.get('review', {}).get('accepted') is True,
                  'scope': 'cartographic-reference', 'plannerEligible': False, 'stationLocationsComplete': False}
    return {'route': route, 'validation': validation, 'coordinates': copy.deepcopy(parts),
            'geometry': copy.deepcopy(geometry), 'segments': segments}


def bundle(route, preview=False):
    packed = pack(route)
    if not preview and not packed['validation']['accepted']:
        raise ValueError('La referencia requiere revisión cartográfica aceptada')
    route = packed['route']
    feature = copy.deepcopy(route['source']['track']['features'][0])
    feature['properties'] = {'id': route['id'], 'nombre': route['name'], 'estado': 'proyectado',
        'operativo': False, 'ruteable': False, 'plannerEligible': False, 'geometry_source': 'oficial',
        'geometry_modified': False, 'source_properties': feature['properties'],
        'provenance': copy.deepcopy(route['source']['provenance']),
        'authoring': {'revision': route['revision'], 'scope': route['scope'], 'preview': bool(preview)}}
    feature['id'] = route['id']
    track = {'type': 'FeatureCollection', 'features': [feature]}
    route['exported'] = {'preview': bool(preview), 'geometryHash': digest(packed['geometry']),
                         'scope': route['scope'], 'plannerEligible': False}
    feature['properties']['authoring']['routeHash'] = digest(route)
    files = {'project.geojson': track, 'project.reference.json': route}
    return {'version': 1, 'routeId': route['id'], 'revision': route['revision'], 'preview': bool(preview),
            'scope': route['scope'], 'plannerEligible': False, 'validation': packed['validation'],
            'files': files, 'checksums': {name: digest(value) for name, value in files.items()}}


def propose(current, incoming, choices=None):
    pack(current); pack(incoming)
    if current['id'] != incoming['id'] or current['direction'] != incoming['direction']:
        raise ValueError('La actualización pertenece a otra referencia')
    choices = choices or {}
    before, local, remote = current['source']['baselineName'], current['name'], incoming['name']
    conflicts = []
    name = local
    if remote != before and local != remote:
        if local == before:
            name = remote
        else:
            decision = choices.get('name')
            if decision not in (None, 'local', 'incoming'):
                raise ValueError('La decisión debe ser local o incoming')
            conflicts.append({'key': 'name', 'baseline': before, 'local': local, 'incoming': remote, 'resolution': decision})
            name = remote if decision == 'incoming' else local
    if set(choices) - {c['key'] for c in conflicts}:
        raise ValueError('Decisión de conflicto desconocida')
    result = copy.deepcopy(incoming)
    result.update(name=name, revision=current['revision'])
    result['review']['notes'] = current['review'].get('notes', '')
    return {'route': result, 'conflicts': conflicts, 'canApply': all(c['resolution'] for c in conflicts),
            'sourceChanged': current['source']['snapshotHash'] != incoming['source']['snapshotHash'],
            'baseRevision': current['revision'], 'baseHash': digest(current)}
