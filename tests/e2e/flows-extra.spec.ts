/**
 * Dodatkowe przepływy na buildzie produkcyjnym z prawdziwym silnikiem i IndexedDB:
 * - E04: zgłoszenie w przeglądzie zamkniętego testu — wynik bez zmian, adnotacja „Wykluczone później”, blokada;
 * - PRZEKAZANIE §8: nowa sesja przy przerwanym teście — informacja na konfiguracji, test trafia do historii
 *   jako niedokończony;
 * - D06: Free Flow z „Moje błędy” — najpierw aktywne błędy, po ich wyczerpaniu jednorazowa informacja
 *   i zwykłe pytania.
 * Nie zastępuje testu na fizycznym iPhonie (G05).
 */
import { expect, test } from './fixtures';
import { answer, currentStem, finishTest, next, openFresh, progressText, readStore, startTest } from './helpers';

test('E04: zgłoszenie w przeglądzie zamkniętego testu nie zmienia wyniku, oznacza pozycję i blokuje przyszłość', async ({ page }) => {
  await openFresh(page);
  await startTest(page, 2);
  await finishTest(page, (i) => i > 0); // błędna, poprawna
  await page.getByRole('button', { name: 'Pokaż wynik' }).click();
  await expect(page.locator('.score')).toHaveText('1 z 2');

  await page.getByRole('button', { name: 'Przejrzyj odpowiedzi' }).click();
  const rows = page.locator('ul[aria-label="Pozycje przeglądu"] > li');
  await expect(rows).toHaveCount(2);
  await rows.first().click();
  const stem = await currentStem(page);
  await page.getByRole('button', { name: 'Zgłoś błąd w pytaniu' }).click();
  await expect(page.getByText('Pytanie wykluczone z przyszłej nauki. Wynik tego testu się nie zmienia.')).toBeVisible();
  await expect(page.locator('.q-meta')).toContainText('Wykluczone później');
  await expect(page.getByRole('button', { name: 'Zgłoś błąd w pytaniu' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Wróć do listy' }).first().click();
  await expect(rows.filter({ hasText: 'Wykluczone później' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Wróć do wyniku' }).click();
  await expect(page.locator('.score')).toHaveText('1 z 2');
  const sessions = await readStore<{ status: string; result: { correct: number; targetN: number } | null }>(page, 'sessions');
  expect(sessions.map((s) => [s.status, s.result?.correct, s.result?.targetN])).toEqual([['completed', 1, 2]]);
  const blocks = await readStore<{ revokedAt: string | null; stemPreview: string }>(page, 'blocks');
  expect(blocks).toHaveLength(1);
  expect(blocks[0]?.revokedAt).toBeNull();
  expect(stem.startsWith(blocks[0]?.stemPreview.slice(0, 30) ?? '-')).toBe(true);
});

test('nowa sesja przy przerwanym teście: informacja na konfiguracji, test w historii jako niedokończony', async ({ page }) => {
  await openFresh(page);
  await startTest(page, 3);
  await answer(page, true);
  await page.getByRole('button', { name: 'Przerwij test' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Kontynuuj później' }).click();
  await expect(page.locator('.resume')).toContainText('1/3');

  await page.locator('.mode-card', { hasText: 'Free Flow' }).click();
  await expect(page.getByText('Masz przerwany test (1/3). Rozpoczęcie nowej sesji zapisze go w historii jako niedokończony.')).toBeVisible();
  await page.getByRole('button', { name: 'Rozpocznij', exact: true }).click();
  await expect(progressText(page)).toHaveText('Pytanie 1');
  await page.getByRole('button', { name: 'Przerwij lub zakończ Free Flow' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Kontynuuj później' }).click();
  await expect(page.locator('.resume')).toContainText('Free Flow');

  await page.getByRole('button', { name: 'Historia' }).click();
  const tests = page.locator('ul[aria-label="Lista testów"] > li');
  await expect(tests).toHaveCount(1);
  await expect(tests.first()).toContainText('Niedokończony');
  await expect(tests.first()).toContainText('1 z 3 ocenionych');
  await expect(page.locator('.chart__point')).toHaveCount(0);
});

test('D06: Free Flow z „Moje błędy” — najpierw aktywne błędy, potem jednorazowa informacja i zwykłe pytania', async ({ page }) => {
  await openFresh(page);
  await startTest(page, 2);
  const wrongStems: string[] = [];
  for (let i = 0; i < 2; i++) {
    wrongStems.push(await currentStem(page));
    await answer(page, false);
    if (i === 0) await next(page);
  }
  await page.getByRole('button', { name: 'Pokaż wynik' }).click();
  await expect(page.locator('.score')).toHaveText('0 z 2');
  await page.getByRole('button', { name: 'Wróć do startu', exact: true }).click();

  await page.locator('.mode-card', { hasText: 'Free Flow' }).click();
  const myErrors = page.getByRole('switch', { name: /Moje błędy/ });
  await myErrors.click();
  await expect(myErrors).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Najpierw 2 pytania z wcześniejszymi błędami, potem zwykły zakres.')).toBeVisible();
  await page.getByRole('button', { name: 'Rozpocznij', exact: true }).click();

  const shown: string[] = [];
  for (let i = 0; i < 2; i++) {
    await expect(page.locator('.q-meta')).toContainText('Moje błędy');
    shown.push(await currentStem(page));
    await answer(page, true);
    await next(page);
  }
  expect([...shown].sort()).toEqual([...wrongStems].sort());
  await expect(page.getByText('Brak aktywnych błędów w tym zakresie — kontynuujesz zwykłe pytania.')).toBeVisible();
  await expect(page.locator('.q-meta')).not.toContainText('Moje błędy');
  expect(wrongStems).not.toContain(await currentStem(page));
  await answer(page, true);
  await next(page);
  await expect(page.getByText('Brak aktywnych błędów w tym zakresie — kontynuujesz zwykłe pytania.')).toHaveCount(0);
});
