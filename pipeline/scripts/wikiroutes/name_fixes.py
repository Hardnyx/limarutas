"""
Correcciones de nombres de paraderos (config/stop_name_fixes.json): typos de
Wikiroutes como "Canaval y Moreira" → "Canaval y Moreyra". Cada corrección
reemplaza una palabra completa, sin distinguir mayúsculas.

    from name_fixes import fix_stop_name
    fix_stop_name('Canaval y Moreira')   # 'Canaval y Moreyra'
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FIXES_PATH = ROOT / 'config' / 'stop_name_fixes.json'


@lru_cache(maxsize=1)
def _rules() -> list[tuple[re.Pattern, str]]:
    if not FIXES_PATH.is_file():
        return []
    fixes = json.loads(FIXES_PATH.read_text(encoding='utf-8')).get('fixes', [])
    return [(re.compile(rf'\b{re.escape(f["from"])}\b', re.IGNORECASE), f['to']) for f in fixes]


def fix_stop_name(name: str) -> str:
    for pattern, to in _rules():
        name = pattern.sub(to, name)
    return name
