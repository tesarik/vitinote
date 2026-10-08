<?php
// Výtah přípravků povolených pro révu z exportu registru ÚKZÚZ – PHP obdoba por_registry.py (stejný výstup).
// Export má ~100 MB, čte se proudově (XMLReader) po položkách, aby stačila paměť webhostingu.
declare(strict_types=1);

const VINE_PREFIX = 'Réva';
const AUTHORIZED = 'P';

function por_text(?SimpleXMLElement $el, string $tag): string
{
    return $el === null || !isset($el->$tag) ? '' : trim((string)$el->$tag);
}

function por_date(SimpleXMLElement $el, string $tag): ?string
{
    $t = por_text($el, $tag);
    return $t === '' ? null : substr($t, 0, 10);
}

function por_num(string $text): ?float
{
    $t = str_replace(',', '.', $text);
    return is_numeric($t) ? (float)$t : null;
}

// Ochranná lhůta ve dnech: „35“, „35 dnů“, „AT, 28“ → největší číslo; „AT“, „-“, „24h“ → null.
function parse_phi_days(string $text): ?int
{
    if (!preg_match_all('/\d+/', $text, $m) || str_ends_with(trim($text), 'h')) {
        return null;
    }
    return max(array_map('intval', $m[0]));
}

function por_use(SimpleXMLElement $u): ?array
{
    $crops = [];
    foreach ($u->PLODINA as $p) {
        $name = trim((string)$p->NAZEV);
        if (str_starts_with($name, VINE_PREFIX)) {
            $crops[$name] = true;
        }
    }
    if (!$crops) {
        return null;
    }
    $crops = array_keys($crops);
    sort($crops);
    $dosing = isset($u->DAVKOVANI) ? $u->DAVKOVANI[0] : null;
    $phi = por_text($u, 'OL');
    return [
        'id' => por_text($u, 'ID'),
        'crops' => $crops,
        'pest' => por_text($u, 'SO'),
        'phi' => $phi,
        'phiDays' => parse_phi_days($phi),
        'dose' => por_text($u, 'DAVKA'),
        'doseMin' => $dosing ? por_num(por_text($dosing, 'MIN_DAVKA')) : null,
        'doseMax' => $dosing ? por_num(por_text($dosing, 'MAX_DAVKA')) : null,
        'doseUnit' => $dosing ? por_text($dosing, 'MJ') : '',
        'note' => por_text($u, 'POZNAMKA'),
    ];
}

function por_product(string $name, SimpleXMLElement $roz): ?array
{
    $uses = [];
    foreach ($roz->POUZITI as $u) {
        if ($x = por_use($u)) {
            $uses[] = $x;
        }
    }
    if (!$uses) {
        return null;
    }
    $substances = [];
    foreach ($roz->UL as $ul) {
        $substances[] = ['name' => por_text($ul, 'NAZEV'), 'amount' => por_num(por_text($ul, 'MNOZSTVI')), 'unit' => por_text($ul, 'MJ')];
    }
    return [
        'regNo' => por_text($roz, 'REG_CISLO'),
        'name' => $name,
        'kind' => por_text($roz, 'B_FCE'),
        'holder' => por_text($roz, 'DRZ_ROZH'),
        'validTo' => por_date($roz, 'D_PLATNE_DO'),
        'sellTo' => por_date($roz, 'D_ZASD_SKUT'),
        'useTo' => por_date($roz, 'D_ZAS_SKUT'),
        'substances' => $substances,
        'uses' => $uses,
    ];
}

function extract_vine_products(string $xmlFile): array
{
    if (!class_exists('XMLReader')) {
        throw new RuntimeException('na serveru chybí PHP rozšíření XMLReader');
    }
    $reader = new XMLReader();
    if (!$reader->open($xmlFile)) {
        throw new RuntimeException('export nejde otevřít');
    }
    $products = [];
    while ($reader->read() && $reader->name !== 'POLOZKA');
    while ($reader->name === 'POLOZKA') {
        $el = simplexml_load_string($reader->readOuterXml());
        if ($el !== false) {
            $name = por_text($el, 'OJP');
            foreach ($el->ROZHODNUTI as $roz) {
                if (por_text($roz, 'AKT_STAV') === AUTHORIZED && ($p = por_product($name, $roz))) {
                    $products[] = $p;
                }
            }
        }
        $reader->next('POLOZKA');
    }
    $reader->close();
    usort($products, fn($a, $b) => [mb_strtolower($a['name']), $a['regNo']] <=> [mb_strtolower($b['name']), $b['regNo']]);
    return $products;
}

// Stáhne export (URL) nebo vezme lokální soubor a vrátí výtah pro révu.
function build_vine_registry(string $source): array
{
    $tmp = tempnam(sys_get_temp_dir(), 'vitinote-por-');
    try {
        if (preg_match('#^https?://#', $source)) {
            $fh = fopen($tmp, 'wb');
            $ch = curl_init($source);
            curl_setopt_array($ch, [CURLOPT_FILE => $fh, CURLOPT_FOLLOWLOCATION => true, CURLOPT_FAILONERROR => true,
                CURLOPT_CONNECTTIMEOUT => 30, CURLOPT_TIMEOUT => 0]);
            $ok = curl_exec($ch);
            $error = curl_error($ch);
            curl_close($ch);
            fclose($fh);
            if (!$ok) {
                throw new RuntimeException("stažení selhalo: $error");
            }
        } elseif (!copy(preg_replace('#^file://#', '', $source), $tmp)) {
            throw new RuntimeException('zdroj registru nejde přečíst');
        }
        $products = extract_vine_products($tmp);
    } finally {
        @unlink($tmp);
    }
    if (!$products) {
        throw new RuntimeException('v exportu nejsou žádné přípravky pro révu – změnil se formát?');
    }
    return ['updated' => date('Y-m-d'), 'source' => $source, 'products' => $products];
}

function is_registry(array $data): bool
{
    if (!is_string($data['updated'] ?? null) || !is_array($data['products'] ?? null) || !$data['products']) {
        return false;
    }
    foreach ($data['products'] as $p) {
        if (!is_array($p) || empty($p['regNo']) || !is_array($p['uses'] ?? null)) {
            return false;
        }
    }
    return true;
}
