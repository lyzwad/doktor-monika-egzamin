/**
 * Aktualizacja ZAINSTALOWANEJ aplikacji z produkcji (commit `39d9d46` — wiedza.doktormonika.pl od 09.11.2026, bank V18,
 * 700 pytań, IndexedDB v4, profile lokalne) do wydania „V18 + webinary” pod tym samym adresem — docs/MIGRACJA_WEBINARY.md:
 *  1. stara aplikacja (`git archive` → build w test-results/): dwa profile z danymi wpisanymi przez UI — Monika: ukończony
 *     test 3 z błędną odpowiedzią, zakończony Free Flow 2, otwarty test 5 z 2 odpowiedziami (1 błędna) i zgłoszeniem;
 *     Iza: ukończony test 2 z 1 błędną; zrzut obu baz (v4, sesje i snapshoty z `bankVersion` V18);
 *  2. podmiana `dist` (ten sam adres, bez czyszczenia danych) — nowy Service Worker przejmuje pierwszą kartę sam;
 *     `dme-release.json` = `CONTENT_RELEASE.bankVersion`;
 *  3. każdy profil migruje przy własnym otwarciu (v4 → v5, `createMigrationV5`, rekord `migration:bank-v18-webinary`;
 *     rekord `migration:bank-v18` z V18 zostaje): sesje V18 (ukończona, zakończona, otwarta)
 *     zostają z wynikiem, slotami i nową `bankVersion`, bez `legacy`; próby, `questionStats` i zgłoszenia zostają;
 *  4. Monika: „Kontynuuj” i dokończenie otwartego testu, historia z przeglądem dawnych odpowiedzi; „O bazie pytań”
 *     (liczba pytań i wiersz „Pytania z webinarów”); Test z „Moje błędy” (błędy z V18), Test 20, runda błędów,
 *     Free Flow — wyłącznie allowlista, bez powtórzeń; pytanie WB z przyciskiem „Źródło webinaru”, panelem z cytatem
 *     i bez `<a>` w wyjaśnieniu;
 *  5. dawne pliki `data/` V18 i V15 → 404 z Service Workera i z serwera; w Cache Storage brak plików V18;
 *  6. serwer niedostępny: start z precache, Free Flow z pytaniem WB ze źródłem; przez cały scenariusz 0 błędów konsoli
 *     i 0 odpowiedzi ≥ 400 poza celowymi (404 dawnych plików, nieudane sprawdzenie wersji offline).
 * To nie zastępuje testu na fizycznym iPhonie (G05): emulacja WebKit to nie Safari iOS z ekranu głównego.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { startDistServer, type DistServer } from '../../scripts/serve-dist.mjs';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';
import { DB_SCHEMA_VERSION } from '../../src/persistence/api';
import { BANK_MIGRATION_ID, BANK_MIGRATION_ID_V18 } from '../../src/persistence/bankMigration';
import { V18_ALLOWED } from '../../src/persistence/v18Allowlist';
import { NEW_DIST, attachNetwork, cacheUrls, chooseProfile, collectProblems, dumpDb, ensureOldDist, ensureProfile, waitControlled, type Dump } from './aktualizacja';
import { expect, test } from './fixtures';
import { BANK, BASE_PATH, answer, currentQuestion, next, profileDb, startTest } from './helpers';

const PROD_REF = '39d9d46';
const MONIKA = 'monika@doktormonika.pl';
const IZA = 'iza@doktormonika.pl';

/** Wydanie V18 na produkcji `39d9d46` — z paczki V18 w `content/v18/` (zostaje w repozytorium jako wejście scalania). */
const V18_MANIFEST = JSON.parse(readFileSync(resolve(process.cwd(), 'content/v18/MANIFEST.json'), 'utf-8')) as { bank_version: string; files: Record<string, string> };
const V18_IDS = new Set((JSON.parse(readFileSync(resolve(process.cwd(), 'content/v18/allowed_question_ids.json'), 'utf-8')) as { ids: string[] }).ids);
const sha12 = (file: string): string => (V18_MANIFEST.files[`runtime/${file}`] ?? '').slice(0, 12);
const V18 = {
  bankVersion: V18_MANIFEST.bank_version,
  bankFile: `data/bank-${sha12('bank.json')}.json`,
  retiredFile: `data/retired-question-ids-${sha12('retired_question_ids.json')}.json`,
  profileFile: `data/training-profile-${sha12('training_profile.json')}.json`,
};
/** Wersja IndexedDB aplikacji `39d9d46` (migracja v3 → v4 z V18). */
const V18_DB_VERSION = 4;
const V18_DATA_FILES = [V18.bankFile, V18.retiredFile, V18.profileFile];
const V15_DATA_FILES = ['data/bank.json', 'data/bank-37f3980a1129.json', 'data/retired-question-ids-83b36ff80986.json', 'data/training-profile-c0edd4ca07c2.json'];
/** Celowe zapytania testu o dawne pliki (404) — poza zbieraniem błędów. */
const OLD_DATA_FILES = [...V18_DATA_FILES, ...V15_DATA_FILES];

/** Allowlista bieżącego wydania (katalog przy starcie = ta lista). */
const ALLOWED = new Set(V18_ALLOWED.map(([id]) => id));

type BankRecord = Awaited<ReturnType<typeof currentQuestion>> & {
  origin?: string;
  evidence_quote?: string;
  evidence_unit_ids?: string[];
  source_note_pl?: string;
};
interface BankSource {
  id: string;
  title: string;
  kind_pl?: string;
  access_pl?: string;
  filename?: string;
}
const SOURCES = BANK.sources as unknown as Record<string, BankSource>;
const isWebinar = (q: BankRecord): boolean => q.origin === 'webinar';
const WEBINAR_COUNT = (BANK.questions as BankRecord[]).filter(isWebinar).length;

type Snapshot = { questionId: string; bankVersion: string; stem: string };
type StoredSession = {
  id: string;
  kind: string;
  status: string;
  bankVersion: string;
  createdAt: string;
  result: { correct: number; targetN: number; passed: boolean; percent: number } | null;
  slots: Record<string, { questionId: string; snapshot: Snapshot; attempt: { correct: boolean } | null; excluded: object | null }>;
  plan: string[];
  legacy?: { reason: string } | null;
};
type StoredAttempt = { id: string; questionId: string; correct: boolean; sessionId: string };
type StoredStat = { questionId: string; answeredCount: number; correctCount: number; wrongCount: number; activeError: boolean };
type StoredBlock = { id: string; questionId: string; revokedAt: string | null; stemPreview: string; inactiveReason?: string | null };

const sessionsOf = (d: Dump): StoredSession[] => d.stores.sessions as StoredSession[];
const attemptsOf = (d: Dump): StoredAttempt[] => d.stores.attempts as StoredAttempt[];
const statsOf = (d: Dump): StoredStat[] => d.stores.questionStats as StoredStat[];
const blocksOf = (d: Dump): StoredBlock[] => d.stores.blocks as StoredBlock[];
const contentVersionOf = (d: Dump): string | undefined => (d.stores.meta as { key: string; bankVersion?: string }[]).find((m) => m.key === 'content')?.bankVersion;
/** Rekord migracji treści w `meta` (`migration:<id>`) albo `undefined`. */
const migrationOf = (d: Dump, id: string): Record<string, unknown> | undefined => (d.stores.meta as { key: string }[]).find((m) => m.key === `migration:${id}`) as Record<string, unknown> | undefined;
const activeErrorIds = (d: Dump): string[] => statsOf(d).filter((s) => s.activeError).map((s) => s.questionId).sort();
/** Stan nauki do porównania przed i po migracji (bez dat — migracja ich nie zmienia, ale nie są tu kryterium). */
const statsKey = (d: Dump): string[] => statsOf(d).map((s) => `${s.questionId}:${s.answeredCount}/${s.correctCount}/${s.wrongCount}/${s.activeError}`).sort();
const attemptsKey = (d: Dump): string[] => attemptsOf(d).map((a) => `${a.id}:${a.questionId}:${a.correct}`).sort();

/* ---------------- stara aplikacja (39d9d46) ---------------- */

/** Ukończony test N w starej aplikacji: `pattern(i)` — czy odpowiedź i jest poprawna; zwraca wynik („2 z 3”). */
async function oldCompletedTest(page: Page, pattern: readonly boolean[]): Promise<string> {
  await startTest(page, pattern.length);
  for (let i = 0; i < pattern.length; i++) {
    await answer(page, pattern[i]!);
    if (i < pattern.length - 1) await next(page);
  }
  await page.getByRole('button', { name: 'Pokaż wynik' }).click();
  const score = ((await page.locator('.score').textContent()) ?? '').trim();
  await page.getByRole('button', { name: 'Wróć do startu', exact: true }).click();
  return score;
}

/** Monika: ukończony test 3 (1 błędna), zakończony Free Flow 2 (1 błędna), otwarty test 5 z 2 odpowiedziami (1 błędna) i zgłoszeniem. */
async function oldDataMonika(page: Page): Promise<string> {
  const score = await oldCompletedTest(page, [false, true, true]);
  await page.locator('.mode-card', { hasText: 'Free Flow' }).click();
  await page.getByRole('button', { name: 'Rozpocznij', exact: true }).click();
  await answer(page, true);
  await next(page);
  await answer(page, false);
  await page.getByRole('button', { name: 'Przerwij lub zakończ Free Flow' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Zakończ sesję' }).click();
  await expect(page.locator('.result-card')).toContainText('Sesja zakończona');
  await page.getByRole('button', { name: 'Wróć do startu', exact: true }).click();
  await startTest(page, 5);
  await answer(page, true);
  await next(page);
  await answer(page, false);
  await next(page);
  await page.getByRole('button', { name: 'Zgłoś błąd w pytaniu' }).click();
  await expect(page.getByText('Pytanie wykluczone. Zastąpiliśmy je innym.')).toBeVisible();
  await page.getByRole('button', { name: 'Przerwij test' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Kontynuuj później' }).click();
  await expect(page.locator('section.resume')).toContainText('2/5');
  return score;
}

/* ---------------- nowe wydanie ---------------- */

/**
 * Pytanie WB po odpowiedzi: wiersz źródła webinaru (tytuł, „transkrypcja webinaru · fragmenty automatycznych napisów”),
 * po rozwinięciu „Gdzie w źródle” z ID fragmentów, przycisk „Źródło webinaru” → panel z plikiem, cytatem i zastrzeżeniem;
 * w wyjaśnieniu nie ma żadnego `<a>` (teksty-ui.md).
 */
async function expectWebinarSource(page: Page, q: BankRecord): Promise<void> {
  const sourceId = q.source_ids[0]!;
  const source = SOURCES[sourceId]!;
  const expl = page.locator('section.expl');
  const row = expl.locator('li.source-row', { hasText: source.title });
  await expect(row).toContainText(`${source.kind_pl} · ${source.access_pl}`);
  await row.locator('.source-row__toggle').click();
  const units = (q.evidence_unit_ids ?? []).filter((u) => u.startsWith(`${sourceId}-`));
  expect(units.length).toBeGreaterThan(0);
  await expect(row).toContainText(`Gdzie w źródle: ${units.join(', ')}`);
  const button = row.getByRole('button', { name: 'Źródło webinaru' });
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(row).toContainText(`Plik: ${source.filename}`);
  await expect(row).toContainText('Fragment automatycznych napisów — może zawierać błędy rozpoznawania mowy');
  await expect(row.locator('blockquote')).toContainText(q.evidence_quote ?? '-');
  await expect(row).toContainText(q.source_note_pl ?? '-');
  await expect(row).toContainText('Źródło egzaminacyjne z wykładu, nie zweryfikowane aktualne wytyczne.');
  await expect(expl.locator('a')).toHaveCount(0);
  await expect(expl.getByText('Otwórz publikację')).toHaveCount(0);
}

/** Źródło WB sprawdzone w tym przebiegu (pierwsze pytanie WB w Teście lub rundzie). */
let webinarChecked = false;

/**
 * Pytania sesji aż do „Pokaż wynik”: każde z allowlisty, bez powtórzeń w sesji (`seen` — także pytania sprzed wznowienia).
 * Pierwsze napotkane pytanie WB → kontrola źródła. Zwraca ID pokazanych pytań.
 */
async function playUntilResult(page: Page, correct: (i: number) => boolean, seen: string[] = [], onQuestion?: (q: BankRecord, i: number) => Promise<void>): Promise<string[]> {
  const shown: string[] = [];
  for (let i = 0; ; i++) {
    const q = (await currentQuestion(page)) as BankRecord;
    expect(ALLOWED.has(q.id), q.id).toBe(true);
    expect([...seen, ...shown], q.id).not.toContain(q.id);
    shown.push(q.id);
    await onQuestion?.(q, i);
    await answer(page, correct(i));
    if (isWebinar(q) && !webinarChecked) {
      await expectWebinarSource(page, q);
      webinarChecked = true;
    }
    if (await page.getByRole('button', { name: 'Pokaż wynik' }).isVisible()) return shown;
    await next(page);
  }
}

/** Free Flow do pierwszego pytania WB (losowanie do skutku, do 40 pytań): pytania z allowlisty, bez powtórzeń; źródło WB. */
async function freeFlowUntilWebinar(page: Page): Promise<void> {
  await page.locator('.mode-card', { hasText: 'Free Flow' }).click();
  const toggle = page.getByRole('switch', { name: /Moje błędy/ });
  if ((await toggle.getAttribute('aria-checked')) === 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Rozpocznij', exact: true }).click();
  const shown: string[] = [];
  for (let i = 0; i < 40; i++) {
    const q = (await currentQuestion(page)) as BankRecord;
    expect(ALLOWED.has(q.id), q.id).toBe(true);
    expect(shown, q.id).not.toContain(q.id);
    shown.push(q.id);
    await answer(page, true);
    if (isWebinar(q)) {
      await expectWebinarSource(page, q);
      return;
    }
    await next(page);
  }
  throw new Error(`Free Flow: brak pytania WB w 40 pytaniach (${WEBINAR_COUNT} z ${ALLOWED.size} w puli)`);
}

/** Konfiguracja testu: N i stan przełącznika „Moje błędy”. */
async function configureTest(page: Page, n: number, myErrors: boolean): Promise<void> {
  await page.locator('.mode-card', { hasText: 'Wybierz liczbę pytań' }).click();
  await expect(page.getByRole('heading', { name: 'Test', level: 1 })).toBeVisible();
  await page.getByRole('textbox', { name: 'Liczba pytań' }).fill(String(n));
  const toggle = page.getByRole('switch', { name: /Moje błędy/ });
  if ((await toggle.getAttribute('aria-checked')) !== String(myErrors)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(myErrors));
}

test.describe.configure({ mode: 'serial' });
test.use({ presetProfile: null });

let OLD_DIST = '';
test.beforeAll(() => {
  test.setTimeout(400_000);
  OLD_DIST = ensureOldDist(PROD_REF, 'produkcja-v18', V18.bankFile);
});

test('webinary: aktualizacja z produkcji 39d9d46 (V18, dwa profile) — przejęcie karty, migracja każdego profilu, wydanie V18 + webinary, offline', async ({ context }, testInfo) => {
  test.setTimeout(900_000);
  webinarChecked = false;
  const server: DistServer = await startDistServer({ dist: OLD_DIST, base: BASE_PATH, port: 0 });
  // Błędy konsoli i odpowiedzi ≥ 400 przez cały scenariusz (stara aplikacja, aktualizacja, nowe wydanie).
  const problems = collectProblems(context, OLD_DATA_FILES);
  try {
    /* 1. Stara aplikacja z produkcji: dwa profile z historią. */
    const page = await context.newPage();
    await page.goto(server.url);
    await waitControlled(page);
    await chooseProfile(page, MONIKA);
    const monikaScore = await oldDataMonika(page);
    await page.getByLabel('Aktywny profil').getByRole('button', { name: 'Zmień profil' }).click();
    await chooseProfile(page, IZA);
    const izaScore = await oldCompletedTest(page, [true, false]);
    expect(monikaScore).toBe('2 z 3');
    expect(izaScore).toBe('1 z 2');

    const beforeM = await dumpDb(page, profileDb(MONIKA));
    const beforeI = await dumpDb(page, profileDb(IZA));
    expect([beforeM.version, beforeI.version]).toEqual([V18_DB_VERSION, V18_DB_VERSION]);
    const oldM = sessionsOf(beforeM);
    const oldI = sessionsOf(beforeI);
    expect(oldM.map((s) => `${s.kind}:${s.status}`).sort()).toEqual(['freeflow:ended', 'test:completed', 'test:open']);
    expect(oldI.map((s) => `${s.kind}:${s.status}`)).toEqual(['test:completed']);
    expect(oldM.find((s) => s.status === 'completed')?.result).toMatchObject({ correct: 2, targetN: 3 });
    expect(oldI[0]?.result).toMatchObject({ correct: 1, targetN: 2 });
    for (const s of [...oldM, ...oldI]) {
      expect(s.bankVersion, s.id).toBe(V18.bankVersion);
      expect(s.legacy ?? null, s.id).toBeNull();
      for (const slot of Object.values(s.slots)) {
        expect(slot.snapshot.bankVersion, slot.questionId).toBe(V18.bankVersion);
        expect(V18_IDS.has(slot.questionId), slot.questionId).toBe(true);
      }
    }
    const oldOpen = oldM.find((s) => s.status === 'open')!;
    expect(Object.values(oldOpen.slots).filter((x) => x.attempt).map((x) => x.attempt!.correct).sort()).toEqual([false, true]);
    expect(Object.values(oldOpen.slots).filter((x) => x.excluded)).toHaveLength(1);
    // Próby (3 + 2 + 2 Moniki, 2 Izy), błędy w stanie powtórek, zgłoszenie Moniki; meta treści = V18.
    expect([attemptsOf(beforeM).length, attemptsOf(beforeI).length]).toEqual([7, 2]);
    expect(activeErrorIds(beforeM).length).toBeGreaterThanOrEqual(1);
    expect(activeErrorIds(beforeI)).toHaveLength(1);
    expect(blocksOf(beforeM)).toHaveLength(1);
    expect(blocksOf(beforeM)[0]?.revokedAt).toBeNull();
    expect([contentVersionOf(beforeM), contentVersionOf(beforeI)]).toEqual([V18.bankVersion, V18.bankVersion]);
    // Aplikacja V18 zapisała rekord migracji v4 (`migration:bank-v18`); rekordu v5 jeszcze nie ma.
    for (const d of [beforeM, beforeI]) {
      expect(migrationOf(d, BANK_MIGRATION_ID_V18)).toMatchObject({ migrationId: BANK_MIGRATION_ID_V18, toSchemaVersion: V18_DB_VERSION });
      expect(migrationOf(d, BANK_MIGRATION_ID)).toBeUndefined();
    }
    expect((await cacheUrls(page)).some((u) => u.includes(V18.bankFile))).toBe(true);
    expect(problems.console, problems.console.join('\n')).toEqual([]);
    expect(problems.http, problems.http.join('\n')).toEqual([]);

    // Nowe wydanie ma inną wersję treści niż produkcja 39d9d46 — inaczej nie byłoby czego przejmować.
    expect(CONTENT_RELEASE.bankVersion).not.toBe(V18.bankVersion);

    await page.evaluate(() => {
      (window as unknown as { __dmeOld?: number }).__dmeOld = 1;
    });

    /* 2. „Wdrożenie” nowego wydania pod tym samym adresem. */
    server.hooks.dist = NEW_DIST;
    const page2 = await context.newPage();
    await page2.goto(server.url);
    // Nowy SW przejmuje pierwszą kartę sam (bez przeładowania przez test i bez czyszczenia danych).
    await expect
      .poll(async () => (await page.evaluate(() => (window as unknown as { __dmeOld?: number }).__dmeOld ?? null).catch(() => 'nav')) ?? null, { timeout: 120_000 })
      .toBeNull();
    await expect.poll(async () => (await page.evaluate(() => fetch('dme-release.json', { cache: 'no-store' }).then((r) => r.json()))).bankVersion, { timeout: 30_000 }).toBe(CONTENT_RELEASE.bankVersion);

    /* 3. Migracja: karta 1 wraca do profilu karty (Iza); baza Moniki czeka na własne otwarcie. */
    await expect(page.getByLabel('Aktywny profil')).toContainText(IZA, { timeout: 90_000 });
    await expect.poll(async () => (await dumpDb(page, profileDb(IZA))).version, { timeout: 60_000 }).toBe(DB_SCHEMA_VERSION);
    expect((await dumpDb(page, profileDb(MONIKA))).version).toBe(V18_DB_VERSION);
    await ensureProfile(page2, MONIKA);
    await expect.poll(async () => (await dumpDb(page2, profileDb(MONIKA))).version, { timeout: 60_000 }).toBe(DB_SCHEMA_VERSION);
    const afterM = await dumpDb(page2, profileDb(MONIKA));
    const afterI = await dumpDb(page, profileDb(IZA));
    for (const [before, after] of [
      [beforeM, afterM],
      [beforeI, afterI],
    ] as const) {
      const oldSessions = sessionsOf(before);
      const newSessions = sessionsOf(after);
      expect(newSessions.map((s) => s.id).sort()).toEqual(oldSessions.map((s) => s.id).sort());
      for (const s of newSessions) {
        const old = oldSessions.find((o) => o.id === s.id)!;
        // Sesja V18 (ukończona, zakończona, otwarta) zostaje aktywna: status, wynik i sloty bez zmian, nowa wersja banku.
        expect(s, s.id).toMatchObject({ status: old.status, createdAt: old.createdAt, result: old.result, plan: old.plan, bankVersion: CONTENT_RELEASE.bankVersion });
        expect(s.legacy ?? null, s.id).toBeNull();
        expect(Object.keys(s.slots).sort()).toEqual(Object.keys(old.slots).sort());
        for (const [slotId, slot] of Object.entries(s.slots)) {
          expect(slot.snapshot.bankVersion, slotId).toBe(CONTENT_RELEASE.bankVersion);
          expect(slot.snapshot.stem).toBe(old.slots[slotId]!.snapshot.stem);
          expect(slot.attempt?.correct ?? null).toBe(old.slots[slotId]!.attempt?.correct ?? null);
        }
      }
      expect(attemptsKey(after)).toEqual(attemptsKey(before));
      expect(statsKey(after)).toEqual(statsKey(before));
      expect(blocksOf(after).map((b) => ({ id: b.id, revokedAt: b.revokedAt, stemPreview: b.stemPreview, inactive: b.inactiveReason ?? null }))).toEqual(
        blocksOf(before).map((b) => ({ id: b.id, revokedAt: b.revokedAt, stemPreview: b.stemPreview, inactive: b.inactiveReason ?? null })),
      );
      expect(contentVersionOf(after)).toBe(CONTENT_RELEASE.bankVersion);
      // Dane przekształca migracja v5 (v4 → v5, rekord `migration:bank-v18-webinary`); rekord V18 z v4 zostaje bez zmian.
      expect(migrationOf(after, BANK_MIGRATION_ID)).toMatchObject({ migrationId: BANK_MIGRATION_ID, fromSchemaVersion: V18_DB_VERSION, toSchemaVersion: DB_SCHEMA_VERSION });
      expect(migrationOf(after, BANK_MIGRATION_ID_V18)).toEqual(migrationOf(before, BANK_MIGRATION_ID_V18));
    }

    /* 5. Dawne pliki: Cache Storage bez V18, nowy bank w precache; 404 z Service Workera i z serwera. */
    const urls = await cacheUrls(page2);
    expect(urls.filter((u) => OLD_DATA_FILES.some((f) => u.includes(f)))).toEqual([]);
    expect(urls.some((u) => u.includes(CONTENT_RELEASE.bankFile))).toBe(true);
    // 404 z Service Workera: karta kontrolowana przez nowy SW, a żadne z tych żądań nie dociera do serwera
    // (inaczej 404 serwera zastąpiłoby brakującą regułę SW).
    expect(await page2.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? '')).toContain('sw.js');
    const oldFiles = [...OLD_DATA_FILES, `${V18.bankFile}?v=${V18.bankVersion}`];
    const requestsBefore = server.requests.length;
    for (const f of oldFiles) {
      expect(await page2.evaluate(async (u) => (await fetch(u)).status, `${server.url}${f}`), `SW: ${f}`).toBe(404);
      expect(await page2.evaluate(async (u) => (await fetch(u, { cache: 'no-store' })).status, `${server.url}${f}`), `SW no-store: ${f}`).toBe(404);
    }
    expect(server.requests.slice(requestsBefore).filter((rel) => rel.startsWith('data/'))).toEqual([]);
    for (const f of oldFiles) expect((await fetch(`${server.url}${f}`)).status, `serwer: ${f}`).toBe(404);

    /* 4. Monika: „Kontynuuj” — dokończenie otwartego testu V18 z wynikiem. */
    await expect(page2.locator('section.resume')).toContainText('2/5');
    await page2.locator('section.resume').getByRole('button', { name: 'Kontynuuj', exact: true }).click();
    // Pytania już pokazane w tej sesji (odpowiedzi i zgłoszone) nie wracają; dokończenie — same poprawne.
    const shownBefore = Object.values(oldOpen.slots).filter((x) => x.attempt || x.excluded).map((x) => x.questionId);
    await playUntilResult(page2, () => true, shownBefore);
    await page2.getByRole('button', { name: 'Pokaż wynik' }).click();
    await expect(page2.locator('.score')).toHaveText('4 z 5');
    await page2.getByRole('button', { name: 'Wróć do startu', exact: true }).click();

    // Historia: dawny wynik V18 z przeglądem odpowiedzi i dokończony test.
    await page2.getByRole('button', { name: 'Historia' }).click();
    const list = page2.locator('ul[aria-label="Lista testów"]');
    await expect(list.locator('> li')).toHaveCount(2);
    await expect(list).toContainText(monikaScore);
    await expect(list).toContainText('4 z 5');
    await list.locator('> li', { hasText: monikaScore }).first().click();
    await expect(page2.getByText('Treść pytań poprzedniej wersji banku nie jest dostępna')).toHaveCount(0);
    await page2.getByRole('button', { name: 'Przejrzyj odpowiedzi' }).click();
    const reviewRows = page2.locator('ul[aria-label="Pozycje przeglądu"] > li');
    await expect(reviewRows).toHaveCount(3);
    await reviewRows.first().click();
    const oldCompleted = oldM.find((s) => s.status === 'completed')!;
    expect(Object.values(oldCompleted.slots).map((x) => x.snapshot.stem.trim())).toContain(((await page2.locator('p.stem').textContent()) ?? '').trim());
    await page2.getByRole('button', { name: 'Wróć do listy' }).first().click();
    await page2.getByRole('button', { name: 'Wróć do wyniku' }).click();
    await page2.getByRole('button', { name: 'Wstecz' }).click();
    await page2.getByRole('button', { name: 'Wstecz' }).click();

    // „O bazie pytań”: liczba pytań wydania i wiersz „Pytania z webinarów”.
    expect(WEBINAR_COUNT).toBeGreaterThan(0);
    expect(ALLOWED.size).toBe(CONTENT_RELEASE.counts.questions);
    await page2.getByRole('button', { name: 'Ustawienia' }).click();
    await page2.getByRole('button', { name: /O bazie pytań/ }).click();
    await expect(page2.getByRole('heading', { name: 'O bazie pytań' })).toBeVisible();
    await expect(page2.getByText(`Wbudowana pula zawiera ${CONTENT_RELEASE.counts.questions} pytań`, { exact: false })).toBeVisible();
    await expect(page2.locator('ul.about-table > li', { hasText: 'Pytania z webinarów' }).locator('.about-table__count')).toHaveText(String(WEBINAR_COUNT));
    await page2.getByRole('button', { name: 'Wstecz' }).click();
    await page2.getByRole('button', { name: 'Wstecz' }).click();

    // Test z „Moje błędy”: błędy zapisane w V18 (stan powtórek przeniesiony migracją) są w teście pozycjami
    // obowiązkowymi z oznaczeniem „Moje błędy” (Test tasuje kolejność pozycji — nie muszą być pierwsze).
    const errorsNow = activeErrorIds(await dumpDb(page2, profileDb(MONIKA)));
    expect(errorsNow).toEqual(activeErrorIds(beforeM));
    expect(errorsNow.length).toBeGreaterThan(0);
    expect(errorsNow.length).toBeLessThanOrEqual(5);
    await configureTest(page2, 5, true);
    await expect(page2.getByText(new RegExp(`Najpierw ${errorsNow.length} pyta\\S* z wcześniejszymi błędami`))).toBeVisible();
    await page2.getByRole('button', { name: 'Rozpocznij test' }).click();
    const myErrorsShown = await playUntilResult(page2, () => true, [], async (q) => {
      if (errorsNow.includes(q.id)) await expect(page2.locator('.q-meta')).toContainText('Moje błędy');
      else await expect(page2.locator('.q-meta')).not.toContainText('Moje błędy');
    });
    expect(myErrorsShown.filter((id) => errorsNow.includes(id)).sort()).toEqual(errorsNow);
    await page2.getByRole('button', { name: 'Pokaż wynik' }).click();
    await expect(page2.locator('.score')).toHaveText('5 z 5');
    await page2.getByRole('button', { name: 'Wróć do startu', exact: true }).click();

    // Test 20 (12/20 — próg 65% nieosiągnięty) i runda błędów — wyłącznie allowlista, bez powtórzeń.
    await configureTest(page2, 20, false);
    await page2.getByRole('button', { name: 'Rozpocznij test' }).click();
    const test20 = await playUntilResult(page2, (i) => i < 12);
    expect(test20).toHaveLength(20);
    await page2.getByRole('button', { name: 'Pokaż wynik' }).click();
    await expect(page2.locator('.score')).toHaveText('12 z 20');
    await page2.getByRole('button', { name: /Uwzględnij błędy/ }).click();
    await page2.getByRole('dialog').getByRole('button', { name: 'Rozpocznij rundę' }).click();
    await expect(page2.locator('.q-meta')).toContainText('Powtórka · runda 2');
    await playUntilResult(page2, () => true);
    await page2.getByRole('button', { name: 'Pokaż wynik' }).click();
    await page2.getByRole('button', { name: 'Wróć do startu', exact: true }).click();

    // Free Flow: pytanie WB ze źródłem webinaru (losowanie do skutku).
    await freeFlowUntilWebinar(page2);
    await page2.getByRole('button', { name: 'Przerwij lub zakończ Free Flow' }).click();
    await page2.getByRole('dialog').getByRole('button', { name: 'Zakończ sesję' }).click();
    await page2.getByRole('button', { name: 'Wróć do startu', exact: true }).click();

    // Iza (karta 1): osobna historia z dawnym wynikiem V18 i przeglądem odpowiedzi.
    await page.reload();
    await expect(page.getByLabel('Aktywny profil')).toContainText(IZA, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Historia' }).click();
    await expect(page.locator('ul[aria-label="Lista testów"] > li')).toHaveCount(1);
    await expect(page.locator('ul[aria-label="Lista testów"]')).toContainText(izaScore);
    await page.locator('ul[aria-label="Lista testów"] > li').first().click();
    await expect(page.getByRole('button', { name: 'Przejrzyj odpowiedzi' })).toBeVisible();
    await page.getByRole('button', { name: 'Wstecz' }).click();
    await page.getByRole('button', { name: 'Wstecz' }).click();

    /* 6. Offline po aktualizacji: start z precache, Free Flow z pytaniem WB ze źródłem. Bez sieci nieudane sprawdzenie
       `dme-release.json` jest oczekiwane — błędów konsoli nie zbieramy w tym kroku. */
    problems.paused = true;
    server.hooks.offline = true;
    await page2.reload();
    await expect(page2.getByLabel('Aktywny profil')).toContainText(MONIKA, { timeout: 30_000 });
    await freeFlowUntilWebinar(page2);
    server.hooks.offline = false;
    problems.paused = false;

    expect(problems.console, problems.console.join('\n')).toEqual([]);
    expect(problems.http, problems.http.join('\n')).toEqual([]);
  } finally {
    await attachNetwork(testInfo, problems);
    await server.close();
  }
});
