// Ukládání: kopie v localStorage a synchronizace se souborem na disku přes server.py.
import { $, toast } from './util.js';
import { DB_KEY, db, normalizeDb, setDb } from './data.js';
import { render } from './views.js';
import { dlg } from './dialog.js';

/*
 * Hlavní úložiště je JSON soubor na disku (přes server.py, endpoint api/data).
 * localStorage drží kopii pro okamžité načtení a pro práci bez serveru; neuložené
 * změny označuje příznak DIRTY_KEY a odešlou se, jakmile je server zase dostupný.
 */
export const DIRTY_KEY = 'vitinote:dirty';
export const API_URL = 'api/data';

export const sync = { state: 'pending', file: '', backups: '', keepBackups: 0, session: false };

// Server chráněný heslem (přístup z jiného zařízení) a přihlášení vypršelo. Neodeslané změny zůstanou
// v prohlížeči (příznak dirty) a odešlou se po přihlášení.
function toLogin() {
  location.href = 'login';
}

export function writeLocal() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch (e) {
    toast('Uložení v prohlížeči selhalo: ' + e.message);
  }
}

export function setDirty(on) {
  try { on ? localStorage.setItem(DIRTY_KEY, '1') : localStorage.removeItem(DIRTY_KEY); } catch { /* jen příznak */ }
}
export const isDirty = () => { try { return !!localStorage.getItem(DIRTY_KEY); } catch { return false; } };

export function setSync(state, res) {
  sync.state = state;
  if (res) sync.session = res.headers.get('X-Auth') === 'session';
  if (res?.headers.get('X-Data-File')) sync.file = decodeURIComponent(res.headers.get('X-Data-File'));
  // „cesta;keep=30“ – kam server ukládá denní zálohy a kolik jich drží.
  const backups = res?.headers.get('X-Backups')?.match(/^(.*);keep=(\d+)$/);
  if (backups) [sync.backups, sync.keepBackups] = [decodeURIComponent(backups[1]), Number(backups[2])];
  const el = $('#sync');
  el.dataset.state = state;
  el.textContent = { disk: 'Uloženo', saving: 'Ukládám…', local: 'Jen v prohlížeči', pending: '' }[state];
  el.title = state === 'disk' ? `Uloženo v souboru ${sync.file}` : state === 'local'
    ? 'Server není dostupný – změny jsou zatím jen v prohlížeči a uloží se na disk, až poběží server.py' : '';
  if (location.hash.startsWith('#/nastaveni') && !dlg.open) render();
}

// Počítadlo místních změn: odpověď serveru, která dorazí až po nich, je zastaralá.
export let localChanges = 0;

export function save() {
  localChanges++;
  writeLocal();
  setDirty(true);
  pushToServer();
}

export let pushing = false;
export let pushAgain = false;

export async function pushToServer() {
  if (pushing) { pushAgain = true; return; }
  pushing = true;
  setSync('saving');
  try {
    let res;
    do {
      pushAgain = false;
      res = await fetch(API_URL, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(db) });
      if (res.status === 401) return toLogin();
      if (!res.ok) throw new Error('HTTP ' + res.status);
    } while (pushAgain);
    setDirty(false);
    setSync('disk', res);
  } catch {
    setSync('local');
  } finally {
    pushing = false;
  }
}

// Načte data ze souboru na disku. Neodeslané místní změny mají přednost a odešlou se.
export async function pullFromServer() {
  if (pushing || dlg.open) return;
  if (isDirty()) return pushToServer();
  const changesBefore = localChanges;
  try {
    const res = await fetch(API_URL, { cache: 'no-store' });
    if (res.status === 401) return toLogin();
    // Mezitím se uložila místní změna → nepřepisovat ji starší verzí ze serveru.
    if (localChanges !== changesBefore) return;
    if (res.status === 404 && res.headers.get('Content-Type')?.includes('json')) {
      // Soubor zatím neexistuje → založíme ho z dat v prohlížeči.
      setDirty(true);
      return pushToServer();
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = normalizeDb(await res.json());
    if (dlg.open || localChanges !== changesBefore) return;
    const isEmpty = d => !d.vineyards.length && !d.works.length && !d.workers.length && !d.products.length;
    if (isEmpty(data) && !isEmpty(db)) {
      // Prázdný soubor nesmí přemazat data, která už jsou v prohlížeči.
      setDirty(true);
      return pushToServer();
    }
    if (JSON.stringify(data) !== JSON.stringify(db)) {
      setDb(data);
      writeLocal();
      render();
    }
    setSync('disk', res);
  } catch {
    setSync('local');
  }
}
