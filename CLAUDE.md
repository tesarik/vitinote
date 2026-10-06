# VitiNote

Evidence prací ve vinicích (vinice a odrůdy, deník prací, postřiky s ochrannými lhůtami,
pracovníci a hodiny). Pro jednoho uživatele, UI i texty jsou česky.

## Spuštění

```sh
bin/vitinote            # server + otevře http://localhost:8000
bin/vitinote --no-open --port 8765 --data /tmp/test.json   # pro testování s oddělenými daty
```

## Architektura

Bez build kroku a bez závislostí: čisté HTML/CSS/JS + Python 3 stdlib. Nepřidávat npm, frameworky ani pip balíčky bez domluvy.

- `index.html` – kostra, navigace, jediný `<dialog>` pro všechny formuláře.
- `app.js` – celá aplikace. Pohledy jsou funkce `render*()` vracející HTML string, router podle `location.hash`
  (`#/vinice/<id>` …), akce přes delegované `data-action` atributy → objekt `actions`.
- `style.css` – barvy jako CSS proměnné na `:root`, tmavý režim přes `prefers-color-scheme`. Mobile-first.
- `server.py` – obsluhuje jen soubory ze seznamu `STATIC_FILES` a `GET/PUT /api/data`. Zápis je atomický, předchozí verze jako `.bak`.
- `sw.js` – offline cache (stale-while-revalidate), `api/` nikdy necachuje.

### Data

Jeden JSON objekt `{ version: 1, vineyards, workers, products, works }`:
- hlavní úložiště: soubor na disku přes `server.py` (výchozí `data/vitinote.json`),
- kopie v `localStorage` (`vitinote:v1`) pro okamžité načtení a offline režim. Neodeslané změny označuje příznak `vitinote:dirty`.

Každá změna dat: upravit `db` → `save()` (zapíše lokálně a odešle na server) → `render()`.
Změny tvaru dat řešit migrací v `normalizeDb()`, která se volá při načtení z localStorage, ze serveru i z importu zálohy.

Plochy jsou v aplikaci v **ha**. Registr vinic je uvádí v m², převádí se při importu.

### Konvence

- Každou hodnotu vkládanou do HTML escapovat přes `esc()`.
- Formuláře: `openForm({ title, body, onSubmit, onDelete, onInit })`. Když `onSubmit` nebo `onDelete` vrátí `false`, dialog zůstane otevřený a nic se neuloží.
- Čísla od uživatele parsovat přes `parseNum()` (přijímá desetinnou čárku), zobrazovat přes `fmtNum()` (český formát).
- Datumy se ukládají jako ISO `YYYY-MM-DD` v lokálním čase (`today()`, `toISO()`), nikdy jako `toISOString()` (UTC posun).
- Komentáře a texty v UI česky.

## Import z Registru vinic

`parseRegistryXml()` čte XML z Portálu farmáře (`RV > SUBJEKT > VINICE > SKLADBA / PAROVANIDPB`).
`PLOCHA` je ve `VINICE` i ve `SKLADBA`, proto se čtou jen přímí potomci (`kids()`).
Vinice se párují podle `regNo` a u ručně založených vinic podle kódu bloku v DPB. Údaje o subjektu (IČO, adresa) se nikdy neukládají.

## Na co myslet

- Při změně souborů aplikace zvýšit `CACHE` v `sw.js` (`vitinote-vN`), jinak se klientům může držet stará verze.
- Nový statický soubor přidat do `STATIC_FILES` v `server.py` i do `ASSETS` v `sw.js`.
- `temp/` a `data/` obsahují skutečná data uživatele a jsou v `.gitignore`. Nikdy je necommitovat. Repo je veřejné.
- Testy zatím nejsou. Změny ověřovat v prohlížeči proti serveru s dočasným `--data` souborem, ne nad skutečnými daty.
