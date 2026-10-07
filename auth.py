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


LOGIN_PAGE = """<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#6b1d3a"><title>VitiNote – přihlášení</title><link rel="icon" href="icon.svg">
<style>
:root { --bg:#faf7f5; --surface:#fff; --text:#241a1d; --muted:#6f6266; --border:#e4dcd8; --accent:#6b1d3a; --accent-text:#fff; --danger:#b3261e; }
@media (prefers-color-scheme: dark) { :root { --bg:#171214; --surface:#211a1d; --text:#f1e9ec; --muted:#b3a5aa; --border:#3a2f33; --accent:#d4789b; --accent-text:#1a0f13; --danger:#ff8a80; } }
* { box-sizing: border-box; }
body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--text); font:16px/1.45 system-ui, sans-serif; padding:16px; }
form { background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:24px; width:min(360px, 100%); }
h1 { display:flex; align-items:center; gap:10px; font-size:1.3rem; margin:0 0 16px; }
label { display:block; font-size:.85rem; font-weight:600; color:var(--muted); margin-bottom:4px; }
input { width:100%; font:inherit; color:var(--text); background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:10px; }
button { margin-top:14px; width:100%; font:inherit; font-weight:600; border:0; border-radius:8px; padding:10px; background:var(--accent); color:var(--accent-text); cursor:pointer; }
.error { color:var(--danger); font-size:.9rem; margin:10px 0 0; }
</style></head><body>
<form method="post" action="login">
  <h1><img src="icon.svg" alt="" width="32" height="32"> VitiNote</h1>
  <label for="heslo">Heslo</label>
  <input id="heslo" name="heslo" type="password" autocomplete="current-password" autofocus required>
  {error}
  <button type="submit">Přihlásit</button>
</form></body></html>"""


def login_page(error=False) -> bytes:
    msg = '<p class="error">Nesprávné heslo.</p>' if error else ''
    return LOGIN_PAGE.replace('{error}', msg).encode()
