import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pipeline.authoring.exporter import bundle
from pipeline.authoring.model import digest
from pipeline.authoring.engine import Engine
from pipeline.authoring.importer import import_existing
from pipeline.authoring.published import preflight, verify_published
from test_authoring_model import fixture_route


class PublishedRouteTest(unittest.TestCase):
    def exported(self):
        net, route = fixture_route()
        route['review']['accepted'] = True
        exported = bundle(route, net)
        return net, exported['files']

    def test_static_integrity_rejects_preview_and_changed_track_or_stops(self):
        _, files = self.exported()
        route, track, stops = [files[name] for name in ['route_track_trip1.route.json', 'route_track_trip1.osm.geojson', 'stops_trip1.geojson']]
        original = files['route_track_trip1.geojson']
        self.assertTrue(verify_published(route, track, original, stops, 1, 'test:ida'))
        for target, change in [('track', lambda x: x['features'][0]['geometry']['coordinates'][0].__setitem__(0, -78)),
                               ('stops', lambda x: x['features'][0]['properties'].__setitem__('name', 'Changed')),
                               ('route', lambda x: x['exported'].__setitem__('preview', True))]:
            values = copy.deepcopy(dict(route=route, track=track, stops=stops))
            change(values[target])
            with self.assertRaises(ValueError):
                verify_published(values['route'], values['track'], original, values['stops'], 1)

    def test_preflight_and_legacy_regeneration_honor_accepted_path_even_with_redo(self):
        net, files = self.exported()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            folder = root / 'data/route'
            folder.mkdir(parents=True)
            for name, data in files.items():
                (folder / name).write_text(json.dumps(data))
            catalog = root / 'pipeline/output/wr_map.json'
            catalog.parent.mkdir(parents=True)
            catalog.write_text(json.dumps({'routes': {'test:ida': {'folder': 'data/route', 'trip': 1}}}))
            reopened = import_existing(root, 'test:ida', Engine(net))
            self.assertEqual(reopened['path'], files['route_track_trip1.route.json']['path'])
            self.assertEqual(reopened['revision'], 0)
            self.assertFalse(reopened['review']['accepted'])
            exports = preflight(root, [('test:ida', 'data/route', 1)], net)
            filename = Path(__file__).resolve().parents[1] / 'scripts/osm/build_recorridos.py'
            spec = importlib.util.spec_from_file_location('build_recorridos_test', filename)
            builder = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(builder)
            builder.ROOT, builder.AUTHORING_EXPORTS, builder.REHACER = root, exports, True
            builder.R = None  # the legacy matcher must never run for this route
            (folder / 'route_track_trip1.osm.geojson').unlink()
            key, result = builder.work(('test:ida', 'data/route', 1))
            self.assertTrue(result['usa'])
            self.assertEqual(json.loads((folder / 'route_track_trip1.osm.geojson').read_text()), files['route_track_trip1.osm.geojson'])
            changed = copy.deepcopy(net.data)
            changed['source']['sha256'] = 'changed'
            with self.assertRaises(ValueError):
                preflight(root, [('test:ida', 'data/route', 1)], type(net)(changed))
            self.assertEqual(preflight(root, [('legacy', 'data/other', 1)], None), {})

    def test_changed_import_source_blocks_preflight_without_mutation(self):
        net, route = fixture_route()
        original = {'type': 'FeatureCollection', 'features': []}
        route['source'] = {'kind': 'wikiroutes', 'track': original}
        route['source']['snapshotHash'] = digest(route['source'])
        route['review']['accepted'] = True
        files = bundle(route, net)['files']
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary) / 'data/route'
            folder.mkdir(parents=True)
            for name, data in files.items():
                (folder / name).write_text(json.dumps(data))
            (folder / 'route_track_trip1.geojson').write_text(json.dumps({'changed': True}))
            before = {p.name: p.read_bytes() for p in folder.iterdir()}
            with self.assertRaises(ValueError):
                preflight(temporary, [('test:ida', 'data/route', 1)], net)
            self.assertEqual(before, {p.name: p.read_bytes() for p in folder.iterdir()})
