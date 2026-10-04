"""
Paraderos oficiales de los Alimentadores del Metropolitano desde la base de
paraderos de la ATU (data/raw/atu/BASE_PARADEROS_ATU.xlsx, hoja "Paraderos":
una fila por paradero y sentido, transcrita de los mapas QR y las páginas del
portal) a config/alim_paraderos.json.

  - Sin el terminal: build_alim_paths.py pone la estación del Metropolitano
    al empezar la ida y al terminar la vuelta.
  - La base a veces lista la vuelta en el orden de la ida: el sentido de
    cada lista lo decide el trazado (build_alim_paths.py), no este script.
  - Los del sur (AS-*) y Trapiche ya estaban, de las capturas del portal; se
    dejan como están. Santo Domingo es histórico: la ATU lo quitó.

Uso (requiere openpyxl):
    python pipeline/scripts/atu/import_base_paraderos.py
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
XLSX = ROOT / 'data' / 'raw' / 'atu' / 'BASE_PARADEROS_ATU.xlsx'
OUT = ROOT / 'config' / 'alim_paraderos.json'
TRAZADOS = ROOT / 'config' / 'alim_trazados.json'

# Servicio de la base → código del mapa
REF = {
    'Tahuantinsuyo': 'AN-01', 'Collique': 'AN-04', 'Payet': 'AN-05', 'Puno': 'AN-06',
    'Belaunde': 'AN-07', 'Milagro de Jesús': 'AN-08', 'Carabayllo': 'AN-09',
    'Puente Piedra': 'AN-12', 'La Ensenada': 'AN-13', 'Bertello': 'AN-14', 'Los Alisos': 'AN-15',
    'Los Olivos': 'AN-16', 'Antúnez de Mayolo': 'AN-17', 'Naranjal': 'AN-18', 'Izaguirre': 'AN-19',
    'San Juan de Dios': 'AN-20', 'Universitaria': 'AN-21', 'Torre Blanca': 'AN-22',
}
KEEP = {'AS-02', 'AS-04', 'AS-07', 'AS-08', 'AN-03'}
TERMINALES = {'naranjal', 'chimpu ocllo', 'universidad', 'los incas', 'izaguirre', 'matellini'}


def norm(s):
    return unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower().strip()


def es_terminal(name):
    """'Terminal Naranjal', 'Estación Universidad', 'Terminal Naranjal (embarque 7)'."""
    n = re.sub(r'\(.*?\)', '', norm(name)).strip()
    m = re.match(r'^(terminal|estacion)\s+(.+)$', n)
    return bool(m and m[2] in TERMINALES)


def main() -> None:
    import openpyxl
    wb = openpyxl.load_workbook(XLSX, read_only=True)
    rows = list(wb['Paraderos'].iter_rows(values_only=True))
    head = rows[0]
    col = {h: i for i, h in enumerate(head)}
    lists = defaultdict(lambda: defaultdict(list))
    calidad = {}
    for r in rows[1:]:
        if r[col['Sistema']] != 'Metropolitano alimentador' or r[col['Servicio']] not in REF:
            continue
        if r[col['Estado sentido']] != 'OPERA':
            continue
        ref = REF[r[col['Servicio']]]
        lists[ref][r[col['Sentido']].lower()].append((r[col['Orden']], r[col['Paradero']]))
        calidad[ref] = r[col['Calidad']]

    out = json.loads(OUT.read_text(encoding='utf-8'))
    traz = json.loads(TRAZADOS.read_text(encoding='utf-8'))
    for ref in sorted(lists):
        if ref in KEEP:
            continue
        entry = {'nombre': (traz.get(ref) or {}).get('nombre') or next(k for k, v in REF.items() if v == ref)}
        for key in ('ida', 'vuelta'):
            names = [n.strip() for _, n in sorted(lists[ref][key]) if n and n.strip()]
            names = [n for n in names if not es_terminal(n)]
            entry[key] = names
        entry['fuente'] = f'base de paraderos ATU (calidad {calidad[ref]})'
        out[ref] = entry
    out['_fuente'] = (
        'Paraderos en orden por sentido, sin contar el terminal. AS-* y AN-03: capturas del portal de la ATU '
        '(2026-09-28/29). El resto: base de paraderos de la ATU (data/raw/atu/BASE_PARADEROS_ATU.xlsx, '
        'pipeline/scripts/atu/import_base_paraderos.py). build_alim_paths.py los ubica sobre el trazado por '
        'nombre (paradero de Wikiroutes) y, si no, entre sus vecinos; la base a veces lista la vuelta en el '
        'orden de la ida y el sentido lo decide el trazado.')
    keys = ['_fuente'] + sorted(k for k in out if not k.startswith('_'))
    OUT.write_text(json.dumps({k: out[k] for k in keys}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for ref in keys[1:]:
        print(f"{ref}: ida {len(out[ref]['ida'])} · vuelta {len(out[ref]['vuelta'])}")


if __name__ == '__main__':
    main()
