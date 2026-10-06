# VitiNote

Evidence prací ve vinicích: vinice a jejich odrůdy, deník prací (řez, zelené práce, postřiky,
sklizeň…), přípravky s ochrannými lhůtami, pracovníci a odpracované hodiny. Instalovatelná PWA.

## Spuštění

```sh
python3 server.py            # http://localhost:8000
python3 server.py --lan      # dostupné i z telefonu ve stejné Wi-Fi
python3 server.py --data ~/vinarstvi/vitinote.json --port 9000
```

Potřebuje jen Python 3 (žádné další balíčky).

## Kde jsou data

- Hlavní úložiště je JSON soubor na disku, výchozí `data/vitinote.json` (změníš přes `--data`).
  Zápis je atomický a předchozí verze zůstává jako `vitinote.json.bak`.
- Prohlížeč si drží kopii v localStorage. Když server neběží, změny se ukládají jen tam
  (v záhlaví svítí „Jen v prohlížeči“) a na disk se odešlou, jakmile je server znovu dostupný.

V sekci **Data** je záloha a obnova (JSON) a exporty do CSV (deník prací, evidence POR a hnojiv).
