// Formulář pracovníka.
import { esc, numVal, parseNum, toast, uid } from '../util.js';
import { db } from '../data.js';
import { openForm } from '../dialog.js';

export function workerForm(p) {
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
