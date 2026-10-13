"""Bidirectional sampled spatial comparison; no joining of multipart gaps."""
import hashlib
import json
import math

X=111320*math.cos(math.radians(-12.05));Y=110574

def point(p):return (p[0]*X,p[1]*Y)
def metres(a,b):return math.dist(point(a),point(b))
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()

def parts(collection):
    result=[]
    for f in collection.get('features',[]):
        g=f.get('geometry') or {};kind=g.get('type')
        if kind not in ('LineString','MultiLineString'):raise ValueError('Unexpected track geometry')
        for line in g['coordinates'] if kind=='MultiLineString' else [g['coordinates']]:
            if len(line)<2:raise ValueError('Empty track component')
            if any(len(p)<2 or not all(type(v) in (float,int) and math.isfinite(v) for v in p[:2]) or not (-180<=p[0]<=180 and -90<=p[1]<=90) for p in line):raise ValueError('Invalid track coordinates')
            result.append([p[:2] for p in line])
    if not result:raise ValueError('Empty track')
    return result

def sample(lines,step):
    out=[];total=0
    for line in lines:
        # Cumulative spacing makes a redraw insensitive to vertex density.
        remaining=0
        for a,b in zip(line,line[1:]):
            n=metres(a,b);total+=n
            if not n:continue
            while remaining<n:
                t=remaining/n;out.append([a[i]+t*(b[i]-a[i]) for i in (0,1)]);remaining+=step
            remaining-=n
        out.append(line[-1])
    return out,total

class Tree:
    def __init__(self,points,depth=0):
        axis=depth%2;points=sorted(points,key=lambda p:p[axis]);mid=len(points)//2
        self.p=points[mid];self.axis=axis
        self.left=Tree(points[:mid],depth+1) if mid else None
        self.right=Tree(points[mid+1:],depth+1) if mid+1<len(points) else None
    def nearest(self,p,best=math.inf):
        best=min(best,math.dist(p,self.p));delta=p[self.axis]-self.p[self.axis]
        first,other=(self.left,self.right) if delta<0 else (self.right,self.left)
        if first:best=first.nearest(p,best)
        if other and abs(delta)<best:best=other.nearest(p,best)
        return best

def distribution(values):
    values=sorted(values)
    def percentile(q):return values[min(len(values)-1,math.ceil(q*len(values))-1)]
    return {'mean_m':sum(values)/len(values),'median_m':percentile(.5),'p90_m':percentile(.9),
            'p95_m':percentile(.95),'maximum_m':max(values),
            'coverage':{str(m):sum(v<=m for v in values)/len(values) for m in (15,30,50,100)}}

def compare(old,new,policy):
    a,b=parts(old),parts(new);sa,la=sample(a,policy['sample_m']);sb,lb=sample(b,policy['sample_m'])
    ta,tb=Tree([point(p) for p in sa]),Tree([point(p) for p in sb])
    distances_new=[ta.nearest(point(p)) for p in sb];distances_old=[tb.nearest(point(p)) for p in sa]
    start,end=metres(a[0][0],b[0][0]),metres(a[-1][-1],b[-1][-1])
    reverse_start,reverse_end=metres(a[0][0],b[-1][-1]),metres(a[-1][-1],b[0][0])
    reverse=reverse_start+reverse_end<start+end
    if reverse:start,end=reverse_start,reverse_end
    metrics={'old_length_m':la,'new_length_m':lb,'length_change_ratio':abs(lb-la)/la if la else math.inf,
        'new_to_old':distribution(distances_new),'old_to_new':distribution(distances_old),
        'start_distance_m':start,'end_distance_m':end,'orientation_reversed':reverse,
        'old_components':len(a),'new_components':len(b)}
    kind='MAJOR_CHANGE'
    for label,key in [('UNCHANGED','unchanged'),('REDRAW_ONLY','redraw'),('MINOR_CHANGE','minor')]:
        limits=policy[key];metric_pair=[metrics['old_to_new'],metrics['new_to_old']]
        if (all(m['coverage'][str(limits['coverage_m'])]>=limits['coverage'] and m['p95_m']<limits.get('p95_m',math.inf) for m in metric_pair)
            and metrics['length_change_ratio']<=limits['length_ratio'] and max(start,end)<=limits['endpoint_m']
            and len(a)==len(b)):
            kind=label;break
    return kind,metrics,{'old':changed(sa,distances_old,50),'new':changed(sb,distances_new,50)}

def changed(points,distances,threshold):
    # A point collection never introduces false connecting segments across gaps.
    return {'type':'FeatureCollection','features':[{'type':'Feature','geometry':{'type':'Point','coordinates':p},'properties':{'distance_m':round(d,2)}} for p,d in zip(points,distances) if d>threshold]}
