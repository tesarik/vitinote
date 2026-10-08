// Akce tlačítek (data-action) a obsluha událostí ve stránce.
import { $, $$, byId, download, fmtDate, fmtNum, isPlanned, toast, toCsv, today } from './util.js';
import { activityName, db, emptyDb, EPPO_VINE, harvestKg, harvestSummary, inPeriod, isPrep, machineName, normalizeDb, productAmount, productsSummary, setDb, sortWorksDesc, treatedArea, vineyardName, vName, workerName, workHours } from './data.js';
import { save } from './storage.js';
import { findPor, loadRegistry, refreshLinkedProducts } from './registry-por.js';
import { setWorkersPeriod, setYear, workFilters } from './view-state.js';
import { render } from './views.js';
import { closeForm, dlg, form } from './dialog.js';
import { deleteVineyard, plantForm, varietyRow, vineyardForm } from './forms/vineyard.js';
import { workerForm } from './forms/worker.js';
import { activityForm } from './forms/activity.js';
import { fillProductFromPor, productForm } from './forms/product.js';
import { formVarietyNames, harvestRow, machineRow, productRow, workerRow, workForm } from './forms/work.js';
import { importRegistryPreview, parseRegistryXml } from './import-registr-vinic.js';
import { machineForm } from './forms/machine.js';
import { purchaseForm } from './forms/purchase.js';

export const actions = {
  'go': el => { location.hash = el.dataset.href; },
  'print': () => window.print(),
  'works-view': el => { workFilters.view = el.dataset.view; render(); },
  'set-year': el => { setYear(el.dataset.year); render(); },
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
      toast(`Aktualizace selhala: ${e.message}. Registr můžeš nahrát ze souboru (viz níže).`);
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
  'add-machine-row': () => $('#machine-rows').insertAdjacentHTML('beforeend', machineRow()),
  'new-purchase': el => purchaseForm(null, el.dataset.id),
  'edit-purchase': el => purchaseForm(byId(db.purchases, el.dataset.id)),
  'new-machine': () => machineForm(),
  'edit-machine': el => machineForm(byId(db.machines, el.dataset.id)),
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
    const rows = [['Datum od', 'Datum do', 'Stav', 'Vinice', 'Práce', 'Pracovníci', 'Hodiny celkem', 'Stroje', 'Přípravky', 'Sklizeň kg', 'Sklizeň po odrůdách', 'Poznámka']];
    for (const w of sortWorksDesc(db.works).reverse()) {
      if (!inPeriod(w, year)) continue;
      rows.push([
        w.date, w.dateTo ?? '', isPlanned(w) ? 'plán' : 'provedeno', vineyardName(w.vineyardId), activityName(w),
        (w.workers || []).map(e => `${workerName(e.workerId)} ${fmtNum(e.hours, 1)} h`).join(', '),
        workHours(w), (w.machines || []).map(e => `${machineName(e.machineId)} ${fmtNum(e.hours, 1)} mth`).join(', '),
        productsSummary(w), harvestKg(w) || '', harvestSummary(w), w.note,
      ]);
    }
    download(`vitinote-prace-${year}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  },
  'export-por': () => {
    const year = $('#export-year').value;
    // Sloupce pokrývají obsah záznamu podle prováděcího nařízení (EU) 2023/564 (příloha): přípravek a číslo povolení,
    // datum a čas zahájení, dávka na ha, místo (díl LPIS), ošetřená plocha, plodina s kódem EPPO, fenofáze BBCH.
    const rows = [['Datum od', 'Datum do', 'Čas zahájení', 'Vinice', 'Katastrální území', 'Kód DPB', 'Plodina', 'Kód EPPO', 'BBCH',
      'Ošetřená plocha (ha)', 'Přípravek / hnojivo', 'Reg. číslo (povolení)', 'Druh', 'Dávka na ha', 'Jednotka', 'Celkové množství',
      'Voda l/ha', 'Účel', 'Ochranná lhůta']];
    const missing = { regNo: 0, dpb: 0 };
    for (const w of sortWorksDesc(db.works).reverse()) {
      if (isPlanned(w) || !inPeriod(w, year)) continue;
      const v = byId(db.vineyards, w.vineyardId);
      for (const p of w.products || []) {
        const prod = byId(db.products, p.productId);
        if (prod?.kind !== 'Hnojivo') {
          if (!prod?.regNo) missing.regNo++;
          if (!v?.dpb) missing.dpb++;
        }
        rows.push([
          w.date, w.dateTo ?? '', w.startTime ?? '', v ? vName(v) : '', v?.ku ?? '', v?.dpb ?? '',
          isPrep(v) ? 'bez plodiny (příprava na výsadbu)' : 'réva vinná', isPrep(v) ? '' : EPPO_VINE, w.bbch ?? '',
          treatedArea(w), prod?.name ?? '(smazaný)', prod?.regNo ?? '', prod?.kind ?? '',
          p.dose ?? '', prod?.unit ?? '', Math.round(productAmount(w, p) * 1000) / 1000, w.water ?? '', p.pest || w.target,
          p.useId ? p.phi : (prod?.phiDays ?? ''),
        ]);
      }
    }
    if (rows.length === 1) { toast(`V roce ${year} nejsou žádná ošetření.`); return; }
    download(`vitinote-evidence-por-${year}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
    const gaps = [missing.regNo && `reg. číslo přípravku u ${missing.regNo}`, missing.dpb && `kód DPB vinice u ${missing.dpb}`].filter(Boolean);
    if (gaps.length) toast(`Export hotový, ale chybí ${gaps.join(' a ')} záznamů – doplň je u přípravků a vinic.`);
  },
  'wipe': () => {
    if (!confirm('Opravdu nevratně smazat všechna data? Doporučuji nejdřív stáhnout zálohu.')) return;
    setDb(emptyDb());
    save(); render();
    toast('Data smazána.');
  },
};

// Volá main.js po načtení stránky.
export function initActions() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || !actions[el.dataset.action]) return;
    // Tlačítka uvnitř klikatelného řádku nesmí spustit i akci řádku.
    e.stopPropagation();
    e.preventDefault();
    actions[el.dataset.action](el);
  });

  $('#year').addEventListener('change', e => { setYear(e.target.value); render(); });

  // Zavření dialogu klepnutím mimo něj.
  dlg.addEventListener('click', e => { if (e.target === dlg) closeForm(); });

  // Vyhledávání při psaní: překreslit seznam a vrátit kurzor do pole.
  let searchTimer;
  $('#main').addEventListener('input', e => {
    if (e.target.dataset.filter !== 'q') return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      workFilters.q = e.target.value;
      render();
      const input = $('[data-filter=q]');
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }, 200);
  });

  $('#main').addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.filter === 'workersPeriod') {
      setWorkersPeriod(t.value);
      render();
    } else if (t.dataset.filter) {
      workFilters[t.dataset.filter] = t.value;
      render();
    } else if (t.matches('[data-por-upload]') && t.files[0]) {
      t.files[0].text().then(async body => {
        const res = await fetch('api/por/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        const info = await res.json();
        if (!res.ok) throw new Error(info.error || 'HTTP ' + res.status);
        await loadRegistry(true);
        const n = refreshLinkedProducts();
        if (n) save();
        render();
        toast(`Registr nahrán (${fmtDate(info.updated)}): ${info.count} přípravků pro révu${n ? `, obnoveno ${n} tvých přípravků` : ''}.`);
      }).catch(err => toast('Nahrání registru selhalo: ' + err.message))
        .finally(() => { t.value = ''; });
    } else if (t.matches('[data-import-rv]') && t.files[0]) {
      t.files[0].text().then(text => importRegistryPreview(parseRegistryXml(text)))
        .catch(err => toast('Import selhal: ' + err.message))
        .finally(() => { t.value = ''; });
    } else if (t.matches('[data-import]') && t.files[0]) {
      t.files[0].text().then(text => {
        const data = JSON.parse(text);
        if (data?.version !== 1 || !Array.isArray(data.works)) throw new Error('neplatný formát');
        if (!confirm(`Nahradit současná data zálohou (${data.vineyards.length} vinic, ${data.works.length} prací)?`)) return;
        setDb(normalizeDb(data));
        save(); render();
        toast('Záloha obnovena.');
      }).catch(err => toast('Import selhal: ' + err.message))
        .finally(() => { t.value = ''; });
    }
  });
}
