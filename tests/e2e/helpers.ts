/**
 * Pomocnicze dla testów e2e na buildzie produkcyjnym (prawdziwy kontroler, silnik, IndexedDB, SW).
 *
 * Klucz odpowiedzi NIE jest czytany z UI (B04: UI go nie zawiera przed odpowiedzią): test rozpoznaje
 * pytanie po treści (`p.stem`) i bierze klucz z banku V15 (`public/data/bank-<sha12>.json`) na dysku.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { E2E_PROFILE } from './fixtures';

interface BankOption {
  id: string;
  text_pl: string;
}
interface BankQuestion {
  id: string;
  stem_pl: string;
  options: BankOption[];
  correct_option_id: string;
  correct_explanation_pl: string;
  domain_id: string;
  family_id: string;
  source_ids: string[];
  source_locator_pl: string;
}
export interface Bank {
  bank_version: string;
  questions: BankQuestion[];
  domains: { id: string; title_pl: string }[];
  sources: Record<string, { id: string; title: string; url: string | null; doi: string | null }>;
}

export const BANK = JSON.parse(readFileSync(resolve(process.cwd(), 'public', CONTENT_RELEASE.bankFile), 'utf-8')) as Bank;
const BY_STEM = new Map(BANK.questions.map((q) => [q.stem_pl.trim(), q]));

export const BASE_PATH = process.env.BASE_PATH ?? '/';
export const SCREENSHOT_DIR = resolve(process.cwd(), 'docs/zrzuty');

/** Otwiera aplikację (opcjonalnie z hashem) i czeka na gotowy ekran. */
export async function openApp(page: Page, hash = ''): Promise<void> {
  await page.goto(`./${hash}`);
  await expect(page.locator('.app-root')).toBeVisible();
  await expect(page.getByText('Wczytywanie', { exact: false })).toHaveCount(0);
}

/**
 * Czeka na pierwsze przygotowanie offline: aktywny Service Worker (precache kompletny) i brak ekranu
 * „Przygotowanie materiałów”. Pierwsza instalacja nie przejmuje otwartej strony (bez clientsClaim).
 */
export async function waitOfflineReady(page: Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg?.active?.state === 'activated';
    },
    undefined,
    { timeout: 30_000 },
  );
  await expect(page.getByText('Przygotowanie materiałów do nauki')).toHaveCount(0);
}

/**
 * Przeładowanie do stanu „strona kontrolowana przez SW” (bez clientsClaim pierwsza instalacja
 * nie przejmuje otwartej strony; przy obciążeniu Chromium bywa, że pierwsze przeładowanie jeszcze nie).
 */
export async function reloadUntilControlled(page: Page): Promise<void> {
  // Aktywny worker gotowy (`ready`) przed przeładowaniem; pod obciążeniem (4 workery testów) Chromium
  // bywa, że kilka pierwszych przeładowań nie jest jeszcze przejętych — stąd więcej prób z odstępem.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  for (let i = 0; i < 8; i++) {
    await page.reload();
    await expect(page.locator('.app-root')).toBeVisible();
    if (await page.evaluate(() => navigator.serviceWorker.controller !== null)) return;
    await page.waitForTimeout(300 * (i + 1));
  }
  throw new Error('Strona nie jest kontrolowana przez Service Workera po przeładowaniu');
}

export async function openFresh(page: Page): Promise<void> {
  await openApp(page);
  await waitOfflineReady(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Doktor Monika Egzamin' })).toBeVisible();
}

/* -------------------------------------------------------------------------- */
/* Pytanie                                                                     */
/* -------------------------------------------------------------------------- */

export async function currentStem(page: Page): Promise<string> {
  const stem = page.locator('p.stem');
  await expect(stem).toBeVisible();
  return ((await stem.textContent()) ?? '').trim();
}

export async function currentQuestion(page: Page): Promise<BankQuestion> {
  const stem = await currentStem(page);
  const q = BY_STEM.get(stem);
  if (!q) throw new Error(`Nie znaleziono pytania w banku: ${stem.slice(0, 80)}`);
  return q;
}

/** Teksty wariantów w pokazanej kolejności. */
export async function optionTexts(page: Page): Promise<string[]> {
  const texts = await page.locator('ul.answers .answer-card__body > span:nth-child(2)').allTextContents();
  return texts.map((t) => t.trim());
}

export function answerButtons(page: Page) {
  return page.locator('ul.answers button.answer-card');
}

/** Indeks (w pokazanej kolejności) poprawnego albo pierwszego błędnego wariantu. */
export async function optionIndex(page: Page, correct: boolean): Promise<number> {
  const q = await currentQuestion(page);
  const key = q.options.find((o) => o.id === q.correct_option_id)?.text_pl.trim();
  const texts = await optionTexts(page);
  const idx = correct ? texts.indexOf(key ?? '') : texts.findIndex((t) => t !== key);
  if (idx < 0) throw new Error('Nie znaleziono wariantu');
  return idx;
}

/** Dotknięcie wariantu (tap — emulacja dotyku) i oczekiwanie na zapisaną ocenę. */
export async function answer(page: Page, correct: boolean): Promise<void> {
  const idx = await optionIndex(page, correct);
  await page.locator('ul.answers > li').nth(idx).locator('button').tap();
  await expect(page.locator('section.expl')).toBeVisible();
  await expect(answerButtons(page)).toHaveCount(0);
}

export async function next(page: Page): Promise<void> {
  const stem = await currentStem(page);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.locator('p.stem')).not.toHaveText(stem);
}

/** Tekst środka nagłówka postępu („3/20”, „Pytanie 4”). */
export function progressText(page: Page) {
  return page.locator('.progress-header__text');
}

/** Odpowiada na pozostałe pytania testu (poprawnie wg `pattern`) aż do „Pokaż wynik”. */
export async function finishTest(page: Page, pattern: (index: number) => boolean, startIndex = 0): Promise<void> {
  for (let i = startIndex; ; i++) {
    await answer(page, pattern(i));
    const showResult = page.getByRole('button', { name: 'Pokaż wynik' });
    if (await showResult.isVisible()) return;
    await next(page);
  }
}

/** Start testu z ekranu startowego (opcjonalnie inne N). */
export async function startTest(page: Page, n?: number): Promise<void> {
  await page.locator('.mode-card', { hasText: 'Wybierz liczbę pytań' }).click();
  await expect(page.getByRole('heading', { name: 'Test', level: 1 })).toBeVisible();
  if (n !== undefined) await page.getByRole('textbox', { name: 'Liczba pytań' }).fill(String(n));
  await page.getByRole('button', { name: 'Rozpocznij test' }).click();
  await expect(page.locator('p.stem')).toBeVisible();
}

/** Zrzut ekranu 393×852 do docs/zrzuty (tylko w projekcie WebKit iPhone 15, aby nie dublować). */
export async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  if (testInfo.project.name !== 'webkit-iphone15') return;
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  // Stabilny obraz: bez migającego kursora i animacji.
  await page.addStyleTag({ content: '*{caret-color:transparent!important;animation:none!important;transition:none!important}' }).catch(() => undefined);
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, `${name}.png`), scale: 'css', fullPage: false });
}

/** Odczyt rekordów z IndexedDB aplikacji (audyt w teście — np. próby, sesje). */
export async function readStore<T>(page: Page, store: string, dbName: string = profileDb(E2E_PROFILE)): Promise<T[]> {
  return page.evaluate(
    ([name, databaseName]) =>
      new Promise<T[]>((resolvePromise, reject) => {
        const req = indexedDB.open(databaseName);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(name, 'readonly');
          const all = tx.objectStore(name).getAll();
          all.onsuccess = () => {
            resolvePromise(all.result as T[]);
            db.close();
          };
          all.onerror = () => reject(all.error);
        };
      }),
    [store, dbName] as const,
  );
}

/** Baza danych nauki profilu (src/profiles/profiles.ts). */
export function profileDb(email: string): string {
  return `doktor-monika-egzamin:profil:${email}`;
}

/** Lista hostów żądań innych niż origin aplikacji (A04). */
export function trackExternalRequests(page: Page, origin: string): string[] {
  const external: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) external.push(url);
  });
  return external;
}
