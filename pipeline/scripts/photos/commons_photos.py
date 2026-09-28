"""
Fotos referenciales de cada ruta: config/route_photos.json.

Fuente principal: Wikimedia Commons, que tiene categorías por ruta
("Category:Ruta 1244, Lima") y guarda autor y licencia de cada archivo. Solo
se aceptan licencias libres (CC0, dominio público, CC BY, CC BY-SA) o un
permiso expreso del autor con su enlace de respaldo.

Uso:
    # Buscar en Commons las categorías "Ruta <código>…" de las rutas del
    # catálogo (y de su código antiguo) y agregar sus fotos
    python pipeline/scripts/photos/commons_photos.py --buscar [--rutas 1244 1320]

    # Agregar un archivo concreto de Commons a una ruta (enlace o "File:…")
    python pipeline/scripts/photos/commons_photos.py --ruta 1244 \\
        --archivo https://commons.wikimedia.org/wiki/File:Ejemplo.jpg

    # Validar el archivo (lo corre el CI)
    python pipeline/scripts/photos/commons_photos.py --check

Las entradas agregadas a mano (otra fuente, permiso del autor) se escriben
directo en el JSON con los mismos campos; el script nunca las borra.

Formato:
{
  "rutas": {
    "1244": [{
      "imagen": "https://upload.wikimedia.org/…/480px-….jpg",   miniatura
      "pagina": "https://commons.wikimedia.org/wiki/File:….jpg", ficha del archivo
      "autor": "…",
      "licencia": "CC BY-SA 4.0",
      "licencia_url": "https://creativecommons.org/licenses/by-sa/4.0",
      "fuente": "Wikimedia Commons",
      "fecha": "2024-03-10",                opcional
      "descripcion": "…",                   opcional
      "codigo_foto": "8614",                opcional: código que figura en la
                                            foto, si es el antiguo
      "permiso": "https://…"                solo con licencia "Permiso del autor"
    }]
  }
}
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PHOTOS = ROOT / 'config' / 'route_photos.json'
CATALOG = ROOT / 'config' / 'catalog.json'
FICHAS = ROOT / 'pipeline' / 'output' / 'prr_fichas.json'

API = 'https://commons.wikimedia.org/w/api.php'
# La política de Wikimedia pide un User-Agent que identifique al cliente
UA = 'limarutas/1.0 (https://github.com/Hardnyx/limarutas)'
THUMB_W = 480
MAX_POR_RUTA = 3

REQUIRED = ('imagen', 'pagina', 'autor', 'licencia', 'fuente')
LICENCIAS = re.compile(r'^(CC0( 1\.0)?|Public domain|Dominio público|'
                       r'CC BY(-SA)? [1-4]\.0( [A-Za-z-]+)?|Permiso del autor)$', re.I)


def api(**params):
    params = {'format': 'json', 'formatversion': '2', **params}
    req = urllib.request.Request(f'{API}?{urllib.parse.urlencode(params)}', headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def texto(value):
    """Campo de extmetadata (HTML) → texto plano."""
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', value or '')).split())


def archivo(title):
    """Entrada de route_photos.json para un archivo de Commons."""
    data = api(action='query', titles=title, prop='imageinfo',
               iiprop='url|extmetadata', iiurlwidth=THUMB_W)
    page = data['query']['pages'][0]
    if page.get('missing') or not page.get('imageinfo'):
        raise ValueError(f'No existe en Commons: {title}')
    info = page['imageinfo'][0]
    meta = {k: v.get('value', '') for k, v in info.get('extmetadata', {}).items()}
    entry = {
        'imagen': info.get('thumburl') or info['url'],
        'pagina': info['descriptionurl'],
        'autor': texto(meta.get('Artist')) or texto(meta.get('Credit')),
        'licencia': texto(meta.get('LicenseShortName')),
        'licencia_url': meta.get('LicenseUrl', ''),
        'fuente': 'Wikimedia Commons',
        'fecha': texto(meta.get('DateTimeOriginal'))[:10],
        'descripcion': texto(meta.get('ImageDescription'))[:200],
    }
    return {k: v for k, v in entry.items() if v}


def titulo(link):
    """'https://commons.wikimedia.org/wiki/File:X.jpg' o 'File:X.jpg' → 'File:X.jpg'."""
    link = urllib.parse.unquote(link.strip())
    m = re.search(r'((?:File|Archivo):[^?#]+)$', link)
    if not m:
        raise ValueError(f'No parece un archivo de Commons: {link}')
    return 'File:' + m.group(1).split(':', 1)[1].replace('_', ' ')


def categorias(codigo):
    """Categorías de Commons que empiezan con "Ruta <código>" (la de la ruta
    y las de su empresa o variantes: "Ruta 1244, Lima", "Ruta 8614 José…")."""
    data = api(action='query', list='allcategories', acprefix=f'Ruta {codigo}', aclimit=20)
    return [c['category'] for c in data['query']['allcategories']
            if re.match(rf'Ruta {re.escape(codigo)}\b', c['category'])]


def archivos_de(categoria):
    data = api(action='query', list='categorymembers', cmtitle=f'Category:{categoria}',
               cmtype='file', cmlimit=50)
    return [m['title'] for m in data['query']['categorymembers']]


def load():
    if PHOTOS.exists():
        return json.loads(PHOTOS.read_text(encoding='utf-8'))
    return {'rutas': {}}


def save(data):
    data['rutas'] = {k: data['rutas'][k] for k in sorted(data['rutas'], key=lambda c: (not c.isdigit(), c.zfill(6)))}
    PHOTOS.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def agregar(data, ruta, entry):
    fotos = data['rutas'].setdefault(ruta, [])
    if any(f.get('pagina') == entry['pagina'] for f in fotos):
        return False
    problemas = revisar(entry)
    if problemas:
        print(f'  {ruta}: se omite {entry["pagina"]}: {"; ".join(problemas)}')
        return False
    fotos.append(entry)
    return True


def revisar(entry):
    problemas = [f'falta "{k}"' for k in REQUIRED if not entry.get(k)]
    lic = entry.get('licencia', '')
    if lic and not LICENCIAS.match(lic):
        problemas.append(f'licencia no libre o no reconocida: "{lic}"')
    if lic.lower() == 'permiso del autor' and not entry.get('permiso'):
        problemas.append('"Permiso del autor" necesita el enlace del permiso en "permiso"')
    for k in ('imagen', 'pagina', 'licencia_url', 'permiso'):
        if entry.get(k) and not entry[k].startswith('https://'):
            problemas.append(f'"{k}" debe ser un enlace https')
    return problemas


def check():
    data = load()
    catalogo = json.loads(CATALOG.read_text(encoding='utf-8'))
    codigos = {str(c).upper() for g in catalogo.values() if isinstance(g, dict)
               for c in g.get('only', [])}
    errores = []
    for ruta, fotos in data.get('rutas', {}).items():
        if ruta.upper() not in codigos:
            errores.append(f'{ruta}: no está en config/catalog.json')
        paginas = [f.get('pagina') for f in fotos]
        if len(set(paginas)) != len(paginas):
            errores.append(f'{ruta}: foto repetida')
        for i, f in enumerate(fotos):
            errores += [f'{ruta}[{i}]: {p}' for p in revisar(f)]
    n = sum(len(f) for f in data.get('rutas', {}).values())
    if errores:
        print('\n'.join(errores))
        sys.exit(f'{len(errores)} problemas en {PHOTOS.relative_to(ROOT)}')
    print(f'{PHOTOS.relative_to(ROOT)}: {n} fotos de {len(data.get("rutas", {}))} rutas, todas con autor y licencia libre')


def buscar(rutas):
    data = load()
    fichas = json.loads(FICHAS.read_text(encoding='utf-8'))['rutas']
    if not rutas:
        rutas = json.loads(CATALOG.read_text(encoding='utf-8'))['transporte']['only']
    nuevas = 0
    for ruta in rutas:
        antiguo = str((fichas.get(ruta) or {}).get('codigo_antiguo') or '')
        for codigo in dict.fromkeys(c for c in (ruta, antiguo) if c):
            for cat in categorias(codigo):
                for title in archivos_de(cat):
                    if len(data['rutas'].get(ruta, [])) >= MAX_POR_RUTA:
                        break
                    entry = archivo(title)
                    if codigo != ruta:
                        entry['codigo_foto'] = codigo
                    if agregar(data, ruta, entry):
                        nuevas += 1
                        print(f'  {ruta}: {title} ({entry["autor"]}, {entry["licencia"]})')
    save(data)
    print(f'{nuevas} fotos nuevas · escrito {PHOTOS.relative_to(ROOT)}')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--check', action='store_true', help='validar route_photos.json')
    ap.add_argument('--buscar', action='store_true', help='buscar categorías "Ruta <código>" en Commons')
    ap.add_argument('--rutas', nargs='*', default=[], help='solo estas rutas (con --buscar)')
    ap.add_argument('--ruta', help='código de la ruta (con --archivo)')
    ap.add_argument('--archivo', nargs='+', help='enlaces o títulos de archivos de Commons')
    args = ap.parse_args()
    if args.check:
        check()
    elif args.buscar:
        buscar(args.rutas)
    elif args.archivo and args.ruta:
        data = load()
        for link in args.archivo:
            entry = archivo(titulo(link))
            if agregar(data, args.ruta, entry):
                print(f'  {args.ruta}: {entry["pagina"]} ({entry["autor"]}, {entry["licencia"]})')
        save(data)
    else:
        ap.print_help()


if __name__ == '__main__':
    main()
