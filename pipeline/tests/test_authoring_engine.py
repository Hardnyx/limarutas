import unittest
from pipeline.authoring.engine import Engine
from pipeline.authoring.model import geometry, validate
from test_authoring_network import fixture_network
from pipeline.authoring.network import Network


class RouteEngineTest(unittest.TestCase):
    def setUp(self):
        self.net = fixture_network()
        self.engine = Engine(self.net)

    def test_build_retains_all_curve_nodes(self):
        route = self.engine.build({'id': 'x:ida', 'name': 'X', 'direction': 'ida',
            'anchors': [{'node': 1}, {'node': 5}], 'stops': [
                {'id': 'a', 'name': 'A', 'coordinates': self.net.nodes[1]},
                {'id': 'b', 'name': 'B', 'coordinates': self.net.nodes[5]}]})
        self.assertTrue(validate(route, self.net)['ready'])
        self.assertEqual(geometry(route, self.net), [self.net.nodes[i] for i in range(1, 6)])

    def test_wrong_way_and_turn_restrictions_block_build(self):
        with self.assertRaises(ValueError):
            self.engine.connect({'node': 3}, {'node': 1})
        self.net.turns[3].append({'from': 1, 'to': 2, 'kind': 'no_right_turn'})
        with self.assertRaises(ValueError):
            self.engine.connect({'node': 1}, {'node': 5})

    def test_partial_edge_is_exact_and_shared(self):
        refs = self.engine.connect({'edge': '1:0', 'fraction': .2}, {'edge': '1:0', 'fraction': .8})
        self.assertEqual(refs, [{'type': 'street', 'edge': '1:0', 'start': .2, 'end': .8}])
        shared = self.engine.connect({'node': 2}, {'node': 5})
        full = self.engine.connect({'node': 1}, {'node': 5})
        self.assertEqual(shared, full[1:])

    def test_allowed_and_required_streets_are_not_ignored(self):
        with self.assertRaises(ValueError):
            self.engine.connect({'node': 1}, {'node': 5}, allowed={1})
        with self.assertRaises(ValueError):
            self.engine.connect({'node': 1}, {'node': 5}, via=[{999}])
        self.assertEqual(len(self.engine.connect({'node': 1}, {'node': 5}, via=[{1}, {2}, {3}])), 4)

    def test_legacy_matcher_accepts_injected_shared_network(self):
        saved = {'osm': '2026-10-02', 'tramos': [{'nodo': 1, 'vias': [[1, 2], [2, 1], [3, 1]],
                 'desde': [-12, -77], 'hasta': [-12.0003, -76.9997]}], 'sueltos': []}
        record = self.engine.matcher.decode(saved)
        self.assertEqual(record['tramos'][0]['nodos'], [1, 2, 3, 4, 5])
        self.assertEqual([r['edge'] for r in self.engine.from_record(record)], ['1:0', '1:1', '2:0', '3:0'])

    def test_conventional_bus_does_not_take_reserved_shortcut(self):
        data = self.net.data
        data['edges'].append({'id': '4:0', 'way': 4, 'nodes': [1, 5],
            'coordinates': [self.net.nodes[1], self.net.nodes[5]], 'name': 'Metropolitano',
            'forward': True, 'backward': True, 'facility': 'separate_busway'})
        engine = Engine(Network(data))
        self.assertEqual(len(engine.connect({'node': 1}, {'node': 5})), 4)
        reserved = engine.connect({'node': 1}, {'node': 5}, profile={'mode': 'brt', 'system': 'Metropolitano'})
        self.assertEqual(reserved[0]['edge'], '4:0')
