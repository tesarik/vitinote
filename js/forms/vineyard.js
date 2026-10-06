// Formuláře vinice a pozemku v přípravě, vysazení, smazání.
import { $, $$, esc, numVal, parseNum, toast, today, uid } from '../util.js';
import { db, isPrep, placeLabel, vName, varietyNames } from '../data.js';
import { form, openForm } from '../dialog.js';

// Pole řádku odrůdy podle stavu: [klíč, popisek, číselné?]. Ostatní údaje (kód z registru, vedení…) se ve formuláři jen zachovají.
export const VARIETY_FIELDS = {
  planted: [['area', 'ha', true], ['year', 'rok', false]],
  preparation: [['area', 'ha', true], ['rootstock', 'podnož', false], ['vines', 'sazenic', true]],
};

export const varietyRow = (x = {}, stage = 'planted') => {
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

export function readVarietyRows() {
  return $$('.row-variety', form).map(r => {
    const x = JSON.parse(r.dataset.extra || '{}');
    x.name = $('[name=v-name]', r).value.trim();
    for (const input of $$('input[data-numeric]', r)) {
      x[input.name.slice(2)] = input.dataset.numeric === 'true' ? parseNum(input.value) : input.value.trim();
    }
    return x;
  }).filter(x => x.name);
}

export function vineyardForm(v, { stage = 'planted' } = {}) {
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
export function plantForm(v) {
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
export function deleteVineyard(v) {
  const n = db.works.filter(w => w.vineyardId === v.id).length;
  if (!confirm(n ? `Smazat ${placeLabel(v)} „${vName(v)}“ včetně ${n} záznamů prací?` : `Smazat ${placeLabel(v)} „${vName(v)}“?`)) return false;
  db.vineyards = db.vineyards.filter(x => x.id !== v.id);
  db.works = db.works.filter(w => w.vineyardId !== v.id);
  if (location.hash.includes(v.id)) location.hash = '#/vinice';
  toast(isPrep(v) ? 'Pozemek smazán.' : 'Vinice smazána.');
}
