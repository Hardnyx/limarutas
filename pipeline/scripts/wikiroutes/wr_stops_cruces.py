"""
Agrega a pipeline/output/wr_stops_index.json el cruce de cada paradero
(pipeline/scripts/cruces.py) como séptimo campo: cómo se muestra en el
buscador ('Universitaria con Colonial') o null. El buscador lo usa para distinguir paraderos con el mismo nombre
("Universitaria con Colonial"); el nombre del paradero no cambia.

Correr después de wr_build_stops_index.py:
    python pipeline/scripts/wikiroutes/wr_stops_cruces.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'pipeline' / 'scripts'))
from cruces import Cruces, label  # noqa: E402

INDEX = ROOT / 'pipeline' / 'output' / 'wr_stops_index.json'


def main() -> None:
    idx = json.loads(INDEX.read_text(encoding='utf-8'))
    cruces = Cruces()
    n = t = 0
    for s in idx['stops']:
        while len(s) < 6:
            s.append('')
        c = cruces.of(s[0], s[1], s[2]) if s[1] is not None else None
        s[6:] = [label(s[0], c)]
        n += bool(c)
        t += bool(c and c[1])
    INDEX.write_text(json.dumps(idx, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{n} de {len(idx["stops"])} paraderos con cruce ({t} tréboles) · {INDEX.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
