/**
 * Smoke e2e (fundament): zbudowana aplikacja się ładuje, metadane PWA i brak żądań zewnętrznych.
 * Scenariusze kryteriów odbioru dopisują kolejni agenci. Nie zastępuje testu na fizycznym iPhonie (G05).
 */
import { expect, test } from '@playwright/test';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';
import { waitOfflineReady } from './helpers';

test('ładuje ekran startowy z metadanymi PWA i bez zewnętrznych żądań', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? 'http://127.0.0.1').origin;
  const external: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) external.push(url);
  });

  await page.goto('./');
  await expect(page).toHaveTitle('Doktor Monika Egzamin');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Doktor Monika Egzamin');

  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewport).toContain('viewport-fit=cover');
  expect(viewport).not.toMatch(/maximum-scale|user-scalable\s*=\s*no/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#FAFBFC');
  // A02 / USTALENIA pkt 33: nazwa na ekranie głównym dokładnie „Doktor Monika Egzamin” (bez skrótu).
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Doktor Monika Egzamin');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await page.request.get(new URL(manifestHref ?? '', page.url()).toString())).json();
  expect(manifest).toMatchObject({ name: 'Doktor Monika Egzamin', short_name: 'Doktor Monika Egzamin', lang: 'pl', display: 'standalone', start_url: '.', scope: '.' });

  // Wyłącznie bank V15 pod wersjonowaną ścieżką; dawna ścieżka banku nie jest serwowana.
  const bank = await page.request.get(new URL(CONTENT_RELEASE.bankFile, page.url()).toString());
  expect(bank.ok()).toBe(true);
  const oldBank = await page.request.get(new URL('data/bank.json', page.url()).toString());
  expect(oldBank.status()).toBe(404);

  // Lokalny font (bez CDN) jest używany przez nagłówek. Nagłówek jest podmieniany w trakcie uruchomienia
  // (ładowanie → przygotowanie offline → start), więc pomiar dopiero na gotowym ekranie startowym.
  await waitOfflineReady(page);
  await expect(page.locator('.mode-card')).toHaveCount(2);
  const fontFamily = await page.locator('h1.app-title').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(fontFamily).toContain('Hanken Grotesk');
  // Polskie znaki wymagają podzbiorów latin + latin-ext (ładowane lokalnie wg unicode-range).
  const loadedFaces = await page.evaluate(async () => (await document.fonts.load('700 28px "Hanken Grotesk"', 'Żółć gęś')).length);
  expect(loadedFaces).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => document.fonts.check('700 28px "Hanken Grotesk"', 'Żółć gęś'))).toBe(true);

  expect(external).toEqual([]);
});

test('jasny motyw także przy ciemnym motywie systemu', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(250, 251, 252)');
});
