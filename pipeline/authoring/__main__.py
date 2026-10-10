"""JSON route operations and optional local HTTP editor service."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .exporter import write_bundle
from .http import server
from .service import load_service

ROOT = Path(__file__).resolve().parents[2]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--network', default=str(ROOT / 'pipeline/temp/authoring/network.json'))
    parser.add_argument('--workspace', default=str(ROOT / 'pipeline/temp/authoring/workspace'))
    commands = parser.add_subparsers(dest='command', required=True)
    call = commands.add_parser('call', help='Execute a JSON operation, from a file or stdin')
    call.add_argument('--request', default='-')
    serve = commands.add_parser('serve', help='Serve the editor and API on loopback')
    serve.add_argument('--host', default='127.0.0.1')
    serve.add_argument('--port', default=8081, type=int)
    export = commands.add_parser('export', help='Export a saved route to an isolated bundle')
    export.add_argument('route_id')
    export.add_argument('--directory', required=True)
    export.add_argument('--preview', action='store_true')
    args = parser.parse_args(argv)
    workspace = Path(args.workspace).resolve()
    if workspace.is_relative_to(ROOT) and not workspace.is_relative_to(ROOT / 'pipeline/temp'):
        raise ValueError('Los borradores dentro del repositorio se guardan en pipeline/temp')
    service = load_service(args.network, ROOT, workspace)
    if args.command == 'call':
        request = json.load(sys.stdin) if args.request == '-' else json.loads(Path(args.request).read_text())
        print(json.dumps(service.call(request), ensure_ascii=False, allow_nan=False))
    elif args.command == 'export':
        result = service.call({'operation': 'export', 'routeId': args.route_id, 'preview': args.preview})['result']
        print(json.dumps(write_bundle(result, args.directory, ROOT), ensure_ascii=False, indent=2))
    else:
        http = server(service, args.host, args.port)
        print(f'Editor: http://{args.host}:{http.server_port}/editor.html', flush=True)
        try:
            http.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            http.server_close()


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError) as error:
        print(f'Route authoring: {error}', file=sys.stderr)
        sys.exit(1)
