import json
import tempfile
import unittest
from pathlib import Path

from pipeline.authoring.inventory import inventory


class MigrationInventoryTest(unittest.TestCase):
    def test_legacy_osm_does_not_imply_acceptance_and_missing_source_blocks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / 'data/processed/transporte/route_1'
            folder.mkdir(parents=True)
            (root / 'pipeline/output').mkdir(parents=True)
            (root / 'pipeline/output/wr_map.json').write_text(json.dumps({'routes': {
                '1-ida': {'folder': 'data/processed/transporte/route_1', 'trip': 1, 'osm': True}}}))
            for name in ('route_track_trip1.osm.geojson', 'stops_trip1.geojson'):
                (folder / name).write_text('{}')
            before = {p: p.read_bytes() for p in root.rglob('*') if p.is_file()}
            result = inventory(root)
            self.assertEqual(result['routes']['1-ida']['geometry'], 'legacy-osm')
            self.assertEqual(result['routes']['1-ida']['migration'], 'blocked-source')
            self.assertEqual(result['summary']['migration'].get('accepted', 0), 0)
            self.assertEqual(before, {p: p.read_bytes() for p in root.rglob('*') if p.is_file()})
            (folder / 'route_track_trip1.geojson').write_text('{}')
            self.assertEqual(inventory(root)['routes']['1-ida']['migration'], 'pending-review')
            audited = {'network': 'fixture', 'routes': {'1-ida': {'ready': False,
                        'issues': {'wrongDirection': 2}}}, 'summary': {'blockers': {'wrongDirection': 2}}}
            result = inventory(root, audited)
            self.assertEqual(result['routes']['1-ida']['migration'], 'blocked-validation')
            self.assertEqual(result['routes']['1-ida']['validation']['issues'], {'wrongDirection': 2})
            self.assertEqual(result['audit']['ready'], 0)
