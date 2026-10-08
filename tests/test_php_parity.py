"""PHP verze zpracování registru (php/por_registry.php) musí dát stejný výsledek jako por_registry.py."""
import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT))

import por_registry  # noqa: E402


def php_has_xml():
    return shutil.which('php') and subprocess.run(['php', '-r', 'exit(class_exists("XMLReader") ? 0 : 1);']).returncode == 0


@unittest.skipUnless(php_has_xml(), 'PHP s rozšířením XMLReader (php-xml) není k dispozici')
class PhpParity(unittest.TestCase):
    def test_same_registry_extract(self):
        fixture = str(HERE / 'fixtures' / 'registr-por.xml')
        code = f"require '{ROOT}/php/por_registry.php'; echo json_encode(build_vine_registry($argv[1]), JSON_UNESCAPED_UNICODE);"
        php = json.loads(subprocess.run(['php', '-r', code, fixture], capture_output=True, text=True, check=True).stdout)
        py = por_registry.build_vine_registry(fixture)
        self.assertEqual(php['products'], json.loads(json.dumps(py['products'])))


if __name__ == '__main__':
    unittest.main()
