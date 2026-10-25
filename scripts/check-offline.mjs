#!/usr/bin/env node
/**
 * Kontrola Service Workera na zbudowanym `dist` pod podścieżką (G01, G02, G03 — w przeglądarce na komputerze).
 *
 *   node scripts/check-offline.mjs [--dist dist] [--base /doktor-monika-egzamin/] [--browsers chromium,webkit]
 *
 * Serwer: scripts/serve-dist.mjs (jak GitHub Pages). Przeglądarki: Playwright z lokalnego cache (bez pobierania).
 * Scenariusze dla każdej przeglądarki:
 *  1. pierwsze uruchomienie: rejestracja SW w scope `base`, komplet precache, strona NIE przejęta bez
 *     ponownego otwarcia (brak clientsClaim);
 *  2. offline po pierwszym pobraniu: start aplikacji, bank V15 (wersjonowana ścieżka), fonty, trasa hash,
 *     nawigacja w scope → index.html;
 *  3. aktualizacja: nowa wersja SW czeka (`waiting`), strona nie jest przeładowana; aktywacja dopiero
 *     po komunikacie SKIP_WAITING (to wysyła src/pwa na żądanie użytkowniczki);
 *  4. nieudane pobranie aktualizacji (błąd serwera dla zmienionego pliku): nowa wersja odrzucona,
 *     stara działa dalej (także offline);
 *  5. przerwane pierwsze przygotowanie: brak aktywnego SW, część plików zapisana; ponowienie pobiera
 *     tylko brakujące pliki (z odczytem Cache Storage w trakcie, jak src/pwa; wariant bez odczytu — informacyjnie);
 *  6. S24a w aplikacji: ekran „Nie udało się zapisać wszystkich materiałów” → „Spróbuj ponownie” (albo zamknięcie
 *     i ponowne otwarcie) → komplet precache i gotowość, potem start bez sieci (tylko gdy aplikacja sama rejestruje SW).
 * Jeżeli aplikacja sama nie rejestruje SW (integracja src/pwa w toku), skrypt rejestruje go jak
 * `virtual:pwa-register` (`${base}sw.js`, scope `${base}`) i zgłasza to jako WARN.
 * To NIE zastępuje testu na fizycznym iPhonie (G05).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, webkit } from '@playwright/test';
import { startDistServer } from './serve-dist.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const dist = resolve(arg('--dist', 'dist'));
let base = arg('--base', process.env.BASE_PATH || '/');
if (!base.startsWith('/')) base = `/${base}`;
if (!base.endsWith('/')) base = `${base}/`;
const browserNames = arg('--browsers', 'chromium,webkit').split(',').map((s) => s.trim()).filter(Boolean);
const engines = { chromium, webkit };

const swSource = readFileSync(resolve(dist, 'sw.js'), 'utf8');
const precache = [...swSource.matchAll(/url:\s*"([^"]+)"\s*,\s*revision:\s*(null|"([^"]*)")/g)].map((m) => ({ url: m[1], revision: m[3] ?? null }));
if (precache.length === 0) throw new Error('Brak listy precache w sw.js');
/** Pliki ładowane przez `importScripts` w sw.js (część skryptu SW, pobierane przy każdej instalacji). */
const SW_IMPORTS = [...swSource.matchAll(/importScripts\(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
const APP_TITLE = 'Doktor Monika Egzamin';
/** Bank V15 pod wersjonowaną ścieżką (src/domain/contentRelease.ts). */
const BANK_FILE = readFileSync(resolve('src/domain/contentRelease.ts'), 'utf8').match(/\bbankFile:\s*'([^']+)'/)?.[1];
if (!BANK_FILE) throw new Error('contentRelease.ts: brak bankFile');

const results = [];
function record(browser, level, msg) {
  results.push({ browser, level, msg });
  console.log(`[${browser}] ${level.padEnd(4)} ${msg}`);
}

/* ---------------- pomocnicze (w stronie) ---------------- */

async function registrationState(page) {
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    return {
      scope: reg.scope,
      installing: reg.installing?.state ?? null,
      waiting: reg.waiting?.state ?? null,
      active: reg.active?.state ?? null,
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
    };
  });
}

/** Czeka na rejestrację aplikacji; bez niej rejestruje SW tak jak virtual:pwa-register. */
async function ensureRegistered(page) {
  const byApp = await page.evaluate(async () => {
    for (let i = 0; i < 25; i += 1) {
      if (await navigator.serviceWorker.getRegistration()) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  });
  if (byApp) return 'app';
  await page.evaluate(async (b) => {
    await navigator.serviceWorker.register(`${b}sw.js`, { scope: b }).catch(() => undefined);
  }, base);
  return 'script';
}

/**
 * Czeka, aż instalacja się zakończy: 'active' (sukces) albo 'none' (instalacja odrzucona).
 * `pollCaches` — w trakcie czekania strona odczytuje Cache Storage precache, jak pomiar postępu w src/pwa.
 */
async function waitInstallSettled(page, { pollCaches = false, timeoutMs = 30_000, graceMs = 1500 } = {}) {
  return page.evaluate(
    async ([timeout, poll, grace]) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && !reg.installing && !reg.waiting && reg.active?.state === 'activated') return 'active';
        if (!reg || (!reg.installing && !reg.waiting && !reg.active)) {
          if (Date.now() - start > grace) return 'none';
        }
        if (poll) {
          const name = (await caches.keys()).find((n) => n.startsWith('workbox-precache-v2-'));
          if (name) await (await caches.open(name)).keys();
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      return 'timeout';
    },
    [timeoutMs, pollCaches, graceMs],
  );
}

async function precacheKeys(page) {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const name = names.find((n) => n.startsWith('workbox-precache-v2-'));
    if (!name) return { name: null, urls: [] };
    const cache = await caches.open(name);
    return { name, urls: (await cache.keys()).map((r) => r.url) };
  });
}

function keyMatches(urls, entry) {
  return urls.some((u) => {
    const url = new URL(u);
    return url.pathname === `${base}${entry.url}` && (entry.revision === null || url.searchParams.get('__WB_REVISION__') === entry.revision);
  });
}

async function appLoads(page) {
  const title = await page.title();
  const bank = await page.evaluate(async (b) => {
    try {
      const r = await fetch(`${b.base}${b.bankFile}`);
      if (!r.ok) return { ok: false, status: r.status };
      const json = await r.json();
      const n = Array.isArray(json.questions) ? json.questions.length : Object.keys(json).length;
      return { ok: true, n };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }, { base, bankFile: BANK_FILE });
  const font = await page.evaluate(async () => {
    try {
      await document.fonts.load('700 28px "Hanken Grotesk"', 'Żółć gęś');
      return document.fonts.check('700 28px "Hanken Grotesk"', 'Żółć gęś');
    } catch {
      return false;
    }
  });
  return { title, bank, font };
}

/**
 * Brak sieci: Chromium — emulacja Playwright (`context.setOffline`) i zerwane połączenia serwera;
 * WebKit — tylko zerwane połączenia serwera (emulacja offline Playwright w WebKit przerywa nawigację
 * obsługiwaną przez SW błędem wewnętrznym silnika, co nie odpowiada zachowaniu Safari).
 */
async function setNetwork(name, context, server, online) {
  server.hooks.offline = !online;
  if (name === 'chromium') await context.setOffline(!online);
}

/* ---------------- scenariusze ---------------- */

/**
 * Scenariusz 5: błąd ostatniego pliku precache przy pierwszej instalacji, potem ponowienie.
 * Workbox pomija pliki już zapisane w cache, ale WebKit (Playwright) po nieudanej pierwszej instalacji
 * zwykle NIE zachowuje częściowo zapisanego cache — ponowienie pobiera wtedy wszystko od nowa.
 * To zachowanie silnika (WARN), nie błąd konfiguracji; w Chromium wymagane jest dociągnięcie tylko braków.
 */
async function interruptedFirstInstall(browser, name, server) {
  const pollCaches = true;
  server.hooks.transformSw = null;
  const lastEntry = precache[precache.length - 1];
  server.hooks.fail = (rel) => (rel === lastEntry.url ? 503 : null);
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const page = await ctx.newPage();
    await page.goto(server.url);
    await ensureRegistered(page);
    const first = await waitInstallSettled(page, { pollCaches });
    const partial = await precacheKeys(page);
    const savedBefore = precache.filter((e) => keyMatches(partial.urls, e));
    server.hooks.fail = null;
    const mark = server.requests.length;
    await page.evaluate(async (b) => {
      await navigator.serviceWorker.register(`${b}sw.js`, { scope: b });
    }, base);
    const second = await waitInstallSettled(page, { pollCaches });
    // Skrypty z importScripts (skrypt przejęcia) pobiera sama przeglądarka przy każdej instalacji SW — nie precache.
    const refetched = server.requests.slice(mark).filter((rel) => rel !== lastEntry.url && !SW_IMPORTS.includes(rel) && precache.some((e) => e.url === rel));
    const ok = first === 'none' && second === 'active';
    record(name, ok ? 'PASS' : 'FAIL', `przerwane przygotowanie (błąd ${lastEntry.url}): brak aktywnego SW (${first}); ponowienie kończy instalację (${second})`);
    const resumed = savedBefore.length === precache.length - 1 && refetched.length === 0;
    const detail = `zachowane po przerwaniu ${savedBefore.length}/${precache.length}; przy ponowieniu pobrane ponownie ${refetched.length}`;
    const level = resumed ? 'PASS' : name === 'webkit' ? 'WARN' : 'FAIL';
    record(name, level, `ponowienie ${resumed ? 'dociąga tylko brakujące pliki' : 'pobiera ponownie wcześniej zapisane pliki'} — ${detail}`);
    // Komplet po surowym ponowieniu (sam SW, bez obejścia z src/pwa). WebKit 2359: zapis kluczy z nieudanej
    // instalacji do tego samego cache ginie — aplikacja usuwa pusty cache przed rejestracją (scenariusz 6).
    const final = await precacheKeys(page);
    const complete = precache.filter((e) => keyMatches(final.urls, e)).length;
    const finalLevel = complete === precache.length ? 'PASS' : name === 'webkit' ? 'WARN' : 'FAIL';
    record(name, finalLevel, `surowe ponowienie (bez obejścia aplikacji): w cache ${complete}/${precache.length} plików${complete === precache.length ? '' : ' — błąd silnika; obejście w src/pwa sprawdza scenariusz 6'}`);
  } finally {
    server.hooks.fail = null;
    await ctx.close();
  }
}

/**
 * Scenariusz 6 — S24a w zintegrowanej aplikacji (src/pwa + kontroler + UI), świeży profil:
 * błąd pliku precache przy pierwszym przygotowaniu → ekran „Nie udało się zapisać wszystkich materiałów”
 * z „Spróbuj ponownie” → sieć wraca, stuknięcie → ekran przygotowania znika, SW aktywny → kolejne otwarcie
 * bez sieci pokazuje ekran startowy (start offline przy odrzuconej rejestracji nie jest błędem).
 */
async function appPreparationRetry(browser, name, server, mode) {
  const PREP = 'main[aria-label="Przygotowanie materiałów"]';
  const FAILED_TITLE = 'Nie udało się zapisać wszystkich materiałów';
  const label = mode === 'retry' ? 'S24a w aplikacji („Spróbuj ponownie”)' : 'S24a w aplikacji (ponowne otwarcie)';
  server.hooks.transformSw = null;
  const lastEntry = precache[precache.length - 1];
  server.hooks.fail = (rel) => (rel === lastEntry.url ? 503 : null);
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  // Profil wybrany (DECYZJE §16): ekran przygotowania pokazuje aplikacja profilu, nie ekran wyboru profilu.
  await ctx.addInitScript(() => {
    try {
      sessionStorage.setItem('dme-profil-karty', 'monika@doktormonika.pl');
    } catch {
      /* bez sessionStorage */
    }
  });
  try {
    let page = await ctx.newPage();
    await page.goto(server.url);
    await page.getByText(FAILED_TITLE).waitFor({ timeout: 30_000 });
    const prepText = (await page.locator(PREP).textContent()) ?? '';
    const pct = prepText.match(/przy (\d+)%/)?.[1] ?? '?';
    const retry = page.locator(PREP).getByRole('button', { name: 'Spróbuj ponownie' });
    const hasRetry = (await retry.count()) === 1;
    record(name, hasRetry ? 'PASS' : 'FAIL', `${label}: przerwane przygotowanie (błąd ${lastEntry.url}) → „${FAILED_TITLE}” przy ${pct}% z „Spróbuj ponownie”`);
    if (!hasRetry) return;

    server.hooks.fail = null;
    if (mode === 'retry') {
      await retry.click();
    } else {
      // Zamknięcie i ponowne otwarcie aplikacji (rejestracja przy starcie, bez stuknięcia w przycisk).
      await page.close();
      page = await ctx.newPage();
      await page.goto(server.url);
    }
    // Koniec: komplet precache (sygnał niezależny od getRegistration(), które w WebKit na stronie otwartej po
    // nieudanej rejestracji potrafi zwracać undefined mimo działającej instalacji), brak ekranu przygotowania.
    let complete = 0;
    for (let i = 0; i < 100 && complete < precache.length; i += 1) {
      const { urls } = await precacheKeys(page);
      complete = precache.filter((e) => keyMatches(urls, e)).length;
      if (complete < precache.length) await page.waitForTimeout(300);
    }
    await page.locator(PREP).waitFor({ state: 'detached', timeout: 30_000 });
    const home = await page.getByRole('heading', { level: 1, name: APP_TITLE }).isVisible();
    record(name, complete === precache.length && home ? 'PASS' : 'FAIL', `${label}: ekran przygotowania znika, w cache ${complete}/${precache.length} plików, ekran startowy ${home ? 'widoczny' : 'niewidoczny'}`);

    await page.reload();
    const controlled = await page.evaluate(() => navigator.serviceWorker.controller?.state ?? null);
    record(name, controlled ? 'PASS' : 'FAIL', `${label}: po przeładowaniu strona kontrolowana przez SW (${controlled ?? 'brak'})`);
    // Bez sieci, adres spoza cache HTTP (unikalny parametr) — odpowiedzieć może tylko Service Worker.
    await setNetwork(name, ctx, server, false);
    const fresh = await ctx.newPage();
    await fresh.goto(`${server.url}?kontrola-offline=${Date.now()}`);
    await fresh.getByRole('heading', { level: 1, name: APP_TITLE }).waitFor({ timeout: 15_000 });
    const prepOffline = await fresh.locator(PREP).count();
    record(name, prepOffline === 0 ? 'PASS' : 'FAIL', `${label}: kolejne otwarcie bez sieci — ekran startowy${prepOffline ? ', ale z ekranem przygotowania' : ', bez ekranu przygotowania i błędu'}`);
  } catch (e) {
    record(name, 'FAIL', `${label}: ${String(e).split('\n')[0]}`);
  } finally {
    server.hooks.fail = null;
    await setNetwork(name, ctx, server, true).catch(() => undefined);
    await ctx.close();
  }
}

async function runBrowser(name, server) {
  const engine = engines[name];
  if (!engine) {
    record(name, 'FAIL', 'nieznana przeglądarka');
    return;
  }
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    record(name, 'FAIL', `nie uruchomiono przeglądarki z cache Playwright: ${String(e).split('\n')[0]}`);
    return;
  }
  try {
    /* 1 + 2 + 3 + 4: jedna sesja przeglądarki */
    server.hooks.transformSw = null;
    server.hooks.fail = null;
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    const page = await context.newPage();
    await page.goto(server.url);
    const supported = await page.evaluate(() => 'serviceWorker' in navigator && window.isSecureContext);
    if (!supported) {
      record(name, 'FAIL', 'Service Worker niedostępny w tej przeglądarce/kontekście');
      await context.close();
      return;
    }
    const who = await ensureRegistered(page);
    record(name, who === 'app' ? 'PASS' : 'WARN', who === 'app' ? 'aplikacja rejestruje SW' : 'aplikacja nie zarejestrowała SW — rejestracja wykonana przez skrypt kontrolny (integracja src/pwa w main.tsx w toku)');
    const settled = await waitInstallSettled(page);
    const st = await registrationState(page);
    record(name, settled === 'active' ? 'PASS' : 'FAIL', `pierwsza instalacja: ${settled}; scope ${st?.scope ?? '—'}`);
    record(name, st?.scope === `${new URL(server.url).origin}${base}` ? 'PASS' : 'FAIL', `scope SW = ${base}`);
    record(name, st?.controller === null ? 'PASS' : 'FAIL', `strona nie przejęta przy pierwszej instalacji (bez clientsClaim): controller=${st?.controller ?? 'null'}`);
    const keys = await precacheKeys(page);
    const missing = precache.filter((e) => !keyMatches(keys.urls, e));
    record(name, missing.length === 0 ? 'PASS' : 'FAIL', `precache: ${precache.length - missing.length}/${precache.length} plików w ${keys.name ?? 'brak cache'}${missing.length ? ` — brak: ${missing.map((e) => e.url).join(', ')}` : ''}`);

    await page.reload();
    const st2 = await registrationState(page);
    record(name, st2?.controller ? 'PASS' : 'FAIL', `po ponownym otwarciu strona kontrolowana przez SW (${st2?.controller ?? 'brak'})`);

    // 2. offline
    await setNetwork(name, context, server, false);
    await page.reload();
    const off = await appLoads(page);
    record(name, off.title === APP_TITLE ? 'PASS' : 'FAIL', `offline: start aplikacji (tytuł „${off.title}”)`);
    record(name, off.bank.ok ? 'PASS' : 'FAIL', `offline: ${BANK_FILE} z precache (${off.bank.ok ? `${off.bank.n} pytań` : JSON.stringify(off.bank)})`);
    record(name, off.font ? 'PASS' : 'FAIL', 'offline: lokalny krój Hanken Grotesk (latin + latin-ext) dostępny');
    await page.goto(`${server.url}#/historia`);
    record(name, (await page.title()) === APP_TITLE ? 'PASS' : 'FAIL', 'offline: trasa hash #/historia');
    const deep = await page.goto(`${server.url}nieistniejaca/sciezka`).catch((e) => e);
    record(name, !(deep instanceof Error) && (await page.title()) === APP_TITLE ? 'PASS' : 'FAIL', 'offline: nawigacja w scope bez pliku → index.html (navigateFallback)');
    await setNetwork(name, context, server, true);
    await page.goto(server.url);

    // 3. aktualizacja na żądanie
    server.hooks.transformSw = (text) => `${text}\n// dme-check v2\n`;
    await page.evaluate(() => {
      window.__dmeMarker = 'przed-aktualizacja';
    });
    const before = await registrationState(page);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
    const waited = await page.evaluate(async () => {
      for (let i = 0; i < 100; i += 1) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg?.waiting) return true;
        await new Promise((r) => setTimeout(r, 200));
      }
      return false;
    });
    await page.waitForTimeout(2000);
    const after = await registrationState(page);
    const marker = await page.evaluate(() => window.__dmeMarker);
    record(name, waited && after?.waiting === 'installed' ? 'PASS' : 'FAIL', `aktualizacja: nowa wersja pobrana i czeka (waiting=${after?.waiting ?? 'brak'})`);
    record(name, marker === 'przed-aktualizacja' && after?.controller === before?.controller ? 'PASS' : 'FAIL', 'aktualizacja: brak samoczynnego przeładowania i przejęcia strony');
    const switched = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg?.waiting) return false;
      const changed = new Promise((ok) => navigator.serviceWorker.addEventListener('controllerchange', () => ok(true), { once: true }));
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      return Promise.race([changed, new Promise((ok) => setTimeout(() => ok(false), 10_000))]);
    });
    record(name, switched ? 'PASS' : 'FAIL', 'aktualizacja: aktywacja dopiero po SKIP_WAITING (controllerchange)');
    await page.reload();

    // 4. nieudane pobranie aktualizacji → stara wersja działa
    const bankEntry = precache.find((e) => e.url === BANK_FILE);
    server.hooks.transformSw = (text) => `${text.replace(`"${bankEntry?.revision}"`, '"dme-check-zmiana"')}\n// dme-check v3\n`;
    server.hooks.fail = (rel) => (rel === BANK_FILE ? 503 : null);
    const activeBefore = await registrationState(page);
    const outcome = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return 'brak rejestracji';
      const settled = new Promise((ok) => {
        reg.addEventListener(
          'updatefound',
          () => {
            const worker = reg.installing;
            if (!worker) return ok('brak instalacji');
            worker.addEventListener('statechange', () => {
              if (worker.state === 'redundant' || worker.state === 'installed') ok(worker.state);
            });
          },
          { once: true },
        );
      });
      await reg.update().catch(() => undefined);
      return Promise.race([settled, new Promise((ok) => setTimeout(() => ok('timeout'), 20_000))]);
    });
    server.hooks.fail = null;
    record(name, outcome === 'redundant' ? 'PASS' : 'FAIL', `nieudane pobranie aktualizacji: nowa wersja odrzucona (stan instalacji: ${outcome})`);
    await setNetwork(name, context, server, false);
    await page.reload();
    const offAfter = await appLoads(page);
    const activeAfter = await registrationState(page);
    record(name, offAfter.title === APP_TITLE && offAfter.bank.ok && activeAfter?.controller === activeBefore?.controller ? 'PASS' : 'FAIL', 'po nieudanej aktualizacji stara wersja działa offline (bank, kontroler bez zmian)');
    await setNetwork(name, context, server, true);
    await context.close();

    // 5. przerwane pierwsze przygotowanie i ponowienie (strona odczytuje Cache Storage w trakcie, jak src/pwa).
    await interruptedFirstInstall(browser, name, server);

    // 6. S24a w aplikacji (wymaga rejestracji SW przez aplikację): „Spróbuj ponownie” i ponowne otwarcie.
    if (who === 'app') {
      await appPreparationRetry(browser, name, server, 'retry');
      await appPreparationRetry(browser, name, server, 'reopen');
    } else {
      record(name, 'WARN', 'S24a w aplikacji: pominięto — aplikacja nie rejestruje SW sama');
    }
  } catch (e) {
    record(name, 'FAIL', `błąd scenariusza: ${String(e).split('\n')[0]}`);
  } finally {
    server.hooks.offline = false;
    server.hooks.fail = null;
    server.hooks.transformSw = null;
    await browser.close();
  }
}

const server = await startDistServer({ dist, base });
console.log(`Serwer: ${server.url}\nPrecache: ${precache.length} wpisów\n`);
try {
  for (const name of browserNames) await runBrowser(name, server);
} finally {
  await server.close();
}
const failures = results.filter((r) => r.level === 'FAIL').length;
const warnings = results.filter((r) => r.level === 'WARN').length;
console.log(`\nRazem: ${results.length} kontroli, FAIL ${failures}, WARN ${warnings}. To nie jest test na fizycznym iPhonie (G05: NOT RUN).`);
process.exit(failures > 0 ? 1 : 0);
