// Import vinic z Registru vinic (XML z Portálu farmáře): parsování, párování, náhled.
import { esc, fmtNum, parseNum, toast, uid } from './util.js';
import { db, vName } from './data.js';
import { openForm } from './dialog.js';

// Plochy jsou v registru v m², v aplikaci v ha.
export function parseRegistryXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('soubor není platné XML');
  // Jen přímé potomky: PLOCHA je ve VINICE i ve SKLADBA.
  const kids = (el, tag) => [...el.children].filter(c => c.tagName === tag);
  const val = (el, tag) => kids(el, tag)[0]?.textContent.trim() ?? '';
  const m2ToHa = v => { const n = parseNum(v); return n === null ? null : Math.round(n) / 10000; };

  const vineyards = [...doc.getElementsByTagName('VINICE')].map(el => {
    const varieties = kids(el, 'SKLADBA').map(s => ({
      name: val(s, 'ODRUDANAZ'),
      code: val(s, 'ODRUDAKOD'),
      area: m2ToHa(val(s, 'PLOCHA')),
      year: val(s, 'ROKVYSADBY'),
      vines: parseNum(val(s, 'POCETKERU')),
      training: val(s, 'VEDENI'),
    })).filter(x => x.name);
    const years = [...new Set(varieties.map(x => x.year).filter(Boolean))].sort();
    return {
      regNo: val(el, 'REGCISLO'),
      trat: val(el, 'TRAT'),
      ku: val(el, 'KU'),
      area: m2ToHa(val(el, 'PLOCHA')),
      purpose: val(el, 'URCENI'),
      dpb: kids(el, 'PAROVANIDPB').map(d => [val(d, 'CTVEREC'), val(d, 'BLOK')].filter(Boolean).join(' ')).filter(Boolean).join(', '),
      plantedYear: years.length > 1 ? `${years[0]}–${years.at(-1)}` : (years[0] ?? ''),
      varieties,
    };
  }).filter(v => v.regNo);
  if (!vineyards.length) throw new Error('v souboru nejsou žádné vinice (očekávám výpis z Registru vinic)');
  return vineyards;
}

// Existující vinice: podle reg. čísla, u ručně založených (bez reg. čísla) podle kódu bloku v DPB.
export function findRegistryMatch(rv) {
  const byReg = db.vineyards.find(v => v.regNo === rv.regNo);
  if (byReg) return byReg;
  const blocks = rv.dpb.split(/[\s,;]+/).filter(t => t.includes('/'));
  return db.vineyards.find(v => !v.regNo && v.dpb && v.dpb.split(/[\s,;]+/).some(t => blocks.includes(t)));
}

export const registryFields = rv => ({ regNo: rv.regNo, ku: rv.ku, area: rv.area, dpb: rv.dpb, plantedYear: rv.plantedYear, varieties: rv.varieties });
// Porovnání nezávislé na pořadí klíčů; prázdné hodnoty se ignorují.
export const stableJson = v => JSON.stringify(v ?? '', (k, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).filter(([, y]) => y != null && y !== '').sort(([a], [b]) => a.localeCompare(b)))
  : x);
export const sameFields = (a, b) => Object.keys(b).every(k => stableJson(a[k]) === stableJson(b[k]));

// Výchozí jméno nové vinice z registru: trať + celé reg. číslo (část před lomítkem odpovídá katastru).
// Jméno si uživatel může přepsat; import ho u existujících vinic nemění.
export const registryName = rv => (rv.trat ? `${rv.trat} ${rv.regNo}` : rv.regNo);

export function importRegistryPreview(list) {
  const rows = list.map((rv, i) => {
    const match = findRegistryMatch(rv);
    const unchanged = match && sameFields(match, registryFields(rv));
    const status = !match ? '<span class="badge ok">nová</span>'
      : unchanged ? '<span class="badge">beze změny</span>'
      : `<span class="badge warn">aktualizace</span> <span class="small">${esc(vName(match))}</span>`;
    return `
      <label class="item" style="cursor:pointer;margin:0;font-weight:400;color:var(--text)">
        <input type="checkbox" name="rv" value="${i}"${unchanged ? '' : ' checked'} style="margin-top:4px">
        <span class="item-main">
          <span class="item-title">${esc(rv.trat || rv.regNo)} ${status}</span>
          <span class="item-meta" style="display:block">${[rv.regNo, `${fmtNum(rv.area, 4)} ha`, rv.ku, rv.dpb && `DPB ${rv.dpb}`].filter(Boolean).map(esc).join(' · ')}</span>
          <span class="item-meta" style="display:block">${esc([...new Set(rv.varieties.map(x => x.name))].join(', '))}</span>
        </span>
      </label>`;
  }).join('');

  openForm({
    title: `Import z Registru vinic (${list.length})`,
    body: `
      <p class="small muted">U existujících vinic se přepíše výměra, DPB, katastr a skladba odrůd podle registru.
        Název, poznámka a zapsané práce zůstanou.</p>
      <p class="actions-row"><button type="button" class="btn sm" data-action="rv-check" data-on="1">Vybrat vše</button>
        <button type="button" class="btn sm" data-action="rv-check">Zrušit výběr</button></p>
      <div class="list">${rows}</div>`,
    onSubmit: (get, fd) => {
      const picked = fd.getAll('rv').map(Number);
      if (!picked.length) { toast('Není vybraná žádná vinice.'); return false; }
      let added = 0, updated = 0;
      for (const i of picked) {
        const rv = list[i];
        const match = findRegistryMatch(rv);
        if (match) {
          Object.assign(match, registryFields(rv));
          // Pozemek v přípravě, který už je v registru vinic, je vysazený.
          delete match.stage;
          delete match.plannedPlanting;
          updated++;
        } else {
          db.vineyards.push({ id: uid(), name: registryName(rv), note: '', ...registryFields(rv) });
          added++;
        }
      }
      toast(`Import hotový – nové vinice: ${added}, aktualizované: ${updated}.`);
    },
  });
}
