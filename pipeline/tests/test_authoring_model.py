import copy
import unittest
from pipeline.authoring.model import attach_stops, geometry, new_route, validate
from test_authoring_network import fixture_network


def fixture_route():
    net = fixture_network()
    route = new_route('test:ida', 'Prueba', 'ida', net)
    route['path'] = [{'type': 'street', 'edge': eid} for eid in ['1:0', '1:1', '2:0', '3:0']]
    route['stops'] = [{'id': str(i), 'name': str(i), 'coordinates': list(net.nodes[node])}
                      for i, node in enumerate([1, 3, 5])]
    return net, attach_stops(route, net)


class RouteModelTest(unittest.TestCase):
    def test_curve_nodes_and_source_stops_survive(self):
        net, route = fixture_route()
        self.assertEqual(geometry(route, net), [net.nodes[i] for i in range(1, 6)])
        self.assertTrue(validate(route, net)['ready'])
        self.assertFalse(validate(route, net)['accepted'])

    def test_wrong_way_gap_and_mismatched_version_are_explicit(self):
        net, route = fixture_route()
        route['path'][0].update(start=1, end=0)
        self.assertIn('wrongDirection', [x['code'] for x in validate(route, net)['issues']])
        route['network'] = 'osm:other'
        with self.assertRaises(ValueError):
            validate(route, net)

    def test_stop_projection_keeps_original_location_and_order(self):
        net, route = fixture_route()
        route['stops'][1]['coordinates'][0] += .00002
        source = copy.deepcopy(route['stops'][1]['coordinates'])
        adjusted = attach_stops(route, net)
        self.assertEqual(adjusted['stops'][1]['coordinates'], source)
        self.assertTrue(validate(adjusted, net)['ready'])
        adjusted['stops'].reverse()
        self.assertIn('stopOrder', [x['code'] for x in validate(adjusted, net)['issues']])

    def test_off_route_and_duplicate_stops_do_not_pass(self):
        net, route = fixture_route()
        route['stops'][0]['coordinates'] = [-78, -13]
        self.assertFalse(validate(attach_stops(route, net), net)['ready'])
        route['stops'].append(copy.deepcopy(route['stops'][1]))
        with self.assertRaises(ValueError):
            validate(route, net)
