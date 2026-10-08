# VitiNote

Evidence prací ve vinicích pro jednoho vinaře: vinice a odrůdy, pozemky v přípravě na výsadbu, deník prací
(číselník činností, vícedenní práce, kalendář, vyhledávání), postřiky s přípravky z registru ÚKZÚZ (povolená použití, ochranné
lhůty, limity aplikací, BBCH), sklad přípravků, sklizeň po odrůdách, lidé a stroje, náklady na vinici a ha, výběr pracovního roku,
import vinic z Registru vinic, exporty CSV (deník, evidence POR podle nař. EU 2023/564), karta vinice k tisku, denní zálohy,
heslo pro přístup z místní sítě.
UI i texty jsou česky.

## Spolupráce

- S uživatelem komunikovat česky, commit zprávy česky.
- Commitovat po dokončení změny; `git push` až po souhlasu uživatele (repo je veřejné: github.com/tesarik/vitinote).
- Před pushem zkontrolovat, že v diffu nejsou skutečná data uživatele (viz Testy).
- Změny ověřovat testy (`npm test` v `tests/`) a u UI i snímkem obrazovky na šířce telefonu (~375 px).

## Spuštění

```sh
bin/vitinote            # server + otevře http://localhost:8000
bin/vitinote --no-open --port 8765 --data /tmp/test.json   # pro testování s oddělenými daty
```

## Architektura

Bez build kroku a bez závislostí: čisté HTML/CSS/JS + Python 3 stdlib. Nepřidávat do aplikace npm, frameworky ani pip balíčky bez domluvy
(Playwright je jen vývojová závislost v `tests/`).

- `index.html` – kostra, navigace, jediný `<dialog>` pro všechny formuláře.
- `js/` – aplikace jako nativní ES moduly (načítá je `index.html` přes `js/main.js`, žádný bundler):
  - `util.js` obecné helpery (`$`, `esc`, datumy, `fmtNum`/`parseNum`, `options`, CSV) – nezávisí na ničem dalším,
  - `data.js` datový model, `normalizeDb` (převody starších dat), stav `db` a doménová logika (období, ochranné lhůty…),
  - `storage.js` localStorage + synchronizace se serverem (`save`, `pullFromServer`),
  - `registry-por.js` registr přípravků ÚKZÚZ, `por-limits.js` čtení limitů použití z textu registru (bez závislostí,
    testuje se v Node), `view-state.js` vybraný rok a filtry,
  - `views.js` stránky (`render*()` vrací HTML string) a router podle `location.hash` (`#/vinice/<id>` …),
  - `dialog.js` jediný dialog (`openForm`), `forms/*.js` jednotlivé formuláře, `import-registr-vinic.js`,
    `print-card.js` karta vinice k tisku (`#/tisk/<id>`, styly v `@media print`),
  - `actions.js` akce přes delegované `data-action` atributy a obsluha událostí, `main.js` spuštění.
  Sdílený stav (`db`, `selectedYear`, `workersPeriod`) se z jiných modulů jen čte; přepisuje se přes setter
  ve vlastním modulu (`setDb`, `setYear`, `setWorkersPeriod`). Posluchače událostí se registrují v `init*()` volaných z `main.js`,
  ne při importu. Cyklické importy (např. storage ↔ views) jsou v pořádku, dokud se importované funkce volají až za běhu.
- `style.css` – barvy jako CSS proměnné na `:root`, tmavý režim přes `prefers-color-scheme`. Mobile-first.
- `server.py` – obsluhuje jen soubory ze seznamu `STATIC_FILES` a moduly `js/**.js`, `GET/PUT /api/data` a registr přípravků (`GET /api/por`,
  `POST /api/por/update`). Zápis je atomický, předchozí verze dat jako `.bak`.
- `api.php` + `php/lib.php`, `php/por_registry.php` – PHP verze serveru pro webhosting (Wedos). **Stejné API, stejné soubory
  (`vitinote.json`, `heslo.json`, `por-reva.json`, `zalohy/`) a stejný formát hesla a cookie jako Python verze.** Změnu API
  vždy udělat v obou. Směrování: `.htaccess` (Apache) / `php/router.php` (`php -S`, testy). Na webu se heslo vyžaduje vždy
  (bez `heslo.json` vrací 503). Nastavení `config.php` (vzor `config.example.php`), pro testy proměnné `VITINOTE_*`.
  `bin/build-web` sestaví `dist/web/` k nahrání (gitignore – obsahuje heslo a případně data).
  Ukládání dat jde přes POST (některé hostingy blokují PUT); `POST /api/por/upload` nahraje hotový výtah registru.
- `login.html` – přihlašovací stránka pro obě verze (`{error}` se nahradí).
- `auth.py` – heslo pro přístup z místní sítě (`--set-password`, `--lan` bez hesla nespustí). PBKDF2 hash v `heslo.json`,
  přihlášení = podepsaná cookie (HMAC) na 90 dní. Chráněná je stránka aplikace a `/api/*`; z 127.0.0.1 se heslo nevyžaduje
  (testy to vynutí `--auth-local`). Aplikace při 401 přejde na `login`.
- Server po každém uložení drží denní zálohy v `zalohy/` vedle dat (posledních 30, `--keep-backups`).
- `por_registry.py` – z exportu registru přípravků ÚKZÚZ (~100 MB XML, stahování trvá 1–3 min) vytáhne povolené přípravky
  s použitím pro révu do `por-reva.json` vedle datového souboru. Testy používají `--por-source tests/fixtures/registr-por.xml`.
- `sw.js` – offline cache (stale-while-revalidate), `api/` nikdy necachuje.

### Data

Jeden JSON objekt `{ version: 1, migrated, activities, vineyards, workers, machines, products, purchases, works }`:
- hlavní úložiště: soubor na disku přes `server.py` (výchozí `data/vitinote.json`),
- kopie v `localStorage` (`vitinote:v1`) pro okamžité načtení a offline režim. Neodeslané změny označuje příznak `vitinote:dirty`.

Každá změna dat: upravit `db` → `save()` (zapíše lokálně a odešle na server) → `render()`.
Změny tvaru dat řešit migrací v `normalizeDb()`, která se volá při načtení z localStorage, ze serveru i z importu zálohy.
Migrace musí být idempotentní. Pokud mění data, která může uživatel později sám upravit (např. jména vinic), musí proběhnout
jen jednou: zaznamenat ji v `db.migrated` (např. `regNoNames`) a v `emptyDb()` ji rovnou označit jako hotovou.

Vinice: `{ id, name, alias?, area (ha), varieties, regNo?, ku?, parcels?, dpb?, plantedYear?, plantedDate?, note, stage? }`.

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
Výchozí seznam určil uživatel (zelené práce rozepsané na jednotlivé činnosti). Staré názvy převádí `LEGACY_ACTIVITY_NAMES`,
zrušené zůstávají skryté (`RETIRED_ACTIVITY_NAMES`).

Přípravek propojený s registrem má `regNo` a kopii `uses`, `validTo`, `useTo`… (`porFields`). Při aktualizaci registru se obnoví.
Řádek postřiku s vybraným použitím si ukládá `useId, pest, phi, phiDays`, aby se historie neměnila s registrem.
Ochranná lhůta řádku: podle použití (`AT`/`-` = bez pevné lhůty), jinak podle `phiDays` přípravku (`rowPhiDays`).
Platnost z registru: `validTo` konec povolení ≤ `sellTo` doprodej ≤ `useTo` spotřeba zásob. Postřik po `useTo` vyžaduje potvrzení,
stejně jako sklizeň během běžící ochranné lhůty.

Práce: `{ id, vineyardId, activityId, date, dateTo?, status: 'done'|'planned', workers: [{ workerId, hours }],
machines: [{ machineId, hours }], products: [{ productId, dose, useId?, pest?, phi?, phiDays? }], treatedArea?, water?, bbch?,
startTime?, target?, harvest, note }`. `treatedArea` je jen u postřiku jedné vinice, když nejde o celou výměru (`treatedArea(w)`).

Limity povoleného použití (max. aplikací za rok, odstup, okna BBCH) se čtou z poznámky registru za běhu (`useLimits`),
nic se neukládá. Kontrola při uložení postřiku je v `sprayWarnings` (forms/work.js) a vede jen k potvrzení, ne k zákazu.

Sklad: `purchases: [{ id, productId, date, qty, price?, note }]`, záporné `qty` = oprava stavu po inventuře.
Zásoba `stockOf` = nákupy − spotřeba v provedených postřicích. Cena `unitPrice` = vážený průměr nákupů, jinak `product.price`.
Náklady `workCosts` / `vineyardCosts`: lidé (h × `rate`), stroje (mth × `rate`), přípravky (spotřeba × cena); bez sazby → `unpriced`.

Sklizeň je u práce seznam `harvest: [{ variety, kg, sugar }]`. Prázdné `variety` znamená celou vinici.
Odrůdy vinice jsou `varieties: [{ name, area, year, rootstock?, vines?, code?, training? }]` a stejná odrůda může být víckrát
(různé roky výsadby). Formulář ukazuje jen část polí podle stavu (`VARIETY_FIELDS`), ostatní zachová v `data-extra`.

### Konvence

- Každou hodnotu vkládanou do HTML escapovat přes `esc()`.
- Formuláře: `openForm({ title, body, onSubmit, onDelete, onInit })`. Když `onSubmit` nebo `onDelete` vrátí `false`, dialog zůstane otevřený a nic se neuloží.
- Čísla od uživatele parsovat přes `parseNum()` (přijímá desetinnou čárku), zobrazovat přes `fmtNum()` (český formát),
  do polí formuláře předvyplňovat přes `numVal()` (desetinná čárka).
- Datumy se ukládají jako ISO `YYYY-MM-DD` v lokálním čase (`today()`, `toISO()`), nikdy jako `toISOString()` (UTC posun).
- Komentáře a texty v UI česky.
- CSV exporty přes `toCsv()` (středník, BOM, desetinná čárka – pro český Excel).
- `select` má vlastní šipku jako `background-image` – u selectů nepoužívat zkratku `background:`, jen `background-color`.
- Potvrzovací otázky přes `confirm()` (testy je zachytávají přes `dialogs` / `answerDialogs()` z `withApp`).

## Testy

```sh
cd tests && npm install
CHROME_PATH=/usr/bin/google-chrome npm test   # na tomto stroji nutné; jinde: npx playwright install chromium && npm test
# npm test spouští i python3 -m unittest (test_por_registry, test_server, test_php_parity) a jednotkové testy v Node
CHROME_PATH=/usr/bin/google-chrome npm run test:php   # celá sada proti PHP verzi (php -S); test:all = obě
```

`tests/app.test.mjs` (node:test + Playwright) prochází aplikaci v prohlížeči proti `server.py`.
`tests/modules.test.mjs` kontroluje, že každý import v `js/` cílový modul exportuje (ESLint v projektu není).
`por-limits.test.mjs` a `util.test.mjs` testují čisté funkce bez prohlížeče. Na server s heslem: `startServer({ password })`.
Datum v testu, které závisí na roce, ukotvit přes `page.clock.setFixedTime()` (jinak test padá v lednu).
Každý test má vlastní server s dočasným datovým souborem (`withApp()` v `tests/helpers.mjs`), skutečných dat se nedotýká.
Po změně chování přidat nebo upravit test. Po uložení čekat na `saved(page)` (stav synchronizace „disk“),
po asynchronních akcích (import souboru) čekat na výsledek v DOM, ne na pevný čas.
Fixture `tests/fixtures/registr-vinic.xml` je smyšlená. Do testů, komentářů ani příkladů nikdy nedávat skutečná data
uživatele – ani registrační čísla vinic, názvy tratí, katastrů či DPB z `temp/` a `data/`. Používat čísla `999999/…`.
Před pushem zkontrolovat: `git grep -n -E "<reg. čísla a tratě uživatele>"`.

## Import z Registru vinic

`parseRegistryXml()` čte XML z Portálu farmáře (`RV > SUBJEKT > VINICE > SKLADBA / PAROVANIDPB`).
`PLOCHA` je ve `VINICE` i ve `SKLADBA`, proto se čtou jen přímí potomci (`kids()`).
Vinice se párují podle `regNo` a u ručně založených vinic podle kódu bloku v DPB. Údaje o subjektu (IČO, adresa) se nikdy neukládají.

## Zjištěno a odloženo

- Odkaz z kódu DPB přímo na díl v mapě (2026-10): veřejný LPIS (mze.gov.cz …/plpis) nemá parametr v URL pro otevření dílu,
  jeho vyhledávací REST anonymně vrací 403. Veřejná vrstva agrigis.gov.cz `Data_INSPIRE/LPIS` identifikuje díly jiným číslem
  (`828112607/2`), ne čtvercem a kódem. Uživatel to nechal být; neoficiální rozhraní nepoužívat.
- Evidence POR (2026-10): prováděcí nař. (EU) 2023/564 platí od 1. 1. 2026 pro všechny profesionální uživatele – záznamy
  elektronicky, strojově čitelně, do 30 dní; obsah: přípravek + číslo povolení, datum (+ čas zahájení), dávka/ha, díl LPIS,
  ošetřená plocha, plodina s kódem EPPO, BBCH. Nař. (EU) 2025/2203 dovoluje státům odklad převodu do 1. 1. 2027.
  ČR: předávání XML (příloha č. 5 vyhl. 200/2023 Sb.) do JUDPOR / EPH na Portálu farmáře je povinné jen nad 200 ha
  (orná půda + vinice + chmelnice + sady). Uživatel má ~4 ha, takže stačí CSV export; XML pro JUDPOR není implementované.
- Heslo běží po HTTP (bez TLS) – v místní síti jde odposlechnout. Pro přístup z internetu by byl potřeba HTTPS (např. reverzní proxy).

## Na co myslet

- Při změně souborů aplikace zvýšit `CACHE` v `sw.js` (`vitinote-vN`), jinak se klientům může držet stará verze.
- Nový statický soubor přidat do `STATIC_FILES` v `server.py` i do `ASSETS` v `sw.js`. Nový modul v `js/` stačí přidat do `ASSETS`
  (test „offline cache“ to hlídá).
- `temp/` a `data/` obsahují skutečná data uživatele a jsou v `.gitignore`. Nikdy je necommitovat. Repo je veřejné.
- Ikony PNG se generují z `icon.svg` příkazem `npm run icons` v `tests/`. Po změně `icon.svg` je přegenerovat.
