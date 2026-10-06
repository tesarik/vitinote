#!/usr/bin/env python3
"""VitiNote – lokální server: obsluhuje aplikaci a ukládá data do JSON souboru na disku.

Použití:
    python3 server.py                  # http://localhost:8000, data v ./data/vitinote.json
    python3 server.py --lan            # dostupné i z telefonu ve stejné síti
    python3 server.py --port 9000 --data ~/vinarstvi/vitinote.json

API:
    GET/PUT /api/data          data aplikace (JSON soubor --data)
    GET     /api/por           výtah registru přípravků pro révu (por-reva.json vedle dat)
    POST    /api/por/update    stáhne aktuální registr ÚKZÚZ a výtah přepočítá
"""

import argparse
import json
import os
import shutil
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote

import por_registry

APP_DIR = Path(__file__).resolve().parent
STATIC_FILES = {'/', '/index.html', '/style.css', '/app.js', '/sw.js', '/manifest.webmanifest', '/icon.svg',
                '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'}
MAX_BODY = 20 * 1024 * 1024
write_lock = threading.Lock()
por_lock = threading.Lock()


class Handler(SimpleHTTPRequestHandler):
    data_file: Path
    por_source: str = por_registry.POR_EXPORT_URL

    @property
    def por_file(self):
        return self.data_file.parent / 'por-reva.json'

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/api/data':
            return self.send_data()
        if path == '/api/por':
            return self.send_file_json(self.por_file, 'registr zatím nebyl stažen')
        if path not in STATIC_FILES:
            return self.send_error(404)
        super().do_GET()

    def do_PUT(self):
        if self.path.split('?', 1)[0] != '/api/data':
            return self.send_error(404)
        length = int(self.headers.get('Content-Length') or 0)
        if not 0 < length <= MAX_BODY:
            return self.send_error(413 if length else 400)
        try:
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict) or data.get('version') != 1 or not isinstance(data.get('works'), list):
                raise ValueError('neplatný formát dat')
        except ValueError as e:
            return self.send_json(400, {'error': str(e)})
        with write_lock:
            write_atomic(self.data_file, data)
        self.send_json(200, {'ok': True})

    def do_POST(self):
        if self.path.split('?', 1)[0] != '/api/por/update':
            return self.send_error(404)
        if not por_lock.acquire(blocking=False):
            return self.send_json(409, {'error': 'aktualizace registru už běží'})
        try:
            registry = por_registry.build_vine_registry(self.por_source)
            write_atomic(self.por_file, registry, indent=None, backup=False)
        except Exception as e:  # síť, formát exportu…
            return self.send_json(502, {'error': f'registr se nepodařilo stáhnout: {e}'})
        finally:
            por_lock.release()
        self.log_message('registr POR: %d přípravků pro révu', len(registry['products']))
        self.send_json(200, {'updated': registry['updated'], 'count': len(registry['products'])})

    def send_data(self):
        self.send_file_json(self.data_file, 'zatím žádná data')

    def send_file_json(self, path, missing):
        try:
            body = path.read_bytes()
        except FileNotFoundError:
            return self.send_json(404, {'error': missing})
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Data-File', quote(str(self.data_file)))
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Data-File', quote(str(self.data_file)))
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # Aby prohlížeč vždy kontroloval novou verzi aplikace (offline cache řeší service worker).
        if not self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.command in ('PUT', 'POST') or not self.path.startswith('/api/'):
            super().log_message(fmt, *args)


def write_atomic(path: Path, data, indent=2, backup=True):
    """Zapíše přes dočasný soubor, aby se při pádu nikdy nepoškodil; předchozí verzi nechá jako .bak."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix='.vitinote-', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=indent)
            f.flush()
            os.fsync(f.fileno())
        if backup and path.exists():
            shutil.copy2(path, path.with_suffix(path.suffix + '.bak'))
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def main():
    ap = argparse.ArgumentParser(description='VitiNote server')
    ap.add_argument('--port', type=int, default=8000)
    ap.add_argument('--lan', action='store_true', help='naslouchat na všech rozhraních (přístup z telefonu)')
    ap.add_argument('--data', type=Path, default=APP_DIR / 'data' / 'vitinote.json', help='cesta k JSON souboru s daty')
    ap.add_argument('--por-source', default=por_registry.POR_EXPORT_URL, help='zdroj registru přípravků (URL nebo soubor; pro testy)')
    args = ap.parse_args()

    Handler.data_file = args.data.expanduser().resolve()
    Handler.por_source = args.por_source
    host = '0.0.0.0' if args.lan else '127.0.0.1'
    server = ThreadingHTTPServer((host, args.port), partial(Handler, directory=str(APP_DIR)))
    print(f'VitiNote běží na http://localhost:{args.port}' + (' (i v místní síti)' if args.lan else ''))
    print(f'Data: {Handler.data_file}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
