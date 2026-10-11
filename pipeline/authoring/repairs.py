"""Correct a reversed simple roundabout using its actual one-way OSM ring."""
from __future__ import annotations

import copy

from .model import attach_stops, digest, validate


def roundabouts(route, engine):
    original = copy.deepcopy(route)
    result, repairs, index = copy.deepcopy(route), [], 0
    path = []
    while index < len(original['path']):
        ref = original['path'][index]
        edge = engine.network.edges.get(ref.get('edge'), {})
        if ref['type'] != 'street' or edge.get('junction') not in ('roundabout', 'circular'):
            path.append(copy.deepcopy(ref))
            index += 1
            continue
        way, end = edge['way'], index+1
        while end < len(original['path']):
            nxt = original['path'][end]
            if nxt['type'] != 'street' or engine.network.edges[nxt['edge']]['way'] != way:
                break
            end += 1
        refs = original['path'][index:end]
        invalid = any(not engine.network.edges[r['edge']]['forward' if r.get('end', 1)>r.get('start', 0) else 'backward'] for r in refs)
        if not invalid:
            path.extend(copy.deepcopy(refs))
            index = end
            continue
        ring = sorted((engine.network.edges[eid] for eid in engine.network.ways[way]),
                      key=lambda e: int(e['id'].split(':')[1]))
        nodes = [ring[0]['nodes'][0]] + [e['nodes'][1] for e in ring]
        simple = (nodes[0] == nodes[-1] and len(set(nodes[:-1])) == len(nodes)-1
                  and all(a['nodes'][1] == b['nodes'][0] for a, b in zip(ring, ring[1:]))
                  and len({(e['forward'], e['backward']) for e in ring}) == 1
                  and ring[0]['forward'] != ring[0]['backward'])
        if not simple:
            raise ValueError('El óvalo no es un anillo simple con sentido inequívoco')
        first, last = refs[0], refs[-1]
        start = {'edge': first['edge'], 'fraction': first.get('start', 0)}
        finish = {'edge': last['edge'], 'fraction': last.get('end', 1)}
        if engine.network.coordinates(first)[0] == engine.network.coordinates(last)[-1]:
            raise ValueError('Una vuelta completa requiere revisar el punto de salida')
        fixed = engine.connect(start, finish, allowed={way}, history=path, profile=result.get('profile'))
        if (engine.network.coordinates(fixed[0])[0] != engine.network.coordinates(first)[0]
                or engine.network.coordinates(fixed[-1])[-1] != engine.network.coordinates(last)[-1]):
            raise ValueError('La corrección cambió la entrada o salida del óvalo')
        repairs.append({'fromPathIndex': index, 'toPathIndex': end-1, 'way': way,
                        'before': copy.deepcopy(refs), 'after': copy.deepcopy(fixed),
                        'evidence': 'simple-directed-osm-ring-same-entry-and-exit'})
        path.extend(fixed)
        index = end
    if not repairs:
        raise ValueError('No hay un contrasentido corregible en un óvalo simple')
    result['path'] = path
    result['review']['accepted'] = False
    result.pop('exported', None)
    result = attach_stops(result, engine.network)
    if not validate(result, engine.network)['ready']:
        raise ValueError('El recorrido corregido todavía tiene incidencias; requiere revisión')
    return result, {'kind': 'roundabout-direction', 'equivalent': True,
                    'reason': 'same-osm-roundabout-same-entry-and-exit-correct-direction',
                    'sourcePathHash': digest(original['path']), 'pathHash': digest(path), 'repairs': repairs}


def publication_proof(route, engine):
    from .migration import legacy_equivalence
    from .importer import track_coordinates
    if route.get('migration', {}).get('kind') != 'roundabout-direction':
        return legacy_equivalence(route, engine)
    source = route['source']
    line = [tuple(reversed(p)) for part in track_coordinates(source['track']) for p in part]
    record = engine.matcher.decode(source['vias'], line)
    if record is None:
        raise ValueError('Ya no se pueden reproducir las referencias fuente')
    for correction in source.get('corrections', []):
        record = engine.matcher.corregir(record, correction)
    original = copy.deepcopy(route)
    original['path'] = engine.from_record(record)
    if not legacy_equivalence(original, engine)['equivalent']:
        raise ValueError('Las referencias fuente no reproducen el recorrido publicado anterior')
    corrected, proof = roundabouts(original, engine)
    if corrected['path'] != route['path']:
        raise ValueError('La propuesta ya no reproduce la corrección verificada')
    return proof
