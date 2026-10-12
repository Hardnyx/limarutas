"""Build an independent cartographic PMU layer; never promote operating services."""
from __future__ import annotations
import copy
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from pipeline.scripts.atu.sources import SourceError, inspect, identity, json_bytes, atomic_bytes
from pipeline.scripts.atu.styles import validate as validate_styles
CONFIG = ROOT/'config/atu_geovisor_layers.json'
STATION_NAMES = ROOT/'config/pmu_station_names.json'
RAW = ROOT/'data/raw/atu_geovisor'
OUT = ROOT/'data/processed/planificado'


def slug(value):
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode().lower()
    return re.sub('[^a-z0-9]+', '-', value).strip('-')


def field(props, aliases):
    found = [props[k] for k in aliases if k in props]
    if not found or any(v != found[0] for v in found):
        raise SourceError('Campo obligatorio ausente o alias ambiguo: '+str(aliases))
    return found[0]


def build(collection, manifest, config=None, renderer=None):
    config = config or json.loads(CONFIG.read_text())['pmu_sit']
    renderer = renderer or json.loads((RAW/'pmu_renderer.json').read_text())
    validate_styles(renderer)
    raw = json_bytes(collection)
    _, stats = inspect('pmu', raw)
    features = []
    aliases = config['fieldAliases']
    station_catalog = json.loads(STATION_NAMES.read_text())['lines']
    for feature in collection['features']:
        props = feature['properties']
        name = field(props, aliases['nombre'])
        technology = field(props, aliases['tecnologia'])
        horizon = int(field(props, aliases['horizonte']))
        source_state = field(props, aliases['estado'])
        source_symbol = props.get(renderer['field'])
        if source_symbol not in renderer['symbols']:
            raise SourceError('Símbolo ATU sin color verificado: '+str(source_symbol))
        symbol = renderer['symbols'][source_symbol]
        if technology not in config['types'] or str(horizon) not in config['horizons']:
            raise SourceError('Tecnología u horizonte ATU nuevo; revisar contrato')
        mode = config['types'][technology]
        key = 'pmu:'+mode+':'+slug(name)+':h'+str(horizon)
        normalized = {'id': key, 'nombre': name, 'modo': mode, 'limarutas_type': mode,
            'estado': 'proyectado', 'operativo': False, 'ruteable': False, 'plannerEligible': False,
            'fuente': 'ATU', 'plan': 'PMU 2025-2045', 'source_dataset': 'pmu_sit.geojson',
            'source_feature_id': props['OBJECTID'], 'source_identity': identity('pmu', props),
            'source_sha256': manifest['sha256'], 'source_url': manifest['url'],
            'geometry_source': 'oficial', 'geometry_modified': False, 'osmApplied': False,
            'source_type': technology, 'source_state': source_state,
            'horizonte': horizon, 'horizonte_nombre': config['horizons'][str(horizon)],
            'long_km': props['long_km'], 'color': symbol['color'], 'color_source': 'atu-geovisor-renderer',
            'color_source_url': renderer['sourceUrl'], 'color_source_sha256': renderer['sourceSha256'],
            'source_symbol': source_symbol, 'source_symbol_label': symbol['label'],
            'source_line_width': symbol['width'], 'source_line_style': symbol['style'],
            'source_properties': copy.deepcopy(props)}
        if manifest.get('lastModified'):
            normalized['source_last_modified'] = manifest['lastModified']
        if normalized['source_identity'] in station_catalog:
            normalized['station_reference'] = copy.deepcopy(station_catalog[normalized['source_identity']])
        # Separate multipart railway axes remain separate. No street matching,
        # invented stations or inferred operating status.
        features.append({'type': 'Feature', 'id': key, 'properties': normalized,
            'geometry': copy.deepcopy(feature['geometry'])})
    features.sort(key=lambda f: f['id'])
    result = {'type': 'FeatureCollection', 'features': features}
    validate(result, collection, manifest, renderer)
    inventory = {**stats, 'geometryTypes': dict(Counter(f['geometry']['type'] for f in collection['features'])),
        'values': {k: sorted({str(f['properties'].get(k)) for f in collection['features']})
                   for k in ('tecnologia', 'estado', 'hz_pmu', 'tec_cp', 'tec_mp', 'tec_lp')},
        'stationPoints': 0, 'sourceSha256': manifest['sha256']}
    catalog = {'version': 1, 'fuente': 'ATU', 'source_sha256': manifest['sha256'],
        'dataset': 'red.geojson', 'count': len(features), 'stationPoints': 0,
        'types': dict(Counter(f['properties']['modo'] for f in features)),
        'horizons': config['horizons']}
    return result, catalog, inventory


def validate(result, source, manifest, renderer=None):
    renderer = renderer or json.loads((RAW/'pmu_renderer.json').read_text())
    validate_styles(renderer)
    original = {identity('pmu', f['properties']): f for f in source['features']}
    ids = set()
    if len(result['features']) != len(original):
        raise SourceError('La transformación perdió features ATU')
    for feature in result['features']:
        props = feature['properties']
        key = feature.get('id')
        if key in ids or key != props['id'] or not key.startswith('pmu:'):
            raise SourceError('Identificador PMU inválido o repetido')
        ids.add(key)
        if (props['estado'] != 'proyectado' or any(props[k] is not False for k in ('operativo','ruteable','plannerEligible'))
                or props['source_sha256'] != manifest['sha256']):
            raise SourceError('Estado o procedencia PMU inválidos')
        old = original.get(props['source_identity'])
        if old is None or feature['geometry'] != old['geometry'] or props['source_properties'] != old['properties']:
            raise SourceError('Se modificó la geometría o evidencia oficial')
        symbol = renderer['symbols'].get(old['properties'].get('simbol'))
        if not symbol or (props.get('color') != symbol['color']
                or props.get('color_source') != 'atu-geovisor-renderer'
                or props.get('color_source_url') != renderer['sourceUrl']
                or props.get('color_source_sha256') != renderer['sourceSha256']
                or props.get('source_symbol') != old['properties']['simbol']
                or props.get('source_line_width') != symbol['width']
                or props.get('source_line_style') != symbol['style']):
            raise SourceError('Color o procedencia distintos de la simbología ATU')
    inspect('pmu', json_bytes(source))


def main():
    collection = json.loads((RAW/'pmu_sit.geojson').read_text())
    manifest = json.loads((RAW/'manifest.json').read_text())['pmu_sit']
    if hashlib.sha256((RAW/'pmu_sit.geojson').read_bytes()).hexdigest() != manifest['sha256']:
        raise SourceError('El snapshot no corresponde al manifest')
    red, catalog, inventory = build(collection, manifest)
    for path, value in [(OUT/'red.geojson',red),(OUT/'catalog.json',catalog),(ROOT/'docs/atu/pmu_inventory.json',inventory)]:
        body=json_bytes(value)
        if not path.exists() or path.read_bytes()!=body:atomic_bytes(path,body)
    print(f'{len(red["features"])} ejes ATU; 0 ruteables; 0 estaciones inventadas')

if __name__=='__main__':main()
