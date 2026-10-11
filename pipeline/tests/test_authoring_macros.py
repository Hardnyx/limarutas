import copy
import unittest

from pipeline.authoring.engine import Engine
from pipeline.authoring.macros import macro_id, service_path, verify_slices, slice_references
from pipeline.authoring.model import digest
from test_authoring_network import fixture_network


class MetropolitanoMacrosTest(unittest.TestCase):
    def test_macro_selection_preserves_current_branch_and_allows_explicit_itinerary(self):
        self.assertEqual(macro_id({'id': '10', 'north_south': ['naranjal', 'tacna-sur', 'estacion-central']}), 'A')
        self.assertEqual(macro_id({'id': '2', 'north_south': ['naranjal', 'canada']}), 'B')
        self.assertEqual(macro_id({'id': 'x', 'macro': 'A', 'north_south': ['naranjal', 'canada']}), 'A')
        asymmetric = {'north_south': ['tacna-sur', 'estacion-central'], 'south_north': ['canada', 'naranjal']}
        self.assertEqual(macro_id(asymmetric, 'ns'), 'A')
        self.assertEqual(macro_id(asymmetric, 'sn'), 'B')
        self.assertEqual(macro_id({'south_north': ['espana', 'alfonso-ugarte']}, 'sn'), 'B')

    def test_express_skips_stations_without_skipping_curve_geometry(self):
        net = fixture_network()
        refs = [{'type': 'street', 'edge': eid, 'start': 0, 'end': 1} for eid in net.edges]
        coords = [list(reversed(net.nodes[i])) for i in range(1, 6)]
        base = {'path': refs, 'coords': coords, 'hash': digest(refs), 'network': net.id}
        self.assertEqual(slice_references(base, 1, 3, net), refs[1:3])
        corrupted_base = copy.deepcopy(base)
        corrupted_base['coords'][2][0] += .001
        with self.assertRaises(ValueError):
            slice_references(corrupted_base, 1, 3, net)
        stations = {str(i): {'id': str(i), 'name': str(i), 'lat': net.nodes[i][1], 'lon': net.nodes[i][0]} for i in (1, 3, 5)}
        regular = {'id': 'B', 'name': 'Regular', 'north_south': ['1', '3', '5']}
        express = {'id': '2', 'name': 'Expreso', 'north_south': ['1', '5']}
        first = service_path(Engine(net), base, regular, 'ns', stations)
        second = service_path(Engine(net), base, express, 'ns', stations)
        # A station marker off the road must never pull the BRT geometry to it.
        displaced = copy.deepcopy(stations)
        displaced['3']['lat'] += .0003
        offset_path = service_path(Engine(net), base, regular, 'ns', displaced)
        self.assertEqual(offset_path['coords'], first['coords'])
        self.assertNotIn([displaced['3']['lat'], displaced['3']['lon']], offset_path['coords'])
        self.assertEqual(first['coords'], second['coords'])
        self.assertEqual(second['at'], [0, 4])
        self.assertEqual(first['at'], [0, 2, 4])
        backbones = {'backbones': {'B:ns': base}}
        paths = {'paths': {'B:ns': first, '2:ns': second}}
        self.assertTrue(verify_slices(backbones, paths, [regular, express]))
        corrupted = copy.deepcopy(paths)
        corrupted['paths']['2:ns']['coords'] = [coords[0], coords[-1]]
        with self.assertRaises(ValueError):
            verify_slices(backbones, corrupted, [regular, express])
        paths['paths']['2:ns']['macro'] = 'A'
        with self.assertRaises(ValueError):
            verify_slices(backbones, paths, [regular, express])
