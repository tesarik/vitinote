<?php
// Směrování pro vestavěný server PHP (testy a lokální vyzkoušení): php -S 127.0.0.1:8080 php/router.php
// Dělá totéž co .htaccess na webhostingu.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (preg_match('#^/(data|php|tests|bin|temp|dist)(/|$)#', $path) || preg_match('#\.(py|md|bak|json)$#', $path)) {
    http_response_code(403);
    return true;
}
$routes = ['/' => 'index', '/index.html' => 'index', '/login' => 'login', '/logout' => 'logout'];
if (isset($routes[$path]) || preg_match('#^/api/(.+)$#', $path, $m)) {
    $_GET['r'] = $routes[$path] ?? $m[1];
    require __DIR__ . '/../api.php';
    return true;
}
return false;   // ostatní (JS, CSS, ikony) obslouží vestavěný server jako statické soubory
