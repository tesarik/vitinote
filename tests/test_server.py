"""Testy pomocných funkcí serveru (python3 -m unittest, spouští i npm test)."""
import json
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import auth  # noqa: E402
import server  # noqa: E402


class DailyBackup(unittest.TestCase):
    def test_one_file_per_day_keeps_last_state_and_rotates(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / 'vitinote.json'
            start = date(2026, 1, 1)
            for i in range(5):
                for version in ('ráno', 'večer'):
                    server.write_atomic(data, {'den': i, 'verze': version})
                    server.daily_backup(data, keep=3, today=start + timedelta(days=i))
            files = sorted(p.name for p in server.backup_dir(data).iterdir())
            self.assertEqual(files, ['vitinote-2026-01-03.json', 'vitinote-2026-01-04.json', 'vitinote-2026-01-05.json'])
            last = json.loads((server.backup_dir(data) / 'vitinote-2026-01-05.json').read_text())
            self.assertEqual(last, {'den': 4, 'verze': 'večer'})

    def test_disabled(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / 'vitinote.json'
            server.write_atomic(data, {})
            server.daily_backup(data, keep=0)
            self.assertFalse(server.backup_dir(data).exists())


class Password(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'heslo.json'
        auth.save_password(self.path, 'tajne-heslo')
        self.cfg = auth.load(self.path)

    def tearDown(self):
        self.tmp.cleanup()

    def test_only_hash_is_stored_privately(self):
        self.assertNotIn('tajne-heslo', self.path.read_text())
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_verify(self):
        self.assertTrue(auth.verify_password(self.cfg, 'tajne-heslo'))
        self.assertFalse(auth.verify_password(self.cfg, 'spatne'))

    def test_too_short(self):
        with self.assertRaises(ValueError):
            auth.save_password(self.path, '123')

    def test_token_valid_expired_tampered(self):
        token = auth.make_token(self.cfg, now=1_000_000)
        self.assertTrue(auth.check_token(self.cfg, token, now=1_000_000 + 86400))
        self.assertFalse(auth.check_token(self.cfg, token, now=1_000_000 + (auth.SESSION_DAYS + 1) * 86400))
        expires, sig = token.split('.')
        self.assertFalse(auth.check_token(self.cfg, f'{int(expires) + 999}.{sig}', now=1_000_000))
        self.assertFalse(auth.check_token(self.cfg, 'nesmysl', now=1_000_000))

    def test_password_change_logs_out(self):
        token = auth.make_token(self.cfg)
        auth.save_password(self.path, 'nove-heslo')
        self.assertFalse(auth.check_token(auth.load(self.path), token))


class LanRequiresPassword(unittest.TestCase):
    def test_refuses_to_start(self):
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            r = subprocess.run([sys.executable, str(Path(server.__file__)), '--lan', '--port', '0', '--data', f'{tmp}/d.json'],
                               capture_output=True, text=True, timeout=10, env={'PYTHONDONTWRITEBYTECODE': '1'})
            self.assertNotEqual(r.returncode, 0)
            self.assertIn('--set-password', r.stderr)


if __name__ == '__main__':
    unittest.main()
