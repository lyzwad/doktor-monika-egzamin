/**
 * Stany systemowe na buildzie produkcyjnym: brak IndexedDB (zablokowane dane witryn, przeglądarka bez
 * lokalnej bazy) → ekran błędu z wyjaśnieniem; nauka bez zapisu na urządzeniu nie jest uruchamiana.
 */
import { expect, test } from '@playwright/test';

test('brak IndexedDB → komunikat „Nie można uruchomić aplikacji” z wyjaśnieniem, bez ekranów nauki', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => undefined });
  });
  await page.goto('./');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Nie można uruchomić aplikacji');
  await expect(alert).toContainText('IndexedDB');
  await expect(alert).toContainText('nauka nie jest możliwa');
  await expect(page.getByRole('button', { name: 'Spróbuj ponownie' })).toBeVisible();
  await expect(page.locator('.mode-card')).toHaveCount(0);
  // Ponowienie nie udaje sukcesu.
  await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
  await expect(alert).toContainText('Nie można uruchomić aplikacji');
});

test('odmowa otwarcia IndexedDB (tryb prywatny / zablokowane dane witryn) → komunikat bez nauki; po odblokowaniu „Spróbuj ponownie” uruchamia aplikację', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __dmeDenyIdb: boolean };
    w.__dmeDenyIdb = true;
    const originalOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (this: IDBFactory, ...args: Parameters<IDBFactory['open']>) {
      if (w.__dmeDenyIdb) throw new DOMException('Symulacja trybu prywatnego (e2e)', 'SecurityError');
      return originalOpen.apply(this, args);
    };
  });
  await page.goto('./');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Nie można uruchomić aplikacji');
  await expect(alert).toContainText('Lokalna baza danych jest niedostępna');
  await expect(alert).toContainText('nauka nie jest możliwa');
  await expect(page.locator('.mode-card')).toHaveCount(0);
  await page.evaluate(() => {
    (window as unknown as { __dmeDenyIdb: boolean }).__dmeDenyIdb = false;
  });
  await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Doktor Monika Egzamin' })).toBeVisible();
  await expect(page.locator('.mode-card')).toHaveCount(2);
});
