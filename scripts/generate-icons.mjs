#!/usr/bin/env node
/**
 * Rasteryzacja ikon PWA z autorskiego znaku scripts/icons/znak-dm.svg do public/icons/.
 *
 *   node scripts/generate-icons.mjs [--out public/icons]
 *
 * Używa Chromium z Playwright (przeglądarka z lokalnego cache ~/Library/Caches/ms-playwright — bez pobierania)
 * i lokalnego kroju Hanken Grotesk 700 z @fontsource/hanken-grotesk (SIL OFL 1.1). Brak sieci, brak CDN.
 * Skrypt sprawdza, że krój się załadował (inaczej litery wyrenderowałyby się krojem zastępczym)
 * oraz wymiary zapisanych PNG.
 *
 * Wynik:
 *   icon-192.png            192×192  purpose any
 *   icon-512.png            512×512  purpose any
 *   icon-512-maskable.png   512×512  purpose maskable (znak pomniejszony do strefy bezpiecznej)
 *   apple-touch-icon-180.png 180×180 (iOS; nieprzezroczyste tło, iOS sam zaokrągla rogi)
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argOut = process.argv.indexOf('--out');
const outDir = resolve(root, argOut > -1 ? process.argv[argOut + 1] : 'public/icons');

const svgSource = readFileSync(resolve(root, 'scripts/icons/znak-dm.svg'), 'utf8');
const fontPath = resolve(root, 'node_modules/@fontsource/hanken-grotesk/files/hanken-grotesk-latin-700-normal.woff2');
const fontBase64 = readFileSync(fontPath).toString('base64');

/** Skala znaku dla ikony maskowalnej (dodatkowy margines w kole strefy bezpiecznej). */
const MASKABLE_SCALE = 0.88;

const targets = [
  { file: 'icon-192.png', size: 192, scale: 1 },
  { file: 'icon-512.png', size: 512, scale: 1 },
  { file: 'icon-512-maskable.png', size: 512, scale: MASKABLE_SCALE },
  { file: 'apple-touch-icon-180.png', size: 180, scale: 1 },
];

function svgFor(scale) {
  if (scale === 1) return svgSource;
  const t = `translate(256 256) scale(${scale}) translate(-256 -256)`;
  return svgSource.replace('<g id="znak">', `<g id="znak" transform="${t}">`);
}

function pageHtml(svg, size) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Hanken Grotesk'; font-weight: 700; font-style: normal;
  src: url(data:font/woff2;base64,${fontBase64}) format('woff2'); }
html, body { margin: 0; padding: 0; background: #FAFBFC; }
svg { display: block; width: ${size}px; height: ${size}px; }
</style></head><body>${svg}</body></html>`;
}

function pngSize(buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== signature) throw new Error('To nie jest plik PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const target of targets) {
    const context = await browser.newContext({ viewport: { width: target.size, height: target.size }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.setContent(pageHtml(svgFor(target.scale), target.size));
    const loaded = await page.evaluate(async () => {
      await document.fonts.load('700 208px "Hanken Grotesk"', 'DM');
      await document.fonts.ready;
      return document.fonts.check('700 208px "Hanken Grotesk"', 'DM');
    });
    if (!loaded) throw new Error('Krój Hanken Grotesk 700 nie został załadowany — przerwano, aby nie zapisać ikony z krojem zastępczym.');
    const path = resolve(outDir, target.file);
    const buffer = await page.screenshot({ path, type: 'png', clip: { x: 0, y: 0, width: target.size, height: target.size } });
    const { width, height } = pngSize(buffer);
    if (width !== target.size || height !== target.size) {
      throw new Error(`${target.file}: ${width}×${height}, oczekiwano ${target.size}×${target.size}`);
    }
    console.log(`zapisano ${target.file} (${width}×${height}, ${buffer.length} B)`);
    await context.close();
  }
} finally {
  await browser.close();
}
