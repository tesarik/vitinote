// Formulář činnosti (číselník).
import { esc, options, toast, uid } from '../util.js';
import { ACTIVITY_KINDS, activityIdFor, db } from '../data.js';
import { openForm } from '../dialog.js';

export function activityForm(a) {
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
