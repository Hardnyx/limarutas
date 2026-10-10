import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from pipeline.authoring.http import server
from pipeline.authoring.service import Service
from test_authoring_model import fixture_route


class RouteApiTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.net, self.route = fixture_route()
        root = Path(self.temporary.name)
        self.service = Service(self.net, root, root / 'workspace')
        self.http = server(self.service, port=0)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.http.server_port}/api/v1/operations'

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        self.temporary.cleanup()

    def post(self, request):
        req = urllib.request.Request(self.url, json.dumps(request).encode(), {'Content-Type': 'application/json'})
        return json.loads(urllib.request.urlopen(req).read())

    def test_json_boundary_and_http_return_the_same_result(self):
        request = {'operation': 'validate', 'route': self.route}
        self.assertEqual(self.post(request), self.service.call(request))
        self.assertEqual(self.post({'operation': 'resolve', 'query': {'kind': 'street', 'query': 'Av. Curva'}})['result']['candidates'][0]['way'], 1)

    def test_save_accept_export_and_revision_conflict(self):
        result = self.post({'operation': 'save', 'route': self.route, 'expectedRevision': 0})['result']
        accepted = self.post({'operation': 'accept', 'routeId': self.route['id'], 'expectedRevision': 1})['result']
        self.assertTrue(accepted['validation']['accepted'])
        exported = self.post({'operation': 'export', 'routeId': self.route['id']})['result']
        self.assertFalse(exported['preview'])
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.post({'operation': 'save', 'route': result['route'], 'expectedRevision': 1})
        self.assertEqual(error.exception.code, 409)

    def test_invalid_request_and_source_mutation_do_not_change_store(self):
        self.post({'operation': 'save', 'route': self.route, 'expectedRevision': 0})
        self.route['source']['kind'] = 'corrupted'
        with self.assertRaises(urllib.error.HTTPError):
            self.post({'operation': 'save', 'route': self.route, 'expectedRevision': 1})
        self.assertEqual(self.service.store.get(self.route['id'])['revision'], 1)
        with self.assertRaises(urllib.error.HTTPError):
            self.post({'operation': 'nonexistent'})

    def test_unsaved_geometry_cannot_claim_to_be_an_accepted_export(self):
        self.post({'operation': 'accept', 'route': self.route, 'expectedRevision': 0})
        changed = self.service.store.get(self.route['id'])
        changed['stops'][0]['name'] = 'Not reviewed'
        with self.assertRaises(urllib.error.HTTPError):
            self.post({'operation': 'export', 'route': changed})
        self.assertTrue(self.post({'operation': 'export', 'route': changed, 'preview': True})['result']['preview'])

    def test_restoring_an_export_requires_new_review_and_never_overwrites_a_saved_draft(self):
        self.route['revision'] = 12
        self.route['review']['accepted'] = True
        restored = self.post({'operation': 'restore', 'route': self.route})['result']['route']
        self.assertEqual(restored['revision'], 0)
        self.assertFalse(restored['review']['accepted'])
        self.post({'operation': 'save', 'route': restored, 'expectedRevision': 0})
        with self.assertRaises(urllib.error.HTTPError):
            self.post({'operation': 'restore', 'route': self.route})
        self.assertEqual(self.service.store.get(self.route['id'])['revision'], 1)
