"""Joint road projections and directed connections; no literal stop snapping."""
from __future__ import annotations
from .model import projection
from .network import metres


def directed_path(engine, points, identity, profile=None, leg_lengths=None, anchor_ways=None):
    """Choose road projections jointly; never insert the station/stop itself."""
    profile = profile or {'mode': 'mixed'}
    anchor_ways = anchor_ways or {}
    layers = []
    for point_index, point in enumerate(points):
        candidates, seen = [], set()
        for candidate in engine.candidates(point, 80):
            if point_index in anchor_ways and engine.network.edges[candidate['edge']]['way'] not in anchor_ways[point_index]:
                continue
            way = engine.network.edges[candidate['edge']]['way']
            if way not in seen:
                seen.add(way)
                candidates.append(candidate)
        if not candidates:
            raise ValueError(f'{identity}: punto sin calle del itinerario a menos de 80 m: {point}')
        layers.append(candidates[:6])
    states = [(c['distanceM']*3, [], {'edge': c['edge'], 'fraction': c['fraction']}) for c in layers[0]]
    for index, layer in enumerate(layers[1:], 1):
        following = []
        for candidate in layer:
            target = {'edge': candidate['edge'], 'fraction': candidate['fraction']}
            choices = []
            for cost, history, start in states:
                if start == target:
                    choices.append((cost+candidate['distanceM']*3, history, target))
                    continue
                try:
                    refs = engine.connect(start, target, incoming=history[-1]['edge'] if history else None,
                                          history=history, profile=profile)
                except ValueError:
                    continue
                length = sum(metres(*engine.network.coordinates(r)) for r in refs)
                limit = leg_lengths[index-1]*1.6+350 if leg_lengths else metres(points[index-1], points[index])*3+200
                if length > limit:
                    continue
                choices.append((cost+length+candidate['distanceM']*3, history+refs, target))
            if choices:
                following.append(min(choices, key=lambda item: item[0]))
        if not following:
            raise ValueError(f'{identity}: no hay una conexión legal continua en el paso {index}')
        states = following
    return min(states, key=lambda item: item[0])[1]



def guide_positions(points, stops):
    cumulative = [0.0]
    for a, b in zip(points, points[1:]):
        cumulative.append(cumulative[-1]+metres(a, b))
    positions = []
    for stop in stops:
        choices = []
        for i, (a, b) in enumerate(zip(points, points[1:])):
            fraction, distance, _ = projection(stop, a, b)
            along = cumulative[i]+fraction*metres(a, b)
            if not positions or along >= positions[-1]-5:
                choices.append((distance, along))
        if not choices:
            raise ValueError('La guía no conserva el orden de los paraderos')
        positions.append(min(choices)[1])
    return [max(100, b-a) for a, b in zip(positions, positions[1:])]


def guide_ways(network, points, radius=90, step=60):
    """Include both carriageways and real connectors along the source drawing."""
    ways = set()
    for a, b in zip(points, points[1:]):
        count = max(1, int(metres(a, b)/step))
        for i in range(count+1):
            point = [a[k]+(b[k]-a[k])*i/count for k in (0, 1)]
            for eid in network.near(point, radius):
                edge = network.edges[eid]
                if projection(point, *edge['coordinates'])[1] <= radius:
                    ways.add(edge['way'])
    return ways
