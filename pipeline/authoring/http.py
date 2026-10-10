"""Local HTTP transport for the same route operations used by the pipeline."""
from __future__ import annotations

import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

from .resolver import AmbiguousPlace
from .store import RevisionConflict


def server(service, host='127.0.0.1', port=8081):
    class Handler(BaseHTTPRequestHandler):
        def respond(self, status, payload):
            raw = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            path = unquote(urlparse(self.path).path)
            if path == '/api/v1/health':
                self.respond(200, service.call({'operation': 'health'}))
                return
            if path == '/':
                path = '/editor.html'
            permitted = (path in ('/editor.html', '/docs/ROUTE_AUTHORING.md') or path.startswith('/assets/js/routeAuthoring')
                         or path == '/assets/css/route-editor.css'
                         or path.startswith('/node_modules/leaflet/dist/'))
            file = (service.root / path.lstrip('/')).resolve()
            if not permitted or not file.is_relative_to(service.root) or not file.is_file():
                self.respond(404, {'error': 'Recurso no encontrado'})
                return
            content = file.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)

        def do_POST(self):
            if urlparse(self.path).path != '/api/v1/operations':
                self.respond(404, {'error': 'Operación no encontrada'})
                return
            origin = self.headers.get('Origin')
            if origin and urlparse(origin).netloc != self.headers.get('Host'):
                self.respond(403, {'error': 'Abre el editor desde el mismo servicio'})
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 8_000_000:
                    self.respond(413, {'error': 'Solicitud vacía o demasiado grande'})
                    return
                payload = json.loads(self.rfile.read(length))
                self.respond(200, service.call(payload))
            except RevisionConflict as error:
                self.respond(409, {'error': str(error), 'code': 'revisionConflict'})
            except AmbiguousPlace as error:
                self.respond(422, {'error': str(error), 'code': 'ambiguousPlace', 'candidates': error.candidates})
            except (ValueError, KeyError, TypeError, IndexError, UnicodeDecodeError) as error:
                self.respond(400, {'error': str(error)})

        def log_message(self, *_):
            pass

    return ThreadingHTTPServer((host, port), Handler)
