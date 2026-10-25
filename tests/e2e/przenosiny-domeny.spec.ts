/**
 * Przenosiny na nową domenę (24.10.2026: https://lyzwad.github.io/doktor-monika-egzamin/ → https://wiedza.doktormonika.pl/).
 * Dane IndexedDB należą do originu, więc nowy adres startuje pusty. Jedyna droga przeniesienia postępów to plik kopii:
 * „Zapisz kopię” na starym adresie → „Wczytaj kopię” na nowym. Test odtwarza to na dwóch originach (dwa serwery
 * z tym samym `dist`, różne porty) w osobnych kontekstach przeglądarki. Nie zastępuje testu na iPhonie (G05).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './fixtures';
import { startDistServer } from '../../scripts/serve-dist.mjs';
import { BASE_PATH, finishTest, readStore, startTest, waitOfflineReady } from './helpers';

test('przenosiny: kopia ze starego originu wczytana na nowym — historia, wykres i runda błędów', async ({ page, browser }, testInfo) => {
  // Stary adres: test 5 pytań z 2 błędami, potem zapis kopii.
  await page.goto('./');
  await waitOfflineReady(page);
  await startTest(page, 5);
  await finishTest(page, (i) => i >= 2);
  await page.getByRole('button', { name: 'Pokaż wynik' }).click();
  await expect(page.locator('.score')).toHaveText('3 z 5');
  await page.getByRole('button', { name: 'Zamknij i wróć do startu' }).click();
  await page.getByRole('button', { name: 'Ustawienia' }).click();
  await page.getByRole('button', { name: /Kopia danych/ }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Zapisz kopię' }).click();
  const backupPath = testInfo.outputPath('kopia-stary-adres.json');
  await (await downloadPromise).saveAs(backupPath);
  const backup = JSON.parse(readFileSync(backupPath, 'utf-8')) as { format: string; data: { attempts: unknown[]; sessions: unknown[] } };
  expect(backup.format).toBe('dme-backup');
  expect(backup.data.attempts).toHaveLength(5);

  // Nowy adres: inny origin, czysty profil przeglądarki.
  const server = await startDistServer({ dist: resolve(process.cwd(), 'dist'), base: BASE_PATH, port: 0 });
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined, acceptDownloads: true });
  try {
    const fresh = await context.newPage();
    expect(new URL(server.url).origin).not.toBe(new URL(page.url()).origin);
    await fresh.goto(server.url);
    await waitOfflineReady(fresh);
    // Nowe urządzenie: najpierw wybór profilu (bez hasła), potem pusta historia tego profilu.
    await expect(fresh.getByRole('heading', { level: 1, name: 'Wybierz profil' })).toBeVisible();
    await fresh.getByRole('button', { name: 'monika@doktormonika.pl' }).click();
    await expect(fresh.getByRole('heading', { level: 1, name: 'Doktor Monika Egzamin' })).toBeVisible();
    expect(await readStore(fresh, 'attempts')).toHaveLength(0);

    await fresh.getByRole('button', { name: 'Ustawienia' }).click();
    await fresh.getByRole('button', { name: /Kopia danych/ }).click();
    await fresh.locator('input[type="file"]').first().setInputFiles(backupPath);
    await expect(fresh.getByText('kopia-stary-adres.json — plik poprawny')).toBeVisible();
    // Kopia z mailem profilu: profil źródłowy i docelowy widoczne przed zastąpieniem.
    await expect(fresh.getByText('Profil w pliku:')).toContainText('monika@doktormonika.pl');
    await expect(fresh.getByRole('radio', { name: /monika@doktormonika\.pl/ })).toHaveAttribute('aria-checked', 'true');
    await fresh.getByRole('button', { name: 'Zabezpiecz bieżące dane i zastąp' }).click();
    await expect(fresh.getByText('Dane wczytane z kopii.')).toBeVisible();
    expect(await readStore(fresh, 'attempts')).toHaveLength(5);
    await fresh.getByRole('button', { name: 'Gotowe' }).click();
    await fresh.getByRole('button', { name: 'Wstecz' }).click();
    await fresh.getByRole('button', { name: 'Wstecz' }).click();

    // Historia i wykres z przeniesionym wynikiem; dane zostają po ponownym otwarciu.
    await fresh.reload();
    await fresh.getByRole('button', { name: 'Historia' }).click();
    await expect(fresh.getByRole('heading', { name: 'Historia' })).toBeVisible();
    await expect(fresh.locator('ul[aria-label="Lista testów"] > li')).toHaveCount(1);
    await expect(fresh.locator('.chart__point[data-shape="circle"]')).toHaveCount(1);
    await fresh.locator('ul[aria-label="Lista testów"] > li').first().click();
    await expect(fresh.locator('.score')).toHaveText('3 z 5');

    // Runda błędów z przeniesionej sesji działa na nowym adresie.
    await fresh.getByRole('button', { name: /Uwzględnij błędy/ }).click();
    await expect(fresh.getByRole('dialog')).toContainText('2 do poprawy');
  } finally {
    await context.close();
    await server.close();
  }
});
