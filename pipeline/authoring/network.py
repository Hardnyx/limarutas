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
    for key in ('bus', 'psv', 'motor_vehicle', 'vehicle', 'access'):
        value = tags.get(key)
        if value in ('no', 'private'):
            return False
        if value in ('yes', 'designated', 'permissive', 'destination', 'only'):
            return True
    return True


class Network:
    def __init__(self, data):
        if data.get('version') != 1 or not data.get('source', {}).get('sha256'):
            raise ValueError('Unsupported or unversioned street network')
        self.data = data
        self.id = 'osm:' + data['source']['sha256']
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
    edges, turns, unresolved = [], [], []
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
            one = tags.get('oneway:bus', tags.get('oneway:psv', tags.get('oneway')))
            if one is None and tags.get('junction') in ('roundabout', 'circular'):
                one = 'yes'
            aliases = [v.strip() for k in ('alt_name', 'official_name', 'short_name', 'name:es')
                       for v in tags.get(k, '').split(';') if v.strip()]
            conditional = {k: v for k, v in tags.items() if ':conditional' in k}
            for i, ((a, pa), (b, pb)) in enumerate(zip(pts, pts[1:])):
                if a == b or pa == pb:
                    continue
                edges.append({'id': f'{way.id}:{i}', 'way': way.id, 'nodes': [a, b],
                              'coordinates': [pa, pb], 'name': tags.get('name', ''), 'aliases': aliases,
                              'highway': tags['highway'], 'junction': tags.get('junction', ''), 'forward': one != '-1',
                              'backward': one not in ('yes', 'true', '1'), 'conditional': conditional})

        def relation(self, rel):
            tags = dict(rel.tags)
            if tags.get('type') != 'restriction':
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
    return {'version': 1, 'source': source, 'bbox': list(bbox), 'edges': edges,
            'turns': turns, 'unresolvedRestrictions': unresolved}


def save_network(path, output):
    data = from_pbf(path)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    lengths = sorted(metres(*edge['coordinates']) for edge in data['edges'])
    return {'source': data['source'], 'segments': len(lengths), 'turnRestrictions': len(data['turns']),
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
