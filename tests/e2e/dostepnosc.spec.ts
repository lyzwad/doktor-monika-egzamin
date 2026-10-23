/**
 * PRZEKAZANIE §13 (UI-02): pułapka fokusu w arkuszach i oknach dialogowych — w WebKit (Safari) Tab
 * nie może wyprowadzić fokusu do tła (WebKit domyślnie pomija przyciski przy Tab), Escape zamyka
 * arkusz, a fokus wraca do wywołującego elementu. Ten sam scenariusz w Chromium.
 */
import { expect, test, type Page } from '@playwright/test';
import { BANK, answer, next, openFresh, startTest } from './helpers';

async function activeInDialog(page: Page): Promise<{ inDialog: boolean; label: string }> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return {
      inDialog: !!a?.closest('[role="dialog"], [role="alertdialog"]'),
      label: (a?.getAttribute('aria-label') ?? a?.textContent ?? a?.tagName ?? '').trim().slice(0, 40),
    };
  });
}

async function expectTrapped(page: Page, presses: number, key: 'Tab' | 'Shift+Tab'): Promise<Set<string>> {
  const visited = new Set<string>();
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press(key);
    const a = await activeInDialog(page);
    expect(a.inDialog, `${key} nr ${i + 1}: fokus poza dialogiem (${a.label})`).toBe(true);
    visited.add(a.label);
  }
  return visited;
}

test('UI-02: arkusz „Zakres” — Tab/Shift+Tab krążą w arkuszu, Escape zamyka i oddaje fokus', async ({ page }) => {
  await openFresh(page);
  await page.locator('.mode-card', { hasText: 'Wybierz liczbę pytań' }).click();
  const opener = page.locator('.select-row');
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect((await activeInDialog(page)).inDialog).toBe(true);
  const items = await dialog.locator('button').count();
  const forward = await expectTrapped(page, items + 3, 'Tab');
  expect(forward.size).toBeGreaterThan(1);
  await expectTrapped(page, items + 3, 'Shift+Tab');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('UI-02: arkusz „Przerwać test?” na ekranie pytania — fokus zostaje w arkuszu', async ({ page }) => {
  await openFresh(page);
  await startTest(page, 2);
  const opener = page.getByRole('button', { name: 'Przerwij test' });
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Przerwać test?' })).toBeVisible();
  await expectTrapped(page, 6, 'Tab');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
});

/**
 * E03 (zgłoszenia E03-SLEPY-ZAULEK-UI / LOG-03): zgłoszenie wcześniejszej pozycji, gdy w zakresie nie
 * ma zastępstwa — ostatnia pozycja nie zostaje bez akcji: „Przejdź do pytania 1” i baner z wyjaśnieniem;
 * pozycja oczekująca ma baner S24g z akcjami; karta „Kontynuuj” podaje liczbę oczekujących.
 * Koszyk (domena × poziom) o najmniejszej liczbie rodzin wybierany z banku na dysku — bez założeń o jego wielkości.
 * W banku release-2026-10-23c najmniejszy koszyk ma 19 rodzin (SKIN/zaawansowany); dawny próg 12
 * pomijał test po cichu, więc próg podniesiono do 40 (test odpowiada na N pytań — czas rośnie liniowo).
 */
test('E03: brak zastępstwa dla wcześniejszej pozycji — na ostatniej przycisk do pozycji oczekującej, bez martwego ekranu', async ({ page }) => {
  test.setTimeout(180_000);
  const families = new Map<string, Set<string>>();
  for (const q of BANK.questions as Array<{ domain_id: string; difficulty?: string; family_id: string }>) {
    const key = `${q.domain_id}|${q.difficulty ?? ''}`;
    if (!families.has(key)) families.set(key, new Set());
    families.get(key)?.add(q.family_id);
  }
  const [cellKey, fams] = [...families.entries()].filter(([, f]) => f.size >= 3).sort((a, b) => a[1].size - b[1].size)[0] ?? ['', new Set<string>()];
  const [domainId, difficulty] = cellKey.split('|');
  const n = fams.size;
  test.skip(n === 0 || n > 40, `brak małego koszyka w banku (najmniejszy: ${n} rodzin)`);
  const domainTitle = BANK.domains.find((d) => d.id === domainId)?.title_pl ?? '';
  const levelLabel = { basic: 'Łatwy', intermediate: 'Średni', advanced: 'Trudny' }[difficulty as 'basic'] ?? '';

  await openFresh(page);
  await page.locator('.mode-card', { hasText: 'Wybierz liczbę pytań' }).click();
  await page.locator('.select-row').click();
  await page.getByRole('radio', { name: new RegExp(`^${domainTitle}`) }).click();
  await page.getByRole('radio', { name: levelLabel, exact: true }).click();
  await page.getByRole('textbox', { name: 'Liczba pytań' }).fill(String(n));
  await page.getByRole('button', { name: 'Rozpocznij test' }).click();
  await expect(page.locator('p.stem')).toBeVisible();

  await answer(page, true);
  await next(page);
  await page.getByRole('button', { name: 'Poprzednie pytanie' }).click();
  await expect(page.getByText('Podgląd odpowiedzi')).toBeVisible();
  await page.getByRole('button', { name: 'Zgłoś błąd w pytaniu' }).click();
  await expect(page.getByText('Brak pytania zastępczego')).toBeVisible();
  await page.getByRole('button', { name: 'Do bieżącego' }).click();
  for (let i = 1; i < n; i++) {
    await answer(page, true);
    if (i < n - 1) await next(page);
  }
  await expect(page.getByRole('button', { name: 'Pokaż wynik' })).toHaveCount(0);
  await expect(page.getByText('Wynik jeszcze niedostępny')).toBeVisible();
  await expect(page.locator('.progress-header__text')).toHaveText(`${n - 1}/${n}`);
  await page.getByRole('button', { name: /Przejdź do pytania 1/ }).click();
  await expect(page.getByText('Brak pytania zastępczego')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zamknij test jako niedokończony' })).toBeVisible();
  await page.getByRole('button', { name: 'Wróć do startu — test zostanie zachowany' }).click();
  await expect(page.getByText('Jedno pytanie czeka na zastępstwo.')).toBeVisible();
  // „Kontynuuj” wraca na ostatnią pozycję z akcją (nie na martwy ekran).
  await page.getByRole('button', { name: 'Kontynuuj' }).click();
  await expect(page.getByRole('button', { name: /Przejdź do pytania 1/ })).toBeVisible();
});

test('UI-03: odpowiedź wybrana klawiaturą — fokus na nagłówku wyjaśnienia (nie na <body>), dalej „Dalej”', async ({ page }) => {
  await openFresh(page);
  await startTest(page, 2);
  const first = page.locator('ul.answers button.answer-card').first();
  await first.focus();
  await page.keyboard.press('Enter');
  const heading = page.getByRole('heading', { name: 'Dlaczego ta odpowiedź jest poprawna' });
  await expect(heading).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  // Komunikat wyniku nadal przez role=status (bez przejmowania fokusu przez komunikat).
  await expect(page.getByRole('status').filter({ hasText: /Odpowiedź (poprawna|błędna)/ })).toHaveCount(1);
  // Kolejny element interaktywny osiągalny klawiaturą z miejsca fokusu (nie „utknięcie” na body).
  const dalej = page.getByRole('button', { name: 'Dalej' });
  await dalej.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('ul.answers button.answer-card')).toHaveCount(4);
});
