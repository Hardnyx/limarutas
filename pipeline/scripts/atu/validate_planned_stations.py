"""Check both the planning contract and reproducibility of all derived files."""
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[3]))
from pipeline.scripts.atu.build_planned_stations import ROOT, CONFIG, LOCATIONS, OUT, build
from pipeline.scripts.atu.sources import sha


def check(root=ROOT):
    root=__import__('pathlib').Path(root)
    config=json.loads((root/CONFIG.relative_to(ROOT)).read_text())
    for source in config['sources'].values():
        raw=(root/source['extract']).read_bytes()
        if sha(raw)!=source['extract_sha256'] or json.loads(raw)['source_sha256']!=source['sha256']:
            raise ValueError('Extracto documental alterado')
    catalog, files=build(config,
                         json.loads((root/LOCATIONS.relative_to(ROOT)).read_text()),
                         json.loads((root/OUT.relative_to(ROOT)/'red.geojson').read_text()),
                         json.loads((root/'data/processed/metro/metro.json').read_text()),
                         json.loads((root/'data/processed/metropolitano/metropolitano_stops.json').read_text()))
    for path, body in files.items():
        if (root/path.relative_to(ROOT)).read_bytes()!=body: raise ValueError('Derivado de estaciones desactualizado: '+str(path))
    graph=json.loads((root/'pipeline/output/trip_graph.json').read_text())
    if any(k.startswith(('planificado:','pmu:')) for k in graph['routes']): raise ValueError('Proyectos en grafo operativo')
    return catalog


if __name__=='__main__':
    result=check()
    print(f'{len(result["records"])} entradas documentadas, aisladas de Cómo llegar')
