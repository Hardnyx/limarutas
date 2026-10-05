"""
Descarga el extracto de OpenStreetMap de Lima y Callao (BBBike, se actualiza
cada semana) a data/raw/osm/Lima.osm.pbf y verifica su checksum. El archivo
(~30 MB) no se versiona (.gitignore): los scripts que lo usan lo leen de ahí.

Cobertura: lon -77,26 a -76,56, lat -12,42 a -11,70 (de Ancón a Lurín).
Datos © colaboradores de OpenStreetMap, licencia ODbL.

Uso:
    python pipeline/scripts/osm/descargar_lima.py
"""

from __future__ import annotations

import hashlib
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'data' / 'raw' / 'osm' / 'Lima.osm.pbf'
BASE = 'https://download.bbbike.org/osm/bbbike/Lima/'


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'limarutas/1.0'})
    with urllib.request.urlopen(req, timeout=600) as r:
        return r.read()


def main() -> None:
    sums = get(BASE + 'CHECKSUM.txt').decode()
    want = next(line.split()[0] for line in sums.splitlines() if line.endswith('Lima.osm.pbf'))
    data = get(BASE + 'Lima.osm.pbf')
    got = hashlib.md5(data).hexdigest()
    if got != want:
        raise SystemExit(f'Checksum distinto ({got} ≠ {want}): vuelve a intentar')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(data)
    print(f'{OUT.relative_to(ROOT)}: {len(data) / 1e6:.1f} MB, md5 {got}')


if __name__ == '__main__':
    main()
