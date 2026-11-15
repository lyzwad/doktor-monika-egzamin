/**
 * Narzędzia e2e aktualizacji (tests/e2e/aktualizacja.ts): `collectProblems` musi oblać asercję „0 błędów”, gdy kod
 * strony rzuci nieobsłużony wyjątek (np. nowy kod na zmigrowanych danych) — także w kroku z pauzą zbierania błędów
 * konsoli (offline), bo nieobsłużony wyjątek nigdy nie jest oczekiwany. Wyjątek: komunikat WebKit o przerwanym
 * pobieraniu WYŁĄCZNIE plików pomocniczych (`sw.js`, `pwa-precache.json`, `dme-release.json`) trafia na osobną listę.
 * Odpowiedzi ≥ 400 są zbierane także w kroku z pauzą (offline odpowiada tylko Service Worker).
 */
import { collectProblems } from './aktualizacja';
import { expect, test } from './fixtures';

test('collectProblems: nieobsłużony wyjątek strony (pageerror) trafia do błędów, także w kroku z pauzą', async ({ context }) => {
  const problems = collectProblems(context, []);
  const page = await context.newPage();
  await page.goto('about:blank');
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('wstrzyknięty błąd testu 1');
    }, 0);
  });
  await expect.poll(() => problems.console.join('\n')).toContain('wstrzyknięty błąd testu 1');

  problems.paused = true;
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('wstrzyknięty błąd testu 2');
    }, 0);
  });
  await expect.poll(() => problems.console.join('\n')).toContain('wstrzyknięty błąd testu 2');
});

test('collectProblems: komunikat WebKit o przerwanym pobieraniu pliku pomocniczego → osobna lista; innego pliku i zwykły błąd → błędy', async ({ context }) => {
  const problems = collectProblems(context, []);
  const page = await context.newPage();
  await page.goto('about:blank');
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('Fetch API cannot load http://127.0.0.1:1/pwa-precache.json due to access control checks.');
    }, 0);
    setTimeout(() => {
      throw new Error('Fetch API cannot load http://127.0.0.1:1/data/bank-475c1fef0099.json due to access control checks.');
    }, 5);
    setTimeout(() => {
      throw new TypeError('wstrzyknięty błąd testu 3');
    }, 10);
  });
  await expect.poll(() => problems.console.join('\n')).toContain('wstrzyknięty błąd testu 3');
  await expect.poll(() => problems.console.join('\n')).toContain('data/bank-475c1fef0099.json');
  expect(problems.console.join('\n')).not.toContain('pwa-precache.json');
  expect(problems.network.join('\n')).toContain('pwa-precache.json');
});

test('collectProblems: odpowiedź ≥ 400 jest zbierana także w kroku z pauzą (offline odpowiada Service Worker)', async ({ context, baseURL }) => {
  const problems = collectProblems(context, []);
  const page = await context.newPage();
  problems.paused = true;
  await page.goto(`${baseURL}brak-pliku-testu.json`);
  await expect.poll(() => problems.http.join('\n')).toContain('404');
});
