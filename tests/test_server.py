"""Testy pomocných funkcí serveru (python3 -m unittest, spouští i npm test)."""
import json
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

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


if __name__ == '__main__':
    unittest.main()
