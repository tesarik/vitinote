import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { withApp, startServer, saved, addVineyard, closeBrowser, FIXTURES } from './helpers.mjs';

after(closeBrowser);

// Soubor se čte asynchronně – počkat, až se otevře náhled.
async function importRegistry(page) {
  await page.setInputFiles('[data-import-rv]', join(FIXTURES, 'registr-vinic.xml'));
  await page.waitForSelector('#dlg[open] input[name=rv]');
}

const text = async (page, sel) => (await page.innerText(sel)).replace(/\s+/g, ' ').trim();

async function addWorker(page, name, rate) {
  await page.goto(page.url().replace(/#.*$/, '') + '#/pracovnici');
  await page.click('.page-head [data-action=new-worker]');
  await page.fill('[name=name]', name);
  await page.fill('[name=rate]', rate);
  await page.click('#dlg button[type=submit]');
  await saved(page);
}

async function addProduct(page, name, { phi = '', dose = '' } = {}) {
  await page.goto(page.url().replace(/#.*$/, '') + '#/pripravky');
  await page.click('.page-head [data-action=new-product]');
  await page.fill('[name=name]', name);
  await page.fill('[name=phiDays]', phi);
  await page.fill('[name=defaultDose]', dose);
  await page.click('#dlg button[type=submit]');
  await saved(page);
}

test('vinice: přidání s odrůdami, úprava a smazání z detailu', () => withApp(async ({ page, readData }) => {
  await addVineyard(page, { name: 'Pod lesem', area: '1,25', varieties: [{ name: 'Pálava', area: '0,5' }, { name: 'Sauvignon' }] });
  let v = readData().vineyards[0];
  assert.equal(v.area, 1.25);
  assert.deepEqual(v.varieties.map(x => [x.name, x.area]), [['Pálava', 0.5], ['Sauvignon', null]]);

  await page.click('.list .item');
  await page.click('[data-action=edit-vineyard]');
  await page.fill('[name=name]', 'Pod lesem horní');
  await page.click('#dlg button[type=submit]');
  await saved(page);
  assert.equal(readData().vineyards[0].name, 'Pod lesem horní');

  await page.click('main [data-action=delete-vineyard]');
  await saved(page);
  assert.equal(await page.evaluate(() => location.hash), '#/vinice');
  assert.equal(readData().vineyards.length, 0);
}));

test('postřik do dvou vinic: hodiny, náklady, spotřeba a ochranná lhůta', () => withApp(async ({ page, readData }) => {
  await addVineyard(page, { name: 'A', area: '1,2' });
  await addVineyard(page, { name: 'B', area: '0,8' });
  await addWorker(page, 'Jan', '200');
  await addProduct(page, 'Kuprikol', { phi: '21', dose: '2,5' });

  await page.click('.topbar [data-action=new-work]');
  await page.selectOption('[name=activityId]', { label: 'Postřik' });
  await page.check('input[name=vineyards] >> nth=0');
  await page.check('input[name=vineyards] >> nth=1');
  await page.selectOption('[name=w-id]', { label: 'Jan' });
  await page.fill('[name=w-hours]', '3');
  await page.selectOption('[name=p-id]', { label: 'Kuprikol' });
  assert.equal(await page.inputValue('[name=p-dose]'), '2,5', 'obvyklá dávka se předvyplní');
  await page.click('#dlg button[type=submit]');
  await saved(page);

  assert.equal(readData().works.length, 2);
  await page.goto(page.url().replace(/#.*$/, '') + '#/pracovnici');
  assert.match(await text(page, 'tfoot'), /Celkem 6 1 200 Kč/);

  await page.goto(page.url().replace(/#.*$/, '') + '#/pripravky');
  assert.match(await text(page, '.list'), /letos spotřebováno 5 l/, '2,5 l/ha × (1,2 + 0,8) ha');

  await page.goto(page.url().replace(/#.*$/, '') + '#/');
  assert.match(await text(page, 'main'), /Běžící ochranné lhůty.*ještě 21 dní/);
}));

test('tlačítko + Práce v záhlaví předvybere vinici z detailu', () => withApp(async ({ page }) => {
  await addVineyard(page, { name: 'Alfa' });
  await addVineyard(page, { name: 'Beta' });
  await page.getByText('Beta', { exact: true }).click();
  await page.click('.topbar [data-action=new-work]');
  const checked = await page.$$eval('input[name=vineyards]:checked', els => els.map(e => e.parentElement.textContent.trim()));
  assert.deepEqual(checked, ['Beta']);
}));

test('sklizeň po odrůdách a souhrn v detailu vinice', () => withApp(async ({ page, readData }) => {
  await addVineyard(page, { name: 'A', area: '1', varieties: [{ name: 'Pálava', area: '0,4' }, { name: 'Sauvignon', area: '0,6' }] });
  await addVineyard(page, { name: 'B' });
  const id = readData().vineyards.find(v => v.name === 'A').id;

  // Sklizeň do dvou vinic najednou se odmítne.
  await page.click('.topbar [data-action=new-work]');
  await page.selectOption('[name=activityId]', { label: 'Sklizeň' });
  await page.check('input[name=vineyards] >> nth=0');
  await page.check('input[name=vineyards] >> nth=1');
  await page.click('#dlg button[type=submit]');
  assert.ok(await page.evaluate(() => document.querySelector('#dlg').open), 'dialog zůstane otevřený');
  await page.click('#dlg [data-action=close-dialog] >> nth=0');

  await page.goto(page.url().replace(/#.*$/, '') + '#/vinice/' + id);
  await page.click('main [data-action=new-work]');
  await page.selectOption('[name=activityId]', { label: 'Sklizeň' });
  const opts = await page.$$eval('select[name=h-variety] option', o => o.map(x => x.textContent));
  assert.deepEqual(opts, ['— celá vinice —', 'Pálava', 'Sauvignon']);
  await page.selectOption('.row-harvest >> nth=0 >> select', 'Pálava');
  await page.fill('.row-harvest >> nth=0 >> [name=h-kg]', '2000');
  await page.fill('.row-harvest >> nth=0 >> [name=h-sugar]', '22');
  await page.click('[data-action=add-harvest-row]');
  await page.selectOption('.row-harvest >> nth=1 >> select', 'Sauvignon');
  await page.fill('.row-harvest >> nth=1 >> [name=h-kg]', '3000');
  await page.click('#dlg button[type=submit]');
  await saved(page);

  const w = readData().works[0];
  assert.deepEqual(w.harvest, [{ variety: 'Pálava', kg: 2000, sugar: 22 }, { variety: 'Sauvignon', kg: 3000, sugar: null }]);
  const table = await text(page, 'main table');
  assert.match(table, /Pálava 2 000 5 22/, '2 t z 0,4 ha = 5 t/ha');
  assert.match(table, /Sauvignon 3 000 5 –/);
}));

test('starší data se převedou (odrůda jako text, sklizeň jedním číslem)', () => withApp(async ({ page }) => {
  await page.goto(page.url().replace(/#.*$/, '') + '#/vinice/v1');
  await page.selectOption('#year', '2025');
  assert.match(await text(page, '.kv'), /Odrůdy Ryzlink.*Veltlín/);
  assert.match(await text(page, 'main'), /celá vinice 1 500 kg 20 °NM/);
}, {
  initialData: {
    version: 1, workers: [], products: [],
    vineyards: [{ id: 'v1', name: 'Stará', area: 1, variety: 'Ryzlink, Veltlín' }],
    works: [{ id: 'w1', vineyardId: 'v1', date: '2025-09-20', type: 'Sklizeň', status: 'done', workers: [], products: [], harvestKg: 1500, sugar: 20 }],
  },
}));

test('import z Registru vinic: náhled, uložení, párování podle DPB a opakovaný import', () => withApp(async ({ page, readData }) => {
  // Ručně založená vinice se stejným blokem DPB se má spárovat, ne zdvojit.
  await addVineyard(page, { name: 'Moje stráň' });
  await page.click('.list .item');
  await page.click('[data-action=edit-vineyard]');
  await page.fill('[name=dpb]', '0202/3');
  await page.click('#dlg button[type=submit]');
  await saved(page);

  await page.goto(page.url().replace(/#.*$/, '') + '#/nastaveni');
  await importRegistry(page);
  assert.equal(await page.textContent('#dlg-title'), 'Import z Registru vinic (2)');
  assert.deepEqual(await page.$$eval('#dlg .item-title .badge', b => b.map(x => x.textContent)), ['nová', 'aktualizace']);
  await page.click('#dlg button[type=submit]');
  await saved(page);

  const data = readData();
  assert.equal(data.vineyards.length, 2);
  const za = data.vineyards.find(v => v.regNo === '999999/0001');
  assert.equal(za.name, 'Za humny 0001');
  assert.equal(za.area, 0.25);
  assert.equal(za.dpb, '600-1100 0101/1');
  assert.equal(za.plantedYear, '2005–2019');
  assert.equal(za.varieties.length, 3);
  assert.deepEqual(za.varieties[0], { name: 'Ryzlink rýnský', code: 'VIT00032', area: 0.1, year: '2005', vines: 400, training: 'Střední' });
  const matched = data.vineyards.find(v => v.regNo === '999999/0002');
  assert.equal(matched.name, 'Moje stráň', 'název ručně založené vinice zůstane');
  assert.equal(matched.area, 0.12);
  const raw = JSON.stringify(data);
  assert.ok(!raw.includes('12345678') && !raw.includes('Testovací vinařství'), 'údaje o subjektu se neukládají');

  // Uložení přes formulář nesmí změnit data z registru → opakovaný import je „beze změny“.
  await page.goto(page.url().replace(/#.*$/, '') + '#/vinice/' + za.id);
  await page.click('[data-action=edit-vineyard]');
  await page.click('#dlg button[type=submit]');
  await saved(page);
  await page.goto(page.url().replace(/#.*$/, '') + '#/nastaveni');
  await importRegistry(page);
  assert.deepEqual(await page.$$eval('#dlg .item-title .badge', b => b.map(x => x.textContent)), ['beze změny', 'beze změny']);
  assert.equal(await page.$$eval('#dlg input[name=rv]:checked', c => c.length), 0);
}));

test('ukládání na disk: jiný prohlížeč vidí data, výpadek serveru se dorovná', () => withApp(async ({ page, server, readData, newPage }) => {
  await addVineyard(page, { name: 'Sdílená' });
  const other = await newPage();
  await other.goto(server.url + '#/vinice');
  await other.waitForSelector('.list .item');
  assert.match(await text(other, '.list'), /Sdílená/);

  await server.stop();
  await addVineyard(page, { name: 'Offline' }, { wait: false });
  await page.waitForSelector('#sync[data-state=local]', { state: 'attached' });
  assert.ok(!readData().vineyards.some(v => v.name === 'Offline'));

  const restarted = await startServer({ port: server.port, dataFile: server.dataFile });
  server.stop = restarted.stop; // ať withApp ukončí nový proces
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await saved(page);
  assert.ok(readData().vineyards.some(v => v.name === 'Offline'));
}));

test('pozdní odpověď serveru nepřepíše novější místní změnu', () => withApp(async ({ page, readData }) => {
  await addVineyard(page, { name: 'První' });
  // Zdržet načtení dat ze serveru (stará verze) až za uložení nové vinice.
  let release;
  const gate = new Promise(r => { release = r; });
  await page.route('**/api/data', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await addVineyard(page, { name: 'Druhá' });
  release();
  await page.waitForTimeout(300);
  await page.unroute('**/api/data');

  const local = await page.evaluate(() => JSON.parse(localStorage.getItem('vitinote:v1')).vineyards.map(v => v.name));
  assert.deepEqual(local.sort(), ['Druhá', 'První']);
  assert.deepEqual(readData().vineyards.map(v => v.name).sort(), ['Druhá', 'První']);
  await page.goto(page.url().replace(/#.*$/, '') + '#/vinice');
  assert.match(await text(page, '.list'), /Druhá/);
}));

test('výběr roku přepíná práce, detail vinice, lidi i export', () => {
  const cy = String(new Date().getFullYear());
  const work = (id, date, extra) => ({ id, vineyardId: 'v1', date, status: 'done', workers: [{ workerId: 'p1', hours: 4 }], products: [], harvest: [], ...extra });
  return withApp(async ({ page }) => {
    const base = page.url().replace(/#.*$/, '');
    assert.equal(await page.inputValue('#year'), cy, 'výchozí je letošní rok');
    assert.deepEqual(await page.$$eval('#year option', o => o.map(x => x.textContent)), [cy, '2024']);

    await page.goto(base + '#/prace');
    assert.equal(await text(page, 'main h1'), `Práce ${cy}`);
    assert.match(await text(page, 'main p.muted'), /^1 záznamů/);

    await page.selectOption('#year', '2024');
    assert.ok(await page.$eval('#year', el => el.classList.contains('past')), 'minulý rok je zvýrazněný');
    assert.equal(await text(page, 'main h1'), 'Práce 2024');
    assert.equal(await text(page, 'main p.muted'), '2 záznamů · 8 odpracovaných hodin');
    await page.selectOption('[data-filter=month]', '09');
    assert.match(await text(page, 'main p.muted'), /^1 záznamů/);

    await page.goto(base + '#/vinice/v1');
    const main = await text(page, 'main');
    assert.match(main, /odpracováno v roce 2024/);
    assert.match(main, /Sklizeň 2024 Odrůda kg t\/ha °NM Pálava 4 000 4 19/);
    assert.match(main, new RegExp(`Sklizeň po letech Rok kg t/ha °NM ${cy} 5 000 5 21 2024 4 000 4 19`));
    await page.click(`[data-action=set-year][data-year="${cy}"]`);
    assert.equal(await page.inputValue('#year'), cy);
    assert.match(await text(page, 'main'), /Sklizeň \d{4} Odrůda kg t\/ha °NM Pálava 5 000 5 21/);

    await page.selectOption('#year', '2024');
    await page.goto(base + '#/pracovnici');
    assert.equal(await page.inputValue('[data-filter=workersPeriod]'), '', 'u minulého roku celý rok');
    assert.match(await text(page, 'main'), /Rok 2024.*Celkem 8 1 600 Kč/);

    await page.goto(base + '#/nastaveni');
    assert.equal(await page.inputValue('#export-year'), '2024');

    // Nová práce s letošním datem při vybraném roce 2024 → přepne na letošek.
    await page.click('.topbar [data-action=new-work]');
    await page.check('input[name=vineyards] >> nth=0');
    await page.click('#dlg button[type=submit]');
    await saved(page);
    assert.equal(await page.inputValue('#year'), cy);
  }, {
    initialData: {
      version: 1,
      vineyards: [{ id: 'v1', name: 'Vinice', area: 1, varieties: [{ name: 'Pálava', area: 1 }] }],
      workers: [{ id: 'p1', name: 'Jan', rate: 200 }],
      products: [],
      works: [
        work('a', '2024-04-02', { type: 'Řez' }),
        work('b', '2024-09-20', { type: 'Sklizeň', harvest: [{ variety: 'Pálava', kg: 4000, sugar: 19 }] }),
        work('c', `${cy}-01-15`, { type: 'Sklizeň', harvest: [{ variety: 'Pálava', kg: 5000, sugar: 21 }] }),
      ],
    },
  });
});

const isoDaysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('číselník činností: přidání, přejmenování, skrytí, řazení a ochrana použitých', () => withApp(async ({ page, readData }) => {
  const base = page.url().replace(/#.*$/, '');
  const activities = () => readData().activities.map(a => a.name);
  await page.goto(base + '#/nastaveni');

  await page.click('[data-action=new-activity]');
  await page.fill('[name=name]', 'Listové hnojení');
  await page.selectOption('[name=kind]', 'spray');
  await page.click('#dlg button[type=submit]');
  await saved(page);
  assert.equal(activities().at(-1), 'Listové hnojení');

  await page.click('[data-action=edit-activity] >> text=Řez');
  await page.fill('[name=name]', 'Zimní řez');
  await page.click('#dlg button[type=submit]');
  await saved(page);
  await page.click('[data-action=edit-activity] >> text=Vázání');
  await page.check('[name=hidden]');
  await page.click('#dlg button[type=submit]');
  await saved(page);
  await page.click('[data-action=move-activity][data-dir="-1"] >> nth=-1');   // Listové hnojení o jedno výš
  await saved(page);
  assert.deepEqual(activities().slice(-2), ['Listové hnojení', 'Jiné']);

  // Stará práce s textovou činností „Řez“ se převedla a ukazuje nový název.
  await page.goto(base + '#/prace');
  assert.match(await text(page, '.list'), /Zimní řez/);
  assert.equal(readData().works[0].activityId, 'act-rez');

  // Použitou činnost nejde smazat.
  await page.goto(base + '#/nastaveni');
  await page.click('[data-action=edit-activity] >> text=Zimní řez');
  await page.click('#dlg-delete');
  assert.ok(await page.evaluate(() => document.querySelector('#dlg').open));
  assert.ok(activities().includes('Zimní řez'));
  await page.click('#dlg [data-action=close-dialog] >> nth=0');

  // Skrytá se nenabízí, nová s chováním „ošetření“ zobrazí přípravky.
  await page.click('.topbar [data-action=new-work]');
  const offered = await page.$$eval('[name=activityId] option', o => o.map(x => x.textContent));
  assert.ok(!offered.includes('Vázání') && offered.includes('Listové hnojení'));
  await page.selectOption('[name=activityId]', { label: 'Listové hnojení' });
  assert.ok(await page.isVisible('#products-section'));
}, {
  initialData: {
    version: 1, workers: [], products: [],
    vineyards: [{ id: 'v1', name: 'Vinice', area: 1, varieties: [] }],
    works: [{ id: 'w1', vineyardId: 'v1', date: isoDaysAgo(1), type: 'Řez', status: 'done', workers: [], products: [] }],
  },
}));

test('registr ÚKZÚZ: aktualizace, přípravek z registru, použití u postřiku, OL a export POR', () => withApp(async ({ page, readData, dialogs, answerDialogs }) => {
  const base = page.url().replace(/#.*$/, '');
  await addVineyard(page, { name: 'Vinice', area: '1' });

  await page.goto(base + '#/pripravky');
  await page.click('[data-action=update-registry]');
  await page.waitForSelector('text=2 povolených přípravků pro révu');

  const addFromRegistry = async query => {
    await page.click('.page-head [data-action=new-product]');
    await page.fill('#por-search', query);
    await page.click('.por-hit');
    await page.click('#dlg button[type=submit]');
    await saved(page);
  };
  await page.click('.page-head [data-action=new-product]');
  await page.fill('#por-search', 'testc');
  await page.click('.por-hit');
  assert.equal(await page.inputValue('[name=name]'), 'Testcupro 50 WP');
  assert.equal(await page.inputValue('[name=regNo]'), '9001-1');
  assert.equal(await page.inputValue('[name=kind]'), 'Fungicid');
  assert.equal(await page.inputValue('[name=unit]'), 'kg');
  assert.equal(await page.inputValue('[name=defaultDose]'), '2');
  assert.equal(await page.inputValue('[name=phiDays]'), '21');
  assert.match(await text(page, '#por-info'), /plíseň révová.*černá skvrnitost révy · 1,5 kg\/ha · OL AT/);
  await page.click('#dlg button[type=submit]');
  await saved(page);
  await addFromRegistry('9002-1');
  const list = await text(page, '.list');
  assert.match(list, /Testcupro 50 WP Fungicid reg\. č\. 9001-1 · 2 povolených použití/);
  assert.match(list, /Starotox 10 EC Insekticid nelze použít – zásoby šlo použít do 1\. 1\. 2021/);

  const spray = async (productLabel, useIndex) => {
    await page.click('.topbar [data-action=new-work]');
    await page.selectOption('[name=activityId]', { label: 'Postřik' });
    await page.check('input[name=vineyards] >> nth=0');
    await page.selectOption('[name=p-id]', { label: productLabel });
    if (useIndex != null) await page.selectOption('[name=p-use]', { index: useIndex });
    await page.click('#dlg button[type=submit]');
  };
  // Použití s OL „AT“ → bez pevné ochranné lhůty, dávka podle použití.
  await spray('Testcupro 50 WP', 2);
  await saved(page);
  let w = readData().works.at(-1);
  assert.deepEqual(w.products[0], { productId: w.products[0].productId, dose: 1.5, useId: '102', pest: 'černá skvrnitost révy', phi: 'AT', phiDays: null });
  assert.equal(w.target, 'černá skvrnitost révy');
  await page.goto(base + '#/');
  assert.doesNotMatch(await text(page, 'main'), /Běžící ochranné lhůty/);

  // Použití s OL 21 dní.
  await spray('Testcupro 50 WP', 1);
  await saved(page);
  assert.match(await text(page, 'main'), /Běžící ochranné lhůty.*ještě 21 dní/);

  // Přípravek po konci spotřeby zásob → potvrzení; při odmítnutí se nic neuloží.
  answerDialogs(false);
  const count = readData().works.length;
  await spray('Starotox 10 EC');
  assert.match(dialogs.at(-1), /Starotox 10 EC: nelze použít/);
  assert.equal(readData().works.length, count);
  await page.click('#dlg [data-action=close-dialog] >> nth=0');

  // Export evidence POR obsahuje reg. číslo, účel a OL podle použití.
  await page.goto(base + '#/nastaveni');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action=export-por]')]);
  const csv = (await import('node:fs')).readFileSync(await download.path(), 'utf8');
  assert.match(csv, /Testcupro 50 WP;9001-1;Fungicid;1,5;kg;1,5;;černá skvrnitost révy;AT/);
  assert.match(csv, /Testcupro 50 WP;9001-1;Fungicid;2;kg;2;;plíseň révová;21/);
}));

test('sklizeň v ochranné lhůtě: upozornění ve formuláři a potvrzení', () => withApp(async ({ page, readData, dialogs, answerDialogs }) => {
  const base = page.url().replace(/#.*$/, '');
  await page.goto(base + '#/vinice/v1');
  await page.click('main [data-action=new-work]');
  await page.selectOption('[name=activityId]', { label: 'Sklizeň' });
  assert.match(await text(page, '#harvest-hint'), /Ochranná lhůta běží do .* \(Fungi\)/);
  await page.fill('[name=h-kg]', '1000');

  answerDialogs(false);
  await page.click('#dlg button[type=submit]');
  assert.match(dialogs.at(-1), /Na vinici běží ochranná lhůta/);
  assert.equal(readData().works.length, 1);

  answerDialogs(true);
  await page.click('#dlg button[type=submit]');
  await saved(page);
  assert.equal(readData().works.length, 2);

  // Sklizeň s datem po konci lhůty projde bez dotazu.
  const before = dialogs.length;
  await page.click('main [data-action=new-work]');
  await page.selectOption('[name=activityId]', { label: 'Sklizeň' });
  await page.fill('[name=date]', isoDaysAgo(-20));
  await page.dispatchEvent('[name=date]', 'change');
  assert.equal(await text(page, '#harvest-hint'), '');
  await page.click('#dlg button[type=submit]');
  await saved(page);
  assert.equal(dialogs.length, before);
}, {
  initialData: {
    version: 1, workers: [],
    vineyards: [{ id: 'v1', name: 'Vinice', area: 1, varieties: [] }],
    products: [{ id: 'p1', name: 'Fungi', kind: 'Fungicid', unit: 'l', phiDays: 21 }],
    works: [{ id: 'w1', vineyardId: 'v1', date: isoDaysAgo(5), type: 'Postřik', status: 'done', workers: [], products: [{ productId: 'p1', dose: 1 }] }],
  },
}));

test('manifest a ikony pro instalaci', () => withApp(async ({ server }) => {
  const manifest = await (await fetch(server.url + 'manifest.webmanifest')).json();
  const sizes = manifest.icons.filter(i => i.type === 'image/png').map(i => `${i.sizes} ${i.purpose}`);
  assert.deepEqual(sizes, ['192x192 any', '512x512 any', '512x512 maskable']);
  for (const src of [...manifest.icons.map(i => i.src), 'apple-touch-icon.png']) {
    const res = await fetch(server.url + src);
    assert.equal(res.status, 200, src);
  }
}));
