/**
 * Aktualizacja ZAINSTALOWANEJ aplikacji z produkcji (commit `b6f9201` — wiedza.doktormonika.pl od 25.10.2026,
 * bank V15, profile lokalne) do banku V18 (700 pytań) pod tym samym adresem — docs/MIGRACJA_V18.md:
 *  1. stara aplikacja (zbudowana z commita do test-results/, `git archive`): dwa profile z danymi wpisanymi przez UI
 *     (Monika: ukończony test, zakończony Free Flow, otwarty test ze zgłoszeniem; Iza: ukończony test);
 *  2. podmiana `dist` (ten sam adres) — nowy Service Worker przejmuje otwarte karty sam (bez czyszczenia danych);
 *  3. każdy profil migruje przy własnym otwarciu (v3 → v4); wyniki liczbowe i daty zostają, treść V15 znika
 *     z IndexedDB obu profili i z Cache Storage; dawne pliki banków → 404 (Service Worker i serwer);
 *  4. nowa nauka wyłącznie z 700 pytań V18: Test 20 — 13/20 zaliczony, 12/20 niezaliczony (próg 65%), runda błędów,
 *     Free Flow, odświeżenie i historia, start offline po aktualizacji; brak błędów konsoli i odpowiedzi ≥ 400;
 *  5. zamknięcie karty w trakcie pobierania aktualizacji i ponowne otwarcie kończy aktualizację.
 * To nie zastępuje testu na fizycznym iPhonie (G05): emulacja WebKit to nie Safari iOS z ekranu głównego.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext, ConsoleMessage, Page } from '@playwright/test';
import { startDistServer, type DistServer } from '../../scripts/serve-dist.mjs';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';
import { DB_SCHEMA_VERSION } from '../../src/persistence/api';
import { V18_ALLOWED } from '../../src/persistence/v18Allowlist';
import { expect, test } from './fixtures';
import { BANK, BASE_PATH, answer, currentQuestion, next, profileDb } from './helpers';

const PROD_REF = 'b6f9201';
const OLD_SRC = resolve(process.cwd(), 'test-results', 'zrodlo-produkcja-v15');
const OLD_DIST = resolve(process.cwd(), 'test-results', 'dist-produkcja-v15');
const NEW_DIST = resolve(process.cwd(), 'dist');
const MONIKA = 'monika@doktormonika.pl';
const IZA = 'iza@doktormonika.pl';
const V15_BANK_FILE = 'data/bank-37f3980a1129.json';
const OLD_DATA_FILES = ['data/bank.json', V15_BANK_FILE, 'data/retired-question-ids-83b36ff80986.json', 'data/training-profile-c0edd4ca07c2.json'];
const ALLOWED = new Set(V18_ALLOWED.map(([id]) => id));
const V18_STEMS = new Set(BANK.questions.map((q) => q.stem_pl.trim()));

/**
 * Build wdrożonej wersji (raz na przebieg): `git archive` → vite build z tym samym BASE_PATH. Każdy proces testów
 * buduje we własnym katalogu i podmienia wynik atomowo (`rename`) — równoległe workery się nie zderzają.
 */
function ensureOldDist(): void {
  const ready = (): boolean => existsSync(resolve(OLD_DIST, 'sw.js')) && existsSync(resolve(OLD_DIST, V15_BANK_FILE));
  if (ready()) return;
  const src = `${OLD_SRC}-${process.pid}`;
  const out = `${OLD_DIST}-${process.pid}`;
  rmSync(src, { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  const archive = execFileSync('git', ['archive', PROD_REF], { maxBuffer: 256 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', src], { input: archive });
  symlinkSync(resolve(process.cwd(), 'node_modules'), resolve(src, 'node_modules'));
  execFileSync(process.execPath, [resolve(src, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: src,
    env: { ...process.env, BASE_PATH },
    stdio: 'pipe',
  });
  try {
    if (!ready()) renameSync(out, OLD_DIST);
  } catch {
    /* inny worker zdążył pierwszy — jego build jest identyczny */
  }
  rmSync(src, { recursive: true, force: true });
}

async function waitControlled(page: Page): Promise<void> {
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated', undefined, { timeout: 60_000 });
  for (let i = 0; i < 8; i++) {
    if (await page.evaluate(() => navigator.serviceWorker.controller !== null)) return;
    await page.reload();
    await page.waitForTimeout(300 * (i + 1));
  }
  throw new Error('Strona nie jest kontrolowana przez Service Workera');
}

async function chooseProfile(page: Page, email: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Wybierz profil' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: email }).click();
  await expect(page.getByLabel('Aktywny profil')).toContainText(email, { timeout: 60_000 });
}

/** Profil karty: ekran wyboru albo start innego profilu (zapamiętany ostatni) → przełączenie na `email`. */
async function ensureProfile(page: Page, email: string): Promise<void> {
  const picker = page.getByRole('heading', { level: 1, name: 'Wybierz profil' });
  const active = page.getByLabel('Aktywny profil');
  await expect(picker.or(active)).toBeVisible({ timeout: 90_000 });
  if (await picker.isVisible()) return chooseProfile(page, email);
  if ((await active.textContent())?.includes(email)) return;
  await active.getByRole('button', { name: 'Zmień profil' }).click();
  await chooseProfile(page, email);
}

/** Odpowiedź w STAREJ aplikacji (treść V15 spoza banku na dysku): pierwsza opcja. */
async function tapFirstOption(page: Page): Promise<void> {
  await page.locator('ul.answers > li').first().locator('button').tap();
  await expect(page.locator('section.expl')).toBeVisible();
}

async function oldCompletedTest(page: Page, n: number): Promise<string> {
  await page.locator('.mode-card', { hasText: 'Wybierz liczbę pytań' }).click();
  await page.getByRole('textbox', { name: 'Liczba pytań' }).fill(String(n));
  await page.getByRole('button', { name: 'Rozpocznij test' }).click();
  for (let i = 0; i < n; i++) {
    await tapFirstOption(page);
    if (i < n - 1) await page.getByRole('button', { name: 'Dalej' }).click();
  }
  await page.getByRole('button', { name: 'Pokaż wynik' }).click();
  const score = (await page.locator('.score').textContent())?.trim() ?? '';
  await page.getByRole('button', { name: 'Zamknij i wróć do startu' }).click();
  return score;
}

/** Monika w starej aplikacji: ukończony test 3, Free Flow 2, otwarty test 5 z odpowiedzią i zgłoszeniem. */
async function oldDataMonika(page: Page): Promise<string> {
  const score = await oldCompletedTest(page, 3);
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
  await page.getByRole('button', { name: 'Zgłoś błąd w pytaniu' }).click();
  await expect(page.getByText('Pytanie wykluczone. Zastąpiliśmy je innym.')).toBeVisible();
  await page.getByRole('button', { name: 'Przerwij test' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Kontynuuj później' }).click();
  return score;
}

interface Dump {
  version: number;
  stores: Record<string, unknown[]>;
}

/** Odczyt CAŁEJ bazy (bez tworzenia: brak bazy → wersja 0). */
async function dumpDb(page: Page, dbName: string): Promise<Dump> {
  return page.evaluate(async (name) => {
    const names = (await indexedDB.databases()).map((d) => d.name);
    if (!names.includes(name)) return { version: 0, stores: {} };
    return new Promise<Dump>((ok, fail) => {
      const req = indexedDB.open(name);
      req.onerror = () => fail(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const storeNames = [...db.objectStoreNames];
        const stores: Record<string, unknown[]> = {};
        const version = db.version;
        if (storeNames.length === 0) {
          db.close();
          ok({ version, stores });
          return;
        }
        const tx = db.transaction(storeNames, 'readonly');
        for (const n of storeNames) {
          const r = tx.objectStore(n).getAll();
          r.onsuccess = () => {
            stores[n] = r.result as unknown[];
          };
        }
        tx.oncomplete = () => {
          db.close();
          ok({ version, stores });
        };
      };
    });
  }, dbName);
}

async function cacheUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) out.push(r.url);
    return out;
  });
}

function collectProblems(context: BrowserContext): { console: string[]; http: string[]; paused: boolean } {
  const problems = { console: [] as string[], http: [] as string[], paused: false };
  const attach = (p: Page): void => {
    p.on('console', (m: ConsoleMessage) => {
      if (problems.paused) return;
      // Celowe zapytania testu o dawne pliki banków (404) przeglądarka też zapisuje w konsoli — pomijamy tylko je.
      if (m.type() === 'error' && !OLD_DATA_FILES.some((f) => m.location().url.includes(f))) problems.console.push(`${p.url()}: ${m.text()} [${m.location().url}]`);
    });
    p.on('response', (r) => {
      if (problems.paused) return;
      // Celowe 404 dawnych plików banków sprawdzamy osobno.
      if (r.status() >= 400 && !OLD_DATA_FILES.some((f) => r.url().includes(f))) problems.http.push(`${r.status()} ${r.url()}`);
    });
  };
  // Karty otwarte przed aktualizacją (przejmowane przez nowy Service Worker) i otwierane później.
  for (const p of context.pages()) attach(p);
  context.on('page', attach);
  return problems;
}

type OldSession = { id: string; status: string; bankVersion: string; result: { correct: number; targetN: number } | null; createdAt: string; slots: Record<string, { snapshot: { stem: string } }> };
type NewSession = { id: string; status: string; bankVersion: string; result: { correct: number; targetN: number } | null; createdAt: string; slots: object; plan: unknown[]; legacy?: { reason: string; previousBankVersion: string } | null };

async function newTest20(page: Page, correctCount: number): Promise<void> {
  await page.locator('.mode-card', { hasText: 'Wybierz liczbę pytań' }).click();
  await expect(page.getByRole('heading', { name: 'Test', level: 1 })).toBeVisible();
  // Konfiguracja pamięta ostatnią liczbę z profilu (domyślnie 20 tylko dla czystego profilu).
  await page.getByRole('textbox', { name: 'Liczba pytań' }).fill('20');
  await page.getByRole('button', { name: 'Rozpocznij test' }).click();
  const seen = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const q = await currentQuestion(page); // rzuca, gdy treść spoza banku V18
    expect(ALLOWED.has(q.id)).toBe(true);
    expect(seen.has(q.id)).toBe(false);
    seen.add(q.id);
    await expect(page.locator('.progress-header__text')).toHaveText(`${i}/20`);
    await answer(page, i < correctCount);
    if (i < 19) await next(page);
  }
  await page.getByRole('button', { name: 'Pokaż wynik' }).click();
  await expect(page.locator('.score')).toHaveText(`${correctCount} z 20`);
}

test.describe.configure({ mode: 'serial' });
test.use({ presetProfile: null });

test.beforeAll(() => {
  test.setTimeout(400_000);
  ensureOldDist();
});

test('V18: aktualizacja z produkcji V15 (profile) — przejęcie kart, migracja każdego profilu, wyłącznie 700 pytań V18, offline', async ({ context }) => {
  test.setTimeout(900_000);
  const server: DistServer = await startDistServer({ dist: OLD_DIST, base: BASE_PATH, port: 0 });
  try {
    const page = await context.newPage();
    await page.goto(server.url);
    await waitControlled(page);
    await chooseProfile(page, MONIKA);
    const monikaScore = await oldDataMonika(page);
    await page.getByLabel('Aktywny profil').getByRole('button', { name: 'Zmień profil' }).click();
    await chooseProfile(page, IZA);
    const izaScore = await oldCompletedTest(page, 2);
    expect(monikaScore).toMatch(/^\d z 3$/);
    expect(izaScore).toMatch(/^\d z 2$/);

    const beforeM = await dumpDb(page, profileDb(MONIKA));
    const beforeI = await dumpDb(page, profileDb(IZA));
    expect([beforeM.version, beforeI.version]).toEqual([3, 3]);
    const oldM = beforeM.stores.sessions as OldSession[];
    const oldI = beforeI.stores.sessions as OldSession[];
    expect(oldM.map((s) => s.status).sort()).toEqual(['completed', 'ended', 'open']);
    expect(oldI.map((s) => s.status)).toEqual(['completed']);
    expect([...oldM, ...oldI].every((s) => s.bankVersion === 'chatgpt-editorial-v15-2026-10-24-f020a0440df8')).toBe(true);
    const oldStems = [...oldM, ...oldI].flatMap((s) => Object.values(s.slots).map((x) => x.snapshot.stem.trim()));
    expect(oldStems.length).toBeGreaterThan(5);
    expect(oldStems.some((stem) => V18_STEMS.has(stem))).toBe(false);
    expect((await cacheUrls(page)).some((u) => u.includes(V15_BANK_FILE))).toBe(true);
    await page.evaluate(() => {
      (window as unknown as { __dmeOld?: number }).__dmeOld = 1;
    });

    // „Wdrożenie” V18 pod tym samym adresem; od tej chwili zbieramy błędy konsoli i odpowiedzi ≥ 400.
    const problems = collectProblems(context);
    server.hooks.dist = NEW_DIST;
    const page2 = await context.newPage();
    await page2.goto(server.url);
    // Nowy SW przejmuje pierwszą kartę sam (bez przeładowania przez test i bez czyszczenia danych).
    await expect
      .poll(async () => (await page.evaluate(() => (window as unknown as { __dmeOld?: number }).__dmeOld ?? null).catch(() => 'nav')) ?? null, { timeout: 120_000 })
      .toBeNull();
    await expect.poll(async () => (await page.evaluate(() => fetch('dme-release.json', { cache: 'no-store' }).then((r) => r.json()))).bankVersion, { timeout: 30_000 }).toBe(CONTENT_RELEASE.bankVersion);

    // Karta 1 wraca do profilu karty (Iza) — jej baza migruje; baza Moniki czeka na własne otwarcie.
    await expect(page.getByLabel('Aktywny profil')).toContainText(IZA, { timeout: 90_000 });
    await expect.poll(async () => (await dumpDb(page, profileDb(IZA))).version, { timeout: 60_000 }).toBe(DB_SCHEMA_VERSION);
    const izaAfter = await dumpDb(page, profileDb(IZA));
    const izaSessions = izaAfter.stores.sessions as NewSession[];
    expect(izaSessions).toHaveLength(1);
    expect(izaSessions[0]).toMatchObject({ status: 'completed', createdAt: oldI[0]!.createdAt, result: oldI[0]!.result, slots: {}, plan: [], legacy: { reason: 'bank_v18_update' } });

    // Druga karta: Monika (migracja przy otwarciu profilu).
    await ensureProfile(page2, MONIKA);
    await expect.poll(async () => (await dumpDb(page2, profileDb(MONIKA))).version, { timeout: 60_000 }).toBe(DB_SCHEMA_VERSION);
    const monikaAfter = await dumpDb(page2, profileDb(MONIKA));
    const mSessions = monikaAfter.stores.sessions as NewSession[];
    expect(mSessions.map((s) => s.status).sort()).toEqual(['completed', 'ended', 'interrupted_by_update']);
    for (const s of mSessions) {
      const old = oldM.find((o) => o.id === s.id)!;
      expect(s).toMatchObject({ createdAt: old.createdAt, slots: {}, plan: [], legacy: { reason: 'bank_v18_update', previousBankVersion: old.bankVersion } });
      if (old.status === 'completed') expect(s.result).toEqual(old.result);
    }
    // Brak dawnej treści w obu bazach (sesje, blokady, kopie bezpieczeństwa); meta = V18.
    for (const dump of [monikaAfter, izaAfter]) {
      const text = JSON.stringify(dump.stores);
      for (const stem of oldStems) expect(text).not.toContain(stem.slice(0, 50));
      expect((dump.stores.meta as { key: string; bankVersion?: string }[]).find((m) => m.key === 'content')?.bankVersion).toBe(CONTENT_RELEASE.bankVersion);
      expect(dump.stores.questionStats).toEqual([]);
    }

    // Cache: stary bank usunięty, nowy w precache; dawne pliki banków → 404 z SW i z serwera (nie JSON, nie HTML).
    const urls = await cacheUrls(page2);
    expect(urls.some((u) => OLD_DATA_FILES.some((f) => u.includes(f)))).toBe(false);
    expect(urls.some((u) => u.includes(CONTENT_RELEASE.bankFile))).toBe(true);
    for (const f of OLD_DATA_FILES) {
      expect(await page2.evaluate(async (u) => (await fetch(u)).status, `${server.url}${f}`), f).toBe(404);
      expect(await page2.evaluate(async (u) => (await fetch(u, { cache: 'no-store' })).status, `${server.url}${f}`), f).toBe(404);
    }

    // Historia Moniki: podsumowania bez treści; przerwany test bez „Kontynuuj”.
    await expect(page2.locator('.resume')).toHaveCount(0);
    await page2.getByRole('button', { name: 'Historia' }).click();
    const rows = page2.locator('ul[aria-label="Lista testów"] > li');
    await expect(rows).toHaveCount(2);
    await expect(page2.locator('ul[aria-label="Lista testów"]')).toContainText(monikaScore);
    await expect(page2.locator('ul[aria-label="Lista testów"]')).toContainText('Przerwany aktualizacją banku pytań');
    await rows.filter({ hasText: monikaScore }).first().click();
    await expect(page2.getByText('Treść pytań poprzedniej wersji banku nie jest dostępna')).toBeVisible();
    await expect(page2.getByRole('button', { name: 'Przejrzyj odpowiedzi' })).toHaveCount(0);
    await page2.getByRole('button', { name: 'Wstecz' }).click();
    await page2.getByRole('button', { name: 'Wstecz' }).click();

    // C — Test 20: 13/20 zaliczony, 12/20 niezaliczony (próg 65%); bez etykiet trudności.
    await newTest20(page2, 13);
    await expect(page2.locator('.result-card')).toContainText('65');
    await expect(page2.locator('.result-card')).not.toContainText('Próg nieosiągnięty');
    await page2.getByRole('button', { name: 'Zamknij i wróć do startu' }).click();
    await newTest20(page2, 12);
    await expect(page2.locator('.result-card')).toContainText('60');
    await expect(page2.locator('.result-card')).toContainText(/nieosiągnięt|Niezaliczon/i);
    // Runda błędów: błędy ostatniej rundy (8) uzupełnione pytaniami z puli V18.
    await page2.getByRole('button', { name: /Uwzględnij błędy/ }).click();
    await page2.getByRole('dialog').getByRole('button', { name: 'Rozpocznij rundę' }).click();
    await expect(page2.locator('.q-meta')).toContainText('Powtórka · runda 2');
    expect(ALLOWED.has((await currentQuestion(page2)).id)).toBe(true);
    await expect(page2.locator('.q-meta__level')).toHaveCount(0);
    await page2.getByRole('button', { name: 'Przerwij test' }).click();
    await page2.getByRole('dialog').getByRole('button', { name: 'Kontynuuj później' }).click();

    // Free Flow: wyłącznie V18.
    await page2.locator('.mode-card', { hasText: 'Free Flow' }).click();
    await page2.getByRole('button', { name: 'Rozpocznij', exact: true }).click();
    for (let i = 0; i < 3; i++) {
      expect(ALLOWED.has((await currentQuestion(page2)).id)).toBe(true);
      await answer(page2, i !== 1);
      await next(page2);
    }
    await page2.getByRole('button', { name: 'Przerwij lub zakończ Free Flow' }).click();
    await page2.getByRole('dialog').getByRole('button', { name: 'Zakończ sesję' }).click();
    await page2.getByRole('button', { name: 'Wróć do startu', exact: true }).click();

    // Odświeżenie: historia z nowymi wynikami (65% zaliczony, 60% nie) i dawnymi podsumowaniami.
    await page2.reload();
    await expect(page2.getByLabel('Aktywny profil')).toContainText(MONIKA, { timeout: 30_000 });
    await page2.getByRole('button', { name: 'Historia' }).click();
    const list = page2.locator('ul[aria-label="Lista testów"]');
    await expect(list).toContainText('13 z 20');
    await expect(list).toContainText('12 z 20');
    await expect(list).toContainText(monikaScore);
    await page2.getByRole('button', { name: 'Wstecz' }).click();

    // Iza (karta 1): osobna historia — tylko jej dawny wynik, bez wyników Moniki.
    await page.reload();
    await expect(page.getByLabel('Aktywny profil')).toContainText(IZA, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Historia' }).click();
    await expect(page.locator('ul[aria-label="Lista testów"] > li')).toHaveCount(1);
    await expect(page.locator('ul[aria-label="Lista testów"]')).toContainText(izaScore);
    await page.getByRole('button', { name: 'Wstecz' }).click();

    // F — offline po aktualizacji: start z precache i nauka wyłącznie z V18 (Free Flow bez sieci).
    // Bez sieci nieudane sprawdzenie `dme-release.json` jest oczekiwane — błędów konsoli nie zbieramy w tym kroku.
    problems.paused = true;
    server.hooks.offline = true;
    await page2.reload();
    await expect(page2.getByLabel('Aktywny profil')).toContainText(MONIKA, { timeout: 30_000 });
    await page2.locator('.mode-card', { hasText: 'Free Flow' }).click();
    await page2.getByRole('button', { name: 'Rozpocznij', exact: true }).click();
    for (let i = 0; i < 2; i++) {
      expect(ALLOWED.has((await currentQuestion(page2)).id)).toBe(true);
      await answer(page2, true);
      await next(page2);
    }
    server.hooks.offline = false;

    expect(problems.console, problems.console.join('\n')).toEqual([]);
    expect(problems.http, problems.http.join('\n')).toEqual([]);
  } finally {
    await server.close();
  }
});

test('V18: zamknięcie karty w trakcie pobierania aktualizacji i ponowne otwarcie kończy aktualizację', async ({ context }, testInfo) => {
  // Playwright WebKit (rev. 2359): pobieranie przerwane zamknięciem jedynej karty nie kończy się ani nie zgłasza błędu,
  // więc nowy Service Worker zostaje na stałe w stanie „installing” w tym samym kontekście przeglądarki (sprawdzone
  // 09.11.2026, także po ponownym otwarciu karty). Chromium: PASS. Fizyczny iPhone: G05 NOT RUN (docs/RAPORT_KONTROLI.md §6).
  test.skip(testInfo.project.name === 'webkit-iphone15', 'Playwright WebKit: instalacja SW przerwana zamknięciem karty nie wznawia się w tym samym kontekście');
  test.setTimeout(400_000);
  const server: DistServer = await startDistServer({ dist: OLD_DIST, base: BASE_PATH, port: 0 });
  try {
    const page = await context.newPage();
    await page.goto(server.url);
    await waitControlled(page);
    await chooseProfile(page, MONIKA);
    await oldCompletedTest(page, 2);
    await page.close();

    server.hooks.dist = NEW_DIST;
    let delayed = 0;
    server.hooks.delay = (rel) => (rel === CONTENT_RELEASE.bankFile && delayed++ === 0 ? 4000 : null);
    const p1 = await context.newPage();
    await p1.goto(server.url);
    await expect.poll(() => server.requests.includes(CONTENT_RELEASE.bankFile), { timeout: 30_000 }).toBe(true);
    await p1.close();
    server.hooks.delay = null;

    const p2 = await context.newPage();
    await p2.goto(server.url);
    await expect.poll(async () => p2.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL ?? ''), { timeout: 60_000 }).toContain('sw.js');
    await expect.poll(async () => (await cacheUrls(p2)).some((u) => u.includes(V15_BANK_FILE)), { timeout: 120_000, intervals: [1000] }).toBe(false);
    await expect.poll(async () => (await cacheUrls(p2)).some((u) => u.includes(CONTENT_RELEASE.bankFile)), { timeout: 60_000 }).toBe(true);
    // Profil (z karty albo z wyboru) otwiera się na V18; baza migruje do v4 bez dawnej treści.
    await ensureProfile(p2, MONIKA);
    await expect.poll(async () => (await dumpDb(p2, profileDb(MONIKA))).version, { timeout: 60_000 }).toBe(DB_SCHEMA_VERSION);
    const sessions = (await dumpDb(p2, profileDb(MONIKA))).stores.sessions as NewSession[];
    expect(sessions.map((s) => s.status)).toEqual(['completed']);
    expect(sessions.every((s) => Object.keys(s.slots).length === 0 && s.legacy?.reason === 'bank_v18_update')).toBe(true);
  } finally {
    await server.close();
  }
});
