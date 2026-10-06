// Spuštění aplikace.
import { isDirty, pullFromServer, pushToServer } from './storage.js';
import { loadRegistry } from './registry-por.js';
import { render } from './views.js';
import { dlg, initDialog } from './dialog.js';
import { initActions } from './actions.js';

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
initDialog();
initActions();
render();
pullFromServer();
loadRegistry().then(() => { if (location.hash.startsWith('#/pripravky') && !dlg.open) render(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pullFromServer(); });
window.addEventListener('online', pullFromServer);
dlg.addEventListener('close', () => { if (isDirty()) pushToServer(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Požádat prohlížeč, ať data nemaže při nedostatku místa.
navigator.storage?.persist?.().catch(() => {});
