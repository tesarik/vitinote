'use strict';

/* ================= Data ================= */

const DB_KEY = 'vitinote:v1';
const WORK_TYPES = ['Řez', 'Vázání', 'Zelené práce', 'Zastřihování', 'Postřik', 'Hnojení', 'Kultivace / mulčování', 'Sklizeň', 'Jiné'];
const PRODUCT_WORK_TYPES = new Set(['Postřik', 'Hnojení']);
const PRODUCT_KINDS = ['Fungicid', 'Insekticid', 'Akaricid', 'Herbicid', 'Hnojivo', 'Jiné'];

const emptyDb = () => ({ version: 1, vineyards: [], workers: [], products: [], works: [] });

// Doplní chybějící kolekce a převede starší tvary dat (jedna odrůda jako text → seznam odrůd).
function normalizeDb(d) {
  d = { ...emptyDb(), ...d };
  for (const v of d.vineyards) {
    if (!Array.isArray(v.varieties)) {
      v.varieties = String(v.variety ?? '').split(',').map(s => s.trim()).filter(Boolean).map(name => ({ name, area: null }));
    }
    delete v.variety;
  }
  // Sklizeň: jedno množství na práci → seznam po odrůdách.
  for (const w of d.works) {
    if (!Array.isArray(w.harvest)) {
      w.harvest = w.harvestKg != null || w.sugar != null ? [{ variety: '', kg: w.harvestKg ?? null, sugar: w.sugar ?? null }] : [];
    }
    delete w.harvestKg;
    delete w.sugar;
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
const parseNum = v => { const n = parseFloat(String(v ?? '').replace(',', '.').replace(/\s/g, '')); return Number.isFinite(n) ? n : null; };
const byId = (list, id) => list.find(x => x.id === id);
const sortByName = list => [...list].sort((a, b) => a.name.localeCompare(b.name, 'cs'));
const isPlanned = w => w.status === 'planned';

const vineyardName = id => byId(db.vineyards, id)?.name ?? '(smazaná vinice)';
const workerName = id => byId(db.workers, id)?.name ?? '(smazaný)';
const varietyNames = v => [...new Set((v.varieties || []).map(x => x.name))].join(', ');
const harvestKg = w => (w.harvest || []).reduce((s, h) => s + (+h.kg || 0), 0);
const harvestSummary = w => (w.harvest || []).map(h => [
  h.variety || 'celá vinice', h.kg ? `${fmtNum(h.kg, 0)} kg` : '', h.sugar ? `${fmtNum(h.sugar, 1)} °NM` : '',
].filter(Boolean).join(' ')).join(', ');
const workHours = w => (w.workers || []).reduce((s, e) => s + (+e.hours || 0), 0);

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

// Nejpozdější konec ochranné lhůty na vinici (z provedených postřiků).
function phiInfo(vineyardId) {
  let best = null;
  for (const w of db.works) {
    if (w.vineyardId !== vineyardId || isPlanned(w)) continue;
    for (const p of w.products || []) {
      const prod = byId(db.products, p.productId);
      if (!prod || !(prod.phiDays > 0)) continue;
      const until = addDays(w.date, prod.phiDays);
      if (!best || until > best.until) best = { until, product: prod, date: w.date };
    }
  }
  return best;
}

function productAmount(w, p) {
  const area = byId(db.vineyards, w.vineyardId)?.area || 0;
  return (+p.dose || 0) * area;
}

function productsSummary(w) {
  return (w.products || []).map(p => {
    const prod = byId(db.products, p.productId);
    return `${prod?.name ?? '(smazaný)'} ${fmtNum(p.dose)} ${prod?.unit ?? ''}/ha`;
  }).join(', ');
}

/* ================= Rendering helpers ================= */

function workItem(w, { showVineyard = true } = {}) {
  const hours = workHours(w);
  const people = (w.workers || []).map(e => workerName(e.workerId)).join(', ');
  const meta = [
    fmtDate(w.date),
    hours ? `${fmtNum(hours, 1)} h${people ? ` (${esc(people)})` : ''}` : (people ? esc(people) : ''),
    w.products?.length ? esc(productsSummary(w)) : '',
    w.harvest?.length ? esc(harvestSummary(w)) : '',
  ].filter(Boolean).join(' · ');
  return `
    <li class="item" data-action="edit-work" data-id="${w.id}">
      <div class="item-main">
        <div class="item-title">
          <span class="badge${isPlanned(w) ? ' planned' : ''}">${esc(w.type)}${isPlanned(w) ? ' · plán' : ''}</span>
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

/* ================= Views ================= */

function renderDashboard() {
  const t = today();
  const done = db.works.filter(w => !isPlanned(w));
  const planned = db.works.filter(isPlanned).sort((a, b) => a.date.localeCompare(b.date));
  const area = db.vineyards.reduce((s, v) => s + (+v.area || 0), 0);
  const hoursMonth = done.filter(w => w.date.startsWith(thisMonth())).reduce((s, w) => s + workHours(w), 0);
  const worksYear = done.filter(w => w.date.startsWith(t.slice(0, 4))).length;
  const phi = sortByName(db.vineyards)
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
      <div class="stat"><div class="v">${db.vineyards.length}</div><div class="l">vinic</div></div>
      <div class="stat"><div class="v">${fmtNum(area)} ha</div><div class="l">celková výměra</div></div>
      <div class="stat"><div class="v">${fmtNum(hoursMonth, 1)} h</div><div class="l">odpracováno tento měsíc</div></div>
      <div class="stat"><div class="v">${worksYear}</div><div class="l">prací letos</div></div>
    </div>

    ${phi.length ? `
    <div class="card">
      <h2>Běžící ochranné lhůty</h2>
      <ul class="list">
        ${phi.map(({ v, info }) => `
          <li class="item" data-action="go" data-href="#/vinice/${v.id}">
            <div class="item-main">
              <div class="item-title">${esc(v.name)} <span class="badge warn">ještě ${daysBetween(t, info.until)} dní</span></div>
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
      <div class="page-head"><h2>Poslední práce</h2><a href="#/prace">Všechny →</a></div>
      ${workList(sortWorksDesc(done).slice(0, 10))}
    </div>`;
}

const workFilters = { vineyardId: '', type: '', month: '', status: '' };

function renderWorks() {
  const f = workFilters;
  const works = sortWorksDesc(db.works.filter(w =>
    (!f.vineyardId || w.vineyardId === f.vineyardId) &&
    (!f.type || w.type === f.type) &&
    (!f.month || w.date.startsWith(f.month)) &&
    (!f.status || (f.status === 'planned') === isPlanned(w))
  ));
  const hours = works.filter(w => !isPlanned(w)).reduce((s, w) => s + workHours(w), 0);
  return `
    <div class="page-head">
      <h1>Práce</h1>
      <button class="btn primary" data-action="new-work">+ Zapsat práci</button>
    </div>
    <div class="filters">
      <select data-filter="vineyardId">${options(sortByName(db.vineyards), f.vineyardId, { empty: 'Všechny vinice' })}</select>
      <select data-filter="type">${options(WORK_TYPES, f.type, { empty: 'Všechny práce' })}</select>
      <input type="month" data-filter="month" value="${f.month}" aria-label="Měsíc">
      <select data-filter="status">${options([{ id: 'done', name: 'Provedené' }, { id: 'planned', name: 'Plánované' }], f.status, { empty: 'Provedené i plánované' })}</select>
    </div>
    <p class="muted small">${works.length} záznamů · ${fmtNum(hours, 1)} odpracovaných hodin</p>
    <div class="card">${workList(works)}</div>`;
}

function renderVineyards() {
  const t = today();
  const year = t.slice(0, 4);
  const rows = sortByName(db.vineyards).map(v => {
    const works = db.works.filter(w => w.vineyardId === v.id && !isPlanned(w));
    const last = sortWorksDesc(works)[0];
    const hours = works.filter(w => w.date.startsWith(year)).reduce((s, w) => s + workHours(w), 0);
    const phi = phiInfo(v.id);
    return `
      <li class="item" data-action="go" data-href="#/vinice/${v.id}">
        <div class="item-main">
          <div class="item-title">${esc(v.name)} ${phi && phi.until > t ? `<span class="badge warn">OL do ${fmtDate(phi.until)}</span>` : ''}</div>
          <div class="item-meta">${[v.area ? `${fmtNum(v.area, 4)} ha` : '', esc(varietyNames(v)), v.dpb ? `DPB ${esc(v.dpb)}` : ''].filter(Boolean).join(' · ')}</div>
          <div class="item-meta">${last ? `naposledy: ${esc(last.type)} ${fmtDate(last.date)}` : 'zatím bez prací'} · letos ${fmtNum(hours, 1)} h</div>
        </div>
      </li>`;
  }).join('');
  return `
    <div class="page-head">
      <h1>Vinice</h1>
      <button class="btn primary" data-action="new-vineyard">+ Přidat vinici</button>
    </div>
    <div class="card">${rows ? `<ul class="list">${rows}</ul>` : '<p class="empty">Zatím žádné vinice.</p>'}</div>`;
}

function renderVineyardDetail(id) {
  const v = byId(db.vineyards, id);
  if (!v) return `<p class="empty">Vinice nenalezena. <a href="#/vinice">Zpět</a></p>`;
  const t = today();
  const year = t.slice(0, 4);
  const works = sortWorksDesc(db.works.filter(w => w.vineyardId === id));
  const doneYear = works.filter(w => !isPlanned(w) && w.date.startsWith(year));
  const hours = doneYear.reduce((s, w) => s + workHours(w), 0);
  const sprays = doneYear.filter(w => w.products?.length).length;
  const harvest = doneYear.reduce((s, w) => s + harvestKg(w), 0);
  const harvestTable = renderHarvestByVariety(v, doneYear);
  const phi = phiInfo(id);

  return `
    <p><a href="#/vinice">← Vinice</a></p>
    <div class="page-head">
      <h1>${esc(v.name)}</h1>
      <div class="actions-row">
        <button class="btn danger" data-action="delete-vineyard" data-id="${v.id}">Smazat</button>
        <button class="btn" data-action="edit-vineyard" data-id="${v.id}">Upravit</button>
        <button class="btn primary" data-action="new-work" data-vineyard="${v.id}">+ Práce</button>
      </div>
    </div>
    <div class="card">
      <dl class="kv">
        ${v.area ? `<dt>Výměra</dt><dd>${fmtNum(v.area, 4)} ha</dd>` : ''}
        ${v.varieties?.length ? `<dt>${v.varieties.length > 1 ? 'Odrůdy' : 'Odrůda'}</dt><dd>${v.varieties
          .map(x => esc(x.name) + ` <span class="muted small">${[x.year, x.area ? `${fmtNum(x.area, 4)} ha` : '', x.vines ? `${fmtNum(x.vines, 0)} keřů` : '']
            .filter(Boolean).join(' · ')}</span>`).join('<br>')}</dd>` : ''}
        ${v.plantedYear ? `<dt>Výsadba</dt><dd>${esc(v.plantedYear)}</dd>` : ''}
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
      <div class="stat"><div class="v">${fmtNum(hours, 1)} h</div><div class="l">odpracováno letos</div></div>
      <div class="stat"><div class="v">${sprays}</div><div class="l">ošetření letos</div></div>
      ${harvest ? `<div class="stat"><div class="v">${fmtNum(harvest, 0)} kg</div><div class="l">sklizeno letos${v.area ? ` (${fmtNum(harvest / v.area / 1000)} t/ha)` : ''}</div></div>` : ''}
    </div>
    ${harvestTable}
    <div class="card">
      <h2>Historie prací</h2>
      ${workList(works, { showVineyard: false })}
    </div>`;
}

// Letošní sklizeň vinice po odrůdách: kg, t/ha (z plochy odrůdy) a průměrná cukernatost vážená množstvím.
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
      <h2>Sklizeň ${today().slice(0, 4)}</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Odrůda</th><th class="num">kg</th><th class="num">t/ha</th><th class="num">°NM</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>
    </div>`;
}

function renderProducts() {
  const year = today().slice(0, 4);
  const used = {};
  for (const w of db.works) {
    if (isPlanned(w) || !w.date.startsWith(year)) continue;
    for (const p of w.products || []) used[p.productId] = (used[p.productId] || 0) + productAmount(w, p);
  }
  const rows = sortByName(db.products).map(p => `
    <li class="item" data-action="edit-product" data-id="${p.id}">
      <div class="item-main">
        <div class="item-title">${esc(p.name)} <span class="badge">${esc(p.kind)}</span></div>
        <div class="item-meta">${[
          p.phiDays ? `OL ${p.phiDays} dní` : 'bez OL',
          p.defaultDose ? `obvyklá dávka ${fmtNum(p.defaultDose)} ${esc(p.unit)}/ha` : '',
          `letos spotřebováno ${fmtNum(used[p.id] || 0)} ${esc(p.unit)}`,
        ].filter(Boolean).join(' · ')}</div>
        ${p.note ? `<div class="item-note">${esc(p.note)}</div>` : ''}
      </div>
    </li>`).join('');
  return `
    <div class="page-head">
      <h1>Přípravky a hnojiva</h1>
      <button class="btn primary" data-action="new-product">+ Přidat</button>
    </div>
    <div class="card">${rows ? `<ul class="list">${rows}</ul>` : '<p class="empty">Zatím žádné přípravky.</p>'}</div>`;
}

let workersMonth = thisMonth();

function renderWorkers() {
  const stats = {};
  for (const w of db.works) {
    if (isPlanned(w) || !w.date.startsWith(workersMonth)) continue;
    for (const e of w.workers || []) {
      const s = stats[e.workerId] ??= { hours: 0, byType: {} };
      s.hours += +e.hours || 0;
      s.byType[w.type] = (s.byType[w.type] || 0) + (+e.hours || 0);
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
    <div class="filters"><input type="month" data-filter="workersMonth" value="${workersMonth}" aria-label="Měsíc"></div>
    <div class="card">
      ${rows ? `
      <h2>${esc(fmtMonth(workersMonth))}</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Jméno</th><th class="num">Hodiny</th><th class="num">Kč/h</th><th class="num">Náklad</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>Celkem</td><td class="num">${fmtNum(totalH, 1)}</td><td></td><td class="num">${fmtNum(totalCost, 0)} Kč</td></tr></tfoot>
      </table></div>
      <p class="small muted">Klepnutím na řádek pracovníka upravíš.</p>` : '<p class="empty">Zatím žádní pracovníci.</p>'}
    </div>`;
}

function renderSettings() {
  const years = [...new Set(db.works.map(w => w.date.slice(0, 4)))].sort().reverse();
  const yearOpts = (years.length ? years : [today().slice(0, 4)]).map(y => `<option>${y}</option>`).join('');
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

// Kód odrůdy, počet keřů a vedení přicházejí z Registru vinic; ve formuláři se jen zachovají.
const varietyRow = (x = {}) => `
  <div class="row row-variety" data-extra="${esc(JSON.stringify({ code: x.code, vines: x.vines, training: x.training }))}">
    <input name="v-name" value="${esc(x.name)}" placeholder="např. Ryzlink rýnský" aria-label="Odrůda" style="flex:3">
    <input name="v-area" inputmode="decimal" value="${x.area ?? ''}" placeholder="ha" aria-label="Výměra odrůdy (ha)">
    <input name="v-year" inputmode="numeric" value="${esc(x.year)}" placeholder="rok" aria-label="Rok výsadby">
    <button type="button" class="icon-btn" data-action="remove-row" aria-label="Odebrat">✕</button>
  </div>`;

function vineyardForm(v) {
  const isNew = !v;
  v ||= {};
  openForm({
    title: isNew ? 'Nová vinice' : 'Upravit vinici',
    body: `
      <div class="field"><label>Název *</label><input name="name" required value="${esc(v.name)}" placeholder="např. Pod lesem"></div>
      <div class="grid2">
        <div class="field"><label>Výměra (ha)</label><input name="area" inputmode="decimal" value="${v.area ?? ''}"></div>
        <div class="field"><label>Rok výsadby</label><input name="plantedYear" inputmode="numeric" value="${esc(v.plantedYear)}"></div>
      </div>
      <fieldset>
        <legend>Odrůdy <span class="small muted">(název, ha, rok výsadby)</span></legend>
        <div class="rows" id="variety-rows">${(v.varieties?.length ? v.varieties : [{}]).map(varietyRow).join('')}</div>
        <button type="button" class="btn sm" data-action="add-variety-row">+ odrůda</button>
      </fieldset>
      <div class="field"><label>Kód DPB (LPIS)</label><input name="dpb" value="${esc(v.dpb)}" placeholder="pro evidenci POR"></div>
      <div class="grid2">
        <div class="field"><label>Reg. číslo vinice</label><input name="regNo" value="${esc(v.regNo)}" placeholder="z Registru vinic"></div>
        <div class="field"><label>Katastrální území</label><input name="ku" value="${esc(v.ku)}"></div>
      </div>
      <div class="field"><label>Poznámka</label><textarea name="note">${esc(v.note)}</textarea></div>`,
    onSubmit: get => {
      if (!get('name')) { toast('Vyplň název vinice.'); return false; }
      Object.assign(v, {
        name: get('name'), area: parseNum(get('area')), plantedYear: get('plantedYear'),
        varieties: $$('.row-variety', form)
          .map(r => ({
            ...JSON.parse(r.dataset.extra || '{}'),
            name: $('[name=v-name]', r).value.trim(),
            area: parseNum($('[name=v-area]', r).value),
            year: $('[name=v-year]', r).value.trim(),
          }))
          .filter(x => x.name),
        dpb: get('dpb'), regNo: get('regNo'), ku: get('ku'), note: get('note'),
      });
      if (isNew) { v.id = uid(); db.vineyards.push(v); toast('Vinice přidána.'); }
    },
    onDelete: isNew ? null : () => deleteVineyard(v),
  });
}

// Smaže vinici včetně jejích prací; vrací false, pokud uživatel nepotvrdil (konvence onDelete).
function deleteVineyard(v) {
  const n = db.works.filter(w => w.vineyardId === v.id).length;
  if (!confirm(n ? `Smazat vinici „${v.name}“ včetně ${n} záznamů prací?` : `Smazat vinici „${v.name}“?`)) return false;
  db.vineyards = db.vineyards.filter(x => x.id !== v.id);
  db.works = db.works.filter(w => w.vineyardId !== v.id);
  if (location.hash.includes(v.id)) location.hash = '#/vinice';
  toast('Vinice smazána.');
}

/* ----- Worker ----- */

function workerForm(p) {
  const isNew = !p;
  p ||= {};
  openForm({
    title: isNew ? 'Nový pracovník' : 'Upravit pracovníka',
    body: `
      <div class="field"><label>Jméno *</label><input name="name" required value="${esc(p.name)}"></div>
      <div class="field"><label>Hodinová sazba (Kč/h)</label><input name="rate" inputmode="decimal" value="${p.rate ?? ''}"></div>
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

/* ----- Product ----- */

function productForm(p) {
  const isNew = !p;
  p ||= { kind: 'Fungicid', unit: 'l' };
  openForm({
    title: isNew ? 'Nový přípravek / hnojivo' : 'Upravit přípravek',
    body: `
      <div class="field"><label>Název *</label><input name="name" required value="${esc(p.name)}"></div>
      <div class="grid2">
        <div class="field"><label>Druh</label><select name="kind">${options(PRODUCT_KINDS, p.kind)}</select></div>
        <div class="field"><label>Jednotka</label><select name="unit">${options([{ id: 'l', name: 'litry (l)' }, { id: 'kg', name: 'kilogramy (kg)' }], p.unit)}</select></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Ochranná lhůta (dny)</label><input name="phiDays" inputmode="numeric" value="${p.phiDays ?? ''}"></div>
        <div class="field"><label>Obvyklá dávka / ha</label><input name="defaultDose" inputmode="decimal" value="${p.defaultDose ?? ''}"></div>
      </div>
      <div class="field"><label>Poznámka (účinná látka, reg. číslo…)</label><textarea name="note">${esc(p.note)}</textarea></div>`,
    onSubmit: get => {
      if (!get('name')) { toast('Vyplň název.'); return false; }
      Object.assign(p, {
        name: get('name'), kind: get('kind'), unit: get('unit'),
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
    <input name="w-hours" inputmode="decimal" placeholder="hodin" value="${e.hours ?? ''}" aria-label="Hodiny">
    <button type="button" class="icon-btn" data-action="remove-row" aria-label="Odebrat">✕</button>
  </div>`;

const productRow = (p = {}) => `
  <div class="row row-product">
    <select name="p-id" aria-label="Přípravek">${options(sortByName(db.products), p.productId, { empty: '— přípravek —' })}</select>
    <input name="p-dose" inputmode="decimal" placeholder="dávka/ha" value="${p.dose ?? ''}" aria-label="Dávka na hektar">
    <button type="button" class="icon-btn" data-action="remove-row" aria-label="Odebrat">✕</button>
  </div>`;

const harvestRow = (h = {}, names = []) => `
  <div class="row row-harvest">
    <select name="h-variety" aria-label="Odrůda" style="flex:3">${harvestVarietyOptions(names, h.variety)}</select>
    <input name="h-kg" inputmode="decimal" placeholder="kg" value="${h.kg ?? ''}" aria-label="Množství (kg)">
    <input name="h-sugar" inputmode="decimal" placeholder="°NM" value="${h.sugar ?? ''}" aria-label="Cukernatost (°NM)">
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
  $('#harvest-hint').textContent = formVineyardIds().length > 1 ? 'Sklizeň zapisuj pro každou vinici zvlášť – vyber jen jednu.' : '';
}

function workForm(w, { copy = false, vineyardId = '', planned = false } = {}) {
  const isNew = !w || copy;
  const src = w || {};
  const data = copy
    ? { ...structuredClone(src), id: undefined, date: today(), status: 'done' }
    : (w || { date: today(), status: planned ? 'planned' : 'done', vineyardId, type: WORK_TYPES[0] });

  if (!db.vineyards.length) {
    toast('Nejdřív přidej aspoň jednu vinici.');
    vineyardForm();
    return;
  }

  // U nové práce lze vybrat víc vinic najednou (vytvoří se záznam pro každou).
  const vineyardField = isNew
    ? `<fieldset><legend>Vinice *</legend><div class="checks">
        ${sortByName(db.vineyards).map(v => `<label><input type="checkbox" name="vineyards" value="${v.id}"${v.id === data.vineyardId ? ' checked' : ''}> ${esc(v.name)}</label>`).join('')}
       </div><p class="small muted">Při výběru více vinic se zapíše samostatný záznam pro každou (hodiny se zapíší ke každé).</p></fieldset>`
    : `<div class="field"><label>Vinice *</label><select name="vineyardId">${options(sortByName(db.vineyards), data.vineyardId)}</select></div>`;

  openForm({
    title: copy ? 'Kopie práce' : isNew ? (data.status === 'planned' ? 'Naplánovat práci' : 'Zapsat práci') : 'Upravit práci',
    body: `
      <div class="grid2">
        <div class="field"><label>Datum *</label><input type="date" name="date" required value="${data.date}"></div>
        <div class="field"><label>Stav</label><select name="status">${options([{ id: 'done', name: 'Provedeno' }, { id: 'planned', name: 'Plánováno' }], data.status)}</select></div>
      </div>
      <div class="field"><label>Druh práce *</label><select name="type">${options(WORK_TYPES, data.type)}</select></div>
      ${vineyardField}
      <fieldset>
        <legend>Pracovníci a hodiny</legend>
        <div class="rows" id="worker-rows">${(data.workers?.length ? data.workers : [{}]).map(workerRow).join('')}</div>
        <button type="button" class="btn sm" data-action="add-worker-row">+ pracovník</button>
        ${db.workers.length ? '' : '<p class="small muted">Pracovníky přidáš v sekci Lidé.</p>'}
      </fieldset>
      <fieldset id="products-section">
        <legend>Přípravky / hnojiva</legend>
        <div class="rows" id="product-rows">${(data.products?.length ? data.products : [{}]).map(productRow).join('')}</div>
        <button type="button" class="btn sm" data-action="add-product-row">+ přípravek</button>
        <div class="grid2" style="margin-top:10px">
          <div class="field"><label>Voda (l/ha)</label><input name="water" inputmode="decimal" value="${data.water ?? ''}"></div>
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
      const typeSel = $('select[name=type]', form);
      const sync = () => {
        $('#products-section').hidden = !PRODUCT_WORK_TYPES.has(typeSel.value);
        $('#harvest-section').hidden = typeSel.value !== 'Sklizeň';
      };
      typeSel.addEventListener('change', sync);
      sync();
      refreshHarvestVarieties();
      $$('input[name=vineyards], select[name=vineyardId]', form).forEach(el => el.addEventListener('change', refreshHarvestVarieties));
      // Předvyplnění obvyklé dávky po výběru přípravku.
      $('#product-rows').addEventListener('change', e => {
        if (e.target.name !== 'p-id') return;
        const dose = e.target.parentElement.querySelector('[name=p-dose]');
        const prod = byId(db.products, e.target.value);
        if (prod?.defaultDose && !dose.value) dose.value = String(prod.defaultDose).replace('.', ',');
      });
    },
    onSubmit: (get, fd) => {
      const vineyardIds = isNew ? fd.getAll('vineyards') : [get('vineyardId')];
      if (!get('date')) { toast('Vyplň datum.'); return false; }
      if (!vineyardIds.length || !vineyardIds[0]) { toast('Vyber aspoň jednu vinici.'); return false; }

      const type = get('type');
      if (type === 'Sklizeň' && vineyardIds.length > 1) { toast('Sklizeň zapisuj pro každou vinici zvlášť.'); return false; }
      const workers = $$('.row-worker', form)
        .map(r => ({ workerId: $('[name=w-id]', r).value, hours: parseNum($('[name=w-hours]', r).value) }))
        .filter(e => e.workerId);
      const hasProducts = PRODUCT_WORK_TYPES.has(type);
      const products = hasProducts
        ? $$('.row-product', form)
            .map(r => ({ productId: $('[name=p-id]', r).value, dose: parseNum($('[name=p-dose]', r).value) }))
            .filter(p => p.productId)
        : [];
      const fields = {
        date: get('date'), status: get('status'), type, workers, products,
        water: hasProducts ? parseNum(get('water')) : null,
        target: hasProducts ? get('target') : '',
        harvest: type === 'Sklizeň'
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

function importRegistryPreview(list) {
  const rows = list.map((rv, i) => {
    const match = findRegistryMatch(rv);
    const unchanged = match && sameFields(match, registryFields(rv));
    const status = !match ? '<span class="badge ok">nová</span>'
      : unchanged ? '<span class="badge">beze změny</span>'
      : `<span class="badge warn">aktualizace</span> <span class="small">${esc(match.name)}</span>`;
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
          updated++;
        } else {
          const suffix = rv.regNo.split('/')[1] || rv.regNo;
          db.vineyards.push({ id: uid(), name: rv.trat ? `${rv.trat} ${suffix}` : rv.regNo, note: '', ...registryFields(rv) });
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
    w.date = today();
    save(); render();
    toast('Označeno jako provedené.');
  },
  'new-vineyard': () => vineyardForm(),
  'edit-vineyard': el => vineyardForm(byId(db.vineyards, el.dataset.id)),
  'delete-vineyard': el => {
    if (deleteVineyard(byId(db.vineyards, el.dataset.id)) === false) return;
    save(); render();
  },
  'new-worker': () => workerForm(),
  'edit-worker': el => workerForm(byId(db.workers, el.dataset.id)),
  'new-product': () => productForm(),
  'edit-product': el => productForm(byId(db.products, el.dataset.id)),
  'add-worker-row': () => $('#worker-rows').insertAdjacentHTML('beforeend', workerRow()),
  'add-variety-row': () => $('#variety-rows').insertAdjacentHTML('beforeend', varietyRow()),
  'add-harvest-row': () => $('#harvest-rows').insertAdjacentHTML('beforeend', harvestRow({}, formVarietyNames())),
  'add-product-row': () => $('#product-rows').insertAdjacentHTML('beforeend', productRow()),
  'remove-row': el => el.closest('.row').remove(),
  'rv-check': el => $$('input[name=rv]', form).forEach(c => { c.checked = !!el.dataset.on; }),

  'backup': () => {
    download(`vitinote-zaloha-${today()}.json`, JSON.stringify(db, null, 2), 'application/json');
  },
  'export-works': () => {
    const year = $('#export-year').value;
    const rows = [['Datum', 'Stav', 'Vinice', 'Práce', 'Pracovníci', 'Hodiny celkem', 'Přípravky', 'Sklizeň kg', 'Sklizeň po odrůdách', 'Poznámka']];
    for (const w of sortWorksDesc(db.works).reverse()) {
      if (!w.date.startsWith(year)) continue;
      rows.push([
        w.date, isPlanned(w) ? 'plán' : 'provedeno', vineyardName(w.vineyardId), w.type,
        (w.workers || []).map(e => `${workerName(e.workerId)} ${fmtNum(e.hours, 1)} h`).join(', '),
        workHours(w), productsSummary(w), harvestKg(w) || '', harvestSummary(w), w.note,
      ]);
    }
    download(`vitinote-prace-${year}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  },
  'export-por': () => {
    const year = $('#export-year').value;
    const rows = [['Datum', 'Vinice', 'Kód DPB', 'Plodina', 'Ošetřená plocha (ha)', 'Přípravek / hnojivo', 'Druh', 'Dávka na ha', 'Jednotka', 'Celkové množství', 'Voda l/ha', 'Účel', 'Ochranná lhůta (dny)']];
    for (const w of sortWorksDesc(db.works).reverse()) {
      if (isPlanned(w) || !w.date.startsWith(year)) continue;
      const v = byId(db.vineyards, w.vineyardId);
      for (const p of w.products || []) {
        const prod = byId(db.products, p.productId);
        rows.push([
          w.date, v?.name ?? '', v?.dpb ?? '', 'réva vinná', v?.area ?? '', prod?.name ?? '(smazaný)', prod?.kind ?? '',
          p.dose ?? '', prod?.unit ?? '', Math.round(productAmount(w, p) * 1000) / 1000, w.water ?? '', w.target, prod?.phiDays ?? '',
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

// Zavření dialogu klepnutím mimo něj.
dlg.addEventListener('click', e => { if (e.target === dlg) closeForm(); });

$('#main').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.filter === 'workersMonth') {
    workersMonth = t.value || thisMonth();
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
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pullFromServer(); });
window.addEventListener('online', pullFromServer);
dlg.addEventListener('close', () => { if (isDirty()) pushToServer(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Požádat prohlížeč, ať data nemaže při nedostatku místa.
navigator.storage?.persist?.().catch(() => {});
