"""
Nombre con el que la gente conoce cada ruta ("nombre_popular" del maestro).

Nadie dice "la 1194": dicen "la EVIFASA B", "la 36", "El Chosicano". En orden:

  1. config/nombres_populares.json, "rutas": nombre curado con su fuente
     ("La 1 (ETUPSA 73)").
  2. Apodo del alias ("La B - El Chocolate" → "El Chocolate", "La Covida").
  3. Número del alias ("La 36", "La 23C"): distinto en toda la ciudad.
  4. Letra del alias ("La C"): sola es ambigua (hay decenas de "La C"), así
     que va con la empresa: su marca si es conocida ("marcas" del JSON:
     "EVIFASA B") o su nombre ("Santa Luzmila C").
  5. Sin alias: el nombre de la empresa ("Bronco"); sin empresa, el código.

empresa_corta() limpia la razón social ("E.T. Y SERV. EL RETABLO S.A." →
"El Retablo") para mostrarla.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CURADOS = ROOT / 'config' / 'nombres_populares.json'

PLACEHOLDER = {'', 'desconocido', 'desconocida', 'ninguno', 'ninguna', '-', '?', '¿?', 'sin nombre'}
NUM = re.compile(r'^(la|el)\s+(\d{1,3}[a-z]?(?:-\d)?)$', re.I)
LETRA = re.compile(r'^(la|el)\s+([a-z]{1,3}\d{0,2}[a-z]?)$', re.I)
SMALL = {'de', 'del', 'la', 'las', 'los', 'y', 'e', 'en', 'el', 'para'}
SOCIEDAD = re.compile(r'\b(s\.?\s*a\.?\s*c\.?|s\.?\s*a\.?|e\.?\s*i\.?\s*r\.?\s*l\.?|s\.?\s*r\.?\s*l\.?)(?=[\s.,]|$)', re.I)
# Razón social delante del nombre ("E.T. Y SERV.", "EMPRESA DE TRANSPORTES",
# "CONSORCIO DE TRANSPORTE"...)
PREFIJO = re.compile(
    # "E.T.", "E.S.T.", "E.T.S.", "E. T. T.", "E.S.E.T." (con puntos: "Tablada" no)
    r'^(?:e\.\s*(?:s\.\s*)?(?:e\.\s*)?t\.\s*(?:s\.\s*)?(?:t\.\s*)?'
    r'(?:y\s*(?:serv(?:icios)?\.?|turismo)\s*(?:m[uú]ltiples\.?)?)?\s*(?:turismo\s+)?(?:serv\.?\s*comer\.?\s*)?'
    r'|inversiones\s+m[uú]ltiples\s+'
    r'|empresa\s+de\s+transportes?(?:\s+y\s+servicios(?:\s+m[uú]ltiples)?)?\s*'
    r'|consorcio(?:\s+de\s+transportes?(?:\s+y\s+servicios?)?)?\s+'
    r'|agrup\.?\s+de\s+trans\.?\s+en\s+camionetas\s*'
    r'|comun\.?\s*integ\.?\s*turis\.?\s*y\s*serv\.?\s*'
    r'|servicio\s+de\s+transportistas\s+)',
    re.I)


def _placeholder(s: str) -> bool:
    return str(s or '').strip().lower() in PLACEHOLDER


def _titulo(s: str) -> str:
    """'SANTA LUZMILA' → 'Santa Luzmila'; siglas y códigos ('CKF', 'H2',
    'J.C.') quedan en mayúsculas. Un nombre ya escrito con minúsculas se deja."""
    if s != s.upper():
        return s
    out = []
    for i, w in enumerate(s.split()):
        low = w.lower()
        if '.' in w or not re.search(r'[aeiouáéíóú]', low) or re.search(r'\d', w):
            out.append(w)                       # sigla o código
        elif i and low in SMALL:
            out.append(low)
        else:
            out.append(low[:1].upper() + low[1:])
    return ' '.join(out)


def empresa_corta(empresa: str, siglas: str = '') -> str:
    """Nombre de la empresa sin la razón social."""
    if _placeholder(empresa):
        return ''
    s = re.sub(r'\(.*?\)', ' ', empresa)
    s = SOCIEDAD.sub(' ', s)
    s = PREFIJO.sub('', s.strip())
    if siglas:
        s = re.sub(rf'\b{re.escape(siglas)}\b\.?', ' ', s, flags=re.I)
    s = ' '.join(s.split()).strip(' .,-&"')
    s = _titulo(s)
    # Si de la razón social no queda nada legible, las siglas
    return s or siglas


def partes_alias(alias: str):
    """'La B - El Chocolate' → (números, letras, apodos) = ([], ['B'], ['El Chocolate'])."""
    if _placeholder(alias):
        return [], [], []
    nums, letras, apodos = [], [], []
    for p in (x.strip() for x in re.split(r'\s+-\s+', str(alias))):
        if not p or _placeholder(p):
            continue
        if (m := NUM.match(p)):
            nums.append(f'La {m[2].upper()}')
        elif (m := LETRA.match(p)):
            letras.append(m[2].upper())
        else:
            apodos.append(p)
    return nums, letras, apodos


def cargar_curados():
    if not CURADOS.exists():
        return {}, {}
    data = json.loads(CURADOS.read_text(encoding='utf-8'))
    marcas = {k.upper(): v['nombre'] for k, v in data.get('marcas', {}).items()}
    rutas = {k: v['nombre'] for k, v in data.get('rutas', {}).items()}
    return marcas, rutas


def nombre_popular(fila: dict, marcas: dict, rutas: dict) -> str:
    codigo = fila.get('codigo_nuevo', '')
    if codigo in rutas:
        return rutas[codigo]
    nums, letras, apodos = partes_alias(fila.get('alias', ''))
    siglas = (fila.get('empresa_abrev') or '').strip()
    marca = marcas.get(siglas.upper())
    empresa = marca or empresa_corta(fila.get('empresa_operadora', ''), siglas)
    if apodos:
        return apodos[0]
    if nums:
        return nums[0]
    if letras:
        return f'{empresa} {letras[0]}' if empresa else f'La {letras[0]}'
    return empresa or codigo
