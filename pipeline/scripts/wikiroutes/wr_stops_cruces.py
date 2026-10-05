"""
Agrega a pipeline/output/wr_stops_index.json el cruce de cada paradero
(pipeline/scripts/cruces.py) en los campos 7 a 9: cómo se muestra en el
buscador ('Universitaria con Colonial'), el mismo cruce empezando por la otra
calle ('Colonial con Universitaria', para quien busca esa) y otros nombres
con que se busca ('Trébol de Javier Prado', 'Óscar R. Benavides'), o null.
El nombre del paradero no cambia.

Correr después de wr_build_stops_index.py:
    python pipeline/scripts/wikiroutes/wr_stops_cruces.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'pipeline' / 'scripts'))
from cruces import Cruces, label, search_alias, swapped  # noqa: E402

INDEX = ROOT / 'pipeline' / 'output' / 'wr_stops_index.json'


def main() -> None:
    idx = json.loads(INDEX.read_text(encoding='utf-8'))
    cruces = Cruces()
    n = t = b = 0
    for s in idx['stops']:
        while len(s) < 6:
            s.append('')
        c = cruces.of(s[0], s[1], s[2]) if s[1] is not None else None
        extra = [label(s[0], c), swapped(s[0], c), search_alias(c)]
        while extra and extra[-1] is None:
            extra.pop()
        s[6:] = extra or [None]
        n += bool(c and c['cruce'])
        t += bool(c and c['tipo'] == 'trebol')
        b += bool(c and c['tipo'] == 'bypass')
    INDEX.write_text(json.dumps(idx, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{n} de {len(idx["stops"])} paraderos con cruce ({t} en tréboles, {b} en bypasses) · {INDEX.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
