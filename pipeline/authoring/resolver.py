"""Resolve supplied place descriptions to actual OSM or source stop records."""
from __future__ import annotations

import copy
import json
from pathlib import Path

from .model import digest
from .network import normal


class AmbiguousPlace(ValueError):
    def __init__(self, message, candidates):
        super().__init__(message)
        self.candidates = candidates


class Resolver:
    def __init__(self, engine, stops=None):
        self.engine = engine
        self.network = engine.network
        self.stops = stops or []
        self.by_id = {s['id']: s for s in self.stops}

    @classmethod
    def from_repository(cls, engine, root):
        path = Path(root) / 'pipeline/output/wr_stops_index.json'
        stops = []
        if path.exists():
            raw = json.loads(path.read_text())
            for row in raw['stops']:
                name, lat, lon, folders = row[:4]
                stops.append({'id': 'catalog:' + digest([name, lon, lat])[:24], 'name': name,
                              'coordinates': [lon, lat], 'district': row[4] if len(row) > 4 else '',
                              'aliases': [str(v) for v in row[5:] if isinstance(v, str) and v],
                              'folders': [raw['routes'][i] for i in folders],
                              'evidence': {'kind': 'wr_stops_index', 'source': path.relative_to(root).as_posix()}})
        return cls(engine, stops)

    def resolve(self, request):
        kind = request.get('kind')
        if kind == 'street':
            query = request.get('query', '')
            if len(query.strip()) < 2:
                raise ValueError('Escribe al menos dos caracteres de la calle')
            return self.network.streets(query)
        if kind == 'intersection':
            a, b = request.get('streets', [None, None])
            if not a or not b or normal(a) == normal(b):
                raise ValueError('Indica dos calles distintas para el cruce')
            def nodes(query):
                return {node for street in self.network.streets(query) for eid in street['edges']
                        for node in self.network.edges[eid]['nodes']}
            shared = nodes(a) & nodes(b)
            return [{'node': node, 'coordinates': self.network.nodes[node], 'name': f'{a} con {b}',
                     'evidence': {'kind': 'osm-intersection', 'network': self.network.id}}
                    for node in sorted(shared)]
        if kind == 'point':
            return self.engine.candidates(request['coordinates'])
        if kind == 'stop':
            key = normal(request.get('query', ''))
            if len(key) < 2:
                raise ValueError('Escribe al menos dos caracteres del paradero')
            result = [s for s in self.stops if any(key in normal(value) for value in [s['name'], *s.get('aliases', [])])]
            if request.get('folder'):
                result = [s for s in result if str(request['folder']) in s.get('folders', [])]
            if request.get('district'):
                result = [s for s in result if normal(request['district']) in normal(s.get('district', ''))]
            return copy.deepcopy(result[:100])
        raise ValueError('Consulta no compatible: street, intersection, point o stop')

    def build_request(self, request):
        request = copy.deepcopy(request)
        anchors = []
        for anchor in request.get('anchors', []):
            if 'intersection' in anchor:
                candidates = self.resolve({'kind': 'intersection', 'streets': anchor['intersection']})
                if 'choice' in anchor:
                    candidates = [c for c in candidates if c['node'] == anchor['choice']]
                if not candidates:
                    raise ValueError('No se encontró el cruce indicado en la red OSM')
                if len(candidates) != 1:
                    raise AmbiguousPlace('El cruce tiene varias posiciones; selecciona la calzada', candidates)
                anchors.append({'node': candidates[0]['node'], 'evidence': candidates[0]['evidence']})
            else:
                anchors.append(anchor)
        request['anchors'] = anchors
        for i, stop in enumerate(request.get('stops', [])):
            if 'catalogId' in stop:
                if stop['catalogId'] not in self.by_id:
                    raise ValueError('Paradero de catálogo inexistente')
                resolved = copy.deepcopy(self.by_id[stop['catalogId']])
                resolved['occurrence'] = stop.get('occurrence', 1)
                request['stops'][i] = resolved
            elif 'node' in stop:
                if stop['node'] not in self.network.nodes:
                    raise ValueError('Nodo del paradero inexistente')
                stop['coordinates'] = list(self.network.nodes[stop['node']])
                stop['evidence'] = {'kind': 'supplied-osm-node', 'network': self.network.id, 'node': stop['node']}
        return request
