"""Extract the PMU renderer without executing remote JavaScript."""
from __future__ import annotations

import ast
import copy
import json
import math
import re

from .sources import SourceError, fetch, sha, digest, atomic_bytes, json_bytes

URL = 'https://geovisor.atumovilidad.pe/index.js?v=2'


def renderer(raw):
    text = raw.decode('utf-8')
    start = re.search(r'(?m)^\s*const\s+renderer\s*=\s*', text)
    if not start:
        raise SourceError('No se encontró la simbología PMU del geovisor')
    # Parse only literal objects, arrays, strings and numbers. Code/functions fail closed.
    position = start.end()
    token = re.compile(r'''\s+|//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|-?\d+(?:\.\d+)?|[A-Za-z_$][\w$]*|[{}\[\]:,]''')

    def next_token():
        nonlocal position
        while True:
            found = token.match(text, position)
            if not found:
                raise SourceError('El renderer dejó de ser un objeto literal compatible')
            position = found.end()
            value = found.group()
            if not value.isspace() and not value.startswith(('//', '/*')):
                return value

    current = next_token()

    def advance():
        nonlocal current
        current = next_token()

    def parse():
        nonlocal current
        if current in ('{', '['):
            object_value = current == '{'
            result = {} if object_value else []
            end = '}' if object_value else ']'
            advance()
            while current != end:
                if object_value:
                    key = ast.literal_eval(current) if current[0] in ('"', "'") else current
                    if not isinstance(key, str) or key in result:
                        raise SourceError('Clave de simbología inválida o repetida')
                    advance()
                    if current != ':':
                        raise SourceError('Objeto de simbología incompatible')
                    advance(); result[key] = parse()
                else:
                    result.append(parse())
                if current == ',':
                    advance()
                elif current != end:
                    raise SourceError('Separador de simbología incompatible')
            # The top renderer closes immediately before arbitrary application code.
            if object_value and result.get('type') == 'unique-value' and 'uniqueValueInfos' in result:
                return result
            advance()
            return result
        value = current
        advance()
        if value[0] in ('"', "'"):
            return ast.literal_eval(value)
        if value in ('true', 'false', 'null'):
            return {'true': True, 'false': False, 'null': None}[value]
        if re.fullmatch(r'-?\d+(?:\.\d+)?', value):
            return float(value) if '.' in value else int(value)
        raise SourceError('No se admite ejecutar expresiones de la simbología')

    result = parse()
    if result.get('type') != 'unique-value' or result.get('field') != 'simbol':
        raise SourceError('Cambió el campo de simbología PMU; revisar contrato')
    symbols = {}
    for entry in result['uniqueValueInfos']:
        if not isinstance(entry, dict) or not isinstance(entry.get('symbol'), dict) or not isinstance(entry.get('label'), str):
            raise SourceError('Entrada de simbología PMU incompleta')
        key, symbol = entry.get('value'), entry['symbol']
        if (not isinstance(key, str) or key in symbols or symbol.get('type') != 'simple-line'
                or not re.fullmatch(r'#[0-9a-fA-F]{6}', symbol.get('color', ''))
                or type(symbol.get('width')) not in (int, float) or not math.isfinite(symbol['width'])
                or not 0 < symbol['width'] <= 10 or symbol.get('style', 'solid') not in ('solid', 'dash')):
            raise SourceError('Simbología PMU desconocida o ambigua')
        symbols[key] = {'color': symbol['color'].lower(), 'width': symbol['width'],
                        'style': symbol.get('style', 'solid'), 'label': entry['label']}
    if not symbols:
        raise SourceError('Renderer PMU vacío')
    return {'field': 'simbol', 'symbols': symbols}


def validate(value):
    if (value.get('sourceUrl') != URL or value.get('field') != 'simbol'
            or not re.fullmatch(r'[0-9a-f]{64}', value.get('sourceSha256', ''))
            or not isinstance(value.get('symbols'), dict) or not value['symbols']):
        raise SourceError('Falta procedencia de la simbología ATU')
    for entry in value['symbols'].values():
        if (not re.fullmatch(r'#[0-9a-f]{6}', entry.get('color', ''))
                or type(entry.get('width')) not in (int, float) or not math.isfinite(entry['width']) or not 0 < entry['width'] <= 10
                or entry.get('style') not in ('solid', 'dash')):
            raise SourceError('Simbología ATU inválida')


def synchronize(state_dir, published, force=False):
    cache = state_dir / 'pmu-renderer-cache.json'
    source_file = state_dir / 'pmu-renderer-source.js'
    try: old = json.loads(cache.read_text()) if cache.exists() else None
    except (ValueError, OSError): old = None
    headers = {'Accept': 'application/javascript, text/javascript, */*;q=0.8'}
    if old:
        try:
            validate(old['renderer'])
            source = source_file.read_bytes()
            if sha(source) != old['renderer']['sourceSha256'] or renderer(source)['symbols'] != old['renderer']['symbols']:
                old = None
        except (ValueError, KeyError, TypeError, OSError): old = None
    if old and not force:
        if old.get('etag'): headers['If-None-Match'] = old['etag']
        if old.get('lastModified'): headers['If-Modified-Since'] = old['lastModified']
    status, meta, body = fetch(URL, headers)
    if status == 304 and old is None:
        status, meta, body = fetch(URL, {'Accept': 'application/javascript, text/javascript, */*;q=0.8'})
        if status == 304: raise SourceError('304 de simbología sin copia local válida')
    if status == 304:
        value = copy.deepcopy(old['renderer'])
    else:
        value = {**renderer(body), 'sourceUrl': URL, 'sourceSha256': sha(body)}
        validate(value)
        atomic_bytes(source_file, body)
        atomic_bytes(cache, json_bytes({'renderer': value, 'etag': meta.get('etag'),
                                       'lastModified': meta.get('last-modified')}))
    changed = not published or digest(value['symbols']) != digest(published['symbols'])
    return value, {'httpStatus': status, 'downloadedBytes': len(body), 'dataChanged': changed}
