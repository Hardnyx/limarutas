import copy
import json
import tempfile
import unittest
from pathlib import Path

from pipeline.authoring.engine import Engine
from pipeline.authoring.model import attach_stops, geometry, new_route, validate
from pipeline.authoring.native import import_native
from pipeline.authoring.network import Network, profile_allows
from pipeline.authoring.terminals import build, name_tokens, refresh_instructions, verified_access


def fixture():
    nodes = {1: [-77, -12], 2: [-77, -12.001], 3: [-76.9998, -12.001],
             4: [-76.9998, -12], 5: [-76.9995, -11.9998], 6: [-76.999, -11.9998],
             7: [-76.9985, -11.9998], 8: [-76.9985, -11.9996], 9: [-77, -11.9996]}
    pairs = [(1, 2), (2, 3), (3, 4), (4, 5), (5, 6), (6, 7), (7, 8), (8, 9), (9, 1)]
    edges = []
    for index, (a, b) in enumerate(pairs):
        reserved = index in (0, 1, 2, 3, 8)
        edges.append({'id': f'{index+1}:0', 'way': index+1, 'nodes': [a, b],
                      'coordinates': [nodes[a], nodes[b]], 'name': 'Terminal' if reserved else 'Avenida',
                      'highway': 'service' if reserved else 'primary', 'forward': True, 'backward': False,
                      'facility': 'restricted_bus_road' if reserved else 'mixed', 'transitSystems': ['Metropolitano']})
    # Nearby trunk BRT must not become available through feeder permissions.
    edges.append({**edges[0], 'id': '90:0', 'way': 90, 'highway': 'busway', 'facility': 'separate_busway',
                  'nodes': [90, 91], 'coordinates': [[-77.0001, -12], [-77.0001, -12.001]]})
    net = Network({'version': 1, 'source': {'sha256': 'fixture', 'timestamp': '2026-10-02'},
                   'bbox': [-77.01, -12.01, -76.99, -11.99], 'edges': edges})
    station = {'id': 'terminal', 'name': 'Terminal', 'point': nodes[2]}
    def direction(ids, stops):
        return {'coords': [list(reversed(nodes[n])) for n in ids], 'horario': '05:00-23:00',
                'stops': [{'id': 'met:terminal' if n == 2 else 'alim:7', 'name': str(n),
                           'lat': nodes[n][1], 'lon': nodes[n][0], 'at': i, 'm': i*100}
                          for n, i in stops]}
    service = {'terminal': 'terminal', 'name': 'Alimentadora Norte Ejemplo (ida)',
               'ida': direction([2, 5, 6, 7], [(2, 0), (7, 3)]),
               'vuelta': direction([7, 8, 9, 2], [(7, 0), (2, 3)])}
    evidence = {'station': {'id': 100}, 'relations': [{'ways': [1, 2, 3, 4, 9]}],
                'platforms': [{'id': 200, 'point': nodes[1], 'tags': {'name': 'Terminal Ejemplo'}}]}
    return net, station, service, evidence


class TerminalAccessTest(unittest.TestCase):
    def test_internal_access_is_directed_while_stations_body_and_split_remain(self):
        net, station, service, evidence = fixture()
        # Six-decimal source rounding must enter the actual OSM junction,
        # rather than leave a fractional endpoint and a topology gap.
        service['ida']['coords'][2][0] += .0000001
        source = {'services': {'AN-01': service}}
        before = copy.deepcopy(source)
        result, report = build(source, 'terminal', station, net, evidence)
        refresh_instructions(result, report['internal'], net)
        self.assertEqual(source, before)
        self.assertEqual(report['internal'], ['AN-01'])
        rebuilt = result['services']['AN-01']
        self.assertEqual([r['edge'] for r in rebuilt['ida']['terminalAccess']['references']][:4],
                         ['1:0', '2:0', '3:0', '4:0'])
        for direction in ('ida', 'vuelta'):
            item = rebuilt[direction]
            refs, profile = verified_access(item, net)
            self.assertTrue(all(r['end'] > r['start'] for r in refs))
            self.assertFalse(profile_allows(net.edges['90:0'], profile))
            self.assertEqual(item['horario'], service[direction]['horario'])
            self.assertTrue(item['pasos'])
            self.assertEqual([{k: v for k, v in s.items() if k not in ('at', 'm')} for s in item['stops']],
                             [{k: v for k, v in s.items() if k not in ('at', 'm')} for s in service[direction]['stops']])
        self.assertEqual(rebuilt['ida']['coords'][-1], service['ida']['coords'][-1])
        self.assertEqual(rebuilt['vuelta']['coords'][0], service['vuelta']['coords'][0])
        self.assertEqual(build(result, 'terminal', station, net, evidence)[0], result)
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)/'data/processed/metropolitano'
            folder.mkdir(parents=True)
            file = folder/'alimentadores_paths.json'
            file.write_text(json.dumps(result))
            for direction in ('ida', 'vuelta'):
                route = import_native(root, f'alim:AN-01:{direction}', Engine(net))
                self.assertTrue(validate(route, net)['ready'])
                self.assertEqual(geometry(route, net), [list(reversed(p)) for p in rebuilt[direction]['coords']])
                terminal = next(s for s in route['stops'] if s['id'] == 'met:terminal')
                self.assertEqual(terminal['coordinates'], station['point'])
                self.assertLess(terminal['position']['distanceM'], 1)
            broken = copy.deepcopy(result)
            broken['services']['AN-01']['ida']['coords'][1][0] += .0001
            file.write_text(json.dumps(broken))
            with self.assertRaises(ValueError):
                import_native(root, 'alim:AN-01:ida', Engine(net))
            broken = copy.deepcopy(result)
            broken['services']['AN-01']['ida']['coords'][-1][0] += .0001
            file.write_text(json.dumps(broken))
            with self.assertRaises(ValueError):
                import_native(root, 'alim:AN-01:ida', Engine(net))

    def test_external_platform_stays_external_and_ambiguous_source_is_blocked(self):
        net, station, service, evidence = fixture()
        source = {'services': {'AN-01': service}}
        evidence['platforms'][0]['point'] = net.nodes[7]
        result, report = build(source, 'terminal', station, net, evidence)
        self.assertEqual(result['services'], source['services'])
        self.assertEqual(report['external'], ['AN-01'])
        evidence['platforms'].append(copy.deepcopy(evidence['platforms'][0]))
        with self.assertRaises(ValueError):
            build(source, 'terminal', station, net, evidence)
        self.assertNotIn('terminalAccess', source['services']['AN-01']['ida'])

    def test_segment_permission_does_not_authorize_the_rest_of_a_way(self):
        net, _, _, _ = fixture()
        profile = {'mode': 'mixed', 'reservedEdges': ['1:0']}
        self.assertTrue(profile_allows(net.edges['1:0'], profile))
        other = {**net.edges['1:0'], 'id': '1:1'}
        self.assertFalse(profile_allows(other, profile))

    def test_boarding_binding_cannot_move_an_unrelated_stop(self):
        net, station, _, _ = fixture()
        route = new_route('test', 'test', 'ida', net)
        route['path'] = [{'type': 'street', 'edge': '1:0', 'start': 0, 'end': 1}]
        route['stops'] = [{'id': 'other', 'name': 'other', 'coordinates': station['point'],
                          'boardingPoint': {'kind': 'osm-platform', 'network': net.id, 'id': 200,
                                            'coordinates': net.nodes[1]}}]
        with self.assertRaises(ValueError):
            attach_stops(route, net)
        self.assertEqual(name_tokens('Alimentadora Norte Milagro de Jesús (ida)'),
                         name_tokens('Terminal Milagros de Jesús'))
