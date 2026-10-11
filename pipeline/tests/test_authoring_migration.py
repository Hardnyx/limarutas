import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pipeline.authoring.engine import Engine
from pipeline.authoring.importer import import_bundle
from pipeline.authoring.migration import legacy_equivalence, stage, publish_staged
from test_authoring_import import source_fixture
from test_authoring_network import fixture_network


class GeometryPreservingMigrationTest(unittest.TestCase):
    def fixture(self):
        network = fixture_network()
        engine = Engine(network)
        track, stops, vias = source_fixture(network)
        record = engine.matcher.decode(vias)
        matched = {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {},
            'geometry': {'type': 'LineString',
                'coordinates': [[lon, lat] for lat, lon in engine.matcher.geometry(record)]}}]}
        route = import_bundle(engine, 'x-ida', 'X', 'ida', track, stops, vias, matched=matched)
        return engine, route

    def test_restoring_curve_vertices_keeps_the_encoded_itinerary(self):
        engine, route = self.fixture()
        self.assertTrue(legacy_equivalence(route, engine)['equivalent'])
        changed = copy.deepcopy(route)
        changed['source']['matched']['features'][0]['geometry']['coordinates'][0][0] += .001
        self.assertFalse(legacy_equivalence(changed, engine)['equivalent'])
        changed = copy.deepcopy(route)
        changed['path'] = changed['path'][1:]
        self.assertFalse(legacy_equivalence(changed, engine)['equivalent'])

    def test_staging_cannot_write_into_site_data_even_when_directory_is_new(self):
        engine, _ = self.fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                stage(root, engine, [], root / 'data/new-folder')
            self.assertFalse((root / 'data').exists())

    def prepared(self, root, keys=('x-ida',)):
        engine, route = self.fixture()
        definitions = {}
        for key in keys:
            folder = root / 'data' / key
            folder.mkdir(parents=True)
            definitions[key] = {'folder': f'data/{key}', 'trip': 1, 'name': key, 'osm': True}
            for field, name in [('track', 'route_track_trip1.geojson'), ('stops', 'stops_trip1.geojson'),
                                ('vias', 'route_track_trip1.vias.json'), ('matched', 'route_track_trip1.osm.geojson')]:
                (folder / name).write_text(json.dumps(route['source'][field], indent=2))
        catalog = root / 'pipeline/output/wr_map.json'
        catalog.parent.mkdir(parents=True)
        catalog.write_text(json.dumps({'routes': definitions}))
        prepared = root / 'pipeline/temp/staged'
        report = stage(root, engine, keys, prepared)
        self.assertEqual(report['summary'], {'staged': len(keys)})
        return engine, prepared

    def test_publication_preserves_source_and_stops_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            engine, prepared = self.prepared(root)
            originals = {p: p.read_bytes() for p in (root / 'data').rglob('*') if p.is_file() and '.osm.' not in p.name}
            result = publish_staged(root, engine, prepared, ['x-ida'])
            self.assertEqual(result['files'], 2)
            self.assertTrue((root / 'data/x-ida/route_track_trip1.route.json').exists())
            self.assertTrue(all(p.read_bytes() == content for p, content in originals.items()))

    def test_late_source_change_rejects_entire_batch_before_any_write(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            engine, prepared = self.prepared(root, ['x-ida', 'y-ida'])
            (root / 'data/y-ida/stops_trip1.geojson').write_text('{}')
            before = {p: p.read_bytes() for p in (root / 'data').rglob('*') if p.is_file()}
            with self.assertRaises(ValueError):
                publish_staged(root, engine, prepared, ['x-ida', 'y-ida'])
            self.assertEqual(before, {p: p.read_bytes() for p in (root / 'data').rglob('*') if p.is_file()})

    def test_write_failure_rolls_back_already_written_geometry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            engine, prepared = self.prepared(root)
            before = {p: p.read_bytes() for p in (root / 'data').rglob('*') if p.is_file()}
            import os
            replace = os.replace
            calls = []
            def fail_second(source, destination):
                calls.append(destination)
                if len(calls) == 2:
                    raise OSError('Write failed')
                return replace(source, destination)
            with patch('pipeline.authoring.migration.os.replace', side_effect=fail_second):
                with self.assertRaises(OSError):
                    publish_staged(root, engine, prepared, ['x-ida'])
            self.assertEqual(before, {p: p.read_bytes() for p in (root / 'data').rglob('*') if p.is_file()})
