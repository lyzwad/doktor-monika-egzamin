/**
 * Przepływ A (PRZEKAZANIE §3) na prawdziwym silniku: Start → Test (domyślnie 20) → odpowiedź błędna →
 * komentarz → „Dalej” … → „Pokaż wynik” → „Przejrzyj błędy” (tylko błędy) → szczegół.
 * Dodatkowo B04 (brak klucza w DOM przed odpowiedzią), B05 (znaczenie nie tylko kolorem), A04 (brak
 * żądań zewnętrznych w czasie nauki) i zrzuty ekranu kluczowych stanów (WebKit, 393×852).
 */
import { expect, test } from '@playwright/test';
import { BANK, answer, currentQuestion, finishTest, next, openFresh, progressText, screenshot, trackExternalRequests } from './helpers';

test('A: test 20 — błędna odpowiedź, komentarz, Dalej, wynik, przegląd tylko błędów', async ({ page, baseURL }, testInfo) => {
  const external = trackExternalRequests(page, new URL(baseURL ?? 'http://127.0.0.1').origin);
  await openFresh(page);
  await screenshot(page, testInfo, '01-start');

  await page.locator('.mode-card', { hasText: 'Wybierz liczbę pytań' }).click();
  await expect(page.getByRole('heading', { name: 'Test', level: 1 })).toBeVisible();
  // C01: pierwsze ustawienia 20 / Mieszany / Cały zakres.
  await expect(page.getByRole('textbox', { name: 'Liczba pytań' })).toHaveValue('20');
  await expect(page.locator('.select-row__value')).toHaveText('Cały zakres');
  await screenshot(page, testInfo, '02-konfiguracja-testu');
  await page.getByRole('button', { name: 'Rozpocznij test' }).click();

  await expect(progressText(page)).toHaveText('0/20');
  const q1 = await currentQuestion(page);
  // B04: przed odpowiedzią w DOM nie ma wyjaśnienia ani oznaczeń poprawności (także w atrybutach).
  const html = await page.content();
  expect(html).not.toContain(q1.correct_explanation_pl.slice(0, 60));
  expect(html).not.toMatch(/answer-card--(selected|correct)|Poprawna odpowiedź|Twoja odpowiedź/);
  // …ani źródeł i lokatora (mogłyby wskazać klucz), ani identyfikatora klucza w atrybutach (alt, title, aria, data-*).
  const sources = q1.source_ids.map((id) => BANK.sources[id]).filter((s) => s !== undefined);
  expect(sources.length).toBeGreaterThan(0);
  for (const s of sources) {
    expect(html).not.toContain(s.title.slice(0, 50));
    if (s.url) expect(html).not.toContain(s.url);
  }
  expect(html).not.toContain(q1.source_locator_pl.slice(0, 40));
  const attrs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#root *')).flatMap((el) =>
      Array.from(el.attributes)
        .filter((a) => /^(alt|title|aria-.*|data-.*)$/.test(a.name))
        .map((a) => `${a.name}=${a.value}`),
    ),
  );
  expect(attrs.filter((a) => /poprawn|correct|klucz|błędn/i.test(a))).toEqual([]);
  await expect(page.locator('section.expl')).toHaveCount(0);
  await expect(page.getByText('Dotknij odpowiedzi, aby ją zatwierdzić.')).toBeVisible();
  await screenshot(page, testInfo, '03-pytanie-przed-odpowiedzia');

  await answer(page, false);
  // B05: błąd i poprawna odpowiedź oznaczone tekstem, nie tylko kolorem.
  await expect(page.locator('.answer-card--selected-wrong')).toContainText('Twoja odpowiedź — błędna');
  await expect(page.locator('.answer-card--correct-unselected')).toContainText('Poprawna odpowiedź');
  await expect(page.locator('section.expl')).toContainText(q1.correct_explanation_pl.slice(0, 40));
  // B06: wyjaśnienie ma źródło (tytuł z rejestru) — dopiero po odpowiedzi.
  await expect(page.locator('section.expl .source-row__title').first()).toBeVisible();
  await expect(page.locator('section.expl')).toContainText(sources[0]?.title.slice(0, 40) ?? '');
  await expect(progressText(page)).toHaveText('1/20');
  await screenshot(page, testInfo, '04-odpowiedz-bledna-wyjasnienie');
  await next(page);

  // Pozostałe 19: poprawne oprócz 3 (łącznie 4 błędy → 16/20).
  await finishTest(page, (i) => i % 5 !== 0, 1);
  await expect(progressText(page)).toHaveText('20/20');
  // Ostatni komentarz zostaje do „Pokaż wynik” (B06).
  await expect(page.locator('section.expl')).toBeVisible();
  await page.getByRole('button', { name: 'Pokaż wynik' }).click();

  await expect(page.getByRole('heading', { name: 'Wynik testu' })).toBeVisible();
  await expect(page.locator('.score')).toHaveText('16 z 20');
  await expect(page.locator('.score-pct')).toHaveText('80%');
  await expect(page.locator('.status-pill')).toContainText('Test zaliczony');
  await screenshot(page, testInfo, '05-wynik');

  await page.getByRole('button', { name: 'Przejrzyj błędy (4)' }).click();
  await expect(page.getByRole('heading', { name: 'Przegląd odpowiedzi' })).toBeVisible();
  const rows = page.locator('ul[aria-label="Pozycje przeglądu"] > li');
  await expect(rows).toHaveCount(4);
  await expect(rows.locator('.review-row__status--wrong')).toHaveCount(4);
  await rows.first().click();
  await expect(page.locator('.preview-bar')).toContainText('tylko do odczytu');
  await expect(page.locator('.answer-card--selected-wrong')).toHaveCount(1);
  await expect(page.locator('section.expl')).toBeVisible();
  await expect(page.locator('ul.answers button')).toHaveCount(0);

  expect(external).toEqual([]);
});
