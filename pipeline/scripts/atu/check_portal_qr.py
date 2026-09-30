"""
Compara el índice del Portal Mapas QR de la ATU (config/atu_portal_qr.json)
con lo que muestra el mapa: servicios del Metropolitano, alimentadores,
estaciones y Cole Bus. Solo informa; no cambia nada.

Uso:
    python pipeline/scripts/atu/check_portal_qr.py
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PORTAL = ROOT / 'config' / 'atu_portal_qr.json'
CATALOG = ROOT / 'config' / 'catalog.json'
MET = ROOT / 'data' / 'processed' / 'metropolitano'
CORR = ROOT / 'config' / 'lista_corredores.json'

NUMEROS = {'dos': '2', 'veintidos': '22'}


def norm(s: str) -> str:
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'\b(alimentadora|norte|sur|ida|vuelta|de|del|la|los|las|el)\b|[()]', ' ', s)
    s = ' '.join(NUMEROS.get(w, w) for w in s.split())
    return s.replace('atunez', 'antunez').replace('milagro jesus', 'milagros jesus').strip()


def main() -> None:
    portal = json.loads(PORTAL.read_text(encoding='utf-8'))
    catalog = json.loads(CATALOG.read_text(encoding='utf-8'))
    met = catalog['metropolitano']
    nuestros = set(met['regulares']['only']) | set(met['expresos']['only'])
    oficiales = set(portal['metropolitano']['servicios'].values())
    print('Metropolitano, servicios')
    print('  en el portal y no en el mapa:', sorted(oficiales - nuestros) or '—')
    print('  en el mapa y no en el portal:', sorted(nuestros - oficiales - {'SXN-22'}) or '—',
          '(SXN-22 es una variante del SXN)')

    estaciones = {norm(s['name']).replace(' sur', '').replace(' norte', '')
                  for s in json.loads((MET / 'metropolitano_stops.json').read_text(encoding='utf-8'))['stations']}
    faltan = [e for e in portal['metropolitano']['estaciones']
              if not any(norm(e.split(' / ')[0]) in x or x in norm(e) for x in estaciones)]
    print('Estaciones del portal que el mapa no tiene:', faltan or '—')

    paths = json.loads((MET / 'alimentadores_paths.json').read_text(encoding='utf-8'))['services']
    oficiales_sur = json.loads((ROOT / 'config' / 'alim_paraderos.json').read_text(encoding='utf-8'))
    activos = set(met['alimentadores']['only'])
    # Nombre oficial si lo hay (AS-02 figura en OSM como "Alameda Sur": es Cedros de Villa)
    nombres = {ref: norm((oficiales_sur.get(ref) or {}).get('nombre') or (paths.get(ref) or {}).get('name', ref))
               for ref in activos}
    terminal_de = {ref: norm((paths.get(ref) or {}).get('terminal', '')) for ref in activos}
    print('Alimentadores (mismo nombre y mismo terminal)')
    oficiales_alim = set()
    for terminal, grupo in portal['metropolitano']['alimentadores'].items():
        for nombre in grupo:
            oficiales_alim.add(norm(nombre))
            mismo = [ref for ref, n in nombres.items() if norm(nombre) in n]
            hit = [ref for ref in mismo if norm(terminal).replace(' ', '-') in terminal_de[ref].replace(' ', '-')]
            if hit:
                estado = ', '.join(sorted(hit))
            elif mismo:
                # El terminal del mapa sale de la geometría (la estación más
                # cercana al trazado de OSM); si la ATU lo cambió, el trazado es viejo
                estado = ', '.join(f'{ref} con terminal {terminal_de[ref]} en el mapa' for ref in sorted(mismo))
            else:
                estado = 'FALTA en el mapa'
            print(f'  {terminal:13} {nombre:20} {estado}')
    ocultos = {norm(n) for lista in portal['ocultos']['alimentadores'].values() for n in lista}
    sobran = [ref for ref, n in nombres.items() if not any(o in n for o in oficiales_alim)]
    print('  en el mapa y no en el portal:', ', '.join(
        f"{ref}{' (oculto por la ATU)' if any(o in nombres[ref] for o in ocultos) else ''}" for ref in sorted(sobran)) or '—')
    corr = json.loads(CORR.read_text(encoding='utf-8'))
    cole = [r for k in ('rutas_principales_activas', 'rutas_alimentadoras_activas')
            for r in corr.get(k, []) if 'cole' in str(r.get('servicio', '')).lower()]
    print(f"Cole Bus: {len(portal['cole_bus'])} en el portal ({', '.join(portal['cole_bus'])}); "
          f'{len(cole)} en el mapa')


if __name__ == '__main__':
    main()
