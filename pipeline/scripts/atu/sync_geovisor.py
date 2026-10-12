"""Synchronize PMU candidates and promote only a completely validated layer."""
from __future__ import annotations
import argparse
import datetime as dt
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from pipeline.scripts.atu.sources import (VERSION, URLS, SourceError, atomic_bytes, compare, inspect,
    json_bytes, sha, sync, now)
from pipeline.scripts.atu.build_pmu import RAW, OUT, build
STATE=ROOT/'pipeline/temp/atu-sources'
REPORT=ROOT/'pipeline/temp/atu-sync-report.json'


def publish(files):
    """Restore the preceding complete publication if a file replacement fails."""
    previous = {path: path.read_bytes() if path.exists() else None for path in files}
    written = []
    try:
        for path, body in files.items():
            if previous[path] != body:
                written.append(path)
                atomic_bytes(path, body)
    except BaseException as error:
        failures = []
        for path in reversed(written):
            try:
                if previous[path] is None:
                    path.unlink(missing_ok=True)
                else:
                    atomic_bytes(path, previous[path])
            except OSError as restore_error:
                failures.append(str(restore_error))
        if failures:
            failure = SourceError('No se pudo restaurar la publicación local: ' + '; '.join(failures))
            failure.publication_preserved = False
            raise failure from error
        raise


def update(state_dir=STATE, fetch_urls=None, force=False):
    from pipeline.authoring.store import writer_lock
    state_dir = Path(state_dir)
    state_dir.mkdir(parents=True, exist_ok=True)
    with writer_lock(state_dir / '.publication.lock'):
        try:
            return _update(state_dir, fetch_urls, force)
        except (ValueError, OSError) as error:
            report = json.loads(REPORT.read_text()) if REPORT.exists() else {}
            report.update(success=False, processingRequired=False,
                          publicationPreserved=getattr(error, 'publication_preserved', True),
                          error=str(error), checkedAtUtc=now())
            atomic_bytes(REPORT, json_bytes(report))
            raise


def _update(state_dir=STATE, fetch_urls=None, force=False):
    state_dir=Path(state_dir)
    state_dir.mkdir(parents=True,exist_ok=True)
    published=None
    old_manifest=json.loads((RAW/'manifest.json').read_text()) if (RAW/'manifest.json').exists() else {}
    old=old_manifest.get('pmu_sit')
    if old and (RAW/'pmu_sit.geojson').exists():
        raw=(RAW/'pmu_sit.geojson').read_bytes()
        if sha(raw)!=old['sha256']:raise SourceError('Snapshot publicado corrupto')
        published,_=inspect('pmu',raw)
        if not (state_dir/'current.json').exists():
            snapshot=f'snapshots/pmu/{old["sha256"]}.geojson'
            atomic_bytes(state_dir/snapshot,raw)
            atomic_bytes(state_dir/'current.json',json_bytes({'version':VERSION,'sources':{'pmu':{**old,'snapshot':snapshot}}}))
    audit=state_dir/'last-audit.json'
    previous=json.loads(audit.read_text())['at'] if audit.exists() else None
    force=force or not previous or (dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(previous)).days>=30
    report=sync(state_dir,names=('pmu',),urls=fetch_urls,force=force)
    atomic_bytes(REPORT,json_bytes(report))
    if not report['success']:raise SourceError('Falló la descarga ATU; se conserva la publicación anterior')
    if force:atomic_bytes(audit,json_bytes({'at':now()}))
    entry=json.loads((state_dir/'current.json').read_text())['sources']['pmu']
    raw=(state_dir/entry['snapshot']).read_bytes()
    candidate,_=inspect('pmu',raw)
    change=compare('pmu',published,candidate)
    if published and len(candidate['features'])<len(published['features'])*.5:
        raise SourceError('Caída de más del 50 % de features; se conserva la publicación anterior')
    report['processingRequired']=change['dataChanged']
    if change['dataChanged']:
        manifest={k:v for k,v in entry.items() if k!='snapshot'}
        red,catalog,inventory=build(candidate,manifest)
        # All transformations pass before any published file is changed.
        files={RAW/'pmu_sit.geojson':raw, RAW/'manifest.json':json_bytes({'pmu_sit':manifest}),
            OUT/'red.geojson':json_bytes(red), OUT/'catalog.json':json_bytes(catalog),
            ROOT/'docs/atu/pmu_inventory.json':json_bytes(inventory),
            ROOT/'pipeline/output/atu_pmu_diff.json':json_bytes(change)}
        publish(files)
    atomic_bytes(REPORT,json_bytes(report))
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--force',action='store_true')
    args=parser.parse_args()
    try:
        report=update(force=args.force)
        print(json.dumps({k:report.get(k) for k in ('success','downloadedBytes','processingRequired')},ensure_ascii=False))
    except (SourceError,OSError,ValueError) as error:
        print('Error ATU: '+str(error),file=sys.stderr);sys.exit(1)
