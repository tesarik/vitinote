// Stav zobrazení: vybraný pracovní rok, filtry prací a období v přehledu lidí.
import { options, pad, thisMonth, today } from './util.js';
import { db, inPeriod, workEnd } from './data.js';

// Pracovní rok = kalendářní rok data práce. Výběr v záhlaví přepíná všechny roční údaje.
export const currentYear = () => today().slice(0, 4);
export let selectedYear = currentYear();
export const inYear = w => inPeriod(w, selectedYear);
export const yearLabel = () => (selectedYear === currentYear() ? 'letos' : `v roce ${selectedYear}`);
export const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
export const monthOptions = (selected, empty) => options(MONTHS.map((m, i) => ({ id: pad(i + 1), name: m })), selected, { empty });

export function availableYears() {
  const years = new Set([currentYear(), selectedYear, ...db.works.flatMap(w => [w.date.slice(0, 4), workEnd(w).slice(0, 4)])]);
  return [...years].sort().reverse();
}

export function setYear(year) {
  selectedYear = year;
  workFilters.month = '';
  workersPeriod = year === currentYear() ? thisMonth().slice(5) : '';
}

export function setWorkersPeriod(period) {
  workersPeriod = period;
}
export const workFilters = { vineyardId: '', activityId: '', month: '', status: '', q: '' };
// Měsíc ('01'–'12') ve vybraném roce, nebo '' = celý rok.
export let workersPeriod = thisMonth().slice(5);
