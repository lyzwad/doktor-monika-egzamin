/**
 * Profile lokalne (DECYZJE §16) w przeglądarce, na buildzie produkcyjnym:
 *  1. aktualizacja z wersji bez profili (commit `b50eb19` — wdrożona 25.10.2026 na wiedza.doktormonika.pl) pod tym
 *     samym adresem: nowy SW przejmuje karty, ekran wyboru z historią bez profilu, przypisanie przez UI, wznowienie
 *     rozpoczętej sesji V15, druga karta widzi, że historia jest już przypisana; dane źródłowe nietknięte;
 *  2. profil A → test → profil B pusty → A z wynikiem; zapamiętanie profilu; dwie karty z różnymi profilami;
 *  3. profile offline (serwer niedostępny): zmiana profilu i nauka bez sieci.
 * To nie zastępuje testu na fizycznym iPhonie (G05).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { startDistServer, type DistServer } from '../../scripts/serve-dist.mjs';
import { expect, test } from './fixtures';
import { BASE_PATH, answer, finishTest, profileDb, readStore, reloadUntilControlled, screenshot, startTest, waitOfflineReady } from './helpers';

const PRE_PROFILES_REF = 'b50eb19';
const OLD_SRC = resolve(process.cwd(), 'test-results', 'zrodlo-przed-profilami');
const OLD_DIST = resolve(process.cwd(), 'test-results', 'dist-przed-profilami');
const NEW_DIST = resolve(process.cwd(), 'dist');
const MONIKA = 'monika@doktormonika.pl';
const IZA = 'iza@doktormonika.pl';
const LEGACY_DB = 'doktor-monika-egzamin';

/** Build wersji bez profili (raz na przebieg): `git archive` → vite build z tym samym BASE_PATH. */
function ensurePreProfilesDist(): void {
  if (existsSync(resolve(OLD_DIST, 'sw.js'))) return;
  rmSync(OLD_SRC, { recursive: true, force: true });
  mkdirSync(OLD_SRC, { recursive: true });
  const archive = execFileSync('git', ['archive', PRE_PROFILES_REF], { maxBuffer: 256 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', OLD_SRC], { input: archive });
  symlinkSync(resolve(process.cwd(), 'node_modules'), resolve(OLD_SRC, 'node_modules'));
  execFileSync(process.execPath, [resolve(OLD_SRC, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', OLD_DIST, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: OLD_SRC,
    env: { ...process.env, BASE_PATH },
    stdio: 'pipe',
  });
}

async function chooseProfile(page: Page, email: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Wybierz profil' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: email }).click();
}

async function expectProfileHome(page: Page, email: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Doktor Monika Egzamin' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('Aktywny profil')).toContainText(email);
}

async function switchProfile(page: Page, email: string): Promise<void> {
  await page.getByLabel('Aktywny profil').getByRole('button', { name: 'Zmień profil' }).click();
  await chooseProfile(page, email);
  await expectProfileHome(page, email);
}

async function historyRows(page: Page): Promise<number> {
  await page.getByRole('button', { name: 'Historia' }).click();
  await expect(page.getByRole('heading', { name: 'Historia' })).toBeVisible();
  const n = await page.locator('ul[aria-label="Lista testów"] > li').count();
  await page.getByRole('button', { name: 'Wstecz' }).click();
  return n;
}

test.use({ presetProfile: null });

test('aktualizacja z wersji bez profili: przejęcie kart, historia bez profilu, przypisanie, wznowienie sesji V15', async ({ context }, testInfo) => {
  test.setTimeout(400_000);
  ensurePreProfilesDist();
  const server: DistServer = await startDistServer({ dist: OLD_DIST, base: BASE_PATH, port: 0 });
  try {
    const page = await context.newPage();
    await page.goto(server.url);
    await waitOfflineReady(page);
    await reloadUntilControlled(page);
    // Wersja bez profili: od razu ekran startowy; wynik 2 z 3 i rozpoczęty test (1 odpowiedź).
    await expect(page.getByRole('heading', { level: 1, name: 'Doktor Monika Egzamin' })).toBeVisible();
    await expect(page.getByLabel('Aktywny profil')).toHaveCount(0);
    await startTest(page, 3);
    await finishTest(page, (i) => i !== 0);
    await page.getByRole('button', { name: 'Pokaż wynik' }).click();
    await expect(page.locator('.score')).toHaveText('2 z 3');
    await page.getByRole('button', { name: 'Zamknij i wróć do startu' }).click();
    await startTest(page, 4);
    await answer(page, true);
    await page.getByRole('button', { name: 'Przerwij test' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Kontynuuj później' }).click();
    await expect(page.locator('.resume')).toContainText('1/4');
    const before = await readStore<{ id: string; status: string }>(page, 'sessions', LEGACY_DB);
    expect(before.map((s) => s.status).sort()).toEqual(['completed', 'open']);
    await page.evaluate(() => {
      (window as unknown as { __dmeOld?: number }).__dmeOld = 1;
    });

    // Wdrożenie wersji z profilami pod tym samym adresem; druga karta wyzwala sprawdzenie Service Workera.
    server.hooks.dist = NEW_DIST;
    const page2 = await context.newPage();
    await page2.goto(server.url);
    // Nowy SW przejmuje pierwszą kartę sam (bez przeładowania przez test).
    await expect
      .poll(async () => (await page.evaluate(() => (window as unknown as { __dmeOld?: number }).__dmeOld ?? null).catch(() => 'nav')) ?? null, { timeout: 90_000 })
      .toBeNull();
    for (const p of [page, page2]) {
      await expect(p.getByRole('heading', { level: 1, name: 'Wybierz profil' })).toBeVisible({ timeout: 60_000 });
      await expect(p.getByRole('note')).toContainText('1 ukończony test');
      await expect(p.getByRole('note')).toContainText('1 rozpoczęta sesja');
    }
    await screenshot(page, testInfo, '10-wybierz-profil');

    // Przypisanie do wybranego profilu (Iza) przez UI.
    await page.getByRole('button', { name: IZA }).click();
    await expect(page.getByRole('heading', { name: 'Historia bez profilu' })).toBeVisible();
    await screenshot(page, testInfo, '11-historia-bez-profilu');
    await page.getByRole('button', { name: 'Przypisz do tego profilu' }).click();
    await expectProfileHome(page, IZA);
    await expect(page.locator('.resume')).toContainText('1/4');
    expect(await historyRows(page)).toBe(1);
    // Rozpoczęta sesja V15 wznawialna w profilu.
    await page.locator('.resume').getByRole('button', { name: 'Kontynuuj' }).click();
    await expect(page.locator('p.stem')).toBeVisible();
    await page.getByRole('button', { name: 'Przerwij test' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Kontynuuj później' }).click();
    // Dane źródłowe nietknięte (zabezpieczenie), bez duplikatów w profilu.
    expect((await readStore<{ id: string }>(page, 'sessions', LEGACY_DB)).map((s) => s.id).sort()).toEqual(before.map((s) => s.id).sort());
    expect((await readStore<{ id: string }>(page, 'sessions', profileDb(IZA))).map((s) => s.id).sort()).toEqual(before.map((s) => s.id).sort());

    // Druga karta: historia już przypisana (powiadomienie między kartami) — Monika bez cudzej historii.
    await expect(page2.getByRole('note')).toHaveCount(0, { timeout: 15_000 });
    await chooseProfile(page2, MONIKA);
    await expectProfileHome(page2, MONIKA);
    expect(await historyRows(page2)).toBe(0);
    await expect(page2.locator('.resume')).toHaveCount(0);
  } finally {
    await server.close();
  }
});

test('profile: A → test → B z pustą historią → A z wynikiem; zapamiętanie; dwie karty z różnymi profilami', async ({ context, page }) => {
  await page.goto('./');
  await waitOfflineReady(page);
  await expect(page.getByRole('note')).toHaveCount(0);
  await chooseProfile(page, MONIKA);
  await expectProfileHome(page, MONIKA);
  await startTest(page, 3);
  await finishTest(page, () => true);
  await page.getByRole('button', { name: 'Pokaż wynik' }).click();
  await expect(page.locator('.score')).toHaveText('3 z 3');
  await page.getByRole('button', { name: 'Zamknij i wróć do startu' }).click();

  await switchProfile(page, IZA);
  expect(await historyRows(page)).toBe(0);
  await switchProfile(page, MONIKA);
  expect(await historyRows(page)).toBe(1);
  await page.getByRole('button', { name: 'Historia' }).click();
  await expect(page.locator('ul[aria-label="Lista testów"]')).toContainText('3 z 3');
  await page.getByRole('button', { name: 'Wstecz' }).click();

  // Zamknięcie i ponowne otwarcie: ten sam profil (karta i urządzenie).
  await page.reload();
  await expectProfileHome(page, MONIKA);
  const tab2 = await context.newPage();
  await tab2.goto('./');
  await expectProfileHome(tab2, MONIKA);

  // Dwie karty: druga przechodzi na Izę, pierwsza dalej zapisuje do Moniki.
  await switchProfile(tab2, IZA);
  await startTest(page, 2);
  await answer(page, false);
  await expect.poll(async () => (await readStore(page, 'attempts', profileDb(MONIKA))).length).toBe(4);
  expect(await readStore(page, 'attempts', profileDb(IZA))).toHaveLength(0);
  await expect(page.getByLabel('Aktywny profil')).toHaveCount(0); // ekran pytania — bez linii profilu
  await page.getByRole('button', { name: 'Przerwij test' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Kontynuuj później' }).click();
  await expectProfileHome(page, MONIKA);
  await expect(tab2.locator('.resume')).toHaveCount(0);

  // Nowa karta bez własnego profilu otwiera ostatnio wybrany na urządzeniu (Iza).
  const tab3 = await context.newPage();
  await tab3.goto('./');
  await expectProfileHome(tab3, IZA);
});

test('profile offline: zmiana profilu i nauka bez sieci po pełnym pobraniu aplikacji', async ({ page }) => {
  const server = await startDistServer({ dist: NEW_DIST, base: BASE_PATH, port: 0 });
  try {
    await page.goto(server.url);
    await waitOfflineReady(page);
    await reloadUntilControlled(page);
    await chooseProfile(page, MONIKA);
    await expectProfileHome(page, MONIKA);

    server.hooks.offline = true;
    const before = server.requests.length;
    await page.reload();
    await expectProfileHome(page, MONIKA);
    await switchProfile(page, IZA);
    await startTest(page, 2);
    await answer(page, true);
    await expect.poll(async () => (await readStore(page, 'attempts', profileDb(IZA))).length).toBe(1);
    await page.getByRole('button', { name: 'Przerwij test' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Kontynuuj później' }).click();
    await switchProfile(page, MONIKA);
    await expect(page.locator('.resume')).toHaveCount(0);
    await switchProfile(page, IZA);
    await expect(page.locator('.resume')).toContainText('1/2');
    // Serwer niedostępny: żadne żądanie do niego nie było potrzebne (poza nieudanymi próbami sprawdzenia wersji).
    expect(server.requests.slice(before).filter((r) => !r.includes('dme-release.json') && !r.includes('sw.js'))).toEqual([]);
  } finally {
    server.hooks.offline = false;
    await server.close();
  }
});
