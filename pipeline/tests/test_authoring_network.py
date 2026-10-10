import unittest
from pipeline.authoring.network import Network, bus_access


def fixture_network():
    return Network({'version': 1, 'source': {'sha256': 'fixture'}, 'edges': [
        {'id': '1:0', 'way': 1, 'nodes': [1, 2], 'coordinates': [[-77, -12], [-76.9999, -12.00005]],
         'name': 'Avenida Curva', 'forward': True, 'backward': False},
        {'id': '1:1', 'way': 1, 'nodes': [2, 3], 'coordinates': [[-76.9999, -12.00005], [-76.99985, -12.00015]],
         'name': 'Avenida Curva', 'forward': True, 'backward': False},
        {'id': '2:0', 'way': 2, 'nodes': [3, 4], 'coordinates': [[-76.99985, -12.00015], [-76.99985, -12.0003]],
         'name': 'Calle Sur', 'forward': True, 'backward': True},
        {'id': '3:0', 'way': 3, 'nodes': [4, 5], 'coordinates': [[-76.99985, -12.0003], [-76.9997, -12.0003]],
         'name': 'Calle Final', 'forward': True, 'backward': True}], 'turns': []})


class StreetNetworkTest(unittest.TestCase):
    def test_shared_geometry_preserves_curve_and_reverse(self):
        net = fixture_network()
        first = net.coordinates({'edge': '1:0'})
        self.assertEqual(first[-1], net.coordinates({'edge': '1:1'})[0])
        self.assertEqual(first, list(reversed(net.coordinates({'edge': '1:0', 'start': 1, 'end': 0}))))
        self.assertNotIn(1, [node for node, _, _ in net.adj[2]])

    def test_bus_exceptions_override_general_access(self):
        self.assertTrue(bus_access({'highway': 'busway', 'access': 'no', 'bus': 'designated'}))
        self.assertFalse(bus_access({'highway': 'primary', 'access': 'yes', 'bus': 'no'}))
        self.assertFalse(bus_access({'highway': 'footway'}))

    def test_turn_restriction_is_enforced(self):
        net = fixture_network()
        net.turns[3].append({'from': 1, 'to': 2, 'kind': 'no_right_turn'})
        self.assertFalse(net.turn_allowed(3, '1:1', '2:0'))

    def test_named_streets_and_viewport(self):
        net = fixture_network()
        self.assertEqual(net.streets('Av. Curva')[0]['way'], 1)
        self.assertEqual(len(net.viewport([-77.001, -12.001, -76.999, -11.999])[0]), 4)
        with self.assertRaises(ValueError):
            net.viewport([-78, -13, -76, -11])
