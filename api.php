<?php
// VitiNote – vstupní bod PHP serveru. .htaccess (Apache) nebo php/router.php (php -S) sem posílá:
//   /, /index.html → r=index     /login, /logout → r=login|logout     /api/<cesta> → r=<cesta>
// Stejné API jako server.py; na webu se heslo vyžaduje vždy (data/heslo.json, viz bin/build-web).
declare(strict_types=1);

require __DIR__ . '/php/lib.php';
require __DIR__ . '/php/por_registry.php';

$route = trim((string)($_GET['r'] ?? ''), '/');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($route === 'login') {
    if ($method === 'POST') {
        $cfg = auth_config();
        if ($cfg && verify_password($cfg, (string)($_POST['heslo'] ?? ''))) {
            set_session_cookie(make_token($cfg), SESSION_DAYS * 86400);
            redirect('./');
        } else {
            sleep(1);   // zpomalit zkoušení hesel
            redirect('login?chyba=1');
        }
    } else {
        login_page(isset($_GET['chyba']));
    }
    exit;
}
if ($route === 'logout') {
    set_session_cookie('', 0);
    redirect('login');
    exit;
}

// Přihlášení. Bez nastaveného hesla se nic nezpřístupní (na webu nesmí aplikace běžet bez hesla).
if (!config()['no_auth']) {
    $cfg = auth_config();
    if ($cfg === null) {
        if ($route === 'index') {
            http_response_code(503);
            header('Content-Type: text/plain; charset=utf-8');
            echo 'VitiNote: heslo není nastavené. Nahraj soubor data/heslo.json (připraví ho bin/build-web).';
        } else {
            send_json(503, ['error' => 'heslo není nastavené']);
        }
        exit;
    }
    if (!check_token($cfg, $_COOKIE[COOKIE] ?? null)) {
        $route === 'index' ? redirect('login') : send_json(401, ['error' => 'nepřihlášeno']);
        exit;
    }
    header('X-Auth: session');
}

try {
    if ($method === 'POST' && !is_dir(data_dir())) {
        mkdir(data_dir(), 0700, true);
    }
    switch ("$method $route") {
        case 'GET index':
        case 'HEAD index':
            header('Content-Type: text/html; charset=utf-8');
            header('Cache-Control: no-cache');
            readfile(APP_DIR . '/index.html');
            break;

        case 'GET data':
            send_file_json(data_file(), 'zatím žádná data');
            break;

        case 'POST data':
        case 'PUT data':
            $data = read_json_body(fn($d) => ($d['version'] ?? null) === 1 && is_array($d['works'] ?? null), 'neplatný formát dat');
            if ($data !== null) {
                $lock = fopen(data_dir() . '/.lock', 'c');
                flock($lock, LOCK_EX);
                write_atomic(data_file(), json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
                daily_backup(data_file(), (int)config()['keep_backups']);
                flock($lock, LOCK_UN);
                header('X-Data-File: ' . rawurlencode(realpath(data_file()) ?: data_file()));
                send_json(200, ['ok' => true]);
            }
            break;

        case 'GET por':
            send_file_json(por_file(), 'registr zatím nebyl stažen');
            break;

        case 'POST por/update':
            @set_time_limit(900);
            ignore_user_abort(true);
            $lock = fopen(data_dir() . '/.por-lock', 'c');
            if (!flock($lock, LOCK_EX | LOCK_NB)) {
                send_json(409, ['error' => 'aktualizace registru už běží']);
                break;
            }
            try {
                $registry = build_vine_registry((string)config()['por_source']);
                write_atomic(por_file(), json_encode($registry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), false);
                send_json(200, ['updated' => $registry['updated'], 'count' => count($registry['products'])]);
            } catch (Throwable $e) {
                send_json(502, ['error' => 'registr se nepodařilo stáhnout: ' . $e->getMessage()]);
            } finally {
                flock($lock, LOCK_UN);
            }
            break;

        case 'POST por/upload':
            $registry = read_json_body('is_registry', 'není to výtah registru (por-reva.json)');
            if ($registry !== null) {
                write_atomic(por_file(), json_encode($registry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), false);
                send_json(200, ['updated' => $registry['updated'], 'count' => count($registry['products'])]);
            }
            break;

        default:
            send_json(404, ['error' => 'neznámá adresa']);
    }
} catch (Throwable $e) {
    send_json(500, ['error' => $e->getMessage()]);
}
