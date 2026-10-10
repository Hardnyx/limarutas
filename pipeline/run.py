"""One entry point for inspection, validation and explicitly requested builds."""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pipeline.stages import STAGES, stage_order  # noqa: E402
from pipeline.validation import validate_site  # noqa: E402


def provenance(root, counts):
    files = [*root.glob('config/*.json'), *root.glob('pipeline/output/*.json'),
             *root.glob('pipeline/output/*.csv'), *root.glob('data/processed/metropolitano/*.json'),
             *root.glob('data/processed/**/*.geojson'), *root.glob('data/processed/caminata/**/*.json'),
             *root.glob('pipeline/scripts/**/*.py'), *root.glob('assets/js/*.js'), *root.glob('assets/css/*.css')]
    files = set(files)
    records = {}
    for path in sorted(files):
        records[path.relative_to(root).as_posix()] = {
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size}
    # This is an inventory of the checked checkout, not a claimed source acquisition date.
    return {'version': 1, 'kind': 'validated-checkout-inventory', 'counts': counts, 'files': records,
            'rawOsmAvailable': (root / 'data/raw/osm/Lima.osm.pbf').is_file()}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    validate = commands.add_parser('validate', help='Check static data without downloading or rebuilding')
    validate.add_argument('--manifest', type=Path, help='Write checksums and counts to this file')
    commands.add_parser('list', help='Show stages and dependencies')
    build = commands.add_parser('build', help='Run one stage using existing inputs')
    build.add_argument('--stage', choices=STAGES, required=True)
    build.add_argument('--with-dependencies', action='store_true')
    build.add_argument('--dry-run', action='store_true')
    args = parser.parse_args(argv)
    if args.command == 'list':
        for name, stage in STAGES.items():
            print(f'{name}: dependencies={",".join(stage.dependencies) or "none"}; {stage.script}')
        return
    if args.command == 'build':
        order = stage_order(args.stage, args.with_dependencies)
        missing = {path for name in order for path in STAGES[name].inputs if not (ROOT / path).exists()}
        if 'stops' in order:
            wr = json.loads((ROOT / 'pipeline/output/wr_map.json').read_text(encoding='utf-8'))
            folders = {entry['folder'] for entry in wr['routes'].values()}
            html_complete = all((ROOT / folder / 'route.html').is_file() for folder in folders)
            history = subprocess.run(['git', 'cat-file', '-e', '1c1e782e^'], cwd=ROOT, capture_output=True)
            if not html_complete and history.returncode:
                missing.add('Wikiroutes route.html sources or full git history (1c1e782e^)')
        for name in order:
            print(f'{name}: {sys.executable} pipeline/scripts/{STAGES[name].script}', flush=True)
        if missing:
            print('Missing prerequisites:\n' + '\n'.join(f'  {p}' for p in sorted(missing)), flush=True)
            if not args.dry_run:
                raise ValueError('Build stopped before changing data; restore the required sources first')
        if args.dry_run:
            return
        for name in order:
            subprocess.run([sys.executable, str(ROOT / 'pipeline/scripts' / STAGES[name].script)], cwd=ROOT, check=True)
    counts = validate_site(ROOT)
    print(json.dumps(counts, ensure_ascii=False, indent=2))
    if args.command == 'validate' and args.manifest:
        args.manifest.parent.mkdir(parents=True, exist_ok=True)
        args.manifest.write_text(json.dumps(provenance(ROOT, counts), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        print(f'Pipeline error: {error}', file=sys.stderr)
        sys.exit(1)
