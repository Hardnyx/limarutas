"""Display explicit proposed transfer nodes at their linked axis intersections.

Documentary coordinates remain immutable. A geometric crossing alone never
creates a station or establishes a passenger interchange.
"""
import math
import re


def metres(a,b):
    return math.hypot((a[0]-b[0])*math.cos(math.radians(a[1]))*111195,(a[1]-b[1])*111195)


def crossings(first,second,center,radius):
    dx=radius/(111195*math.cos(math.radians(center[1])));dy=radius/111195
    west,east=center[0]-dx,center[0]+dx;south,north=center[1]-dy,center[1]+dy
    def nearby(geometry):
        return [(a,b) for part in geometry['coordinates'] for a,b in zip(part,part[1:])
                if max(a[0],b[0])>=west and min(a[0],b[0])<=east
                and max(a[1],b[1])>=south and min(a[1],b[1])<=north]
    # A crossing inside the review radius must be inside this bounding box;
    # prefilter whole segments without changing vertices or intersections.
    one,two=nearby(first),nearby(second)
    for a,b in one:
        for c,d in two:
            if max(a[0],b[0])<min(c[0],d[0]) or max(c[0],d[0])<min(a[0],b[0]) or max(a[1],b[1])<min(c[1],d[1]) or max(c[1],d[1])<min(a[1],b[1]):continue
            u=[b[i]-a[i] for i in (0,1)];v=[d[i]-c[i] for i in (0,1)]
            den=u[0]*v[1]-u[1]*v[0]
            if abs(den)<1e-16:continue
            delta=[c[i]-a[i] for i in (0,1)]
            t=(delta[0]*v[1]-delta[1]*v[0])/den
            s=(delta[0]*u[1]-delta[1]*u[0])/den
            if -1e-9<=t<=1+1e-9 and -1e-9<=s<=1+1e-9:
                yield [a[i]+t*u[i] for i in (0,1)]


def logical_line(feature):
    p=feature['properties'];m=re.search(r'Línea (\d+)',p['nombre'])
    return 'L'+m[1] if m else p['id']


def locate(record,axes,review):
    if not record['geometry'] or record['tipo'] not in ('centro_transferencia','nodo_intermodal'):return None
    linked=[axes[id] for id in record['project_ids'] if id in axes]
    candidates=[]
    for i,a in enumerate(linked):
        for b in linked[i+1:]:
            if logical_line(a)==logical_line(b):continue
            for point in crossings(a['geometry'],b['geometry'],record['geometry']['coordinates'],review['max_displacement_m']):
                delta=metres(record['geometry']['coordinates'],point)
                if delta<=review['max_displacement_m']:
                    candidates.append((delta,point,[a['id'],b['id']]))
    if not candidates:return None
    displacement,point,ids=min(candidates,key=lambda c:c[0])
    return {'geometry':{'type':'Point','coordinates':point},'method':'linked_axis_intersection',
        'displacement_m':round(displacement,2),'axis_ids':ids,'source_sha256':axes[ids[0]]['properties']['source_sha256'],
        'review_id':review['id'],'coordinate_role':'proposed_transfer_reference',
        'note':'Punto de transbordo proyectado alineado al cruce de los ejes. La ubicación documental original se conserva; no representa un acceso peatonal operativo.'}
