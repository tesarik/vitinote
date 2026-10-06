"""Testy výtahu registru přípravků ÚKZÚZ (python3 -m unittest, spouští i npm test)."""
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.dont_write_bytecode = True

import por_registry  # noqa: E402


class ParsePhiDays(unittest.TestCase):
    def test_values(self):
        cases = {'35': 35, '35 dnů': 35, 'AT': None, '-': None, '': None, 'AT, 28': 28, '21, 35': 35, '24h': None}
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(por_registry.parse_phi_days(text), expected)


class ExtractVineProducts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = por_registry.build_vine_registry(str(HERE / 'fixtures' / 'registr-por.xml'))
        cls.by_reg = {p['regNo']: p for p in cls.data['products']}

    def test_only_authorized_products_with_vine_uses(self):
        self.assertEqual(sorted(self.by_reg), ['9001-1', '9002-1'])  # zrušený a bramborový vypadnou

    def test_product_fields(self):
        p = self.by_reg['9001-1']
        self.assertEqual(p['name'], 'Testcupro 50 WP')
        self.assertEqual(p['kind'], 'Fungicid, Baktericid')
        self.assertEqual((p['validTo'], p['sellTo'], p['useTo']), ('2099-12-31', '2100-06-30', '2100-12-31'))
        self.assertEqual(p['substances'], [{'name': 'Hydroxid měďnatý', 'amount': 500.0, 'unit': 'g/kg'}])

    def test_uses_only_for_vine(self):
        uses = self.by_reg['9001-1']['uses']
        self.assertEqual([u['id'] for u in uses], ['101', '102'])
        self.assertEqual(uses[0]['crops'], ['Réva moštová', 'Réva stolní'])
        self.assertEqual((uses[0]['pest'], uses[0]['phiDays'], uses[0]['doseMax'], uses[0]['doseUnit']), ('plíseň révová', 21, 2.0, 'kg/ha'))
        self.assertEqual((uses[1]['phi'], uses[1]['phiDays'], uses[1]['doseMax']), ('AT', None, 1.5))

    def test_empty_export_is_error(self):
        with self.assertRaises(ValueError):
            por_registry.build_vine_registry(str(HERE / 'fixtures' / 'registr-vinic.xml'))


if __name__ == '__main__':
    unittest.main()
