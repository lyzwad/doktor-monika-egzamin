/**
 * B03 (pierwszy tap ocenia; drugi szybki tap / dwuklik nic nie zmienia; restart nie dopisuje prób)
 * i C01 (walidacja liczby pytań w UI: puste, 0, ujemne, ułamki, tekst, ponad pojemność; ±10, szybkie wartości).
 */
import { expect, test } from './fixtures';
import { BANK, answer, next, openFresh, optionIndex, progressText, readStore, startTest } from './helpers';

test('B03: drugi szybki tap innej opcji i dwuklik tej samej nie zmieniają wyboru ani licznika', async ({ page }) => {
  await openFresh(page);
  await startTest(page, 3);
  const wrong = await optionIndex(page, false);
  const right = await optionIndex(page, true);
  // Oba kliknięcia w tym samym zadaniu przeglądarki — zanim React odświeży widok.
  await page.evaluate(
    ([w, r]) => {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('ul.answers button.answer-card'));
      buttons[w]?.click();
      buttons[r]?.click();
      buttons[w]?.click();
    },
    [wrong, right] as const,
  );
  await expect(page.locator('section.expl')).toBeVisible();
  await expect(page.locator('.answer-card--selected-wrong')).toHaveCount(1);
  await expect(page.locator('.answer-card--selected-correct')).toHaveCount(0);
  await expect(progressText(page)).toHaveText('1/3');
  expect(await readStore(page, 'attempts')).toHaveLength(1);

  // Dwuklik w kolejnym pytaniu.
  await next(page);
  const idx = await optionIndex(page, true);
  await page.locator('ul.answers > li').nth(idx).locator('button').dblclick();
  await expect(page.locator('.answer-card--selected-correct')).toHaveCount(1);
  await expect(progressText(page)).toHaveText('2/3');
  expect(await readStore(page, 'attempts')).toHaveLength(2);

  // Podgląd poprzedniego i restart nie dopisują prób.
  await page.getByRole('button', { name: 'Poprzednie pytanie' }).click();
  await expect(page.locator('.preview-bar')).toContainText('Podgląd odpowiedzi');
  await expect(page.locator('ul.answers button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Do bieżącego' }).click();
  await page.reload();
  await expect(page.locator('section.expl')).toBeVisible();
  await expect(progressText(page)).toHaveText('2/3');
  expect(await readStore(page, 'attempts')).toHaveLength(2);
  await next(page);
  await answer(page, true);
  await expect(page.getByRole('button', { name: 'Pokaż wynik' })).toBeVisible();
});

test('C01: walidacja liczby pytań w konfiguracji testu', async ({ page }) => {
  const capacity = new Set(BANK.questions.map((q) => q.family_id)).size;
  await openFresh(page);
  await page.locator('.mode-card', { hasText: 'Wybierz liczbę pytań' }).click();
  const input = page.getByRole('textbox', { name: 'Liczba pytań' });
  const start = page.getByRole('button', { name: 'Rozpocznij test' });
  await expect(input).toHaveValue('20');
  await expect(start).toBeEnabled();
  // C01: pojemność = różne zadania (rodziny), obok liczba pytań — spójnie z „O bazie”.
  await expect(page.getByText(`Dostępne w tym zakresie: ${capacity} różnych zadań (rodzin), łącznie ${BANK.questions.length} pytań`, { exact: false })).toBeVisible();
  await expect(page.locator('.select-row__meta')).toHaveText(`${capacity} różnych zadań (rodzin) · ${BANK.questions.length} pytań`);

  const cases: Array<[string, string]> = [
    ['', 'Wpisz liczbę pytań.'],
    ['0', 'Liczba pytań musi być większa od zera.'],
    ['-5', 'Liczba pytań musi być większa od zera.'],
    ['2,5', 'Wpisz liczbę całkowitą, np. 25.'],
    ['1.5', 'Wpisz liczbę całkowitą, np. 25.'],
    ['abc', 'Wpisz liczbę całkowitą, np. 25.'],
    [String(capacity + 1), `W tym zakresie dostępnych jest mniej różnych zadań (${capacity}).`],
  ];
  for (const [value, message] of cases) {
    await input.fill(value);
    await expect(page.getByText(message, { exact: false })).toBeVisible();
    await expect(start).toBeDisabled();
  }
  // Działanie naprawcze „Ustaw <pojemność>”.
  await page.getByRole('button', { name: `Ustaw ${capacity}` }).click();
  await expect(input).toHaveValue(String(capacity));
  await expect(start).toBeEnabled();

  // ±10 i szybkie wartości.
  await input.fill('20');
  await page.getByRole('button', { name: 'Zwiększ o 10' }).click();
  await expect(input).toHaveValue('30');
  await page.getByRole('button', { name: 'Zmniejsz o 10' }).click();
  await expect(input).toHaveValue('20');
  await page.getByRole('group', { name: 'Szybki wybór' }).getByRole('button', { name: '40' }).click();
  await expect(input).toHaveValue('40');
  await start.click();
  await expect(progressText(page)).toHaveText('0/40');
});
