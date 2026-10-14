// Prohlášení o sklizni (ÚKZÚZ, Registr vinic, formulář 201): sklizeň za rok po registračních číslech vinic, bílé a modré hrozny.
// Podává se ručně na Portálu farmáře do 15. ledna; aplikace jen připraví čísla k opsání (a CSV).
import { esc, fmtNum, fold, isPlanned } from './util.js';
import { db, plantedVineyards, sortVineyards, vName } from './data.js';
import { selectedYear } from './view-state.js';

export const COLORS = { white: 'Bílé', red: 'Modré' };

// Barva hroznů běžných moštových odrůd (bílé = odrůdy pro bílá vína, i Tramín červený nebo Veltlínské červené rané).
const WHITE = ['Ryzlink rýnský', 'Ryzlink vlašský', 'Veltlínské zelené', 'Veltlínské červené rané', 'Veltlínské červené',
  'Müller Thurgau', 'Müller-Thurgau', 'Rulandské bílé', 'Rulandské šedé', 'Chardonnay', 'Sauvignon', 'Sauvignon blanc', 'Pálava',
  'Tramín červený', 'Muškát moravský', 'Muškát Ottonel', 'Irsai Oliver', 'Sylvánské zelené', 'Neuburské', 'Kerner', 'Aurelius',
  'Děvín', 'Hibernal', 'Solaris', 'Savilon', 'Malverina', 'Muscaris', 'Souvignier gris', 'Johanniter', 'Bronner', 'Cabernet blanc',
  'Chrupka bílá', 'Vlašský ryzlink', 'Lipka', 'Ryzlink'];
const RED = ['Frankovka', 'Svatovavřinecké', 'Zweigeltrebe', 'Modrý Portugal', 'Rulandské modré', 'Cabernet Sauvignon',
  'Cabernet Moravia', 'Cabernet Cortis', 'Cabernet Dorsa', 'Merlot', 'André', 'Neronet', 'Dornfelder', 'Alibernet', 'Laurot',
  'Regent', 'Rubinet', 'Agni', 'Kofranka', 'Cerason', 'Sevar', 'Nativa', 'Fratava', 'Gamay', 'Blauburger', 'Acolon', 'Pinot noir',
  'Rosa', 'Mery'];
const KNOWN = new Map([...WHITE.map(n => [fold(n), 'white']), ...RED.map(n => [fold(n), 'red'])]);

// Barva odrůdy: ruční volba uživatele, jinak seznam, jinak podle slova „modrý“ v názvu; neznámá → null.
export function varietyColor(name) {
  const key = fold(name).trim();
  if (!key) return null;
  return db.varietyColors?.[key] ?? KNOWN.get(key) ?? (/\bmodr/.test(key) ? 'red' : null);
}

// Barva řádku sklizně; „celá vinice“ jen když má vinice odrůdy jedné barvy.
function harvestColor(v, h) {
  if (h.variety) return varietyColor(h.variety);
  const colors = new Set((v.varieties || []).map(x => varietyColor(x.name)));
  return colors.size === 1 ? [...colors][0] : null;
}

// Řádky prohlášení za rok: jedna za registrační číslo (i bez sklizně – v prohlášení se uvádí nula),
// vinice bez reg. čísla se sklizní zvlášť. Neznámá barva → `unknown` (kg), seznam takových odrůd v `unknownVarieties`.
export function harvestDeclaration(year) {
  const rows = new Map();
  const unknownVarieties = new Set();
  for (const v of sortVineyards(plantedVineyards())) {
    const key = v.regNo || 'id:' + v.id;
    const r = rows.get(key) ?? { regNo: v.regNo || '', names: [], white: 0, red: 0, unknown: 0 };
    r.names.push(vName(v));
    for (const w of db.works) {
      if (w.vineyardId !== v.id || isPlanned(w) || !w.date.startsWith(year)) continue;
      for (const h of w.harvest || []) {
        const kg = +h.kg || 0;
        if (!kg) continue;
        const color = harvestColor(v, h);
        r[color ?? 'unknown'] += kg;
        if (!color) unknownVarieties.add(h.variety || '');
      }
    }
    rows.set(key, r);
  }
  const list = [...rows.values()].filter(r => r.regNo || r.white || r.red || r.unknown)
    .sort((a, b) => (!a.regNo - !b.regNo) || a.regNo.localeCompare(b.regNo));
  return { rows: list, unknownVarieties: [...unknownVarieties].sort((a, b) => a.localeCompare(b, 'cs')) };
}

// Formulář přijímá jen celá kladná čísla.
const kg = n => Math.round(n);

export function harvestDeclarationCsvRows(year) {
  const head = ['Registrační číslo vinice', 'Vinice'];
  for (const c of Object.values(COLORS)) {
    head.push(`${c} – vlastní zpracování na víno (kg)`, `${c} – prodej zpracovatelům hrozny (kg)`,
      `${c} – prodej zpracovatelům mošt (l)`, `${c} – jiné určení (kg/l)`);
  }
  return [head, ...harvestDeclaration(year).rows.map(r => [r.regNo, r.names.join(', '), kg(r.white), 0, 0, 0, kg(r.red), 0, 0, 0])];
}

export function renderHarvestDeclaration() {
  const year = selectedYear;
  const { rows, unknownVarieties } = harvestDeclaration(year);
  const sum = k => rows.reduce((s, r) => s + r[k], 0);
  const noRegNo = rows.filter(r => !r.regNo).length;
  const colorSelect = name => `
    <div class="field">
      <label>${esc(name || 'celá vinice (bílé i modré odrůdy)')}</label>
      ${name ? `<select data-variety-color="${esc(name)}">
        <option value="">– vyber –</option>${Object.entries(COLORS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
      </select>` : '<p class="small muted">Zapiš sklizeň takové vinice po odrůdách, ať jde rozdělit na bílé a modré.</p>'}
    </div>`;
  return `
    <p class="no-print"><a href="#/vinice">← Vinice</a></p>
    <div class="page-head">
      <h1>Prohlášení o sklizni ${year}</h1>
      <div class="actions-row no-print">
        <button class="btn" data-action="export-harvest-declaration" data-year="${year}">CSV</button>
        <button class="btn" data-action="print">Tisk / PDF</button>
      </div>
    </div>
    <p class="small muted">Formulář 201 (vlastní sklizeň) se podává na Portálu farmáře nebo ÚKZÚZ do <strong>15. 1. ${+year + 1}</strong>.
      Všechny hrozny jsou zde vedené jako <strong>vlastní zpracování na víno</strong>; ostatní sloupce (prodej zpracovatelům, jiné určení)
      vyplň nulou. Uvádí se i vinice bez sklizně, s nulou. Množství z provedených sklizní v deníku, zaokrouhlené na celé kg.</p>
    ${unknownVarieties.length ? `
      <div class="card no-print">
        <h2>Neznámá barva odrůdy</h2>
        <p class="small muted">U těchto odrůd nevím, jestli jsou bílé, nebo modré (${fmtNum(sum('unknown'), 0)} kg zatím není v součtech). Vyber barvu – zapamatuje se.</p>
        ${unknownVarieties.map(colorSelect).join('')}
      </div>` : ''}
    <div class="card">${rows.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Reg. číslo vinice</th><th>Vinice</th><th class="num">Bílé kg</th><th class="num">Modré kg</th></tr></thead>
        <tbody>${rows.map(r => `
          <tr>
            <td>${r.regNo ? `<strong>${esc(r.regNo)}</strong>` : '<span class="badge warn">bez reg. čísla</span>'}</td>
            <td>${esc(r.names.join(', '))}</td>
            <td class="num">${fmtNum(kg(r.white), 0)}</td>
            <td class="num">${fmtNum(kg(r.red), 0)}</td>
          </tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">Celkem</td><td class="num">${fmtNum(kg(sum('white')), 0)}</td><td class="num">${fmtNum(kg(sum('red')), 0)}</td></tr></tfoot>
      </table></div>
      ${noRegNo ? '<p class="small muted">Vinici bez registračního čísla nejde do prohlášení uvést – doplň ho u vinice (nebo naimportuj z Registru vinic).</p>' : ''}`
      : '<p class="empty">Zatím žádné vinice.</p>'}
    </div>`;
}
