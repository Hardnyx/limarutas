import copy
import unittest
from pipeline.scripts.trips.build_trip_graph import update_met_distances


class MetTripDistancesTest(unittest.TestCase):
    def test_updates_only_met_distances_and_rejects_changed_stop_identity_before_writes(self):
        graph = {'stops': [[-12, -77, 'Inicio'], [-12.1, -77.1, 'Fin']],
                 'routes': {'met:2:ns': [0, 1], 'ordinary': [1, 0]},
                 'segM': {'met:2:ns': [100], 'ordinary': [500]}, 'headway': {'ordinary': 10}}
        services = [{'id': '2', 'north_south': ['s1', 's2']}]
        stations = [{'id': 's1', 'lat': -12, 'lon': -77}, {'id': 's2', 'lat': -12.1, 'lon': -77.1}]
        paths = {'2:ns': {'m': [0, 800]}}
        self.assertEqual(update_met_distances(graph, paths, services, stations), 1)
        self.assertEqual(graph['segM'], {'met:2:ns': [800], 'ordinary': [500]})
        before = copy.deepcopy(graph)
        stations[1]['lon'] = -77.2
        with self.assertRaises(ValueError):
            update_met_distances(graph, paths, services, stations)
        self.assertEqual(graph, before)
