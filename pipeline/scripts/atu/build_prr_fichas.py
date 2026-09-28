"""
Genera pipeline/output/prr_fichas.json: el Plan Regulador de Rutas (RPE
099-2025-ATU/PE) ruta por ruta.

Fuentes:
  docs/3_099-2025-ATU_PE_ANEXO.pdf
      Anexo del PRR. Sección 14 «Cuadro de equivalencia de código de ruta»:
      código actual (antiguo) → código PRR y empresa. Es la equivalencia
      oficial.
  docs/paraderos_ATU/Plan actualizador de rutas/RUTA_<antiguo>_<nuevo>.pdf
      Fichas técnicas (sección 13, carpeta de SharePoint de la ATU
      «Actualización del Plan Regulador de Rutas»; no se versionan, 36 MB).
      El código PRR se lee de la ficha misma («RUTA 1001»): varios archivos
      vienen mal nombrados (RUTA_IM55_128, RUTA_IO57B_IM44, RUTA IO07_1294,
      RUTA_1604-1015…).

Una ficha trae distritos de origen y destino, itinerario de ida y de vuelta
(calles en orden), longitud por sentido, flota, intervalo de paso,
carrocería y puntos inicial y final.

Cuando la ficha y la sección 14 no coinciden (la ficha de la ruta 2305 dice
«RUTA 1188», la sección 14 le da el 1469) manda la sección 14, y la
diferencia queda en "notas".

Formato:
{
  "fuente": "...",
  "rutas": {
    "1001": {"codigo_antiguo": "1117", "empresa": "…",
             "distrito_origen": "Surco", "distrito_destino": "San Isidro",
             "ida": ["AVENIDA CENTRAL", ...], "vuelta": [...],
             "km_ida": 11.29, "km_vuelta": 10.93,
             "flota": {"operativa": 42, "reserva": 5, "total": 47},
             "intervalo_min": 2, "categoria": "TIPO I ELECTRICAS",
             "punto_inicial": "…", "punto_final": "…",
             "archivo": "RUTA_1117_1001.pdf", "notas": []}
  }
}

Uso:
    python pipeline/scripts/atu/build_prr_fichas.py [carpeta_de_fichas]
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parents[3]
ANEXO = ROOT / 'docs' / '3_099-2025-ATU_PE_ANEXO.pdf'
FICHAS = ROOT / 'docs' / 'paraderos_ATU' / 'Plan actualizador de rutas'
OUT = ROOT / 'pipeline' / 'output' / 'prr_fichas.json'

LINE_TOL = 2.5      # palabras a menos de esto en vertical: misma línea
WORD_GAP = 8        # un hueco mayor entre palabras separa ida de vuelta


def equivalencias():
    """Sección 14 del anexo: {nuevo: (antiguo, empresa)}."""
    out = {}
    with pdfplumber.open(ANEXO) as pdf:
        text = '\n'.join(p.extract_text() or '' for p in pdf.pages[86:96])
    text = text.split('CUADRO DE EQUIVALENCIA', 1)[1]
    for m in re.finditer(r'^\s*\d+\s+(\S+)\s+(1\d{3})\b[ \t]*(.*)$', text, re.M):
        out[m.group(2)] = (m.group(1), m.group(3).strip())
    return out


def lines_of(words):
    """Agrupa palabras en líneas por su altura."""
    rows = []
    for w in sorted(words, key=lambda w: (w['top'], w['x0'])):
        if rows and abs(rows[-1][0] - w['top']) <= LINE_TOL:
            rows[-1][1].append(w)
        else:
            rows.append([w['top'], [w]])
    return [sorted(ws, key=lambda w: w['x0']) for _, ws in rows]


# Primera palabra de una calle nueva (con las erratas de las fichas:
# AVENDIA, JRIRON, CARRTERA, ROTONTA, INTECAMBIO…). Una línea que empieza
# con otra cosa es la continuación de la anterior («AVENIDA ALFREDO» /
# «BENAVIDES»), igual que las acotaciones («(ALT. JR. BUEN PASTOR)»,
# «VUELTA EN U …») y la que cierra un paréntesis abierto («(GIRO EN U ALT.» /
# «PASAJE 25)»).
STREET = re.compile(
    r'^(AV|A?ACC|ACES|[OÓ]V|JI|JR|CA(LL|LE|\.|$)|CALLEJ|PU|CARR|PL|PZ|PAZA|V[IÍ]?A$|INT|AU|PRO|ANTIG|'
    r'PAS|BY|MAL|PARQ|ROT|ALAM|T[UÚ]N|QUEB|PANAM|BAJ|SUB|CAM|ENTR|RAMP|CIRC|TRAV)', re.I)
NOTE = re.compile(r'^(\(|VUELTA EN|ALTURA|GIRO)', re.I)
TAIL = re.compile(r'CARROCER|CATEGOR|FLOTA|^:|^TIPO DE|^(MICRO|MINI|OMNI)BUS', re.I)


def append_item(items, text):
    """Agrega la calle de una línea del itinerario a items."""
    text = ' '.join(text.split())
    if not text:
        return
    word = text.split()[0]
    unclosed = items and items[-1].count('(') > items[-1].count(')')
    if items and ((unclosed and ')' in text) or NOTE.match(text) or not STREET.match(word)):
        items[-1] += ' ' + text
    else:
        items.append(text)


def itinerario(pdf):
    ida, vuelta = [], []
    split = None
    done = False
    for page in pdf.pages:
        for ws in lines_of(page.extract_words(keep_blank_chars=False)):
            text = ' '.join(w['text'] for w in ws)
            if split is None:
                if re.search(r'ITIN.*VUELTA', text, re.I):
                    # Entre «… IDA» y «ITINERARIO VUELTA» (a veces
                    # «ITINERARIOVUELTA» o «IDA» pegado)
                    v = next(i for i, w in enumerate(ws) if 'VUELTA' in w['text'].upper())
                    start = ws[v - 1]['x0'] if v and 'TIN' in ws[v - 1]['text'].upper() else ws[v]['x0']
                    ida_end = max(w['x1'] for w in ws[:v] if w['x0'] < start) if v else start
                    split = (ida_end + start) / 2
                continue
            if TAIL.search(text):
                done = True
                break
            left, right = [], []
            for i, w in enumerate(ws):
                gap = w['x0'] - ws[i - 1]['x1'] if i else math.inf
                if right or (w['x0'] >= split - 30 and gap > WORD_GAP):
                    right.append(w)
                else:
                    left.append(w)
            append_item(ida, ' '.join(w['text'] for w in left))
            append_item(vuelta, ' '.join(w['text'] for w in right))
        if done:
            break
    return ida, vuelta


def num(s):
    return float(s.replace(',', '.')) if s else None


def ficha(path):
    with pdfplumber.open(path) as pdf:
        text = '\n'.join(p.extract_text() or '' for p in pdf.pages)
        ida, vuelta = itinerario(pdf)
    flat = ' '.join(text.split()).upper()
    get = lambda pat: (m.group(1).strip() if (m := re.search(pat, flat)) else '')
    codigo = get(r'RUTA\s+(\d{4})\b')
    flota = re.search(r'OPERATIVA\s+RESERVA\s+TOTAL.*?(\d+)\s+(\d+)\s+(\d+)', flat)
    if not flota:
        flota = re.search(r'(\d+)\s+(\d+)\s+(\d+)\s*:?\s*IDA\s*:', flat)
    return {
        'codigo': codigo,
        'distrito_origen': get(r'DISTRITO DE ORIGEN\s*:\s*(.+?)\s+DISTRITO DE DESTINO').title(),
        'distrito_destino': get(r'DISTRITO DE DESTINO\s*:\s*(.+?)\s+I*TIN').title(),
        'ida': ida,
        'vuelta': vuelta,
        'km_ida': num(get(r'IDA\s*:\s*([\d.,]+)\s*KM')),
        'km_vuelta': num(get(r'VUELTA\s*:\s*([\d.,]+)\s*KM')),
        'flota': ({'operativa': int(flota.group(1)), 'reserva': int(flota.group(2)),
                   'total': int(flota.group(3))} if flota else None),
        'intervalo_min': num(get(r'INTERVALO DE PASO\s*:\s*([\d.,]+)\s*MIN')),
        'categoria': get(r'CATEGORIA\s*:\s*(.+?)\s*(?::\s*FLOTA|FLOTA)'),
        'punto_inicial': get(r'PUNTO INICIAL\s*:\s*(.+?)\s+PUNTO FINAL'),
        'punto_final': get(r'PUNTO FINAL\s*:\s*(.+?)\s+ZONA DE'),
    }


def main() -> None:
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else FICHAS
    eq = equivalencias()
    print(f'Sección 14: {len(eq)} rutas')
    rutas = {}
    for path in sorted(folder.glob('*.pdf')):
        f = ficha(path)
        notas = []
        name = re.match(r'RUTA[ _]([^_\-]+)[_\-](\w+?)(?:_VF)?\.pdf$', path.name, re.I)
        codigo = f.pop('codigo')
        if codigo not in eq:
            # La ficha trae un código que la sección 14 no tiene: se busca
            # por el código antiguo del nombre del archivo
            antiguo = name.group(1) if name else ''
            by_old = [n for n, (o, _) in eq.items() if o == antiguo]
            if len(by_old) == 1:
                notas.append(f'La ficha dice «RUTA {codigo}»; en la sección 14, '
                             f'{antiguo} es la {by_old[0]}')
                codigo = by_old[0]
            else:
                print(f'  ! {path.name}: RUTA {codigo} no está en la sección 14')
                continue
        if name and (name.group(1), name.group(2)) != (eq[codigo][0], codigo):
            notas.append(f'Archivo mal nombrado: {path.name}')
        antiguo, empresa = eq[codigo]
        if codigo in rutas:
            print(f'  ! {codigo} repetida: {path.name} y {rutas[codigo]["archivo"]}')
        rutas[codigo] = {'codigo_antiguo': antiguo, 'empresa': empresa, **f,
                         'archivo': path.name, 'notas': notas}

    faltan = sorted(set(eq) - set(rutas))
    for c in faltan:
        rutas[c] = {'codigo_antiguo': eq[c][0], 'empresa': eq[c][1], 'archivo': None,
                    'notas': ['Sin ficha técnica en la carpeta de la ATU']}
    rutas = dict(sorted(rutas.items()))
    OUT.write_text(json.dumps({
        'fuente': 'RPE 099-2025-ATU/PE, anexo: sección 13 (fichas técnicas) y 14 '
                  '(cuadro de equivalencia de código de ruta)',
        'rutas': rutas,
    }, ensure_ascii=False, indent=1), encoding='utf-8')

    con = [r for r in rutas.values() if r.get('archivo')]
    print(f'Fichas: {len(con)} · sin ficha: {len(faltan)} {faltan}')
    print(f'Sin itinerario: {[c for c, r in rutas.items() if r.get("archivo") and not (r["ida"] and r["vuelta"])]}')
    print(f'Sin km: {[c for c, r in rutas.items() if r.get("archivo") and not r["km_ida"]]}')
    print(f'Sin intervalo: {[c for c, r in rutas.items() if r.get("archivo") and not r["intervalo_min"]]}')
    print(f'Sin flota: {[c for c, r in rutas.items() if r.get("archivo") and not r["flota"]]}')
    for c, r in rutas.items():
        for n in r['notas']:
            print(f'  {c}: {n}')
    print(f'Escrito: {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
