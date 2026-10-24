/**
 * Aktualizacja WDROŻONEJ aplikacji (tag `v0.1.0-pages`, bank `release-2026-10-23c`) do banku V15 pod tym samym
 * adresem — jak na GitHub Pages (docs/MIGRACJA_V15.md):
 *  1. stara aplikacja (zbudowana z tagu do test-results/, `git archive`) — dane: ukończony test, Free Flow,
 *     otwarty test ze zgłoszeniem (zastępstwo), wszystko przez UI starej aplikacji;
 *  2. podmiana serwowanego `dist` na nowy build (ten sam adres) — druga karta (nawigacja) wyzwala sprawdzenie
 *     Service Workera; nowy SW przejmuje OBIE karty (skipWaiting → claim → navigate) bez ręcznego czyszczenia
 *     i bez przeładowania przez test; nowa aplikacja pokazuje „Aktualizacja banku pytań…” i migruje IndexedDB v1 → v2;
 *  3. historia z podsumowaniami bez treści, przerwany test niewznawialny, przegląd legacy bez treści, brak rundy
 *     błędów z sesji legacy; w bazie i w Cache Storage brak starej treści i starego banku; dawna ścieżka banku 404;
 *  4. nowe testy tylko z V15 (wyjaśnienie, źródła z linkami po odpowiedzi, runda błędów), offline na V15;
 *  5. przerwanie aktualizacji (zamknięcie karty w trakcie pobierania nowej wersji) i ponowne otwarcie kończy migrację.
 * To nie zastępuje testu na fizycznym iPhonie (G05): Safari/iOS (`WindowClient.navigate` od iOS 16) — NOT RUN.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { startDistServer, type DistServer } from '../../scripts/serve-dist.mjs';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';
import { BANK, BASE_PATH, answer, currentQuestion, next } from './helpers';

const OLD_TAG = 'v0.1.0-pages';
const OLD_SRC = resolve(process.cwd(), 'test-results', 'zrodlo-v0.1.0-pages');
const OLD_DIST = resolve(process.cwd(), 'test-results', 'dist-v0.1.0-pages');
const NEW_DIST = resolve(process.cwd(), 'dist');

/** Build starej aplikacji z tagu (raz na przebieg): `git archive` → vite build z tym samym BASE_PATH. */
function ensureOldDist(): void {
  if (existsSync(resolve(OLD_DIST, 'sw.js')) && existsSync(resolve(OLD_DIST, 'data/bank.json'))) return;
  rmSync(OLD_SRC, { recursive: true, force: true });
  mkdirSync(OLD_SRC, { recursive: true });
  const archive = execFileSync('git', ['archive', OLD_TAG], { maxBuffer: 256 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', OLD_SRC], { input: archive });
  symlinkSync(resolve(process.cwd(), 'node_modules'), resolve(OLD_SRC, 'node_modules'));
  execFileSync(process.execPath, [resolve(OLD_SRC, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', OLD_DIST, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: OLD_SRC,
    env: { ...process.env, BASE_PATH },
    stdio: 'pipe',
  });
}

const OLD_BANK = (): { bank_version: string; questions: { stem_pl: string }[] } => JSON.parse(readFileSync(resolve(OLD_DIST, 'data/bank.json'), 'utf-8'));
const V15_STEMS = new Set(BANK.questions.map((q) => q.stem_pl.trim()));

/** Rejestruje w każdym dokumencie kontekstu, czy pojawił się komunikat aktualizacji banku. */
async function watchUpdateMessage(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const w = window as unknown as { __dmeSawUpdate?: boolean };
    const mark = (): void => {
      if (document.body?.textContent?.includes('Aktualizacja banku pytań')) {
        w.__dmeSawUpdate = true;
        try {
          sessionStorage.setItem('dme-e2e-saw-update', '1');
        } catch {
          /* bez sessionStorage */
        }
      }
    };
    new MutationObserver(mark).observe(document, { childList: true, subtree: true, characterData: true });
  });
}

async function waitControlledReady(page: Page): Promise<void> {
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated', undefined, { timeout: 60_000 });
  for (let i = 0; i < 8; i++) {
    if (await page.evaluate(() => navigator.serviceWorker.controller !== null)) break;
    await page.reload();
    await page.waitForTimeout(300 * (i + 1));
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Doktor Monika Egzamin' })).toBeVisible({ timeout: 30_000 });
}

async function tapFirstOption(page: Page): Promise<void> {
  await page.locator('ul.answers > li').first().locator('button').tap();
  await expect(page.locator('section.expl')).toBeVisible();
}

/** Dane w STAREJ aplikacji: ukończony test 3, zakończony Free Flow 2, otwarty test 5 z odpowiedzią i zgłoszeniem. */
async function generateOldData(page: Page): Promise<void> {
  await page.locator('.mode-card', { hasText: 'Wybierz liczbę pytań' }).click();
  await page.getByRole('textbox', { name: 'Liczba pytań' }).fill('3');
  await page.getByRole('button', { name: 'Rozpocznij test' }).click();
  for (let i = 0; i < 3; i++) {
    await tapFirstOption(page);
    if (i < 2) await page.getByRole('button', { name: 'Dalej' }).click();
  }
  await page.getByRole('button', { name: 'Pokaż wynik' }).click();
  await expect(page.locator('.result-card')).toBeVisible();
  await page.getByRole('button', { name: 'Wróć do startu', exact: true }).click();

  await page.locator('.mode-card', { hasText: 'Free Flow' }).click();
  await page.getByRole('button', { name: 'Rozpocznij', exact: true }).click();
  await tapFirstOption(page);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await tapFirstOption(page);
  await page.getByRole('button', { name: 'Przerwij lub zakończ Free Flow' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Zakończ sesję' }).click();
  await expect(page.locator('.result-card')).toContainText('Sesja zakończona');
  await page.getByRole('button', { name: 'Wróć do startu', exact: true }).click();

  await page.locator('.mode-card', { hasText: 'Wybierz liczbę pytań' }).click();
  await page.getByRole('textbox', { name: 'Liczba pytań' }).fill('5');
  await page.getByRole('button', { name: 'Rozpocznij test' }).click();
  await tapFirstOption(page);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.locator('p.stem')).toBeVisible();
  await page.getByRole('button', { name: 'Zgłoś błąd w pytaniu' }).click();
  await expect(page.getByText('Pytanie wykluczone. Zastąpiliśmy je innym.')).toBeVisible();
  // Karta zostaje na ekranie pytania otwartego testu (stara pula w pamięci starego kodu).
}

interface Dump {
  version: number;
  stores: Record<string, unknown[]>;
}

async function dumpDb(page: Page): Promise<Dump> {
  return page.evaluate(
    () =>
      new Promise<Dump>((ok, fail) => {
        const req = indexedDB.open('doktor-monika-egzamin');
        req.onerror = () => fail(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const names = [...db.objectStoreNames];
          const tx = db.transaction(names, 'readonly');
          const stores: Record<string, unknown[]> = {};
          for (const n of names) {
            const r = tx.objectStore(n).getAll();
            r.onsuccess = () => {
              stores[n] = r.result as unknown[];
            };
          }
          tx.oncomplete = () => {
            const version = db.version;
            db.close();
            ok({ version, stores });
          };
        };
      }),
  );
}

async function cacheUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) out.push(r.url);
    return out;
  });
}

/** Czeka, aż strona pokaże NOWĄ aplikację (bank V15 w IndexedDB i ekran startowy). */
async function waitNewApp(page: Page): Promise<void> {
  await expect
    .poll(async () => (await page.evaluate(() => (window as unknown as { __dmeOld?: number }).__dmeOld ?? null).catch(() => 'nav')) ?? null, { timeout: 90_000 })
    .toBeNull();
  await expect(page.getByRole('heading', { level: 1, name: 'Doktor Monika Egzamin' })).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await dumpDb(page).catch(() => ({ version: 0, stores: {} }))).version, { timeout: 30_000 }).toBe(2);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  test.setTimeout(400_000);
  ensureOldDist();
  expect(OLD_BANK().bank_version).toBe('release-2026-10-23c');
});

test('V15: nowy Service Worker przejmuje otwarte karty starej aplikacji, migracja, wyłącznie V15 (także offline)', async ({ context }) => {
  test.setTimeout(400_000);
  const server: DistServer = await startDistServer({ dist: OLD_DIST, base: BASE_PATH, port: 0 });
  try {
    await watchUpdateMessage(context);
    const page = await context.newPage();
    await page.goto(server.url);
    await waitControlledReady(page);
    await generateOldData(page);
    const before = await dumpDb(page);
    expect(before.version).toBe(1);
    const oldSessions = before.stores.sessions as { bankVersion: string; status: string; slots: Record<string, { snapshot: { stem: string } }> }[];
    expect(oldSessions.map((s) => s.status).sort()).toEqual(['completed', 'ended', 'open']);
    expect(oldSessions.every((s) => s.bankVersion === 'release-2026-10-23c')).toBe(true);
    const oldStems = oldSessions.flatMap((s) => Object.values(s.slots).map((x) => x.snapshot.stem.trim()));
    const changedOldStems = oldStems.filter((stem) => !V15_STEMS.has(stem));
    expect((await cacheUrls(page)).some((u) => u.includes('/data/bank.json'))).toBe(true);
    // Znacznik starego dokumentu — zniknie tylko, jeśli kartę przeładuje nowy Service Worker (nie test).
    await page.evaluate(() => {
      (window as unknown as { __dmeOld?: number }).__dmeOld = 1;
    });

    // „Wdrożenie” V15 pod tym samym adresem; druga karta (nawigacja = sprawdzenie aktualizacji SW).
    server.hooks.dist = NEW_DIST;
    const page2 = await context.newPage();
    await page2.goto(server.url);
    await waitNewApp(page);
    await waitNewApp(page2);

    // Komunikat po stronie nowej aplikacji (w którejś karcie, która wykonała migrację).
    const saw = (await page.evaluate(() => sessionStorage.getItem('dme-e2e-saw-update'))) ?? (await page2.evaluate(() => sessionStorage.getItem('dme-e2e-saw-update')));
    expect(saw).toBe('1');

    // Baza po migracji: brak treści, legacy, przerwany test, meta V15, bez paczek i kopii.
    const after = await dumpDb(page);
    expect(after.version).toBe(2);
    const sessions = after.stores.sessions as { id: string; status: string; slots: object; plan: unknown[]; legacy?: { previousBankVersion: string } }[];
    expect(sessions.map((s) => s.status).sort()).toEqual(['completed', 'ended', 'interrupted_by_update']);
    expect(sessions.every((s) => Object.keys(s.slots).length === 0 && s.plan.length === 0 && s.legacy?.previousBankVersion === 'release-2026-10-23c')).toBe(true);
    const dbText = JSON.stringify(after.stores);
    for (const stem of changedOldStems) expect(dbText).not.toContain(stem.slice(0, 60));
    expect((after.stores.meta as { key: string; bankVersion?: string }[]).find((m) => m.key === 'content')?.bankVersion).toBe(CONTENT_RELEASE.bankVersion);
    expect(after.stores.packs).toEqual([]);
    expect(after.stores.backups).toEqual([]);

    // Stary precache usunięty; nowy bank w cache; dawna ścieżka banku nie jest serwowana.
    const urls = await cacheUrls(page);
    expect(urls.some((u) => u.includes('/data/bank.json'))).toBe(false);
    expect(urls.some((u) => u.includes(CONTENT_RELEASE.bankFile))).toBe(true);
    // Dawna ścieżka banku: 404 z Service Workera (także gdy przeglądarka ma ją w pamięci HTTP) i z serwera.
    expect(await page.evaluate(async (u) => (await fetch(u)).status, `${server.url}data/bank.json`)).toBe(404);
    expect(await page.evaluate(async (u) => (await fetch(u, { cache: 'no-store' })).status, `${server.url}data/bank.json`)).toBe(404);

    // Historia: podsumowania bez treści; przerwany test; brak „Kontynuuj”.
    await expect(page.locator('.resume')).toHaveCount(0);
    await page.getByRole('button', { name: 'Historia' }).click();
    const rows = page.locator('ul[aria-label="Lista testów"] > li');
    await expect(rows).toHaveCount(2);
    await expect(page.locator('ul[aria-label="Lista testów"]')).toContainText('Przerwany aktualizacją banku pytań');
    await expect(page.locator('ul[aria-label="Lista testów"]')).toContainText(' z 3');
    await expect(page.locator('.chart__point')).toHaveCount(1);
    await rows.filter({ hasText: ' z 3' }).first().click();
    await expect(page.getByText('Treść pytań poprzedniej wersji banku nie jest dostępna')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Przejrzyj odpowiedzi' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Uwzględnij błędy|Nowa runda/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Wstecz' }).click();
    await rows.filter({ hasText: 'Przerwany' }).first().click();
    await expect(page.locator('.result-card')).toContainText('Przerwany aktualizacją banku pytań');
    await page.getByRole('button', { name: 'Wstecz' }).click();
    await page.getByRole('tab', { name: 'Free Flow' }).click();
    await expect(page.locator('ul[aria-label="Lista sesji Free Flow"] > li')).toHaveCount(1);
    await page.getByRole('button', { name: 'Wstecz' }).click();

    // Nowy test: wyłącznie V15; wyjaśnienie i źródła z linkami po odpowiedzi; runda błędów.
    await page.locator('.mode-card', { hasText: 'Wybierz liczbę pytań' }).click();
    await page.getByRole('textbox', { name: 'Liczba pytań' }).fill('3');
    await page.getByRole('button', { name: 'Rozpocznij test' }).click();
    for (let i = 0; i < 3; i++) {
      const q = await currentQuestion(page); // rzuca, gdy treść spoza V15
      expect(V15_STEMS.has(q.stem_pl.trim())).toBe(true);
      await expect(page.locator('section.expl')).toHaveCount(0);
      await answer(page, false);
      // Źródła dopiero po odpowiedzi; rozwinięcie wiersza źródła pokazuje link https z rejestru V15.
      const source = page.locator('section.expl .source-row').first();
      await expect(source).toBeVisible();
      await source.locator('button').first().click();
      await expect(source.locator('a.source-row__open[href^="https://"]')).toBeVisible();
      if (i < 2) await next(page);
    }
    await page.getByRole('button', { name: 'Pokaż wynik' }).click();
    await page.getByRole('button', { name: /Uwzględnij błędy/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Rozpocznij rundę' }).click();
    await expect(page.locator('.q-meta')).toContainText('Powtórka · runda 2');
    expect(V15_STEMS.has((await currentQuestion(page)).stem_pl.trim())).toBe(true);
    await page.getByRole('button', { name: 'Przerwij test' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Kontynuuj później' }).click();

    // Offline: start na V15 z precache.
    server.hooks.offline = true;
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Doktor Monika Egzamin' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Kontynuuj', exact: true }).click();
    expect(V15_STEMS.has((await currentQuestion(page)).stem_pl.trim())).toBe(true);
    server.hooks.offline = false;
    expect(await page2.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)).toContain('sw.js');
  } finally {
    await server.close();
  }
});

test('V15: zamknięcie karty w trakcie pobierania aktualizacji i ponowne otwarcie kończy migrację', async ({ context }) => {
  test.setTimeout(400_000);
  const server: DistServer = await startDistServer({ dist: OLD_DIST, base: BASE_PATH, port: 0 });
  try {
    const page = await context.newPage();
    await page.goto(server.url);
    await waitControlledReady(page);
    await generateOldData(page);
    await page.close();

    // Nowa wersja; pobieranie banku V15 przy instalacji SW mocno opóźnione — karta zamknięta w trakcie.
    server.hooks.dist = NEW_DIST;
    let delayed = 0;
    server.hooks.delay = (rel) => (rel === CONTENT_RELEASE.bankFile && delayed++ === 0 ? 4000 : null);
    const p1 = await context.newPage();
    await p1.goto(server.url);
    await expect.poll(() => server.requests.includes(CONTENT_RELEASE.bankFile), { timeout: 30_000 }).toBe(true);
    await p1.close();
    server.hooks.delay = null;

    // Ponowne otwarcie: aktualizacja dokończona, migracja wykonana, brak otwartej starej sesji.
    const p2 = await context.newPage();
    await p2.goto(server.url);
    await expect
      .poll(async () => (await dumpDb(p2).catch(() => ({ version: 0, stores: {} }))).version, { timeout: 120_000, intervals: [1000] })
      .toBe(2);
    await expect(p2.getByRole('heading', { level: 1, name: 'Doktor Monika Egzamin' })).toBeVisible({ timeout: 60_000 });
    const dump = await dumpDb(p2);
    const sessions = dump.stores.sessions as { status: string; slots: object }[];
    expect(sessions.map((s) => s.status).sort()).toEqual(['completed', 'ended', 'interrupted_by_update']);
    expect(sessions.every((s) => Object.keys(s.slots).length === 0)).toBe(true);
    // Aplikacja działa na V15 po aktualizacji (karta kontrolowana przez nowy SW, po ewentualnym przejęciu).
    await expect.poll(async () => p2.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL ?? ''), { timeout: 60_000 }).toContain('sw.js');
    await expect.poll(async () => (await cacheUrls(p2)).some((u) => u.includes('/data/bank.json')), { timeout: 60_000 }).toBe(false);
  } finally {
    await server.close();
  }
});
