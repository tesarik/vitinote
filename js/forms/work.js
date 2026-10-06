// Formulář práce: pracovníci, přípravky s povoleným použitím, sklizeň po odrůdách.
import { $, $$, byId, esc, fmtDate, numVal, options, parseNum, sortByName, toast, today, uid } from '../util.js';
import { db, isPrep, phiInfo, plantedVineyards, productStatus, selectableActivities, sortVineyards, vName } from '../data.js';
import { convertDose, useLabel } from '../registry-por.js';
import { selectedYear, setYear } from '../view-state.js';
import { form, openForm } from '../dialog.js';
import { vineyardForm } from './vineyard.js';

export const workerRow = (e = {}) => `
  <div class="row row-worker">
    <select name="w-id" aria-label="Pracovník">${options(sortByName(db.workers), e.workerId, { empty: '— pracovník —' })}</select>
    <input name="w-hours" inputmode="decimal" placeholder="hodin" value="${numVal(e.hours)}" aria-label="Hodiny">
    <button type="button" class="icon-btn" data-action="remove-row" aria-label="Odebrat">✕</button>
  </div>`;

export const useOptions = (prod, selected) =>
  options((prod?.uses || []).map(u => ({ id: u.id, name: useLabel(u) })), selected, { empty: '— povolené použití (proti čemu) —' });

export const productRow = (p = {}) => {
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
export function applyUseDose(row) {
  const prod = byId(db.products, $('[name=p-id]', row).value);
  const use = prod?.uses?.find(u => u.id === $('[name=p-use]', row).value);
  const dose = use && convertDose(use.doseMax ?? use.doseMin, use.doseUnit);
  if (dose && dose.unit === prod.unit) $('[name=p-dose]', row).value = String(dose.dose).replace('.', ',');
}

export const harvestRow = (h = {}, names = []) => `
  <div class="row row-harvest">
    <select name="h-variety" aria-label="Odrůda" style="flex:3">${harvestVarietyOptions(names, h.variety)}</select>
    <input name="h-kg" inputmode="decimal" placeholder="kg" value="${numVal(h.kg)}" aria-label="Množství (kg)">
    <input name="h-sugar" inputmode="decimal" placeholder="°NM" value="${numVal(h.sugar)}" aria-label="Cukernatost (°NM)">
    <button type="button" class="icon-btn" data-action="remove-row" aria-label="Odebrat">✕</button>
  </div>`;

export const harvestVarietyOptions = (names, selected = '') =>
  options(selected && !names.includes(selected) ? [...names, selected] : names, selected, { empty: '— celá vinice —' });

// Vinice vybrané v otevřeném formuláři práce (nová práce: zaškrtávátka, úprava: select).
export function formVineyardIds() {
  const sel = $('select[name=vineyardId]', form);
  return sel ? [sel.value] : $$('input[name=vineyards]:checked', form).map(c => c.value);
}

export function formVarietyNames() {
  const ids = formVineyardIds();
  if (ids.length !== 1) return [];
  return [...new Set((byId(db.vineyards, ids[0])?.varieties || []).map(x => x.name))];
}

export function refreshHarvestVarieties() {
  const names = formVarietyNames();
  $$('select[name=h-variety]', form).forEach(sel => { sel.innerHTML = harvestVarietyOptions(names, sel.value); });
  const ids = formVineyardIds();
  const date = $('[name=date]', form).value;
  const block = ids.length === 1 && date && phiInfo(ids[0], { at: date, excludeId: form.dataset.workId });
  $('#harvest-hint').textContent = ids.length > 1 ? 'Sklizeň zapisuj pro každou vinici zvlášť – vyber jen jednu.'
    : block && block.until > date ? `⚠ Ochranná lhůta běží do ${fmtDate(block.until)} (${block.product.name}).` : '';
}

// Vinice a pod nimi pozemky v přípravě (s označením).
export const workPlaces = () => [...sortVineyards(plantedVineyards()), ...sortVineyards(db.vineyards.filter(isPrep))];
export const placeName = v => (isPrep(v) ? `${vName(v)} (příprava)` : vName(v));

export function workForm(w, { copy = false, vineyardId = '', planned = false } = {}) {
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
        setYear(workYear);
        toast(`Uloženo do roku ${workYear} – přepínám na něj.`);
      }
    },
    onDelete: isNew ? null : () => {
      if (!confirm('Smazat tento záznam práce?')) return false;
      db.works = db.works.filter(x => x.id !== w.id);
    },
  });
}
