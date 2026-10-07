// Formulář stroje (traktor, postřikovač…): sazba za motohodinu pro výpočet nákladů.
import { esc, numVal, parseNum, toast, uid } from '../util.js';
import { db } from '../data.js';
import { openForm } from '../dialog.js';

export function machineForm(m) {
  const isNew = !m;
  m ||= {};
  openForm({
    title: isNew ? 'Nový stroj' : 'Upravit stroj',
    body: `
      <div class="field"><label>Název *</label><input name="name" required value="${esc(m.name)}" placeholder="např. Traktor Zetor, Postřikovač"></div>
      <div class="field"><label>Náklad na motohodinu (Kč/mth)</label><input name="rate" inputmode="decimal" value="${numVal(m.rate)}"
        placeholder="nafta, servis, odpisy…"></div>
      <div class="field"><label>Poznámka</label><textarea name="note">${esc(m.note)}</textarea></div>`,
    onSubmit: get => {
      if (!get('name')) { toast('Vyplň název.'); return false; }
      Object.assign(m, { name: get('name'), rate: parseNum(get('rate')), note: get('note') });
      if (isNew) { m.id = uid(); db.machines.push(m); toast('Stroj přidán.'); }
    },
    onDelete: isNew ? null : () => {
      if (!confirm(`Smazat stroj „${m.name}“? Motohodiny v zapsaných pracích zůstanou.`)) return false;
      db.machines = db.machines.filter(x => x.id !== m.id);
    },
  });
}
