"""Protect representative published routes during the authoring rollout."""
import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASELINE = json.loads((Path(__file__).parent / 'fixtures/route_baseline.json').read_text())


class PublishedRouteBaseline(unittest.TestCase):
    def test_source_and_published_artifacts_are_unchanged(self):
        for relative, expected in BASELINE['sha256'].items():
            with self.subTest(file=relative):
                self.assertEqual(hashlib.sha256((ROOT / relative).read_bytes()).hexdigest(), expected)

    def test_directions_and_stop_identity_are_preserved(self):
        routes = json.loads((ROOT / 'pipeline/output/wr_map.json').read_text())['routes']
        for key, expected in BASELINE['routes'].items():
            with self.subTest(route=key):
                self.assertEqual(routes[key], expected)
                stops = json.loads((ROOT / expected['folder'] / f"stops_trip{expected['trip']}.geojson").read_text())['features']
                self.assertGreater(len(stops), 1)
                positions = [s['properties']['seq'] for s in stops]
                self.assertEqual(positions, sorted(positions))
                self.assertTrue(all(s['properties'].get('stop_id') for s in stops))


if __name__ == '__main__':
    unittest.main()
