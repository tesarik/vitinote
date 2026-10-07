// Datový model: konstanty, převody starších dat, stav `db` a doménová logika (období, ochranné lhůty…).
import { addDays, byId, daysBetween, fmtDate, fmtNum, fold, isPlanned, pad, today } from './util.js';

export const DB_KEY = 'vitinote:v1';
// Kód EPPO plodiny pro evidenci POR (Vitis vinifera).
export const EPPO_VINE = 'VITVI';
export const PRODUCT_KINDS = ['Fungicid', 'Insekticid', 'Akaricid', 'Herbicid', 'Hnojivo', 'Jiné'];

// Číselník činností: chování určuje, jaká pole má formulář práce (přípravky / sklizeň).
export const ACTIVITY_KINDS = { work: 'Běžná práce', spray: 'Ošetření (přípravky)', harvest: 'Sklizeň' };
export const DEFAULT_ACTIVITIES = [
  ['Řez', 'work'], ['Vázání', 'work'], ['Čištění kmínků', 'work'], ['Podlom', 'work'], ['Zastrkování', 'work'],
  ['Vylamování zálistků', 'work'], ['Odlistění zóny hroznů', 'work'], ['Osečkování', 'work'], ['Postřik', 'spray'],
  ['Hnojení', 'spray'], ['Kultivace / mulčování', 'work'], ['Sklizeň', 'harvest'], ['Jiné', 'work'],
];
// Názvy z dřívějšího pevného seznamu: přejmenované → nový název; zrušené se zachovají jako skryté.
export const LEGACY_ACTIVITY_NAMES = { 'Zastřihování': 'Osečkování' };
export const RETIRED_ACTIVITY_NAMES = new Set(['Zelené práce']);
// Stabilní id z názvu: převod starých dat na dvou zařízeních tak vytvoří stejná id.
export const activityIdFor = name => 'act-' + name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const defaultActivities = () => DEFAULT_ACTIVITIES.map(([name, kind]) => ({ id: activityIdFor(name), name, kind, hidden: false }));

// `migrated` = jednorázové převody, které už proběhly (nesmí se opakovat nad daty, která uživatel mezitím změnil).
export const emptyDb = () => ({ version: 1, migrated: { regNoNames: true }, activities: defaultActivities(), vineyards: [], workers: [], machines: [], products: [], purchases: [], works: [] });

// Doplní chybějící kolekce a převede starší tvary dat (jedna odrůda jako text → seznam odrůd).
export function normalizeDb(d) {
  const migrateNames = !d.migrated?.regNoNames;
  d = { ...emptyDb(), ...d, migrated: { ...d.migrated, regNoNames: true } };
  for (const v of d.vineyards) {
    if (!Array.isArray(v.varieties)) {
      v.varieties = String(v.variety ?? '').split(',').map(s => s.trim()).filter(Boolean).map(name => ({ name, area: null }));
    }
    delete v.variety;
    // Dřívější import dával do jména jen číslo za lomítkem („Trať 0742“) → doplnit celé reg. číslo.
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

export function loadDb() {
  try {
    const d = JSON.parse(localStorage.getItem(DB_KEY));
    if (d && d.version === 1) return normalizeDb(d);
  } catch { /* poškozená nebo nedostupná data → začneme načisto */ }
  return emptyDb();
}

export let db = loadDb();

export function setDb(data) {
  db = data;
}
// Pozemek v přípravě na výsadbu je vinice se stage 'preparation'; vysazená vinice stage nemá.
export const isPrep = v => v?.stage === 'preparation';
export const plantedVineyards = () => db.vineyards.filter(v => !isPrep(v));
export const placeLabel = v => (isPrep(v) ? 'pozemek' : 'vinici');
// Vinice má výchozí název (`name`, např. z Registru vinic) a nepovinný vlastní (`alias`), který má přednost.
export const vName = v => v.alias || v.name;
export const sortVineyards = list => [...list].sort((a, b) => vName(a).localeCompare(vName(b), 'cs'));
// Vinice a pod nimi pozemky v přípravě (s označením).
export const workPlaces = () => [...sortVineyards(plantedVineyards()), ...sortVineyards(db.vineyards.filter(isPrep))];
export const placeName = v => (isPrep(v) ? `${vName(v)} (příprava)` : vName(v));
export const vineyardName = id => { const v = byId(db.vineyards, id); return v ? vName(v) : '(smazaná vinice)'; };
export const workerName = id => byId(db.workers, id)?.name ?? '(smazaný)';
export const machineName = id => byId(db.machines, id)?.name ?? '(smazaný stroj)';
export const machineHours = w => (w.machines || []).reduce((s, e) => s + (+e.hours || 0), 0);
export const varietyNames = v => [...new Set((v.varieties || []).map(x => x.name))].join(', ');
export const harvestKg = w => (w.harvest || []).reduce((s, h) => s + (+h.kg || 0), 0);
export const harvestSummary = w => (w.harvest || []).map(h => [
  h.variety || 'celá vinice', h.kg ? `${fmtNum(h.kg, 0)} kg` : '', h.sugar ? `${fmtNum(h.sugar, 1)} °NM` : '',
].filter(Boolean).join(' ')).join(', ');
export const activityOf = w => byId(db.activities, w.activityId);
export const activityName = w => activityOf(w)?.name ?? '(smazaná činnost)';
export const kindOf = w => activityOf(w)?.kind ?? 'work';
// Činnosti pro výběr: skryté jen pokud jsou u upravované práce.
export const selectableActivities = keepId => db.activities.filter(a => !a.hidden || a.id === keepId);
export const workHours = w => (w.workers || []).reduce((s, e) => s + (+e.hours || 0), 0);

// Práce může trvat víc dní: date = od, dateTo = do (nepovinné).
export const workEnd = w => w.dateTo || w.date;
export const workDays = w => daysBetween(w.date, workEnd(w)) + 1;

// Období 'YYYY' nebo 'YYYY-MM' jako [první den, poslední den].
export function periodRange(prefix) {
  if (prefix.length === 4) return [`${prefix}-01-01`, `${prefix}-12-31`];
  const [y, m] = prefix.split('-').map(Number);
  return [`${prefix}-01`, `${prefix}-${pad(new Date(y, m, 0).getDate())}`];
}

// Zasahuje práce do období?
export const inPeriod = (w, prefix) => { const [from, to] = periodRange(prefix); return w.date <= to && workEnd(w) >= from; };

// Podíl práce v období: hodiny a množství vícedenní práce se rozpočítají rovnoměrně podle dnů.
export function periodShare(w, prefix) {
  const [from, to] = periodRange(prefix);
  const a = w.date > from ? w.date : from;
  const b = workEnd(w) < to ? workEnd(w) : to;
  return a > b ? 0 : (daysBetween(a, b) + 1) / workDays(w);
}

export function fmtWorkDate(w) {
  if (!w.dateTo || w.dateTo === w.date) return fmtDate(w.date);
  const [y1, m1, d1] = w.date.split('-').map(Number);
  const [y2, m2, d2] = w.dateTo.split('-').map(Number);
  if (y1 !== y2) return `${fmtDate(w.date)} – ${fmtDate(w.dateTo)}`;
  return m1 === m2 ? `${d1}.–${d2}. ${m1}. ${y1}` : `${d1}. ${m1}. – ${d2}. ${m2}. ${y1}`;
}
// Ochranná lhůta řádku postřiku ve dnech: podle zvoleného povoleného použití, jinak podle přípravku.
export const rowPhiDays = (p, prod) => (p.useId ? p.phiDays : prod?.phiDays) || 0;

// Nejpozdější konec ochranné lhůty na vinici z provedených postřiků (volitelně jen postřiky do data `at`).
export function phiInfo(vineyardId, { at, excludeId } = {}) {
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
export function productStatus(p, at = today()) {
  if (!p) return null;
  if (p.useTo && p.useTo < at) return { level: 'danger', text: `nelze použít – zásoby šlo použít do ${fmtDate(p.useTo)}` };
  if (p.validTo && p.validTo < at) return { level: 'warn', text: `povolení skončilo, zásoby lze použít do ${fmtDate(p.useTo)}` };
  return null;
}

// Data (konec práce) provedených postřiků přípravkem na vinici, vzestupně; volitelně jen v daném roce.
export function sprayDates(vineyardId, productId, { year, excludeId } = {}) {
  return db.works
    .filter(w => w.vineyardId === vineyardId && !isPlanned(w) && w.id !== excludeId && (!year || w.date.startsWith(year))
      && (w.products || []).some(p => p.productId === productId))
    .map(workEnd)
    .sort();
}

// Text práce pro vyhledávání (bez diakritiky, malými písmeny): činnost, vinice, poznámka, přípravky, škůdci, lidé, sklizeň.
export function workSearchText(w) {
  const v = byId(db.vineyards, w.vineyardId);
  return fold([
    activityName(w), v?.name, v?.alias, w.note, w.target, productsSummary(w), harvestSummary(w),
    ...(w.workers || []).map(e => workerName(e.workerId)),
    ...(w.machines || []).map(e => machineName(e.machineId)),
  ].filter(Boolean).join(' '));
}

// Sklad: nákupy (a opravy stavu) minus spotřeba v provedených postřicích.
export function stockOf(productId) {
  const bought = db.purchases.filter(m => m.productId === productId).reduce((s, m) => s + (+m.qty || 0), 0);
  const used = db.works.filter(w => !isPlanned(w))
    .reduce((s, w) => s + (w.products || []).filter(p => p.productId === productId).reduce((t, p) => t + productAmount(w, p), 0), 0);
  return Math.round((bought - used) * 1000) / 1000;
}

// Cena za jednotku: vážený průměr nákupů s cenou, jinak ručně zadaná cena přípravku.
export function unitPrice(prod) {
  const priced = db.purchases.filter(m => m.productId === prod?.id && m.price > 0 && m.qty > 0);
  const qty = priced.reduce((s, m) => s + m.qty, 0);
  return qty ? priced.reduce((s, m) => s + m.price, 0) / qty : (prod?.price ?? null);
}

// Náklady práce v Kč: lidé (h × sazba), stroje (mth × sazba), přípravky (spotřeba × cena za jednotku).
// Položky bez sazby/ceny se nepočítají, jen se sečtou do `unpriced`.
export function workCosts(w) {
  const c = { labour: 0, machines: 0, products: 0, unpriced: 0 };
  const add = (key, qty, price) => { if (!qty) return; if (price) c[key] += qty * price; else c.unpriced++; };
  for (const e of w.workers || []) add('labour', +e.hours || 0, byId(db.workers, e.workerId)?.rate);
  for (const e of w.machines || []) add('machines', +e.hours || 0, byId(db.machines, e.machineId)?.rate);
  for (const p of w.products || []) add('products', productAmount(w, p), unitPrice(byId(db.products, p.productId)));
  return c;
}

// Náklady vinice za období ('YYYY' / 'YYYY-MM'); vícedenní práce se rozpočítají podle dnů.
export function vineyardCosts(vineyardId, prefix) {
  const sum = { labour: 0, machines: 0, products: 0, unpriced: 0 };
  for (const w of db.works) {
    if (w.vineyardId !== vineyardId || isPlanned(w)) continue;
    const share = periodShare(w, prefix);
    if (!share) continue;
    const c = workCosts(w);
    for (const k of ['labour', 'machines', 'products']) sum[k] += c[k] * share;
    sum.unpriced += c.unpriced;
  }
  sum.total = sum.labour + sum.machines + sum.products;
  return sum;
}

// Ošetřená plocha postřiku: zadaná (jen část vinice), jinak celá výměra vinice.
export const treatedArea = w => w.treatedArea ?? byId(db.vineyards, w.vineyardId)?.area ?? 0;

export function productAmount(w, p) {
  return (+p.dose || 0) * treatedArea(w);
}

export function productsSummary(w) {
  return (w.products || []).map(p => {
    const prod = byId(db.products, p.productId);
    return `${prod?.name ?? '(smazaný)'} ${fmtNum(p.dose)} ${prod?.unit ?? ''}/ha${p.pest ? ` (${p.pest})` : ''}`;
  }).join(', ');
}
export const sortWorksDesc = list => [...list].sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0));
