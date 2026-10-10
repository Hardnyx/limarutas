"""Versioned OSM street geometry, independent of the legacy matcher's policy."""
from __future__ import annotations

import hashlib
import json
import math
import unicodedata
from collections import defaultdict
from pathlib import Path

HIGHWAYS = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified',
            'residential', 'living_street', 'service', 'busway', 'bus_guideway'}
HIGHWAYS |= {h + '_link' for h in ('motorway', 'trunk', 'primary', 'secondary', 'tertiary')}
POLICY = 'bus-v3'


def normal(value):
    text = ''.join(c for c in unicodedata.normalize('NFD', str(value)).lower()
                   if not unicodedata.combining(c))
    return ' '.join(text.replace('avenida', 'av').replace('av.', 'av').split())


def metres(a, b):
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((a[0] - b[0]) * 111320 * math.cos(lat), (a[1] - b[1]) * 110574)


def bus_access(tags):
    if tags.get('highway') not in HIGHWAYS or tags.get('area') == 'yes':
        return False
    if tags['highway'] in ('busway', 'bus_guideway') and 'bus' not in tags:
        tags = {**tags, 'bus': 'designated'}
    for key in ('bus', 'psv', 'motor_vehicle', 'vehicle', 'access'):
        value = tags.get(key)
        if value in ('no', 'private'):
            return False
        if value in ('yes', 'designated', 'permissive', 'destination', 'only'):
            return True
    return True


def facility(tags):
    lane_tags = {k: v for k, v in tags.items()
                 if k.startswith(('busway', 'bus:lanes', 'psv:lanes', 'lanes:bus', 'lanes:psv'))
                 or k in ('lanes', 'width', 'motor_vehicle:lanes', 'vehicle:lanes')}
    if tags.get('highway') in ('busway', 'bus_guideway'):
        kind = 'separate_busway'
    elif tags.get('psv') == 'only' or (any(tags.get(k) in ('no', 'private') for k in ('access', 'vehicle', 'motor_vehicle'))
                                    and any(tags.get(k) in ('yes', 'designated', 'only') for k in ('bus', 'psv'))):
        kind = 'restricted_bus_road'
    elif any((k.startswith('busway') and v not in ('no', 'none', 'separate'))
             or (k.startswith(('bus:lanes', 'psv:lanes')) and any(p in ('designated', 'only') for p in v.split('|')))
             or (k.startswith(('lanes:bus', 'lanes:psv')) and v.isdigit() and int(v) > 0)
             for k, v in lane_tags.items()):
        kind = 'bus_lane'
    else:
        kind = 'mixed'
    return kind, lane_tags


def bus_directions(tags):
    one = tags.get('oneway:bus', tags.get('oneway:psv', tags.get('oneway')))
    if one is None and (tags.get('junction') in ('roundabout', 'circular') or tags.get('highway') == 'motorway'):
        one = 'yes'
    forward, backward = one != '-1', one not in ('yes', 'true', '1')
    # Lane tags authorize contraflow only when no more specific one-way override exists.
    if not any(key in tags for key in ('oneway:bus', 'oneway:psv')):
        if any(value.startswith('opposite') for key, value in tags.items() if key.startswith('busway')):
            backward = True
        if any(v in ('yes', 'designated', 'only') for v in tags.get('bus:lanes:backward', tags.get('psv:lanes:backward', '')).split('|')):
            backward = True
        if any(tags.get(key, '0').isdigit() and int(tags.get(key, '0')) > 0 for key in ('lanes:bus:backward', 'lanes:psv:backward')):
            backward = True
    if tags.get('bus:forward') == 'no':
        forward = False
    if tags.get('bus:backward') == 'no':
        backward = False
    return forward, backward


def profile_allows(edge, profile=None):
    profile = profile or {'mode': 'mixed'}
    if edge.get('facility', 'mixed') not in ('separate_busway', 'restricted_bus_road'):
        return True
    if edge['way'] in profile.get('reservedWays', []):
        return True
    system = normal(profile.get('system', ''))
    return (profile.get('mode') in ('brt', 'corridor') and bool(system)
            and system in {normal(edge['name']), *[normal(v) for v in edge.get('transitSystems', [])]})


class Network:
    def __init__(self, data):
        if data.get('version') != 1 or not data.get('source', {}).get('sha256'):
            raise ValueError('Unsupported or unversioned street network')
        self.data = data
        self.id = 'osm:' + data['source']['sha256'] + ':' + data.get('policy', 'fixture')
        self.edges = {e['id']: e for e in data['edges']}
        self.nodes, self.adj, self.grid = {}, defaultdict(list), defaultdict(list)
        self.ways, self.names = defaultdict(list), defaultdict(set)
        for edge in self.edges.values():
            a, b = edge['nodes']
            self.nodes[a], self.nodes[b] = edge['coordinates']
            self.ways[edge['way']].append(edge['id'])
            for name in [edge['name'], *edge.get('aliases', [])]:
                if name:
                    self.names[normal(name)].add(edge['way'])
            if edge['forward']:
                self.adj[a].append((b, edge['id'], 1))
            if edge['backward']:
                self.adj[b].append((a, edge['id'], -1))
            c, d = edge['coordinates']
            # Each segment enters every intersected grid cell, including long straight ways.
            for x in range(math.floor(min(c[0], d[0]) * 1000), math.floor(max(c[0], d[0]) * 1000) + 1):
                for y in range(math.floor(min(c[1], d[1]) * 1000), math.floor(max(c[1], d[1]) * 1000) + 1):
                    self.grid[x, y].append(edge['id'])
        self.turns = defaultdict(list)
        for turn in data.get('turns', []):
            self.turns[turn['via']].append(turn)

    def coordinates(self, ref):
        edge = self.edges[ref['edge']]
        a, b = edge['coordinates']
        start, end = ref.get('start', 0), ref.get('end', 1)
        def point(t):
            if t == 0:
                return list(a)
            if t == 1:
                return list(b)
            return [round(a[i] + t * (b[i] - a[i]), 7) for i in (0, 1)]
        return [point(start), point(end)]

    def near(self, point, radius=50):
        cx, cy = (math.floor(v * 1000) for v in point)
        k = max(1, math.ceil(radius / 100))
        return {eid for x in range(cx - k, cx + k + 1) for y in range(cy - k, cy + k + 1)
                for eid in self.grid.get((x, y), [])}

    def turn_allowed(self, node, incoming, outgoing):
        if not incoming:
            return True
        a, b = self.edges[incoming], self.edges[outgoing]
        for turn in self.turns.get(node, []):
            if a['way'] != turn['from']:
                continue
            kind = turn['kind']
            if kind.startswith('only_') and b['way'] != turn['to']:
                return False
            if kind.startswith('no_') and b['way'] == turn['to']:
                if kind == 'no_u_turn' and turn['from'] == turn['to']:
                    if incoming == outgoing:
                        return False
                else:
                    return False
        return True

    def streets(self, query):
        key = normal(query)
        exact = self.names.get(key)
        names = [(key, exact)] if exact else [(name, ways) for name, ways in self.names.items() if key in name]
        result = {}
        for _, ways in names:
            for way in ways:
                edge = self.edges[self.ways[way][0]]
                result[way] = {'way': way, 'name': edge['name'], 'edges': self.ways[way]}
        return list(result.values())

    def viewport(self, bbox, limit=2500):
        w, s, e, n = bbox
        if e < w or n < s or e - w > .08 or n - s > .08:
            raise ValueError('Acerca el mapa para consultar las calles')
        ids = {eid for x in range(math.floor(w * 1000), math.floor(e * 1000) + 1)
               for y in range(math.floor(s * 1000), math.floor(n * 1000) + 1)
               for eid in self.grid.get((x, y), [])}
        return [self.edges[eid] for eid in sorted(ids)[:limit]], len(ids) > limit


def from_pbf(path, bbox=(-77.26, -12.42, -76.56, -11.70)):
    import osmium
    path = Path(path)
    source = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size,
              'url': 'https://download.bbbike.org/osm/bbbike/Lima/Lima.osm.pbf',
              'attribution': '© OpenStreetMap contributors', 'license': 'ODbL-1.0'}
    edges, turns, unresolved, transit = [], [], [], defaultdict(set)
    w, s, e, n = bbox

    class Handler(osmium.SimpleHandler):
        def way(self, way):
            tags = dict(way.tags)
            if not bus_access(tags):
                return
            try:
                pts = [(p.ref, [p.lon, p.lat]) for p in way.nodes]
            except osmium.InvalidLocationError:
                return
            if not any(w <= p[0] <= e and s <= p[1] <= n for _, p in pts):
                return
            forward, backward = bus_directions(tags)
            aliases = [v.strip() for k in ('alt_name', 'official_name', 'short_name', 'name:es')
                       for v in tags.get(k, '').split(';') if v.strip()]
            conditional = {k: v for k, v in tags.items() if ':conditional' in k}
            kind, lane_tags = facility(tags)
            for i, ((a, pa), (b, pb)) in enumerate(zip(pts, pts[1:])):
                if a == b or pa == pb:
                    continue
                edges.append({'id': f'{way.id}:{i}', 'way': way.id, 'nodes': [a, b],
                              'coordinates': [pa, pb], 'name': tags.get('name', ''), 'aliases': aliases,
                              'highway': tags['highway'], 'junction': tags.get('junction', ''), 'forward': forward,
                              'backward': backward, 'conditional': conditional,
                              'facility': kind, 'laneTags': lane_tags,
                              'layer': tags.get('layer', '0'), 'bridge': tags.get('bridge', ''),
                              'tunnel': tags.get('tunnel', '')})

        def relation(self, rel):
            tags = dict(rel.tags)
            if tags.get('type') == 'route' and tags.get('route') in ('bus', 'trolleybus'):
                system = tags.get('network') or tags.get('operator') or ''
                if system:
                    for member in rel.members:
                        if member.type == 'w':
                            transit[member.ref].add(system)
            if tags.get('type') != 'restriction':
                return
            if not any(k in tags for k in ('restriction', 'restriction:bus', 'restriction:psv',
                                           'restriction:conditional', 'restriction:bus:conditional', 'restriction:psv:conditional')):
                return
            specific = tags.get('restriction:bus', tags.get('restriction:psv'))
            if specific is None and {'bus', 'psv'} & set(tags.get('except', '').split(';')):
                return
            kind = specific or tags.get('restriction')
            members = {role: [m for m in rel.members if m.role == role] for role in ('from', 'via', 'to')}
            if not all(len(members[role]) == 1 for role in members):
                unresolved.append({'relation': rel.id, 'ways': [m.ref for m in rel.members if m.type == 'w']})
                return
            a, via, b = (members[role][0] for role in ('from', 'via', 'to'))
            if via.type != 'n' or any(':conditional' in k for k in tags) or not kind:
                unresolved.append({'relation': rel.id, 'ways': [m.ref for m in rel.members if m.type == 'w']})
            else:
                turns.append({'relation': rel.id, 'from': a.ref, 'via': via.ref, 'to': b.ref, 'kind': kind})

    Handler().apply_file(str(path), locations=True)
    reader = osmium.io.Reader(str(path), osmium.osm.osm_entity_bits.NOTHING)
    source['timestamp'] = reader.header().get('osmosis_replication_timestamp') or ''
    reader.close()
    for edge in edges:
        edge['transitSystems'] = sorted(transit.get(edge['way'], []))
    return {'version': 1, 'policy': POLICY, 'source': source, 'bbox': list(bbox), 'edges': edges,
            'turns': turns, 'unresolvedRestrictions': unresolved}


def save_network(path, output):
    data = from_pbf(path)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    lengths = sorted(metres(*edge['coordinates']) for edge in data['edges'])
    from collections import Counter
    return {'source': data['source'], 'policy': data['policy'], 'segments': len(lengths), 'turnRestrictions': len(data['turns']),
            'facilities': dict(Counter(edge['facility'] for edge in data['edges'])),
            'unresolvedRestrictions': len(data['unresolvedRestrictions']),
            'segmentLengthM': {'median': round(lengths[len(lengths)//2], 2),
                               'p95': round(lengths[int(len(lengths)*.95)], 2), 'max': round(lengths[-1], 2)}}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pbf', default='data/raw/osm/Lima.osm.pbf')
    parser.add_argument('--output', default='pipeline/temp/authoring/network.json')
    parser.add_argument('--report', default='pipeline/temp/authoring/network-report.json')
    args = parser.parse_args()
    report = save_network(args.pbf, args.output)
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))
