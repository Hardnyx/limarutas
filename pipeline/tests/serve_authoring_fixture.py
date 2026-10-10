"""Deterministic HTTP service for real editor interactions in Playwright."""
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from pipeline.authoring.network import Network
from pipeline.authoring.service import Service
from pipeline.authoring.http import server

with tempfile.TemporaryDirectory(prefix='route-editor-test-') as workspace:
    net = Network(json.loads((Path(__file__).parent / 'fixtures/authoring_network.json').read_text()))
    http = server(Service(net, ROOT, workspace), port=8777)
    try:
        http.serve_forever()
    finally:
        http.server_close()
