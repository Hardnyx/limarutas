"""Download conditional document candidates, retaining all reviewed locations.

A changed document hash requests manual review. It never triggers geocoding,
changes station positions, or promotes a candidate into the published catalog.
"""
from __future__ import annotations
import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from pipeline.scripts.atu.sources import sha, json_bytes, atomic_bytes, now


def synchronize(config, folder, force=False):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    state_path=folder/'current.json'
    state=json.loads(state_path.read_text()) if state_path.exists() else {}
    report={'checked_at':now(),'sources':{},'publication_changed':False,'automatic_geocoding':False}
    for sid,source in config['sources'].items():
        if source.get('format') not in ('pdf','html'):continue
        old=state.get(sid,{})
        headers={'User-Agent':'LimaRutas ATU source audit','Accept':'application/pdf,text/html'}
        cached=folder/old.get('snapshot','missing')
        valid_cache=cached.is_file() and sha(cached.read_bytes())==old.get('sha256')
        if not force and valid_cache:
            if old.get('etag'):headers['If-None-Match']=old['etag']
            if old.get('last_modified'):headers['If-Modified-Since']=old['last_modified']
        try:
            try:
                with urllib.request.urlopen(urllib.request.Request(source['url'],headers=headers),timeout=30) as response:
                    body=response.read(64*1024*1024+1)
                    if len(body)>64*1024*1024:raise ValueError('Documento demasiado grande')
                    if source['format']=='pdf' and not body.startswith(b'%PDF-'):raise ValueError('La respuesta no es un PDF')
                    digest=sha(body);snapshot=f'{sid}/{digest}/source.{source["format"]}'
                    atomic_bytes(folder/snapshot,body)
                    old={'sha256':digest,'snapshot':snapshot,'etag':response.headers.get('ETag'),
                         'last_modified':response.headers.get('Last-Modified')}
                    state[sid]=old;status='downloaded'
            except urllib.error.HTTPError as error:
                if error.code!=304 or not valid_cache:raise
                status='not_modified'
            report['sources'][sid]={'status':status,'sha256':old['sha256'],
                'requires_document_review':old['sha256']!=source['sha256'],'reviewed_sha256':source['sha256']}
        except (OSError,ValueError) as error:
            report['sources'][sid]={'status':'failed','error':str(error),'last_good_preserved':True,'reviewed_sha256':source['sha256']}
    atomic_bytes(state_path,json_bytes(state))
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--force',action='store_true')
    args=parser.parse_args()
    from pipeline.authoring.store import writer_lock
    folder=ROOT/'pipeline/temp/atu-station-sources'
    folder.mkdir(parents=True,exist_ok=True)
    with writer_lock(folder/'.sync.lock'):
        report=synchronize(json.loads((ROOT/'config/atu_station_sources.json').read_text()),folder,args.force)
        atomic_bytes(ROOT/'pipeline/temp/atu-station-source-report.json',json_bytes(report))
    print(json.dumps({'sources':{k:v['status'] for k,v in report['sources'].items()},'publication_changed':False}))
