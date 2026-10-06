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
bin/vitinote --lan           # dostupné i z telefonu ve stejné Wi-Fi
bin/vitinote --port 9000     # jiný port
bin/vitinote --data ~/vinarstvi/vitinote.json   # jiné umístění dat
bin/vitinote --no-open       # neotevírat prohlížeč
```

Aby šel příkaz `vitinote` spouštět odkudkoli:

```sh
ln -s "$PWD/bin/vitinote" ~/.local/bin/vitinote
```

Bez skriptu (např. ve Windows): `python3 server.py`.

## Kde jsou data

- Hlavní úložiště je JSON soubor na disku, výchozí `data/vitinote.json` (změníš přes `--data`).
  Zápis je atomický a předchozí verze zůstává jako `vitinote.json.bak`.
- Prohlížeč si drží kopii v localStorage. Když server neběží, změny se ukládají jen tam
  (v záhlaví svítí „Jen v prohlížeči“) a na disk se odešlou, jakmile je server znovu dostupný.

V sekci **Data** je záloha a obnova (JSON) a exporty do CSV (deník prací, evidence POR a hnojiv).
