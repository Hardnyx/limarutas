import copy
import unittest

from pipeline.authoring.engine import Engine
from pipeline.authoring.model import attach_stops, validate
from pipeline.authoring.network import Network
from test_authoring_model import fixture_route


class ViaWayRestrictionsTest(unittest.TestCase):
    def setup_restriction(self, kind='no_left_turn'):
        original, route = fixture_route()
        data = copy.deepcopy(original.data)
        for edge in data['edges']:
            edge['backward'] = False
        data['viaRestrictions'] = [{'relation': 70, 'from': 1, 'viaWays': [2], 'to': 3, 'kind': kind}]
        network = Network(data)
        return network, attach_stops(route, network)

    def test_complete_movement_is_blocked_but_using_one_member_is_not(self):
        net, route = self.setup_restriction()
        self.assertEqual([i['relation'] for i in validate(route, net)['issues'] if i['code'] == 'restrictedTurn'], [70])
        route['path'] = route['path'][2:]
        self.assertFalse(net.restrictions.trace(route['path'])[1])
        Engine(net).connect({'node': 3}, {'node': 5})
        with self.assertRaises(ValueError):
            Engine(net).connect({'node': 1}, {'node': 5})

    def test_history_survives_editor_anchors_and_partial_destination(self):
        net, route = self.setup_restriction()
        engine = Engine(net)
        with self.assertRaises(ValueError):
            engine.build({'id': 'x', 'name': 'X', 'direction': 'ida', 'stops': route['stops'],
                          'anchors': [{'node': n} for n in [1, 3, 4, 5]]})
        with self.assertRaises(ValueError):
            engine.connect({'node': 1}, {'edge': '3:0', 'fraction': .5})

    def test_only_turn_blocks_side_exit_but_allows_complete_sequence(self):
        net, route = self.setup_restriction('only_straight_on')
        data = copy.deepcopy(net.data)
        data['edges'].append({'id': '4:0', 'way': 4, 'nodes': [3, 6],
                              'coordinates': [net.nodes[3], [-76.999, -12]],
                              'name': 'Salida lateral', 'forward': True, 'backward': False})
        net = Network(data)
        self.assertFalse(net.restrictions.trace(route['path'])[1])
        self.assertTrue(validate(route, net)['ready'])
        Engine(net).connect({'node': 1}, {'node': 5})
        with self.assertRaises(ValueError):
            Engine(net).connect({'node': 1}, {'node': 6})
        Engine(net).connect({'node': 3}, {'node': 6})

    def test_split_segment_keeps_context_but_reverse_traversal_does_not(self):
        net, route = self.setup_restriction()
        route['path'][1:2] = [{'type': 'street', 'edge': '1:1', 'start': 0, 'end': .4},
                             {'type': 'street', 'edge': '1:1', 'start': .4, 'end': 1}]
        self.assertEqual(len(net.restrictions.trace(route['path'])[1]), 1)
        reversed_refs = [{'type': 'street', 'edge': r['edge'], 'start': 1, 'end': 0}
                         for r in reversed(route['path'])]
        self.assertFalse(net.restrictions.trace(reversed_refs)[1])

    def test_multiple_via_members_are_ordered_by_topology(self):
        net, route = self.setup_restriction()
        data = copy.deepcopy(net.data)
        data['edges'].append({'id': '4:0', 'way': 4, 'nodes': [5, 6],
                              'coordinates': [net.nodes[5], [-76.999, -12]],
                              'name': 'Final', 'forward': True, 'backward': True})
        data['viaRestrictions'][0].update(viaWays=[3, 2], to=4)
        net = Network(data)
        route['path'].append({'type': 'street', 'edge': '4:0'})
        self.assertEqual(len(net.restrictions.trace(route['path'])[1]), 1)
        self.assertFalse(net.restrictions.unresolved)

    def test_incomplete_relation_blocks_approach_but_not_opposite_carriageway(self):
        net, route = self.setup_restriction()
        data = copy.deepcopy(net.data)
        data['viaRestrictions'] = []
        data['unresolvedRestrictions'] = [{'relation': 71, 'from': 1, 'viaWays': [2], 'ways': [1, 2]}]
        net = Network(data)
        self.assertIn('unsupportedRestriction', [i['code'] for i in validate(route, net)['issues']])
        route['path'] = route['path'][:2]
        self.assertFalse(any(i['code'] == 'unsupportedRestriction' for i in validate(route, net)['issues']))
