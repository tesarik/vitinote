// Prohlášení o produkci (ÚKZÚZ, Registr vinic, formulář 211 – vlastní produkce): za rok po registračních číslech vinic
// vlastní hrozny (kg) a vyrobené víno (l) bílé a červené; litry = kg × výlisnost (číselník v Data). Kategorie vína se pamatuje u vinice.
// Podává se ručně na Portálu farmáře ke dni 31. 12. do 15. ledna; aplikace jen připraví čísla k opsání (a CSV).
import { esc, fmtNum, fold, isPlanned, numVal } from './util.js';
import { db, plantedVineyards, sortVineyards, vName } from './data.js';
import { selectedYear } from './view-state.js';

export const COLORS = { white: 'Bílé', red: 'Modré' };
export const WINE_CATEGORIES = {
  chop: 'Víno s CHOP', chzo: 'Víno s CHZO', odrudove: 'Odrůdové víno bez CHOP/CHZO', bez: 'Víno bez CHOP/CHZO', ostatni: 'Ostatní',
};

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

// Barva řádku sklizně: odrůda, souhrn barvy, nebo „celá vinice“ jen když má vinice odrůdy jedné barvy.
function harvestColor(v, h) {
  if (h.variety) return varietyColor(h.variety);
  if (COLORS[h.color]) return h.color;
  const colors = new Set((v.varieties || []).map(x => varietyColor(x.name)));
  return colors.size === 1 ? [...colors][0] : null;
}

// Výlisnost: litry vína z 1 kg hroznů.
export const pressYield = color => +(db.pressYield?.[color] ?? 0.7);

// Řádky prohlášení za rok: jedna za registrační číslo (i bez sklizně – v prohlášení se uvádí nula),
// vinice bez reg. čísla se sklizní zvlášť. Hrozny neznámé barvy jsou v kg, ale ne v litrech (`unknown`, `unknownVarieties`).
export function harvestDeclaration(year) {
  const rows = new Map();
  const unknownVarieties = new Set();
  for (const v of sortVineyards(plantedVineyards())) {
    const key = v.regNo || 'id:' + v.id;
    const r = rows.get(key) ?? { regNo: v.regNo || '', names: [], ids: [], category: '', white: 0, red: 0, unknown: 0 };
    r.names.push(vName(v));
    r.ids.push(v.id);
    r.category ||= v.wineCategory || '';
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
  const list = [...rows.values()]
    .filter(r => r.regNo || r.white || r.red || r.unknown)
    .sort((a, b) => (!a.regNo - !b.regNo) || a.regNo.localeCompare(b.regNo))
    .map(r => ({ ...r, kg: r.white + r.red + r.unknown, wineWhite: r.white * pressYield('white'), wineRed: r.red * pressYield('red') }));
  return { rows: list, unknownVarieties: [...unknownVarieties].sort((a, b) => a.localeCompare(b, 'cs')) };
}

// Formulář přijímá jen celá čísla.
const int = n => Math.round(n);

export function harvestDeclarationCsvRows(year) {
  return [
    ['Registrační číslo vinice', 'Vinice', 'Vlastní hrozny (kg)', 'Víno bílé (l)', 'Víno červené/růžové (l)', 'Hroznový mošt bílý (l)',
      'Hroznový mošt červený/růžový (l)', 'Ostatní výrobky', 'Kategorie'],
    ...harvestDeclaration(year).rows.map(r => [r.regNo, r.names.join(', '), int(r.kg), int(r.wineWhite), int(r.wineRed), 0, 0, 0,
      WINE_CATEGORIES[r.category] ?? '']),
  ];
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
      </select>` : '<p class="small muted">U takové vinice zapiš sklizeň po odrůdách nebo jako souhrn bílých a modrých hroznů.</p>'}
    </div>`;
  const categorySelect = r => `
    <select data-wine-category="${esc(r.ids.join(','))}" aria-label="Kategorie">
      <option value="">– kategorie –</option>
      ${Object.entries(WINE_CATEGORIES).map(([k, l]) => `<option value="${k}"${k === r.category ? ' selected' : ''}>${esc(l)}</option>`).join('')}
    </select>`;
  return `
    <p class="no-print"><a href="#/vinice">← Vinice</a></p>
    <div class="page-head">
      <h1>Prohlášení o produkci ${year}</h1>
      <div class="actions-row no-print">
        <button class="btn" data-action="export-harvest-declaration" data-year="${year}">CSV</button>
        <button class="btn" data-action="print">Tisk / PDF</button>
      </div>
    </div>
    <p class="small muted">Formulář 211 (vlastní produkce) ke dni 31. 12. ${year} se podává na Portálu farmáře do <strong>15. 1. ${+year + 1}</strong>.
      Hrozny se sčítají z provedených sklizní v deníku, víno = kg × výlisnost (bílé ${numVal(pressYield('white'))}, modré
      ${numVal(pressYield('red'))} l/kg<span class="no-print">, <a href="#/nastaveni">změnit v Data</a></span>). Hroznový mošt a ostatní
      výrobky jsou 0. Uvádí se i vinice bez sklizně, s nulou.</p>
    ${unknownVarieties.length ? `
      <div class="card no-print">
        <h2>Neznámá barva odrůdy</h2>
        <p class="small muted">U těchto odrůd nevím, jestli jsou bílé, nebo modré (${fmtNum(sum('unknown'), 0)} kg zatím není ve víně). Vyber barvu – zapamatuje se.</p>
        ${unknownVarieties.map(colorSelect).join('')}
      </div>` : ''}
    <div class="card">${rows.length ? `
      <ul class="list">${rows.map(r => `
        <li class="item">
          <div class="item-main">
            <div class="item-title">${r.regNo ? esc(r.regNo) : '<span class="badge warn">bez reg. čísla</span>'}
              <span class="small muted">${esc(r.names.join(', '))}</span></div>
            <div class="item-meta">hrozny <strong>${fmtNum(int(r.kg), 0)} kg</strong> · víno bílé <strong>${fmtNum(int(r.wineWhite), 0)} l</strong>
              · červené/růžové <strong>${fmtNum(int(r.wineRed), 0)} l</strong>${r.unknown ? ` · <span class="badge warn">${fmtNum(r.unknown, 0)} kg bez barvy</span>` : ''}</div>
            ${r.regNo ? `<div class="item-meta">${categorySelect(r)}</div>` : ''}
          </div>
        </li>`).join('')}
      </ul>
      <p><strong>Celkem:</strong> hrozny ${fmtNum(int(sum('kg')), 0)} kg · víno bílé ${fmtNum(int(sum('wineWhite')), 0)} l
        · červené/růžové ${fmtNum(int(sum('wineRed')), 0)} l</p>
      ${noRegNo ? '<p class="small muted">Vinici bez registračního čísla nejde do prohlášení uvést – doplň ho u vinice (nebo naimportuj z Registru vinic).</p>' : ''}`
      : '<p class="empty">Zatím žádné vinice.</p>'}
    </div>`;
}
