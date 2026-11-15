/**
 * Wspólne narzędzia e2e aktualizacji ZAINSTALOWANEJ aplikacji (stara wersja zbudowana z commita produkcji → nowy build
 * pod tym samym adresem, bez czyszczenia danych przeglądarki): build starej wersji, czekanie na kontrolę przez Service
 * Workera, wybór profilu, zrzut IndexedDB, adresy w Cache Storage oraz zbieranie błędów konsoli i odpowiedzi ≥ 400.
 *
 * Używają: `aktualizacja-v18.spec.ts` (z `b6f9201`, bank V15) i `aktualizacja-webinary.spec.ts` (z `39d9d46`, bank V18).
 * Moduł nie jest plikiem testów (`*.spec.ts`) — Playwright go nie uruchamia.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext, ConsoleMessage, Page, TestInfo } from '@playwright/test';
import { expect } from './fixtures';
import { BASE_PATH } from './helpers';

/** Bieżący build (`npm run build` albo `E2E_SKIP_BUILD=1` z gotowym `dist`). */
export const NEW_DIST = resolve(process.cwd(), 'dist');

/**
 * Build wdrożonej wersji `ref` (raz na przebieg): `git archive` → vite build z tym samym BASE_PATH do
 * `test-results/dist-<nazwa>`. Każdy proces testów buduje we własnym katalogu i podmienia wynik atomowo (`rename`) —
 * równoległe workery się nie zderzają. Build jest gotowy, gdy ma `sw.js` i `plikGotowosci` (ścieżka względem dist,
 * np. plik banku tej wersji). Zwraca katalog buildu.
 */
export function ensureOldDist(ref: string, nazwa: string, plikGotowosci: string): string {
  const oldSrc = resolve(process.cwd(), 'test-results', `zrodlo-${nazwa}`);
  const oldDist = resolve(process.cwd(), 'test-results', `dist-${nazwa}`);
  const ready = (): boolean => existsSync(resolve(oldDist, 'sw.js')) && existsSync(resolve(oldDist, plikGotowosci));
  if (ready()) return oldDist;
  const src = `${oldSrc}-${process.pid}`;
  const out = `${oldDist}-${process.pid}`;
  rmSync(src, { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  const archive = execFileSync('git', ['archive', ref], { maxBuffer: 256 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', src], { input: archive });
  symlinkSync(resolve(process.cwd(), 'node_modules'), resolve(src, 'node_modules'));
  execFileSync(process.execPath, [resolve(src, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: src,
    env: { ...process.env, BASE_PATH },
    stdio: 'pipe',
  });
  try {
    if (!ready()) renameSync(out, oldDist);
  } catch {
    /* inny worker zdążył pierwszy — jego build jest identyczny */
  }
  rmSync(src, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
  if (!ready()) throw new Error(`Build ${ref} nie zawiera sw.js albo ${plikGotowosci}`);
  return oldDist;
}

/** Aktywny Service Worker i strona pod jego kontrolą (pierwsza instalacja nie przejmuje strony — przeładowania). */
export async function waitControlled(page: Page): Promise<void> {
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated', undefined, { timeout: 60_000 });
  for (let i = 0; i < 8; i++) {
    if (await page.evaluate(() => navigator.serviceWorker.controller !== null)) return;
    await page.reload();
    await page.waitForTimeout(300 * (i + 1));
  }
  throw new Error('Strona nie jest kontrolowana przez Service Workera');
}

/** Ekran „Wybierz profil” → profil `email` jako aktywny. */
export async function chooseProfile(page: Page, email: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Wybierz profil' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: email }).click();
  await expect(page.getByLabel('Aktywny profil')).toContainText(email, { timeout: 60_000 });
}

/** Profil karty: ekran wyboru albo start innego profilu (zapamiętany ostatni) → przełączenie na `email`. */
export async function ensureProfile(page: Page, email: string): Promise<void> {
  const picker = page.getByRole('heading', { level: 1, name: 'Wybierz profil' });
  const active = page.getByLabel('Aktywny profil');
  await expect(picker.or(active)).toBeVisible({ timeout: 90_000 });
  if (await picker.isVisible()) return chooseProfile(page, email);
  if ((await active.textContent())?.includes(email)) return;
  await active.getByRole('button', { name: 'Zmień profil' }).click();
  await chooseProfile(page, email);
}

export interface Dump {
  version: number;
  stores: Record<string, unknown[]>;
}

/** Odczyt CAŁEJ bazy (bez tworzenia: brak bazy → wersja 0). */
export async function dumpDb(page: Page, dbName: string): Promise<Dump> {
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

/** Adresy wszystkich wpisów Cache Storage w scope strony. */
export async function cacheUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) out.push(r.url);
    return out;
  });
}

export interface Problems {
  console: string[];
  http: string[];
  /**
   * `true` — krok z oczekiwanymi błędami konsoli (np. offline: nieudane sprawdzenie `dme-release.json`) — błędy konsoli
   * nie są wtedy zbierane. Nieobsłużone wyjątki strony i odpowiedzi ≥ 400 (offline odpowiada tylko Service Worker)
   * są zbierane zawsze.
   */
  paused: boolean;
  /**
   * Komunikaty WebKit o przerwanym pobieraniu plików pomocniczych (`pageerror`), które nie są wyjątkami kodu — nie oblewają
   * testu, ale specyfikacje dołączają je do wyniku (`attachNetwork`), np. pobranie `pwa-precache.json` przerwane
   * przeładowaniem przy przejęciu karty albo sprawdzenie `sw.js` bez sieci.
   */
  network: string[];
}

/** Pliki pomocnicze, których przerwane pobieranie (przeładowanie karty, brak sieci) aplikacja obsługuje bez skutków. */
const SUPPORT_FILES = ['sw.js', 'pwa-precache.json', 'dme-release.json'];

/**
 * Playwright WebKit zgłasza jako `pageerror` także komunikat silnika o nieudanym pobraniu („Fetch API cannot load <url>
 * due to access control checks.”, „Cannot load <url> due to access control checks.”) — również wtedy, gdy kod
 * aplikacji obsłużył odrzucenie (try/catch). Na osobną listę trafia tylko taki komunikat dla pliku pomocniczego
 * (`SUPPORT_FILES`); przerwane pobranie innego pliku (np. banku) jest błędem testu.
 */
function isWebKitSupportFileFailure(error: Error): boolean {
  // Playwright WebKit dzieli tekst komunikatu na `name` i `message` na pierwszym „:” (np. „Cannot load http” +
  // „//127.0.0.1/sw.js due to …”), więc sprawdzamy cały tekst, a nie samą nazwę.
  const text = `${error.name}: ${error.message}`.trim();
  const match = /(?:Fetch API cannot load|Cannot load) (.+) due to access control checks\.?$/.exec(text);
  if (!match) return false;
  const path = (match[1] ?? '').split(/[?#]/)[0] ?? '';
  return SUPPORT_FILES.some((f) => path.endsWith(`/${f}`));
}

/**
 * Błędy konsoli, nieobsłużone wyjątki strony (`pageerror`) i odpowiedzi ≥ 400 we wszystkich kartach kontekstu (otwartych
 * i otwieranych później). Celowe zapytania testu o dawne pliki (`ignorowanePliki`, odpowiedź 404 — przeglądarka zapisuje
 * ją też w konsoli) są pomijane. Test: tests/e2e/aktualizacja-pomocnicze.spec.ts.
 */
export function collectProblems(context: BrowserContext, ignorowanePliki: readonly string[]): Problems {
  const problems: Problems = { console: [], http: [], paused: false, network: [] };
  const ignored = (url: string): boolean => ignorowanePliki.some((f) => url.includes(f));
  const attach = (p: Page): void => {
    p.on('console', (m: ConsoleMessage) => {
      if (problems.paused) return;
      if (m.type() === 'error' && !ignored(m.location().url)) problems.console.push(`${p.url()}: ${m.text()} [${m.location().url}]`);
    });
    p.on('response', (r) => {
      if (r.status() >= 400 && !ignored(r.url())) problems.http.push(`${r.status()} ${r.url()}`);
    });
    // Nieobsłużony wyjątek kodu strony (np. nowego kodu na zmigrowanych danych) nigdy nie jest oczekiwany — także
    // w krokach z pauzą (offline); trafia do błędów konsoli, więc oblewa asercję „0 błędów”.
    p.on('pageerror', (error: Error) => {
      const text = `${p.url()}: nieobsłużony wyjątek: ${error.name}: ${error.message}`;
      if (isWebKitSupportFileFailure(error)) problems.network.push(text);
      else problems.console.push(text);
    });
  };
  // Karty otwarte przed aktualizacją (przejmowane przez nowy Service Worker) i otwierane później.
  for (const p of context.pages()) attach(p);
  context.on('page', attach);
  return problems;
}

/** Dołącza do wyniku testu komunikaty o przerwanym pobieraniu plików pomocniczych (`Problems.network`), jeśli są. */
export async function attachNetwork(testInfo: TestInfo, problems: Problems): Promise<void> {
  if (problems.network.length > 0) await testInfo.attach('przerwane-pobieranie-plikow-pomocniczych', { body: problems.network.join('\n'), contentType: 'text/plain' });
}
