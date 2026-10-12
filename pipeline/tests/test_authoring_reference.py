import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from pipeline.authoring.model import digest, geometry, path_parts, validate
from pipeline.authoring.service import Service
from pipeline.authoring.store import RevisionConflict
from pipeline.scripts.atu.sources import URLS, json_bytes

ROOT = Path(__file__).resolve().parents[2]


class ReferenceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.raw = (ROOT / 'data/raw/atu_geovisor/pmu_sit.geojson').read_bytes()
        self.source = json.loads(self.raw)
        path = self.root / 'data/raw/atu_geovisor/pmu_sit.geojson'
        path.parent.mkdir(parents=True)
        path.write_bytes(self.raw)
        self.service = Service(None, self.root, self.root / 'workspace')
        feature = next(f for f in self.source['features'] if f['properties']['OBJECTID'] == 90)
        self.bundle = {'id': 'metro-pmu-l2-pendiente', 'name': feature['properties']['nombre'],
            'direction': 'referencia', 'track': {'type': 'FeatureCollection', 'features': [feature]},
            'stops': {'type': 'FeatureCollection', 'features': []},
            'provenance': {'publisher': 'ATU', 'sourceKind': 'official_plan', 'transportMode': 'rail',
                'geometryPolicy': 'preserve', 'plannerEligible': False, 'sourceUrl': URLS['pmu'],
                'sourceCrs': 'OGC:CRS84', 'sourceObjectId': 90,
                'sourceFileSha256': hashlib.sha256(self.raw).hexdigest(),
                'sourceGeometrySha256': digest(feature['geometry'])}}

    def call(self, operation, **kwargs):
        return self.service.call({'operation': operation, **kwargs})['result']

    def import_route(self):
        return self.call('import', bundle=self.bundle)['route']

    def test_multipart_import_accept_export_without_osm_or_station_invention(self):
        route = self.import_route()
        packed = self.call('validate', route=route)
        self.assertTrue(packed['validation']['ready'])
        self.assertEqual(len(packed['segments']), 2)
        self.assertEqual(packed['geometry'], self.bundle['track']['features'][0]['geometry'])
        self.assertEqual(geometry(route,None),packed['geometry'])
        self.assertEqual(len(path_parts(route,None)),2)
        self.assertTrue(validate(route,None)['ready'])
        self.call('save', route=route, expectedRevision=0)
        self.call('accept', routeId=route['id'], expectedRevision=1)
        result = self.call('export', routeId=route['id'])
        self.assertEqual(set(result['files']), {'project.geojson', 'project.reference.json'})
        feature = result['files']['project.geojson']['features'][0]
        self.assertEqual(feature['geometry'], packed['geometry'])
        self.assertFalse(feature['properties']['plannerEligible'])
        self.assertFalse(feature['properties']['operativo'])
        self.assertEqual(route['stops'], [])
        self.assertTrue(result['validation']['accepted'])
        self.assertIsNone(self.call('health')['network'])

    def test_source_hash_geometry_crs_and_official_snapshot_are_verified(self):
        for kind in ('geometry', 'crs', 'hash', 'stations', 'spoofed-feature'):
            bad = copy.deepcopy(self.bundle)
            if kind == 'geometry':
                bad['track']['features'][0]['geometry']['coordinates'][0][0][0] += .001
            elif kind == 'crs':
                bad['provenance']['sourceCrs'] = 'EPSG:32718'
            elif kind == 'hash':
                bad['provenance']['sourceFileSha256'] = '0' * 64
            elif kind == 'stations':
                bad['stops']['features'] = [{'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [0, 0]}}]
            else:
                bad['track']['features'][0]['properties']['nombre'] = 'Inventado'
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                self.call('import', bundle=bad)

    def test_rail_cannot_be_matched_rebuilt_promoted_or_flattened(self):
        route = self.import_route()
        for operation in ('match', 'rebuild', 'replace'):
            with self.assertRaisesRegex(ValueError, 'ferroviaria'):
                self.call(operation, route=route)
        for field, value in (('plannerEligible', True), ('operativo', True), ('ruteable', True),
                             ('path', [{'type': 'gap', 'coordinates': [[-77, -12], [-77.1, -12.1]]}])):
            bad = copy.deepcopy(route); bad[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.call('accept', route=bad, expectedRevision=0)

    def test_saved_revision_and_source_immutability_apply_to_references(self):
        route = self.import_route()
        self.call('accept', route=route, expectedRevision=0)
        with self.assertRaises(RevisionConflict):
            self.call('save', route=route, expectedRevision=0)
        changed = self.service.store.get(route['id']); changed['name'] = 'Nombre sin revisar'
        with self.assertRaisesRegex(ValueError, 'Guarda y acepta'):
            self.call('export', route=changed)
        changed['source']['provenance']['sourceUrl'] = 'https://example.com'
        with self.assertRaises(ValueError):
            self.call('save', route=changed, expectedRevision=1)

    def test_source_update_requires_hash_review_and_preserves_local_label(self):
        route = self.import_route(); route['name'] = 'Nombre local'
        self.call('accept', route=route, expectedRevision=0)
        incoming = copy.deepcopy(self.bundle); incoming['name'] = 'Nuevo nombre remoto'
        proposal = self.call('propose-update', routeId=route['id'], bundle=incoming)
        self.assertFalse(proposal['canApply'])
        proposal = self.call('propose-update', routeId=route['id'], bundle=incoming, choices={'name': 'local'})
        with self.assertRaises(RevisionConflict):
            self.call('apply-update', routeId=route['id'], bundle=incoming, choices={'name': 'local'},
                      proposalHash='invalid', expectedRevision=1)
        result = self.call('apply-update', routeId=route['id'], bundle=incoming, choices={'name': 'local'},
                           proposalHash=proposal['proposalHash'], expectedRevision=1)
        self.assertEqual(result['route']['name'], 'Nombre local')
        self.assertFalse(result['validation']['accepted'])
        self.assertEqual(result['route']['revision'], 2)
        self.assertEqual(len(list((self.root / 'workspace/routes/history').rglob('*.json'))), 2)

    def test_new_official_snapshot_updates_geometry_without_changing_old_history(self):
        route = self.import_route()
        self.call('accept', route=route, expectedRevision=0)
        previous = self.service.store.get(route['id'])
        collection = copy.deepcopy(self.source)
        feature = next(f for f in collection['features'] if f['properties']['OBJECTID'] == 90)
        feature['geometry']['coordinates'][0][0][0] += .00001
        raw = json_bytes(collection)
        (self.root / 'data/raw/atu_geovisor/pmu_sit.geojson').write_bytes(raw)
        incoming = copy.deepcopy(self.bundle)
        incoming['track']['features'] = [feature]
        incoming['provenance'].update(sourceFileSha256=hashlib.sha256(raw).hexdigest(),
                                      sourceGeometrySha256=digest(feature['geometry']))
        proposal = self.call('propose-update', routeId=route['id'], bundle=incoming)
        self.assertTrue(proposal['canApply'])
        result = self.call('apply-update', routeId=route['id'], bundle=incoming,
                           proposalHash=proposal['proposalHash'], expectedRevision=1)
        self.assertEqual(result['geometry'], feature['geometry'])
        self.assertFalse(result['validation']['accepted'])
        history = list((self.root / 'workspace/routes/history').rglob('000001.json'))
        self.assertEqual(json.loads(history[0].read_text()), previous)
