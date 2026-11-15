/**
 * Aktualizacja ZAINSTALOWANEJ aplikacji z produkcji V15 (commit `b6f9201` — wiedza.doktormonika.pl 25.10–09.11.2026,
 * bank V15, profile lokalne; urządzenie nieotwierane od tamtej pory) do BIEŻĄCEGO wydania treści pod tym samym adresem
 * (od 09.11.2026 V18 — docs/MIGRACJA_V18.md; od 15.11.2026 „V18 + webinary” — docs/MIGRACJA_WEBINARY.md):
 *  1. stara aplikacja (zbudowana z commita do test-results/, `git archive`): dwa profile z danymi wpisanymi przez UI
 *     (Monika: ukończony test, zakończony Free Flow, otwarty test ze zgłoszeniem; Iza: ukończony test);
 *  2. podmiana `dist` (ten sam adres) — nowy Service Worker przejmuje otwarte karty sam (bez czyszczenia danych);
 *  3. każdy profil migruje przy własnym otwarciu (v3 → `DB_SCHEMA_VERSION`: dane przekształca jeden krok — migracja
 *     v5, `migration:bank-v18-webinary` w `meta`; v4 to krok historyczny bez zmian danych); wyniki liczbowe i daty
 *     zostają, treść V15 znika z IndexedDB obu profili i z Cache Storage; dawne pliki banków → 404 (SW i serwer);
 *  4. nowa nauka wyłącznie z allowlisty bieżącego wydania: Test 20 — 13/20 zaliczony, 12/20 niezaliczony (próg 65%), runda błędów,
 *     Free Flow, odświeżenie i historia, start offline po aktualizacji; brak błędów konsoli i odpowiedzi ≥ 400;
 *  5. zamknięcie karty w trakcie pobierania aktualizacji i ponowne otwarcie kończy aktualizację.
 * To nie zastępuje testu na fizycznym iPhonie (G05): emulacja WebKit to nie Safari iOS z ekranu głównego.
 */
import type { Page } from '@playwright/test';
import { startDistServer, type DistServer } from '../../scripts/serve-dist.mjs';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';
import { DB_SCHEMA_VERSION } from '../../src/persistence/api';
import { BANK_MIGRATION_ID, BANK_MIGRATION_ID_V18 } from '../../src/persistence/bankMigration';
import { V18_ALLOWED } from '../../src/persistence/v18Allowlist';
import { NEW_DIST, attachNetwork, cacheUrls, chooseProfile, collectProblems, dumpDb, ensureOldDist, ensureProfile, waitControlled } from './aktualizacja';
import { expect, test } from './fixtures';
import { BANK, BASE_PATH, answer, currentQuestion, next, profileDb } from './helpers';

const PROD_REF = 'b6f9201';
const MONIKA = 'monika@doktormonika.pl';
const IZA = 'iza@doktormonika.pl';
const V15_BANK_FILE = 'data/bank-37f3980a1129.json';
const OLD_DATA_FILES = ['data/bank.json', V15_BANK_FILE, 'data/retired-question-ids-83b36ff80986.json', 'data/training-profile-c0edd4ca07c2.json'];
const ALLOWED = new Set(V18_ALLOWED.map(([id]) => id));
/** Treści pytań bieżącego banku (wydanie z V18 — żadna treść V15 nie może do niego należeć). */
const CURRENT_STEMS = new Set(BANK.questions.map((q) => q.stem_pl.trim()));
/** Build wdrożonej wersji V15 (`test-results/dist-produkcja-v15`, aktualizacja.ts). */
let OLD_DIST = '';

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
    const q = await currentQuestion(page); // rzuca, gdy treść spoza bieżącego banku
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
  OLD_DIST = ensureOldDist(PROD_REF, 'produkcja-v15', V15_BANK_FILE);
});

test('V18: aktualizacja z produkcji V15 (profile) do bieżącego wydania — przejęcie kart, migracja każdego profilu (v3 → v5), wyłącznie allowlista wydania, offline', async ({ context }, testInfo) => {
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
    expect(oldStems.some((stem) => CURRENT_STEMS.has(stem))).toBe(false);
    expect((await cacheUrls(page)).some((u) => u.includes(V15_BANK_FILE))).toBe(true);
    await page.evaluate(() => {
      (window as unknown as { __dmeOld?: number }).__dmeOld = 1;
    });

    // „Wdrożenie” bieżącego wydania pod tym samym adresem; od tej chwili zbieramy błędy konsoli i odpowiedzi ≥ 400.
    const problems = collectProblems(context, OLD_DATA_FILES);
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
    // Brak dawnej treści w obu bazach (sesje, blokady, kopie bezpieczeństwa); meta = bieżące wydanie.
    // Jedna transformacja danych: migracja v5 z bazy v3 (rekord `migration:bank-v18-webinary`); historyczny krok v4
    // nie zmienia danych, więc rekordu `migration:bank-v18` nie ma.
    for (const dump of [monikaAfter, izaAfter]) {
      const text = JSON.stringify(dump.stores);
      for (const stem of oldStems) expect(text).not.toContain(stem.slice(0, 50));
      const meta = dump.stores.meta as { key: string; bankVersion?: string; migrationId?: string; fromSchemaVersion?: number; toSchemaVersion?: number }[];
      expect(meta.find((m) => m.key === 'content')?.bankVersion).toBe(CONTENT_RELEASE.bankVersion);
      expect(meta.find((m) => m.key === `migration:${BANK_MIGRATION_ID}`)).toMatchObject({ migrationId: BANK_MIGRATION_ID, fromSchemaVersion: 3, toSchemaVersion: DB_SCHEMA_VERSION });
      expect(meta.some((m) => m.key === `migration:${BANK_MIGRATION_ID_V18}`)).toBe(false);
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
    // Runda błędów: błędy ostatniej rundy (8) uzupełnione pytaniami z puli bieżącego wydania.
    await page2.getByRole('button', { name: /Uwzględnij błędy/ }).click();
    await page2.getByRole('dialog').getByRole('button', { name: 'Rozpocznij rundę' }).click();
    await expect(page2.locator('.q-meta')).toContainText('Powtórka · runda 2');
    expect(ALLOWED.has((await currentQuestion(page2)).id)).toBe(true);
    await expect(page2.locator('.q-meta__level')).toHaveCount(0);
    await page2.getByRole('button', { name: 'Przerwij test' }).click();
    await page2.getByRole('dialog').getByRole('button', { name: 'Kontynuuj później' }).click();

    // Free Flow: wyłącznie allowlista bieżącego wydania.
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

    // F — offline po aktualizacji: start z precache i nauka wyłącznie z bieżącego wydania (Free Flow bez sieci).
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

    await attachNetwork(testInfo, problems);
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
    // Profil (z karty albo z wyboru) otwiera się na bieżącym wydaniu; baza migruje (v3 → v5) bez dawnej treści.
    await ensureProfile(p2, MONIKA);
    await expect.poll(async () => (await dumpDb(p2, profileDb(MONIKA))).version, { timeout: 60_000 }).toBe(DB_SCHEMA_VERSION);
    const sessions = (await dumpDb(p2, profileDb(MONIKA))).stores.sessions as NewSession[];
    expect(sessions.map((s) => s.status)).toEqual(['completed']);
    expect(sessions.every((s) => Object.keys(s.slots).length === 0 && s.legacy?.reason === 'bank_v18_update')).toBe(true);
  } finally {
    await server.close();
  }
});
