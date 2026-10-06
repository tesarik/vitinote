// Vygeneruje PNG ikony (instalace PWA, iOS) z icon.svg: npm run icons
import { chromium } from 'playwright';
import fs from 'fs';
const dir = new URL('../', import.meta.url).pathname;
const svg = fs.readFileSync(dir + 'icon.svg', 'utf8');
// Obsah ikony (bez podkladu) pro verze s plným čtvercovým pozadím.
const inner = svg.replace(/<svg[^>]*>/, '').replace('</svg>', '').replace(/<rect[^>]*\/>/, '');
const fullBleed = scale => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#6b1d3a"/>
  <g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${inner}</g></svg>`;
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const p = await b.newPage();
const render = async (markup, size, file) => {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<html><body style="margin:0;background:transparent">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: dir + file, omitBackground: true });
};
await render(svg, 192, 'icon-192.png');
await render(svg, 512, 'icon-512.png');
await render(fullBleed(0.75), 512, 'icon-maskable-512.png');   // obsah v bezpečné zóně (80 %)
await render(fullBleed(0.9), 180, 'apple-touch-icon.png');
await b.close();
