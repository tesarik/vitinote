<?php
// VitiNote – PHP verze serveru pro webhosting (stejné API jako server.py, stejné soubory s daty a heslem).
declare(strict_types=1);

const APP_DIR = __DIR__ . '/..';
const MAX_BODY = 20 * 1024 * 1024;
const COOKIE = 'vitinote_session';
const SESSION_DAYS = 90;
const POR_EXPORT_URL = 'https://mze.gov.cz/public/app/eagriapp/POR/export.xml';

// Nastavení: výchozí hodnoty, případně config.php (vrací pole) a při vývojovém serveru (php -S) proměnné prostředí.
function config(): array
{
    static $cfg = null;
    if ($cfg !== null) {
        return $cfg;
    }
    $cfg = ['data_file' => APP_DIR . '/data/vitinote.json', 'keep_backups' => 30, 'por_source' => POR_EXPORT_URL, 'no_auth' => false];
    if (is_file(APP_DIR . '/config.php')) {
        $cfg = array_merge($cfg, require APP_DIR . '/config.php');
    }
    if (PHP_SAPI === 'cli-server') {   // jen testy / lokální vývoj, na webhostingu se nepoužije
        $env = fn(string $k) => getenv($k) === false ? null : getenv($k);
        $cfg['data_file'] = $env('VITINOTE_DATA') ?? $cfg['data_file'];
        $cfg['por_source'] = $env('VITINOTE_POR_SOURCE') ?? $cfg['por_source'];
        $cfg['keep_backups'] = (int)($env('VITINOTE_KEEP_BACKUPS') ?? $cfg['keep_backups']);
        $cfg['no_auth'] = $env('VITINOTE_NO_AUTH') === '1';
    }
    return $cfg;
}

function data_file(): string { return config()['data_file']; }
function data_dir(): string { return dirname(data_file()); }
function auth_file(): string { return data_dir() . '/heslo.json'; }
function backup_dir(): string { return data_dir() . '/zalohy'; }
function por_file(): string { return data_dir() . '/por-reva.json'; }

function send_json(int $status, $obj): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($obj, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function send_file_json(string $path, string $missing): void
{
    if (!is_file($path)) {
        send_json(404, ['error' => $missing]);
        return;
    }
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Data-File: ' . rawurlencode(realpath(data_file()) ?: data_file()));
    header('X-Backups: ' . rawurlencode(backup_dir()) . ';keep=' . config()['keep_backups']);
    readfile($path);
}

function redirect(string $location): void
{
    http_response_code(303);
    header('Location: ' . $location);
}

// Načte JSON z těla požadavku; při chybě odpoví sám a vrátí null.
function read_json_body(callable $valid, string $message): ?array
{
    $body = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
    if ($body === false || $body === '' || strlen($body) > MAX_BODY) {
        send_json($body ? 413 : 400, ['error' => 'prázdný nebo příliš velký požadavek']);
        return null;
    }
    $data = json_decode($body, true);
    if (!is_array($data) || !$valid($data)) {
        send_json(400, ['error' => $message]);
        return null;
    }
    return $data;
}

// Zápis přes dočasný soubor (nikdy nepoškodí data); předchozí verzi nechá jako .bak.
function write_atomic(string $path, string $content, bool $backup = true): void
{
    $dir = dirname($path);
    if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) {
        throw new RuntimeException("nelze vytvořit složku $dir");
    }
    $tmp = tempnam($dir, '.vitinote-');
    if ($tmp === false || file_put_contents($tmp, $content, LOCK_EX) === false) {
        throw new RuntimeException('zápis selhal');
    }
    chmod($tmp, 0600);
    if ($backup && is_file($path)) {
        copy($path, $path . '.bak');
    }
    if (!rename($tmp, $path)) {
        @unlink($tmp);
        throw new RuntimeException('zápis selhal');
    }
}

// Kopie dat za každý den (poslední stav dne) do zalohy/<jméno>-RRRR-MM-DD.json; drží `keep` nejnovějších.
function daily_backup(string $file, int $keep): void
{
    if ($keep <= 0) {
        return;
    }
    $dir = backup_dir();
    if (!is_dir($dir)) {
        mkdir($dir, 0700, true);
    }
    $stem = pathinfo($file, PATHINFO_FILENAME);
    copy($file, "$dir/$stem-" . date('Y-m-d') . '.json');
    $all = glob("$dir/$stem-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].json") ?: [];
    sort($all);
    foreach (array_slice($all, 0, max(0, count($all) - $keep)) as $old) {
        unlink($old);
    }
}

// --- Heslo: stejný formát heslo.json i cookie jako auth.py (PBKDF2-SHA256, HMAC podpis platnosti).

function auth_config(): ?array
{
    if (!is_file(auth_file())) {
        return null;
    }
    $cfg = json_decode((string)file_get_contents(auth_file()), true);
    return is_array($cfg) ? $cfg : null;
}

function verify_password(array $cfg, string $password): bool
{
    $hash = hash_pbkdf2('sha256', $password, hex2bin($cfg['salt']), (int)$cfg['iterations'], 64);
    return hash_equals($cfg['hash'], $hash);
}

function sign(array $cfg, string $payload): string
{
    return hash_hmac('sha256', $payload, hex2bin($cfg['secret']));
}

function make_token(array $cfg): string
{
    $expires = (string)(time() + SESSION_DAYS * 86400);
    return $expires . '.' . sign($cfg, $expires);
}

function check_token(array $cfg, ?string $token): bool
{
    if (!$token || !preg_match('/^(\d+)\.([0-9a-f]{64})$/', $token, $m) || (int)$m[1] < time()) {
        return false;
    }
    return hash_equals(sign($cfg, $m[1]), $m[2]);
}

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
}

function set_session_cookie(string $value, int $maxAge): void
{
    setcookie(COOKIE, $value, [
        'expires' => $maxAge > 0 ? time() + $maxAge : 1, 'path' => '/',
        'httponly' => true, 'samesite' => 'Strict', 'secure' => is_https(),
    ]);
}

function login_page(bool $error): void
{
    header('Content-Type: text/html; charset=utf-8');
    $msg = $error ? '<p class="error">Nesprávné heslo.</p>' : '';
    echo str_replace('{error}', $msg, (string)file_get_contents(APP_DIR . '/login.html'));
}
