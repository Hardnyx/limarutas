import copy
import unittest
from pipeline.authoring.engine import Engine
from pipeline.authoring.exporter import bundle
from pipeline.authoring.importer import import_bundle
from pipeline.authoring.model import geometry, validate
from pipeline.authoring.network import Network
from pipeline.authoring.policy import candidate
from test_authoring_network import fixture_network
from test_authoring_import import source_fixture


class PolicyRevalidationTest(unittest.TestCase):
    def test_same_extract_preserves_geometry_but_new_restrictions_still_block(self):
        net = fixture_network()
        route = import_bundle(Engine(net), 'x', 'X', 'ida', *source_fixture(net))
        route['review']['accepted'] = True
        route = bundle(route, net)['files']['route_track_trip1.route.json']
        data = copy.deepcopy(net.data)
        data['policy'] = 'new-policy'
        data['edges'][0]['forward'] = False
        updated = Network(data)
        proposed = candidate(route, updated)
        self.assertEqual(geometry(proposed, updated), geometry(route, net))
        self.assertFalse(proposed['review']['accepted'])
        self.assertIn('wrongDirection', [i['code'] for i in validate(proposed, updated)['issues']])
        data['source']['sha256'] = 'different-extract'
        with self.assertRaises(ValueError):
            candidate(route, Network(data))
        data = copy.deepcopy(net.data)
        data['edges'][0]['coordinates'][0][0] += .001
        with self.assertRaises(ValueError):
            candidate(route, Network(data))
