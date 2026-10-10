import copy
import unittest

from pipeline.stages import stage_order
from pipeline.validation import validate_graph


class DataContracts(unittest.TestCase):
    def setUp(self):
        self.graph = {'version': 1, 'districts': ['Lima'], 'aliases': ['Otro nombre'],
                      'stops': [[-12, -77, 'A', 0, '', '', 0], [-12.01, -77, 'B', 0]],
                      'routes': {'route-ida': [0, 1]}, 'segM': {'route-ida': [1000]},
                      'headway': {'route-ida': 5}}

    def test_valid_reference(self):
        validate_graph(self.graph)

    def test_broken_references_and_nonfinite_coordinates_fail(self):
        for mutate in [lambda g: g['routes']['route-ida'].append(2),
                       lambda g: g['stops'][0].__setitem__(0, float('nan')),
                       lambda g: g['stops'][0].__setitem__(3, -1),
                       lambda g: g['stops'][0].__setitem__(6, 9)]:
            graph = copy.deepcopy(self.graph)
            mutate(graph)
            with self.assertRaises(ValueError):
                validate_graph(graph)

    def test_segment_length_and_headway_contracts(self):
        for field, value in [('segM', []), ('segM', [-1]), ('headway', 0)]:
            graph = copy.deepcopy(self.graph)
            graph[field]['route-ida'] = value
            with self.assertRaises(ValueError):
                validate_graph(graph)

    def test_build_order_and_explicit_dependency_selection(self):
        self.assertEqual(stage_order('trips'), ['trips'])
        order = stage_order('trips', with_dependencies=True)
        self.assertLess(order.index('stops'), order.index('crossings'))
        self.assertLess(order.index('crossings'), order.index('feeders'))
        self.assertLess(order.index('met-paths'), order.index('feeders'))
        self.assertEqual(order[-1], 'trips')
        self.assertEqual(len(order), len(set(order)))


if __name__ == '__main__':
    unittest.main()
