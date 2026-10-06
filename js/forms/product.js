// Formulář přípravku včetně vyhledání v registru ÚKZÚZ.
import { $, esc, fmtDate, fmtNum, numVal, options, parseNum, toast, uid } from '../util.js';
import { PRODUCT_KINDS, db, productStatus } from '../data.js';
import { convertDose, findPor, loadRegistry, maxPhiDays, porFields, productKindFrom, registry, searchPor, useLabel } from '../registry-por.js';
import { form, openForm } from '../dialog.js';

// Přehled údajů z registru ve formuláři přípravku.
export function porInfoHtml(r) {
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

export function fillProductFromPor(r) {
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

export function productForm(p) {
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
