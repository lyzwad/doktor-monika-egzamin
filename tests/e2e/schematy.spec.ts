/**
 * Schematy na PRAWDZIWYCH danych (bank release, ANAT-Q001 i DEV-Q041, rewizja 2) — WebKit „iPhone 15” i Chromium mobile:
 * - przed odpowiedzią widoczna tylko wersja pytania (P); alt, podpis, etykieta powiększenia, nazwa pliku
 *   i tekst samego SVG bez słów zdradzających klucz (porównanie z poprawną opcją i wersją objaśniającą O);
 *   w DOM brak śladu wersji O i wyjaśnienia (B04);
 * - powiększenie: 100–300% (krok 50%), „Dopasuj”, „Opis tekstowy”, „Zamknij”, pułapka i powrót fokusu;
 * - po odpowiedzi wersja objaśniająca (O) w wyjaśnieniu, także w powiększeniu;
 * - figury działają offline z precache Service Workera (serwer niedostępny, zero żądań do serwera).
 *
 * Deterministyczna droga do pytania ze schematem bez zmiany produkcyjnej logiki doboru: seed sesji pochodzi
 * z `crypto.getRandomValues(new Uint32Array(1))` (src/app/platform.ts). Test liczy w Node — tym samym silnikiem
 * domeny i tym samym bankiem — seed, przy którym Test 1 pytania w zakresie domena × poziom zaczyna się od
 * danego pytania, a w przeglądarce podstawia go skryptem testowym (jak inne haki e2e: `__dmeDenyIdb`, `__dmeProbe`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { startDistServer } from '../../scripts/serve-dist.mjs';
import { buildCatalog, emptyUserState, parseRuntimeBank, parseTrainingProfile, startTest as domainStartTest, type DifficultyChoice, type Scope } from '../../src/domain/api';
import { BASE_PATH, openFresh, readStore, reloadUntilControlled, waitOfflineReady } from './helpers';

interface RawFigure {
  id: string;
  file: string;
  alt_pl: string;
  caption_pl: string;
  variant: string;
}
interface RawQuestion {
  id: string;
  stem_pl: string;
  options: { id: string; text_pl: string }[];
  correct_option_id: string;
  correct_explanation_pl: string;
  figure_id: string | null;
  explanation_figure_id: string | null;
}
interface RawBank {
  questions: RawQuestion[];
  figures: Record<string, RawFigure>;
}

const RAW_TEXT = readFileSync(resolve(process.cwd(), 'public', CONTENT_RELEASE.bankFile), 'utf-8');
const RAW = JSON.parse(RAW_TEXT) as RawBank;

interface Case {
  id: string;
  scope: Scope;
  scopeLabel: string;
  difficulty: DifficultyChoice;
  difficultyLabel: string;
  /**
   * Rdzenie słów, którymi poprawna opcja i/lub wersja objaśniająca (O) wyrażają rozstrzygnięcie, a których nie ma
   * w treści pytania — nie mogą wystąpić w wersji pytania (P). Każdy rdzeń jest sprawdzany względem danych (musi
   * występować w kluczu albo w O), aby lista nie była zmyślona.
   */
  telltales: string[];
}

const CASES: Case[] = [
  { id: 'ANAT-Q001', scope: 'ANAT', scopeLabel: 'Anatomia', difficulty: 'basic', difficultyLabel: 'Łatwy', telltales: ['granicz', 'okolic', 'więzad', 'przestrze', 'potencjaln'] },
  { id: 'DEV-Q041', scope: 'DEV', scopeLabel: 'Urządzenia', difficulty: 'intermediate', difficultyLabel: 'Średni', telltales: ['koagul', 'usunię', 'mikrokana', 'ablac'] },
];

function questionOf(id: string): RawQuestion {
  const q = RAW.questions.find((x) => x.id === id);
  if (!q) throw new Error(`brak ${id} w banku`);
  return q;
}

function figureOf(id: string | null): RawFigure {
  const f = id ? RAW.figures[id] : undefined;
  if (!f) throw new Error(`brak figury ${id}`);
  return f;
}

/** Seed sesji, przy którym Test 1 pytania (zakres × poziom, pusty stan) zaczyna się od `questionId` — ten sam silnik co w aplikacji. */
function seedFor(c: Case): number {
  const parsed = parseRuntimeBank(JSON.parse(RAW_TEXT));
  if (!parsed.ok) throw new Error(parsed.error.messagePl);
  const retired = (JSON.parse(readFileSync(resolve(process.cwd(), 'public', CONTENT_RELEASE.retiredFile), 'utf-8')) as { ids: string[] }).ids;
  const profileParsed = parseTrainingProfile(JSON.parse(readFileSync(resolve(process.cwd(), 'public', CONTENT_RELEASE.profileFile), 'utf-8')), CONTENT_RELEASE.bankVersion);
  if (!profileParsed.ok) throw new Error(profileParsed.error.messagePl);
  const built = buildCatalog(parsed.value, { retiredQuestionIds: retired, profile: profileParsed.value, requiredBankVersion: CONTENT_RELEASE.bankVersion });
  if (!built.ok) throw new Error(built.error.messagePl);
  let n = 0;
  const ctx = { now: '2026-10-23T08:00:00.000Z', nextDayStart: '2026-10-23T22:00:00.000Z', commandId: 'seed-search', newId: () => `id-${++n}` };
  for (let seed = 1; seed < 200_000; seed++) {
    const r = domainStartTest(emptyUserState(), built.value, { config: { scope: c.scope, difficulty: c.difficulty, targetN: 1, myErrorsPriority: false }, seed }, ctx);
    if (!r.ok) throw new Error(r.error.messagePl);
    const s = r.value.state.sessions[r.value.value.sessionId];
    const first = s ? s.slots[s.plan[0] ?? ''] : undefined;
    if (first?.questionId === c.id) return seed;
  }
  throw new Error(`nie znaleziono seeda dla ${c.id}`);
}

/** Podstawia seed sesji: `crypto.getRandomValues(Uint32Array(1))` zwraca `seed` (inne wywołania bez zmian). */
async function injectSeed(page: Page, seed: number): Promise<void> {
  await page.addInitScript((value) => {
    const c = window.crypto;
    const original = c.getRandomValues.bind(c);
    c.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint32Array && array.length === 1) {
        array[0] = value;
        return array;
      }
      return original(array as never) as T;
    }) as Crypto['getRandomValues'];
  }, seed);
}

/** Test 1 pytania w zakresie i poziomie przypadku (UI jak użytkowniczka). */
async function startSchematicTest(page: Page, c: Case): Promise<void> {
  await page.locator('.mode-card', { hasText: 'Wybierz liczbę pytań' }).click();
  await expect(page.getByRole('heading', { name: 'Test', level: 1 })).toBeVisible();
  await page.locator('.select-row').click();
  const sheet = page.getByRole('dialog', { name: 'Zakres' });
  await sheet.getByRole('radio', { name: new RegExp(`^${c.scopeLabel}`) }).click();
  await expect(sheet).toHaveCount(0);
  await page.getByRole('radio', { name: c.difficultyLabel, exact: true }).click();
  await page.getByRole('textbox', { name: 'Liczba pytań' }).fill('1');
  await page.getByRole('button', { name: 'Rozpocznij test' }).click();
  await expect(page.locator('p.stem')).toHaveText(questionOf(c.id).stem_pl);
}

function lower(text: string | null | undefined): string {
  return (text ?? '').toLowerCase();
}

/** Dotknięcie poprawnej opcji (klucz z banku na dysku, rozpoznanie po tekście — B04). */
async function answerCorrect(page: Page, q: RawQuestion): Promise<void> {
  const key = q.options.find((o) => o.id === q.correct_option_id)?.text_pl.trim();
  const texts = (await page.locator('ul.answers .answer-card__body > span:nth-child(2)').allTextContents()).map((t) => t.trim());
  const idx = texts.indexOf(key ?? '');
  expect(idx).toBeGreaterThanOrEqual(0);
  await page.locator('ul.answers > li').nth(idx).locator('button').tap();
  await expect(page.locator('section.expl')).toBeVisible();
}

/** Powiększenie: 100–300% (krok 50%), „Dopasuj”, „Opis tekstowy”, „Zamknij”, fokus w dialogu i powrót. */
async function exerciseZoom(page: Page, opener: Locator, figure: RawFigure): Promise<void> {
  // Klawiaturą (jak w dostepnosc.spec): w WebKit kliknięcie nie ustawia fokusu na przycisku, a test sprawdza jego powrót.
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Powiększony schemat' });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  await expect(dialog.locator('img')).toHaveAttribute('src', new RegExp(`${figure.file.replace(/[.]/g, '\\.')}$`));
  await expect(dialog.locator('img')).toHaveAttribute('alt', figure.alt_pl);
  await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(figure.caption_pl);
  const pct = dialog.locator('.zoom__pct');
  const plus = dialog.getByRole('button', { name: 'Powiększ', exact: true });
  const minus = dialog.getByRole('button', { name: 'Pomniejsz', exact: true });
  await expect(pct).toHaveText('100%');
  await expect(minus).toBeDisabled();
  for (const expected of ['150%', '200%', '250%', '300%']) {
    await plus.click();
    await expect(pct).toHaveText(expected);
  }
  await expect(plus).toBeDisabled();
  await expect(dialog.locator('.zoom__canvas')).toHaveAttribute('style', /width:\s*300%/);
  await minus.click();
  await expect(pct).toHaveText('250%');
  await dialog.getByRole('button', { name: 'Dopasuj' }).click();
  await expect(pct).toHaveText('100%');
  const desc = dialog.getByRole('button', { name: 'Opis tekstowy' });
  await desc.click();
  await expect(dialog.getByRole('button', { name: 'Ukryj opis' })).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog.locator('.zoom__desc')).toContainText(figure.alt_pl);
  await dialog.getByRole('button', { name: 'Zamknij' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
}

async function imageLoaded(img: Locator): Promise<boolean> {
  return img.evaluate(async (el) => {
    const image = el as HTMLImageElement;
    if (!image.complete) await new Promise((r) => image.addEventListener('load', r, { once: true }));
    return image.naturalWidth > 0;
  });
}

for (const c of CASES) {
  test.describe(`${c.id} — schemat na prawdziwych danych`, () => {
    const q = questionOf(c.id);
    const P = figureOf(q.figure_id);
    const O = figureOf(q.explanation_figure_id);
    const key = q.options.find((o) => o.id === q.correct_option_id)?.text_pl ?? '';

    test('dane: P = wersja pytania, O = wersja objaśnienia; rdzenie „zdradzające” pochodzą z klucza lub O', () => {
      expect(P.variant).toBe('question');
      expect(O.variant).toBe('explanation');
      for (const t of c.telltales) {
        expect(lower(key).includes(t) || lower(`${O.alt_pl} ${O.caption_pl}`).includes(t), `rdzeń „${t}” nie występuje ani w kluczu, ani w O`).toBe(true);
      }
    });

    test('przed odpowiedzią tylko P bez słów zdradzających klucz; powiększenie; po odpowiedzi O w wyjaśnieniu', async ({ page }) => {
      await injectSeed(page, seedFor(c));
      await openFresh(page);
      await startSchematicTest(page, c);

      // --- Przed odpowiedzią: jedna figura (P), w treści pytania. ---
      const figures = page.locator('figure.figure');
      await expect(figures).toHaveCount(1);
      const img = figures.first().locator('img');
      await expect(img).toHaveAttribute('src', new RegExp(`${P.file.replace(/[.]/g, '\\.')}$`));
      await expect(img).toHaveAttribute('alt', P.alt_pl);
      await expect(figures.first().locator('figcaption .figure__caption-text')).toHaveText(P.caption_pl);
      expect(await imageLoaded(img)).toBe(true);
      const zoomButton = page.getByRole('button', { name: 'Powiększ schemat', exact: true });
      await expect(zoomButton).toBeVisible();

      const src = (await img.getAttribute('src')) ?? '';
      const fileName = src.split('/').pop() ?? '';
      const svgText = await page.evaluate(async (url) => {
        const text = await (await fetch(url)).text();
        const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
        return doc.documentElement.textContent ?? '';
      }, src);
      const visibleP = [P.alt_pl, P.caption_pl, (await zoomButton.getAttribute('aria-label')) ?? '', fileName, svgText].map(lower);
      for (const t of c.telltales) {
        for (const [i, text] of visibleP.entries()) {
          expect(text.includes(t), `wersja pytania (${['alt', 'podpis', 'aria-label', 'nazwa pliku', 'tekst SVG'][i]}) zawiera „${t}”`).toBe(false);
        }
      }
      // Ani tekst klucza, ani O, ani wyjaśnienie nie trafiają do DOM przed odpowiedzią (także w atrybutach).
      const html = await page.content();
      expect(html).not.toContain(O.file.split('/').pop() ?? 'brak');
      expect(html).not.toContain(O.caption_pl);
      expect(html).not.toContain(O.alt_pl);
      expect(html).not.toContain(q.correct_explanation_pl);
      await expect(page.locator('section.expl')).toHaveCount(0);

      // --- Powiększenie wersji pytania. ---
      await exerciseZoom(page, zoomButton, P);

      // --- Odpowiedź → wersja objaśniająca (O) w wyjaśnieniu. ---
      await answerCorrect(page, q);
      const explFigure = page.locator('section.expl figure.figure');
      await expect(explFigure).toHaveCount(1);
      const explImg = explFigure.locator('img');
      await expect(explImg).toHaveAttribute('src', new RegExp(`${O.file.replace(/[.]/g, '\\.')}$`));
      await expect(explImg).toHaveAttribute('alt', O.alt_pl);
      await expect(explFigure.locator('.figure__caption-text')).toHaveText(O.caption_pl);
      expect(await imageLoaded(explImg)).toBe(true);
      await exerciseZoom(page, page.getByRole('button', { name: 'Powiększ schemat objaśniający' }), O);
      // Wersja pytania zostaje nad wariantami (kontekst), objaśniająca tylko w wyjaśnieniu.
      await expect(page.locator('figure.figure')).toHaveCount(2);
    });
  });
}

test('figury z banku działają offline z precache (serwer niedostępny): P przed odpowiedzią, O po odpowiedzi', async ({ page }) => {
  const c = CASES[0] as Case;
  const q = questionOf(c.id);
  const P = figureOf(q.figure_id);
  const O = figureOf(q.explanation_figure_id);
  await injectSeed(page, seedFor(c));
  const server = await startDistServer({ dist: resolve(process.cwd(), 'dist'), base: BASE_PATH, port: 0 });
  try {
    await page.goto(server.url);
    await waitOfflineReady(page);
    // Wszystkie pliki figur z banku są w precache Service Workera. Odpytywanie: WebKit bywa, że kończy pierwszą
    // instalację z niepełnym cache — aplikacja ją odrzuca i instaluje ponownie (swController, discardIncompleteInstall).
    const precached = (files: string[]) => page.evaluate(async (files) => {
      const out: Record<string, boolean> = {};
      // Szukamy w cache precache Workboxa tej aplikacji (CacheStorage.match przegląda wszystkie cache po kolei —
      // od V15 jest też cache znacznika wersji treści; sprawdzamy dokładnie precache).
      const precacheName = (await caches.keys()).find((n) => n.startsWith('workbox-precache-v2-'));
      const precache = precacheName ? await caches.open(precacheName) : null;
      for (const f of files) out[f] = precache !== null && (await precache.match(new URL(f, location.href).href, { ignoreSearch: true })) !== undefined;
      return out;
    }, files);
    const figureFiles = Object.values(RAW.figures).map((f) => f.file);
    await expect
      .poll(async () => JSON.stringify(await precached(figureFiles)), { timeout: 30_000 })
      .toBe(JSON.stringify(Object.fromEntries(figureFiles.map((f) => [f, true]))));
    await reloadUntilControlled(page);

    server.hooks.offline = true;
    const before = server.requests.length;
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Doktor Monika Egzamin' })).toBeVisible();
    await startSchematicTest(page, c);
    const img = page.locator('figure.figure img').first();
    await expect(img).toHaveAttribute('src', new RegExp(`${P.file.replace(/[.]/g, '\\.')}$`));
    expect(await imageLoaded(img)).toBe(true);
    await answerCorrect(page, q);
    const explImg = page.locator('section.expl figure.figure img');
    await expect(explImg).toHaveAttribute('src', new RegExp(`${O.file.replace(/[.]/g, '\\.')}$`));
    expect(await imageLoaded(explImg)).toBe(true);
    expect(await readStore(page, 'attempts')).toHaveLength(1);
    // Nic nie dotarło do serwera — schematy, bank i aplikacja z precache.
    expect(server.requests.length).toBe(before);
  } finally {
    await server.close();
  }
});
