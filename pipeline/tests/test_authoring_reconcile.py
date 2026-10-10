import copy
import tempfile
import unittest
from pathlib import Path

from pipeline.authoring.engine import Engine
from pipeline.authoring.importer import import_bundle
from pipeline.authoring.reconcile import propose
from pipeline.authoring.service import Service
from pipeline.authoring.store import RevisionConflict
from test_authoring_import import source_fixture
from test_authoring_network import fixture_network


class SourceReconciliationTest(unittest.TestCase):
    def setUp(self):
        self.net = fixture_network()
        self.track, self.stops, self.vias = source_fixture(self.net)
        self.engine = Engine(self.net)
        self.old = self.imported()

    def imported(self, stops=None, track=None):
        return import_bundle(self.engine, 'x-ida', 'X', 'ida', track or self.track, stops or self.stops, self.vias)

    def test_unchanged_import_preserves_path_and_local_stop_edits(self):
        current = copy.deepcopy(self.old)
        current['stops'][0]['name'] = 'Editado'
        current['path'][0]['start'] = .1
        result = propose(current, self.imported())
        self.assertTrue(result['canApply'])
        self.assertFalse(result['sourceChanged'])
        self.assertEqual(result['route']['path'], current['path'])
        self.assertEqual(result['route']['stops'][0]['name'], 'Editado')
        self.assertEqual(current['source'], self.old['source'])

    def test_new_source_stop_is_inserted_without_erasing_local_name(self):
        current = copy.deepcopy(self.old)
        current['stops'][0]['name'] = 'Editado'
        stops = copy.deepcopy(self.stops)
        extra = copy.deepcopy(stops['features'][1])
        extra['properties'].update(stop_id='2', name='Nuevo')
        extra['geometry']['coordinates'] = self.net.nodes[2]
        stops['features'].insert(1, extra)
        result = propose(current, self.imported(stops=stops))
        self.assertTrue(result['canApply'])
        self.assertEqual([s['id'] for s in result['route']['stops']], ['1', '2', '3', '5'])
        self.assertEqual(result['route']['stops'][0]['name'], 'Editado')

    def test_same_field_conflict_requires_an_explicit_choice(self):
        current = copy.deepcopy(self.old)
        current['stops'][0]['name'] = 'Local'
        stops = copy.deepcopy(self.stops)
        stops['features'][0]['properties']['name'] = 'Fuente nueva'
        incoming = self.imported(stops=stops)
        conflict = propose(current, incoming)
        self.assertFalse(conflict['canApply'])
        key = conflict['conflicts'][0]['key']
        self.assertEqual(propose(current, incoming, {key: 'local'})['route']['stops'][0]['name'], 'Local')
        self.assertEqual(propose(current, incoming, {key: 'incoming'})['route']['stops'][0]['name'], 'Fuente nueva')
        with self.assertRaises(ValueError):
            propose(current, incoming, {'invented': 'local'})

    def test_removing_an_edited_stop_cannot_silently_drop_it(self):
        current = copy.deepcopy(self.old)
        current['stops'][1]['coordinates'][0] += .00001
        stops = copy.deepcopy(self.stops)
        stops['features'].pop(1)
        result = propose(current, self.imported(stops=stops))
        self.assertFalse(result['canApply'])
        self.assertIn('stop:3#1', [c['key'] for c in result['conflicts']])
        self.assertIn('3', [s['id'] for s in result['route']['stops']])

    def test_changed_track_requires_review_of_an_edited_path(self):
        current = copy.deepcopy(self.old)
        current['path'][0]['start'] = .1
        track = copy.deepcopy(self.track)
        track['features'][0]['geometry']['coordinates'][1][0] += .0001
        incoming = self.imported(track=track)
        proposal = propose(current, incoming)
        self.assertFalse(proposal['canApply'])
        self.assertIn('path', [c['key'] for c in proposal['conflicts']])
        selected = propose(current, incoming, {'path': 'local'})
        self.assertEqual(selected['route']['path'], current['path'])
        self.assertFalse(selected['route']['review']['accepted'])

    def test_api_proposal_is_read_only_apply_checks_hash_revision_and_resets_acceptance(self):
        with tempfile.TemporaryDirectory() as temporary:
            service = Service(self.net, temporary, Path(temporary) / 'workspace')
            current = service.store.save(self.old, 0, accept=True)
            stops = copy.deepcopy(self.stops)
            stops['features'][1]['properties']['name'] = 'Actualizado'
            request = {'operation': 'propose-update', 'routeId': 'x-ida',
                       'bundle': {'id': 'x-ida', 'name': 'X', 'direction': 'ida', 'track': self.track, 'stops': stops, 'vias': self.vias}}
            result = service.call(request)['result']
            self.assertEqual(service.store.get('x-ida'), current)
            applied = service.call({**request, 'operation': 'apply-update', 'expectedRevision': 1, 'proposalHash': result['proposalHash']})['result']['route']
            self.assertEqual(applied['revision'], 2)
            self.assertEqual(applied['stops'][1]['name'], 'Actualizado')
            self.assertFalse(applied['review']['accepted'])
            with self.assertRaises(RevisionConflict):
                service.call({**request, 'operation': 'apply-update', 'expectedRevision': 1, 'proposalHash': result['proposalHash']})
            self.assertEqual(len(list((Path(temporary) / 'workspace/routes/history').glob('*/*.json'))), 2)
