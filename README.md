# VitiNote

Evidence prací ve vinicích: vinice a jejich odrůdy, deník prací (řez, zelené práce, postřiky,
sklizeň…), přípravky s ochrannými lhůtami, pracovníci a odpracované hodiny. Instalovatelná PWA.

## Spuštění

Potřebuje jen Python 3 (žádné další balíčky).

```sh
git clone https://github.com/tesarik/vitinote.git
cd vitinote
bin/vitinote                 # spustí server a otevře http://localhost:8000
```

Parametry:

```sh
bin/vitinote --set-password  # nastaví heslo pro přístup z jiných zařízení (jednou)
bin/vitinote --lan           # dostupné i z telefonu ve stejné Wi-Fi, chráněné heslem
bin/vitinote --port 9000     # jiný port
bin/vitinote --data ~/vinarstvi/vitinote.json   # jiné umístění dat
bin/vitinote --no-open       # neotevírat prohlížeč
```

Aby šel příkaz `vitinote` spouštět odkudkoli:

```sh
ln -s "$PWD/bin/vitinote" ~/.local/bin/vitinote
```

Bez skriptu (např. ve Windows): `python3 server.py`.

## Přístup z telefonu

`--lan` zpřístupní aplikaci ostatním zařízením v síti a vyžaduje heslo (`bin/vitinote --set-password`).
Heslo je uložené jen jako hash v `data/heslo.json`; přihlášení vydrží 90 dní, změna hesla odhlásí všechna zařízení.
Z počítače, na kterém server běží, se heslo nezadává. Spojení není šifrované (HTTP), takže heslo nepoužívej jinde
a v cizích sítích `--lan` nespouštěj.

## Kde jsou data

- Hlavní úložiště je JSON soubor na disku, výchozí `data/vitinote.json` (změníš přes `--data`).
  Zápis je atomický a předchozí verze zůstává jako `vitinote.json.bak`.
- Denní zálohy: `data/zalohy/vitinote-RRRR-MM-DD.json` (posledních 30 dní, `--keep-backups N`).
- Prohlížeč si drží kopii v localStorage. Když server neběží, změny se ukládají jen tam
  (v záhlaví svítí „Jen v prohlížeči“) a na disk se odešlou, jakmile je server znovu dostupný.

V sekci **Data** je záloha a obnova (JSON), exporty do CSV (deník prací, evidence POR a hnojiv),
import vinic z Registru vinic (XML z Portálu farmáře) a číselník činností.

## Registr přípravků ÚKZÚZ

V sekci **Přípravky** tlačítko „Aktualizovat z registru“ stáhne veřejný
[export registru přípravků na ochranu rostlin](https://mze.gov.cz/public/app/eagriapp/POR/DataKeStazeni.aspx)
(~100 MB, 1–3 minuty) a uloží z něj přípravky povolené pro révu do `data/por-reva.json`.
Přípravek pak jde vyhledat v registru a u postřiku vybrat povolené použití (škodlivý organismus),
podle kterého se nastaví dávka a ochranná lhůta.

## Testy

Testy běží v prohlížeči přes Playwright (jen pro vývoj, aplikace sama nic neinstaluje):

```sh
cd tests
npm install
npx playwright install chromium      # jednou; nebo použij systémový Chrome:
CHROME_PATH=/usr/bin/google-chrome npm test
```
