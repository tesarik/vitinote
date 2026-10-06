# VitiNote

Evidence prací ve vinicích (vinice a odrůdy, deník prací, postřiky s ochrannými lhůtami,
pracovníci a hodiny). Pro jednoho uživatele, UI i texty jsou česky.

## Spuštění

```sh
bin/vitinote            # server + otevře http://localhost:8000
bin/vitinote --no-open --port 8765 --data /tmp/test.json   # pro testování s oddělenými daty
```

## Architektura

Bez build kroku a bez závislostí: čisté HTML/CSS/JS + Python 3 stdlib. Nepřidávat do aplikace npm, frameworky ani pip balíčky bez domluvy
(Playwright je jen vývojová závislost v `tests/`).

- `index.html` – kostra, navigace, jediný `<dialog>` pro všechny formuláře.
- `app.js` – celá aplikace. Pohledy jsou funkce `render*()` vracející HTML string, router podle `location.hash`
  (`#/vinice/<id>` …), akce přes delegované `data-action` atributy → objekt `actions`.
- `style.css` – barvy jako CSS proměnné na `:root`, tmavý režim přes `prefers-color-scheme`. Mobile-first.
- `server.py` – obsluhuje jen soubory ze seznamu `STATIC_FILES`, `GET/PUT /api/data` a registr přípravků (`GET /api/por`,
  `POST /api/por/update`). Zápis je atomický, předchozí verze dat jako `.bak`.
- `por_registry.py` – z exportu registru přípravků ÚKZÚZ (~100 MB XML, stahování trvá 1–3 min) vytáhne povolené přípravky
  s použitím pro révu do `por-reva.json` vedle datového souboru. Testy používají `--por-source tests/fixtures/registr-por.xml`.
- `sw.js` – offline cache (stale-while-revalidate), `api/` nikdy necachuje.

### Data

Jeden JSON objekt `{ version: 1, activities, vineyards, workers, products, works }`:
- hlavní úložiště: soubor na disku přes `server.py` (výchozí `data/vitinote.json`),
- kopie v `localStorage` (`vitinote:v1`) pro okamžité načtení a offline režim. Neodeslané změny označuje příznak `vitinote:dirty`.

Každá změna dat: upravit `db` → `save()` (zapíše lokálně a odešle na server) → `render()`.
Změny tvaru dat řešit migrací v `normalizeDb()`, která se volá při načtení z localStorage, ze serveru i z importu zálohy.

Pozemek v přípravě na výsadbu je vinice se `stage: 'preparation'` (`isPrep`), navíc má `plannedPlanting` (YYYY-MM) a plánované
odrůdy s `rootstock` a `vines`. Nepočítá se do výměry vinic. Akce Vysadit (`plantForm`) smaže `stage` a nastaví `plantedDate`, práce zůstanou.
Seznamy vinic pro výběr ber přes `workPlaces()` / `plantedVineyards()`, ne přímo `db.vineyards`.
Vinice má výchozí název `name` (z importu: trať + celé reg. číslo) a nepovinný vlastní `alias`. Pro zobrazení vždy `vName(v)`,
pro řazení `sortVineyards()`. Import mění jen údaje z registru, nikdy `name` ani `alias` existující vinice.

Plochy jsou v aplikaci v **ha**. Registr vinic je uvádí v m², převádí se při importu.

Práce má `date` (od) a nepovinné `dateTo` (do). V seznamech se zobrazí ve všech obdobích, do kterých zasahuje (`inPeriod`).
Hodiny, náklady a spotřeba se do měsíců a let rozpočítávají podle dnů (`periodShare`). Pro zobrazení data použij `fmtWorkDate(w)`,
pro ochrannou lhůtu konec práce (`workEnd`).

Pracovní rok = kalendářní rok data práce. Výběr roku v záhlaví (`selectedYear`, jen v paměti, výchozí letošek) filtruje
všechny roční údaje. V pohledech používat `inYear(w)` a `yearLabel()` („letos“ / „v roce 2024“), ne `today()`.
`today()` patří jen k věcem vázaným na dnešek (ochranné lhůty, výchozí datum nové práce).

Činnosti jsou číselník `activities: [{ id, name, kind: 'work'|'spray'|'harvest', hidden }]` (pořadí = pořadí v poli).
Práce na ně odkazuje přes `activityId`. Formulář práce se řídí podle `kind`, nikdy podle názvu činnosti.
Id výchozích a převedených činností je odvozené z názvu (`activityIdFor`), aby převod na dvou zařízeních dal stejná id.

Přípravek propojený s registrem má `regNo` a kopii `uses`, `validTo`, `useTo`… (`porFields`). Při aktualizaci registru se obnoví.
Řádek postřiku s vybraným použitím si ukládá `useId, pest, phi, phiDays`, aby se historie neměnila s registrem.
Ochranná lhůta řádku: podle použití (`AT`/`-` = bez pevné lhůty), jinak podle `phiDays` přípravku (`rowPhiDays`).

Sklizeň je u práce seznam `harvest: [{ variety, kg, sugar }]`. Prázdné `variety` znamená celou vinici.
Odrůdy vinice jsou `varieties: [{ name, area, year, code?, vines?, training? }]` a stejná odrůda může být víckrát (různé roky výsadby).

### Konvence

- Každou hodnotu vkládanou do HTML escapovat přes `esc()`.
- Formuláře: `openForm({ title, body, onSubmit, onDelete, onInit })`. Když `onSubmit` nebo `onDelete` vrátí `false`, dialog zůstane otevřený a nic se neuloží.
- Čísla od uživatele parsovat přes `parseNum()` (přijímá desetinnou čárku), zobrazovat přes `fmtNum()` (český formát).
- Datumy se ukládají jako ISO `YYYY-MM-DD` v lokálním čase (`today()`, `toISO()`), nikdy jako `toISOString()` (UTC posun).
- Komentáře a texty v UI česky.

## Testy

```sh
cd tests && npm install
CHROME_PATH=/usr/bin/google-chrome npm test   # nebo jednorázově: npx playwright install chromium && npm test
# npm test spouští i python3 -m unittest test_por_registry
```

`tests/app.test.mjs` (node:test + Playwright) prochází aplikaci v prohlížeči proti `server.py`.
Každý test má vlastní server s dočasným datovým souborem (`withApp()` v `tests/helpers.mjs`), skutečných dat se nedotýká.
Po změně chování přidat nebo upravit test. Po uložení čekat na `saved(page)` (stav synchronizace „disk“),
po asynchronních akcích (import souboru) čekat na výsledek v DOM, ne na pevný čas.
Fixture `tests/fixtures/registr-vinic.xml` je smyšlená. Nikdy do testů nedávat skutečný výpis z registru.

## Import z Registru vinic

`parseRegistryXml()` čte XML z Portálu farmáře (`RV > SUBJEKT > VINICE > SKLADBA / PAROVANIDPB`).
`PLOCHA` je ve `VINICE` i ve `SKLADBA`, proto se čtou jen přímí potomci (`kids()`).
Vinice se párují podle `regNo` a u ručně založených vinic podle kódu bloku v DPB. Údaje o subjektu (IČO, adresa) se nikdy neukládají.

## Na co myslet

- Při změně souborů aplikace zvýšit `CACHE` v `sw.js` (`vitinote-vN`), jinak se klientům může držet stará verze.
- Nový statický soubor přidat do `STATIC_FILES` v `server.py` i do `ASSETS` v `sw.js`.
- `temp/` a `data/` obsahují skutečná data uživatele a jsou v `.gitignore`. Nikdy je necommitovat. Repo je veřejné.
- Ikony PNG se generují z `icon.svg` příkazem `npm run icons` v `tests/`. Po změně `icon.svg` je přegenerovat.
