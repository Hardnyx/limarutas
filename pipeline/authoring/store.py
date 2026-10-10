"""Isolated draft storage with optimistic revisions and immutable history."""
from __future__ import annotations

import copy
import hashlib
import json
import os
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path


class RevisionConflict(ValueError):
    pass


@contextmanager
def writer_lock(path):
    """Serialize CLI and HTTP writers too, not just threads in one server."""
    with open(path, 'a+b') as stream:
        if os.name == 'nt':
            import msvcrt
            stream.seek(0, os.SEEK_END)
            if stream.tell() == 0:
                stream.write(b'\0')
                stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == 'nt':
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


class Store:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()

    def path(self, route_id):
        return self.directory / (hashlib.sha256(route_id.encode()).hexdigest() + '.json')

    def get(self, route_id):
        path = self.path(route_id)
        if not path.is_file():
            raise ValueError('Borrador no encontrado')
        return json.loads(path.read_text())

    def list(self):
        return [{k: r[k] for k in ('id', 'name', 'direction', 'revision')} for p in sorted(self.directory.glob('*.json'))
                for r in [json.loads(p.read_text())]]

    def save(self, route, expected_revision, accept=False, source_update=False):
        with self.lock, writer_lock(self.directory / '.writer.lock'):
            path = self.path(route['id'])
            previous = self.get(route['id']) if path.exists() else None
            revision = previous['revision'] if previous else 0
            if type(expected_revision) is not int or expected_revision != revision:
                raise RevisionConflict('El borrador cambió; vuelve a cargarlo antes de guardar')
            if previous and previous['source'] != route['source'] and not source_update:
                raise ValueError('La fuente es inmutable; importa su actualización como propuesta separada')
            saved = copy.deepcopy(route)
            saved['revision'] = revision + 1
            saved.setdefault('review', {})['accepted'] = bool(accept)
            text = json.dumps(saved, ensure_ascii=False, separators=(',', ':'), allow_nan=False)+'\n'
            history = self.directory / 'history' / path.stem
            history.mkdir(parents=True, exist_ok=True)
            historical = history / f'{saved["revision"]:06}.json'
            # Create history first: an interrupted update is recoverable.
            if historical.exists():
                if historical.read_text() != text:
                    raise RevisionConflict('Existe una revisión pendiente de recuperación')
            else:
                historical.write_text(text)
            fd, temporary = tempfile.mkstemp(dir=self.directory, prefix='.route-')
            try:
                with os.fdopen(fd, 'w') as output:
                    output.write(text)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
            return saved
