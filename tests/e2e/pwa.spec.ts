/**
 * PWA na buildzie produkcyjnym pod podścieżką:
 * - G02: po pierwszym pobraniu i gotowości SW — brak sieci → przeładowanie → aplikacja działa, można odpowiadać i zapisywać;
 * - A04: w czasie nauki brak żądań do innych hostów;
 * - G03: nowa wersja SW nie przeładowuje aktywnego pytania; baner tylko poza ekranem pytania; po „Uruchom ponownie”
 *   przerwana sesja zachowana. Dwie „wersje” = ten sam build z innym `sw.js` (scripts/serve-dist.mjs, hook transformSw).
 * Nie zastępuje testu na iPhonie (G05: tryb samolotowy, aktualizacja po „Dodaj do ekranu głównego”).
 */
import { resolve } from 'node:path';
import { expect, test } from './fixtures';
import { startDistServer, type DistServer } from '../../scripts/serve-dist.mjs';
import { BASE_PATH, answer, next, openFresh, progressText, readStore, reloadUntilControlled, startTest, trackExternalRequests, waitOfflineReady } from './helpers';

test('G02 + A04: offline (context.setOffline) po pierwszym pobraniu — start, odpowiedzi i zapis bez sieci', async ({ page, context, baseURL, browserName }) => {
  test.skip(
    browserName === 'webkit',
    'Playwright WebKit 2359: przy context.setOffline(true) blokuje każdą nawigację (także obsługiwaną przez SW) — „WebKit encountered an internal error”. Dla WebKit: test „serwer niedostępny” poniżej.',
  );
  const origin = new URL(baseURL ?? 'http://127.0.0.1').origin;
  const external = trackExternalRequests(page, origin);
  await openFresh(page);
  // Pierwsza instalacja nie przejmuje strony (bez clientsClaim) — kolejne otwarcie jest kontrolowane przez SW.
  await reloadUntilControlled(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Doktor Monika Egzamin' })).toBeVisible();
  await expect(page.getByText('Brak internetu. Nauka działa normalnie', { exact: false })).toBeVisible();
  await startTest(page, 3);
  await expect(page.getByText('Brak internetu. Pytania, objaśnienia i schematy działają', { exact: false })).toBeVisible();
  await answer(page, false);
  await expect(page.locator('section.expl')).toBeVisible();
  await next(page);
  await answer(page, true);
  expect(await readStore(page, 'attempts')).toHaveLength(2);
  // Ponowne otwarcie offline na ekranie pytania (trasa hash).
  await page.reload();
  await expect(progressText(page)).toHaveText('2/3');
  await expect(page.locator('section.expl')).toBeVisible();
  await context.setOffline(false);
  expect(external).toEqual([]);
});

test('G02 (serwer niedostępny): po pierwszym pobraniu aplikacja startuje z cache SW, odpowiedzi zapisują się', async ({ page }) => {
  const server = await startDistServer({ dist: resolve(process.cwd(), 'dist'), base: BASE_PATH, port: 0 });
  try {
    const external = trackExternalRequests(page, new URL(server.url).origin);
    await page.goto(server.url);
    await waitOfflineReady(page);
    await reloadUntilControlled(page);

    // Brak sieci: serwer zrywa każde połączenie (jak brak zasięgu).
    server.hooks.offline = true;
    const before = server.requests.length;
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Doktor Monika Egzamin' })).toBeVisible();
    await startTest(page, 3);
    await answer(page, false);
    await next(page);
    await answer(page, true);
    expect(await readStore(page, 'attempts')).toHaveLength(2);
    await page.reload();
    await expect(progressText(page)).toHaveText('2/3');
    await expect(page.locator('section.expl')).toBeVisible();
    // Żadne żądanie nie dotarło do serwera w trybie offline (wszystko z precache).
    expect(server.requests.length).toBe(before);
    expect(external).toEqual([]);
  } finally {
    await server.close();
  }
});

test.describe('G03: aktualizacja Service Workera', () => {
  let server: DistServer;
  test.beforeEach(async () => {
    server = await startDistServer({ dist: resolve(process.cwd(), 'dist'), base: BASE_PATH, port: 0 });
  });
  test.afterEach(async () => {
    await server.close();
  });

  test('nowa wersja nie przeładowuje aktywnego pytania; baner poza pytaniem; sesja zachowana po aktualizacji', async ({ page }) => {
    await page.goto(server.url);
    await waitOfflineReady(page);
    await reloadUntilControlled(page);

    await startTest(page, 3);
    await answer(page, true);
    const stem = await page.locator('p.stem').textContent();
    await page.evaluate(() => {
      (window as unknown as { __dmeMarker: string }).__dmeMarker = 'przed-aktualizacja';
    });

    // Nowa wersja: zmieniony sw.js → instalacja w tle → stan `waiting`.
    server.hooks.transformSw = (text) => `${text}\n// dme-e2e v2\n`;
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.update();
    });
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state ?? null), { timeout: 20_000 })
      .toBe('installed');

    // Na ekranie pytania: bez przeładowania i bez banera.
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __dmeMarker?: string }).__dmeMarker)).toBe('przed-aktualizacja');
    await expect(page.locator('p.stem')).toHaveText(stem ?? '');
    await expect(page.getByText('Nowa wersja aplikacji jest gotowa', { exact: false })).toHaveCount(0);

    // Poza pytaniem: baner z „Uruchom ponownie”.
    await page.getByRole('button', { name: 'Przerwij test' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Kontynuuj później' }).click();
    await expect(page.getByText('Nowa wersja aplikacji jest gotowa. Po ponownym uruchomieniu przerwana sesja zostanie zachowana.')).toBeVisible();
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Uruchom ponownie' }).click()]);
    await expect(page.getByText('Aplikacja zaktualizowana. Przerwana sesja została zachowana.')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __dmeMarker?: string }).__dmeMarker)).toBeUndefined();
    await expect(page.locator('.resume')).toContainText('1/3');
    expect(await readStore(page, 'attempts')).toHaveLength(1);
  });
});
