// Spouští server.py s dočasným datovým souborem a prohlížeč pro jeden test.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = join(APP_DIR, 'tests', 'fixtures');

const freePort = () => new Promise((resolve, reject) => {
  const srv = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

async function waitFor(fn, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try { if (await fn()) return; } catch { /* ještě neběží */ }
    if (Date.now() > end) throw new Error('vypršel čas čekání');
    await new Promise(r => setTimeout(r, 50));
  }
}

export async function startServer({ port, dataFile } = {}) {
  port ??= await freePort();
  dataFile ??= join(mkdtempSync(join(tmpdir(), 'vitinote-test-')), 'data.json');
  const proc = spawn('python3', [join(APP_DIR, 'server.py'), '--port', String(port), '--data', dataFile], { stdio: 'ignore' });
  const url = `http://localhost:${port}/`;
  await waitFor(async () => (await fetch(url)).ok);
  return {
    url, port, dataFile,
    stop: () => new Promise(resolve => {
      if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
      proc.once('exit', resolve);
      proc.kill();
    }),
  };
}

let browserPromise;
// CHROME_PATH umožní použít systémový Chrome místo prohlížeče staženého Playwrightem.
const browser = () => (browserPromise ??= chromium.launch({ executablePath: process.env.CHROME_PATH || undefined }));

export async function closeBrowser() {
  if (browserPromise) await (await browserPromise.catch(() => null))?.close();
}

/**
 * Spustí server (volitelně s počátečními daty `initialData`) a otevře stránku.
 * `fn` dostane { page, server, readData, newPage }.
 * Potvrzovací dialogy (confirm) se automaticky přijímají, chyby JS na stránce test shodí.
 */
export async function withApp(fn, { viewport = { width: 420, height: 900 }, initialData } = {}) {
  const server = await startServer();
  if (initialData) writeFileSync(server.dataFile, JSON.stringify(initialData));
  const contexts = [];
  const errors = [];
  const newPage = async () => {
    const ctx = await (await browser()).newContext({ viewport });
    contexts.push(ctx);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    return page;
  };
  try {
    const page = await newPage();
    await page.goto(server.url);
    await page.waitForSelector('#sync[data-state=disk]', { state: 'attached' });
    await fn({
      page, server, newPage,
      readData: () => (existsSync(server.dataFile) ? JSON.parse(readFileSync(server.dataFile, 'utf8')) : null),
    });
    if (errors.length) throw new Error('Chyby na stránce: ' + errors.join('; '));
  } finally {
    await Promise.all(contexts.map(c => c.close()));
    await server.stop();
    rmSync(dirname(server.dataFile), { recursive: true, force: true });
  }
}

// Počká, až aplikace uloží změny na disk.
export const saved = page => page.waitForSelector('#sync[data-state=disk]', { state: 'attached' });

export async function addVineyard(page, { name, area = '', varieties = [] }, { wait = true } = {}) {
  await page.goto(page.url().replace(/#.*$/, '') + '#/vinice');
  await page.click('.page-head [data-action=new-vineyard]');
  await page.fill('[name=name]', name);
  if (area) await page.fill('[name=area]', area);
  for (const [i, v] of varieties.entries()) {
    if (i > 0) await page.click('[data-action=add-variety-row]');
    const row = page.locator('.row-variety').nth(i);
    await row.locator('[name=v-name]').fill(v.name);
    if (v.area) await row.locator('[name=v-area]').fill(v.area);
  }
  await page.click('#dlg button[type=submit]');
  if (wait) await saved(page);
}
