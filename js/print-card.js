// Karta vinice k tisku / uložení do PDF (#/tisk/<id>): údaje, odrůdy, práce, ošetření, sklizeň a náklady za vybraný rok.
import { addDays, byId, esc, fmtDate, fmtNum, isPlanned, today } from './util.js';
import {
  db, EPPO_VINE, isPrep, machineName, phiInfo, productAmount, rowPhiDays, sortWorksDesc, treatedArea, vName,
  activityName, vineyardCosts, workEnd, workerName, fmtWorkDate,
} from './data.js';
import { inYear, selectedYear } from './view-state.js';
import { renderHarvestByVariety } from './views.js';

const kc = n => `${fmtNum(n, 0)} Kč`;

export function renderPrintCard(id) {
  const v = byId(db.vineyards, id);
  if (!v) return '<p class="empty">Vinice nenalezena. <a href="#/vinice">Zpět</a></p>';
  const works = sortWorksDesc(db.works.filter(w => w.vineyardId === id && !isPlanned(w) && inYear(w))).reverse();
  const sprays = works.flatMap(w => (w.products || []).map(p => ({ w, p, prod: byId(db.products, p.productId) })));
  const costs = vineyardCosts(id, selectedYear);
  const phi = phiInfo(id);
  const info = [
    ['Výchozí název', v.alias ? v.name : ''], ['Výměra', v.area ? `${fmtNum(v.area, 4)} ha` : ''],
    ['Reg. číslo', v.regNo], ['Kód DPB', v.dpb], ['Katastrální území', v.ku], ['Parcely', v.parcels],
    ['Výsadba', v.plantedDate ? fmtDate(v.plantedDate) : v.plantedYear], ['Plánovaná výsadba', isPrep(v) ? v.plannedPlanting : ''],
    ['Plodina', isPrep(v) ? 'příprava na výsadbu' : `réva vinná (EPPO ${EPPO_VINE})`],
  ].filter(([, value]) => value);

  return `
    <div class="print-card">
      <div class="page-head no-print">
        <a href="#/vinice/${v.id}">← Zpět na vinici</a>
        <button class="btn primary" data-action="print">Vytisknout / uložit PDF</button>
      </div>
      <header class="print-head">
        <h1>${esc(vName(v))}${isPrep(v) ? ' <span class="badge planned">v přípravě na výsadbu</span>' : ''}</h1>
        <p class="muted">Karta vinice · rok ${selectedYear} · vytištěno ${fmtDate(today())}</p>
      </header>

      <section class="card">
        <dl class="kv">${info.map(([k, val]) => `<dt>${k}</dt><dd>${esc(val)}</dd>`).join('')}</dl>
        ${v.varieties?.length ? `
        <h3>${isPrep(v) ? 'Plánované odrůdy' : 'Odrůdy'}</h3>
        <table>
          <thead><tr><th>Odrůda</th><th class="num">ha</th><th>Rok výsadby</th><th>Podnož</th><th class="num">Keřů</th></tr></thead>
          <tbody>${v.varieties.map(x => `<tr><td>${esc(x.name)}</td><td class="num">${x.area ? fmtNum(x.area, 4) : ''}</td>
            <td>${esc(x.year)}</td><td>${esc(x.rootstock)}</td><td class="num">${x.vines ? fmtNum(x.vines, 0) : ''}</td></tr>`).join('')}</tbody>
        </table>` : ''}
      </section>

      <section class="card">
        <h2>Práce ${selectedYear}</h2>
        ${works.length ? `<table>
          <thead><tr><th>Datum</th><th>Činnost</th><th>Lidé</th><th>Stroje</th><th>Poznámka</th></tr></thead>
          <tbody>${works.map(w => `<tr>
            <td>${esc(fmtWorkDate(w))}</td><td>${esc(activityName(w))}</td>
            <td>${esc((w.workers || []).map(e => `${workerName(e.workerId)} ${fmtNum(e.hours, 1)} h`).join(', '))}</td>
            <td>${esc((w.machines || []).map(e => `${machineName(e.machineId)} ${fmtNum(e.hours, 1)} mth`).join(', '))}</td>
            <td>${esc(w.note)}</td></tr>`).join('')}</tbody>
        </table>` : '<p class="muted">Žádné provedené práce.</p>'}
      </section>

      <section class="card">
        <h2>Ošetření ${selectedYear}</h2>
        ${sprays.length ? `<table>
          <thead><tr><th>Datum</th><th>Přípravek</th><th>Reg. č.</th><th class="num">Dávka/ha</th><th class="num">Plocha ha</th>
            <th class="num">Celkem</th><th>Účel</th><th>BBCH</th><th>OL do</th></tr></thead>
          <tbody>${sprays.map(({ w, p, prod }) => {
            const days = rowPhiDays(p, prod);
            return `<tr>
              <td>${esc(fmtWorkDate(w))}${w.startTime ? ` ${esc(w.startTime)}` : ''}</td><td>${esc(prod?.name ?? '(smazaný)')}</td><td>${esc(prod?.regNo)}</td>
              <td class="num">${fmtNum(p.dose)} ${esc(prod?.unit)}</td><td class="num">${fmtNum(treatedArea(w), 4)}</td>
              <td class="num">${fmtNum(productAmount(w, p))} ${esc(prod?.unit)}</td><td>${esc(p.pest || w.target)}</td>
              <td>${w.bbch ?? ''}</td><td>${days > 0 ? fmtDate(addDays(workEnd(w), days)) : ''}</td></tr>`;
          }).join('')}</tbody>
        </table>
        <p class="small muted">${phi && phi.until > today() ? `Ochranná lhůta běží do ${fmtDate(phi.until)}.` : 'Žádná ochranná lhůta neběží.'}</p>`
        : '<p class="muted">Žádná ošetření.</p>'}
      </section>

      ${renderHarvestByVariety(v, works)}

      ${costs.total ? `
      <section class="card">
        <h2>Náklady ${selectedYear}</h2>
        <dl class="kv">
          <dt>Lidé</dt><dd>${kc(costs.labour)}</dd><dt>Stroje</dt><dd>${kc(costs.machines)}</dd>
          <dt>Přípravky</dt><dd>${kc(costs.products)}</dd>
          <dt><strong>Celkem</strong></dt><dd><strong>${kc(costs.total)}</strong>${v.area ? ` (${kc(costs.total / v.area)}/ha)` : ''}</dd>
        </dl>
      </section>` : ''}
    </div>`;
}
