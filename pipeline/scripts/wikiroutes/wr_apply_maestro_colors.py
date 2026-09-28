"""
Lleva a las capas de Wikiroutes el color de lista_rutas_maestro.csv para las
rutas que hoy tienen el color por defecto (azul metálico o gris).

build_lista_rutas_atu.py ahora da color a rutas del PRR que antes no lo
tenían (el de su código antiguo en Wikipedia). El mapa toma el color de
wr_map.json, y la próxima corrida del pipeline de Wikiroutes, de
wr_overrides.json: se actualizan los dos (y wr_codes_master.csv) sin tocar
los colores que ya eran reales.

Uso:
    python pipeline/scripts/wikiroutes/wr_apply_maestro_colors.py
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MAESTRO = ROOT / 'pipeline' / 'output' / 'lista_rutas_maestro.csv'
WR_MAP = ROOT / 'pipeline' / 'output' / 'wr_map.json'
OVERRIDES = ROOT / 'config' / 'wr_overrides.json'
CODES = ROOT / 'pipeline' / 'output' / 'wr_codes_master.csv'

# Mismos que WR_DEFAULT_COLORS en assets/js/uiSidebar.wrColorFilter.js
DEFAULT = {'#3D6B7A', '#4A7A8A', '#527585', '#5C8FA0', '#4F7F90',
           '#6595A5', '#3A6878', '#608090', '#456878', '#5A8595',
           '#888888', '#00008C'}


def is_default(color):
    return not color or color.strip().upper() in DEFAULT


def main() -> None:
    with open(MAESTRO, encoding='utf-8') as f:
        color = {r['codigo_nuevo'].upper(): r['color_hex'].upper()
                 for r in csv.DictReader(f) if not is_default(r['color_hex'])}

    # wr_map.json: "1320-ida", "1320_69457-vuelta"
    wr_map = json.loads(WR_MAP.read_text(encoding='utf-8'))
    n_map = 0
    for key, layer in wr_map['routes'].items():
        code = key.rsplit('-', 1)[0].split('_')[0].upper()
        if code in color and is_default(layer.get('color')):
            layer['color'] = color[code]
            n_map += 1
    WR_MAP.write_text(json.dumps(wr_map, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    overrides = json.loads(OVERRIDES.read_text(encoding='utf-8'))
    n_ov = 0
    for entry in overrides.values():
        code = str(entry.get('display_id') or '').upper()
        if code in color and 'color' in entry and is_default(entry['color']):
            entry['color'] = color[code]
            n_ov += 1
    OVERRIDES.write_text(json.dumps(overrides, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    with open(CODES, encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        fields, rows = reader.fieldnames, list(reader)
    n_codes = 0
    for r in rows:
        code = (r.get('codigo_final') or '').upper()
        if code in color and is_default(r.get('cand_color_hex')):
            r['cand_color_hex'] = color[code]
            n_codes += 1
    with open(CODES, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)

    print(f'wr_map: {n_map} capas · wr_overrides: {n_ov} entradas · wr_codes_master: {n_codes} filas')


if __name__ == '__main__':
    main()
