# VitiNote

Evidence prací ve vinicích pro menší vinařství: vinice a odrůdy (i pozemky v přípravě na výsadbu), deník prací
s kalendářem a vyhledáváním, postřiky s přípravky z registru ÚKZÚZ (ochranné lhůty, limity aplikací, fenofáze BBCH),
sklad přípravků, sklizeň po odrůdách, lidé a stroje, náklady na vinici a hektar, evidence POR podle nařízení
(EU) 2023/564 a karta vinice k tisku. Instalovatelná PWA, data v JSON souboru na disku s denními zálohami.

## Lokální spuštění (Python)

Potřebuje jen Python 3 (žádné další balíčky). Funguje na Linuxu, macOS i Windows.

```sh
git clone https://github.com/tesarik/vitinote.git
cd vitinote
bin/vitinote                 # spustí server a otevře http://localhost:8000
```

Server ukončíš `Ctrl+C`. Data jsou v `data/vitinote.json` (viz [Kde jsou data](#kde-jsou-data)).
Na počítači, kde server běží, se **heslo nezadává** (viz [Heslo](#heslo)).

Parametry:

```sh
bin/vitinote --set-password  # nastaví heslo pro přístup z jiných zařízení (jednou)
bin/vitinote --lan           # dostupné i z telefonu ve stejné Wi-Fi, chráněné heslem
bin/vitinote --port 9000     # jiný port
bin/vitinote --data ~/vinarstvi/vitinote.json   # jiné umístění dat
bin/vitinote --keep-backups 60                   # kolik denních záloh držet (výchozí 30)
bin/vitinote --no-open       # neotevírat prohlížeč
bin/vitinote --php           # PHP verze serveru (jako na webhostingu) se stejnými daty; potřebuje PHP 8.1+
```

Aby šel příkaz `vitinote` spouštět odkudkoli:

```sh
ln -s "$PWD/bin/vitinote" ~/.local/bin/vitinote
```

Ve Windows (bez bashe): `python server.py` a otevři http://localhost:8000.

## Heslo

Po instalaci **žádné heslo neexistuje** a doma ho nepotřebuješ – na počítači, kde server běží, se nikdy nevyžaduje.
Heslo je potřeba jen pro přístup z jiných zařízení a **vymýšlíš si ho sám** (aspoň 6 znaků):

| Kde | Kdy | Nastavení | Uloží se do |
|---|---|---|---|
| Doma přes Wi-Fi | telefon a `bin/vitinote --lan` | `bin/vitinote --set-password` | `data/heslo.json` |
| Na webu (Wedos) | vždy | `bin/build-web` (zeptá se při prvním sestavení) | `dist/web/data/heslo.json` → nahraje se na web |

Obě hesla jsou nezávislá a mohou se lišit. V souboru `heslo.json` je jen otisk hesla (hash), heslo z něj nejde přečíst.

- **Zapomenuté heslo / změna:** doma znovu `bin/vitinote --set-password`, pro web `bin/build-web --new-password`
  a nahrát `dist/web/data/heslo.json`. Změna odhlásí všechna zařízení.
- **Přihlášení** v prohlížeči vydrží 90 dní, odhlásit se dá v sekci Data → Odhlásit.

## Nasazení na webhosting (Wedos a jiné s PHP)

Aplikace má i PHP verzi serveru (`api.php`, `php/`, `.htaccess`) se stejným API a stejnými soubory dat jako `server.py`,
takže poběží na běžném webhostingu bez správy serveru.

**Potřebuješ:**
- webhosting s **PHP 8.1+** a Apache (`.htaccess`) – Wedos webhosting to splňuje,
- doménu nebo subdoménu s **HTTPS** (certifikát Let's Encrypt jde u Wedosu zapnout zdarma),
- **FTP přístup** k webhostingu (údaje najdeš v administraci webhostingu) a FTP klienta, např. [FileZilla](https://filezilla-project.org),
- doma tento repozitář a Python 3 (sestavení připraví soubor s heslem).

**Postup:**

1. **Sestav složku k nahrání:**
   ```sh
   bin/build-web --with-data
   ```
   Zeptá se na heslo pro web (aspoň 6 znaků) a do `dist/web/` připraví aplikaci, složku `data/` s heslem
   a tvoje současná data. Bez `--with-data` začneš na webu s prázdnými daty (zálohu pak nahraješ v aplikaci
   přes Data → Obnovit ze zálohy).
2. **Nastav hosting:** v administraci webhostingu zvol PHP 8.1 nebo novější a zapni HTTPS certifikát pro doménu.
3. **Nahraj soubory:** přes FTP nahraj **celý obsah** `dist/web/` do složky webu (u Wedosu `www/` hlavní domény,
   případně složka subdomény). Ve FileZille zapni zobrazení skrytých souborů, ať se nahraje i `.htaccess`
   (je v kořeni i ve složce `data/`).
4. **Zkontroluj zabezpečení** (důležité):
   - `https://tvoje-domena/data/heslo.json` musí vrátit chybu **403 Forbidden**,
   - `https://tvoje-domena/` musí ukázat přihlašovací stránku.

   Pokud se u `heslo.json` zobrazí obsah souboru, hosting ignoruje `.htaccess`: soubory ze složky `data/` hned smaž
   z webu, přesuň data mimo veřejnou složku (viz `config.example.php`) a heslo nastav znovu (`bin/build-web --new-password`).
5. **Přihlas se** na `https://tvoje-domena/` a v sekci Přípravky klikni na „Aktualizovat z registru“.
   Když stažení (~100 MB) na hostingu nestihne časový limit, spusť doma
   ```sh
   python3 por_registry.py > por-reva.json
   ```
   a soubor nahraj tlačítkem „Nahrát registr ze souboru“.
6. **Telefon:** otevři stejnou adresu, přihlas se a v menu prohlížeče dej „Přidat na plochu“.
   Díky HTTPS funguje aplikace i bez signálu; změny se odešlou, až bude spojení.

**Aktualizace aplikace** (nová verze z GitHubu): `git pull`, `bin/build-web` (bez `--with-data`, heslo zůstane
z minulého sestavení) a nahraj obsah `dist/web/` **kromě složky `data/`**, aby se na webu nepřepsala data.

**Změna hesla:** `bin/build-web --new-password` a nahraj jen `dist/web/data/heslo.json`. Všechna zařízení se odhlásí.

**Data doma a na webu se nesynchronizují.** Po přesunu používej jen webovou verzi. Přenos opačným směrem:
na webu Data → Stáhnout zálohu, doma Data → Obnovit ze zálohy. Denní zálohy jsou na webu ve složce `data/zalohy/`
(stáhneš je přes FTP).

**Když něco nefunguje:**

| Příznak | Příčina a řešení |
|---|---|
| „Heslo není nastavené“ | Na webu chybí `data/heslo.json` – nahraj ho z `dist/web/data/`. |
| V záhlaví svítí „Jen v prohlížeči“ | PHP nemůže zapisovat do `data/` – ve FTP klientu nastav složce práva zápisu (např. 755 nebo 775). |
| Chyba 500 / bílá stránka | Starší PHP – v administraci zvol PHP 8.1 nebo novější. |
| Chyba 404 u `/login` nebo `/api/…` | Nenahrál se `.htaccess` (skrytý soubor) nebo hosting nemá zapnutý mod_rewrite. |
| Aktualizace registru selže | Časový limit hostingu – použij „Nahrát registr ze souboru“ (krok 5). |

### Vyzkoušení webové verze lokálně (PHP)

PHP verzi spustíš i doma (potřebuje PHP 8.1+, pro aktualizaci registru i rozšíření php-xml):

```sh
bin/vitinote --php                                   # ve složce projektu, stejná data jako Python verze
```

Stejně jako Python server pouští vestavěný PHP server bez hesla požadavky z tohoto počítače;
na webhostingu (Apache) se heslo vyžaduje vždy. Přesně tu složku, kterou nahraješ na web, vyzkoušíš takto:

```sh
bin/build-web --with-data
cd dist/web && php -S localhost:8080 php/router.php  # http://localhost:8080, z tohoto počítače bez hesla
```

`php/router.php` dělá při `php -S` totéž co `.htaccess` na hostingu.

## Přístup z telefonu doma (--lan)

`--lan` zpřístupní aplikaci ostatním zařízením v síti a vyžaduje heslo (viz [Heslo](#heslo)) – bez něj se nespustí.
Na telefonu otevři `http://<adresa-počítače>:8000` (adresu zjistíš příkazem `hostname -I`). Spojení není šifrované (HTTP), takže heslo nepoužívej jinde
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
npx playwright install chromium      # jednou; nebo použij systémový Chrome přes CHROME_PATH=/usr/bin/google-chrome
npm test                             # Python server + jednotkové testy
npm run test:php                     # stejné testy proti PHP verzi (potřebuje php, pro registr i php-xml)
npm run test:all                     # obojí
```
