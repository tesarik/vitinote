// Pohyb na skladě přípravku: nákup (kladné množství) nebo oprava stavu po inventuře (záporné).
import { byId, esc, fmtNum, numVal, parseNum, toast, today, uid } from '../util.js';
import { db, stockOf } from '../data.js';
import { openForm } from '../dialog.js';

export function purchaseForm(m, productId) {
  const isNew = !m;
  m ||= { date: today(), productId };
  const prod = byId(db.products, m.productId);
  openForm({
    title: isNew ? `Nákup: ${prod?.name ?? ''}` : `Upravit nákup: ${prod?.name ?? '(smazaný)'}`,
    body: `
      <div class="grid2">
        <div class="field"><label>Datum *</label><input type="date" name="date" required value="${m.date}"></div>
        <div class="field"><label>Množství (${esc(prod?.unit ?? '')}) *</label><input name="qty" inputmode="decimal" value="${numVal(m.qty)}"
          placeholder="záporné = oprava stavu"></div>
      </div>
      <div class="field"><label>Cena celkem (Kč)</label><input name="price" inputmode="decimal" value="${numVal(m.price)}" placeholder="pro výpočet nákladů"></div>
      <div class="field"><label>Poznámka</label><input name="note" value="${esc(m.note)}" placeholder="dodavatel, faktura, inventura…"></div>
      ${isNew && prod ? `<p class="small muted">Aktuální zásoba: ${fmtNum(stockOf(prod.id))} ${esc(prod.unit)}</p>` : ''}`,
    onSubmit: get => {
      const qty = parseNum(get('qty'));
      if (!get('date') || !qty) { toast('Vyplň datum a množství.'); return false; }
      Object.assign(m, { date: get('date'), qty, price: parseNum(get('price')), note: get('note') });
      if (isNew) { m.id = uid(); db.purchases.push(m); toast(qty > 0 ? 'Nákup zapsán.' : 'Oprava stavu zapsána.'); }
    },
    onDelete: isNew ? null : () => {
      if (!confirm('Smazat tento záznam?')) return false;
      db.purchases = db.purchases.filter(x => x.id !== m.id);
    },
  });
}
