"""One JSON operation boundary shared by command-line and HTTP clients."""
from __future__ import annotations

import copy
import json
import threading
from pathlib import Path

from .engine import Engine
from .exporter import bundle
from .importer import import_bundle, import_existing, track_coordinates
from .model import attach_stops, digest, geometry, new_route, path_parts, validate
from .reconcile import propose
from .network import Network
from .resolver import Resolver
from .store import Store


class Service:
    def __init__(self, network, root, workspace):
        self.network, self.root = network, Path(root).resolve()
        self.engine = Engine(network)
        self.resolver = Resolver.from_repository(self.engine, self.root)
        self.store = Store(Path(workspace) / 'routes')
        self.lock = threading.RLock()
        catalog = self.root / 'pipeline/output/wr_map.json'
        self.catalog = json.loads(catalog.read_text())['routes'] if catalog.exists() else {}

    def pack(self, route):
        route = attach_stops(route, self.network)
        segments = []
        for index, (ref, points) in enumerate(zip(route['path'], path_parts(route, self.network))):
            edge = self.network.edges.get(ref.get('edge'), {})
            segments.append({'index': index, 'type': ref['type'], 'coordinates': points,
                             'name': edge.get('name', ''), 'facility': edge.get('facility', 'mixed')})
        return {'route': route, 'validation': validate(route, self.network),
                'coordinates': geometry(route, self.network), 'segments': segments}

    def call(self, request):
        if not isinstance(request, dict):
            raise ValueError('La solicitud debe ser un objeto JSON')
        with self.lock:
            return {'version': 1, 'result': self._call(request)}

    def _call(self, request):
        operation = request.get('operation')
        if operation == 'health':
            return {'network': self.network.id, 'source': self.network.data['source'],
                    'segments': len(self.network.edges), 'workspace': 'isolated-drafts'}
        if operation == 'catalog':
            query = request.get('query', '').casefold()
            return {'published': [{'id': key, 'name': v.get('name', key)} for key, v in self.catalog.items()
                                  if query in (key + ' ' + v.get('name', '')).casefold()][:100], 'drafts': self.store.list()}
        if operation == 'streets':
            edges, truncated = self.network.viewport(request['bbox'])
            return {'edges': edges, 'truncated': truncated}
        if operation == 'resolve':
            return {'candidates': self.resolver.resolve(request['query'])}
        if operation == 'import-existing':
            return self.pack(import_existing(self.root, request['routeId'], self.engine))
        if operation == 'import':
            data = request['bundle']
            return self.pack(import_bundle(self.engine, data['id'], data['name'], data['direction'],
                                          data['track'], data['stops'], data.get('vias'), data.get('matched'),
                                          data.get('corrections'), data.get('provenance')))
        if operation == 'new':
            route = new_route(request['id'], request['name'], request['direction'], self.network)
            route['profile'] = copy.deepcopy(request.get('profile', {'mode': 'mixed'}))
            return self.pack(route)
        if operation == 'build':
            return self.pack(self.engine.build(self.resolver.build_request(request['request'])))
        if operation == 'get':
            return self.pack(self.store.get(request['routeId']))
        if operation == 'restore':
            route = copy.deepcopy(request['route'])
            if self.store.path(route['id']).exists():
                raise ValueError('Ya existe un borrador con este identificador; ábrelo desde el catálogo')
            route.pop('exported', None)
            route['revision'], route['review']['accepted'] = 0, False
            return self.pack(route)
        if operation in ('propose-update', 'apply-update'):
            # Always read the saved revision; callers cannot forge a proposal or its new source.
            current = self.store.get(request['routeId'])
            data = request['bundle']
            incoming = import_bundle(self.engine, data['id'], data['name'], data['direction'],
                                     data['track'], data['stops'], data.get('vias'), data.get('matched'),
                                     data.get('corrections'), data.get('provenance'))
            proposal = propose(current, incoming, request.get('choices'))
            if operation == 'propose-update':
                return {**proposal, 'proposalHash': digest(proposal), 'preview': self.pack(proposal['route'])}
            if not proposal['canApply']:
                raise ValueError('Resuelve los conflictos de la actualización antes de aplicarla')
            if request.get('proposalHash') != digest(proposal):
                from .store import RevisionConflict
                raise RevisionConflict('La propuesta cambió; vuelve a revisarla antes de aplicar')
            packed = self.pack(proposal['route'])
            saved = self.store.save(packed['route'], request['expectedRevision'], source_update=True)
            return self.pack(saved)
        if operation in ('match', 'validate', 'save', 'accept', 'export', 'rebuild', 'replace'):
            route = copy.deepcopy(request['route']) if 'route' in request else self.store.get(request['routeId'])
            if operation == 'match':
                parts = track_coordinates(route['source']['track'])
                return self.pack(self.engine.match(route, [c for part in parts for c in part]))
            if operation == 'rebuild':
                specification = {'id': route['id'], 'name': route['name'], 'direction': route['direction'],
                                 'anchors': request['anchors'], 'stops': route['stops'], 'source': route['source'],
                                 'profile': route.get('profile', {'mode': 'mixed'}), **route.get('constraints', {})}
                rebuilt = self.engine.build(specification)
                rebuilt['revision'] = route['revision']
                return self.pack(rebuilt)
            if operation == 'replace':
                start, end = request['fromPathIndex'], request['toPathIndex']
                if type(start) is not int or type(end) is not int or not 0 <= start <= end < len(route['path']):
                    raise ValueError('Selecciona un intervalo válido del recorrido')
                first, last = route['path'][start], route['path'][end]
                if first['type'] != 'street' or last['type'] != 'street':
                    raise ValueError('Los extremos de la corrección deben estar sobre calles identificadas')
                anchors = [{'edge': first['edge'], 'fraction': first.get('start', 0)},
                           *request.get('viaAnchors', []),
                           {'edge': last['edge'], 'fraction': last.get('end', 1)}]
                path = []
                for a, b in zip(anchors, anchors[1:]):
                    path.extend(self.engine.connect(a, b, profile=route.get('profile')))
                route['path'][start:end+1] = path
                route['review']['accepted'] = False
                route.pop('anchors', None)
                return self.pack(route)
            if operation == 'validate':
                return self.pack(route)
            if operation == 'export':
                if not request.get('preview', False):
                    saved = self.store.get(route['id'])
                    if digest(saved) != digest(route) or not saved.get('review', {}).get('accepted'):
                        raise ValueError('Guarda y acepta esta revisión antes de exportarla para publicación')
                return bundle(route, self.network, request.get('preview', False), request.get('trip'))
            packed = self.pack(route)
            if operation == 'accept' and not packed['validation']['ready']:
                raise ValueError('Resuelve los avisos del recorrido antes de aceptarlo')
            saved = self.store.save(packed['route'], request['expectedRevision'], accept=operation == 'accept')
            return self.pack(saved)
        raise ValueError('Operación no compatible')


def load_service(network_file, root, workspace):
    return Service(Network(json.loads(Path(network_file).read_text())), root, workspace)
