/**
 * Przepływy B–F (PRZEKAZANIE §3) na buildzie produkcyjnym z prawdziwym silnikiem, IndexedDB i SW.
 * Każdy test ma świeży kontekst przeglądarki (pusta baza). Nie zastępuje testu na iPhonie (G05).
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  BANK,
  answer,
  currentStem,
  finishTest,
  next,
  openFresh,
  optionTexts,
  progressText,
  readStore,
  screenshot,
  startTest,
  trackExternalRequests,
} from './helpers';

test('B: „Uwzględnij błędy” → runda 2 z oznaczeniem Powtórki i punktem ◆ w historii', async ({ page, baseURL }, testInfo) => {
  const external = trackExternalRequests(page, new URL(baseURL ?? 'http://127.0.0.1').origin);
  await openFresh(page);
  await startTest(page, 5);
  await finishTest(page, (i) => i >= 2); // 2 błędy
  await page.getByRole('button', { name: 'Pokaż wynik' }).click();
  await expect(page.locator('.score')).toHaveText('3 z 5');
  await expect(page.locator('.status-pill')).toContainText('Próg nieosiągnięty');

  await page.getByRole('button', { name: /Uwzględnij błędy/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Nowa runda: Powtórka' })).toBeVisible();
  await expect(sheet).toContainText('5 pytań: 2 do poprawy');
  await sheet.getByRole('button', { name: 'Rozpocznij rundę' }).click();

  await expect(page.locator('.q-meta')).toContainText('Powtórka · runda 2');
  let fromPrevious = 0;
  for (;;) {
    if ((await page.locator('.q-meta', { hasText: 'Z poprzedniej rundy' }).count()) > 0) fromPrevious++;
    await answer(page, true);
    if (await page.getByRole('button', { name: 'Pokaż wynik' }).isVisible()) break;
    await next(page);
  }
  expect(fromPrevious).toBe(2);
  await page.getByRole('button', { name: 'Pokaż wynik' }).click();
  await expect(page.locator('.score')).toHaveText('5 z 5');
  await expect(page.locator('.result-card__tags')).toContainText('Powtórka · runda 2');

  await page.getByRole('button', { name: 'Zamknij i wróć do startu' }).click();
  await page.getByRole('button', { name: 'Historia' }).click();
  await expect(page.getByRole('heading', { name: 'Historia' })).toBeVisible();
  await expect(page.locator('.chart__point[data-shape="circle"]')).toHaveCount(1);
  await expect(page.locator('.chart__point[data-shape="diamond"]')).toHaveCount(1);
  const list = page.locator('ul[aria-label="Lista testów"] > li');
  await expect(list).toHaveCount(2);
  await expect(list.first()).toContainText('Powtórka');
  await page.locator('.chart__point[data-shape="diamond"]').click();
  await expect(page.locator('.chart__selected')).toContainText('Powtórka · runda 2');
  await screenshot(page, testInfo, '06-historia-wykres');
  expect(external).toEqual([]);
});

test('C: Free Flow — numer pytania, odpowiedzi, zakończenie i podsumowanie, historia Free Flow', async ({ page }, testInfo) => {
  await openFresh(page);
  await page.locator('.mode-card', { hasText: 'Free Flow' }).click();
  await expect(page.getByRole('heading', { name: 'Free Flow', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Rozpocznij', exact: true }).click();
  await expect(progressText(page)).toHaveText('Pytanie 1');
  await screenshot(page, testInfo, '07-free-flow');
  await answer(page, true);
  await expect(page.locator('.answer-card--selected-correct')).toContainText('Poprawna odpowiedź');
  await next(page);
  await expect(progressText(page)).toHaveText('Pytanie 2');
  await answer(page, false);
  await next(page);
  await expect(progressText(page)).toHaveText('Pytanie 3');

  await page.getByRole('button', { name: 'Przerwij lub zakończ Free Flow' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Zakończ sesję' }).click();
  await expect(page.locator('.result-card')).toContainText('Sesja zakończona');
  await expect(page.locator('.score')).toHaveText('2');
  await expect(page.locator('.result-card')).toContainText('Poprawne: 1 z 2 · 50%');
  await expect(page.getByText('Free Flow nie ma progu zaliczenia', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Zobacz historię Free Flow' }).click();
  const rows = page.locator('ul[aria-label="Lista sesji Free Flow"] > li');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('2 ocenione pytania · 50% poprawnych');
});

test('D: zgłoszenie z zastępstwem i „Cofnij”; wygaśnięcie po odpowiedzi; „Przywróć” w ustawieniach', async ({ page }) => {
  await openFresh(page);
  await startTest(page, 5);
  await answer(page, true);
  await next(page);
  await answer(page, true);
  await next(page);
  await expect(progressText(page)).toHaveText('2/5');
  const s3 = await currentStem(page);

  // Zgłoszenie przed odpowiedzią → zastępstwo, N bez zmian, „Cofnij”.
  await page.getByRole('button', { name: 'Zgłoś błąd w pytaniu' }).click();
  await expect(page.getByText('Pytanie wykluczone. Zastąpiliśmy je innym.')).toBeVisible();
  await expect(page.locator('p.stem')).not.toHaveText(s3);
  await expect(progressText(page)).toHaveText('2/5');
  await page.getByRole('button', { name: 'Cofnij' }).click();
  await expect(page.getByText('Zgłoszenie cofnięte. Przywrócono poprzedni stan pytania.')).toBeVisible();
  await expect(page.locator('p.stem')).toHaveText(s3);
  expect((await readStore<{ revokedAt: string | null }>(page, 'blocks')).length).toBe(0);

  // Zgłoszenie po odpowiedzi: próba wyłączona z punktacji (3/5 → 2/5), zastępstwo czeka na odpowiedź.
  await answer(page, false);
  await expect(progressText(page)).toHaveText('3/5');
  await page.getByRole('button', { name: 'Zgłoś błąd w pytaniu' }).click();
  await expect(page.getByText('Pytanie wykluczone. Zastąpiliśmy je innym.')).toBeVisible();
  await expect(progressText(page)).toHaveText('2/5');
  const replacement = await currentStem(page);
  expect(replacement).not.toBe(s3);
  // Odpowiedź na zastępstwo → „Cofnij” znika (E05).
  await answer(page, true);
  await expect(progressText(page)).toHaveText('3/5');
  await expect(page.getByRole('button', { name: 'Cofnij' })).toHaveCount(0);
  const attempts = await readStore<{ excluded: boolean }>(page, 'attempts');
  expect(attempts.filter((a) => a.excluded)).toHaveLength(1);

  // „Kontynuuj później” → Ustawienia → Wykluczone → Przywróć.
  await page.getByRole('button', { name: 'Przerwij test' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Kontynuuj później' }).click();
  await page.getByRole('button', { name: 'Ustawienia' }).click();
  await page.getByRole('button', { name: /Wykluczone pytania/ }).click();
  const items = page.locator('.excluded-row');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText(s3.slice(0, 30));
  await items.first().getByRole('button', { name: 'Przywróć' }).click();
  await expect(page.getByText('Pytanie przywrócone do przyszłych losowań. Trwający test i wcześniejsze wyniki pozostają bez zmian.')).toBeVisible();
  await expect(page.getByText('Brak wykluczonych pytań')).toBeVisible();
  const blocks = await readStore<{ revokedAt: string | null }>(page, 'blocks');
  expect(blocks).toHaveLength(1);
  expect(blocks[0]?.revokedAt).not.toBeNull();

  // Odpowiedź na zastępstwo zostaje.
  await page.getByRole('button', { name: 'Wstecz' }).click();
  await page.getByRole('button', { name: 'Wstecz' }).click();
  await page.getByRole('button', { name: 'Kontynuuj', exact: true }).click();
  await expect(page.locator('p.stem')).toHaveText(replacement);
  await expect(page.locator('section.expl')).toBeVisible();
  await expect(progressText(page)).toHaveText('3/5');
});

test('E/F01: przerwanie i „Kontynuuj” po przeładowaniu — to samo pytanie i kolejność; zamknięcie bez wyniku', async ({ page }) => {
  await openFresh(page);
  await startTest(page, 5);
  await answer(page, true);
  await next(page);
  await answer(page, false);
  const s2 = await currentStem(page);
  const o2 = await optionTexts(page);
  const selected2 = await page.locator('.answer-card--selected-wrong').textContent();

  // Przeładowanie strony (zamknięcie karty / przerwanie procesu) po odpowiedzi.
  await page.reload();
  await expect(page.locator('p.stem')).toHaveText(s2);
  expect(await optionTexts(page)).toEqual(o2);
  await expect(page.locator('.answer-card--selected-wrong')).toHaveText(selected2 ?? '');
  await expect(page.locator('section.expl')).toBeVisible();
  await expect(progressText(page)).toHaveText('2/5');
  expect(await readStore(page, 'attempts')).toHaveLength(2);

  await next(page);
  const s3 = await currentStem(page);
  const o3 = await optionTexts(page);
  await page.getByRole('button', { name: 'Przerwij test' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Kontynuuj później' }).click();
  await page.reload();
  await expect(page.locator('.resume')).toContainText('Kontynuuj test');
  await expect(page.locator('.resume')).toContainText('2/5 pytań');
  await page.getByRole('button', { name: 'Kontynuuj', exact: true }).click();
  await expect(page.locator('p.stem')).toHaveText(s3);
  expect(await optionTexts(page)).toEqual(o3);
  await expect(page.locator('section.expl')).toHaveCount(0);

  // Zamknięcie bez wyniku z menu ⋮ na starcie → historia „Niedokończony”, poza wykresem.
  await page.getByRole('button', { name: 'Przerwij test' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Kontynuuj później' }).click();
  await page.getByRole('button', { name: 'Więcej opcji sesji' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Zamknij test bez wyniku' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Zamknij test' }).click();
  await expect(page.getByText('Test zamknięty bez wyniku. W historii oznaczono go jako niedokończony.')).toBeVisible();
  await expect(page.locator('.resume')).toHaveCount(0);
  await page.getByRole('button', { name: 'Historia' }).click();
  const rows = page.locator('ul[aria-label="Lista testów"] > li');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Niedokończony');
  await expect(rows.first()).toContainText('2 z 5 ocenionych');
  await expect(page.locator('.chart__point')).toHaveCount(0);
  await expect(page.getByText('Wykres pokazuje tylko ukończone testy. Niedokończone są wyłącznie na liście.')).toBeVisible();
});

test('F: eksport kopii (pobranie) i import z podsumowaniem i zamianą; uszkodzony plik → błąd bez zmian', async ({ page }, testInfo) => {
  await openFresh(page);
  await startTest(page, 3);
  await answer(page, true);
  await next(page);
  await answer(page, false);
  await page.getByRole('button', { name: 'Przerwij test' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Kontynuuj później' }).click();

  await page.getByRole('button', { name: 'Ustawienia' }).click();
  await expect(page.getByRole('heading', { name: 'Ustawienia' })).toBeVisible();
  await screenshot(page, testInfo, '08-ustawienia');
  // Stan puli (finalny bank): liczby z bank.counts, nota o nieosiągniętym celu i status materiału.
  const pool = BANK as unknown as { counts: { questions: number; families: number; independently_checked_draft: number }; pool_note_pl: string; status_pl: string };
  const poolNote = page.getByRole('note', { name: 'Stan puli pytań' });
  await expect(poolNote).toContainText(`${pool.counts.independently_checked_draft} z ${pool.counts.questions} pytań sprawdzono odrębnym przeglądem AI`);
  await expect(poolNote).toContainText(pool.pool_note_pl);
  await expect(poolNote).toContainText('nie jest oceną komisji egzaminacyjnej');
  await page.getByRole('button', { name: /O bazie pytań/ }).click();
  await expect(page.getByRole('heading', { name: 'O bazie pytań' })).toBeVisible();
  await expect(page.getByText(`Wbudowana pula zawiera ${pool.counts.questions} pytań jednokrotnego wyboru`, { exact: false })).toBeVisible();
  await expect(page.getByText(pool.pool_note_pl)).toBeVisible();
  await expect(page.getByText(pool.status_pl)).toBeVisible();
  await screenshot(page, testInfo, '09-o-bazie');
  await page.getByRole('button', { name: 'Wstecz' }).click();
  await page.getByRole('button', { name: /Kopia danych/ }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Zapisz kopię' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^dme-kopia-\d{4}-\d{2}-\d{2}\.json$/);
  const backupPath = testInfo.outputPath('kopia.json');
  await download.saveAs(backupPath);
  const backup = JSON.parse(readFileSync(backupPath, 'utf-8')) as { format: string; formatVersion: number; data: { attempts: unknown[]; sessions: unknown[] } };
  expect(backup.format).toBe('dme-backup');
  expect(backup.formatVersion).toBe(1);
  expect(backup.data.attempts).toHaveLength(2);
  // LOG-08: aplikacja nie twierdzi, że plik zapisano — wie tylko, że przekazała go do pobrania.
  await expect(page.getByRole('status').filter({ hasText: `Przygotowano plik kopii ${download.suggestedFilename()}.` })).toBeVisible();
  await expect(page.getByText('Zapisano plik', { exact: false })).toHaveCount(0);

  // Import tej kopii: sprawdzenie → podsumowanie → zamiana z kopią bezpieczeństwa.
  await page.locator('input[type="file"]').first().setInputFiles(backupPath);
  await expect(page.getByText('kopia.json — plik poprawny')).toBeVisible();
  await expect(page.getByText('1 przerwana sesja', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Zabezpiecz bieżące dane i zastąp' }).click();
  await expect(page.getByText('Dane wczytane z kopii.')).toBeVisible();
  const safetyPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Pobierz kopię sprzed wczytania' }).click();
  expect((await safetyPromise).suggestedFilename()).toMatch(/^dme-przed-wczytaniem-\d{4}-\d{2}-\d{2}\.json$/);
  expect(await readStore(page, 'attempts')).toHaveLength(2);
  expect(await readStore(page, 'backups')).toHaveLength(1);
  await page.getByRole('button', { name: 'Gotowe' }).click();

  // Uszkodzony plik: czytelny błąd, dane bez zmian.
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'uszkodzona.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"dme-backup","formatVersion":1,') });
  await expect(page.getByText('Nie można wczytać pliku „uszkodzona.json”.', { exact: true })).toBeVisible();
  await expect(page.getByText('Plik jest uszkodzony albo nie jest kopią tej aplikacji.')).toBeVisible();
  await expect(page.getByText('Dane na tym urządzeniu nie zostały zmienione.')).toBeVisible();
  expect(await readStore(page, 'attempts')).toHaveLength(2);
  await page.getByRole('button', { name: 'Wstecz' }).click();
  await page.getByRole('button', { name: 'Wstecz' }).click();
  await expect(page.locator('.resume')).toContainText('2/3 pytania');
});
