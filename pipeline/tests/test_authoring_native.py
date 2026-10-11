import copy
import json
import tempfile
import unittest
from pathlib import Path

from pipeline.authoring.engine import Engine
from pipeline.authoring.exporter import bundle
from pipeline.authoring.importer import import_existing
from pipeline.authoring.model import geometry, validate
from pipeline.authoring.native import catalog, import_native
from pipeline.authoring.network import Network
from pipeline.authoring.resolver import Resolver
from pipeline.authoring.service import Service
from pipeline.authoring.trace import GeometryTrace
from test_authoring_network import fixture_network


def native_fixture(root, net):
    folder = root / 'data/processed/metropolitano'
    folder.mkdir(parents=True)
    points = [list(reversed(net.nodes[i])) for i in (1, 2, 3, 4, 5)]
    stops = [{'id': f's{i}', 'name': f'Estación {i}', 'lat': net.nodes[i][1], 'lon': net.nodes[i][0]} for i in (1, 3, 5)]
    docs = {'metropolitano_paths.json': {'paths': {'A:ns': {'coords': points, 'at': [0, 2, 4], 'm': [0, 20, 50]}}},
            'metropolitano_services.json': {'services': [{'id': 'A', 'name': 'Ruta A', 'north_south': ['s1', 's3', 's5']}]},
            'metropolitano_stops.json': {'stations': stops},
            'alimentadores_paths.json': {'services': {'AN-01': {'name': 'Alimentador', 'ida': {
                'coords': points, 'stops': [dict(s, at=a, m=m, aprox=True) for s, a, m in zip(stops, [0, 2, 4], [0, 20, 50])]}}}}}
    for name, data in docs.items():
        (folder / name).write_text(json.dumps(data))


class NativeImportTest(unittest.TestCase):
    def test_native_profiles_coordinates_metadata_and_sources_survive_api_import(self):
        net = fixture_network()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            native_fixture(root, net)
            before = {p: p.read_bytes() for p in root.rglob('*.json')}
            engine = Engine(net)
            self.assertEqual(set(catalog(root)), {'met:A:ns', 'alim:AN-01:ida'})
            met = import_existing(root, 'met:A:ns', engine)
            self.assertTrue(validate(met, net)['ready'])
            self.assertEqual(geometry(met, net), [net.nodes[i] for i in range(1, 6)])
            self.assertEqual(met['profile'], {'mode': 'brt', 'system': 'Metropolitano'})
            self.assertEqual([s['id'] for s in met['stops']], ['met:s1', 'met:s3', 'met:s5'])
            feeder = import_native(root, 'alim:AN-01:ida', engine)
            self.assertEqual(feeder['profile']['mode'], 'mixed')
            self.assertTrue(feeder['stops'][0]['properties']['aprox'])
            self.assertNotIn('route_track_trip1.geojson', bundle(feeder, net, preview=True)['files'])
            service = Service(net, root, root/'workspace')
            self.assertEqual(len(service.call({'operation': 'catalog', 'query': 'met:'})['result']['published']), 1)
            self.assertEqual(service.call({'operation': 'import-existing', 'routeId': 'met:A:ns'})['result']['route'], met)
            self.assertEqual(Resolver.from_repository(engine, root).by_id['met:s1']['coordinates'], net.nodes[1])
            self.assertEqual(before, {p: p.read_bytes() for p in root.rglob('*.json')})

    def test_missing_station_is_explicit_and_does_not_shift_stop_indexes(self):
        net = fixture_network()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            native_fixture(root, net)
            path = root/'data/processed/metropolitano/metropolitano_stops.json'
            data = json.loads(path.read_text())
            data['stations'][1]['lat'] = None
            path.write_text(json.dumps(data))
            route = import_native(root, 'met:A:ns', Engine(net))
            self.assertFalse(validate(route, net)['ready'])
            self.assertIn('s3', route['importWarnings'][0])


class GeometryTraceTest(unittest.TestCase):
    def test_curves_and_six_decimal_rounding_keep_all_osm_vertices(self):
        net = fixture_network()
        points = [[round(c, 6) for c in net.nodes[i]] for i in range(1, 6)]
        self.assertEqual([r['edge'] for r in GeometryTrace(Engine(net)).parts([points])], ['1:0', '1:1', '2:0', '3:0'])
        # A straight source segment can span multiple collinear OSM nodes.
        data = copy.deepcopy(net.data)
        data['edges'][1]['coordinates'][1] = [-76.9998, -12.0001]
        net = Network({**data, 'edges': data['edges'][:2]})
        refs = GeometryTrace(Engine(net)).parts([[net.nodes[1], net.nodes[3]]])
        self.assertEqual([r['edge'] for r in refs], ['1:0', '1:1'])

    def test_parallel_geometry_or_missing_curve_is_never_guessed(self):
        net = fixture_network()
        points = [net.nodes[i] for i in range(1, 6)]
        data = copy.deepcopy(net.data)
        duplicate = copy.deepcopy(data['edges'][0])
        duplicate.update(id='90:0', way=90, nodes=[91, 92], layer='1')
        data['edges'].append(duplicate)
        refs = GeometryTrace(Engine(Network(data))).parts([points])
        self.assertEqual(refs[0]['type'], 'gap')
        self.assertIsNone(GeometryTrace(Engine(net)).segment(net.nodes[1], net.nodes[3]))

    def test_reverse_geometry_is_preserved_and_validation_still_blocks_it(self):
        net = fixture_network()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            native_fixture(root, net)
            route = import_native(root, 'met:A:ns', Engine(net))
            route['path'] = GeometryTrace(Engine(net)).parts([[net.nodes[i] for i in range(5, 0, -1)]])
            self.assertIn('wrongDirection', [i['code'] for i in validate(route, net)['issues']])
