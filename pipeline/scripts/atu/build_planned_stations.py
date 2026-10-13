"""Build reviewed planning points offline, independently of operating services."""
from __future__ import annotations
import copy
import json
import math
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from pipeline.scripts.atu.sources import SourceError, json_bytes, sha
from pipeline.scripts.atu.sync_geovisor import publish

CONFIG = ROOT/'config/atu_station_sources.json'
LOCATIONS = ROOT/'config/atu_station_locations.json'
OUT = ROOT/'data/processed/planificado'
FILES = {'estacion': 'estaciones.geojson', 'centro_transferencia': 'centros_transferencia.geojson',
         'nodo_intermodal': 'nodos_intermodales.geojson', 'nodo_dot': 'nodos_dot.geojson', 'terminal': 'terminales.geojson'}
METHODS = {'unlocated', 'official_coordinate', 'geopdf_digitized', 'georeferenced_map_digitized', 'documented_intersection'}


def distance(point, parts):
    """Report distance to the unchanged axis; never move a point to that axis."""
    lon, lat = point
    scale = math.cos(math.radians(lat))
    best = math.inf
    for part in parts:
        for a, b in zip(part, part[1:]):
            ax, ay = (a[0]-lon)*scale, a[1]-lat
            dx, dy = (b[0]-a[0])*scale, b[1]-a[1]
            t = max(0, min(1, -(ax*dx+ay*dy)/(dx*dx+dy*dy))) if dx or dy else 0
            best = min(best, math.hypot(ax+t*dx, ay+t*dy)*111195)
    return round(best, 1)


def build(config, locations, red):
    sources = config['sources']
    axes = {f['id']: f for f in red['features']}
    points = locations['locations']
    if set(points) - {r['id'] for r in config['records']}:
        raise SourceError('Geoubicación sin identidad documental')
    records = []
    for seed in sorted(config['records'], key=lambda r: r['id']):
        item = copy.deepcopy(seed)
        item.update(operativo=False, ruteable=False, plannerEligible=False, geometry=None,
                    source_geometry=None, display_geometry=None, location_method='unlocated',
                    location_status='pending', coordinate_role='station_reference' if item['tipo']=='estacion' else 'planning_area_reference',
                    uncertainty_m=None, uncertainty_note='Ubicación pendiente de verificación', interchange_group=None)
        item['notes'] = item.get('notes', '')
        if item['id'] in points:
            located = copy.deepcopy(points[item['id']])
            if located['source_sha256'] != sources[located['source_id']]['sha256']:
                raise SourceError('La geoubicación pertenece a otra revisión de la fuente')
            geometry = located.pop('geometry')
            item.update(located)
            item.update(geometry=geometry, source_geometry=copy.deepcopy(geometry), location_status='located')
            ref = {'source_id': located['source_id'], 'pdf_page': located.get('pdf_page'), 'printed_page': located.get('printed_page')}
            if ref not in item['source_refs']: item['source_refs'].append(ref)
        item['source_refs'] = [{**ref, 'sha256': sources[ref['source_id']]['sha256'],
                               'url': sources[ref['source_id']]['url'], 'edition': sources[ref['source_id']]['edition']}
                              for ref in item['source_refs']]
        if not item['project_ids']:
            # Relationships are reviewed explicitly; never use proximity or a shared name.
            item['project_ids'] = locations.get('node_project_links', {}).get(item['id'], [])
        item['axis_distance_m'] = {}
        if item['geometry']:
            for pid in item['project_ids']:
                axis = axes[pid]['geometry']
                parts = axis['coordinates'] if axis['type']=='MultiLineString' else [axis['coordinates']]
                item['axis_distance_m'][pid] = distance(item['geometry']['coordinates'], parts)
        records.append(item)
    catalog = {'version': 1, 'scope': 'cartographic-planning-only', 'records': records,
               'operating_station_links': config['operating_station_links'], 'coverage': config['coverage'],
               'sources': sources, 'geolocation_reviews': locations.get('reviews', {}),
               'counts': dict(Counter(r['tipo'] for r in records)),
               'located_counts': dict(Counter(r['tipo'] for r in records if r['geometry']))}
    validate(catalog, red)
    files = {OUT/'estaciones_catalogo.json': json_bytes(catalog),
             OUT/'geoubicacion_pendientes.json': json_bytes({'records': [r for r in records if not r['geometry']],
                 'missing_names': {'Universitaria': 12}, 'research_gaps': config.get('research_gaps', [])})}
    for kind, name in FILES.items():
        features = [{'type': 'Feature', 'id': r['id'], 'geometry': r['geometry'],
                     'properties': {k: v for k, v in r.items() if k not in ('geometry', 'source_geometry', 'display_geometry')}}
                    for r in records if r['tipo']==kind and r['geometry']]
        files[OUT/name] = json_bytes({'type': 'FeatureCollection', 'features': features})
    return catalog, files


def validate(catalog, red):
    axes = {f['id'] for f in red['features']}
    ids = set()
    for r in catalog['records']:
        if r['id'] in ids or not r['id'].startswith('planificado:'): raise SourceError('Identidad de estación repetida')
        ids.add(r['id'])
        if r['tipo'] not in FILES or r['location_method'] not in METHODS: raise SourceError('Tipo o método no admitido')
        if any(r[k] is not False for k in ('operativo','ruteable','plannerEligible')): raise SourceError('Contaminación de red operativa')
        if not r['source_refs'] or not r['existence_evidence'].startswith('explicit_'): raise SourceError('Falta evidencia de existencia')
        if set(r['project_ids']) - axes: raise SourceError('Relación con eje inexistente')
        for ref in r['source_refs']:
            if ref['sha256'] != catalog['sources'][ref['source_id']]['sha256']: raise SourceError('Hash de procedencia incorrecto')
        if r['geometry'] is None:
            if r['source_geometry'] is not None or r['location_method']!='unlocated' or r['location_status']!='pending':
                raise SourceError('Pendiente con ubicación ficticia')
        else:
            g = r['geometry'];xy = g.get('coordinates', [])
            if (g.get('type')!='Point' or len(xy)!=2 or not all(type(v) in (int,float) and math.isfinite(v) for v in xy)
                    or not -77.5 < xy[0] < -76.4 or not -12.7 < xy[1] < -11.4): raise SourceError('Punto fuera de Lima/Callao o eje invertido')
            if r['location_method']=='unlocated' or r['source_geometry']!=g or r['display_geometry'] is not None:
                raise SourceError('La geometría documental fue alterada')
            if not r.get('location_evidence') or not r.get('source_sha256'): raise SourceError('Punto sin evidencia de localización')
            if r['location_method']=='documented_intersection' and r['coordinate_role']!='intersection_reference':
                raise SourceError('Cruce presentado como centro de andén')
    expected = {'L2':22, 'L3':28, 'L4-ramal':8, 'L4':20, 'Grau':4, 'Sur':5, 'Universitaria':3}
    for line, count in expected.items():
        if sum(r['tipo']=='estacion' and r['lineas']==[line] for r in catalog['records'])!=count: raise SourceError('Conteo documental incorrecto: '+line)
    if sum(r['tipo']=='centro_transferencia' for r in catalog['records'])!=25 or sum(r['tipo']=='nodo_dot' for r in catalog['records'])!=44:
        raise SourceError('Conteo de nodos incorrecto')


def main():
    config=json.loads(CONFIG.read_text())
    for source in config['sources'].values():
        raw=(ROOT/source['extract']).read_bytes()
        if sha(raw)!=source['extract_sha256']: raise SourceError('Extracto documental alterado')
        extract=json.loads(raw)
        if extract['source_sha256']!=source['sha256']: raise SourceError('Extracto y fuente no coinciden')
    catalog, files=build(config, json.loads(LOCATIONS.read_text()), json.loads((OUT/'red.geojson').read_text()))
    publish(files)
    print(json.dumps({'catalogued': len(catalog['records']), 'located': catalog['located_counts'], 'operating': 0},ensure_ascii=False))


if __name__=='__main__': main()
