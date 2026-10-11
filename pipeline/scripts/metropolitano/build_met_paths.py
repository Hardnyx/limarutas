"""Genera ambos sentidos de A/B y recorta todos los servicios de sus macrorrutas."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from pipeline.authoring.macros import build, verify_slices
from pipeline.authoring.network import Network


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--network', default='pipeline/temp/authoring/network.json')
    parser.add_argument('--output', default='pipeline/temp/authoring/met-macros',
                        help='Carpeta de preparación; revisa el resultado antes de publicarlo')
    args = parser.parse_args()
    network = Network(json.loads(Path(args.network).read_text()))
    backbones, paths = build(ROOT, network)
    services = json.loads((ROOT/'data/processed/metropolitano/metropolitano_services.json').read_text())['services']
    verify_slices(backbones, paths, services)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    for name, document in [('metropolitano_backbones.json', backbones), ('metropolitano_paths.json', paths)]:
        (output/name).write_text(json.dumps(document, ensure_ascii=False, separators=(',', ':'))+'\n')
    print(f"{len(paths['paths'])} sentidos verificados: recortes continuos de A/B, sin enlaces entre paraderos")


if __name__ == '__main__':
    main()
