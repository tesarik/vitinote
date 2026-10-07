// Statická kontrola ES modulů v js/: každý importovaný název musí cílový modul exportovat.
// (Prohlížeč by jinak modul vůbec nenačetl a aplikace by zůstala prázdná.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const JS = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');
const files = readdirSync(JS, { recursive: true }).filter(f => f.endsWith('.js')).map(f => join(JS, f));
const source = Object.fromEntries(files.map(f => [f, readFileSync(f, 'utf8')]));
const exportsOf = f => new Set([...source[f].matchAll(/^export (?:async function|function|const|let) ([\w$]+)/gm)].map(m => m[1]));

test('importy odpovídají exportům', () => {
  const problems = [];
  for (const f of files) {
    for (const [, names, from] of source[f].matchAll(/^import \{ ([^}]*) \} from '([^']+)';$/gm)) {
      const target = normalize(join(dirname(f), from));
      if (!source[target]) { problems.push(`${f}: modul ${from} neexistuje`); continue; }
      for (const name of names.split(',').map(s => s.trim())) {
        if (!exportsOf(target).has(name)) problems.push(`${f.replace(JS, 'js')}: ${name} neexportuje ${from}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});
