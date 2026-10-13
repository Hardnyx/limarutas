"""Build a display-only station view while preserving source coordinates."""
import copy
from pipeline.scripts.atu.transfer_display import locate, metres


def nearest(point, geometry):
    import math
    scale=math.cos(math.radians(point[1]));best=None
    parts=geometry['coordinates'] if geometry['type']=='MultiLineString' else [geometry['coordinates']]
    for part in parts:
        for a,b in zip(part,part[1:]):
            x,y=(a[0]-point[0])*scale,a[1]-point[1]
            dx,dy=(b[0]-a[0])*scale,b[1]-a[1]
            t=max(0,min(1,-(x*dx+y*dy)/(dx*dx+dy*dy))) if dx or dy else 0
            p=[a[i]+t*(b[i]-a[i]) for i in (0,1)]
            candidate=(metres(point,p),p)
            if best is None or candidate[0]<best[0]:best=candidate
    return best


def apply(catalog, red, locations, metro, met):
    axes={f['id']:f for f in red['features']}
    review=locations['station_display_review']
    operating=[];sequences={}
    for feature in metro['features']:
        if feature['geometry']['type']!='Point':continue
        p=feature['properties'];line=p['ref'];sequences[line]=sequences.get(line,0)+1
        projects=[f['id'] for f in red['features'] if f['properties']['modo']=='metro' and
                  f'Línea {line[1:]} ' in f['properties']['nombre'] and 'Ampliación' not in f['properties']['nombre']]
        operating.append({'id':f'contexto:metro:{line}:{p["_osm_id"]}', 'nombre':p['name'],
            'tipo':'estacion','modo':'metro','lineas':[line],'project_ids':projects,'sequence':sequences[line]+19 if line=='L2' else sequences[line],
            'estado':'en_operacion','geometry':copy.deepcopy(feature['geometry']),
            'source_geometry':copy.deepcopy(feature['geometry']),'display_geometry':None,
            'location_method':'operating_catalog','uncertainty_note':'Estación existente del catálogo operativo de Rutas.',
            'operativo':False,'ruteable':False,'plannerEligible':False,
            'source_refs':[{'source_id':'operating-metro','url':f'https://www.openstreetmap.org/node/{p["_osm_id"]}', 'edition':'Catálogo operativo de Rutas'}]})
    north=next(f['id'] for f in red['features'] if 'brt-metropolitano-ampliacion-norte' in f['id'])
    base=next(f['id'] for f in red['features'] if 'brt-metropolitano-chorrillos' in f['id'])
    naranjal=next(i for i,r in enumerate(met['stations']) if r['id']=='naranjal')
    for i,p in enumerate(met['stations']):
        if p.get('pending') or p.get('lon') is None or p.get('lat') is None:continue
        geometry={'type':'Point','coordinates':[p['lon'],p['lat']]}
        operating.append({'id':'contexto:metropolitano:'+p['id'],'nombre':p['name'],
            'tipo':'estacion','modo':'brt','lineas':['Metropolitano'],'project_ids':[north if i<naranjal else base],
            'sequence':i+1,'estado':'en_operacion','geometry':geometry,'source_geometry':copy.deepcopy(geometry),
            'display_geometry':None,'location_method':'operating_catalog',
            'uncertainty_note':'Estación existente del catálogo de Rutas.',
            'operativo':False,'ruteable':False,'plannerEligible':False,
            'source_refs':[{'source_id':'operating-brt','url':'https://github.com/Hardnyx/limarutas/blob/main/data/processed/metropolitano/metropolitano_stops.json','edition':'Catálogo operativo de Rutas'}]})
    records=catalog['records']+operating;by_id={r['id']:r for r in records}
    for shared in review['shared_stations']:
        members=[by_id[id] for id in shared['record_ids']]
        located=next((r for r in members if r['geometry']),None)
        if not located:raise ValueError('Shared station has no source position')
        ids=list(dict.fromkeys(id for r in members for id in r['project_ids']))
        synthetic={**located,'tipo':'centro_transferencia','project_ids':ids}
        adjustment=locate(synthetic,axes,review)
        if not adjustment:raise ValueError('Shared station has no linked intersection: '+shared['id'])
        for r in members:
            r['display_geometry']=copy.deepcopy(adjustment['geometry'])
            r['display_adjustment']={k:v for k,v in adjustment.items() if k!='geometry'}
            r['display_adjustment'].update(coordinate_role='shared_station_reference',shared_station_id=shared['id'],
                displacement_m=round(metres(r['geometry']['coordinates'],adjustment['geometry']['coordinates']),2) if r['geometry'] else None)
            r['display_project_ids']=ids
    for r in records:
        if r.get('display_geometry') or not r['geometry'] or not r['project_ids']:continue
        choices=[(*nearest(r['geometry']['coordinates'],axes[id]['geometry']),id) for id in r['project_ids']]
        displacement,point,id=min(choices,key=lambda c:c[0])
        if displacement>review['max_displacement_m']:raise ValueError('Display point exceeds reviewed axis distance: '+r['id'])
        r['display_geometry']={'type':'Point','coordinates':point}
        r['display_adjustment']={'method':'linked_axis_projection','axis_ids':[id],
            'displacement_m':round(displacement,2),'review_id':review['id'],
            'coordinate_role':'station_axis_reference' if r['tipo']=='estacion' else 'planning_axis_reference',
            'note':'Referencia visual alineada a su trazado; se conserva la coordenada original y su fuente.'}
    catalog['operating_stations']=operating
