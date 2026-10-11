import copy
import unittest

from pipeline.authoring.engine import Engine
from pipeline.authoring.importer import import_bundle
from pipeline.authoring.model import geometry, validate
from pipeline.authoring.network import Network
from pipeline.authoring.repairs import publication_proof, roundabouts


def fixture():
    points = {1: [-77, -12], 2: [-77, -12.001], 3: [-76.999, -12.001],
              4: [-76.999, -12], 5: [-77.001, -12.001], 6: [-77.001, -12]}
    def edge(way, index, a, b, ring=False):
        return {'id': f'{way}:{index}', 'way': way, 'nodes': [a, b], 'coordinates': [points[a], points[b]],
                'name': 'Óvalo' if ring else 'Acceso', 'junction': 'roundabout' if ring else '',
                'forward': True, 'backward': False}
    net = Network({'version': 1, 'source': {'sha256': 'ring', 'timestamp': '2026-10-02'},
                   'bbox': [-77.01, -12.01, -76.99, -11.99], 'edges': [
                       *[edge(1, i, a, b, True) for i, (a, b) in enumerate([(1, 2), (2, 3), (3, 4), (4, 1)])],
                       edge(2, 0, 5, 2), edge(3, 0, 1, 6)]})
    engine = Engine(net)
    vias = {'osm': '2026-10-02', 'tramos': [{'nodo': 5, 'vias': [[2, 1], [1, -1], [3, 1]],
            'desde': list(reversed(points[5])), 'hasta': list(reversed(points[6]))}], 'sueltos': []}
    track = {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {},
             'geometry': {'type': 'LineString', 'coordinates': [points[i] for i in [5, 2, 1, 6]]}}]}
    stops = {'type': 'FeatureCollection', 'features': [{'type': 'Feature',
             'properties': {'stop_id': str(i), 'name': str(i), 'seq': j+1},
             'geometry': {'type': 'Point', 'coordinates': points[i]}} for j, i in enumerate([5, 6])]}
    matched = copy.deepcopy(track)
    matched['features'][0]['geometry']['coordinates'] = [list(reversed(p)) for p in engine.matcher.geometry(engine.matcher.decode(vias))]
    return engine, import_bundle(engine, 'ring-ida', 'Óvalo', 'ida', track, stops, vias, matched)


class RoundaboutRepairTest(unittest.TestCase):
    def test_unique_ring_direction_preserves_entry_exit_and_other_streets(self):
        engine, route = fixture()
        before = copy.deepcopy(route)
        self.assertIn('wrongDirection', [i['code'] for i in validate(route, engine.network)['issues']])
        corrected, proof = roundabouts(route, engine)
        self.assertTrue(validate(corrected, engine.network)['ready'])
        self.assertEqual([r['edge'] for r in corrected['path']], ['2:0', '1:1', '1:2', '1:3', '3:0'])
        self.assertEqual(corrected['source'], before['source'])
        self.assertEqual(geometry(corrected, engine.network)[::len(geometry(corrected, engine.network))-1],
                         geometry(route, engine.network)[::len(geometry(route, engine.network))-1])
        self.assertEqual(route, before)
        corrected['migration'] = proof
        self.assertEqual(publication_proof(corrected, engine), proof)
        corrected['path'].pop(1)
        with self.assertRaises(ValueError):
            publication_proof(corrected, engine)

    def test_a_two_way_or_incomplete_ring_cannot_be_silently_repaired(self):
        engine, route = fixture()
        engine.network.edges['1:2']['backward'] = True
        with self.assertRaises(ValueError):
            roundabouts(route, engine)
