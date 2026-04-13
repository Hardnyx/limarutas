"""
scrap_wikipedia_rutas.py

Extrae rutas de transporte desde el HTML de Wikipedia guardado localmente
y produce dos CSVs:

  pipeline/output/lista_rutas_nuevas.csv   -- rutas PRR (codigo nuevo 1001+)
  pipeline/output/lista_rutas_antiguas.csv -- rutas con codigo antiguo

Uso:
    python3 pipeline/scripts/scrap_wikipedia_rutas.py

El archivo wikipedia.html debe estar en pipeline/input/wikipedia.html
"""

import csv
import re
from pathlib import Path
from bs4 import BeautifulSoup


ROOT    = Path('/workspaces/limarutas')
HTML_IN = ROOT / 'pipeline/input/wikipedia.html'
OUT_NEW = ROOT / 'pipeline/output/lista_rutas_nuevas.csv'
OUT_OLD = ROOT / 'pipeline/output/lista_rutas_antiguas.csv'


# ── Normalización de empresa ──────────────────────────────────────────────────

ESTADO_KEYWORDS = re.compile(
    r'^\s*(desierta|inactiva|activa|proyectada|suspendida)',
    re.IGNORECASE
)

PREFIJOS = [
    r'Corporaci[oó]n Empresa de Transportes Urbano',
    r'Corporaci[oó]n Inversiones',
    r'Corporaci[oó]n',
    r'Cooperativa de Servicios Especiales Transportes',
    r'Cooperativa de Transportes',
    r'Cooperativa de Transporte',
    r'Comunicaci[oó]n Integral Turismo e Inversiones',
    r'Agrupaci[oó]n de Transportistas en Camionetas\s+S\.?A\.?C?\.?',
    r'Agrupaci[oó]n de Transportistas en Camionetas',
    r'Empresa de Servicios y Transportes',
    r'Empresa de Servicios de Transportes',
    r'Empresa de Servicios de Transporte',
    r'Empresa de Servicios M[uú]ltiples',
    r'Empresa de Servicio Especial de Transporte',
    r'Empresa de Transportes,?\s+Servicios,?\s+Comercializadora,.+',
    r'Empresa de Transportes,?\s+Inversiones y Servicios',
    r'Empresa de Transporte,?\s+Servicios\s+y\s+Comercializaci[oó]n',
    r'Empresa de Transporte\s+de\s+Servicio\s+de\s+Transportes',
    r'Empresa de Transporte\s+de\s+Servicio',
    r'Empresa de Transporte\s+y\s+Turismos?\s+Especiales',
    r'Empresa de Transporte\s+y\s+Turismos?',
    r'Empresa de Transportes y Servicios M[uú]ltiples',
    r'Empresa de Transportes y Servicios',
    r'Empresa de Transportes',
    r'Empresa de Transporte y Servicios',
    r'Empresa de Transporte',
    r'Empresa Business Corporation',
    r'Empresa',
    r'Grupo Express del Per[uú]\s+S\.?A\.?C?\.?',
    r'Grupo',
    r'Multiservicios de Buses de',
    r'Multiservicios e Inversiones',
    r'Inversiones\s+Empresa\s+de\s+Transportes',
    r'Inversiones y Servicios M[uú]ltiples',
    r'Inversiones y Servicios',
    r'Servicios Generales y Transportes',
    r'Servicio Interconectado de Transporte',
    r'Transportes e Inversiones',
    r'Transportes y Servicios M[uú]ltiples',
    r'Transportes y Servicios',
    r'Transportes,?\s+Inversiones y Servicios',
    r'Transportes',
    r'Trans\.',
    r'y\s+Representaciones',
    r'y\s+Multiservicios',
    r'y\s+Service\b',
    r'e\s+Inversiones\s+M[uú]ltiples',
    r'y\s+Turismos?\b',
    r'de\s+Multiservicios',
    r'de\s+Servicio\s+R[aá]pido',
    r'de\s+Servicio\s+Urbano',
    r'de\s+Servicios\s+Urbanos',
    r'de\s+Transportes?,\s+Servicios.+',
    r'de\s+Transportes?,\s+Inversiones.+',
    r'de\s+Transporte,\s+Servicios.+',
]

SUFIJOS_JURIDICOS = re.compile(
    r'\s*\b(S\.A\.C\.|S\.A\.|S\.A\b|E\.I\.R\.L\.|EIRL|Ltda\.|Ltda|S\.R\.L\.)\s*$',
    re.IGNORECASE
)

INICIO_RESIDUAL = re.compile(
    r'^(del?\s+|de\s+los\s+|de\s+las\s+|y\s+|e\s+)',
    re.IGNORECASE
)


def extraer_abrev(texto):
    m = re.search(r'\(([A-Z][A-Z0-9\s\-]{0,14})\)\s*$', texto)
    if m:
        return m.group(1).strip()
    return ''


def limpiar_empresa(texto_raw):
    if not texto_raw:
        return 'Desconocido', ''

    texto = texto_raw.strip()

    if ESTADO_KEYWORDS.match(texto):
        return 'Desconocido', ''

    if texto in ('', '¿?', 'Desconocido'):
        return 'Desconocido', ''

    texto = texto.split('/')[0].strip()

    # Quitar paréntesis con contenido largo (nombre alternativo)
    texto = re.sub(r'\s*\([^)]{16,}\)', '', texto).strip()

    abrev = extraer_abrev(texto)

    # Quitar paréntesis de abreviatura
    texto = re.sub(r'\s*\([A-Z][A-Z0-9\s\-]{0,14}\)\s*$', '', texto).strip()

    texto = SUFIJOS_JURIDICOS.sub('', texto).strip()

    # Quitar prefijo (primer match)
    for prefijo in PREFIJOS:
        nuevo = re.sub(r'^\s*' + prefijo + r'\s*', '', texto, flags=re.IGNORECASE)
        if nuevo != texto:
            texto = nuevo.strip()
            break

    texto = SUFIJOS_JURIDICOS.sub('', texto).strip()
    texto = INICIO_RESIDUAL.sub('', texto).strip()
    texto = SUFIJOS_JURIDICOS.sub('', texto).strip()

    # Si quedó vacío pero había abreviatura, usarla como nombre
    if not texto and abrev:
        return abrev, abrev

    return (texto if texto else 'Desconocido'), abrev


# ── Normalización de color ────────────────────────────────────────────────────

import colorsys as _colorsys


def normalizar_color(hex_color, l_min=0.35, l_max=0.58):
    """
    Ajusta la luminosidad al rango [l_min, l_max] preservando matiz y saturacion.
    Garantiza visibilidad tanto en mapa claro como oscuro.
    Colores near-white sin matiz (S<5%, L>75%) → gris neutro.
    Colores near-black sin matiz (S<5%, L<25%) → gris oscuro medio.
    """
    if not hex_color:
        return '#5A6470'
    h6 = hex_color.lstrip('#')
    if len(h6) == 3:
        h6 = ''.join(c*2 for c in h6)
    if hex_color.upper() == '#FFFFFF' or not h6:
        return '#5A6470'
    try:
        r, g, b = int(h6[0:2], 16)/255, int(h6[2:4], 16)/255, int(h6[4:6], 16)/255
        h, l, s = _colorsys.rgb_to_hls(r, g, b)
        if s < 0.05 and l > 0.75:
            return '#5A6470'
        if s < 0.05 and l < 0.25:
            return '#4A5560'
        l_new = max(l_min, min(l_max, l))
        rn, gn, bn = _colorsys.hls_to_rgb(h, l_new, s)
        return '#{:02X}{:02X}{:02X}'.format(int(rn*255), int(gn*255), int(bn*255))
    except Exception:
        return '#5A6470'


# ── Extracción de color ───────────────────────────────────────────────────────

def extraer_color(td):
    span = td.find('span', style=True)
    if span:
        m = re.search(r'background\s*:\s*(#[0-9A-Fa-f]{3,6})', span.get('style', ''))
        if m:
            return normalizar_color(m.group(1).upper())
    return '#5A6470'


def normalizar_estado(texto):
    t = texto.strip()
    if not t or t in ('¿?', '?'):
        return ''
    t_lower = t.lower()
    if t_lower.startswith('activa'):
        return 'Activa'
    if t_lower.startswith('inactiva') or t_lower.startswith('inhabilitada') or t_lower.startswith('desierta'):
        return 'Inactiva'
    return t


def celda(td):
    t = td.get_text(strip=True)
    # Quitar referencias wikipedia [N] y [nota N]
    t = re.sub(r'\[\d+\]|\[nota\s*\d+\]', '', t)
    t = re.sub(r'\u200b', '', t)
    return t.strip()


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print(f'Leyendo {HTML_IN}')
    with open(HTML_IN, encoding='utf-8') as f:
        soup = BeautifulSoup(f, 'html.parser')

    tables = soup.find_all('table', class_='wikitable')
    print(f'Tablas encontradas: {len(tables)}')

    filas_nuevas   = []
    filas_antiguas = []

    for table in tables:
        rows = table.find_all('tr')
        if not rows:
            continue

        headers  = [th.get_text(strip=True) for th in rows[0].find_all('th')]
        es_nueva = 'Código Anterior' in headers
        # Tablas antiguas sin columna Seudónimo (8xxx, 9xxx)
        tiene_alias = 'Seudónimo o alias' in headers

        for row in rows[1:]:
            cols = row.find_all(['td', 'th'])
            if not cols:
                continue

            if es_nueva and len(cols) >= 6:
                # Ruta | Cod.Anterior | Seudónimo | Origen | Destino | Empresa
                codigo_nuevo   = celda(cols[0])
                codigo_antiguo = celda(cols[1])
                alias          = celda(cols[2])
                origen         = celda(cols[3])
                destino        = celda(cols[4])
                empresa_raw    = celda(cols[5])
                color          = extraer_color(cols[0])

                if not re.match(r'^\d{4}$', codigo_nuevo):
                    continue

                empresa, abrev = limpiar_empresa(empresa_raw)
                if alias in ('¿?', ''):
                    alias = 'Desconocido'

                filas_nuevas.append({
                    'codigo_antiguo':    codigo_antiguo,
                    'codigo_nuevo':      codigo_nuevo,
                    'distrito_origen':   origen,
                    'distrito_destino':  destino,
                    'empresa_operadora': empresa,
                    'empresa_abrev':     abrev,
                    'alias':             alias,
                    'color_hex':         color,
                })

            elif not es_nueva:
                if tiene_alias and len(cols) >= 5:
                    # Ruta | Seudónimo | Origen | Destino | Empresa | Estado
                    codigo_antiguo = celda(cols[0])
                    alias          = celda(cols[1])
                    origen         = celda(cols[2])
                    destino        = celda(cols[3])
                    empresa_raw    = celda(cols[4])
                    estado         = normalizar_estado(celda(cols[5])) if len(cols) >= 6 else ''
                    color          = extraer_color(cols[0])
                elif not tiene_alias and len(cols) >= 4:
                    # Ruta | Origen | Destino | Empresa | Estado
                    codigo_antiguo = celda(cols[0])
                    alias          = 'Desconocido'
                    origen         = celda(cols[1])
                    destino        = celda(cols[2])
                    empresa_raw    = celda(cols[3])
                    estado         = normalizar_estado(celda(cols[4])) if len(cols) >= 5 else ''
                    color          = extraer_color(cols[0])
                else:
                    continue

                cod_clean = re.sub(r'\[.*?\]|\u200b', '', codigo_antiguo).strip()
                if not re.match(r'^\d{4}', cod_clean):
                    continue

                empresa, abrev = limpiar_empresa(empresa_raw)
                if alias in ('¿?', '', 'Ninguno'):
                    alias = 'Desconocido'

                filas_antiguas.append({
                    'codigo_antiguo':    cod_clean,
                    'codigo_nuevo':      '',
                    'distrito_origen':   origen,
                    'distrito_destino':  destino,
                    'empresa_operadora': empresa,
                    'empresa_abrev':     abrev,
                    'alias':             alias,
                    'color_hex':         color,
                    'estado':            estado,
                })

    def dedup(filas, key):
        seen, out = set(), []
        for r in filas:
            k = r[key]
            if k not in seen:
                seen.add(k)
                out.append(r)
        return out

    filas_nuevas   = dedup(filas_nuevas,   'codigo_nuevo')
    filas_antiguas = dedup(filas_antiguas, 'codigo_antiguo')

    campos_nuevas   = ['codigo_antiguo','codigo_nuevo','distrito_origen','distrito_destino',
                       'empresa_operadora','empresa_abrev','alias','color_hex']
    campos_antiguas = campos_nuevas + ['estado']

    OUT_NEW.parent.mkdir(parents=True, exist_ok=True)

    with open(OUT_NEW, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=campos_nuevas)
        w.writeheader()
        w.writerows(filas_nuevas)

    with open(OUT_OLD, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=campos_antiguas)
        w.writeheader()
        w.writerows(filas_antiguas)

    print(f'Rutas nuevas (PRR):   {len(filas_nuevas)} -> {OUT_NEW}')
    print(f'Rutas antiguas:       {len(filas_antiguas)} -> {OUT_OLD}')

    print('\n--- Muestra (primeras 5 nuevas) ---')
    for r in filas_nuevas[:5]:
        print(f"  {r['codigo_nuevo']} | {r['empresa_operadora']!r:35} ({r['empresa_abrev']:12}) | {r['alias']:20} | {r['color_hex']}")


if __name__ == '__main__':
    main()