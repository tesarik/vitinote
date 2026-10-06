// Registr přípravků na ochranu rostlin (ÚKZÚZ): výtah pro révu z api/por, vyhledávání, převody.
import { fold } from './util.js';
import { PRODUCT_KINDS, db } from './data.js';

// Výtah přípravků pro révu, který připravuje server.py (api/por). Bez serveru je null.
export let registry = null;
export let registryLoad = null;

export function loadRegistry(force = false) {
  if (!registryLoad || force) {
    registryLoad = fetch('api/por', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(d => (registry = d));
  }
  return registryLoad;
}

export const findPor = regNo => registry?.products.find(r => r.regNo === regNo);

export function searchPor(query) {
  const q = fold(query.trim());
  if (!registry || q.length < 2) return [];
  return registry.products.filter(r => fold(r.name).includes(q) || r.regNo === query.trim()).slice(0, 12);
}

// Dávka z registru převedená na jednotky aplikace (l, kg na ha); jiné jednotky (%, ml/100 m²…) nepřevádíme.
export function convertDose(value, unit) {
  const factor = { 'l/ha': ['l', 1], 'kg/ha': ['kg', 1], 'ml/ha': ['l', 0.001], 'g/ha': ['kg', 0.001] }[unit];
  return factor && value != null ? { unit: factor[0], dose: Math.round(value * factor[1] * 10000) / 10000 } : null;
}

export const productKindFrom = kind => PRODUCT_KINDS.find(k => String(kind).split(',').map(x => x.trim()).includes(k)) ?? 'Jiné';
export const maxPhiDays = uses => {
  const days = (uses || []).map(u => u.phiDays).filter(d => d != null);
  return days.length ? Math.max(...days) : null;
};
// Údaje přípravku převzaté z registru; při aktualizaci registru se obnoví.
export const porFields = r => ({ regNo: r.regNo, validTo: r.validTo, sellTo: r.sellTo, useTo: r.useTo, substances: r.substances, uses: r.uses });

export function refreshLinkedProducts() {
  let n = 0;
  for (const p of db.products) {
    const r = p.regNo && findPor(p.regNo);
    if (!r) continue;
    Object.assign(p, porFields(r), { phiDays: maxPhiDays(r.uses) ?? p.phiDays });
    n++;
  }
  return n;
}

export const useLabel = u => [u.pest || 'bez uvedení škodlivého organismu', u.dose, u.phi ? `OL ${u.phi}` : ''].filter(Boolean).join(' · ');
