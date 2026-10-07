// Omezení povoleného použití z textu registru ÚKZÚZ: počet aplikací, odstup a fenofáze BBCH.
// Poznámka má očíslované sekce bez oddělovačů, např. „1) od: 15 BBCH, do: 77 BBCH3) max. 4x za rok, v intervalu 10 dnů“:
// 1) = kdy (fenofáze), 3) = počet aplikací a interval. Bez závislostí, testuje se i v Node.

// Rozdělí poznámku na sekce { '1': '…', '3': '…' }. Číslo sekce nesmí navazovat na číslici („BBCH 61)“ není sekce).
function sections(note) {
  const out = {};
  const parts = String(note || '').split(/(?<!\d)([1-9])\)\s*/);
  for (let i = 1; i < parts.length; i += 2) out[parts[i]] = (out[parts[i]] || '') + parts[i + 1];
  return out;
}

function maxApplications(text) {
  const range = text.match(/(\d+)\s*-\s*(\d+)\s*x/i);           // „1-3x za rok“
  if (range) return Number(range[2]);
  const max = text.match(/max\.?\s*(\d+)\s*x/i);                // „max. 4x“, „max.12x“, „max 2 x“
  return max ? Number(max[1]) : null;
}

function minIntervalDays(text) {
  const m = text.match(/v\s+intervalu\s+(?:min\.?\s*)?(\d+)(?:\s*-\s*\d+)?\s*(dn|dní|den|týd)/i);
  return m ? Number(m[1]) * (m[2].toLowerCase().startsWith('týd') ? 7 : 1) : null;
}

// Okna fenofází [od, do] ze sekce 1: „od: 15-18 BBCH“, „do: 81 BBCH“, „ve f. 17 BBCH“; více oken spojených „a“.
function bbchWindows(text) {
  const windows = [];
  let open = null;
  for (const m of text.matchAll(/(od|do):\s*(\d+)(?:\s*-\s*\d+)?\s*BBCH|ve\s+f\.\s*(\d+)\s*BBCH/gi)) {
    if (m[3]) { windows.push([Number(m[3]), Number(m[3])]); open = null; continue; }
    const n = Number(m[2]);
    if (m[1].toLowerCase() === 'od') { open = [n, 99]; windows.push(open); }
    else if (open) { open[1] = n; open = null; }
    else windows.push([0, n]);
  }
  return windows;
}

export function useLimits(use) {
  const s = sections(use?.note);
  const countText = s['3'] ?? `${use?.note || ''} ${use?.dose || ''}`;
  return {
    maxApplications: maxApplications(countText) ?? maxApplications(use?.dose || ''),
    minIntervalDays: minIntervalDays(countText) ?? minIntervalDays(use?.dose || ''),
    bbch: bbchWindows(s['1'] ?? ''),
  };
}

export const bbchAllowed = (windows, bbch) => !windows.length || windows.some(([from, to]) => bbch >= from && bbch <= to);

export function limitsLabel(l) {
  return [
    l.maxApplications ? `max. ${l.maxApplications}× za rok` : '',
    l.minIntervalDays ? `odstup ${l.minIntervalDays} dní` : '',
    l.bbch.length ? `BBCH ${l.bbch.map(([a, b]) => (a === b ? a : b === 99 ? `od ${a}` : `${a}–${b}`)).join(', ')}` : '',
  ].filter(Boolean).join(', ');
}
