#!/usr/bin/env python3
"""Download validated ATU candidates; never modify published routes or deployment."""
from __future__ import annotations

import argparse
import concurrent.futures
import copy
import datetime as dt
import hashlib
import json
import math
import os
import platform
import socket
import ssl
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

VERSION = 1
BASE = 'https://geovisor.atumovilidad.pe/'
URLS = {'pmu': BASE+'data/pmu_sit.geojson', 'prr': BASE+'data/prr_v1.geojson', 'sit': BASE+'data/sit_actual.geojson'}
REQUIRED = {
    'pmu': {'OBJECTID','nombre','estado','tecnologia','hz_pmu','long_km','tec_cp','tec_mp','tec_lp'},
    'prr': {'ruta','sentido','operador','resolucion'},
    'sit': {'fid','ruta','nombre','sentido','servicio'},
}
CRS = {'urn:ogc:def:crs:OGC:1.3:CRS84','urn:ogc:def:crs:EPSG::4326','EPSG:4326','OGC:CRS84'}
RETRY_HTTP = {429,500,502,503,504}
MAX_BYTES = 64 * 1024 * 1024


class SourceError(ValueError):
    pass


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def reject_constant(value):
    raise SourceError('Número JSON no finito: '+value)


def normalized(value):
    if isinstance(value, dict):
        return {k: normalized(v) for k,v in value.items()}
    if isinstance(value, list):
        return [normalized(v) for v in value]
    if type(value) is float and value.is_integer():
        return int(value)
    return value


def canonical(value):
    return json.dumps(normalized(value),ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)


def digest(value):
    return sha(canonical(value).encode('utf-8'))


def text_key(value):
    return unicodedata.normalize('NFKC',str(value)).strip().casefold()


def identity(dataset, properties):
    fields={'pmu':('nombre','hz_pmu'),'prr':('ruta','sentido'),'sit':('servicio','ruta','sentido')}[dataset]
    return canonical([text_key(properties.get(k)) for k in fields])


def inspect(dataset, raw):
    try:
        value=json.loads(raw,parse_constant=reject_constant)
    except (UnicodeDecodeError,json.JSONDecodeError) as e:
        raise SourceError('La respuesta no es un JSON completo válido') from e
    if not isinstance(value,dict) or value.get('type')!='FeatureCollection':
        raise SourceError('Se requiere FeatureCollection')
    crs=value.get('crs')
    if crs is not None:
        name=crs.get('properties',{}).get('name') if isinstance(crs,dict) else None
        if name not in CRS:
            raise SourceError('CRS no admitido en grados: '+str(name))
    features=value.get('features')
    if not isinstance(features,list) or not features:
        raise SourceError('Colección de geometrías vacía')
    fields=set(); groups=defaultdict(list); vertices=0; parts_count=0; object_ids=[]; gid=[]
    for index,feature in enumerate(features):
        if not isinstance(feature,dict) or feature.get('type')!='Feature':
            raise SourceError('Objeto sin tipo Feature')
        properties=feature.get('properties')
        if not isinstance(properties,dict) or not REQUIRED[dataset].issubset(properties):
            raise SourceError('Faltan campos obligatorios en '+dataset+' / '+str(index))
        fields.update(properties)
        names=('nombre','estado','tecnologia') if dataset=='pmu' else (('ruta','sentido') if dataset=='prr' else ('nombre','servicio'))
        if any(not isinstance(properties.get(k),str) or not properties[k].strip() for k in names):
            raise SourceError('Identidad textual incompleta en '+dataset)
        if dataset=='pmu':
            if type(properties['hz_pmu']) not in (int,float) or properties['hz_pmu'] not in (0,5,10,20):
                raise SourceError('Horizonte PMU nuevo o inválido; revisar el contrato')
            if type(properties['long_km']) not in (int,float) or not math.isfinite(properties['long_km']) or properties['long_km']<0:
                raise SourceError('Longitud PMU inválida')
            object_ids.append(canonical(properties['OBJECTID']))
        if dataset=='prr':
            if properties['sentido'].strip().upper() not in ('IDA','VUELTA'):
                raise SourceError('Sentido PRR nuevo o inválido; revisar el contrato')
            if 'gid' in properties:gid.append(canonical(properties['gid']))
        geometry=feature.get('geometry')
        if not isinstance(geometry,dict) or geometry.get('type') not in ('LineString','MultiLineString'):
            raise SourceError('Geometría no admitida por este adaptador de líneas')
        coords=geometry.get('coordinates')
        parts=[coords] if geometry['type']=='LineString' else coords
        if not isinstance(parts,list) or not parts:
            raise SourceError('Trazado sin partes')
        for part in parts:
            if not isinstance(part,list) or len(part)<2:
                raise SourceError('Parte con menos de dos vértices')
            for point in part:
                if not isinstance(point,list) or len(point) not in (2,3) or any(type(v) not in (int,float) or not math.isfinite(v) for v in point):
                    raise SourceError('Coordenadas no finitas o estructura inválida')
                lon,lat=point[:2]
                if not -78.5<=lon<=-75.0 or not -14.5<=lat<=-10.0:
                    raise SourceError('Coordenadas fuera del ámbito esperado; revisar CRS o ejes')
            if not any(p!=part[0] for p in part[1:]):
                raise SourceError('Parte con longitud cero')
            vertices+=len(part);parts_count+=1
        groups[identity(dataset,properties)].append(feature)
    if object_ids and len(object_ids)!=len(set(object_ids)):
        raise SourceError('OBJECTID PMU repetido')
    if gid and len(gid)!=len(set(gid)):
        raise SourceError('gid PRR repetido')
    if dataset in ('pmu','prr') and any(len(items)>1 for items in groups.values()):
        raise SourceError('Identidad lógica ambigua en '+dataset)
    # SIT groups intentionally keep every feature, including repeated service/direction keys.
    hashes=sorted(canonical(f) for f in features)
    info={'features':len(features),'parts':parts_count,'vertices':vertices,'fields':sorted(fields),
        'logicalGroups':len(groups),'multiFeatureGroups':sum(len(items)>1 for items in groups.values()),
        'semanticSha256':digest({'features':hashes,'crs':'OGC:CRS84'})}
    return value,info


def groups_of(dataset, collection):
    groups=defaultdict(list)
    for feature in collection['features']:
        groups[identity(dataset,feature['properties'])].append(feature)
    return dict(groups)


def compare(dataset, before, after):
    old=groups_of(dataset,before) if before else {}
    new=groups_of(dataset,after)
    added=sorted(set(new)-set(old));removed=sorted(set(old)-set(new))
    geometry=[];attributes=[]
    for key in sorted(set(old)&set(new)):
        if sorted(canonical(f['geometry']) for f in old[key])!=sorted(canonical(f['geometry']) for f in new[key]):geometry.append(key)
        if sorted(canonical(f['properties']) for f in old[key])!=sorted(canonical(f['properties']) for f in new[key]):attributes.append(key)
    old_fields={k for f in (before or {}).get('features',[]) for k in f['properties']}
    new_fields={k for f in after['features'] for k in f['properties']}
    changed=bool(added or removed or geometry or attributes)
    return {'dataChanged':changed,'added':added,'removed':removed,'geometryChanged':geometry,'attributesChanged':attributes,
        'schemaAdded':sorted(new_fields-old_fields),'schemaRemoved':sorted(old_fields-new_fields)}


def ssl_context():
    # Honour an explicitly configured trust bundle without disabling certificate verification.
    bundle=next((os.environ.get(k) for k in ('SSL_CERT_FILE','REQUESTS_CA_BUNDLE','CURL_CA_BUNDLE') if os.environ.get(k)),None)
    return ssl.create_default_context(cafile=bundle)


def fetch(url,headers=None,timeout=35,attempts=3,max_bytes=MAX_BYTES):
    request=urllib.request.Request(url,headers={'User-Agent':'LimaRutas-ATU-source-sync/1.0','Accept':'application/json',
        'Accept-Encoding':'identity',**(headers or {})})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request,timeout=timeout,context=ssl_context()) as response:
                if response.status!=200:raise SourceError('HTTP inesperado: '+str(response.status))
                meta={k.lower():v for k,v in response.headers.items()}
                chunks=[];total=0
                while True:
                    block=response.read(1024*1024)
                    if not block:break
                    total+=len(block)
                    if total>max_bytes:raise SourceError('La descarga supera el límite de tamaño')
                    chunks.append(block)
                body=b''.join(chunks)
                if meta.get('content-length') and int(meta['content-length'])!=len(body):
                    raise SourceError('Longitud de respuesta incompleta')
                return 200,meta,body
        except urllib.error.HTTPError as e:
            code=e.code;meta={k.lower():v for k,v in e.headers.items()};e.close()
            if code==304:return 304,meta,b''
            if code not in RETRY_HTTP or attempt+1==attempts:raise SourceError('HTTP '+str(code)) from e
        except (urllib.error.URLError,TimeoutError,socket.timeout,ConnectionError, OSError) as e:
            if attempt+1==attempts:raise SourceError('Descarga fallida: '+type(e).__name__) from e
        time.sleep(min(3,0.3*2**attempt))
    raise SourceError('No se obtuvo una respuesta')


def atomic_bytes(path,raw):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,temp=tempfile.mkstemp(prefix='.atu-write-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as out:
            out.write(raw);out.flush();os.fsync(out.fileno())
        os.replace(temp,path)
    finally:
        Path(temp).unlink(missing_ok=True)


def json_bytes(value):
    return (json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode('utf-8')


def cache_bytes(root,entry):
    if not entry:return None
    path=(root/entry['snapshot']).resolve()
    if not path.is_relative_to(root.resolve()):raise SourceError('Ruta de caché fuera del directorio de estado')
    try:raw=path.read_bytes()
    except FileNotFoundError:return None
    return raw if sha(raw)==entry.get('sha256') and entry.get('validatorVersion')==VERSION else None


def prepare_one(name,url,old,root,timeout,attempts,force):
    raw_old=cache_bytes(root,old)
    headers={}
    if raw_old is not None and old.get('url')==url and not force:
        if old.get('etag'):headers['If-None-Match']=old['etag']
        if old.get('lastModified'):headers['If-Modified-Since']=old['lastModified']
    status,meta,body=fetch(url,headers,timeout,attempts)
    if status==304 and raw_old is None:
        # Recover from an unsolicited 304 or a missing/corrupt cache by making one unconditional request.
        status,meta,body=fetch(url,{},timeout,attempts)
        if status==304:raise SourceError('304 sin una copia local válida')
    if status==304:
        return {'name':name,'status':'not_modified','httpStatus':304,'downloadedBytes':0,'dataChanged':False,
            'cacheRecovered':False,'entry':copy.deepcopy(old),'body':None,'change':None}
    value,info=inspect(name,body)
    previous=json.loads(raw_old) if raw_old is not None else None
    changes=compare(name,previous,value)
    if previous is None and old and old.get('statistics',{}).get('semanticSha256')==info['semanticSha256']:
        changes={'dataChanged':False,'added':[],'removed':[],'geometryChanged':[],'attributesChanged':[],
            'schemaAdded':[],'schemaRemoved':[]}
    body_hash=sha(body)
    identical=old is not None and body_hash==old.get('sha256')
    entry={'url':url,'snapshot':f'snapshots/{name}/{body_hash}.geojson','sha256':body_hash,
        'etag':meta.get('etag'),'lastModified':meta.get('last-modified'),'downloadedAtUtc':old['downloadedAtUtc'] if identical else now(),
        'validatorVersion':VERSION,'bytes':len(body),'statistics':info}
    return {'name':name,'status':'changed' if changes['dataChanged'] else 'same_data','httpStatus':200,
        'downloadedBytes':len(body),'dataChanged':changes['dataChanged'],'cacheRecovered':old is not None and raw_old is None,
        'entry':entry,'body':body,'change':changes}


def sync(state_dir,names=('pmu','prr','sit'),urls=None,timeout=35,attempts=3,workers=3,force=False):
    root=Path(state_dir).resolve();root.mkdir(parents=True,exist_ok=True)
    lock=root/'.sync.lock'
    try:fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
    except FileExistsError:raise SourceError('Hay otra actualización o un bloqueo pendiente de revisar')
    os.close(fd)
    try:
        pointer=root/'current.json';old_raw=pointer.read_bytes() if pointer.exists() else None
        old=json.loads(old_raw) if old_raw else {'version':VERSION,'sources':{}}
        if old.get('version')!=VERSION:raise SourceError('Versión de estado no compatible')
        selected=dict(URLS if urls is None else urls)
        report={'version':VERSION,'checkedAtUtc':now(),'success':False,'candidateStateCommitted':False,
            'dataChanged':False,'sources':[]}
        prepared=[]
        # Independent downloads are parallel; the complete manifest is committed only after every source succeeds.
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,min(workers,len(names)))) as executor:
            futures={name:executor.submit(prepare_one,name,selected[name],old['sources'].get(name),root,timeout,attempts,force) for name in names}
            for name in names:
                try:prepared.append(futures[name].result())
                except Exception as e:report['sources'].append({'name':name,'status':'failed','error':str(e),
                    'currentManifestPreserved':True,'hadPreviousSnapshot':name in old['sources']})
        for item in prepared:
            report['sources'].append({k:v for k,v in item.items() if k not in ('entry','body')})
        report['sources'].sort(key=lambda x:names.index(x['name']))
        if any(s['status']=='failed' for s in report['sources']):return report
        if (pointer.read_bytes() if pointer.exists() else None)!=old_raw:raise SourceError('El estado cambió durante la descarga')
        updated=copy.deepcopy(old)
        for item in prepared:
            destination=root/item['entry']['snapshot']
            if item['body'] is not None:
                if not destination.exists() or sha(destination.read_bytes())!=item['entry']['sha256']:
                    atomic_bytes(destination,item['body'])
            updated['sources'][item['name']]=item['entry']
        new_pointer=json_bytes(updated)
        if old_raw!=new_pointer:atomic_bytes(pointer,new_pointer);report['candidateStateCommitted']=True
        report['success']=True
        report['dataChanged']=any(s.get('dataChanged') for s in report['sources'])
        report['downloadedBytes']=sum(s.get('downloadedBytes',0) for s in report['sources'])
        report['processingRequired']=report['dataChanged']
        return report
    finally:
        lock.unlink(missing_ok=True)


def main():
    if sys.version_info<(3,10):raise SourceError('Se requiere Python 3.10 o posterior')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir',required=True,type=Path)
    parser.add_argument('--sources',nargs='+',choices=URLS,default=list(URLS))
    parser.add_argument('--report',type=Path)
    parser.add_argument('--timeout',type=float,default=35)
    parser.add_argument('--attempts',type=int,default=3)
    parser.add_argument('--workers',type=int,default=3)
    parser.add_argument('--force',action='store_true',help='Download unconditionally for audits')
    parser.add_argument('--verbose',action='store_true',help='Print the full change report')
    args=parser.parse_args()
    if args.timeout<=0 or args.attempts<1 or args.workers<1:raise SourceError('Parámetros de descarga inválidos')
    if len(args.sources)!=len(set(args.sources)):raise SourceError('Fuente repetida')
    print('[runtime] Python '+platform.python_version()+'; dependencias: biblioteca estándar; TLS verificado',file=sys.stderr)
    report=sync(args.state_dir,tuple(args.sources),timeout=args.timeout,attempts=args.attempts,workers=args.workers,force=args.force)
    if args.report:atomic_bytes(args.report,json_bytes(report))
    summary={k:report.get(k) for k in ('success','candidateStateCommitted','dataChanged','downloadedBytes','processingRequired')}
    summary['sources']=[{**{k:s.get(k) for k in ('name','status','httpStatus','downloadedBytes','cacheRecovered')},
        'changeCounts':{k:len(v) for k,v in (s.get('change') or {}).items() if isinstance(v,list)},
        **({'error':s['error']} if 'error' in s else {})} for s in report['sources']]
    print(json.dumps(report if args.verbose else summary,ensure_ascii=False,indent=2))
    return 0 if report['success'] else 1


if __name__=='__main__':
    try:sys.exit(main())
    except (SourceError,OSError,json.JSONDecodeError) as error:
        print('Error ATU: '+str(error),file=sys.stderr);sys.exit(1)
