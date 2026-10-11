import copy
import json
import tempfile
import unittest
from pathlib import Path

from pipeline.authoring.engine import Engine
from pipeline.authoring.feeders import build, directed_path, rebuild
from pipeline.authoring.model import geometry, validate
from pipeline.authoring.native import import_native
from pipeline.authoring.network import Network
from pipeline.scripts.trips.build_trip_graph import update_feeder_routes


def feeder_fixture():
    nodes = {1: [-77, -12], 2: [-76.999, -12], 3: [-76.998, -12],
             4: [-76.998, -12.0002], 5: [-76.9978, -12.0002], 6: [-76.9978, -12],
             7: [-76.997, -12.0002], 8: [-76.997, -12.0004], 9: [-76.999, -12.0003]}
    pairs = [(1, 2, 1), (2, 3, 1), (3, 4, 2), (4, 5, 2), (5, 6, 2), (6, 3, 2),
             (5, 7, 3), (7, 8, 4), (8, 5, 4), (3, 9, 5), (9, 1, 5)]
    edges, counts = [], {}
    for a, b, way in pairs:
        index = counts.get(way, 0)
        counts[way] = index+1
        edges.append({'id': f'{way}:{index}', 'way': way, 'nodes': [a, b],
                      'coordinates': [nodes[a], nodes[b]], 'name': f'Vía {way}',
                      'forward': True, 'backward': False, 'junction': 'roundabout' if way == 2 else ''})
    net = Network({'version': 1, 'source': {'sha256': 'fixture', 'timestamp': '2026-10-02'},
                   'bbox': [-77.01, -12.01, -76.99, -11.99], 'edges': edges})
    def direction(ids, stop_ids):
        return {'coords': [list(reversed(nodes[n])) for n in ids], 'to': 'Destino', 'horario': '05:00-23:00',
                'stops': [{'id': 'met:terminal' if n == 1 else f'alim:{n}', 'name': f'Paradero {n}',
                           'lat': nodes[n][1], 'lon': nodes[n][0], 'at': i, 'm': i*100}
                          for i, n in enumerate(stop_ids)]}
    # Both legacy half-rings are backwards, as in the reported feeder.
    service = {'terminal': 'terminal', 'loop': True, 'name': 'Alimentador de prueba',
               'ida': direction([1, 2, 3, 6, 5, 7], [1, 2, 7]),
               'vuelta': direction([7, 8, 5, 4, 3, 9, 1], [7, 9, 1])}
    return net, service, [{'relation': 20, 'ways': [1, 2, 3, 4, 5]}]


class DirectedFeedersTest(unittest.TestCase):
    def test_graph_refresh_preserves_shared_station_and_other_routes(self):
        _, service, _ = feeder_fixture()
        rows, positions = [], {}
        routes = {}
        for direction in ('ida', 'vuelta'):
            seq = []
            for s in service[direction]['stops']:
                if s['id'] not in positions:
                    positions[s['id']] = len(rows)
                    rows.append([s['lat'], s['lon'], s['name'], 0])
                seq.append(positions[s['id']])
            routes[f'alim:AS-04:{direction}'] = seq
        terminal = positions['met:terminal']
        routes['met:B:ns'] = [terminal, len(rows)]
        rows.append([-12.001, -77.002, 'Otra estación', 0])
        graph = {'stops': rows, 'routes': routes, 'segM': {'met:B:ns': [200]}, 'headway': {'other': 5}}
        graph['stops'][positions['alim:2']][0] += .00001
        before = copy.deepcopy(graph)
        self.assertEqual(update_feeder_routes(graph, {'AS-04': service}, ['AS-04']), 2)
        self.assertEqual(graph['routes'], before['routes'])
        self.assertEqual(graph['headway'], before['headway'])
        self.assertEqual(graph['segM']['met:B:ns'], [200])
        self.assertEqual(graph['stops'][terminal], before['stops'][terminal])
        self.assertEqual(graph['stops'][positions['alim:2']][:2], [-12, -76.999])
        before = copy.deepcopy(graph)
        moved = copy.deepcopy(service)
        moved['ida']['stops'][0]['lat'] += .001
        with self.assertRaises(ValueError):
            update_feeder_routes(graph, {'AS-04': moved}, ['AS-04'])
        self.assertEqual(graph, before)

    def test_distance_only_sync_preserves_existing_stop_coordinates(self):
        _, service, _ = feeder_fixture()
        stops, routes = [], {}
        for d in ('ida', 'vuelta'):
            routes[f'alim:AS-04:{d}'] = []
            for stop in service[d]['stops']:
                routes[f'alim:AS-04:{d}'].append(len(stops))
                stops.append([round(stop['lat'], 6), round(stop['lon'], 6), stop['name'], 0])
        stops[1][0] += .00001
        graph = {'stops': stops, 'routes': routes, 'segM': {}}
        original = copy.deepcopy(stops)
        update_feeder_routes(graph, {'AS-04': service}, ['AS-04'], preserve_positions=True)
        self.assertEqual(graph['stops'], original)
        self.assertEqual(graph['segM']['alim:AS-04:ida'], [100, 100])

    def test_both_directions_follow_one_way_ring_and_keep_split_and_stops(self):
        net, service, evidence = feeder_fixture()
        result = rebuild(service, 'AS-04', net, evidence)
        for direction, ring in [('ida', ['2:0', '2:1']), ('vuelta', ['2:2', '2:3'])]:
            item = result[direction]
            self.assertEqual([r['edge'] for r in item['pathReferences'] if r['edge'].startswith('2:')], ring)
            self.assertTrue(all(r['end'] > r['start'] for r in item['pathReferences']))
            self.assertEqual(item['horario'], service[direction]['horario'])
            self.assertEqual([{k:v for k,v in s.items() if k not in ('at', 'm')} for s in item['stops']],
                             [{k:v for k,v in s.items() if k not in ('at', 'm')} for s in service[direction]['stops']])
        self.assertEqual(result['ida']['coords'][-1], result['vuelta']['coords'][0])
        self.assertEqual(result['ida']['coords'][-1], service['ida']['coords'][-1])

    def test_cannot_reverse_even_with_only_one_nearby_carriageway(self):
        net, _, _ = feeder_fixture()
        isolated = Network({**net.data, 'edges': [net.edges['1:0']]})
        with self.assertRaises(ValueError):
            directed_path(Engine(isolated), [isolated.nodes[2], isolated.nodes[1]], 'wrong-way')

    def test_verified_references_import_exactly_and_corruption_is_rejected(self):
        net, service, evidence = feeder_fixture()
        result = rebuild(service, 'AS-04', net, evidence)
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)/'data/processed/metropolitano'
            folder.mkdir(parents=True)
            file = folder/'alimentadores_paths.json'
            file.write_text(json.dumps({'services': {'AS-04': result}}))
            route = import_native(root, 'alim:AS-04:ida', Engine(net))
            self.assertTrue(validate(route, net)['ready'])
            self.assertEqual(geometry(route, net), [list(reversed(p)) for p in result['ida']['coords']])
            result['ida']['coords'][1][0] += .001
            file.write_text(json.dumps({'services': {'AS-04': result}}))
            with self.assertRaises(ValueError):
                import_native(root, 'alim:AS-04:ida', Engine(net))

    def test_preflight_does_not_mutate_source_if_another_route_is_blocked(self):
        net, service, evidence = feeder_fixture()
        source = {'services': {'AS-04': service}}
        before = copy.deepcopy(source)
        with self.assertRaises(ValueError):
            build(source, ['AS-04', 'missing'], net, {'AS-04': evidence})
        self.assertEqual(source, before)
