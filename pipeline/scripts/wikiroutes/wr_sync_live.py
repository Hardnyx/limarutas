"""Acquire, compare and conservatively apply WikiRoutes observations.

Acquisition uses one normal browser session and rendered map data. Published
files are never written by --scan. Geometry promotion requires a reviewed,
validated transaction; the first scan cannot authorize geometry changes.
"""
from __future__ import annotations
import argparse
import copy
import csv
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import urllib.robotparser
from collections import Counter
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from pipeline.scripts.wikiroutes.wr_catalog_live import CATALOG_URL,parse
from pipeline.scripts.wikiroutes.wr_geometry_diff import compare,digest,parts
from pipeline.scripts.wikiroutes.wr_compare import detect_trips,color,color_update,stop_changes,match_trips,merge_metadata
from pipeline.scripts.atu.sync_geovisor import publish
from pipeline.scripts.atu.sources import json_bytes


def now():return datetime.now(timezone.utc).isoformat()
def read(path,default=None):return json.loads(path.read_text()) if path.exists() else copy.deepcopy(default)
def write(path,data):
    path.parent.mkdir(parents=True,exist_ok=True);temp=path.with_suffix(path.suffix+'.tmp')
    temp.write_bytes(json_bytes(data));temp.replace(path)

def folder(root,rid):
    if not re.fullmatch(r'\d+',rid):raise ValueError('Invalid WR route id')
    base=(root/'data/processed/transporte').resolve();result=(base/f'route_{rid}').resolve()
    if result.parent!=base:raise ValueError('Route folder outside transporte')
    return result

class Browser:
    def __init__(self,root):
        self.process=subprocess.Popen(['node',str(ROOT/'pipeline/scripts/wikiroutes/wr_live_browser.mjs')],cwd=root,
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1)
    def acquire(self,url):
        self.process.stdin.write(json.dumps({'url':url})+'\n');self.process.stdin.flush()
        line=self.process.stdout.readline()
        if not line:raise RuntimeError('Browser process stopped; check its startup error')
        result=json.loads(line)
        if not result['ok']:raise RuntimeError(result['error'])
        return result['data']
    def close(self):
        if self.process.poll() is None:
            try:self.process.stdin.write('{"close":true}\n');self.process.stdin.flush();self.process.wait(timeout=10)
            except (OSError,subprocess.TimeoutExpired):self.process.terminate();self.process.wait(timeout=10)


def fetch_catalog():
    request=urllib.request.Request('https://wikiroutes.info/robots.txt',headers={'User-Agent':'LimaRutasSourceAudit/1.0'})
    with urllib.request.urlopen(request,timeout=30) as r:robots=r.read().decode()
    parser=urllib.robotparser.RobotFileParser();parser.parse(robots.splitlines())
    if not parser.can_fetch('LimaRutasSourceAudit',CATALOG_URL):raise ValueError('Catalog forbidden by robots.txt')
    with urllib.request.urlopen(urllib.request.Request(CATALOG_URL,headers={'User-Agent':'LimaRutasSourceAudit/1.0'}),timeout=30) as r:html=r.read().decode()
    return parse(html),parser


def local_stops(directory,trip):
    path=directory/f'stops_trip{trip}.geojson'
    if not path.exists():return []
    return [{'id':str(f['properties'].get('stop_id','')),'name':f['properties'].get('name'),
             'sequence':f['properties'].get('seq',i+1),'coordinates':f['geometry']['coordinates']}
            for i,f in enumerate(read(path)['features']) if f.get('geometry',{}).get('type')=='Point']


def compare_route(root,item,snapshot,wr,policy):
    rid=item['route_id'];directory=folder(root,rid);existing=directory.exists()
    layers={k:v for k,v in wr['routes'].items() if (root/v['folder']).resolve()==directory}
    live={t['trip']:t for t in snapshot['trips']}
    if len(live)!=len(snapshot['trips']):raise ValueError('Duplicate live trip id')
    old={trip:read(directory/f'route_track_trip{trip}.geojson') for trip in detect_trips(directory)}
    matches=match_trips(old,snapshot['trips']) if old else {}
    structure_changed=len(old)!=len(live)
    entries=[];changed_segments={}
    for key,entry in layers.items():
        trip=entry['trip'];source=directory/f'route_track_trip{trip}.geojson';stops=directory/f'stops_trip{trip}.geojson'
        target=live.get(matches.get(trip));classification='MAJOR_CHANGE';metrics=None;changes=[]
        protected=(directory/f'route_track_trip{trip}.route.json').exists()
        if target:
            classification,metrics,segments=compare(old[trip],target['geometry'],policy)
            changes=stop_changes(local_stops(directory,trip),target['stops'],policy)
            if changes:classification='MAJOR_CHANGE'
            if classification=='UNCHANGED' and digest(parts(old[trip]))!=digest(parts(target['geometry'])):classification='REDRAW_ONLY'
            if any(s['features'] for s in segments.values()):changed_segments[str(trip)]=segments
        if structure_changed:classification='MAJOR_CHANGE'
        review=protected and (not target or structure_changed or bool(changes) or digest(parts(old[trip]))!=digest(parts(target['geometry'])))
        if review:classification='NEEDS_REVIEW'
        new_color=color_update(entry.get('color'),snapshot['color_live'])
        entries.append({'route_id':rid,'layer_key':key,'local_trip':trip,'live_trip':target['trip'] if target else None,
            'old_color':entry.get('color'),'live_color':snapshot['color_live'],'safe_color':new_color,
            'geometry_metrics':metrics,'stop_changes':changes,'classification':classification,
            'source_hash':hashlib.sha256(source.read_bytes()).hexdigest() if source.exists() else None,
            'stops_hash':hashlib.sha256(stops.read_bytes()).hexdigest() if stops.exists() else None,
            'entry_hash':digest(entry),'authoring_protected':protected,
            'safe_to_apply':{'color':new_color!=entry.get('color'),'metadata':True,'geometry':False,'stops':False},
            'applied':False,'review_required':review or classification in ('MAJOR_CHANGE','MINOR_CHANGE'),
            'reason':'Accepted authoring preserved' if review else 'Observation only; geometric changes need calibration and a validated transaction'})
    status='EXISTING' if existing else 'NEW'
    return {'route_id':rid,'catalog_status':status,'active_wr':item['active'],'layers':entries,
        'live_trips':len(live),'structure_changed':structure_changed,'snapshot_hash':digest(snapshot),
        'new_route_review_required':not existing,'applied':False},changed_segments


def summarize(catalog,known,records,complete):
    successful=[r for r in records.values() if not r.get('error')]
    layers=[l for r in successful for l in r.get('layers',[])]
    return {'catalog_routes':len(catalog),'known':len({r['route_id'] for r in catalog}&known),
        'new':len({r['route_id'] for r in catalog}-known),'missing':len(known-{r['route_id'] for r in catalog}),
        'checked':len(records),'successful':len(successful),'errors':sum(bool(r.get('error')) for r in records.values()),
        'placeholder_to_live_layers':sum(l['safe_to_apply']['color'] for l in layers),
        'changed_real_colors':sum(l['old_color']!=l['live_color'] and not l['safe_to_apply']['color'] for l in layers),
        'geometry':dict(Counter(l['classification'] for l in layers)),
        'stops_changed_layers':sum(bool(l['stop_changes']) for l in layers),'scan_complete':complete}


def scan(args):
    root=args.root.resolve();cache=args.snapshot.resolve();policy=read(root/'config/wikiroutes_sync.json')
    wr=read(root/'pipeline/output/wr_map.json');catalog,robots=fetch_catalog()
    known={p.name.split('_',1)[1] for p in (root/'data/processed/transporte').glob('route_*') if p.is_dir()}
    local_hash=digest(wr);write(cache/'catalog.json',{'checked_at':now(),'routes':catalog})
    records=read(cache/'changes.json',{}).get('routes',{}) if args.resume else {}
    selected=[r for r in catalog if (not args.route or r['route_id'] in args.route)
        and (not args.only_new or r['route_id'] not in known)
        and (not args.only_default_colors or any(color_update(v.get('color'),'#123456')!=v.get('color') for v in wr['routes'].values() if v['folder'].endswith('/route_'+r['route_id'])))]
    if args.limit:selected=selected[:args.limit]
    summary={};browser=None
    def checkpoint(complete=False,blocker=None):
        nonlocal summary
        summary=summarize(catalog,known,records,complete)
        report={'version':1,'checked_at':now(),'local_catalog_hash':local_hash,'summary':summary,
            'missing_from_wikiroutes':sorted(known-{r['route_id'] for r in catalog}),
            'blocker':blocker,'routes':records}
        write(cache/'changes.json',report)
        return report
    def acquire(item):
        rid=item['route_id'];path=cache/f'route_{rid}'/'snapshot.json'
        if args.resume and path.exists() and rid in records and not records[rid].get('error'):
            snapshot=read(path)
            if records[rid].get('snapshot_hash')==digest(snapshot) and (datetime.now(timezone.utc)-datetime.fromisoformat(snapshot['checked_at'])).total_seconds()<86400:
                records[rid],_=compare_route(root,item,snapshot,wr,policy)
                return
        if not robots.can_fetch('LimaRutasSourceAudit',item['url']):raise ValueError('Route forbidden by robots.txt')
        snapshot=browser.acquire(item['url']);snapshot['checked_at']=now();snapshot['route_id']=rid
        if not snapshot['trips']:raise ValueError('No live trips')
        for t in snapshot['trips']:parts(t['geometry'])
        colors={color(t.get('color')) for t in snapshot['trips']} - {None}
        snapshot['color_live']=next(iter(colors)) if len(colors)==1 else None
        snapshot['color_conflict']=len(colors)>1
        write(path,snapshot)
        report,segments=compare_route(root,item,snapshot,wr,policy);records[rid]=report
        for trip,segment in segments.items():
            for side,features in segment.items():write(path.parent/f'{side}_changed_trip{trip}.geojson',features)
    try:
        browser=Browser(root)
        by_id={r['route_id']:r for r in catalog}
        # Fail before a full scan if normal live page/map extraction does not work.
        smoke=[by_id[rid] for rid in policy['smoke_routes'] if rid in by_id]
        if not smoke:raise ValueError('No configured smoke routes in catalog')
        for item in smoke:
            try:acquire(item)
            except Exception as e:
                records[item['route_id']]={'route_id':item['route_id'],'classification':'SCRAPE_ERROR','error':str(e),'checked_at':now()}
                checkpoint(blocker='Live smoke failed: '+str(e));raise RuntimeError('Live smoke failed; full scan was not started: '+str(e)) from e
        if not args.smoke:
            failures=0
            for i,item in enumerate(selected,1):
                if item['route_id'] in {r['route_id'] for r in smoke}:continue
                try:acquire(item);failures=0
                except Exception as e:
                    records[item['route_id']]={'route_id':item['route_id'],'classification':'SCRAPE_ERROR','error':str(e),'checked_at':now()};failures+=1
                    if 'SITE_BLOCK' in str(e) or failures>=5:
                        checkpoint(blocker=str(e));raise RuntimeError('Scan stopped after a site block or repeated failures') from e
                if i%20==0:checkpoint();print(json.dumps({'checked':len(records),'total':len(selected)}),flush=True)
                if args.delay:time.sleep(args.delay)
        complete=not args.smoke and len(selected)==len(catalog) and all(r['route_id'] in records for r in catalog)
        report=checkpoint(complete)
        print(json.dumps(report['summary'],indent=2),flush=True)
        return report
    finally:
        if browser:browser.close()


def apply_safe(args):
    root=args.root.resolve();cache=args.snapshot.resolve();report=read(cache/'changes.json')
    if not report or not report['summary']['scan_complete']:raise ValueError('A full reviewed scan is required before application')
    wr_path=root/'pipeline/output/wr_map.json';before=read(wr_path);wr=copy.deepcopy(before)
    if digest(wr)!=report['local_catalog_hash']:raise ValueError('Local catalog changed after scan; compare again')
    overrides_path=root/'config/wr_overrides.json';overrides=read(overrides_path,{})
    changes=copy.deepcopy(report);manifest_path=root/'pipeline/output/wikiroutes_manifest.json'
    manifest=read(manifest_path,{'version':1,'routes':{}});count=0
    for rid,r in changes['routes'].items():
        if r.get('error'):
            manifest['routes'].setdefault(rid,{})['last_error']={'checked_at':r['checked_at'],'error':r['error']};continue
        snapshot=read(cache/f'route_{rid}'/'snapshot.json')
        if digest(snapshot)!=r['snapshot_hash']:raise ValueError('Snapshot changed after comparison')
        for layer in r['layers']:
            key=layer['layer_key'];entry=wr['routes'][key];directory=folder(root,rid);trip=entry['trip']
            if digest(entry)!=layer['entry_hash']:raise ValueError('Layer changed after comparison')
            for name,expected in [(f'route_track_trip{trip}.geojson',layer['source_hash']),(f'stops_trip{trip}.geojson',layer['stops_hash'])]:
                p=directory/name
                if not p.exists() or hashlib.sha256(p.read_bytes()).hexdigest()!=expected:raise ValueError('Local source changed after scan')
            wr['routes'][key]=merge_metadata(entry,rid,snapshot,layer['live_trip'])
            if layer['safe_to_apply']['color']:
                for override_key in [rid,'route_'+rid]:
                    if override_key in overrides:overrides[override_key]['color']=color_update(overrides[override_key].get('color'),snapshot['color_live'])
                count+=1
            layer['applied']={'metadata':True,'color':layer['safe_to_apply']['color'],'geometry':False,'stops':False}
        manifest['routes'][rid]={'checked_at':snapshot['checked_at'],'url':snapshot['url'],'active_wr':r['active_wr'],
            'color_live':snapshot['color_live'],'trips':len(snapshot['trips']),
            'geometry_hash':{str(t['trip']):digest(parts(t['geometry'])) for t in snapshot['trips']},
            'stops_hash':{str(t['trip']):digest(t['stops']) for t in snapshot['trips']},
            'classification':{str(l['local_trip']):l['classification'] for l in r['layers']},
            'new_route_review_required':r['new_route_review_required']}
    if set(wr['routes'])!=set(before['routes']):raise ValueError('Unexpected layer addition or removal')
    manifest['checked_at']=now();changes['applied_at']=now()
    history={'checked_at':manifest['checked_at'],'summary':report['summary'],'routes':manifest['routes']}
    files={wr_path:json_bytes(wr),overrides_path:json_bytes(overrides),manifest_path:json_bytes(manifest),
        root/'pipeline/output/wikiroutes_changes.json':json_bytes(changes),
        root/f'data/history/wikiroutes/{manifest["checked_at"][:10]}.json':json_bytes(history)}
    # Domain checks run before and after the transactional publication; roll back if they fail.
    from pipeline.validation import validate_site
    validate_site(root);backup={p:p.read_bytes() if p.exists() else None for p in files}
    try:publish(files);validate_site(root)
    except Exception:
        publish({p:b for p,b in backup.items() if b is not None})
        for p,b in backup.items():
            if b is None and p.exists():p.unlink()
        raise
    print(json.dumps({'color_layers_applied':count,'geometry_applied':0,'stops_applied':0,'new_routes_applied':0}))


def main():
    p=argparse.ArgumentParser(description=__doc__);mode=p.add_mutually_exclusive_group(required=True)
    mode.add_argument('--scan',action='store_true');mode.add_argument('--apply-safe',action='store_true')
    p.add_argument('--root',type=Path,default=ROOT);p.add_argument('--snapshot',type=Path,default=ROOT/'pipeline/temp/wikiroutes_live')
    p.add_argument('--route',action='append');p.add_argument('--only-new',action='store_true');p.add_argument('--only-default-colors',action='store_true')
    p.add_argument('--resume',action='store_true');p.add_argument('--smoke',action='store_true');p.add_argument('--limit',type=int);p.add_argument('--delay',type=float,default=.25)
    args=p.parse_args()
    if args.scan:scan(args)
    else:apply_safe(args)

if __name__=='__main__':
    try:main()
    except (ValueError,RuntimeError,OSError) as e:print(str(e),file=sys.stderr);sys.exit(1)
