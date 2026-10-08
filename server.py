#!/usr/bin/env python3
"""VitiNote – lokální server: obsluhuje aplikaci a ukládá data do JSON souboru na disku.

Použití:
    python3 server.py                  # http://localhost:8000, data v ./data/vitinote.json
    python3 server.py --set-password   # nastaví heslo pro přístup z místní sítě
    python3 server.py --lan            # dostupné i z telefonu ve stejné síti (vyžaduje heslo)
    python3 server.py --port 9000 --data ~/vinarstvi/vitinote.json

API:
    GET/PUT /api/data          data aplikace (JSON soubor --data)
    GET     /api/por           výtah registru přípravků pro révu (por-reva.json vedle dat)
    POST    /api/por/update    stáhne aktuální registr ÚKZÚZ a výtah přepočítá
    GET/POST /login, GET /logout   přihlášení heslem (jen pokud je heslo nastavené, viz auth.py)
"""

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
from datetime import date
from getpass import getpass
from http.cookies import SimpleCookie
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote

import auth
import por_registry

APP_DIR = Path(__file__).resolve().parent
STATIC_FILES = {'/', '/index.html', '/style.css', '/sw.js', '/manifest.webmanifest', '/icon.svg',
                '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'}
STATIC_MODULES = re.compile(r'^/js/(forms/)?[a-z0-9-]+\.js$')   # ES moduly aplikace
MAX_BODY = 20 * 1024 * 1024
write_lock = threading.Lock()
por_lock = threading.Lock()


class Handler(SimpleHTTPRequestHandler):
    data_file: Path
    keep_backups: int = 30
    por_source: str = por_registry.POR_EXPORT_URL
    auth_local: bool = False      # vyžadovat heslo i z tohoto počítače (pro testy)

    @property
    def por_file(self):
        return self.data_file.parent / 'por-reva.json'

    # --- přihlášení

    def auth_config(self):
        """Nastavení hesla, pokud se tento požadavek musí přihlásit; jinak None."""
        local = self.client_address[0] in ('127.0.0.1', '::1', '::ffff:127.0.0.1')
        if local and not self.auth_local:
            return None
        return auth.load(auth_file(self.data_file))

    def logged_in(self, cfg):
        cookie = SimpleCookie(self.headers.get('Cookie', ''))
        return auth.COOKIE in cookie and auth.check_token(cfg, cookie[auth.COOKIE].value)

    def require_login(self, path):
        """Hlídá stránku aplikace a API (statické soubory jsou veřejné na GitHubu). Vrací True, pokud odpověděl sám."""
        if path not in ('/', '/index.html') and not path.startswith('/api/'):
            return False
        cfg = self.auth_config()
        if cfg is None or self.logged_in(cfg):
            self.session = cfg is not None
            return False
        if path.startswith('/api/'):
            self.send_json(401, {'error': 'nepřihlášeno'})
        else:
            self.redirect('login')
        return True

    def redirect(self, location, cookie=None):
        self.send_response(303)
        self.send_header('Location', location)
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def handle_login(self):
        cfg = auth.load(auth_file(self.data_file))
        length = min(int(self.headers.get('Content-Length') or 0), 4096)
        password = parse_qs(self.rfile.read(length).decode('utf-8', 'replace')).get('heslo', [''])[0]
        if cfg and auth.verify_password(cfg, password):
            token = auth.make_token(cfg)
            return self.redirect('./', f'{auth.COOKIE}={token}; Max-Age={auth.SESSION_DAYS * 86400}; Path=/; HttpOnly; SameSite=Strict')
        time.sleep(1)  # zpomalit zkoušení hesel
        self.log_message('neúspěšné přihlášení')
        self.redirect('login?chyba=1')

    def send_login_page(self):
        body = auth.login_page(error='chyba=1' in self.path)
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # --- požadavky

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/login':
            return self.send_login_page()
        if path == '/logout':
            return self.redirect('login', f'{auth.COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict')
        if self.require_login(path):
            return
        if path == '/api/data':
            return self.send_data()
        if path == '/api/por':
            return self.send_file_json(self.por_file, 'registr zatím nebyl stažen')
        if path not in STATIC_FILES and not STATIC_MODULES.match(path):
            return self.send_error(404)
        super().do_GET()

    def read_json_body(self, valid, message):
        """Načte JSON z těla požadavku; při chybě odpoví sám a vrátí None."""
        length = int(self.headers.get('Content-Length') or 0)
        if not 0 < length <= MAX_BODY:
            self.send_error(413 if length else 400)
            return None
        try:
            data = json.loads(self.rfile.read(length))
            if not valid(data):
                raise ValueError(message)
        except ValueError as e:
            self.send_json(400, {'error': str(e)})
            return None
        return data

    def do_PUT(self):
        if self.path.split('?', 1)[0] != '/api/data':
            return self.send_error(404)
        self.save_data()

    def save_data(self):
        if self.require_login('/api/data'):
            return
        data = self.read_json_body(
            lambda d: isinstance(d, dict) and d.get('version') == 1 and isinstance(d.get('works'), list), 'neplatný formát dat')
        if data is None:
            return
        with write_lock:
            write_atomic(self.data_file, data)
            daily_backup(self.data_file, self.keep_backups)
        self.send_json(200, {'ok': True})

    def do_POST(self):
        path = self.path.split('?', 1)[0]
        if path == '/login':
            return self.handle_login()
        if path == '/api/data':   # aplikace ukládá přes POST (některé hostingy PUT blokují); PUT zůstává funkční
            return self.save_data()
        if path == '/api/por/upload':
            return self.upload_registry()
        if path != '/api/por/update':
            return self.send_error(404)
        if self.require_login(path):
            return
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

    def upload_registry(self):
        """Hotový výtah registru (por-reva.json z `python3 por_registry.py`), když stažení na serveru neprojde."""
        if self.require_login('/api/por/upload'):
            return
        registry = self.read_json_body(por_registry.is_registry, 'není to výtah registru (por-reva.json)')
        if registry is None:
            return
        write_atomic(self.por_file, registry, indent=None, backup=False)
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
        self.send_header('X-Backups', f'{quote(str(backup_dir(self.data_file)))};keep={self.keep_backups}')
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

    session = False

    def end_headers(self):
        if self.session:
            self.send_header('X-Auth', 'session')
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


def auth_file(data_file: Path) -> Path:
    return data_file.parent / 'heslo.json'


def set_password(data_file: Path):
    """Nastaví heslo: interaktivně, nebo ze stdin (dva řádky) při spuštění bez terminálu."""
    if sys.stdin.isatty():
        first, second = getpass('Nové heslo: '), getpass('Heslo znovu: ')
    else:
        first, second = (sys.stdin.readline().rstrip('\n') for _ in range(2))
    if first != second:
        sys.exit('Hesla se neshodují.')
    try:
        auth.save_password(auth_file(data_file), first)
    except ValueError as e:
        sys.exit(f'Chyba: {e}')
    print(f'Heslo uloženo do {auth_file(data_file)}. Přihlášená zařízení se musí přihlásit znovu.')


def backup_dir(data_file: Path) -> Path:
    return data_file.parent / 'zalohy'


def daily_backup(data_file: Path, keep: int, today=None):
    """Kopie dat za každý den (poslední stav dne) do zalohy/<jméno>-RRRR-MM-DD.json; drží `keep` nejnovějších dnů."""
    if keep <= 0:
        return
    folder = backup_dir(data_file)
    folder.mkdir(parents=True, exist_ok=True)
    day = (today or date.today()).isoformat()
    shutil.copy2(data_file, folder / f'{data_file.stem}-{day}.json')
    backups = sorted(folder.glob(f'{data_file.stem}-????-??-??.json'))
    for old in backups[:-keep]:
        old.unlink()


def main():
    ap = argparse.ArgumentParser(description='VitiNote server')
    ap.add_argument('--port', type=int, default=8000)
    ap.add_argument('--lan', action='store_true', help='naslouchat na všech rozhraních (přístup z telefonu)')
    ap.add_argument('--data', type=Path, default=APP_DIR / 'data' / 'vitinote.json', help='cesta k JSON souboru s daty')
    ap.add_argument('--set-password', action='store_true', help='nastavit heslo pro přístup z místní sítě a skončit')
    ap.add_argument('--no-password', action='store_true', help='povolit --lan bez hesla (nedoporučeno)')
    ap.add_argument('--auth-local', action='store_true', help=argparse.SUPPRESS)  # testy: heslo i z localhostu
    ap.add_argument('--keep-backups', type=int, default=30, help='kolik denních záloh dat držet (0 = žádné)')
    ap.add_argument('--por-source', default=por_registry.POR_EXPORT_URL, help='zdroj registru přípravků (URL nebo soubor; pro testy)')
    args = ap.parse_args()

    Handler.data_file = args.data.expanduser().resolve()
    if args.set_password:
        return set_password(Handler.data_file)
    has_password = auth.load(auth_file(Handler.data_file)) is not None
    if args.lan and not has_password and not args.no_password:
        sys.exit('Pro přístup z místní sítě nejdřív nastav heslo:  bin/vitinote --set-password\n'
                 '(nebo spusť s --no-password, pak může data měnit kdokoli ve stejné síti)')
    Handler.auth_local = args.auth_local
    Handler.por_source = args.por_source
    Handler.keep_backups = args.keep_backups
    host = '0.0.0.0' if args.lan else '127.0.0.1'
    server = ThreadingHTTPServer((host, args.port), partial(Handler, directory=str(APP_DIR)))
    print(f'VitiNote běží na http://localhost:{args.port}' + (' (i v místní síti)' if args.lan else ''))
    if args.lan and has_password:
        print('Přístup z jiných zařízení je chráněný heslem.')
    print(f'Data: {Handler.data_file}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
