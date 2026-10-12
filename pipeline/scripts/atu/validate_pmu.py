"""Validate the official PMU snapshot and its independent display layer."""
import hashlib
import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from pipeline.scripts.atu.build_pmu import RAW,OUT,validate


def main():
    raw=(RAW/'pmu_sit.geojson').read_bytes()
    source=json.loads(raw)
    manifest=json.loads((RAW/'manifest.json').read_text())['pmu_sit']
    if hashlib.sha256(raw).hexdigest()!=manifest['sha256']:raise ValueError('Hash ATU incorrecto')
    validate(json.loads((OUT/'red.geojson').read_text()),source,manifest)
    graph=json.loads((ROOT/'pipeline/output/trip_graph.json').read_text())
    if any(k.startswith('pmu:') for k in graph['routes']):raise ValueError('Proyecto en el grafo operativo')
    for filename in ['wr_map.json','wr_stops_index.json']:
        value=json.loads((ROOT/'pipeline/output'/filename).read_text())
        if 'pmu:' in json.dumps(value):raise ValueError('Proyecto en un índice operativo')
    print('PMU validado; geometrías oficiales conservadas; proyectos excluidos del planificador')

if __name__=='__main__':main()
