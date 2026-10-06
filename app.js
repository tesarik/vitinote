'use strict';

/* ================= Data ================= */

const DB_KEY = 'vitinote:v1';
const PRODUCT_KINDS = ['Fungicid', 'Insekticid', 'Akaricid', 'Herbicid', 'Hnojivo', 'Jiné'];

// Číselník činností: chování určuje, jaká pole má formulář práce (přípravky / sklizeň).
const ACTIVITY_KINDS = { work: 'Běžná práce', spray: 'Ošetření (přípravky)', harvest: 'Sklizeň' };
const DEFAULT_ACTIVITIES = [
  ['Řez', 'work'], ['Vázání', 'work'], ['Čištění kmínků', 'work'], ['Podlom', 'work'], ['Zastrkování', 'work'],
  ['Vylamování zálistků', 'work'], ['Odlistění zóny hroznů', 'work'], ['Osečkování', 'work'], ['Postřik', 'spray'],
  ['Hnojení', 'spray'], ['Kultivace / mulčování', 'work'], ['Sklizeň', 'harvest'], ['Jiné', 'work'],
];
// Názvy z dřívějšího pevného seznamu: přejmenované → nový název; zrušené se zachovají jako skryté.
const LEGACY_ACTIVITY_NAMES = { 'Zastřihování': 'Osečkování' };
const RETIRED_ACTIVITY_NAMES = new Set(['Zelené práce']);
// Stabilní id z názvu: převod starých dat na dvou zařízeních tak vytvoří stejná id.
const activityIdFor = name => 'act-' + name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const defaultActivities = () => DEFAULT_ACTIVITIES.map(([name, kind]) => ({ id: activityIdFor(name), name, kind, hidden: false }));

// `migrated` = jednorázové převody, které už proběhly (nesmí se opakovat nad daty, která uživatel mezitím změnil).
const emptyDb = () => ({ version: 1, migrated: { regNoNames: true }, activities: defaultActivities(), vineyards: [], workers: [], products: [], works: [] });

// Doplní chybějící kolekce a převede starší tvary dat (jedna odrůda jako text → seznam odrůd).
function normalizeDb(d) {
  const migrateNames = !d.migrated?.regNoNames;
  d = { ...emptyDb(), ...d, migrated: { ...d.migrated, regNoNames: true } };
  for (const v of d.vineyards) {
    if (!Array.isArray(v.varieties)) {
      v.varieties = String(v.variety ?? '').split(',').map(s => s.trim()).filter(Boolean).map(name => ({ name, area: null }));
    }
    delete v.variety;
    // Dřívější import dával do jména jen číslo za lomítkem („Vyšicko 0742“) → doplnit celé reg. číslo.
    // Jména, která si uživatel změnil, končí jinak a zůstanou.
    const short = v.regNo?.split('/')[1];
    if (migrateNames && short && v.name.endsWith(' ' + short)) v.name = v.name.slice(0, -short.length) + v.regNo;
  }
  // Sklizeň: jedno množství na práci → seznam po odrůdách.
  for (const w of d.works) {
    if (!Array.isArray(w.harvest)) {
      w.harvest = w.harvestKg != null || w.sugar != null ? [{ variety: '', kg: w.harvestKg ?? null, sugar: w.sugar ?? null }] : [];
    }
    delete w.harvestKg;
    delete w.sugar;
  }
  // Činnost: text (w.type) → odkaz do číselníku (w.activityId).
  for (const w of d.works) {
    if (w.activityId || w.type == null) continue;
    const name = LEGACY_ACTIVITY_NAMES[w.type] ?? w.type;
    let a = d.activities.find(x => x.name === name);
    if (!a) {
      a = { id: activityIdFor(name), name, kind: 'work', hidden: RETIRED_ACTIVITY_NAMES.has(name) };
      d.activities.push(a);
    }
    w.activityId = a.id;
    delete w.type;
  }
  return d;
}

function loadDb() {
  try {
    const d = JSON.parse(localStorage.getItem(DB_KEY));
    if (d && d.version === 1) return normalizeDb(d);
  } catch { /* poškozená nebo nedostupná data → začneme načisto */ }
  return emptyDb();
}

/*
 * Hlavní úložiště je JSON soubor na disku (přes server.py, endpoint api/data).
 * localStorage drží kopii pro okamžité načtení a pro práci bez serveru; neuložené
 * změny označuje příznak DIRTY_KEY a odešlou se, jakmile je server zase dostupný.
 */
const DIRTY_KEY = 'vitinote:dirty';
const API_URL = 'api/data';

let db = loadDb();
const sync = { state: 'pending', file: '' };

function writeLocal() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch (e) {
    toast('Uložení v prohlížeči selhalo: ' + e.message);
  }
}

function setDirty(on) {
  try { on ? localStorage.setItem(DIRTY_KEY, '1') : localStorage.removeItem(DIRTY_KEY); } catch { /* jen příznak */ }
}
const isDirty = () => { try { return !!localStorage.getItem(DIRTY_KEY); } catch { return false; } };

function setSync(state, res) {
  sync.state = state;
  if (res?.headers.get('X-Data-File')) sync.file = decodeURIComponent(res.headers.get('X-Data-File'));
  const el = $('#sync');
  el.dataset.state = state;
  el.textContent = { disk: 'Uloženo', saving: 'Ukládám…', local: 'Jen v prohlížeči', pending: '' }[state];
  el.title = state === 'disk' ? `Uloženo v souboru ${sync.file}` : state === 'local'
    ? 'Server není dostupný – změny jsou zatím jen v prohlížeči a uloží se na disk, až poběží server.py' : '';
  if (location.hash.startsWith('#/nastaveni') && !dlg.open) render();
}

// Počítadlo místních změn: odpověď serveru, která dorazí až po nich, je zastaralá.
let localChanges = 0;

function save() {
  localChanges++;
  writeLocal();
  setDirty(true);
  pushToServer();
}

let pushing = false;
let pushAgain = false;

async function pushToServer() {
  if (pushing) { pushAgain = true; return; }
  pushing = true;
  setSync('saving');
  try {
    let res;
    do {
      pushAgain = false;
      res = await fetch(API_URL, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(db) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
    } while (pushAgain);
    setDirty(false);
    setSync('disk', res);
  } catch {
    setSync('local');
  } finally {
    pushing = false;
  }
}

// Načte data ze souboru na disku. Neodeslané místní změny mají přednost a odešlou se.
async function pullFromServer() {
  if (pushing || dlg.open) return;
  if (isDirty()) return pushToServer();
  const changesBefore = localChanges;
  try {
    const res = await fetch(API_URL, { cache: 'no-store' });
    // Mezitím se uložila místní změna → nepřepisovat ji starší verzí ze serveru.
    if (localChanges !== changesBefore) return;
    if (res.status === 404 && res.headers.get('Content-Type')?.includes('json')) {
      // Soubor zatím neexistuje → založíme ho z dat v prohlížeči.
      setDirty(true);
      return pushToServer();
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = normalizeDb(await res.json());
    if (dlg.open || localChanges !== changesBefore) return;
    const isEmpty = d => !d.vineyards.length && !d.works.length && !d.workers.length && !d.products.length;
    if (isEmpty(data) && !isEmpty(db)) {
      // Prázdný soubor nesmí přemazat data, která už jsou v prohlížeči.
      setDirty(true);
      return pushToServer();
    }
    if (JSON.stringify(data) !== JSON.stringify(db)) {
      db = data;
      writeLocal();
      render();
    }
    setSync('disk', res);
  } catch {
    setSync('local');
  }
}

/* ================= Utils ================= */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => toISO(new Date());
const thisMonth = () => today().slice(0, 7);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return toISO(d); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${+d}. ${+m}. ${y}`; };
const fmtMonth = ym => { const [y, m] = ym.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' }); };
const fmtNum = (v, digits = 2) => (+v || 0).toLocaleString('cs-CZ', { maximumFractionDigits: digits });
// Číslo do pole formuláře s desetinnou čárkou (parseNum přijímá obojí).
const numVal = v => (v == null ? '' : String(v).replace('.', ','));
const parseNum = v => { const n = parseFloat(String(v ?? '').replace(',', '.').replace(/\s/g, '')); return Number.isFinite(n) ? n : null; };
const byId = (list, id) => list.find(x => x.id === id);
const sortByName = list => [...list].sort((a, b) => a.name.localeCompare(b.name, 'cs'));
const isPlanned = w => w.status === 'planned';

// Pozemek v přípravě na výsadbu je vinice se stage 'preparation'; vysazená vinice stage nemá.
const isPrep = v => v?.stage === 'preparation';
const plantedVineyards = () => db.vineyards.filter(v => !isPrep(v));
const placeLabel = v => (isPrep(v) ? 'pozemek' : 'vinici');
// Vinice má výchozí název (`name`, např. z Registru vinic) a nepovinný vlastní (`alias`), který má přednost.
const vName = v => v.alias || v.name;
const sortVineyards = list => [...list].sort((a, b) => vName(a).localeCompare(vName(b), 'cs'));
const vineyardName = id => { const v = byId(db.vineyards, id); return v ? vName(v) : '(smazaná vinice)'; };
const workerName = id => byId(db.workers, id)?.name ?? '(smazaný)';
const varietyNames = v => [...new Set((v.varieties || []).map(x => x.name))].join(', ');
const harvestKg = w => (w.harvest || []).reduce((s, h) => s + (+h.kg || 0), 0);
const harvestSummary = w => (w.harvest || []).map(h => [
  h.variety || 'celá vinice', h.kg ? `${fmtNum(h.kg, 0)} kg` : '', h.sugar ? `${fmtNum(h.sugar, 1)} °NM` : '',
].filter(Boolean).join(' ')).join(', ');
const activityOf = w => byId(db.activities, w.activityId);
const activityName = w => activityOf(w)?.name ?? '(smazaná činnost)';
const kindOf = w => activityOf(w)?.kind ?? 'work';
// Činnosti pro výběr: skryté jen pokud jsou u upravované práce.
const selectableActivities = keepId => db.activities.filter(a => !a.hidden || a.id === keepId);
const workHours = w => (w.workers || []).reduce((s, e) => s + (+e.hours || 0), 0);

// Práce může trvat víc dní: date = od, dateTo = do (nepovinné).
const workEnd = w => w.dateTo || w.date;
const workDays = w => daysBetween(w.date, workEnd(w)) + 1;

// Období 'YYYY' nebo 'YYYY-MM' jako [první den, poslední den].
function periodRange(prefix) {
  if (prefix.length === 4) return [`${prefix}-01-01`, `${prefix}-12-31`];
  const [y, m] = prefix.split('-').map(Number);
  return [`${prefix}-01`, `${prefix}-${pad(new Date(y, m, 0).getDate())}`];
}

// Zasahuje práce do období?
const inPeriod = (w, prefix) => { const [from, to] = periodRange(prefix); return w.date <= to && workEnd(w) >= from; };

// Podíl práce v období: hodiny a množství vícedenní práce se rozpočítají rovnoměrně podle dnů.
function periodShare(w, prefix) {
  const [from, to] = periodRange(prefix);
  const a = w.date > from ? w.date : from;
  const b = workEnd(w) < to ? workEnd(w) : to;
  return a > b ? 0 : (daysBetween(a, b) + 1) / workDays(w);
}

function fmtWorkDate(w) {
  if (!w.dateTo || w.dateTo === w.date) return fmtDate(w.date);
  const [y1, m1, d1] = w.date.split('-').map(Number);
  const [y2, m2, d2] = w.dateTo.split('-').map(Number);
  if (y1 !== y2) return `${fmtDate(w.date)} – ${fmtDate(w.dateTo)}`;
  return m1 === m2 ? `${d1}.–${d2}. ${m1}. ${y1}` : `${d1}. ${m1}. – ${d2}. ${m2}. ${y1}`;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2500);
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// CSV pro český Excel: středník jako oddělovač, BOM kvůli diakritice, desetinná čárka.
function toCsv(rows) {
  const cell = v => {
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n');
}

/* ================= Domain logic ================= */

// Ochranná lhůta řádku postřiku ve dnech: podle zvoleného povoleného použití, jinak podle přípravku.
const rowPhiDays = (p, prod) => (p.useId ? p.phiDays : prod?.phiDays) || 0;

// Nejpozdější konec ochranné lhůty na vinici z provedených postřiků (volitelně jen postřiky do data `at`).
function phiInfo(vineyardId, { at, excludeId } = {}) {
  let best = null;
  for (const w of db.works) {
    if (w.vineyardId !== vineyardId || isPlanned(w) || w.id === excludeId || (at && w.date > at)) continue;
    for (const p of w.products || []) {
      const prod = byId(db.products, p.productId);
      const days = rowPhiDays(p, prod);
      if (!prod || !(days > 0)) continue;
      const until = addDays(workEnd(w), days);
      if (!best || until > best.until) best = { until, product: prod, date: workEnd(w) };
    }
  }
  return best;
}

// Platnost povolení přípravku k datu (údaje z registru ÚKZÚZ).
function productStatus(p, at = today()) {
  if (!p) return null;
  if (p.useTo && p.useTo < at) return { level: 'danger', text: `nelze použít – zásoby šlo použít do ${fmtDate(p.useTo)}` };
  if (p.validTo && p.validTo < at) return { level: 'warn', text: `povolení skončilo, zásoby lze použít do ${fmtDate(p.useTo)}` };
  return null;
}

function productAmount(w, p) {
  const area = byId(db.vineyards, w.vineyardId)?.area || 0;
  return (+p.dose || 0) * area;
}

function productsSummary(w) {
  return (w.products || []).map(p => {
    const prod = byId(db.products, p.productId);
    return `${prod?.name ?? '(smazaný)'} ${fmtNum(p.dose)} ${prod?.unit ?? ''}/ha${p.pest ? ` (${p.pest})` : ''}`;
  }).join(', ');
}

/* ================= Registr přípravků ÚKZÚZ ================= */

// Výtah přípravků pro révu, který připravuje server.py (api/por). Bez serveru je null.
let registry = null;
let registryLoad = null;

function loadRegistry(force = false) {
  if (!registryLoad || force) {
    registryLoad = fetch('api/por', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(d => (registry = d));
  }
  return registryLoad;
}

const fold = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const findPor = regNo => registry?.products.find(r => r.regNo === regNo);

function searchPor(query) {
  const q = fold(query.trim());
  if (!registry || q.length < 2) return [];
  return registry.products.filter(r => fold(r.name).includes(q) || r.regNo === query.trim()).slice(0, 12);
}

// Dávka z registru převedená na jednotky aplikace (l, kg na ha); jiné jednotky (%, ml/100 m²…) nepřevádíme.
function convertDose(value, unit) {
  const factor = { 'l/ha': ['l', 1], 'kg/ha': ['kg', 1], 'ml/ha': ['l', 0.001], 'g/ha': ['kg', 0.001] }[unit];
  return factor && value != null ? { unit: factor[0], dose: Math.round(value * factor[1] * 10000) / 10000 } : null;
}

const productKindFrom = kind => PRODUCT_KINDS.find(k => String(kind).split(',').map(x => x.trim()).includes(k)) ?? 'Jiné';
const maxPhiDays = uses => {
  const days = (uses || []).map(u => u.phiDays).filter(d => d != null);
  return days.length ? Math.max(...days) : null;
};
// Údaje přípravku převzaté z registru; při aktualizaci registru se obnoví.
const porFields = r => ({ regNo: r.regNo, validTo: r.validTo, sellTo: r.sellTo, useTo: r.useTo, substances: r.substances, uses: r.uses });

function refreshLinkedProducts() {
  let n = 0;
  for (const p of db.products) {
    const r = p.regNo && findPor(p.regNo);
    if (!r) continue;
    Object.assign(p, porFields(r), { phiDays: maxPhiDays(r.uses) ?? p.phiDays });
    n++;
  }
  return n;
}

const useLabel = u => [u.pest || 'bez uvedení škodlivého organismu', u.dose, u.phi ? `OL ${u.phi}` : ''].filter(Boolean).join(' · ');

/* ================= Rendering helpers ================= */

function workItem(w, { showVineyard = true } = {}) {
  const hours = workHours(w);
  const people = (w.workers || []).map(e => workerName(e.workerId)).join(', ');
  const meta = [
    fmtWorkDate(w),
    hours ? `${fmtNum(hours, 1)} h${people ? ` (${esc(people)})` : ''}` : (people ? esc(people) : ''),
    w.products?.length ? esc(productsSummary(w)) : '',
    w.harvest?.length ? esc(harvestSummary(w)) : '',
  ].filter(Boolean).join(' · ');
  return `
    <li class="item" data-action="edit-work" data-id="${w.id}">
      <div class="item-main">
        <div class="item-title">
          <span class="badge${isPlanned(w) ? ' planned' : ''}">${esc(activityName(w))}${isPlanned(w) ? ' · plán' : ''}</span>
          ${showVineyard ? esc(vineyardName(w.vineyardId)) : ''}
        </div>
        <div class="item-meta">${meta}</div>
        ${w.note ? `<div class="item-note">${esc(w.note)}</div>` : ''}
      </div>
      <div class="item-actions">
        ${isPlanned(w)
          ? `<button class="btn sm ok" data-action="complete-work" data-id="${w.id}" title="Označit jako provedené dnes">✓ Hotovo</button>`
          : `<button class="btn sm" data-action="copy-work" data-id="${w.id}" title="Zapsat stejnou práci znovu">Kopie</button>`}
      </div>
    </li>`;
}

const workList = (works, opts) => works.length
  ? `<ul class="list">${works.map(w => workItem(w, opts)).join('')}</ul>`
  : `<p class="empty">Žádné záznamy.</p>`;

const sortWorksDesc = list => [...list].sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0));

const options = (list, selected, { empty } = {}) =>
  (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
  list.map(o => {
    const [value, label] = typeof o === 'string' ? [o, o] : [o.id, o.name];
    return `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('');

/* ================= Year ================= */

// Pracovní rok = kalendářní rok data práce. Výběr v záhlaví přepíná všechny roční údaje.
const currentYear = () => today().slice(0, 4);
let selectedYear = currentYear();
const inYear = w => inPeriod(w, selectedYear);
const yearLabel = () => (selectedYear === currentYear() ? 'letos' : `v roce ${selectedYear}`);
const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
const monthOptions = (selected, empty) => options(MONTHS.map((m, i) => ({ id: pad(i + 1), name: m })), selected, { empty });

function availableYears() {
  const years = new Set([currentYear(), selectedYear, ...db.works.flatMap(w => [w.date.slice(0, 4), workEnd(w).slice(0, 4)])]);
  return [...years].sort().reverse();
}

function renderYearSelect() {
  const sel = $('#year');
  sel.innerHTML = availableYears().map(y => `<option${y === selectedYear ? ' selected' : ''}>${y}</option>`).join('');
  sel.classList.toggle('past', selectedYear !== currentYear());
}

function setYear(year) {
  selectedYear = year;
  workFilters.month = '';
  workersPeriod = year === currentYear() ? thisMonth().slice(5) : '';
  render();
}

/* ================= Views ================= */

function renderDashboard() {
  const t = today();
  const done = db.works.filter(w => !isPlanned(w));
  const planned = db.works.filter(isPlanned).sort((a, b) => a.date.localeCompare(b.date));
  const area = plantedVineyards().reduce((s, v) => s + (+v.area || 0), 0);
  const prep = db.vineyards.filter(isPrep);
  const isCurrent = selectedYear === currentYear();
  // Letos: hodiny za aktuální měsíc; v minulých letech za celý rok.
  const hoursShown = done.reduce((s, w) => s + workHours(w) * periodShare(w, isCurrent ? thisMonth() : selectedYear), 0);
  const worksYear = done.filter(inYear).length;
  const phi = sortVineyards(db.vineyards)
    .map(v => ({ v, info: phiInfo(v.id) }))
    .filter(x => x.info && x.info.until > t);

  if (!db.vineyards.length) {
    return `
      <div class="card empty">
        <h2>Vítej ve VitiNote 🍇</h2>
        <p>Začni tím, že přidáš své vinice. Pak můžeš zapisovat práce, postřiky a odpracované hodiny.</p>
        <button class="btn primary" data-action="new-vineyard">+ Přidat vinici</button>
        <button class="btn" data-action="new-worker">+ Přidat pracovníka</button>
        <button class="btn" data-action="new-product">+ Přidat přípravek</button>
      </div>`;
  }

  return `
    <div class="stats">
      <div class="stat"><div class="v">${plantedVineyards().length}</div><div class="l">vinic</div></div>
      <div class="stat"><div class="v">${fmtNum(area)} ha</div><div class="l">celková výměra vinic</div></div>
      ${prep.length ? `<div class="stat"><div class="v">${prep.length}</div><div class="l">pozemků v přípravě (${fmtNum(prep.reduce((s, v) => s + (+v.area || 0), 0))} ha)</div></div>` : ''}
      <div class="stat"><div class="v">${fmtNum(hoursShown, 1)} h</div><div class="l">odpracováno ${isCurrent ? 'tento měsíc' : yearLabel()}</div></div>
      <div class="stat"><div class="v">${worksYear}</div><div class="l">prací ${yearLabel()}</div></div>
    </div>

    ${phi.length ? `
    <div class="card">
      <h2>Běžící ochranné lhůty</h2>
      <ul class="list">
        ${phi.map(({ v, info }) => `
          <li class="item" data-action="go" data-href="#/vinice/${v.id}">
            <div class="item-main">
              <div class="item-title">${esc(vName(v))} <span class="badge warn">ještě ${daysBetween(t, info.until)} dní</span></div>
              <div class="item-meta">sklizeň možná od ${fmtDate(info.until)} · ${esc(info.product.name)} (${fmtDate(info.date)})</div>
            </div>
          </li>`).join('')}
      </ul>
    </div>` : ''}

    <div class="card">
      <div class="page-head"><h2>Naplánováno</h2><button class="btn sm" data-action="new-work" data-planned="1">+ Naplánovat</button></div>
      ${workList(planned)}
    </div>

    <div class="card">
      <div class="page-head"><h2>${isCurrent ? 'Poslední práce' : `Poslední práce ${selectedYear}`}</h2><a href="#/prace">Všechny →</a></div>
      ${workList(sortWorksDesc(done.filter(inYear)).slice(0, 10))}
    </div>`;
}

const workFilters = { vineyardId: '', activityId: '', month: '', status: '' };

function renderWorks() {
  const f = workFilters;
  const period = f.month ? `${selectedYear}-${f.month}` : selectedYear;
  const works = sortWorksDesc(db.works.filter(w =>
    (!f.vineyardId || w.vineyardId === f.vineyardId) &&
    (!f.activityId || w.activityId === f.activityId) &&
    inPeriod(w, period) &&
    (!f.status || (f.status === 'planned') === isPlanned(w))
  ));
  const hours = works.filter(w => !isPlanned(w)).reduce((s, w) => s + workHours(w) * periodShare(w, period), 0);
  return `
    <div class="page-head">
      <h1>Práce ${selectedYear}</h1>
      <button class="btn primary" data-action="new-work">+ Zapsat práci</button>
    </div>
    <div class="filters">
      <select data-filter="vineyardId">${options(sortVineyards(db.vineyards).map(v => ({ id: v.id, name: vName(v) })), f.vineyardId, { empty: 'Všechny vinice' })}</select>
      <select data-filter="activityId">${options(db.activities, f.activityId, { empty: 'Všechny činnosti' })}</select>
      <select data-filter="month" aria-label="Měsíc">${monthOptions(f.month, 'Celý rok')}</select>
      <select data-filter="status">${options([{ id: 'done', name: 'Provedené' }, { id: 'planned', name: 'Plánované' }], f.status, { empty: 'Provedené i plánované' })}</select>
    </div>
    <p class="muted small">${works.length} záznamů · ${fmtNum(hours, 1)} odpracovaných hodin</p>
    <div class="card">${workList(works)}</div>`;
}

function renderVineyards() {
  const t = today();
  const row = v => {
    const works = db.works.filter(w => w.vineyardId === v.id && !isPlanned(w));
    const last = sortWorksDesc(works)[0];
    const hours = works.reduce((s, w) => s + workHours(w) * periodShare(w, selectedYear), 0);
    const phi = phiInfo(v.id);
    return `
      <li class="item" data-action="go" data-href="#/vinice/${v.id}">
        <div class="item-main">
          <div class="item-title">${esc(vName(v))} ${phi && phi.until > t ? `<span class="badge warn">OL do ${fmtDate(phi.until)}</span>` : ''}</div>
          ${v.alias ? `<div class="item-sub">${esc(v.name)}</div>` : ''}
          <div class="item-meta">${[
            v.area ? `${fmtNum(v.area, 4)} ha` : '',
            isPrep(v) && v.plannedPlanting ? `výsadba ${esc(fmtMonth(v.plannedPlanting))}` : '',
            esc(varietyNames(v)),
            v.regNo ? `reg. č. ${esc(v.regNo)}` : '',
            v.dpb ? `DPB ${esc(v.dpb)}` : '',
            isPrep(v) && v.parcels ? `parc. ${esc(v.parcels)}` : '',
          ].filter(Boolean).join(' · ')}</div>
          <div class="item-meta">${last ? `naposledy: ${esc(activityName(last))} ${fmtWorkDate(last)}` : 'zatím bez prací'} · ${yearLabel()} ${fmtNum(hours, 1)} h</div>
        </div>
      </li>`;
  };
  const planted = sortVineyards(plantedVineyards()).map(row).join('');
  const prep = sortVineyards(db.vineyards.filter(isPrep)).map(row).join('');
  return `
    <div class="page-head">
      <h1>Vinice</h1>
      <button class="btn primary" data-action="new-vineyard">+ Přidat vinici</button>
    </div>
    <div class="card">${planted ? `<ul class="list">${planted}</ul>` : '<p class="empty">Zatím žádné vinice.</p>'}</div>
    <div class="card">
      <div class="page-head"><h2>V přípravě na výsadbu</h2><button class="btn sm" data-action="new-prep">+ Pozemek v přípravě</button></div>
      ${prep ? `<ul class="list">${prep}</ul>` : '<p class="small muted">Pozemky, které připravuješ k výsadbě. Zapisuješ k nim práce a po výsadbě je jedním tlačítkem změníš na vinici.</p>'}
    </div>`;
}

function renderVineyardDetail(id) {
  const v = byId(db.vineyards, id);
  if (!v) return `<p class="empty">Vinice nenalezena. <a href="#/vinice">Zpět</a></p>`;
  const t = today();
  const allWorks = db.works.filter(w => w.vineyardId === id);
  const works = sortWorksDesc(allWorks.filter(inYear));
  const doneYear = works.filter(w => !isPlanned(w));
  const hours = doneYear.reduce((s, w) => s + workHours(w) * periodShare(w, selectedYear), 0);
  const sprays = doneYear.filter(w => w.products?.length).length;
  const harvest = doneYear.reduce((s, w) => s + harvestKg(w), 0);
  const harvestTable = renderHarvestByVariety(v, doneYear) + renderHarvestByYear(v, allWorks);
  const phi = phiInfo(id);

  return `
    <p><a href="#/vinice">← Vinice</a></p>
    <div class="page-head">
      <div>
        <h1>${esc(vName(v))} ${isPrep(v) ? '<span class="badge planned">v přípravě na výsadbu</span>' : ''}</h1>
        ${v.alias ? `<p class="subtitle">${esc(v.name)}</p>` : ''}
      </div>
      <div class="actions-row">
        <button class="btn danger" data-action="delete-vineyard" data-id="${v.id}">Smazat</button>
        <button class="btn" data-action="edit-vineyard" data-id="${v.id}">Upravit</button>
        ${isPrep(v) ? `<button class="btn ok" data-action="plant-vineyard" data-id="${v.id}">Vysadit</button>` : ''}
        <button class="btn primary" data-action="new-work" data-vineyard="${v.id}">+ Práce</button>
      </div>
    </div>
    <div class="card">
      <dl class="kv">
        ${v.area ? `<dt>Výměra</dt><dd>${fmtNum(v.area, 4)} ha</dd>` : ''}
        ${isPrep(v) ? `<dt>Plánovaná výsadba</dt><dd>${v.plannedPlanting ? esc(fmtMonth(v.plannedPlanting)) : '–'}</dd>` : ''}
        ${v.varieties?.length ? `<dt>${isPrep(v) ? 'Plánované odrůdy' : v.varieties.length > 1 ? 'Odrůdy' : 'Odrůda'}</dt><dd>${v.varieties
          .map(x => esc(x.name) + ` <span class="muted small">${[
            x.year, x.area ? `${fmtNum(x.area, 4)} ha` : '', x.rootstock ? `podnož ${x.rootstock}` : '',
            x.vines ? `${fmtNum(x.vines, 0)} ${isPrep(v) ? 'sazenic' : 'keřů'}` : '',
          ].filter(Boolean).map(esc).join(' · ')}</span>`).join('<br>')}</dd>` : ''}
        ${v.plantedDate ? `<dt>Výsadba</dt><dd>${fmtDate(v.plantedDate)}</dd>` : v.plantedYear ? `<dt>Výsadba</dt><dd>${esc(v.plantedYear)}</dd>` : ''}
        ${v.parcels ? `<dt>Parcely</dt><dd>${esc(v.parcels)}</dd>` : ''}
        ${v.regNo ? `<dt>Reg. číslo</dt><dd>${esc(v.regNo)}</dd>` : ''}
        ${v.ku ? `<dt>Katastr</dt><dd>${esc(v.ku)}</dd>` : ''}
        ${v.dpb ? `<dt>Kód DPB</dt><dd>${esc(v.dpb)}</dd>` : ''}
        <dt>Ochranná lhůta</dt><dd>${phi && phi.until > t
          ? `<span class="badge warn">do ${fmtDate(phi.until)}</span> <span class="small muted">${esc(phi.product.name)}</span>`
          : '<span class="badge ok">žádná neběží</span>'}</dd>
        ${v.note ? `<dt>Poznámka</dt><dd style="white-space:pre-wrap">${esc(v.note)}</dd>` : ''}
      </dl>
    </div>
    <div class="stats">
      <div class="stat"><div class="v">${fmtNum(hours, 1)} h</div><div class="l">odpracováno ${yearLabel()}</div></div>
      <div class="stat"><div class="v">${sprays}</div><div class="l">ošetření ${yearLabel()}</div></div>
      ${harvest ? `<div class="stat"><div class="v">${fmtNum(harvest, 0)} kg</div><div class="l">sklizeno ${yearLabel()}${v.area ? ` (${fmtNum(harvest / v.area / 1000)} t/ha)` : ''}</div></div>` : ''}
    </div>
    ${harvestTable}
    <div class="card">
      <h2>Práce ${selectedYear}</h2>
      ${workList(works, { showVineyard: false })}
    </div>`;
}

// Sklizeň vinice ve vybraném roce po odrůdách: kg, t/ha (z plochy odrůdy) a průměrná cukernatost vážená množstvím.
function renderHarvestByVariety(v, works) {
  const rows = new Map();
  for (const w of works) {
    for (const h of w.harvest || []) {
      const r = rows.get(h.variety) ?? { kg: 0, sugarKg: 0, sugarBase: 0 };
      r.kg += +h.kg || 0;
      if (h.sugar && h.kg) { r.sugarKg += h.sugar * h.kg; r.sugarBase += +h.kg; }
      rows.set(h.variety, r);
    }
  }
  if (!rows.size) return '';
  const areaOf = name => (v.varieties || []).filter(x => x.name === name).reduce((s, x) => s + (+x.area || 0), 0);
  const body = [...rows].sort(([a], [b]) => a.localeCompare(b, 'cs')).map(([name, r]) => {
    const area = name ? areaOf(name) : (+v.area || 0);
    return `<tr>
      <td>${esc(name || 'celá vinice')}</td>
      <td class="num">${fmtNum(r.kg, 0)}</td>
      <td class="num">${area && r.kg ? fmtNum(r.kg / area / 1000) : '–'}</td>
      <td class="num">${r.sugarBase ? fmtNum(r.sugarKg / r.sugarBase, 1) : '–'}</td>
    </tr>`;
  }).join('');
  return `
    <div class="card">
      <h2>Sklizeň ${selectedYear}</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Odrůda</th><th class="num">kg</th><th class="num">t/ha</th><th class="num">°NM</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>
    </div>`;
}

// Srovnání ročníků: celková sklizeň vinice po letech (zobrazí se, až jsou data aspoň ze dvou let).
function renderHarvestByYear(v, works) {
  const years = new Map();
  for (const w of works) {
    if (isPlanned(w) || !w.harvest?.length) continue;
    const r = years.get(w.date.slice(0, 4)) ?? { kg: 0, sugarKg: 0, sugarBase: 0 };
    for (const h of w.harvest) {
      r.kg += +h.kg || 0;
      if (h.sugar && h.kg) { r.sugarKg += h.sugar * h.kg; r.sugarBase += +h.kg; }
    }
    years.set(w.date.slice(0, 4), r);
  }
  if (years.size < 2) return '';
  const body = [...years].sort(([a], [b]) => b.localeCompare(a)).map(([y, r]) => `
    <tr${y === selectedYear ? ' class="current"' : ''}>
      <td><a href="#" data-action="set-year" data-year="${y}">${y}</a></td>
      <td class="num">${fmtNum(r.kg, 0)}</td>
      <td class="num">${v.area && r.kg ? fmtNum(r.kg / v.area / 1000) : '–'}</td>
      <td class="num">${r.sugarBase ? fmtNum(r.sugarKg / r.sugarBase, 1) : '–'}</td>
    </tr>`).join('');
  return `
    <div class="card">
      <h2>Sklizeň po letech</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Rok</th><th class="num">kg</th><th class="num">t/ha</th><th class="num">°NM</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>
    </div>`;
}

function renderProducts() {
  const used = {};
  for (const w of db.works) {
    if (isPlanned(w) || !inYear(w)) continue;
    for (const p of w.products || []) used[p.productId] = (used[p.productId] || 0) + productAmount(w, p) * periodShare(w, selectedYear);
  }
  const rows = sortByName(db.products).map(p => {
    const status = productStatus(p);
    return `
    <li class="item" data-action="edit-product" data-id="${p.id}">
      <div class="item-main">
        <div class="item-title">${esc(p.name)} <span class="badge">${esc(p.kind)}</span>
          ${status ? `<span class="badge ${status.level}">${esc(status.text)}</span>` : ''}</div>
        <div class="item-meta">${[
          p.regNo ? `reg. č. ${esc(p.regNo)}` : '',
          p.uses?.length ? `${p.uses.length} povolených použití` : '',
          p.phiDays ? `OL až ${p.phiDays} dní` : 'bez OL',
          p.defaultDose ? `obvyklá dávka ${fmtNum(p.defaultDose)} ${esc(p.unit)}/ha` : '',
          `${yearLabel()} spotřebováno ${fmtNum(used[p.id] || 0)} ${esc(p.unit)}`,
        ].filter(Boolean).join(' · ')}</div>
        ${p.note ? `<div class="item-note">${esc(p.note)}</div>` : ''}
      </div>
    </li>`;
  }).join('');
  return `
    <div class="page-head">
      <h1>Přípravky a hnojiva</h1>
      <button class="btn primary" data-action="new-product">+ Přidat</button>
    </div>
    <div class="card">${rows ? `<ul class="list">${rows}</ul>` : '<p class="empty">Zatím žádné přípravky.</p>'}</div>
    <div class="card">
      <h2>Registr přípravků ÚKZÚZ</h2>
      <p class="small muted">${registry
        ? `Staženo ${fmtDate(registry.updated)}: ${registry.products.length} povolených přípravků pro révu.`
        : 'Registr zatím není stažený (potřebuje běžící server).'}
        Při přidání přípravku ho vyhledáš v registru a doplní se registrační číslo, povolená použití, dávky a ochranné lhůty.</p>
      <button class="btn" data-action="update-registry"${sync.state === 'local' ? ' disabled' : ''}>Aktualizovat z registru</button>
    </div>`;
}

// Měsíc ('01'–'12') ve vybraném roce, nebo '' = celý rok.
let workersPeriod = thisMonth().slice(5);

function renderWorkers() {
  const prefix = workersPeriod ? `${selectedYear}-${workersPeriod}` : selectedYear;
  const stats = {};
  for (const w of db.works) {
    const share = periodShare(w, prefix);
    if (isPlanned(w) || !share) continue;
    for (const e of w.workers || []) {
      const s = stats[e.workerId] ??= { hours: 0, byType: {} };
      const h = (+e.hours || 0) * share;
      s.hours += h;
      s.byType[activityName(w)] = (s.byType[activityName(w)] || 0) + h;
    }
  }
  let totalH = 0, totalCost = 0;
  const rows = sortByName(db.workers).map(p => {
    const s = stats[p.id] || { hours: 0, byType: {} };
    const cost = s.hours * (+p.rate || 0);
    totalH += s.hours;
    totalCost += cost;
    const types = Object.entries(s.byType).map(([k, h]) => `${k} ${fmtNum(h, 1)} h`).join(', ');
    return `
      <tr data-action="edit-worker" data-id="${p.id}" style="cursor:pointer">
        <td><strong>${esc(p.name)}</strong>${types ? `<div class="small muted">${esc(types)}</div>` : ''}</td>
        <td class="num">${fmtNum(s.hours, 1)}</td>
        <td class="num">${p.rate ? fmtNum(p.rate, 0) : '–'}</td>
        <td class="num">${p.rate ? fmtNum(cost, 0) + ' Kč' : '–'}</td>
      </tr>`;
  }).join('');
  return `
    <div class="page-head">
      <h1>Pracovníci</h1>
      <button class="btn primary" data-action="new-worker">+ Přidat</button>
    </div>
    <div class="filters"><select data-filter="workersPeriod" aria-label="Období">${monthOptions(workersPeriod, `Celý rok ${selectedYear}`)}</select></div>
    <div class="card">
      ${rows ? `
      <h2>${workersPeriod ? esc(fmtMonth(prefix)) : `Rok ${selectedYear}`}</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Jméno</th><th class="num">Hodiny</th><th class="num">Kč/h</th><th class="num">Náklad</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>Celkem</td><td class="num">${fmtNum(totalH, 1)}</td><td></td><td class="num">${fmtNum(totalCost, 0)} Kč</td></tr></tfoot>
      </table></div>
      <p class="small muted">Klepnutím na řádek pracovníka upravíš.</p>` : '<p class="empty">Zatím žádní pracovníci.</p>'}
    </div>`;
}

function renderSettings() {
  const yearOpts = availableYears().map(y => `<option${y === selectedYear ? ' selected' : ''}>${y}</option>`).join('');
  return `
    <h1>Data</h1>
    <div class="card">
      <h2>Export</h2>
      <p class="small muted">CSV soubory jsou připravené pro Excel (středník, česká diakritika).</p>
      <div class="field" style="max-width:200px"><label for="export-year">Rok</label><select id="export-year">${yearOpts}</select></div>
      <div class="actions-row">
        <button class="btn" data-action="export-works">Deník prací (CSV)</button>
        <button class="btn" data-action="export-por">Evidence POR / hnojiv (CSV)</button>
      </div>
    </div>
    <div class="card">
      <div class="page-head"><h2>Činnosti</h2><button class="btn sm" data-action="new-activity">+ Přidat činnost</button></div>
      <p class="small muted">Číselník pro zápis prací. „Ošetření“ zobrazí ve formuláři přípravky, „Sklizeň“ odrůdy a množství.
        Skryté činnosti se nenabízejí u nových prací, ale v zapsaných zůstanou.</p>
      <ul class="list">${db.activities.map((a, i) => {
        const used = db.works.filter(w => w.activityId === a.id).length;
        return `
        <li class="item" data-action="edit-activity" data-id="${a.id}">
          <div class="item-main">
            <div class="item-title">${esc(a.name)} ${a.kind !== 'work' ? `<span class="badge">${esc(ACTIVITY_KINDS[a.kind])}</span>` : ''}
              ${a.hidden ? '<span class="badge planned">skrytá</span>' : ''}</div>
            <div class="item-meta">${used ? `${used} záznamů` : 'zatím nepoužitá'}</div>
          </div>
          <div class="item-actions">
            <button class="btn sm" data-action="move-activity" data-id="${a.id}" data-dir="-1" aria-label="Posunout nahoru"${i === 0 ? ' disabled' : ''}>↑</button>
            <button class="btn sm" data-action="move-activity" data-id="${a.id}" data-dir="1" aria-label="Posunout dolů"${i === db.activities.length - 1 ? ' disabled' : ''}>↓</button>
          </div>
        </li>`;
      }).join('')}</ul>
    </div>
    <div class="card">
      <h2>Uložení</h2>
      ${sync.state === 'disk'
        ? `<p><span class="badge ok">na disku</span> <code class="small">${esc(sync.file)}</code></p>
           <p class="small muted">Při každém uložení se předchozí verze zachová jako <code>.bak</code>.</p>`
        : `<p><span class="badge warn">jen v prohlížeči</span></p>
           <p class="small muted">Server není spuštěný. Změny se zatím drží v prohlížeči a na disk se zapíšou, až spustíš <code>python3 server.py</code> a stránku otevřeš znovu.</p>`}
    </div>
    <div class="card">
      <h2>Import z Registru vinic</h2>
      <p class="small muted">Na Portálu farmáře stáhni výpis z Registru vinic ve formátu XML. Načtou se vinice s výměrou,
        DPB a skladbou odrůd; před uložením uvidíš náhled. Údaje o subjektu (IČO, adresa) se neukládají.</p>
      <label class="btn primary" style="margin:0;font-size:1rem;display:inline-block">Vybrat XML soubor
        <input type="file" accept=".xml,application/xml,text/xml" data-import-rv hidden>
      </label>
    </div>
    <div class="card">
      <h2>Záloha</h2>
      <p class="small muted">Stažený JSON můžeš kdykoli nahrát zpět, i na jiném zařízení.</p>
      <div class="actions-row">
        <button class="btn primary" data-action="backup">Stáhnout zálohu (JSON)</button>
        <label class="btn" style="margin:0;color:var(--text);font-size:1rem">Obnovit ze zálohy
          <input type="file" accept="application/json,.json" data-import hidden>
        </label>
      </div>
    </div>
    <div class="card">
      <h2>Smazat vše</h2>
      <p class="small muted">Nevratně smaže všechny vinice, práce, přípravky a pracovníky (v prohlížeči i v souboru na disku).</p>
      <button class="btn danger" data-action="wipe">Smazat všechna data</button>
    </div>
    <p class="small muted">VitiNote · ${db.vineyards.length} vinic, ${db.works.length} záznamů prací</p>`;
}

/* ================= Router ================= */

const routes = {
  '': renderDashboard,
  prace: renderWorks,
  vinice: id => (id ? renderVineyardDetail(id) : renderVineyards()),
  pripravky: renderProducts,
  pracovnici: renderWorkers,
  nastaveni: renderSettings,
};

function render() {
  const [, page = '', param] = location.hash.split('/');
  const view = routes[page] || renderDashboard;
  renderYearSelect();
  $('#main').innerHTML = view(param && decodeURIComponent(param));
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.page === page));
}

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

/* ================= Dialog / forms ================= */

const dlg = $('#dlg');
const form = $('#dlg-form');
let currentSubmit = null;
let currentDelete = null;

function openForm({ title, body, onSubmit, onDelete, onInit }) {
  $('#dlg-title').textContent = title;
  $('#dlg-body').innerHTML = body;
  currentSubmit = onSubmit;
  currentDelete = onDelete || null;
  $('#dlg-delete').hidden = !onDelete;
  dlg.showModal();
  onInit?.();
  const first = $('input:not([type=hidden]):not([type=checkbox]), select, textarea', form);
  if (first && window.matchMedia('(pointer: fine)').matches) first.focus();
}

function closeForm() {
  dlg.close();
  currentSubmit = currentDelete = null;
}

form.addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(form);
  const get = k => String(fd.get(k) ?? '').trim();
  if (currentSubmit?.(get, fd) === false) return;
  save();
  closeForm();
  render();
});

$('#dlg-delete').addEventListener('click', () => {
  if (currentDelete?.() === false) return;
  save();
  closeForm();
  render();
});

/* ----- Vineyard ----- */

// Pole řádku odrůdy podle stavu: [klíč, popisek, číselné?]. Ostatní údaje (kód z registru, vedení…) se ve formuláři jen zachovají.
const VARIETY_FIELDS = {
  planted: [['area', 'ha', true], ['year', 'rok', false]],
  preparation: [['area', 'ha', true], ['rootstock', 'podnož', false], ['vines', 'sazenic', true]],
};

const varietyRow = (x = {}, stage = 'planted') => {
  const fields = VARIETY_FIELDS[stage];
  const shown = new Set(['name', ...fields.map(([key]) => key)]);
  const extra = Object.fromEntries(Object.entries(x).filter(([k]) => !shown.has(k)));
  return `
  <div class="row row-variety row-variety-${stage}" data-extra="${esc(JSON.stringify(extra))}">
    <input name="v-name" value="${esc(x.name)}" placeholder="např. Ryzlink rýnský" aria-label="Odrůda">
    ${fields.map(([key, label, numeric]) => `<input name="v-${key}" data-numeric="${numeric}"${numeric ? ' inputmode="decimal"' : ''}
      value="${numeric ? numVal(x[key]) : esc(x[key])}" placeholder="${label}" aria-label="${label}">`).join('')}
    <button type="button" class="icon-btn" data-action="remove-row" aria-label="Odebrat">✕</button>
  </div>`;
};

function readVarietyRows() {
  return $$('.row-variety', form).map(r => {
    const x = JSON.parse(r.dataset.extra || '{}');
    x.name = $('[name=v-name]', r).value.trim();
    for (const input of $$('input[data-numeric]', r)) {
      x[input.name.slice(2)] = input.dataset.numeric === 'true' ? parseNum(input.value) : input.value.trim();
    }
    return x;
  }).filter(x => x.name);
}

function vineyardForm(v, { stage = 'planted' } = {}) {
  const isNew = !v;
  v ||= stage === 'preparation' ? { stage } : {};
  const prep = isPrep(v);
  openForm({
    title: prep ? (isNew ? 'Nový pozemek v přípravě' : 'Upravit pozemek v přípravě') : (isNew ? 'Nová vinice' : 'Upravit vinici'),
    body: `
      <div class="field"><label>Vlastní název</label><input name="alias" value="${esc(v.alias)}" placeholder="${esc(v.name || 'nepovinné – jak vinici říkáš')}"></div>
      <div class="field"><label>Výchozí název *</label><input name="name" required value="${esc(v.name)}" placeholder="např. Pod lesem"></div>
      <div class="grid2">
        <div class="field"><label>Výměra (ha)</label><input name="area" inputmode="decimal" value="${numVal(v.area)}"></div>
        ${prep
          ? `<div class="field"><label>Plánovaná výsadba</label><input type="month" name="plannedPlanting" value="${esc(v.plannedPlanting)}"></div>`
          : `<div class="field"><label>Rok výsadby</label><input name="plantedYear" inputmode="numeric" value="${esc(v.plantedYear)}"></div>`}
      </div>
      <fieldset>
        <legend>${prep ? 'Plánované odrůdy <span class="small muted">(název, ha, podnož, počet sazenic)</span>' : 'Odrůdy <span class="small muted">(název, ha, rok výsadby)</span>'}</legend>
        <div class="rows" id="variety-rows">${(v.varieties?.length ? v.varieties : [{}]).map(x => varietyRow(x, prep ? 'preparation' : 'planted')).join('')}</div>
        <button type="button" class="btn sm" data-action="add-variety-row">+ odrůda</button>
      </fieldset>
      <div class="grid2">
        <div class="field"><label>Katastrální území</label><input name="ku" value="${esc(v.ku)}"></div>
        <div class="field"><label>Parcely</label><input name="parcels" value="${esc(v.parcels)}" placeholder="např. 1234/5, 1234/6"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Kód DPB (LPIS)</label><input name="dpb" value="${esc(v.dpb)}" placeholder="pro evidenci POR"></div>
        ${prep ? '' : `<div class="field"><label>Reg. číslo vinice</label><input name="regNo" value="${esc(v.regNo)}" placeholder="z Registru vinic"></div>`}
      </div>
      <div class="field"><label>Poznámka</label><textarea name="note">${esc(v.note)}</textarea></div>`,
    onInit: () => { form.dataset.stage = prep ? 'preparation' : 'planted'; },
    onSubmit: get => {
      if (!get('name')) { toast(prep ? 'Vyplň název pozemku.' : 'Vyplň název vinice.'); return false; }
      Object.assign(v, {
        name: get('name'), alias: get('alias') === get('name') ? '' : get('alias'), area: parseNum(get('area')), varieties: readVarietyRows(),
        ku: get('ku'), parcels: get('parcels'), dpb: get('dpb'), note: get('note'),
      }, prep
        ? { plannedPlanting: get('plannedPlanting') }
        : { plantedYear: get('plantedYear'), regNo: get('regNo') });
      if (isNew) { v.id = uid(); db.vineyards.push(v); toast(prep ? 'Pozemek přidán.' : 'Vinice přidána.'); }
    },
    onDelete: isNew ? null : () => deleteVineyard(v),
  });
}

// Vysazení: pozemek v přípravě se změní na vinici, práce i odrůdy zůstanou.
function plantForm(v) {
  openForm({
    title: `Vysadit: ${vName(v)}`,
    body: `
      <p class="small muted">Pozemek se změní na vinici. Zapsané práce zůstanou a plánované odrůdy se stanou odrůdami vinice.</p>
      <div class="field"><label>Datum výsadby *</label><input type="date" name="plantedDate" required value="${today()}"></div>
      ${v.varieties?.length ? `<p class="small">Odrůdy: ${esc(varietyNames(v))}</p>` : ''}`,
    onSubmit: get => {
      const date = get('plantedDate');
      if (!date) { toast('Vyplň datum výsadby.'); return false; }
      const year = date.slice(0, 4);
      v.varieties = (v.varieties || []).map(x => ({ ...x, year: x.year || year }));
      Object.assign(v, { plantedDate: date, plantedYear: year });
      delete v.stage;
      delete v.plannedPlanting;
      toast(`${vName(v)} je teď vinice.`);
    },
  });
}

// Smaže vinici včetně jejích prací; vrací false, pokud uživatel nepotvrdil (konvence onDelete).
function deleteVineyard(v) {
  const n = db.works.filter(w => w.vineyardId === v.id).length;
  if (!confirm(n ? `Smazat ${placeLabel(v)} „${vName(v)}“ včetně ${n} záznamů prací?` : `Smazat ${placeLabel(v)} „${vName(v)}“?`)) return false;
  db.vineyards = db.vineyards.filter(x => x.id !== v.id);
  db.works = db.works.filter(w => w.vineyardId !== v.id);
  if (location.hash.includes(v.id)) location.hash = '#/vinice';
  toast(isPrep(v) ? 'Pozemek smazán.' : 'Vinice smazána.');
}

/* ----- Worker ----- */

function workerForm(p) {
  const isNew = !p;
  p ||= {};
  openForm({
    title: isNew ? 'Nový pracovník' : 'Upravit pracovníka',
    body: `
      <div class="field"><label>Jméno *</label><input name="name" required value="${esc(p.name)}"></div>
      <div class="field"><label>Hodinová sazba (Kč/h)</label><input name="rate" inputmode="decimal" value="${numVal(p.rate)}"></div>
      <div class="field"><label>Poznámka</label><textarea name="note">${esc(p.note)}</textarea></div>`,
    onSubmit: get => {
      if (!get('name')) { toast('Vyplň jméno.'); return false; }
      Object.assign(p, { name: get('name'), rate: parseNum(get('rate')), note: get('note') });
      if (isNew) { p.id = uid(); db.workers.push(p); toast('Pracovník přidán.'); }
    },
    onDelete: isNew ? null : () => {
      if (!confirm(`Smazat pracovníka „${p.name}“? Jeho hodiny v zapsaných pracích zůstanou.`)) return false;
      db.workers = db.workers.filter(x => x.id !== p.id);
    },
  });
}

/* ----- Activity ----- */

function activityForm(a) {
  const isNew = !a;
  a ||= { kind: 'work', hidden: false };
  const used = isNew ? 0 : db.works.filter(w => w.activityId === a.id).length;
  openForm({
    title: isNew ? 'Nová činnost' : 'Upravit činnost',
    body: `
      <div class="field"><label>Název *</label><input name="name" required value="${esc(a.name)}" placeholder="např. Listové hnojení"></div>
      <div class="field"><label>Chování ve formuláři práce</label><select name="kind">${options(Object.entries(ACTIVITY_KINDS).map(([id, name]) => ({ id, name })), a.kind)}</select></div>
      <div class="checks"><label><input type="checkbox" name="hidden"${a.hidden ? ' checked' : ''}> Skrýt (nenabízet u nových prací)</label></div>
      ${used ? `<p class="small muted">Použito u ${used} záznamů – přejmenování se projeví i u nich.</p>` : ''}`,
    onSubmit: (get, fd) => {
      const name = get('name');
      if (!name) { toast('Vyplň název.'); return false; }
      if (db.activities.some(x => x !== a && x.name.toLowerCase() === name.toLowerCase())) { toast('Činnost s tímto názvem už existuje.'); return false; }
      Object.assign(a, { name, kind: get('kind'), hidden: fd.has('hidden') });
      if (isNew) {
        a.id = db.activities.some(x => x.id === activityIdFor(name)) ? uid() : activityIdFor(name);
        db.activities.push(a);
        toast('Činnost přidána.');
      }
    },
    onDelete: isNew ? null : () => {
      if (used) { toast(`Činnost je použitá u ${used} záznamů – můžeš ji jen skrýt.`); return false; }
      if (!confirm(`Smazat činnost „${a.name}“?`)) return false;
      db.activities = db.activities.filter(x => x.id !== a.id);
    },
  });
}

/* ----- Product ----- */

// Přehled údajů z registru ve formuláři přípravku.
function porInfoHtml(r) {
  if (!r?.uses?.length) return '';
  const status = productStatus(r);
  return `
    <div class="por-info">
      <div class="small"><strong>Z registru ÚKZÚZ</strong> · reg. č. ${esc(r.regNo)}
        ${r.substances?.length ? ` · ${esc(r.substances.map(x => `${x.name} ${fmtNum(x.amount)} ${x.unit}`).join(', '))}` : ''}
        ${status ? `<span class="badge ${status.level}">${esc(status.text)}</span>` : r.validTo ? ` · povoleno do ${fmtDate(r.validTo)}` : ''}</div>
      <ul class="small">${r.uses.map(u => `<li>${esc(useLabel(u))}</li>`).join('')}</ul>
    </div>`;
}

function fillProductFromPor(r) {
  const set = (name, value) => { const el = $(`[name=${name}]`, form); if (el && value != null) el.value = value; };
  set('name', r.name);
  set('kind', productKindFrom(r.kind));
  set('regNo', r.regNo);
  set('phiDays', maxPhiDays(r.uses) ?? '');
  const use = r.uses.find(u => u.crops.includes('Réva moštová') && convertDose(u.doseMax ?? u.doseMin, u.doseUnit)) ?? r.uses.find(u => convertDose(u.doseMax ?? u.doseMin, u.doseUnit));
  const dose = use && convertDose(use.doseMax ?? use.doseMin, use.doseUnit);
  if (dose) { set('unit', dose.unit); set('defaultDose', String(dose.dose).replace('.', ',')); }
  $('#por-results').innerHTML = '';
  $('#por-search').value = '';
  $('#por-info').innerHTML = porInfoHtml(r);
}

function productForm(p) {
  const isNew = !p;
  p ||= { kind: 'Fungicid', unit: 'l' };
  openForm({
    title: isNew ? 'Nový přípravek / hnojivo' : 'Upravit přípravek',
    body: `
      <div class="field"><label for="por-search">Vyhledat v registru ÚKZÚZ</label>
        <input id="por-search" autocomplete="off" placeholder="název nebo registrační číslo">
        <div id="por-results" class="por-results"></div>
      </div>
      <div class="field"><label>Název *</label><input name="name" required value="${esc(p.name)}"></div>
      <div class="grid2">
        <div class="field"><label>Druh</label><select name="kind">${options(PRODUCT_KINDS, p.kind)}</select></div>
        <div class="field"><label>Jednotka</label><select name="unit">${options([{ id: 'l', name: 'litry (l)' }, { id: 'kg', name: 'kilogramy (kg)' }], p.unit)}</select></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Ochranná lhůta (dny)</label><input name="phiDays" inputmode="numeric" value="${numVal(p.phiDays)}" title="U postřiku se bere lhůta zvoleného povoleného použití; tato hodnota platí, když použití nevybereš."></div>
        <div class="field"><label>Obvyklá dávka / ha</label><input name="defaultDose" inputmode="decimal" value="${numVal(p.defaultDose)}"></div>
      </div>
      <div class="field"><label>Registrační číslo</label><input name="regNo" value="${esc(p.regNo)}" placeholder="vyplní se z registru"></div>
      <div id="por-info">${porInfoHtml(p)}</div>
      <div class="field"><label>Poznámka</label><textarea name="note">${esc(p.note)}</textarea></div>`,
    onInit: () => {
      const search = $('#por-search');
      const results = $('#por-results');
      loadRegistry().then(() => {
        if (!registry) search.placeholder = 'registr není stažený – aktualizuj ho v sekci Přípravky';
      });
      search.addEventListener('input', () => {
        const found = searchPor(search.value);
        results.innerHTML = found.map(r => `
          <button type="button" class="por-hit" data-action="pick-por" data-reg="${esc(r.regNo)}">
            <strong>${esc(r.name)}</strong> <span class="small muted">${esc(r.regNo)} · ${esc(r.kind)} · ${r.uses.length} použití</span>
          </button>`).join('') || (search.value.trim().length >= 2 && registry ? '<p class="small muted">Nic nenalezeno.</p>' : '');
      });
    },
    onSubmit: get => {
      if (!get('name')) { toast('Vyplň název.'); return false; }
      const regNo = get('regNo');
      const r = regNo && findPor(regNo);
      if (r) Object.assign(p, porFields(r));
      else if (regNo !== p.regNo) for (const k of ['validTo', 'sellTo', 'useTo', 'substances', 'uses']) delete p[k];
      Object.assign(p, {
        name: get('name'), kind: get('kind'), unit: get('unit'), regNo,
        phiDays: parseNum(get('phiDays')), defaultDose: parseNum(get('defaultDose')), note: get('note'),
      });
      if (isNew) { p.id = uid(); db.products.push(p); toast('Přípravek přidán.'); }
    },
    onDelete: isNew ? null : () => {
      if (!confirm(`Smazat přípravek „${p.name}“? V zapsaných pracích zůstane jako „smazaný“.`)) return false;
      db.products = db.products.filter(x => x.id !== p.id);
    },
  });
}

/* ----- Work ----- */

const workerRow = (e = {}) => `
  <div class="row row-worker">
    <select name="w-id" aria-label="Pracovník">${options(sortByName(db.workers), e.workerId, { empty: '— pracovník —' })}</select>
    <input name="w-hours" inputmode="decimal" placeholder="hodin" value="${numVal(e.hours)}" aria-label="Hodiny">
    <button type="button" class="icon-btn" data-action="remove-row" aria-label="Odebrat">✕</button>
  </div>`;

const useOptions = (prod, selected) =>
  options((prod?.uses || []).map(u => ({ id: u.id, name: useLabel(u) })), selected, { empty: '— povolené použití (proti čemu) —' });

const productRow = (p = {}) => {
  const prod = byId(db.products, p.productId);
  return `
  <div class="row row-product">
    <select name="p-id" aria-label="Přípravek">${options(sortByName(db.products), p.productId, { empty: '— přípravek —' })}</select>
    <input name="p-dose" inputmode="decimal" placeholder="dávka/ha" value="${numVal(p.dose)}" aria-label="Dávka na hektar">
    <button type="button" class="icon-btn" data-action="remove-row" aria-label="Odebrat">✕</button>
    <select name="p-use" aria-label="Povolené použití"${prod?.uses?.length ? '' : ' hidden'}>${useOptions(prod, p.useId)}</select>
  </div>`;
};

// Dávka podle povoleného použití (horní mez), pokud jde převést na jednotku přípravku.
function applyUseDose(row) {
  const prod = byId(db.products, $('[name=p-id]', row).value);
  const use = prod?.uses?.find(u => u.id === $('[name=p-use]', row).value);
  const dose = use && convertDose(use.doseMax ?? use.doseMin, use.doseUnit);
  if (dose && dose.unit === prod.unit) $('[name=p-dose]', row).value = String(dose.dose).replace('.', ',');
}

const harvestRow = (h = {}, names = []) => `
  <div class="row row-harvest">
    <select name="h-variety" aria-label="Odrůda" style="flex:3">${harvestVarietyOptions(names, h.variety)}</select>
    <input name="h-kg" inputmode="decimal" placeholder="kg" value="${numVal(h.kg)}" aria-label="Množství (kg)">
    <input name="h-sugar" inputmode="decimal" placeholder="°NM" value="${numVal(h.sugar)}" aria-label="Cukernatost (°NM)">
    <button type="button" class="icon-btn" data-action="remove-row" aria-label="Odebrat">✕</button>
  </div>`;

const harvestVarietyOptions = (names, selected = '') =>
  options(selected && !names.includes(selected) ? [...names, selected] : names, selected, { empty: '— celá vinice —' });

// Vinice vybrané v otevřeném formuláři práce (nová práce: zaškrtávátka, úprava: select).
function formVineyardIds() {
  const sel = $('select[name=vineyardId]', form);
  return sel ? [sel.value] : $$('input[name=vineyards]:checked', form).map(c => c.value);
}

function formVarietyNames() {
  const ids = formVineyardIds();
  if (ids.length !== 1) return [];
  return [...new Set((byId(db.vineyards, ids[0])?.varieties || []).map(x => x.name))];
}

function refreshHarvestVarieties() {
  const names = formVarietyNames();
  $$('select[name=h-variety]', form).forEach(sel => { sel.innerHTML = harvestVarietyOptions(names, sel.value); });
  const ids = formVineyardIds();
  const date = $('[name=date]', form).value;
  const block = ids.length === 1 && date && phiInfo(ids[0], { at: date, excludeId: form.dataset.workId });
  $('#harvest-hint').textContent = ids.length > 1 ? 'Sklizeň zapisuj pro každou vinici zvlášť – vyber jen jednu.'
    : block && block.until > date ? `⚠ Ochranná lhůta běží do ${fmtDate(block.until)} (${block.product.name}).` : '';
}

// Vinice a pod nimi pozemky v přípravě (s označením).
const workPlaces = () => [...sortVineyards(plantedVineyards()), ...sortVineyards(db.vineyards.filter(isPrep))];
const placeName = v => (isPrep(v) ? `${vName(v)} (příprava)` : vName(v));

function workForm(w, { copy = false, vineyardId = '', planned = false } = {}) {
  const isNew = !w || copy;
  const src = w || {};
  const data = copy
    ? { ...structuredClone(src), id: undefined, date: today(), dateTo: null, status: 'done' }
    : (w || { date: today(), status: planned ? 'planned' : 'done', vineyardId, activityId: selectableActivities()[0]?.id });

  if (!db.vineyards.length) {
    toast('Nejdřív přidej aspoň jednu vinici.');
    vineyardForm();
    return;
  }

  // U nové práce lze vybrat víc vinic najednou (vytvoří se záznam pro každou).
  const vineyardField = isNew
    ? `<fieldset><legend>Vinice *</legend><div class="checks">
        ${workPlaces().map(v => `<label><input type="checkbox" name="vineyards" value="${v.id}"${v.id === data.vineyardId ? ' checked' : ''}> ${esc(placeName(v))}</label>`).join('')}
       </div><p class="small muted">Při výběru více vinic se zapíše samostatný záznam pro každou (hodiny se zapíší ke každé).</p></fieldset>`
    : `<div class="field"><label>Vinice *</label><select name="vineyardId">${options(workPlaces().map(v => ({ id: v.id, name: placeName(v) })), data.vineyardId)}</select></div>`;

  openForm({
    title: copy ? 'Kopie práce' : isNew ? (data.status === 'planned' ? 'Naplánovat práci' : 'Zapsat práci') : 'Upravit práci',
    body: `
      <div class="grid2">
        <div class="field"><label>Datum (od) *</label><input type="date" name="date" required value="${data.date}"></div>
        <div class="field"><label>Do <span class="muted">(nepovinné)</span></label><input type="date" name="dateTo" value="${data.dateTo ?? ''}" min="${data.date}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Činnost *</label><select name="activityId">${options(selectableActivities(data.activityId), data.activityId)}</select></div>
        <div class="field"><label>Stav</label><select name="status">${options([{ id: 'done', name: 'Provedeno' }, { id: 'planned', name: 'Plánováno' }], data.status)}</select></div>
      </div>
      ${vineyardField}
      <fieldset>
        <legend>Pracovníci a hodiny <span class="small muted">(celkem za celou dobu)</span></legend>
        <div class="rows" id="worker-rows">${(data.workers?.length ? data.workers : [{}]).map(workerRow).join('')}</div>
        <button type="button" class="btn sm" data-action="add-worker-row">+ pracovník</button>
        ${db.workers.length ? '' : '<p class="small muted">Pracovníky přidáš v sekci Lidé.</p>'}
      </fieldset>
      <fieldset id="products-section">
        <legend>Přípravky / hnojiva</legend>
        <div class="rows" id="product-rows">${(data.products?.length ? data.products : [{}]).map(productRow).join('')}</div>
        <button type="button" class="btn sm" data-action="add-product-row">+ přípravek</button>
        <div class="grid2" style="margin-top:10px">
          <div class="field"><label>Voda (l/ha)</label><input name="water" inputmode="decimal" value="${numVal(data.water)}"></div>
          <div class="field"><label>Proti čemu / účel</label><input name="target" value="${esc(data.target)}" placeholder="např. peronospora"></div>
        </div>
        ${db.products.length ? '' : '<p class="small muted">Přípravky přidáš v sekci Přípravky.</p>'}
      </fieldset>
      <fieldset id="harvest-section">
        <legend>Sklizeň <span class="small muted">(odrůda, kg, °NM)</span></legend>
        <div class="rows" id="harvest-rows">${(data.harvest?.length ? data.harvest : [{}]).map(h => harvestRow(h)).join('')}</div>
        <button type="button" class="btn sm" data-action="add-harvest-row">+ odrůda</button>
        <p class="small muted" id="harvest-hint"></p>
      </fieldset>
      <div class="field"><label>Poznámka</label><textarea name="note">${esc(data.note)}</textarea></div>`,
    onInit: () => {
      const typeSel = $('select[name=activityId]', form);
      const sync = () => {
        const kind = byId(db.activities, typeSel.value)?.kind;
        $('#products-section').hidden = kind !== 'spray';
        $('#harvest-section').hidden = kind !== 'harvest';
      };
      typeSel.addEventListener('change', sync);
      sync();
      form.dataset.workId = isNew ? '' : w.id;
      const dateFrom = $('[name=date]', form);
      dateFrom.addEventListener('change', () => { $('[name=dateTo]', form).min = dateFrom.value; });
      refreshHarvestVarieties();
      $$('input[name=vineyards], select[name=vineyardId], input[name=date]', form).forEach(el => el.addEventListener('change', refreshHarvestVarieties));
      // Po výběru přípravku nabídnout jeho povolená použití a předvyplnit dávku.
      $('#product-rows').addEventListener('change', e => {
        const row = e.target.closest('.row-product');
        if (e.target.name === 'p-use') return applyUseDose(row);
        if (e.target.name !== 'p-id') return;
        const prod = byId(db.products, e.target.value);
        const useSel = $('[name=p-use]', row);
        useSel.innerHTML = useOptions(prod, prod?.uses?.length === 1 ? prod.uses[0].id : '');
        useSel.hidden = !prod?.uses?.length;
        const dose = $('[name=p-dose]', row);
        if (prod?.uses?.length === 1) applyUseDose(row);
        else if (prod?.defaultDose && !dose.value) dose.value = String(prod.defaultDose).replace('.', ',');
      });
    },
    onSubmit: (get, fd) => {
      const vineyardIds = isNew ? fd.getAll('vineyards') : [get('vineyardId')];
      if (!get('date')) { toast('Vyplň datum.'); return false; }
      if (get('dateTo') && get('dateTo') < get('date')) { toast('Datum „do“ nesmí být před datem „od“.'); return false; }
      if (!vineyardIds.length || !vineyardIds[0]) { toast('Vyber aspoň jednu vinici.'); return false; }

      const activityId = get('activityId');
      const kind = byId(db.activities, activityId)?.kind;
      if (!kind) { toast('Vyber činnost.'); return false; }
      if (kind === 'harvest' && vineyardIds.length > 1) { toast('Sklizeň zapisuj pro každou vinici zvlášť.'); return false; }
      const workers = $$('.row-worker', form)
        .map(r => ({ workerId: $('[name=w-id]', r).value, hours: parseNum($('[name=w-hours]', r).value) }))
        .filter(e => e.workerId);
      const hasProducts = kind === 'spray';
      const products = hasProducts
        ? $$('.row-product', form)
            .map(r => {
              const productId = $('[name=p-id]', r).value;
              const use = byId(db.products, productId)?.uses?.find(u => u.id === $('[name=p-use]', r).value);
              // Údaje použití se uloží k záznamu, aby se historie nezměnila s aktualizací registru.
              return { productId, dose: parseNum($('[name=p-dose]', r).value),
                ...(use && { useId: use.id, pest: use.pest, phi: use.phi, phiDays: use.phiDays }) };
            })
            .filter(p => p.productId)
        : [];
      for (const p of products) {
        const prod = byId(db.products, p.productId);
        const status = productStatus(prod, get('date'));
        if (status?.level === 'danger' && !confirm(`${prod.name}: ${status.text}. Opravdu zapsat?`)) return false;
      }
      // Sklizeň v ochranné lhůtě.
      if (kind === 'harvest' && get('status') === 'done') {
        const block = phiInfo(vineyardIds[0], { at: get('date'), excludeId: isNew ? undefined : w.id });
        if (block && block.until > get('date') && !confirm(`Na vinici běží ochranná lhůta do ${fmtDate(block.until)} (${block.product.name}, ošetřeno ${fmtDate(block.date)}). Opravdu zapsat sklizeň?`)) return false;
      }
      const fields = {
        date: get('date'), dateTo: get('dateTo') && get('dateTo') !== get('date') ? get('dateTo') : null,
        status: get('status'), activityId, workers, products,
        water: hasProducts ? parseNum(get('water')) : null,
        target: hasProducts ? (get('target') || [...new Set(products.map(p => p.pest).filter(Boolean))].join(', ')) : '',
        harvest: kind === 'harvest'
          ? $$('.row-harvest', form)
              .map(r => ({ variety: $('[name=h-variety]', r).value, kg: parseNum($('[name=h-kg]', r).value), sugar: parseNum($('[name=h-sugar]', r).value) }))
              .filter(h => h.kg != null || h.sugar != null)
          : [],
        note: get('note'),
      };

      if (isNew) {
        for (const vineyardId of vineyardIds) {
          db.works.push({ ...structuredClone(fields), id: uid(), vineyardId, created: Date.now() });
        }
        toast(vineyardIds.length > 1 ? `Zapsáno do ${vineyardIds.length} vinic.` : 'Práce zapsána.');
      } else {
        Object.assign(w, fields, { vineyardId: vineyardIds[0] });
      }
      // Ať práce po uložení nezmizí z obrazovky: přepnout na její rok.
      const workYear = fields.date.slice(0, 4);
      if (workYear !== selectedYear) {
        selectedYear = workYear;
        workFilters.month = '';
        toast(`Uloženo do roku ${workYear} – přepínám na něj.`);
      }
    },
    onDelete: isNew ? null : () => {
      if (!confirm('Smazat tento záznam práce?')) return false;
      db.works = db.works.filter(x => x.id !== w.id);
    },
  });
}

/* ----- Import z Registru vinic (XML z Portálu farmáře) ----- */

// Plochy jsou v registru v m², v aplikaci v ha.
function parseRegistryXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('soubor není platné XML');
  // Jen přímé potomky: PLOCHA je ve VINICE i ve SKLADBA.
  const kids = (el, tag) => [...el.children].filter(c => c.tagName === tag);
  const val = (el, tag) => kids(el, tag)[0]?.textContent.trim() ?? '';
  const m2ToHa = v => { const n = parseNum(v); return n === null ? null : Math.round(n) / 10000; };

  const vineyards = [...doc.getElementsByTagName('VINICE')].map(el => {
    const varieties = kids(el, 'SKLADBA').map(s => ({
      name: val(s, 'ODRUDANAZ'),
      code: val(s, 'ODRUDAKOD'),
      area: m2ToHa(val(s, 'PLOCHA')),
      year: val(s, 'ROKVYSADBY'),
      vines: parseNum(val(s, 'POCETKERU')),
      training: val(s, 'VEDENI'),
    })).filter(x => x.name);
    const years = [...new Set(varieties.map(x => x.year).filter(Boolean))].sort();
    return {
      regNo: val(el, 'REGCISLO'),
      trat: val(el, 'TRAT'),
      ku: val(el, 'KU'),
      area: m2ToHa(val(el, 'PLOCHA')),
      purpose: val(el, 'URCENI'),
      dpb: kids(el, 'PAROVANIDPB').map(d => [val(d, 'CTVEREC'), val(d, 'BLOK')].filter(Boolean).join(' ')).filter(Boolean).join(', '),
      plantedYear: years.length > 1 ? `${years[0]}–${years.at(-1)}` : (years[0] ?? ''),
      varieties,
    };
  }).filter(v => v.regNo);
  if (!vineyards.length) throw new Error('v souboru nejsou žádné vinice (očekávám výpis z Registru vinic)');
  return vineyards;
}

// Existující vinice: podle reg. čísla, u ručně založených (bez reg. čísla) podle kódu bloku v DPB.
function findRegistryMatch(rv) {
  const byReg = db.vineyards.find(v => v.regNo === rv.regNo);
  if (byReg) return byReg;
  const blocks = rv.dpb.split(/[\s,;]+/).filter(t => t.includes('/'));
  return db.vineyards.find(v => !v.regNo && v.dpb && v.dpb.split(/[\s,;]+/).some(t => blocks.includes(t)));
}

const registryFields = rv => ({ regNo: rv.regNo, ku: rv.ku, area: rv.area, dpb: rv.dpb, plantedYear: rv.plantedYear, varieties: rv.varieties });
// Porovnání nezávislé na pořadí klíčů; prázdné hodnoty se ignorují.
const stableJson = v => JSON.stringify(v ?? '', (k, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).filter(([, y]) => y != null && y !== '').sort(([a], [b]) => a.localeCompare(b)))
  : x);
const sameFields = (a, b) => Object.keys(b).every(k => stableJson(a[k]) === stableJson(b[k]));

// Výchozí jméno nové vinice z registru: trať + celé reg. číslo (část před lomítkem odpovídá katastru).
// Jméno si uživatel může přepsat; import ho u existujících vinic nemění.
const registryName = rv => (rv.trat ? `${rv.trat} ${rv.regNo}` : rv.regNo);

function importRegistryPreview(list) {
  const rows = list.map((rv, i) => {
    const match = findRegistryMatch(rv);
    const unchanged = match && sameFields(match, registryFields(rv));
    const status = !match ? '<span class="badge ok">nová</span>'
      : unchanged ? '<span class="badge">beze změny</span>'
      : `<span class="badge warn">aktualizace</span> <span class="small">${esc(vName(match))}</span>`;
    return `
      <label class="item" style="cursor:pointer;margin:0;font-weight:400;color:var(--text)">
        <input type="checkbox" name="rv" value="${i}"${unchanged ? '' : ' checked'} style="margin-top:4px">
        <span class="item-main">
          <span class="item-title">${esc(rv.trat || rv.regNo)} ${status}</span>
          <span class="item-meta" style="display:block">${[rv.regNo, `${fmtNum(rv.area, 4)} ha`, rv.ku, rv.dpb && `DPB ${rv.dpb}`].filter(Boolean).map(esc).join(' · ')}</span>
          <span class="item-meta" style="display:block">${esc([...new Set(rv.varieties.map(x => x.name))].join(', '))}</span>
        </span>
      </label>`;
  }).join('');

  openForm({
    title: `Import z Registru vinic (${list.length})`,
    body: `
      <p class="small muted">U existujících vinic se přepíše výměra, DPB, katastr a skladba odrůd podle registru.
        Název, poznámka a zapsané práce zůstanou.</p>
      <p class="actions-row"><button type="button" class="btn sm" data-action="rv-check" data-on="1">Vybrat vše</button>
        <button type="button" class="btn sm" data-action="rv-check">Zrušit výběr</button></p>
      <div class="list">${rows}</div>`,
    onSubmit: (get, fd) => {
      const picked = fd.getAll('rv').map(Number);
      if (!picked.length) { toast('Není vybraná žádná vinice.'); return false; }
      let added = 0, updated = 0;
      for (const i of picked) {
        const rv = list[i];
        const match = findRegistryMatch(rv);
        if (match) {
          Object.assign(match, registryFields(rv));
          // Pozemek v přípravě, který už je v registru vinic, je vysazený.
          delete match.stage;
          delete match.plannedPlanting;
          updated++;
        } else {
          db.vineyards.push({ id: uid(), name: registryName(rv), note: '', ...registryFields(rv) });
          added++;
        }
      }
      toast(`Import hotový – nové vinice: ${added}, aktualizované: ${updated}.`);
    },
  });
}

/* ================= Actions ================= */

const actions = {
  'go': el => { location.hash = el.dataset.href; },
  'set-year': el => setYear(el.dataset.year),
  'close-dialog': closeForm,
  // Bez data-vineyard (tlačítko v záhlaví) se v detailu vinice předvybere ta vinice.
  'new-work': el => workForm(null, {
    vineyardId: el.dataset.vineyard || location.hash.match(/^#\/vinice\/(.+)/)?.[1] || '',
    planned: !!el.dataset.planned,
  }),
  'edit-work': el => workForm(byId(db.works, el.dataset.id)),
  'copy-work': el => workForm(byId(db.works, el.dataset.id), { copy: true }),
  'complete-work': el => {
    const w = byId(db.works, el.dataset.id);
    w.status = 'done';
    // Jednodenní práce: dnes. Vícedenní: konec dnes (začátek zůstane, pokud už proběhl).
    const t = today();
    if (w.dateTo && w.date < t) w.dateTo = t;
    else { w.date = t; w.dateTo = null; }
    save(); render();
    toast('Označeno jako provedené.');
  },
  'new-vineyard': () => vineyardForm(),
  'new-prep': () => vineyardForm(null, { stage: 'preparation' }),
  'plant-vineyard': el => plantForm(byId(db.vineyards, el.dataset.id)),
  'edit-vineyard': el => vineyardForm(byId(db.vineyards, el.dataset.id)),
  'delete-vineyard': el => {
    if (deleteVineyard(byId(db.vineyards, el.dataset.id)) === false) return;
    save(); render();
  },
  'new-worker': () => workerForm(),
  'edit-worker': el => workerForm(byId(db.workers, el.dataset.id)),
  'new-product': () => productForm(),
  'new-activity': () => activityForm(),
  'pick-por': el => fillProductFromPor(findPor(el.dataset.reg)),
  'update-registry': async el => {
    el.disabled = true;
    el.textContent = 'Stahuji registr… (100 MB, obvykle 1–3 minuty)';
    try {
      const res = await fetch('api/por/update', { method: 'POST' });
      const info = await res.json();
      if (!res.ok) throw new Error(info.error || 'HTTP ' + res.status);
      await loadRegistry(true);
      const n = refreshLinkedProducts();
      if (n) save();
      toast(`Registr aktualizován: ${info.count} přípravků pro révu${n ? `, obnoveno ${n} tvých přípravků` : ''}.`);
    } catch (e) {
      toast('Aktualizace selhala: ' + e.message);
    }
    if (!dlg.open) render();
  },
  'edit-activity': el => activityForm(byId(db.activities, el.dataset.id)),
  'move-activity': el => {
    const list = db.activities;
    const i = list.findIndex(a => a.id === el.dataset.id);
    const j = i + Number(el.dataset.dir);
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    save(); render();
  },
  'edit-product': el => productForm(byId(db.products, el.dataset.id)),
  'add-worker-row': () => $('#worker-rows').insertAdjacentHTML('beforeend', workerRow()),
  'add-variety-row': () => $('#variety-rows').insertAdjacentHTML('beforeend', varietyRow({}, form.dataset.stage)),
  'add-harvest-row': () => $('#harvest-rows').insertAdjacentHTML('beforeend', harvestRow({}, formVarietyNames())),
  'add-product-row': () => $('#product-rows').insertAdjacentHTML('beforeend', productRow()),
  'remove-row': el => el.closest('.row').remove(),
  'rv-check': el => $$('input[name=rv]', form).forEach(c => { c.checked = !!el.dataset.on; }),

  'backup': () => {
    download(`vitinote-zaloha-${today()}.json`, JSON.stringify(db, null, 2), 'application/json');
  },
  'export-works': () => {
    const year = $('#export-year').value;
    const rows = [['Datum od', 'Datum do', 'Stav', 'Vinice', 'Práce', 'Pracovníci', 'Hodiny celkem', 'Přípravky', 'Sklizeň kg', 'Sklizeň po odrůdách', 'Poznámka']];
    for (const w of sortWorksDesc(db.works).reverse()) {
      if (!inPeriod(w, year)) continue;
      rows.push([
        w.date, w.dateTo ?? '', isPlanned(w) ? 'plán' : 'provedeno', vineyardName(w.vineyardId), activityName(w),
        (w.workers || []).map(e => `${workerName(e.workerId)} ${fmtNum(e.hours, 1)} h`).join(', '),
        workHours(w), productsSummary(w), harvestKg(w) || '', harvestSummary(w), w.note,
      ]);
    }
    download(`vitinote-prace-${year}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  },
  'export-por': () => {
    const year = $('#export-year').value;
    const rows = [['Datum od', 'Datum do', 'Vinice', 'Kód DPB', 'Plodina', 'Ošetřená plocha (ha)', 'Přípravek / hnojivo', 'Reg. číslo', 'Druh', 'Dávka na ha', 'Jednotka', 'Celkové množství', 'Voda l/ha', 'Účel', 'Ochranná lhůta']];
    for (const w of sortWorksDesc(db.works).reverse()) {
      if (isPlanned(w) || !inPeriod(w, year)) continue;
      const v = byId(db.vineyards, w.vineyardId);
      for (const p of w.products || []) {
        const prod = byId(db.products, p.productId);
        rows.push([
          w.date, w.dateTo ?? '', v ? vName(v) : '', v?.dpb ?? '', isPrep(v) ? 'bez plodiny (příprava na výsadbu)' : 'réva vinná', v?.area ?? '', prod?.name ?? '(smazaný)', prod?.regNo ?? '', prod?.kind ?? '',
          p.dose ?? '', prod?.unit ?? '', Math.round(productAmount(w, p) * 1000) / 1000, w.water ?? '', p.pest || w.target,
          p.useId ? p.phi : (prod?.phiDays ?? ''),
        ]);
      }
    }
    if (rows.length === 1) { toast(`V roce ${year} nejsou žádná ošetření.`); return; }
    download(`vitinote-evidence-por-${year}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  },
  'wipe': () => {
    if (!confirm('Opravdu nevratně smazat všechna data? Doporučuji nejdřív stáhnout zálohu.')) return;
    db = emptyDb();
    save(); render();
    toast('Data smazána.');
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  // Tlačítka uvnitř klikatelného řádku nesmí spustit i akci řádku.
  e.stopPropagation();
  e.preventDefault();
  actions[el.dataset.action](el);
});

$('#year').addEventListener('change', e => setYear(e.target.value));

// Zavření dialogu klepnutím mimo něj.
dlg.addEventListener('click', e => { if (e.target === dlg) closeForm(); });

$('#main').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.filter === 'workersPeriod') {
    workersPeriod = t.value;
    render();
  } else if (t.dataset.filter) {
    workFilters[t.dataset.filter] = t.value;
    render();
  } else if (t.matches('[data-import-rv]') && t.files[0]) {
    t.files[0].text().then(text => importRegistryPreview(parseRegistryXml(text)))
      .catch(err => toast('Import selhal: ' + err.message))
      .finally(() => { t.value = ''; });
  } else if (t.matches('[data-import]') && t.files[0]) {
    t.files[0].text().then(text => {
      const data = JSON.parse(text);
      if (data?.version !== 1 || !Array.isArray(data.works)) throw new Error('neplatný formát');
      if (!confirm(`Nahradit současná data zálohou (${data.vineyards.length} vinic, ${data.works.length} prací)?`)) return;
      db = normalizeDb(data);
      save(); render();
      toast('Záloha obnovena.');
    }).catch(err => toast('Import selhal: ' + err.message))
      .finally(() => { t.value = ''; });
  }
});

/* ================= Start ================= */

render();
pullFromServer();
loadRegistry().then(() => { if (location.hash.startsWith('#/pripravky') && !dlg.open) render(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pullFromServer(); });
window.addEventListener('online', pullFromServer);
dlg.addEventListener('close', () => { if (isDirty()) pushToServer(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Požádat prohlížeč, ať data nemaže při nedostatku místa.
navigator.storage?.persist?.().catch(() => {});
