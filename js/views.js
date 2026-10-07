// Stránky aplikace (render* vrací HTML) a router podle location.hash.
import { $, $$, addDays, byId, daysBetween, esc, fmtDate, fmtMonth, fmtNum, fold, isoWeek, isPlanned, options, sortByName, thisMonth, today, weekday, WEEKDAYS } from './util.js';
import { ACTIVITY_KINDS, activityName, db, fmtWorkDate, harvestKg, harvestSummary, inPeriod, isPrep, machineName, periodRange, periodShare, phiInfo, placeName, plantedVineyards, productAmount, productsSummary, productStatus, sortVineyards, sortWorksDesc, stockOf, unitPrice, varietyNames, vineyardCosts, vineyardName, vName, workEnd, workerName, workHours, workSearchText } from './data.js';
import { sync } from './storage.js';
import { registry } from './registry-por.js';
import { availableYears, currentYear, inYear, monthOptions, selectedYear, workFilters, workersPeriod, yearLabel } from './view-state.js';

export function workItem(w, { showVineyard = true } = {}) {
  const hours = workHours(w);
  const people = (w.workers || []).map(e => workerName(e.workerId)).join(', ');
  const meta = [
    fmtWorkDate(w),
    hours ? `${fmtNum(hours, 1)} h${people ? ` (${esc(people)})` : ''}` : (people ? esc(people) : ''),
    (w.machines || []).length ? esc(w.machines.map(e => `${machineName(e.machineId)} ${fmtNum(e.hours, 1)} mth`).join(', ')) : '',
    w.products?.length ? esc(productsSummary(w)) : '',
    w.treatedArea != null ? `ošetřeno ${fmtNum(w.treatedArea, 4)} ha` : '',
    w.bbch != null ? `BBCH ${w.bbch}` : '',
    w.harvest?.length ? esc(harvestSummary(w)) : '',
  ].filter(Boolean).join(' · ');
  return `
    <li class="item" data-action="edit-work" data-id="${w.id}">
      <div class="item-main">
        <div class="item-title">
          <span class="badge${isPlanned(w) ? ' planned' : ''}">${esc(activityName(w))}${isPlanned(w) ? ' · plán' : ''}</span>
          ${showVineyard ? esc(vineyardName(w.vineyardId)) : ''}
        </div>
        <div class="item-meta">${meta}</div>
        ${w.note ? `<div class="item-note">${esc(w.note)}</div>` : ''}
      </div>
      <div class="item-actions">
        ${isPlanned(w)
          ? `<button class="btn sm ok" data-action="complete-work" data-id="${w.id}" title="Označit jako provedené dnes">✓ Hotovo</button>`
          : `<button class="btn sm" data-action="copy-work" data-id="${w.id}" title="Zapsat stejnou práci znovu">Kopie</button>`}
      </div>
    </li>`;
}

export const workList = (works, opts) => works.length
  ? `<ul class="list">${works.map(w => workItem(w, opts)).join('')}</ul>`
  : `<p class="empty">Žádné záznamy.</p>`;

export function renderYearSelect() {
  const sel = $('#year');
  sel.innerHTML = availableYears().map(y => `<option${y === selectedYear ? ' selected' : ''}>${y}</option>`).join('');
  sel.classList.toggle('past', selectedYear !== currentYear());
}

export function renderDashboard() {
  const t = today();
  const done = db.works.filter(w => !isPlanned(w));
  const planned = db.works.filter(isPlanned).sort((a, b) => a.date.localeCompare(b.date));
  const area = plantedVineyards().reduce((s, v) => s + (+v.area || 0), 0);
  const prep = db.vineyards.filter(isPrep);
  const isCurrent = selectedYear === currentYear();
  // Letos: hodiny za aktuální měsíc; v minulých letech za celý rok.
  const hoursShown = done.reduce((s, w) => s + workHours(w) * periodShare(w, isCurrent ? thisMonth() : selectedYear), 0);
  const worksYear = done.filter(inYear).length;
  const phi = sortVineyards(db.vineyards)
    .map(v => ({ v, info: phiInfo(v.id) }))
    .filter(x => x.info && x.info.until > t);

  if (!db.vineyards.length) {
    return `
      <div class="card empty">
        <h2>Vítej ve VitiNote 🍇</h2>
        <p>Začni tím, že přidáš své vinice. Pak můžeš zapisovat práce, postřiky a odpracované hodiny.</p>
        <button class="btn primary" data-action="new-vineyard">+ Přidat vinici</button>
        <button class="btn" data-action="new-worker">+ Přidat pracovníka</button>
        <button class="btn" data-action="new-product">+ Přidat přípravek</button>
      </div>`;
  }

  return `
    <div class="stats">
      <div class="stat"><div class="v">${plantedVineyards().length}</div><div class="l">vinic</div></div>
      <div class="stat"><div class="v">${fmtNum(area)} ha</div><div class="l">celková výměra vinic</div></div>
      ${prep.length ? `<div class="stat"><div class="v">${prep.length}</div><div class="l">pozemků v přípravě (${fmtNum(prep.reduce((s, v) => s + (+v.area || 0), 0))} ha)</div></div>` : ''}
      <div class="stat"><div class="v">${fmtNum(hoursShown, 1)} h</div><div class="l">odpracováno ${isCurrent ? 'tento měsíc' : yearLabel()}</div></div>
      <div class="stat"><div class="v">${worksYear}</div><div class="l">prací ${yearLabel()}</div></div>
    </div>

    ${phi.length ? `
    <div class="card">
      <h2>Běžící ochranné lhůty</h2>
      <ul class="list">
        ${phi.map(({ v, info }) => `
          <li class="item" data-action="go" data-href="#/vinice/${v.id}">
            <div class="item-main">
              <div class="item-title">${esc(vName(v))} <span class="badge warn">ještě ${daysBetween(t, info.until)} dní</span></div>
              <div class="item-meta">sklizeň možná od ${fmtDate(info.until)} · ${esc(info.product.name)} (${fmtDate(info.date)})</div>
            </div>
          </li>`).join('')}
      </ul>
    </div>` : ''}

    <div class="card">
      <div class="page-head"><h2>Naplánováno</h2><button class="btn sm" data-action="new-work" data-planned="1">+ Naplánovat</button></div>
      ${workList(planned)}
    </div>

    <div class="card">
      <div class="page-head"><h2>${isCurrent ? 'Poslední práce' : `Poslední práce ${selectedYear}`}</h2><a href="#/prace">Všechny →</a></div>
      ${workList(sortWorksDesc(done.filter(inYear)).slice(0, 10))}
    </div>`;
}

export function renderWorks() {
  const f = workFilters;
  const period = f.month ? `${selectedYear}-${f.month}` : selectedYear;
  const works = sortWorksDesc(db.works.filter(w =>
    (!f.vineyardId || w.vineyardId === f.vineyardId) &&
    (!f.activityId || w.activityId === f.activityId) &&
    inPeriod(w, period) &&
    (!f.status || (f.status === 'planned') === isPlanned(w)) &&
    (!f.q || fold(f.q).split(/\s+/).every(word => workSearchText(w).includes(word)))
  ));
  const hours = works.filter(w => !isPlanned(w)).reduce((s, w) => s + workHours(w) * periodShare(w, period), 0);
  return `
    <div class="page-head">
      <h1>Práce ${selectedYear}</h1>
      <div class="actions-row">
        <div class="segmented" role="group" aria-label="Zobrazení">
          <button class="btn sm${f.view === 'list' ? ' active' : ''}" data-action="works-view" data-view="list">Seznam</button>
          <button class="btn sm${f.view === 'calendar' ? ' active' : ''}" data-action="works-view" data-view="calendar">Kalendář</button>
        </div>
        <button class="btn primary" data-action="new-work">+ Zapsat práci</button>
      </div>
    </div>
    <input type="search" class="search" data-filter="q" value="${esc(f.q)}" aria-label="Hledat v pracích"
      placeholder="Hledat: poznámka, přípravek, škůdce, pracovník…">
    <div class="filters">
      <select data-filter="vineyardId">${options(sortVineyards(db.vineyards).map(v => ({ id: v.id, name: vName(v) })), f.vineyardId, { empty: 'Všechny vinice' })}</select>
      <select data-filter="activityId">${options(db.activities, f.activityId, { empty: 'Všechny činnosti' })}</select>
      <select data-filter="month" aria-label="Měsíc">${monthOptions(f.month, 'Celý rok')}</select>
      <select data-filter="status">${options([{ id: 'done', name: 'Provedené' }, { id: 'planned', name: 'Plánované' }], f.status, { empty: 'Provedené i plánované' })}</select>
    </div>
    <p class="muted small" data-q="${esc(f.q)}">${works.length} záznamů · ${fmtNum(hours, 1)} odpracovaných hodin</p>
    ${f.view === 'calendar' ? renderWorksCalendar(works, period) : `<div class="card">${workList(works)}</div>`}`;
}

// Kalendář po týdnech: u vybraného měsíce všechny týdny, u celého roku jen týdny s prací.
// Vícedenní práce je v každém dni, kterého se týká.
function renderWorksCalendar(works, period) {
  const [from, to] = periodRange(period);
  const t = today();
  const weeks = new Map();
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const dayWorks = works.filter(w => w.date <= day && workEnd(w) >= day);
    if (!dayWorks.length && period.length === 4) continue;
    const monday = addDays(day, -weekday(day));
    if (!weeks.has(monday)) weeks.set(monday, []);
    weeks.get(monday).push({ day, dayWorks });
  }
  if (!weeks.size) return '<div class="card"><p class="empty">Žádné záznamy.</p></div>';
  return [...weeks].map(([monday, days]) => `
    <div class="card cal-week">
      <h3>${isoWeek(monday)}. týden <span class="muted small">${fmtDate(monday)} – ${fmtDate(addDays(monday, 6))}</span></h3>
      ${days.map(({ day, dayWorks }) => `
        <div class="cal-day${day === t ? ' today' : ''}${weekday(day) > 4 ? ' weekend' : ''}">
          <div class="cal-date">${WEEKDAYS[weekday(day)]} ${fmtDate(day).replace(/ \d{4}$/, '')}</div>
          <div class="cal-works">${dayWorks.length ? dayWorks.map(w => `
            <button class="chip${isPlanned(w) ? ' planned' : ''}" data-action="edit-work" data-id="${w.id}" title="${esc(fmtWorkDate(w))}">
              <strong>${esc(activityName(w))}</strong> ${esc(vineyardName(w.vineyardId))}${workHours(w) ? ` · ${fmtNum(workHours(w), 1)} h` : ''}${w.dateTo ? ' ↔' : ''}
            </button>`).join('') : '<span class="muted small">–</span>'}</div>
        </div>`).join('')}
    </div>`).join('');
}

export function renderVineyards() {
  const t = today();
  const row = v => {
    const works = db.works.filter(w => w.vineyardId === v.id && !isPlanned(w));
    const last = sortWorksDesc(works)[0];
    const hours = works.reduce((s, w) => s + workHours(w) * periodShare(w, selectedYear), 0);
    const phi = phiInfo(v.id);
    return `
      <li class="item" data-action="go" data-href="#/vinice/${v.id}">
        <div class="item-main">
          <div class="item-title">${esc(vName(v))} ${phi && phi.until > t ? `<span class="badge warn">OL do ${fmtDate(phi.until)}</span>` : ''}</div>
          ${v.alias ? `<div class="item-sub">${esc(v.name)}</div>` : ''}
          <div class="item-meta">${[
            v.area ? `${fmtNum(v.area, 4)} ha` : '',
            isPrep(v) && v.plannedPlanting ? `výsadba ${esc(fmtMonth(v.plannedPlanting))}` : '',
            esc(varietyNames(v)),
            v.regNo ? `reg. č. ${esc(v.regNo)}` : '',
            v.dpb ? `DPB ${esc(v.dpb)}` : '',
            isPrep(v) && v.parcels ? `parc. ${esc(v.parcels)}` : '',
          ].filter(Boolean).join(' · ')}</div>
          <div class="item-meta">${last ? `naposledy: ${esc(activityName(last))} ${fmtWorkDate(last)}` : 'zatím bez prací'} · ${yearLabel()} ${fmtNum(hours, 1)} h</div>
        </div>
      </li>`;
  };
  const planted = sortVineyards(plantedVineyards()).map(row).join('');
  const prep = sortVineyards(db.vineyards.filter(isPrep)).map(row).join('');
  return `
    <div class="page-head">
      <h1>Vinice</h1>
      <button class="btn primary" data-action="new-vineyard">+ Přidat vinici</button>
    </div>
    <div class="card">${planted ? `<ul class="list">${planted}</ul>` : '<p class="empty">Zatím žádné vinice.</p>'}</div>
    <div class="card">
      <div class="page-head"><h2>V přípravě na výsadbu</h2><button class="btn sm" data-action="new-prep">+ Pozemek v přípravě</button></div>
      ${prep ? `<ul class="list">${prep}</ul>` : '<p class="small muted">Pozemky, které připravuješ k výsadbě. Zapisuješ k nim práce a po výsadbě je jedním tlačítkem změníš na vinici.</p>'}
    </div>
    ${renderCostsTable()}`;
}

// Náklady všech vinic a pozemků za vybraný rok.
function renderCostsTable() {
  const rows = [...sortVineyards(plantedVineyards()), ...sortVineyards(db.vineyards.filter(isPrep))]
    .map(v => ({ v, c: vineyardCosts(v.id, selectedYear) }))
    .filter(({ c }) => c.total);
  if (!rows.length) return '';
  const sum = k => rows.reduce((s, { c }) => s + c[k], 0);
  const area = rows.reduce((s, { v }) => s + (+v.area || 0), 0);
  const kc = n => fmtNum(n, 0);
  return `
    <div class="card">
      <h2>Náklady ${selectedYear}</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Vinice</th><th class="num">Lidé</th><th class="num">Stroje</th><th class="num">Přípravky</th><th class="num">Celkem Kč</th><th class="num">Kč/ha</th></tr></thead>
        <tbody>${rows.map(({ v, c }) => `
          <tr data-action="go" data-href="#/vinice/${v.id}" style="cursor:pointer">
            <td>${esc(placeName(v))}</td><td class="num">${kc(c.labour)}</td><td class="num">${kc(c.machines)}</td><td class="num">${kc(c.products)}</td>
            <td class="num"><strong>${kc(c.total)}</strong></td><td class="num">${v.area ? kc(c.total / v.area) : '–'}</td>
          </tr>`).join('')}</tbody>
        <tfoot><tr><td>Celkem</td><td class="num">${kc(sum('labour'))}</td><td class="num">${kc(sum('machines'))}</td><td class="num">${kc(sum('products'))}</td>
          <td class="num">${kc(sum('total'))}</td><td class="num">${area ? kc(sum('total') / area) : '–'}</td></tr></tfoot>
      </table></div>
    </div>`;
}

export function renderVineyardDetail(id) {
  const v = byId(db.vineyards, id);
  if (!v) return `<p class="empty">Vinice nenalezena. <a href="#/vinice">Zpět</a></p>`;
  const t = today();
  const allWorks = db.works.filter(w => w.vineyardId === id);
  const works = sortWorksDesc(allWorks.filter(inYear));
  const doneYear = works.filter(w => !isPlanned(w));
  const hours = doneYear.reduce((s, w) => s + workHours(w) * periodShare(w, selectedYear), 0);
  const sprays = doneYear.filter(w => w.products?.length).length;
  const harvest = doneYear.reduce((s, w) => s + harvestKg(w), 0);
  const costs = vineyardCosts(v.id, selectedYear);
  const harvestTable = renderHarvestByVariety(v, doneYear) + renderHarvestByYear(v, allWorks);
  const phi = phiInfo(id);

  return `
    <p><a href="#/vinice">← Vinice</a></p>
    <div class="page-head">
      <div>
        <h1>${esc(vName(v))} ${isPrep(v) ? '<span class="badge planned">v přípravě na výsadbu</span>' : ''}</h1>
        ${v.alias ? `<p class="subtitle">${esc(v.name)}</p>` : ''}
      </div>
      <div class="actions-row">
        <button class="btn danger" data-action="delete-vineyard" data-id="${v.id}">Smazat</button>
        <button class="btn" data-action="edit-vineyard" data-id="${v.id}">Upravit</button>
        ${isPrep(v) ? `<button class="btn ok" data-action="plant-vineyard" data-id="${v.id}">Vysadit</button>` : ''}
        <button class="btn primary" data-action="new-work" data-vineyard="${v.id}">+ Práce</button>
      </div>
    </div>
    <div class="card">
      <dl class="kv">
        ${v.area ? `<dt>Výměra</dt><dd>${fmtNum(v.area, 4)} ha</dd>` : ''}
        ${isPrep(v) ? `<dt>Plánovaná výsadba</dt><dd>${v.plannedPlanting ? esc(fmtMonth(v.plannedPlanting)) : '–'}</dd>` : ''}
        ${v.varieties?.length ? `<dt>${isPrep(v) ? 'Plánované odrůdy' : v.varieties.length > 1 ? 'Odrůdy' : 'Odrůda'}</dt><dd>${v.varieties
          .map(x => esc(x.name) + ` <span class="muted small">${[
            x.year, x.area ? `${fmtNum(x.area, 4)} ha` : '', x.rootstock ? `podnož ${x.rootstock}` : '',
            x.vines ? `${fmtNum(x.vines, 0)} ${isPrep(v) ? 'sazenic' : 'keřů'}` : '',
          ].filter(Boolean).map(esc).join(' · ')}</span>`).join('<br>')}</dd>` : ''}
        ${v.plantedDate ? `<dt>Výsadba</dt><dd>${fmtDate(v.plantedDate)}</dd>` : v.plantedYear ? `<dt>Výsadba</dt><dd>${esc(v.plantedYear)}</dd>` : ''}
        ${v.parcels ? `<dt>Parcely</dt><dd>${esc(v.parcels)}</dd>` : ''}
        ${v.regNo ? `<dt>Reg. číslo</dt><dd>${esc(v.regNo)}</dd>` : ''}
        ${v.ku ? `<dt>Katastr</dt><dd>${esc(v.ku)}</dd>` : ''}
        ${v.dpb ? `<dt>Kód DPB</dt><dd>${esc(v.dpb)}</dd>` : ''}
        <dt>Ochranná lhůta</dt><dd>${phi && phi.until > t
          ? `<span class="badge warn">do ${fmtDate(phi.until)}</span> <span class="small muted">${esc(phi.product.name)}</span>`
          : '<span class="badge ok">žádná neběží</span>'}</dd>
        ${v.note ? `<dt>Poznámka</dt><dd style="white-space:pre-wrap">${esc(v.note)}</dd>` : ''}
      </dl>
    </div>
    <div class="stats">
      <div class="stat"><div class="v">${fmtNum(hours, 1)} h</div><div class="l">odpracováno ${yearLabel()}</div></div>
      <div class="stat"><div class="v">${sprays}</div><div class="l">ošetření ${yearLabel()}</div></div>
      ${harvest ? `<div class="stat"><div class="v">${fmtNum(harvest, 0)} kg</div><div class="l">sklizeno ${yearLabel()}${v.area ? ` (${fmtNum(harvest / v.area / 1000)} t/ha)` : ''}</div></div>` : ''}
      ${costs.total ? `<div class="stat"><div class="v">${fmtNum(costs.total, 0)} Kč</div><div class="l">náklady ${yearLabel()}${v.area ? ` (${fmtNum(costs.total / v.area, 0)} Kč/ha)` : ''}<br>
        lidé ${fmtNum(costs.labour, 0)} · stroje ${fmtNum(costs.machines, 0)} · přípravky ${fmtNum(costs.products, 0)}</div></div>` : ''}
    </div>
    ${costs.unpriced ? `<p class="small muted">Do nákladů nejsou započteny položky bez sazby nebo ceny (${costs.unpriced}×) – doplň sazby lidí a strojů a ceny přípravků.</p>` : ''}
    ${harvestTable}
    <div class="card">
      <h2>Práce ${selectedYear}</h2>
      ${workList(works, { showVineyard: false })}
    </div>`;
}

// Sklizeň vinice ve vybraném roce po odrůdách: kg, t/ha (z plochy odrůdy) a průměrná cukernatost vážená množstvím.
export function renderHarvestByVariety(v, works) {
  const rows = new Map();
  for (const w of works) {
    for (const h of w.harvest || []) {
      const r = rows.get(h.variety) ?? { kg: 0, sugarKg: 0, sugarBase: 0 };
      r.kg += +h.kg || 0;
      if (h.sugar && h.kg) { r.sugarKg += h.sugar * h.kg; r.sugarBase += +h.kg; }
      rows.set(h.variety, r);
    }
  }
  if (!rows.size) return '';
  const areaOf = name => (v.varieties || []).filter(x => x.name === name).reduce((s, x) => s + (+x.area || 0), 0);
  const body = [...rows].sort(([a], [b]) => a.localeCompare(b, 'cs')).map(([name, r]) => {
    const area = name ? areaOf(name) : (+v.area || 0);
    return `<tr>
      <td>${esc(name || 'celá vinice')}</td>
      <td class="num">${fmtNum(r.kg, 0)}</td>
      <td class="num">${area && r.kg ? fmtNum(r.kg / area / 1000) : '–'}</td>
      <td class="num">${r.sugarBase ? fmtNum(r.sugarKg / r.sugarBase, 1) : '–'}</td>
    </tr>`;
  }).join('');
  return `
    <div class="card">
      <h2>Sklizeň ${selectedYear}</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Odrůda</th><th class="num">kg</th><th class="num">t/ha</th><th class="num">°NM</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>
    </div>`;
}

// Srovnání ročníků: celková sklizeň vinice po letech (zobrazí se, až jsou data aspoň ze dvou let).
export function renderHarvestByYear(v, works) {
  const years = new Map();
  for (const w of works) {
    if (isPlanned(w) || !w.harvest?.length) continue;
    const r = years.get(w.date.slice(0, 4)) ?? { kg: 0, sugarKg: 0, sugarBase: 0 };
    for (const h of w.harvest) {
      r.kg += +h.kg || 0;
      if (h.sugar && h.kg) { r.sugarKg += h.sugar * h.kg; r.sugarBase += +h.kg; }
    }
    years.set(w.date.slice(0, 4), r);
  }
  if (years.size < 2) return '';
  const body = [...years].sort(([a], [b]) => b.localeCompare(a)).map(([y, r]) => `
    <tr${y === selectedYear ? ' class="current"' : ''}>
      <td><a href="#" data-action="set-year" data-year="${y}">${y}</a></td>
      <td class="num">${fmtNum(r.kg, 0)}</td>
      <td class="num">${v.area && r.kg ? fmtNum(r.kg / v.area / 1000) : '–'}</td>
      <td class="num">${r.sugarBase ? fmtNum(r.sugarKg / r.sugarBase, 1) : '–'}</td>
    </tr>`).join('');
  return `
    <div class="card">
      <h2>Sklizeň po letech</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Rok</th><th class="num">kg</th><th class="num">t/ha</th><th class="num">°NM</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>
    </div>`;
}

export function renderProducts() {
  const used = {};
  for (const w of db.works) {
    if (isPlanned(w) || !inYear(w)) continue;
    for (const p of w.products || []) used[p.productId] = (used[p.productId] || 0) + productAmount(w, p) * periodShare(w, selectedYear);
  }
  const rows = sortByName(db.products).map(p => {
    const status = productStatus(p);
    return `
    <li class="item" data-action="edit-product" data-id="${p.id}">
      <div class="item-main">
        <div class="item-title">${esc(p.name)} <span class="badge">${esc(p.kind)}</span>
          ${status ? `<span class="badge ${status.level}">${esc(status.text)}</span>` : ''}</div>
        <div class="item-meta">${[
          p.regNo ? `reg. č. ${esc(p.regNo)}` : '',
          p.uses?.length ? `${p.uses.length} povolených použití` : '',
          p.phiDays ? `OL až ${p.phiDays} dní` : 'bez OL',
          p.defaultDose ? `obvyklá dávka ${fmtNum(p.defaultDose)} ${esc(p.unit)}/ha` : '',
          `${yearLabel()} spotřebováno ${fmtNum(used[p.id] || 0)} ${esc(p.unit)}`,
          unitPrice(p) ? `${fmtNum(unitPrice(p))} Kč/${esc(p.unit)}` : '',
        ].filter(Boolean).join(' · ')}</div>
        ${p.note ? `<div class="item-note">${esc(p.note)}</div>` : ''}
      </div>
      <div class="item-actions">
        <span class="stock${stockOf(p.id) < 0 ? ' negative' : ''}" title="Zásoba: nákupy minus spotřeba">${fmtNum(stockOf(p.id))} ${esc(p.unit)}</span>
        <button class="btn sm" data-action="new-purchase" data-id="${p.id}">+ Nákup</button>
      </div>
    </li>`;
  }).join('');
  return `
    <div class="page-head">
      <h1>Přípravky a hnojiva</h1>
      <button class="btn primary" data-action="new-product">+ Přidat</button>
    </div>
    <div class="card">${rows ? `<ul class="list">${rows}</ul>` : '<p class="empty">Zatím žádné přípravky.</p>'}</div>
    ${renderPurchases()}
    <div class="card">
      <h2>Registr přípravků ÚKZÚZ</h2>
      <p class="small muted">${registry
        ? `Staženo ${fmtDate(registry.updated)}: ${registry.products.length} povolených přípravků pro révu.`
        : 'Registr zatím není stažený (potřebuje běžící server).'}
        Při přidání přípravku ho vyhledáš v registru a doplní se registrační číslo, povolená použití, dávky a ochranné lhůty.</p>
      <button class="btn" data-action="update-registry"${sync.state === 'local' ? ' disabled' : ''}>Aktualizovat z registru</button>
    </div>`;
}

function renderPurchases() {
  const list = db.purchases.filter(m => m.date.startsWith(selectedYear)).sort((a, b) => b.date.localeCompare(a.date));
  const body = list.map(m => {
    const prod = byId(db.products, m.productId);
    return `
      <tr data-action="edit-purchase" data-id="${m.id}" style="cursor:pointer">
        <td>${fmtDate(m.date)}</td>
        <td>${esc(prod?.name ?? '(smazaný)')}${m.note ? `<div class="small muted">${esc(m.note)}</div>` : ''}</td>
        <td class="num">${fmtNum(m.qty)} ${esc(prod?.unit ?? '')}</td>
        <td class="num">${m.price ? `${fmtNum(m.price, 0)} Kč` : '–'}</td>
      </tr>`;
  }).join('');
  return `
    <div class="card">
      <h2>Nákupy ${selectedYear}</h2>
      ${body ? `<div class="table-wrap"><table>
        <thead><tr><th>Datum</th><th>Přípravek</th><th class="num">Množství</th><th class="num">Cena</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><td colspan="3">Celkem</td><td class="num">${fmtNum(list.reduce((s, m) => s + (+m.price || 0), 0), 0)} Kč</td></tr></tfoot>
      </table></div>` : `<p class="small muted">Nákup zapíšeš tlačítkem „+ Nákup“ u přípravku. Zásoba = nákupy minus spotřeba v postřicích;
        po inventuře zapiš rozdíl jako záporné množství.</p>`}
    </div>`;
}

export function renderWorkers() {
  const prefix = workersPeriod ? `${selectedYear}-${workersPeriod}` : selectedYear;
  const stats = {};
  for (const w of db.works) {
    const share = periodShare(w, prefix);
    if (isPlanned(w) || !share) continue;
    for (const e of w.workers || []) {
      const s = stats[e.workerId] ??= { hours: 0, byType: {} };
      const h = (+e.hours || 0) * share;
      s.hours += h;
      s.byType[activityName(w)] = (s.byType[activityName(w)] || 0) + h;
    }
  }
  let totalH = 0, totalCost = 0;
  const rows = sortByName(db.workers).map(p => {
    const s = stats[p.id] || { hours: 0, byType: {} };
    const cost = s.hours * (+p.rate || 0);
    totalH += s.hours;
    totalCost += cost;
    const types = Object.entries(s.byType).map(([k, h]) => `${k} ${fmtNum(h, 1)} h`).join(', ');
    return `
      <tr data-action="edit-worker" data-id="${p.id}" style="cursor:pointer">
        <td><strong>${esc(p.name)}</strong>${types ? `<div class="small muted">${esc(types)}</div>` : ''}</td>
        <td class="num">${fmtNum(s.hours, 1)}</td>
        <td class="num">${p.rate ? fmtNum(p.rate, 0) : '–'}</td>
        <td class="num">${p.rate ? fmtNum(cost, 0) + ' Kč' : '–'}</td>
      </tr>`;
  }).join('');
  return `
    <div class="page-head">
      <h1>Lidé a stroje</h1>
      <button class="btn primary" data-action="new-worker">+ Pracovník</button>
    </div>
    <div class="filters"><select data-filter="workersPeriod" aria-label="Období">${monthOptions(workersPeriod, `Celý rok ${selectedYear}`)}</select></div>
    <div class="card">
      ${rows ? `
      <h2>${workersPeriod ? esc(fmtMonth(prefix)) : `Rok ${selectedYear}`}</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Jméno</th><th class="num">Hodiny</th><th class="num">Kč/h</th><th class="num">Náklad</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>Celkem</td><td class="num">${fmtNum(totalH, 1)}</td><td></td><td class="num">${fmtNum(totalCost, 0)} Kč</td></tr></tfoot>
      </table></div>
      <p class="small muted">Klepnutím na řádek pracovníka upravíš.</p>` : '<p class="empty">Zatím žádní pracovníci.</p>'}
    </div>
    ${renderMachines(prefix)}`;
}

function renderMachines(prefix) {
  const hours = {};
  for (const w of db.works) {
    const share = periodShare(w, prefix);
    if (isPlanned(w) || !share) continue;
    for (const e of w.machines || []) hours[e.machineId] = (hours[e.machineId] || 0) + (+e.hours || 0) * share;
  }
  let totalH = 0, totalCost = 0;
  const rows = sortByName(db.machines).map(m => {
    const h = hours[m.id] || 0;
    totalH += h;
    totalCost += h * (+m.rate || 0);
    return `
      <tr data-action="edit-machine" data-id="${m.id}" style="cursor:pointer">
        <td><strong>${esc(m.name)}</strong></td>
        <td class="num">${fmtNum(h, 1)}</td>
        <td class="num">${m.rate ? fmtNum(m.rate, 0) : '–'}</td>
        <td class="num">${m.rate ? fmtNum(h * m.rate, 0) + ' Kč' : '–'}</td>
      </tr>`;
  }).join('');
  return `
    <div class="card">
      <div class="page-head"><h2>Stroje</h2><button class="btn sm" data-action="new-machine">+ Stroj</button></div>
      ${rows ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Stroj</th><th class="num">Motohodiny</th><th class="num">Kč/mth</th><th class="num">Náklad</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>Celkem</td><td class="num">${fmtNum(totalH, 1)}</td><td></td><td class="num">${fmtNum(totalCost, 0)} Kč</td></tr></tfoot>
      </table></div>` : '<p class="small muted">Traktory, postřikovače a další stroje. U práce k nim zapíšeš motohodiny a z nich se počítají náklady.</p>'}
    </div>`;
}

export function renderSettings() {
  const yearOpts = availableYears().map(y => `<option${y === selectedYear ? ' selected' : ''}>${y}</option>`).join('');
  return `
    <h1>Data</h1>
    <div class="card">
      <h2>Export</h2>
      <p class="small muted">CSV soubory jsou připravené pro Excel (středník, česká diakritika).</p>
      <div class="field" style="max-width:200px"><label for="export-year">Rok</label><select id="export-year">${yearOpts}</select></div>
      <div class="actions-row">
        <button class="btn" data-action="export-works">Deník prací (CSV)</button>
        <button class="btn" data-action="export-por">Evidence POR / hnojiv (CSV)</button>
      </div>
      <p class="small muted">Evidence POR obsahuje údaje, které od 1. 1. 2026 vyžaduje nařízení (EU) 2023/564: přípravek a číslo povolení,
        datum a čas zahájení, dávku, díl LPIS (DPB), ošetřenou plochu, plodinu s kódem EPPO a fenofázi BBCH. CSV je strojově čitelný
        formát. Předávání XML do JUDPOR / EPH je v ČR povinné jen při výměře nad 200 ha.</p>
    </div>
    <div class="card">
      <div class="page-head"><h2>Činnosti</h2><button class="btn sm" data-action="new-activity">+ Přidat činnost</button></div>
      <p class="small muted">Číselník pro zápis prací. „Ošetření“ zobrazí ve formuláři přípravky, „Sklizeň“ odrůdy a množství.
        Skryté činnosti se nenabízejí u nových prací, ale v zapsaných zůstanou.</p>
      <ul class="list">${db.activities.map((a, i) => {
        const used = db.works.filter(w => w.activityId === a.id).length;
        return `
        <li class="item" data-action="edit-activity" data-id="${a.id}">
          <div class="item-main">
            <div class="item-title">${esc(a.name)} ${a.kind !== 'work' ? `<span class="badge">${esc(ACTIVITY_KINDS[a.kind])}</span>` : ''}
              ${a.hidden ? '<span class="badge planned">skrytá</span>' : ''}</div>
            <div class="item-meta">${used ? `${used} záznamů` : 'zatím nepoužitá'}</div>
          </div>
          <div class="item-actions">
            <button class="btn sm" data-action="move-activity" data-id="${a.id}" data-dir="-1" aria-label="Posunout nahoru"${i === 0 ? ' disabled' : ''}>↑</button>
            <button class="btn sm" data-action="move-activity" data-id="${a.id}" data-dir="1" aria-label="Posunout dolů"${i === db.activities.length - 1 ? ' disabled' : ''}>↓</button>
          </div>
        </li>`;
      }).join('')}</ul>
    </div>
    <div class="card">
      <h2>Uložení</h2>
      ${sync.state === 'disk'
        ? `<p><span class="badge ok">na disku</span> <code class="small">${esc(sync.file)}</code></p>
           <p class="small muted">Při každém uložení se předchozí verze zachová jako <code>.bak</code>.
             ${sync.keepBackups ? `Navíc se ukládá kopie za každý den do <code>${esc(sync.backups)}</code> (posledních ${sync.keepBackups} dní);
             obnovíš ji tlačítkem „Obnovit ze zálohy“ níže.` : ''}</p>`
        : `<p><span class="badge warn">jen v prohlížeči</span></p>
           <p class="small muted">Server není spuštěný. Změny se zatím drží v prohlížeči a na disk se zapíšou, až spustíš <code>python3 server.py</code> a stránku otevřeš znovu.</p>`}
    </div>
    <div class="card">
      <h2>Import z Registru vinic</h2>
      <p class="small muted">Na Portálu farmáře stáhni výpis z Registru vinic ve formátu XML. Načtou se vinice s výměrou,
        DPB a skladbou odrůd; před uložením uvidíš náhled. Údaje o subjektu (IČO, adresa) se neukládají.</p>
      <label class="btn primary" style="margin:0;font-size:1rem;display:inline-block">Vybrat XML soubor
        <input type="file" accept=".xml,application/xml,text/xml" data-import-rv hidden>
      </label>
    </div>
    <div class="card">
      <h2>Záloha</h2>
      <p class="small muted">Stažený JSON můžeš kdykoli nahrát zpět, i na jiném zařízení.</p>
      <div class="actions-row">
        <button class="btn primary" data-action="backup">Stáhnout zálohu (JSON)</button>
        <label class="btn" style="margin:0;color:var(--text);font-size:1rem">Obnovit ze zálohy
          <input type="file" accept="application/json,.json" data-import hidden>
        </label>
      </div>
    </div>
    <div class="card">
      <h2>Smazat vše</h2>
      <p class="small muted">Nevratně smaže všechny vinice, práce, přípravky a pracovníky (v prohlížeči i v souboru na disku).</p>
      <button class="btn danger" data-action="wipe">Smazat všechna data</button>
    </div>
    <p class="small muted">VitiNote · ${db.vineyards.length} vinic, ${db.works.length} záznamů prací
      ${sync.session ? ' · <a href="logout">Odhlásit</a>' : ''}</p>`;
}
export const routes = {
  '': renderDashboard,
  prace: renderWorks,
  vinice: id => (id ? renderVineyardDetail(id) : renderVineyards()),
  pripravky: renderProducts,
  pracovnici: renderWorkers,
  nastaveni: renderSettings,
};

export function render() {
  const [, page = '', param] = location.hash.split('/');
  const view = routes[page] || renderDashboard;
  renderYearSelect();
  $('#main').innerHTML = view(param && decodeURIComponent(param));
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.page === page));
}
