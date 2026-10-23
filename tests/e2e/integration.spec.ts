/**
 * Integracja rzeczywistego kontrolera na buildzie produkcyjnym (DECYZJE §1, §6, §10, §11):
 * - `markShown` przy pierwszym pokazaniu slotu (questionStats.seenCount) — zanim padnie odpowiedź;
 * - błąd zapisu (QuotaExceededError z IndexedDB przeglądarki, symulowany w stronie): widoczny komunikat,
 *   brak fałszywego sukcesu (bez oceny, wyjaśnienia i próby w bazie), ponowienie TEJ SAMEJ komendy
 *   (ten sam `commandId`), po udanym zapisie stan trwały;
 * - `navigator.storage.persist()` — dokładnie raz, po pierwszej ZAPISANEJ odpowiedzi;
 * - G03 na dwóch rzeczywistych buildach (inna wersja aplikacji, inne pliki JS i precache):
 *   nieudane pobranie nowej wersji zostawia działającą starą, bez banera; udane — nowa wersja czeka,
 *   aktywne pytanie nie jest przeładowane, baner tylko poza pytaniem, po „Uruchom ponownie” nowa
 *   wersja z zachowaną sesją, także bez sieci.
 * Nie zastępuje testu na fizycznym iPhonie (G05).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { startDistServer, type DistServer } from '../../scripts/serve-dist.mjs';
import {
  BASE_PATH,
  answer,
  answerButtons,
  next,
  openFresh,
  optionIndex,
  optionTexts,
  progressText,
  readStore,
  reloadUntilControlled,
  startTest,
  waitOfflineReady,
} from './helpers';

interface Probe {
  failAttempts: boolean;
  failedPuts: Array<{ id: string; commandId: string }>;
  persistCalls: number;
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => (window as unknown as { __dmeProbe: Probe }).__dmeProbe);
}

async function setFailAttempts(page: Page, fail: boolean): Promise<void> {
  await page.evaluate((value) => {
    (window as unknown as { __dmeProbe: Probe }).__dmeProbe.failAttempts = value;
  }, fail);
}

test('zapis: markShown przed odpowiedzią; błąd zapisu bez fałszywego sukcesu i ponowienie tej samej komendy; persist() raz, po pierwszej zapisanej odpowiedzi', async ({ page }) => {
  await page.addInitScript(() => {
    const p: Probe = { failAttempts: false, failedPuts: [], persistCalls: 0 };
    (window as unknown as { __dmeProbe: Probe }).__dmeProbe = p;
    // Zapis próby (magazyn `attempts`) kończy się błędem jak przy braku miejsca — transakcja zostaje przerwana.
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (p.failAttempts && this.name === 'attempts') {
        const v = args[0] as { id: string; commandId: string };
        p.failedPuts.push({ id: v.id, commandId: v.commandId });
        throw new DOMException('Symulacja braku miejsca (e2e)', 'QuotaExceededError');
      }
      return originalPut.apply(this, args);
    };
    const storage = navigator.storage as StorageManager | undefined;
    if (storage && typeof storage.persist === 'function') {
      const originalPersist = storage.persist.bind(storage);
      storage.persist = () => {
        p.persistCalls += 1;
        return originalPersist();
      };
    }
  });

  await openFresh(page);
  await startTest(page, 3);
  await expect(progressText(page)).toHaveText('0/3');

  // markShown: pytanie jest „widziane” po pokazaniu, zanim padnie odpowiedź (DECYZJE §6 pkt 6).
  await expect
    .poll(async () => (await readStore<{ seenCount: number; answeredCount: number }>(page, 'questionStats')).map((s) => [s.seenCount, s.answeredCount]))
    .toEqual([[1, 0]]);
  const sessions = await readStore<{ slots: Record<string, { shownAt: string | null; attempt: unknown }> }>(page, 'sessions');
  expect(Object.values(sessions[0]?.slots ?? {}).filter((s) => s.shownAt !== null)).toHaveLength(1);
  expect((await probe(page)).persistCalls).toBe(0);

  // Błąd zapisu odpowiedzi.
  await setFailAttempts(page, true);
  const right = await optionIndex(page, true);
  const wrong = await optionIndex(page, false);
  await answerButtons(page).nth(right).tap();
  const alert = page.getByRole('alert').filter({ hasText: 'Odpowiedź nie została zapisana.' });
  await expect(alert).toContainText('Brakuje miejsca na urządzeniu albo przeglądarka odrzuciła zapis.');
  const retry = page.getByRole('button', { name: 'Spróbuj zapisać ponownie' });
  await expect(retry).toBeVisible();
  // Brak fałszywego sukcesu: bez oceny, wyjaśnienia i postępu; w bazie brak próby.
  await expect(page.locator('section.expl')).toHaveCount(0);
  await expect(page.locator('.answer-card--selected-correct, .answer-card--selected-wrong, .answer-card--correct-unselected')).toHaveCount(0);
  await expect(page.getByText('Poprawna odpowiedź')).toHaveCount(0);
  await expect(progressText(page)).toHaveText('0/3');
  expect(await readStore(page, 'attempts')).toHaveLength(0);
  const rightText = (await optionTexts(page))[right];
  const pendingCard = page.locator('.answer-card--pending');
  await expect(pendingCard).toHaveCount(1);
  await expect(pendingCard).toContainText('Wybrana — niezapisana');
  await expect(pendingCard).toContainText(rightText ?? '');
  // Kolejne dotknięcia (inny wariant) nie podmieniają niezapisanej odpowiedzi i nie wysyłają nowej komendy.
  await page.evaluate((w) => document.querySelectorAll<HTMLButtonElement>('ul.answers button.answer-card')[w]?.click(), wrong);
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>('ul.answers button.answer-card').forEach((b) => b.click()));
  await page.waitForTimeout(200);
  await expect(pendingCard).toHaveCount(1);
  await expect(pendingCard).toContainText(rightText ?? '');
  const first = (await probe(page)).failedPuts;
  expect(first).toHaveLength(1);

  // Ponowienie przy nadal pełnej pamięci — dalej błąd, ta sama komenda.
  await retry.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Zapis nadal się nie powiódł. Odpowiedź pozostaje niezapisana.' })).toBeVisible();
  const second = (await probe(page)).failedPuts;
  expect(second).toHaveLength(2);
  expect(second[1]?.commandId).toBe(first[0]?.commandId);
  expect(await readStore(page, 'attempts')).toHaveLength(0);
  expect((await probe(page)).persistCalls).toBe(0);

  // Miejsce zwolnione → ponowienie zapisuje TĘ SAMĄ komendę; dopiero teraz ocena i wyjaśnienie.
  await setFailAttempts(page, false);
  await retry.click();
  await expect(page.locator('section.expl')).toBeVisible();
  await expect(page.locator('.answer-card--selected-correct')).toContainText('Poprawna odpowiedź');
  await expect(page.getByRole('alert').filter({ hasText: 'nie została zapisana' })).toHaveCount(0);
  await expect(progressText(page)).toHaveText('1/3');
  const attempts = await readStore<{ id: string; commandId: string; correct: boolean }>(page, 'attempts');
  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.commandId).toBe(first[0]?.commandId);
  expect(attempts[0]?.correct).toBe(true);

  // persist(): raz, po pierwszej zapisanej odpowiedzi; znacznik w ustawieniach.
  await expect.poll(async () => (await probe(page)).persistCalls).toBe(1);
  await expect
    .poll(async () => (await readStore<{ persistRequestedAt: string | null }>(page, 'settings'))[0]?.persistRequestedAt ?? null)
    .not.toBeNull();
  await next(page);
  await answer(page, false);
  await page.waitForTimeout(300);
  expect((await probe(page)).persistCalls).toBe(1);

  // Stan trwały po przeładowaniu.
  await page.reload();
  await expect(progressText(page)).toHaveText('2/3');
  expect(await readStore(page, 'attempts')).toHaveLength(2);
});

/* -------------------------------------------------------------------------- */
/* G03 — dwa buildy                                                           */
/* -------------------------------------------------------------------------- */

const BUILD_ID_V2 = 'e2e-v2';

/** Build produkcyjny z inną wersją aplikacji (APP_BUILD_ID) do osobnego katalogu. */
function buildVariant(outDir: string): void {
  execFileSync(process.execPath, [resolve(process.cwd(), 'node_modules/vite/bin/vite.js'), 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: process.cwd(),
    env: { ...process.env, BASE_PATH, APP_BUILD_ID: BUILD_ID_V2 },
    stdio: 'pipe',
  });
}

async function mainScript(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute('src') ?? '');
}

async function appVersion(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Ustawienia' }).click();
  const row = page.locator('.list-row', { hasText: 'Wersja aplikacji' }).locator('.list-row__value');
  await expect(row).toBeVisible();
  const value = ((await row.textContent()) ?? '').trim();
  await page.getByRole('button', { name: 'Wstecz' }).click();
  return value;
}

async function registrationState(page: Page): Promise<{ installing: string | null; waiting: string | null; active: string | null }> {
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return { installing: reg?.installing?.state ?? null, waiting: reg?.waiting?.state ?? null, active: reg?.active?.state ?? null };
  });
}

async function triggerUpdateCheck(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg?.update().catch(() => undefined);
  });
}

/**
 * Sprawdzenie aktualizacji (jak automatyczne sprawdzenie aplikacji) aż nowa wersja czeka (`waiting`).
 * Ponawiane co ~5 s: pod obciążeniem WebKit (2359) zdarzyło się, że pojedyncze `update()` nie
 * zainstalowało nowej wersji w 30 s (1 na kilkadziesiąt przebiegów; osobno nie odtworzone).
 */
async function waitForWaitingWorker(page: Page, timeoutMs = 40_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await triggerUpdateCheck(page);
    for (let i = 0; i < 20; i++) {
      if ((await registrationState(page)).waiting === 'installed') return;
      await page.waitForTimeout(250);
    }
  }
  throw new Error(`Nowa wersja nie czeka po ${timeoutMs} ms: ${JSON.stringify(await registrationState(page))}`);
}

test.describe('G03: aktualizacja między dwoma buildami', () => {
  let server: DistServer;
  let v2Dir: string;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(120_000);
    // Osobny katalog na proces testowy: równoległe przebiegi (--repeat-each, ponowienia) nie czyszczą sobie buildu.
    v2Dir = resolve(process.cwd(), 'test-results', `dist-v2-${testInfo.project.name}-w${testInfo.workerIndex}`);
    buildVariant(v2Dir);
  });
  test.beforeEach(async () => {
    server = await startDistServer({ dist: resolve(process.cwd(), 'dist'), base: BASE_PATH, port: 0 });
  });
  test.afterEach(async () => {
    await server.close();
  });

  test('nieudane pobranie zostawia starą wersję; udane czeka, nie przeładowuje pytania; po „Uruchom ponownie” nowa wersja z sesją, także offline', async ({ page }) => {
    test.slow();
    await page.goto(server.url);
    await expect(page.locator('.mode-card')).toHaveCount(2);
    await waitOfflineReady(page);
    await reloadUntilControlled(page);
    const v1Script = await mainScript(page);
    const v1Version = await appVersion(page);
    expect(v1Version).not.toContain(BUILD_ID_V2);

    await startTest(page, 3);
    await answer(page, true);

    // „Wdrożenie” nowej wersji pod tym samym adresem — ale jej główny plik JS nie daje się pobrać.
    server.hooks.dist = v2Dir;
    const v2Html = readFileSync(resolve(v2Dir, 'index.html'), 'utf-8');
    const v2Script = /<script type="module"[^>]*src="([^"]+)"/.exec(v2Html)?.[1] ?? '';
    expect(v2Script).not.toBe('');
    expect(v2Script).not.toBe(v1Script);
    const v2ScriptRel = v2Script.slice(BASE_PATH.length);
    server.hooks.fail = (rel) => (rel === v2ScriptRel ? 503 : null);
    await triggerUpdateCheck(page);
    await expect.poll(() => server.requests.includes(v2ScriptRel), { timeout: 20_000 }).toBe(true);
    await expect.poll(async () => registrationState(page), { timeout: 20_000 }).toEqual({ installing: null, waiting: null, active: 'activated' });
    // Stara wersja działa dalej: odpowiedź i zapis, bez banera i bez ekranu przygotowania.
    await next(page);
    await answer(page, false);
    expect(await readStore(page, 'attempts')).toHaveLength(2);
    await page.getByRole('button', { name: 'Przerwij test' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Kontynuuj później' }).click();
    await expect(page.locator('.resume')).toContainText('2/3');
    await expect(page.getByText('Nowa wersja aplikacji jest gotowa', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Przygotowanie materiałów', { exact: false })).toHaveCount(0);

    // Teraz pobranie się udaje: nowa wersja czeka; aktywne pytanie bez przeładowania i bez banera.
    server.hooks.fail = null;
    await page.getByRole('button', { name: 'Kontynuuj', exact: true }).click();
    await next(page);
    const stem = await page.locator('p.stem').textContent();
    await page.evaluate(() => {
      (window as unknown as { __dmeMarker: string }).__dmeMarker = 'v1';
    });
    await waitForWaitingWorker(page);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __dmeMarker?: string }).__dmeMarker)).toBe('v1');
    await expect(page.locator('p.stem')).toHaveText(stem ?? '');
    await expect(page.getByText('Nowa wersja aplikacji jest gotowa', { exact: false })).toHaveCount(0);
    expect(await mainScript(page)).toBe(v1Script);
    // Odpowiedź na bieżącym pytaniu nadal działa w starej wersji.
    await answer(page, true);
    await expect(page.getByRole('button', { name: 'Pokaż wynik' })).toBeVisible();

    // Poza pytaniem: baner i „Uruchom ponownie” → nowa wersja, sesja zachowana.
    await page.getByRole('button', { name: 'Przerwij test' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Kontynuuj później' }).click();
    await expect(page.getByText('Nowa wersja aplikacji jest gotowa. Po ponownym uruchomieniu przerwana sesja zostanie zachowana.')).toBeVisible();
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Uruchom ponownie' }).click()]);
    await expect(page.getByText('Aplikacja zaktualizowana. Przerwana sesja została zachowana.')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __dmeMarker?: string }).__dmeMarker)).toBeUndefined();
    expect(await mainScript(page)).toBe(v2Script);
    await expect(page.locator('.resume')).toContainText('3/3');
    expect(await readStore(page, 'attempts')).toHaveLength(3);
    expect(await appVersion(page)).toBe(`${v1Version.split('+')[0]}+${BUILD_ID_V2}`);

    // Nowa wersja działa bez sieci (komplet nowego precache), wynik testu zapisuje się.
    server.hooks.offline = true;
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Doktor Monika Egzamin' })).toBeVisible();
    expect(await mainScript(page)).toBe(v2Script);
    await page.getByRole('button', { name: 'Kontynuuj', exact: true }).click();
    await page.getByRole('button', { name: 'Pokaż wynik' }).click();
    await expect(page.getByRole('heading', { name: 'Wynik testu' })).toBeVisible();
    await expect(page.locator('.score')).toHaveText('2 z 3');
  });
});
