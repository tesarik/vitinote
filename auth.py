"""Heslo pro přístup k VitiNote z místní sítě (server.py --lan).

Heslo se ukládá jen jako PBKDF2 hash do heslo.json vedle dat. Po přihlášení dostane prohlížeč podepsanou
cookie (HMAC s tajným klíčem z heslo.json) s platností SESSION_DAYS; změna hesla klíč vymění a tím
odhlásí všechna zařízení. Přístup přímo z počítače, kde server běží (127.0.0.1), heslo nevyžaduje.
"""

import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path

ITERATIONS = 200_000
COOKIE = 'vitinote_session'
SESSION_DAYS = 90
MIN_LENGTH = 6


def _hash(password: str, salt: bytes, iterations: int) -> str:
    return hashlib.pbkdf2_hmac('sha256', password.encode(), salt, iterations).hex()


def save_password(path: Path, password: str):
    if len(password) < MIN_LENGTH:
        raise ValueError(f'heslo musí mít aspoň {MIN_LENGTH} znaků')
    salt = secrets.token_bytes(16)
    cfg = {
        'salt': salt.hex(),
        'iterations': ITERATIONS,
        'hash': _hash(password, salt, ITERATIONS),
        'secret': secrets.token_hex(32),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as f:
        json.dump(cfg, f)
    os.replace(tmp, path)


def load(path: Path):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return None


def verify_password(cfg: dict, password: str) -> bool:
    expected = _hash(password, bytes.fromhex(cfg['salt']), cfg['iterations'])
    return hmac.compare_digest(expected, cfg['hash'])


def _sign(cfg: dict, payload: str) -> str:
    return hmac.new(bytes.fromhex(cfg['secret']), payload.encode(), hashlib.sha256).hexdigest()


def make_token(cfg: dict, now=None) -> str:
    expires = int((now or time.time()) + SESSION_DAYS * 86400)
    return f'{expires}.{_sign(cfg, str(expires))}'


def check_token(cfg: dict, token: str, now=None) -> bool:
    expires, _, signature = (token or '').partition('.')
    if not expires.isdigit() or int(expires) < (now or time.time()):
        return False
    return hmac.compare_digest(signature, _sign(cfg, expires))




LOGIN_HTML = Path(__file__).resolve().parent / 'login.html'   # sdílí i PHP verze (php/lib.php)


def login_page(error=False) -> bytes:
    msg = '<p class="error">Nesprávné heslo.</p>' if error else ''
    return LOGIN_HTML.read_text(encoding='utf-8').replace('{error}', msg).encode()
