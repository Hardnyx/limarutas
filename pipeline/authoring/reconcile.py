"""Three-way source proposals preserve edits and require explicit conflict choices."""
from __future__ import annotations

import copy

from .model import digest


def clean_stop(stop):
    return {k: copy.deepcopy(v) for k, v in stop.items() if k not in ('position', 'sourceIndex')}


def stop_key(stop):
    return f"{stop['id']}#{stop.get('occurrence', 1)}"


def baseline(route):
    return {'path': copy.deepcopy(route['path']), 'name': route['name'], 'direction': route['direction'],
            'stops': [clean_stop(stop) for stop in route['stops']]}


def seal_source(route):
    source = route['source']
    source['baseline'] = baseline(route)
    source['inputHash'] = digest({k: source.get(k) for k in ('track', 'stops', 'corrections')})
    source['snapshotHash'] = digest({k: v for k, v in source.items() if k not in ('snapshotHash', 'importWarnings')})
    return route


def propose(current, incoming, choices=None):
    if current['id'] != incoming['id'] or current['direction'] != incoming['direction']:
        raise ValueError('La actualización pertenece a otra ruta o sentido')
    if current['network'] != incoming['network']:
        raise ValueError('Migra la red por separado antes de comparar fuentes')
    if current['source'].get('kind') != 'wikiroutes' or incoming['source'].get('kind') != 'wikiroutes':
        raise ValueError('La conciliación requiere dos fuentes Wikiroutes')
    old = current['source'].get('baseline')
    if old is None:
        raise ValueError('La fuente anterior no tiene una base de comparación; vuelve a importarla antes de editar')
    choices = choices or {}
    if any(value not in ('local', 'incoming') for value in choices.values()):
        raise ValueError('Cada decisión debe ser local o incoming')
    conflicts, used = [], set()

    def merge(key, before, local, remote):
        if local == remote or remote == before:
            return copy.deepcopy(local)
        if local == before:
            return copy.deepcopy(remote)
        decision = choices.get(key)
        used.add(key)
        conflicts.append({'key': key, 'baseline': before, 'local': local, 'incoming': remote, 'resolution': decision})
        return copy.deepcopy(remote if decision == 'incoming' else local)

    result = copy.deepcopy(current)
    result['name'] = merge('name', old['name'], current['name'], incoming['name'])
    # Only upstream track/correction changes are allowed to replace the operational path.
    track_changed = any(current['source'].get(k) != incoming['source'].get(k) for k in ('track', 'corrections'))
    if track_changed:
        if current['path'] != old['path'] and current['path'] != incoming['path']:
            decision = choices.get('path')
            used.add('path')
            conflicts.append({'key': 'path', 'baseline': old['path'], 'local': current['path'],
                              'incoming': incoming['path'], 'resolution': decision})
            result['path'] = copy.deepcopy(incoming['path'] if decision == 'incoming' else current['path'])
        else:
            result['path'] = merge('path', old['path'], current['path'], incoming['path'])
        if result['path'] != current['path']:
            result.pop('anchors', None)
            result['importWarnings'] = copy.deepcopy(incoming.get('importWarnings', []))
    old_stops = {stop_key(s): s for s in old['stops']}
    local_stops = {stop_key(s): clean_stop(s) for s in current['stops']}
    remote_stops = {stop_key(s): clean_stop(s) for s in incoming['stops']}
    if any(len(values) != len(stops) for values, stops in ((old_stops, old['stops']), (local_stops, current['stops']), (remote_stops, incoming['stops']))):
        raise ValueError('Hay identidades de paradero duplicadas sin ocurrencias distintas')
    stops = {}
    for key in sorted(old_stops.keys() | local_stops.keys() | remote_stops.keys()):
        before, local, remote = (values.get(key) for values in (old_stops, local_stops, remote_stops))
        prefix = f'stop:{key}'
        if before is None or local is None or remote is None:
            merged = merge(prefix, before, local, remote)
        else:
            merged = {field: merge(f'{prefix}.{field}', before.get(field), local.get(field), remote.get(field))
                      for field in before.keys() | local.keys() | remote.keys()}
        if merged is not None:
            stops[key] = merged
    before_order = [stop_key(s) for s in old['stops']]
    local_order = [stop_key(s) for s in current['stops']]
    remote_order = [stop_key(s) for s in incoming['stops']]
    order = merge('stops.order', before_order, local_order, remote_order)
    # Keep surviving additions from either side; positional validation catches an uncertain placement.
    order = list(dict.fromkeys(order + remote_order + local_order))
    result['stops'] = [stops[key] for key in order if key in stops]
    result['source'] = copy.deepcopy(incoming['source'])
    if not track_changed:
        result['source']['baseline']['path'] = copy.deepcopy(old['path'])
        result['source']['snapshotHash'] = digest({k: v for k, v in result['source'].items() if k not in ('snapshotHash', 'importWarnings')})
    result['review']['accepted'] = False
    result.pop('exported', None)
    unknown = set(choices) - used
    if unknown:
        raise ValueError('Decisión de conflicto desconocida: ' + ', '.join(sorted(unknown)))
    return {'route': result, 'conflicts': conflicts,
            'canApply': all(conflict['resolution'] for conflict in conflicts),
            'sourceChanged': current['source'].get('inputHash') != incoming['source'].get('inputHash'),
            'baseRevision': current['revision'], 'baseHash': digest(current)}
