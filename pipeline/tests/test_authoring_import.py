import copy
import unittest
from pipeline.authoring.engine import Engine
from pipeline.authoring.importer import import_bundle
from pipeline.authoring.model import geometry, validate
from test_authoring_network import fixture_network


def source_fixture(net):
    track = {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {'source': 'test'},
             'geometry': {'type': 'LineString', 'coordinates': [net.nodes[1], net.nodes[3], net.nodes[5]]}}]}
    stops = {'type': 'FeatureCollection', 'features': [{'type': 'Feature',
             'properties': {'stop_id': str(n), 'seq': i+1, 'name': str(n), 'custom': 'preserve'},
             'geometry': {'type': 'Point', 'coordinates': net.nodes[n]}} for i, n in enumerate([1, 3, 5])]}
    vias = {'osm': '2026-10-02', 'tramos': [{'nodo': 1, 'vias': [[1, 2], [2, 1], [3, 1]],
            'desde': list(reversed(net.nodes[1])), 'hasta': list(reversed(net.nodes[5]))}], 'sueltos': []}
    return track, stops, vias


class ExistingRouteImportTest(unittest.TestCase):
    def test_sources_and_properties_are_preserved(self):
        net = fixture_network()
        track, stops, vias = source_fixture(net)
        before = copy.deepcopy((track, stops, vias))
        route = import_bundle(Engine(net), 'x-ida', 'X', 'ida', track, stops, vias)
        self.assertEqual(before, (track, stops, vias))
        self.assertEqual(route['source']['track'], track)
        self.assertEqual(route['stops'][0]['properties']['custom'], 'preserve')
        self.assertEqual(geometry(route, net), [net.nodes[i] for i in range(1, 6)])
        self.assertTrue(validate(route, net)['ready'])

    def test_changed_way_is_pending_instead_of_silent_rematch(self):
        net = fixture_network()
        track, stops, vias = source_fixture(net)
        vias['tramos'][0]['vias'][0][0] = 999
        route = import_bundle(Engine(net), 'x', 'X', 'ida', track, stops, vias)
        self.assertTrue(route['source']['importWarnings'])
        self.assertFalse(validate(route, net)['ready'])

    def test_repeated_stop_identity_retains_occurrences(self):
        net = fixture_network()
        track, stops, vias = source_fixture(net)
        stops['features'].append(copy.deepcopy(stops['features'][0]))
        route = import_bundle(Engine(net), 'x', 'X', 'ida', track, stops, vias)
        self.assertEqual(route['stops'][-1]['occurrence'], 2)
