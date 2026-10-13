"""Conservative identity, color, stop, and trip comparison."""
import copy
import re
from pathlib import Path
from pipeline.scripts.wikiroutes.wr_apply_maestro_colors import is_default
from pipeline.scripts.wikiroutes.wr_geometry_diff import parts,metres,digest,compare

HEX=re.compile(r'^#[0-9a-fA-F]{6}$')
def color(value):
    value=str(value or '').strip()
    if re.fullmatch('[0-9A-Fa-f]{6}',value):value='#'+value
    m=re.fullmatch(r'rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[^)]+)?\)',value)
    if m:value='#'+''.join(f'{int(x):02X}' for x in m.groups())
    return value.upper() if HEX.fullmatch(value) else None

def color_update(old,live):
    live=color(live)
    return live if is_default(old) and live and not is_default(live) else old

def detect_trips(folder):
    return sorted(int(m.group(1)) for p in Path(folder).glob('route_track_trip*.geojson') if (m:=re.fullmatch(r'route_track_trip(\d+)\.geojson',p.name)))

def stop_changes(old,new,policy):
    if new is None:return [{'type':'STOPS_UNAVAILABLE'}]
    before={str(p['id']):p for p in old};after={str(p['id']):p for p in new}
    if len(before)!=len(old) or len(after)!=len(new):return [{'type':'STOP_ID_AMBIGUOUS'}]
    changes=[]
    if any(not p.get('coordinates') for p in new):changes.append({'type':'STOP_COORDINATES_UNAVAILABLE'})
    for id in before.keys()-after.keys():changes.append({'type':'STOP_REMOVED','id':id})
    for id in after.keys()-before.keys():changes.append({'type':'STOP_ADDED','id':id})
    for id in before.keys()&after.keys():
        a,b=before[id],after[id]
        if a.get('name')!=b.get('name'):changes.append({'type':'STOP_RENAMED','id':id,'old':a.get('name'),'new':b.get('name')})
        if a.get('coordinates') and b.get('coordinates') and metres(a['coordinates'],b['coordinates'])>policy['stop_move_m']:
            changes.append({'type':'STOP_MOVED','id':id,'distance_m':metres(a['coordinates'],b['coordinates'])})
    common=before.keys()&after.keys()
    if [p['id'] for p in old if str(p['id']) in common]!=[p['id'] for p in new if str(p['id']) in common]:changes.append({'type':'STOP_REORDERED'})
    return sorted(changes,key=lambda c:(c['type'],c.get('id','')))

def match_trips(local,live):
    candidates=[]
    for old_id,a in local.items():
        aa=parts(a)
        for b in live:
            bb=parts(b['geometry']);cost=min(metres(aa[0][0],bb[0][0])+metres(aa[-1][-1],bb[-1][-1]),metres(aa[0][0],bb[-1][-1])+metres(aa[-1][-1],bb[0][0]))
            candidates.append((cost,old_id,b['trip']))
    used_old=set();used_new=set();matched={}
    for cost,a,b in sorted(candidates):
        if a in used_old or b in used_new:continue
        used_old.add(a);used_new.add(b);matched[a]=b
    return matched

def merge_metadata(entry,route_id,snapshot,trip):
    out=copy.deepcopy(entry)
    # WR observations are namespaced; official and manual labels stay untouched.
    out['wikiroutes']={'route_id':route_id,'url':snapshot['url'],'title':snapshot['title'],'live_trip':trip,
        'checked_at':snapshot['checked_at'],'source_role':'secondary_observation'}
    out['color']=color_update(entry.get('color'),snapshot['color_live'])
    return out
