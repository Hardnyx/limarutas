"""Editable route contract and geometry validation; coordinates are lon/lat."""
from __future__ import annotations

import copy
import hashlib
import json
import math

from .network import metres, profile_allows


def digest(value):
    # JSON/browser round trips turn 0.0 into 0. They represent the same coordinate.
    def normalized(item):
        if isinstance(item, dict):
            return {key: normalized(value) for key, value in item.items()}
        if isinstance(item, (list, tuple)):
            return [normalized(value) for value in item]
        if type(item) is float and math.isfinite(item) and item.is_integer():
            return int(item)
        return item
    return hashlib.sha256(json.dumps(normalized(value), ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def coordinate(value):
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValueError('Se requieren coordenadas [longitud, latitud]')
    if any(type(v) not in (int, float) or not math.isfinite(v) for v in value):
        raise ValueError('Las coordenadas deben ser números finitos')
    if not -180 <= value[0] <= 180 or not -90 <= value[1] <= 90:
        raise ValueError('Coordenadas fuera del rango geográfico')
    return list(value)


def new_route(route_id, name, direction, network, source=None):
    if not all(isinstance(v, str) and v.strip() for v in (route_id, name, direction)):
        raise ValueError('La ruta requiere identificador, nombre y sentido')
    return {'version': 1, 'id': route_id, 'name': name, 'direction': direction,
            'network': network.id, 'revision': 0, 'path': [], 'stops': [],
            'source': copy.deepcopy(source or {'kind': 'authored'}),
            'review': {'accepted': False, 'notes': ''}}


def path_parts(route, network):
    parts = []
    for item in route['path']:
        if item['type'] == 'street':
            parts.append(network.coordinates(item))
        elif item['type'] == 'gap':
            parts.append([coordinate(c) for c in item['coordinates']])
        else:
            raise ValueError('Tipo de tramo desconocido')
    return parts


def geometry(route, network):
    points = []
    for part in path_parts(route, network):
        for point in part:
            if not points or point != points[-1]:
                points.append(point)
    return points


def projection(point, a, b):
    lat = math.radians(point[1])
    sx, sy = 111320 * math.cos(lat), 110574
    ax, ay = (a[0] - point[0]) * sx, (a[1] - point[1]) * sy
    dx, dy = (b[0] - a[0]) * sx, (b[1] - a[1]) * sy
    t = max(0, min(1, -(ax*dx + ay*dy) / (dx*dx + dy*dy))) if dx or dy else 0
    projected = [a[0] + t*(b[0]-a[0]), a[1] + t*(b[1]-a[1])]
    return t, metres(point, projected), projected


def attach_stops(route, network, radius=80):
    """Choose an ordered sequence of projections, including repeated visits."""
    route = copy.deepcopy(route)
    segments, acc = [], 0
    for index, part in enumerate(path_parts(route, network)):
        for a, b in zip(part, part[1:]):
            length = metres(a, b)
            segments.append((index, a, b, acc, length))
            acc += length
    layers = []
    for stop in route['stops']:
        point = coordinate(stop['coordinates'])
        choices = []
        for index, a, b, base, length in segments:
            t, distance, projected = projection(point, a, b)
            if distance <= radius:
                choices.append({'pathIndex': index, 'fraction': t, 'distanceM': round(distance, 2),
                                'alongM': round(base + t*length, 3), 'coordinates': projected})
        choices.sort(key=lambda c: (c['distanceM'], c['alongM']))
        # Ordering must not move a stop to a substantially farther section just to pass validation.
        if choices:
            best = choices[0]['distanceM']
            choices = [c for c in choices if c['distanceM'] <= best + 3]
        layers.append(choices[:30])
    # Missing or inconsistent projections are explicit; source locations never move.
    if not layers or any(not layer for layer in layers):
        for stop, layer in zip(route['stops'], layers):
            stop['position'] = min(layer, key=lambda c: c['distanceM']) if layer else None
        return route
    costs = {i: (c['distanceM'] ** 2, [i]) for i, c in enumerate(layers[0])}
    for n, layer in enumerate(layers[1:], 1):
        next_costs = {}
        for j, current in enumerate(layer):
            candidates = [(cost + current['distanceM'] ** 2, history + [j])
                          for i, (cost, history) in costs.items()
                          if layers[n-1][i]['alongM'] <= current['alongM']]
            if candidates:
                next_costs[j] = min(candidates, key=lambda item: item[0])
        costs = next_costs
        if not costs:
            break
    if costs:
        history = min(costs.values(), key=lambda item: item[0])[1]
        for stop, layer, index in zip(route['stops'], layers, history):
            stop['position'] = layer[index]
    else:
        for stop, layer in zip(route['stops'], layers):
            stop['position'] = min(layer, key=lambda c: c['distanceM'])
    return route


def validate(route, network):
    if route.get('version') != 1:
        raise ValueError('Versión de recorrido no compatible')
    if route.get('network') != network.id:
        raise ValueError('La ruta pertenece a otra versión de OSM; requiere migración explícita')
    if not all(isinstance(route.get(k), str) and route[k].strip() for k in ('id', 'name', 'direction')):
        raise ValueError('Identidad de ruta incompleta')
    if type(route.get('revision')) is not int or route['revision'] < 0:
        raise ValueError('Revisión de ruta inválida')
    issues = [{'code': 'sourceReview', 'message': warning}
              for warning in route.get('importWarnings', route.get('source', {}).get('importWarnings', []))]
    previous, incoming, current_node, distance = None, None, None, 0
    used_ways = set()
    for i, item in enumerate(route['path']):
        if item.get('type') == 'street':
            if item.get('edge') not in network.edges:
                raise ValueError(f'Tramo inexistente: {item.get("edge")}')
            start, end = item.get('start', 0), item.get('end', 1)
            if any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in (start, end)) or start == end:
                raise ValueError('Fracciones de tramo inválidas')
            edge = network.edges[item['edge']]
            used_ways.add(edge['way'])
            if not profile_allows(edge, route.get('profile')):
                issues.append({'code': 'reservedRoad', 'pathIndex': i,
                               'message': 'Calzada reservada ajena al perfil de este servicio'})
            if not edge['forward' if end > start else 'backward']:
                issues.append({'code': 'wrongDirection', 'pathIndex': i, 'message': 'Tramo contra el sentido permitido'})
            entry_node = edge['nodes'][0 if end > start else 1] if start in (0, 1) else None
            if i and route['path'][i-1]['type'] == 'street':
                before = route['path'][i-1]
                same_segment = before['edge'] == item['edge'] and abs(before.get('end', 1)-start) < 1e-9
                if not same_segment and (current_node is None or entry_node is None or current_node != entry_node):
                    issues.append({'code': 'topologyGap', 'pathIndex': i,
                                   'message': 'Los tramos se acercan en el mapa pero no conectan en la red OSM'})
            if current_node is not None and entry_node == current_node and not network.turn_allowed(current_node, incoming, item['edge']):
                issues.append({'code': 'restrictedTurn', 'pathIndex': i, 'message': 'Giro restringido para buses'})
            current_node = edge['nodes'][1 if end > start else 0] if end in (0, 1) else None
            incoming = item['edge']
            if edge.get('conditional'):
                issues.append({'code': 'conditionalAccess', 'pathIndex': i, 'message': 'Acceso condicional pendiente de revisión'})
            part = network.coordinates(item)
        elif item.get('type') == 'gap':
            part = [coordinate(c) for c in item['coordinates']]
            if len(part) < 2:
                raise ValueError('Tramo pendiente sin geometría suficiente')
            issues.append({'code': 'unmatched', 'pathIndex': i, 'message': item.get('reason', 'Tramo sin resolver en la red')})
            incoming, current_node = None, None
        else:
            raise ValueError('Tipo de tramo desconocido')
        if previous is not None and metres(previous, part[0]) > 1:
            issues.append({'code': 'disconnected', 'pathIndex': i, 'message': 'El recorrido contiene una discontinuidad'})
        previous = part[-1]
        distance += sum(metres(a, b) for a, b in zip(part, part[1:]))
    for restriction in network.data.get('unresolvedRestrictions', []):
        if used_ways & set(restriction['ways']):
            issues.append({'code': 'unsupportedRestriction', 'relation': restriction['relation'],
                           'message': 'Restricción OSM pendiente de interpretación'})
    if distance < 1:
        issues.append({'code': 'empty', 'message': 'Falta construir el recorrido'})
    ids, last = set(), -1
    for stop in route['stops']:
        coordinate(stop['coordinates'])
        if not isinstance(stop.get('id'), str) or not stop['id'] or not isinstance(stop.get('name'), str) or not stop['name'].strip():
            raise ValueError('Paradero sin identidad o nombre')
        occurrence = (stop['id'], stop.get('occurrence', 1))
        if type(occurrence[1]) is not int or occurrence[1] < 1:
            raise ValueError('El número de visita del paradero debe ser un entero positivo')
        if occurrence in ids:
            raise ValueError('Paradero repetido sin número de visita distinto')
        ids.add(occurrence)
        pos = stop.get('position')
        if not pos:
            issues.append({'code': 'stopOffRoute', 'stop': stop['id'], 'message': 'Paradero sin vínculo con el recorrido'})
        elif pos['alongM'] < last:
            issues.append({'code': 'stopOrder', 'stop': stop['id'], 'message': 'Paraderos fuera de orden sobre el recorrido'})
        else:
            last = pos['alongM']
    if len(route['stops']) < 2:
        issues.append({'code': 'missingStops', 'message': 'Se requieren al menos dos paraderos'})
    return {'issues': issues, 'distanceM': round(distance, 2), 'ready': not issues,
            'accepted': not issues and route.get('review', {}).get('accepted') is True}
