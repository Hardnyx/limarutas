import copy
import tempfile
import unittest
from pathlib import Path
from pipeline.authoring.exporter import bundle, write_bundle
from pipeline.authoring.store import RevisionConflict, Store
from test_authoring_model import fixture_route


class ExportAndStoreTest(unittest.TestCase):
    def test_export_is_deterministic_and_requires_acceptance(self):
        net, route = fixture_route()
        with self.assertRaises(ValueError):
            bundle(route, net)
        route['review']['accepted'] = True
        a, b = bundle(route, net), bundle(route, net)
        self.assertEqual(a, b)
        self.assertEqual(a['files']['route_track_trip1.osm.geojson']['features'][0]['geometry']['coordinates'],
                         [net.nodes[i] for i in range(1, 6)])
        self.assertEqual(a['files']['stops_trip1.geojson']['features'][0]['geometry']['coordinates'], route['stops'][0]['coordinates'])

    def test_source_original_is_not_rewritten_and_site_paths_are_rejected(self):
        net, route = fixture_route()
        route['source']['kind'] = 'wikiroutes'
        export = bundle(route, net, preview=True)
        self.assertNotIn('route_track_trip1.geojson', export['files'])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                write_bundle(export, root / 'data/processed/x', root)
            target = root / 'pipeline/temp/export'
            write_bundle(export, target, root)
            with self.assertRaises(ValueError):
                write_bundle(export, target, root)

    def test_revisions_prevent_lost_edits_and_keep_history(self):
        _, route = fixture_route()
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            first = store.save(route, 0)
            self.assertEqual(first['revision'], 1)
            with self.assertRaises(RevisionConflict):
                store.save(first, 0)
            second = store.save(first, 1, accept=True)
            self.assertTrue(second['review']['accepted'])
            third = store.save(second, 2)
            self.assertFalse(third['review']['accepted'])
            self.assertEqual(len(list((Path(directory) / 'history').glob('*/*.json'))), 3)
            changed = copy.deepcopy(third)
            changed['source']['kind'] = 'other'
            with self.assertRaises(ValueError):
                store.save(changed, 3)
