"""Match PMU axes to existing corridor routes without changing either source."""
import copy
import hashlib
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:sys.path.insert(0,str(ROOT))

SCALE_X=111195*math.cos(math.radians(-12));SCALE_Y=111195
CODES={'1':'amarillo','2':'rojo','3':'azul','4':'morado','5':'verde'}

def xy(p):return (p[0]*SCALE_X,p[1]*SCALE_Y)
def parts(g):return g['coordinates'] if g['type']=='MultiLineString' else [g['coordinates']]
def length(a,b):return math.dist(xy(a),xy(b))

def subdivide(part,step):
    points=[];positions=[]
    for i,(a,b) in enumerate(zip(part,part[1:])):
        count=max(1,math.ceil(length(a,b)/step))
        for j in range(count):
            t=j/count;points.append([a[k]+t*(b[k]-a[k]) for k in (0,1)]);positions.append(i+t)
    points.append(part[-1]);positions.append(len(part)-1)
    return points,positions

class SegmentIndex:
    def __init__(self,features,radius=80):
        self.cells=defaultdict(list);self.radius=radius;self.size=200
        for feature in features:
            p=feature['properties'];code=str(p.get('ref',''))
            group='morado' if code.upper().startswith('SE-02') else CODES.get(code[:1])
            if not group or feature['geometry']['type']=='Point':continue
            for part in parts(feature['geometry']):
                for a,b in zip(part,part[1:]):
                    a,b=xy(a),xy(b)
                    if a==b:continue
                    value=(a,b,group,code)
                    for x in range(math.floor((min(a[0],b[0])-radius)/self.size),math.floor((max(a[0],b[0])+radius)/self.size)+1):
                        for y in range(math.floor((min(a[1],b[1])-radius)/self.size),math.floor((max(a[1],b[1])+radius)/self.size)+1):self.cells[x,y].append(value)
    def match(self,a,b,policy):
        a,b=xy(a),xy(b);point=((a[0]+b[0])/2,(a[1]+b[1])/2)
        ux,uy=b[0]-a[0],b[1]-a[1];norm=math.hypot(ux,uy)
        if not norm:return None
        candidates={}
        for c,d,group,code in self.cells.get((math.floor(point[0]/self.size),math.floor(point[1]/self.size)),[]):
            vx,vy=d[0]-c[0],d[1]-c[1];vn=math.hypot(vx,vy)
            if abs((ux*vx+uy*vy)/(norm*vn))<math.cos(math.radians(policy['direction_degrees'])):continue
            t=max(0,min(1,((point[0]-c[0])*vx+(point[1]-c[1])*vy)/(vn*vn)))
            distance=math.hypot(c[0]+t*vx-point[0],c[1]+t*vy-point[1])
            if distance<=self.radius and (group not in candidates or distance<candidates[group][0]):candidates[group]=(distance,code)
        ordered=sorted((v[0],g,v[1]) for g,v in candidates.items())
        if not ordered or (len(ordered)>1 and ordered[1][0]-ordered[0][0]<policy['ambiguous_distance_m']):return None
        return ordered[0][1]


def runs(part,labels,minimum):
    start=0;out=[]
    while start<len(labels):
        end=start+1
        while end<len(labels) and labels[end]==labels[start]:end+=1
        group=labels[start]
        if group and sum(length(a,b) for a,b in zip(part[start:end+1],part[start+1:end+1]))<minimum:group=None
        if out and out[-1]['corridor']==group:out[-1]['end']=end
        else:out.append({'start':start,'end':end,'corridor':group})
        start=end
    return out


def build(root):
    root=Path(root);paths=['config/atu_project_styles.json','data/processed/planificado/red.geojson','data/processed/corredores/corredores.json']
    blobs=[(root/p).read_bytes() for p in paths];config,red,current=map(json.loads,blobs)
    policy=config['matching_policy'];index=SegmentIndex(current['features'],policy['distance_m'])
    projects=copy.deepcopy(config['projects'])
    for feature in red['features']:
        if feature['properties']['modo']!='corredor' or feature['id'] in projects:continue
        segments=[];coverage=defaultdict(float);total=0
        for pi,part in enumerate(parts(feature['geometry'])):
            dense,positions=subdivide(part,policy['sample_m'])
            labels=[index.match(a,b,policy) for a,b in zip(dense,dense[1:])]
            for run in runs(dense,labels,policy['minimum_run_m']):
                run['part']=pi;segments.append(run)
                n=sum(length(a,b) for a,b in zip(dense[run['start']:run['end']+1],dense[run['start']+1:run['end']+1]))
                run['start']=round(positions[run['start']],10);run['end']=round(positions[run['end']],10)
                total+=n
                if run['corridor']:coverage[run['corridor']]+=n
        if not coverage:continue
        ranking=sorted(coverage,key=lambda g:-coverage[g]);winner=ranking[0];ratio=coverage[winner]/total
        margin=ratio-(coverage[ranking[1]]/total if len(ranking)>1 else 0)
        whole=ratio>=policy['axis_coverage'] and margin>=policy['winner_margin']
        route_coverage={}
        if whole:
            probe=copy.deepcopy(feature);probe['properties']['ref']=next(k for k,v in CODES.items() if v==winner)+'00'
            axis_index=SegmentIndex([probe],policy['distance_m'])
            for route in current['features']:
                code=str(route['properties'].get('ref',''))
                if route['geometry']['type']=='Point' or CODES.get(code[:1])!=winner:continue
                covered=route_length=0
                for original in parts(route['geometry']):
                    part,_=subdivide(original,policy['sample_m'])
                    for a,b in zip(part,part[1:]):
                        n=length(a,b);route_length+=n
                        if axis_index.match(a,b,policy):covered+=n
                if route_length:route_coverage[code]=max(route_coverage.get(code,0),covered/route_length)
            whole=max(route_coverage.values(),default=0)>=policy['existing_route_coverage']
        projects[feature['id']]={'corridor':winner if whole else 'mixto','code':next(k for k,v in CODES.items() if v==winner) if whole else None,
            'relation':'geometry_correspondence' if whole else 'shared_corridor_segments','scope':'cartographic_identity_only',
            'source_url':'https://www.openstreetmap.org','segments':segments,
            'coverage':{g:round(n/total,4) for g,n in coverage.items()},'existing_route_coverage':{g:round(n,4) for g,n in route_coverage.items()},
            'note':'Correspondencia visual calculada con los trazados del catálogo existente; no es una asignación oficial ni implica reemplazo del servicio.'}
    return {'version':1,'projects':projects,'unassigned_label':config['unassigned_label'],'matching_policy':policy,
            'input_hashes':{p:hashlib.sha256(b).hexdigest() for p,b in zip(paths,blobs)}}


def check(root):
    from pipeline.scripts.atu.sources import json_bytes
    root=Path(root);expected=json_bytes(build(root))
    if (root/'data/processed/planificado/colores_corredores.json').read_bytes()!=expected:raise ValueError('Correspondencias de corredores desactualizadas')

if __name__=='__main__':
    from pipeline.scripts.atu.sources import json_bytes
    from pipeline.scripts.atu.sync_geovisor import publish
    root=Path(__file__).resolve().parents[3]
    value=build(root);publish({root/'data/processed/planificado/colores_corredores.json':json_bytes(value)})
    print(len(value['projects']),'ejes con identidad o segmentos de corredores')
