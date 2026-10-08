# VitiNote

Evidence prací ve vinicích pro menší vinařství: vinice a odrůdy (i pozemky v přípravě na výsadbu), deník prací
s kalendářem a vyhledáváním, postřiky s přípravky z registru ÚKZÚZ (ochranné lhůty, limity aplikací, fenofáze BBCH),
sklad přípravků, sklizeň po odrůdách, lidé a stroje, náklady na vinici a hektar, evidence POR podle nařízení
(EU) 2023/564 a karta vinice k tisku. Instalovatelná PWA, data v JSON souboru na disku s denními zálohami.

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

## Na webhosting (Wedos a jiné s PHP)

Aplikace má i PHP verzi serveru (`api.php`, `php/`, `.htaccess`) se stejným API a stejnými soubory dat jako `server.py`.

1. Připrav složku k nahrání: `bin/build-web --with-data` – zeptá se na heslo a přibalí tvoje současná data
   (bez `--with-data` začneš na webu s prázdnými daty a zálohu nahraješ v aplikaci přes Data → Obnovit ze zálohy).
2. V administraci hostingu zapni PHP 8.1 nebo novější a HTTPS certifikát (u Wedosu Let's Encrypt zdarma).
3. Nahraj **celý obsah** `dist/web/` včetně skrytých `.htaccess` do složky webu (u Wedosu `www/` domény nebo subdomény),
   např. přes FileZillu. Složka `data/` musí být pro PHP zapisovatelná.
4. **Kontrola zabezpečení:** `https://tvoje-domena/data/heslo.json` musí vrátit chybu 403 (Forbidden).
   Pokud se zobrazí obsah souboru, hosting ignoruje `.htaccess` – data přesuň mimo web (viz `config.example.php`).
5. Otevři `https://tvoje-domena/`, přihlas se a v Přípravky klikni na „Aktualizovat z registru“. Když stažení
   na hostingu nestihne časový limit, spusť doma `python3 por_registry.py > por-reva.json` a nahraj soubor tlačítkem
   „Nahrát registr ze souboru“.
6. Na telefonu otevři stejnou adresu a dej „Přidat na plochu“ – díky HTTPS funguje i offline.

**Aktualizace aplikace:** `bin/build-web` (heslo zůstane) a nahraj obsah `dist/web/` **bez složky `data/`**,
aby se na webu nepřepsala data. Nové heslo: `bin/build-web --new-password` a nahraj jen `data/heslo.json`.

Po přesunu na web používej jen webovou verzi – data doma a na webu se samy nesynchronizují (přenos přes zálohu v sekci Data).

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
