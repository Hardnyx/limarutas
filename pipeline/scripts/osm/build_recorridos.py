"""
Recorridos de las rutas de Wikiroutes por la red de calles de OSM
(recorrido.py). Cada ruta es la secuencia de vías de OSM por la que pasa:

  route_track_trip<N>.vias.json   el recorrido (ids de vías y nodos de OSM):
                                  la fuente; sale de pegar el dibujo
                                  (route_track_trip<N>.geojson) a la red una
                                  vez, y se vuelve a pegar solo si OSM cambió
                                  y ya no calza, o con --rehacer
  config/recorridos_correcciones.json
                                  pasos corregidos a mano ("después de Av.
                                  Brasil va por Av. Z hasta Av. Arica")
  route_track_trip<N>.osm.geojson lo que carga el mapa: la línea (los nodos
                                  del recorrido corregido) y sus pasos

Se usa el recorrido solo si se parece al dibujo (largo entre MIN_RATIO y
MAX_RATIO del original y a lo más MAX_GAP del largo sin calle; con
correcciones, solo lo segundo); si no, la ruta sigue con su dibujo y queda en
el reporte para revisarla. pipeline/output/wr_map.json marca con "osm": true
las que lo usan (el mapa carga ese archivo en vez del dibujo).

    python pipeline/scripts/osm/build_recorridos.py              # todas, desde sus vías
    python pipeline/scripts/osm/build_recorridos.py 1087-ida     # algunas
    python pipeline/scripts/osm/build_recorridos.py --rehacer [rutas]  # volver a pegar el dibujo
    python pipeline/scripts/osm/build_recorridos.py --marcar     # tras regenerar wr_map.json
"""

from __future__ import annotations

import json
import math
import multiprocessing as mp
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from recorrido import CorreccionError, Recorridos  # noqa: E402

WR_MAP = ROOT / 'pipeline' / 'output' / 'wr_map.json'
REPORT = ROOT / 'pipeline' / 'output' / 'recorridos_reporte.json'
CORR = ROOT / 'config' / 'recorridos_correcciones.json'
REVIEW = ROOT / 'pipeline' / 'output' / 'recorridos_revision.md'
LIMA = (-12.42, -77.26, -11.70, -76.56)

MIN_RATIO, MAX_RATIO = 0.85, 1.15
MAX_GAP = 0.30        # del largo dentro de Lima
MIN_STREET_M = 500    # por calles de la red, al menos (si no, casi todo es dibujo)

M_LAT = 110_574
M_LON = 111_320 * math.cos(math.radians(-12.05))

R = None          # la red, compartida por los procesos (fork)
REHACER = False
CORRECCIONES = {}  # ruta → [corrección, …]


def length(c):
    return sum(math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * M_LON) for a, b in zip(c, c[1:]))


def track_of(path):
    """Puntos [lat, lon] del dibujo (LineString o MultiLineString encadenado)."""
    fc = json.loads(path.read_text(encoding='utf-8'))
    line = []
    for ft in fc.get('features', []):
        g = ft.get('geometry') or {}
        parts = [g['coordinates']] if g.get('type') == 'LineString' else g.get('coordinates', [])
        for part in parts:
            line += [(y, x) for x, y, *_ in part]
    return line


def load_corrections():
    """{ruta: [corrección, …]} de config/recorridos_correcciones.json (las
    de Wikiroutes; las de los alimentadores las usa build_alim_paths.py)."""
    if not CORR.exists():
        return {}
    out = {}
    for c in json.loads(CORR.read_text(encoding='utf-8')).get('rutas', []):
        out.setdefault(c['ruta'], []).append(c)
    return out


def apply_corrections(rec, corrs):
    """El recorrido con sus correcciones, en orden; y los errores (una
    corrección que ya no calza se salta y se avisa)."""
    errors = []
    for c in corrs:
        try:
            rec = R.corregir(rec, c)
        except CorreccionError as e:
            errors.append(f"{c.get('nota') or c}: {e}")
    return rec, errors


def work(item):
    key, folder, trip = item
    src = ROOT / folder / f'route_track_trip{trip}.geojson'
    dst = ROOT / folder / f'route_track_trip{trip}.osm.geojson'
    vias = ROOT / folder / f'route_track_trip{trip}.vias.json'
    if not src.exists():
        return key, {'error': 'sin dibujo'}
    line = track_of(src)
    if len(line) < 2:
        return key, {'error': 'dibujo vacío'}
    rec, origen = None, 'vias'
    if vias.exists() and not REHACER:
        rec = R.decode(json.loads(vias.read_text(encoding='utf-8')), line)
        origen = 'vias' if rec else 'osm cambió'
    if rec is None:
        rec = R.limpiar(R.match(line, ends=True))
        vias.write_text(json.dumps(R.encode(rec), separators=(',', ':')), encoding='utf-8')
        origen = 'dibujo' if origen == 'vias' else origen
    corrs = CORRECCIONES.get(key, [])
    rec, errors = apply_corrections(rec, corrs)
    geom = R.geometry(rec)
    lo, ln = length(line), length(geom)
    gap = sum(length(s) for s in rec['sueltos'])
    # Fuera de la red de Lima (antes del primer tramo y después del último): el dibujo
    out = [round(length(rec.get(k, []))) for k in ('antes', 'despues')]
    on_street = ln - gap - sum(out)
    stats = {'m': round(lo), 'm_osm': round(ln), 'ratio': round(ln / lo, 3) if lo else 0,
             'sin_calle': len(rec['sueltos']), 'm_sin_calle': round(gap), 'origen': origen}
    if any(out):
        stats['m_fuera'] = out
    steps = R.steps(rec, idx=True)
    review = R.revisar(rec, steps)
    if review:
        stats['revisar'] = review
    if corrs:
        stats['correcciones'] = len(corrs) - len(errors)
    if errors:
        stats['errores'] = errors
    # Corregida a mano: el largo puede cambiar respecto del dibujo
    ok = (lo > 0 and (bool(corrs) or MIN_RATIO <= ln / lo <= MAX_RATIO)
          and gap <= MAX_GAP * (lo - sum(out)) and on_street >= MIN_STREET_M)
    stats['usa'] = ok
    if ok:
        fc = {'type': 'FeatureCollection', 'features': [{
            'type': 'Feature',
            'properties': {'fuente': f'OpenStreetMap {R.red.fecha} (recorrido.py)',
                           'pasos': [{k: v for k, v in st.items() if not k.startswith('_')} for st in steps],
                           'sin_calle': len(rec['sueltos']),
                           **({'fuera': out} if any(out) else {})},
            'geometry': {'type': 'LineString', 'coordinates': [[lon, lat] for lat, lon in geom]}}]}
        text = json.dumps(fc, ensure_ascii=False, separators=(',', ':'))
        if not dst.exists() or dst.read_text(encoding='utf-8') != text:
            dst.write_text(text, encoding='utf-8')
    elif dst.exists():
        dst.unlink()
    return key, stats


def mark_only():
    """Vuelve a marcar en wr_map.json las rutas con recorrido (tras regenerar
    wr_map con los scripts de Wikiroutes), sin recalcular nada."""
    wr = json.loads(WR_MAP.read_text(encoding='utf-8'))
    report = json.loads(REPORT.read_text(encoding='utf-8'))
    n = 0
    for key, conf in wr['routes'].items():
        f = ROOT / conf['folder'] / f"route_track_trip{conf.get('trip', 1)}.osm.geojson"
        if report.get(key, {}).get('usa') and f.exists():
            conf['osm'] = True
            n += 1
        else:
            conf.pop('osm', None)
    WR_MAP.write_text(json.dumps(wr, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{n} rutas marcadas con recorrido en {WR_MAP.relative_to(ROOT)}')


def main(argv):
    global R, REHACER, CORRECCIONES
    if argv[:1] == ['--marcar']:
        return mark_only()
    if argv[:1] == ['--rehacer']:
        REHACER, argv = True, argv[1:]
    CORRECCIONES = load_corrections()
    wr = json.loads(WR_MAP.read_text(encoding='utf-8'))
    routes = wr['routes']
    keys = argv or sorted(routes)
    items = [(k, routes[k]['folder'], routes[k].get('trip', 1)) for k in keys if k in routes]
    t = time.time()
    R = Recorridos(LIMA)
    print(f'Red de Lima: {len(R.edges)} tramos · {time.time() - t:.0f} s', flush=True)
    t = time.time()
    report = json.loads(REPORT.read_text(encoding='utf-8')) if REPORT.exists() and argv else {}
    with mp.get_context('fork').Pool(4) as pool:
        for n, (key, stats) in enumerate(pool.imap_unordered(work, items, chunksize=8), 1):
            report[key] = stats
            if stats.get('usa'):
                routes[key]['osm'] = True
            else:
                routes[key].pop('osm', None)
            if n % 200 == 0:
                print(f'  {n}/{len(items)} · {time.time() - t:.0f} s', flush=True)
    WR_MAP.write_text(json.dumps(wr, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    REPORT.write_text(json.dumps(dict(sorted(report.items())), ensure_ascii=False, indent=0), encoding='utf-8')
    used = sum(1 for s in report.values() if s.get('usa'))
    print(f'{used} de {len(report)} trazados por la red de OSM · {time.time() - t:.0f} s · '
          f'{REPORT.relative_to(ROOT)}')
    redo = [k for k in keys if report.get(k, {}).get('origen') in ('dibujo', 'osm cambió')]
    if redo:
        changed = [k for k in redo if report[k]['origen'] == 'osm cambió']
        print(f'  {len(redo)} pegadas desde el dibujo'
              + (f" ({len(changed)} porque OSM cambió: {', '.join(changed[:20])}{'…' if len(changed) > 20 else ''})"
                 if changed else ''))
    for key in [k for k in keys if report.get(k, {}).get('errores')]:
        for e in report[key]['errores']:
            print(f'  {key}: corrección que no calza: {e}')
    unknown = sorted(set(CORRECCIONES) - set(routes))
    if unknown:
        print(f"  correcciones de rutas que no existen: {', '.join(unknown)}")
    counts = Counter(x['tipo'] for k, v in report.items() if v.get('usa') for x in v.get('revisar', []))
    if counts:
        print('  para revisar: ' + ' · '.join(f'{n} {TIPOS[t]}' for t, n in counts.most_common())
              + f' · {REVIEW.relative_to(ROOT)}')
    write_review(report, routes)


TIPOS = {'contra_sentido': 'contra el sentido', 'vuelta_u': 'vueltas en U',
         'rotonda': 'salidas raras de un óvalo', 'sin_calle': 'pedazos sin calle'}


def osm_link(x):
    return f"https://www.openstreetmap.org/?mlat={x['lat']}&mlon={x['lon']}#map=18/{x['lat']}/{x['lon']}"


def write_review(report, routes):
    """pipeline/output/recorridos_revision.md: lo que conviene mirar de cada
    ruta (R.revisar), con un enlace a OSM en el lugar; y las que siguen con
    su dibujo y por qué."""
    lines = ['# Recorridos: para revisar', '',
             'Generado por `pipeline/scripts/osm/build_recorridos.py` (docs/RECORRIDOS.md). '
             'Cada punto enlaza a OpenStreetMap en el lugar. Se corrige con un paso en '
             '`config/recorridos_correcciones.json`, o en OSM si la calle falta o tiene mal el sentido.', '']
    rejected = {k: v for k, v in report.items() if not v.get('usa')}
    if rejected:
        lines += [f'## Siguen con su dibujo ({len(rejected)})', '']
        for k, v in sorted(rejected.items()):
            if 'error' in v:
                why = v['error']
            elif not MIN_RATIO <= v['ratio'] <= MAX_RATIO:
                why = f"por la red mide {v['ratio']:.2f} del dibujo"
            elif v.get('m_sin_calle'):
                why = f"{v['m_sin_calle']} m sin calle de {v['m']} m"
            else:
                why = 'casi todo fuera de la red de Lima'
            lines.append(f"- `{k}` {routes.get(k, {}).get('name', '')}: {why}")
        lines.append('')
    for tipo, title in TIPOS.items():
        rows = [(k, x) for k, v in sorted(report.items()) if v.get('usa')
                for x in v.get('revisar', []) if x['tipo'] == tipo]
        if not rows:
            continue
        lines += [f'## {title[0].upper()}{title[1:]} ({len(rows)})', '']
        for k, x in rows:
            bits = [x.get('via') or 'calle sin nombre']
            if 'paso' in x:
                bits.append(f"paso {x['paso']}")
            if 'salida' in x:
                bits.append(f"{x['salida']}.ª salida")
            if 'm' in x:
                bits.append(f"{x['m']} m")
            lines.append(f"- `{k}` {' · '.join(bits)} · [mapa]({osm_link(x)})")
        lines.append('')
    REVIEW.write_text('\n'.join(lines), encoding='utf-8')


if __name__ == '__main__':
    main(sys.argv[1:])
