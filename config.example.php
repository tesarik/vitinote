<?php
// Volitelné nastavení PHP verze (webhosting). Zkopíruj jako config.php – bin/build-web ho přibalí.
return [
    // Data mimo veřejnou složku webu (ještě bezpečnější než ochrana přes .htaccess), pokud to hosting dovolí.
    // Do stejné složky pak patří i heslo.json z dist/web/data/.
    // 'data_file' => __DIR__ . '/../vitinote-data/vitinote.json',

    // Kolik denních záloh držet (složka zalohy/ vedle dat).
    // 'keep_backups' => 30,
];
