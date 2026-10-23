/**
 * Logika Service Workera po stronie okna (DECYZJE §11) — bez importu `virtual:pwa-register`,
 * więc da się ją testować w Node z atrapami (`PwaEnvironment`). Wiązanie z przeglądarką: `registerSW.ts`.
 *
 * Zasady (sprawdzone w źródłach vite-plugin-pwa 2.0.0 i workbox 7.4.1, opis w docs/WDROZENIE.md):
 * - `registerType: 'prompt'`, bez `skipWaiting`/`clientsClaim` w SW: nowa wersja czeka w stanie `waiting`.
 * - Aktywacja nowej wersji (`applyUpdate`) WYŁĄCZNIE na żądanie użytkowniczki i tylko po potwierdzeniu
 *   kontrolera (`confirmUpdateSafe`: brak otwartego ekranu pytania, stan zapisany). Bez potwierdzenia — odmowa.
 * - Błąd rejestracji (brak SW, niebezpieczny kontekst, brak sieci przy starcie offline) nie blokuje nauki:
 *   aplikacja działa dalej, a stan opisuje `PwaStatus`.
 * - Pierwsze przygotowanie offline (S24a): postęp liczony z Cache Storage (precache Workboxa) względem listy
 *   `pwa-precache.json` generowanej przy buildzie; koniec = SW `installed` I komplet plików w cache
 *   (dopiero wtedy sygnał `offlineReady`); przerwanie (SW `redundant` przed `installed`) albo niekompletny
 *   cache po instalacji = stan `failed` z ponowieniem (`checkForUpdate`).
 *   Workbox przy ponownej instalacji pomija pliki już zapisane w cache (`PrecacheStrategy._handle`
 *   najpierw `cacheMatch`), więc w Chromium ponowienie dociąga tylko brakujące pliki.
 * - WebKit (Playwright 2359, zmierzone 22.10.2026): po nieudanej PIERWSZEJ instalacji cache precache zostaje
 *   pusty, a przy ponownej instalacji zapis tych samych kluczy do tego cache ginie (SW aktywny z 1/18 plików —
 *   fałszywa gotowość offline). Dlatego przed rejestracją bez aktywnego workera pusty cache precache tej
 *   aplikacji jest usuwany (`discardEmptyPrecache`), a po instalacji kompletność jest sprawdzana
 *   (`verifyFirstInstall`); niekompletna instalacja jest wyrejestrowywana i czyszczona przed ponowieniem.
 */
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import type { PreparationProgress, PwaPort } from './api';

/** Plik z listą precache (url, rewizja, rozmiar) — generowany w vite.config.ts, poza precache. */
export const PRECACHE_INFO_FILE = 'pwa-precache.json';
export const PRECACHE_INFO_FORMAT = 'dme-precache-info';
/** Flaga w sessionStorage: przeładowanie wywołane aktualizacją (toast „Aplikacja zaktualizowana…”). */
export const UPDATED_FLAG_KEY = 'dme-pwa-updated';
/** Nazwa cache precache Workboxa: `workbox-precache-v2-<scope rejestracji>` (workbox-core cacheNames). */
export const PRECACHE_CACHE_PREFIX = 'workbox-precache-v2-';
/** Parametr rewizji w kluczu cache Workboxa (workbox-precaching createCacheKey). */
export const WORKBOX_REVISION_PARAM = '__WB_REVISION__';

const POLL_INTERVAL_MS = 400;
const UPDATE_TIMEOUT_MS = 15_000;
/** Automatyczne sprawdzanie aktualizacji przy powrocie do aplikacji — nie częściej niż co godzinę. */
const AUTO_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export type PwaRegistrationState = 'unsupported' | 'pending' | 'registered' | 'failed';

export type PwaErrorCode =
  /** Przeglądarka bez Service Workera albo niebezpieczny kontekst (http poza localhost), tryb dev. */
  | 'SW_UNSUPPORTED'
  /** Rejestracja odrzucona (np. SecurityError) albo brak sieci przy pierwszym uruchomieniu. */
  | 'SW_REGISTER_FAILED'
  /** Kontroler nie potwierdził bezpiecznego momentu (ekran pytania / niezapisany stan). */
  | 'UPDATE_NOT_SAFE'
  /** Brak oczekującej wersji. */
  | 'NO_UPDATE_WAITING'
  /** Nowa wersja nie przejęła strony w wyznaczonym czasie — stara działa dalej. */
  | 'UPDATE_TIMEOUT';

const ERROR_MESSAGES_PL: Record<PwaErrorCode, string> = {
  SW_UNSUPPORTED: 'Ta przeglądarka nie obsługuje pracy offline. Nauka działa, gdy jest internet.',
  SW_REGISTER_FAILED: 'Nie udało się włączyć pracy offline. Nauka działa, gdy jest internet.',
  UPDATE_NOT_SAFE: 'Aktualizacja możliwa poza ekranem pytania, po zapisie.',
  NO_UPDATE_WAITING: 'Brak nowej wersji do uruchomienia.',
  UPDATE_TIMEOUT: 'Nie udało się uruchomić nowej wersji. Obecna wersja działa dalej.',
};

export class PwaError extends Error {
  readonly code: PwaErrorCode;
  readonly messagePl: string;
  constructor(code: PwaErrorCode, cause?: unknown) {
    super(ERROR_MESSAGES_PL[code], cause === undefined ? undefined : { cause });
    this.name = 'PwaError';
    this.code = code;
    this.messagePl = ERROR_MESSAGES_PL[code];
  }
}

/**
 * Stan PWA dla kontrolera (`getStatus` + `subscribe`, zgodne z `useSyncExternalStore`).
 * Niemutowalny: każda zmiana publikuje nowy obiekt.
 */
export interface PwaStatus {
  registration: PwaRegistrationState;
  errorCode: PwaErrorCode | null;
  /** Aktywny SW z kompletnym precache (aplikacja otworzy się offline przy następnym uruchomieniu). */
  offlineReady: boolean;
  /** Nowa wersja czeka (SW `waiting`) albo inna karta już ją uruchomiła i ta wymaga przeładowania. */
  needRefresh: boolean;
  /**
   * Pierwsze przygotowanie materiałów offline (S24a/S24a2); `null` = nie dotyczy albo ukończone.
   * `done`/`total` w bajtach; `total = 0` = rozmiar nieznany (postęp nieokreślony).
   */
  preparation: { status: 'running' | 'failed'; done: number; total: number } | null;
  /** Trwa aktywacja nowej wersji (po „Uruchom ponownie”). */
  applying: boolean;
}

/** Port PWA rozszerzony o stan obserwowalny i flagę „zaktualizowano” (addytywnie względem `PwaPort`). */
export interface ServiceWorkerPwa extends PwaPort {
  getStatus(): PwaStatus;
  subscribe(listener: () => void): () => void;
  /**
   * `true` jednorazowo po przeładowaniu wywołanym przez `applyUpdate` (do toastu `app_updated`).
   * Kolejne wywołania zwracają `false`.
   */
  consumeUpdatedFlag(): boolean;
  dispose(): void;
}

export interface ServiceWorkerPwaOptions {
  /**
   * Potwierdzenie kontrolera, że aktualizację można uruchomić TERAZ: brak otwartego ekranu pytania
   * i brak niezapisanych zmian (zob. `isUpdateSafe` w `updateGuard.ts`). Wyjątek = odmowa.
   */
  confirmUpdateSafe: () => boolean;
}

/** Usługi przeglądarki wstrzykiwane do logiki (w testach — atrapy). */
export interface PwaEnvironment {
  /** `registerSW` z `virtual:pwa-register`. */
  registerSW(options: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
  /** `navigator.serviceWorker` albo `null` (brak obsługi, niebezpieczny kontekst, tryb dev). */
  serviceWorker: ServiceWorkerContainer | null;
  caches: CacheStorage | null;
  /** Adres skryptu SW i scope — względem `base` (to samo, co `__SW__`/`__SCOPE__` w vite-plugin-pwa). */
  swUrl: string;
  scope: string;
  /**
   * Pełny adres scope (np. `https://u.github.io/repo/`) — nazwa cache precache tej aplikacji to
   * `workbox-precache-v2-<scopeUrl>`. Bez niego pusty cache nie jest usuwany przed rejestracją
   * (inne aplikacje tego samego originu, np. inne strony projektów na `github.io`, mają własne cache).
   */
  scopeUrl?: string;
  /** Pobranie `pwa-precache.json` (zwraca JSON albo `null`). */
  fetchPrecacheInfo(): Promise<unknown>;
  reload(): void;
  isOnline(): boolean;
  /** `sessionStorage` (może być `null` — wtedy flaga „zaktualizowano” nie przetrwa przeładowania). */
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  onVisible(listener: () => void): () => void;
  onOnline(listener: () => void): () => void;
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/* ========================================================================== */
/* Lista precache i postęp (czyste funkcje)                                   */
/* ========================================================================== */

export interface PrecacheInfoEntry {
  url: string;
  revision: string | null;
  size: number;
}

export interface PrecacheInfo {
  format: typeof PRECACHE_INFO_FORMAT;
  version: 1;
  entries: PrecacheInfoEntry[];
  totalBytes: number;
}

/** Walidacja `pwa-precache.json`; niepoprawny plik → `null` (postęp nieokreślony). */
export function parsePrecacheInfo(value: unknown): PrecacheInfo | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.format !== PRECACHE_INFO_FORMAT || v.version !== 1 || !Array.isArray(v.entries)) return null;
  const entries: PrecacheInfoEntry[] = [];
  for (const raw of v.entries as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return null;
    const e = raw as Record<string, unknown>;
    if (typeof e.url !== 'string' || e.url.length === 0) return null;
    if (!(e.revision === null || typeof e.revision === 'string')) return null;
    if (typeof e.size !== 'number' || !Number.isFinite(e.size) || e.size < 0) return null;
    entries.push({ url: e.url, revision: e.revision, size: e.size });
  }
  const totalBytes = entries.reduce((sum, e) => sum + e.size, 0);
  return { format: PRECACHE_INFO_FORMAT, version: 1, entries, totalBytes };
}

/** Klucz cache Workboxa dla wpisu precache (jak `createCacheKey` w workbox-precaching). */
export function precacheCacheKey(entry: Pick<PrecacheInfoEntry, 'url' | 'revision'>, swScriptUrl: string): string {
  const key = new URL(entry.url, swScriptUrl);
  if (entry.revision) key.searchParams.set(WORKBOX_REVISION_PARAM, entry.revision);
  return key.href;
}

/**
 * Klucz porównania wpisu cache: origin + ścieżka + rewizja Workboxa (bez innych parametrów i ich kolejności),
 * aby różnice w serializacji adresu między silnikami nie dawały fałszywego „brakuje pliku”.
 */
function comparableKey(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}|${u.searchParams.get(WORKBOX_REVISION_PARAM) ?? ''}`;
  } catch {
    return null;
  }
}

/**
 * Postęp w bajtach: suma rozmiarów wpisów z listy, których klucze są już w cache precache.
 * Bez listy → `{ done: 0, total: 0 }` (nieznany).
 */
export function computePrecacheProgress(
  info: PrecacheInfo | null,
  cachedUrls: readonly string[],
  swScriptUrl: string,
): PreparationProgress {
  if (!info) return { done: 0, total: 0 };
  const cached = new Set(cachedUrls.map(comparableKey).filter((k): k is string => k !== null));
  let done = 0;
  for (const entry of info.entries) {
    const key = comparableKey(precacheCacheKey(entry, swScriptUrl));
    if (key !== null && cached.has(key)) done += entry.size;
  }
  return { done, total: info.totalBytes };
}

/* ========================================================================== */
/* Kontroler SW                                                               */
/* ========================================================================== */

type Listener<T> = (value: T) => void;

function safeCall<T>(listener: Listener<T>, value: T): void {
  try {
    listener(value);
  } catch (error) {
    console.error('[DME PWA] Błąd w obsłudze zdarzenia', error);
  }
}

/** Błąd sieci przy pobieraniu skryptu SW (do ponowienia), w odróżnieniu od odmowy przeglądarki. */
function isRetryableRegisterError(error: unknown): boolean {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  return !['SecurityError', 'NotSupportedError', 'InvalidStateError', 'NotAllowedError'].includes(name);
}

export function createServiceWorkerPwaWith(env: PwaEnvironment, options: ServiceWorkerPwaOptions): ServiceWorkerPwa {
  const sw = env.serviceWorker;
  let status: PwaStatus = {
    registration: sw ? 'pending' : 'unsupported',
    errorCode: sw ? null : 'SW_UNSUPPORTED',
    offlineReady: false,
    needRefresh: false,
    preparation: null,
    applying: false,
  };

  const statusListeners = new Set<() => void>();
  const needRefreshListeners = new Set<() => void>();
  const offlineReadyListeners = new Set<() => void>();
  const progressListeners = new Set<Listener<PreparationProgress>>();
  const errorListeners = new Set<Listener<PreparationProgress>>();
  const cleanups: Array<() => void> = [];
  const trackedWorkers = new WeakSet<ServiceWorker>();
  /** Workery niekompletnej instalacji usuniętej przez `discardIncompleteInstall` — ich zdarzenia są ignorowane. */
  const discardedWorkers = new WeakSet<ServiceWorker>();
  /** Trwa sprawdzanie kompletu precache po pierwszej instalacji. */
  let verifying = false;

  const hadControllerAtStart = Boolean(sw?.controller);
  let registration: ServiceWorkerRegistration | null = null;
  let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null = null;
  let disposed = false;
  let offlineReadyEmitted = false;
  /** Inna karta aktywowała nową wersję: wystarczy przeładować tę stronę (nie ma już `waiting`). */
  let reloadOnly = false;
  let reloading = false;
  let pollHandle: unknown = null;
  let precacheInfo: PrecacheInfo | null = null;
  let lastUpdateCheck = env.now();
  let applyTimeout: unknown = null;
  let settleApply: { resolve: () => void; reject: (error: unknown) => void } | null = null;

  /* ---------- publikacja ---------- */

  function setStatus(patch: Partial<PwaStatus>): void {
    status = { ...status, ...patch };
    for (const l of [...statusListeners]) safeCall<void>(l, undefined);
  }

  function progressOf(p: PwaStatus['preparation']): PreparationProgress {
    return { done: p?.done ?? 0, total: p?.total ?? 0 };
  }

  function emitProgress(): void {
    const p = progressOf(status.preparation);
    for (const l of [...progressListeners]) safeCall(l, p);
  }

  function markNeedRefresh(): void {
    if (status.needRefresh) return;
    setStatus({ needRefresh: true });
    for (const l of [...needRefreshListeners]) safeCall<void>(l, undefined);
  }

  /* ---------- przygotowanie offline (S24a) ---------- */

  function stopPolling(): void {
    if (pollHandle !== null) env.clearTimeout(pollHandle);
    pollHandle = null;
  }

  function schedulePoll(ms: number): void {
    stopPolling();
    pollHandle = env.setTimeout(() => {
      pollHandle = null;
      void poll();
    }, ms);
  }

  async function loadPrecacheInfo(): Promise<PrecacheInfo | null> {
    if (precacheInfo) return precacheInfo;
    try {
      precacheInfo = parsePrecacheInfo(await env.fetchPrecacheInfo());
    } catch {
      precacheInfo = null;
    }
    return precacheInfo;
  }

  async function measure(): Promise<PreparationProgress | null> {
    const reg = registration;
    if (!env.caches || !reg) return null;
    const info = await loadPrecacheInfo();
    const cacheName = PRECACHE_CACHE_PREFIX + reg.scope;
    let urls: string[] = [];
    if (await env.caches.has(cacheName)) {
      const cache = await env.caches.open(cacheName);
      urls = (await cache.keys()).map((request) => request.url);
    }
    const scriptUrl = reg.installing?.scriptURL ?? reg.waiting?.scriptURL ?? reg.active?.scriptURL ?? reg.scope;
    return computePrecacheProgress(info, urls, scriptUrl);
  }

  async function poll(): Promise<void> {
    if (disposed || status.preparation?.status !== 'running') return;
    try {
      const p = await measure();
      const current = status.preparation;
      if (p && current?.status === 'running' && (p.done !== current.done || p.total !== current.total)) {
        setStatus({ preparation: { status: 'running', done: p.done, total: p.total } });
        emitProgress();
      }
    } catch {
      // Pomiar jest pomocniczy — brak dostępu do Cache Storage nie zmienia stanu instalacji.
    }
    if (!disposed && status.preparation?.status === 'running') schedulePoll(POLL_INTERVAL_MS);
  }

  function startPreparation(): void {
    if (disposed || status.offlineReady || status.preparation?.status === 'running') return;
    const previous = status.preparation;
    setStatus({ preparation: { status: 'running', done: previous?.done ?? 0, total: previous?.total ?? 0 } });
    emitProgress();
    schedulePoll(0);
  }

  async function failPreparation(): Promise<void> {
    if (disposed || status.offlineReady) return;
    stopPolling();
    let p: PreparationProgress | null = null;
    try {
      p = await measure();
    } catch {
      p = null;
    }
    if (disposed || status.offlineReady) return;
    const done = p?.done ?? status.preparation?.done ?? 0;
    const total = p?.total ?? status.preparation?.total ?? 0;
    setStatus({ preparation: { status: 'failed', done, total } });
    const progress = { done, total };
    for (const l of [...errorListeners]) safeCall(l, progress);
  }

  /** Koniec przygotowania: gotowość offline (sygnał `offlineReady` najwyżej raz). */
  function finishPreparation(): void {
    if (disposed) return;
    stopPolling();
    const wasPreparing = status.preparation !== null;
    setStatus({ offlineReady: true, preparation: null });
    if (!offlineReadyEmitted && (wasPreparing || !hadControllerAtStart)) {
      offlineReadyEmitted = true;
      for (const l of [...offlineReadyListeners]) safeCall<void>(l, undefined);
    }
  }

  /**
   * Instalacja zakończona (`installed` albo `onOfflineReady` z vite-plugin-pwa). Przy pierwszej instalacji
   * (strona niekontrolowana) gotowość offline jest zgłaszana dopiero po sprawdzeniu kompletu plików w cache —
   * bez fikcyjnego „działa offline”. Gdy kompletu nie da się sprawdzić (brak listy/Cache Storage) — jak dotąd.
   */
  function completePreparation(): void {
    if (disposed || status.offlineReady || verifying) return;
    if (hadControllerAtStart || sw?.controller) {
      finishPreparation();
      return;
    }
    verifying = true;
    stopPolling();
    void verifyFirstInstall()
      .catch(() => 'unknown' as const)
      .then(async (result) => {
        verifying = false;
        if (disposed || status.offlineReady) return;
        if (result === 'incomplete') await discardIncompleteInstall();
        else finishPreparation();
      });
  }

  /** Komplet plików z `pwa-precache.json` w cache precache rejestracji. */
  async function verifyFirstInstall(): Promise<'complete' | 'incomplete' | 'unknown'> {
    const p = await measure();
    if (!p || p.total === 0) return 'unknown';
    return p.done >= p.total ? 'complete' : 'incomplete';
  }

  /**
   * Instalacja zakończona, ale w cache brakuje plików (zob. WebKit w nagłówku): bez gotowości offline.
   * Strona nie jest kontrolowana (pierwsza instalacja bez clientsClaim), więc rejestrację można usunąć;
   * cache precache jest czyszczony, a ponowienie (`checkForUpdate`) instaluje od nowa do świeżego cache.
   */
  async function discardIncompleteInstall(): Promise<void> {
    const reg = registration;
    console.warn('[DME PWA] Niekompletny zapis materiałów offline po instalacji — potrzebne ponowienie');
    if (reg) {
      for (const w of [reg.installing, reg.waiting, reg.active]) if (w) discardedWorkers.add(w);
      try {
        await reg.unregister();
      } catch {
        // Rejestracja zostanie zastąpiona przy ponowieniu.
      }
      try {
        await env.caches?.delete(PRECACHE_CACHE_PREFIX + reg.scope);
      } catch {
        // Brak dostępu do Cache Storage — ponowienie i tak sprawdzi komplet.
      }
    }
    // Lista mogła pochodzić z innej wersji (wdrożenie w trakcie) — przy ponowieniu pobierana od nowa.
    precacheInfo = null;
    if (disposed || status.offlineReady) return;
    if (!status.preparation) setStatus({ preparation: { status: 'running', done: 0, total: 0 } });
    await failPreparation();
  }

  /**
   * Przed rejestracją bez działającej instalacji (pierwsze uruchomienie, ponowienie, ponowne otwarcie po
   * przerwaniu): usuwa PUSTY cache precache tej aplikacji — obejście WebKit (zapis kluczy z nieudanej
   * instalacji do tego samego cache ginie). Niepusty cache zostaje (Chromium dociąga wtedy tylko braki).
   */
  async function discardEmptyPrecache(): Promise<void> {
    if (!sw || !env.caches || !env.scopeUrl) return;
    try {
      const existing = await sw.getRegistration(env.scope);
      if (existing && (existing.active || existing.installing || existing.waiting)) return;
      const name = PRECACHE_CACHE_PREFIX + env.scopeUrl;
      if (!(await env.caches.has(name))) return;
      const keys = await (await env.caches.open(name)).keys();
      if (keys.length === 0) await env.caches.delete(name);
    } catch {
      // Pomocnicze — błąd Cache Storage nie blokuje rejestracji.
    }
  }

  /* ---------- rejestracja i śledzenie workerów ---------- */

  function track(worker: ServiceWorker | null): void {
    if (!worker || trackedWorkers.has(worker)) return;
    trackedWorkers.add(worker);
    // Brak aktywnego workera = pierwsza instalacja (albo jej ponowienie) — przygotowanie materiałów.
    const firstInstall = !registration?.active && !status.offlineReady;
    if (firstInstall) startPreparation();

    const onStateChange = (): void => {
      if (discardedWorkers.has(worker)) {
        worker.removeEventListener('statechange', onStateChange);
        return;
      }
      const state = worker.state;
      if (state === 'installed' || state === 'activating' || state === 'activated') {
        if (firstInstall) completePreparation();
        else if (registration?.waiting === worker) markNeedRefresh();
      } else if (state === 'redundant') {
        worker.removeEventListener('statechange', onStateChange);
        if (!firstInstall) return; // Nieudane pobranie aktualizacji: stara wersja działa dalej.
        const next = registration?.installing;
        if (next && next !== worker) return; // Zastąpiony nowszą instalacją — śledzimy ją osobno.
        void failPreparation();
      }
    };
    worker.addEventListener('statechange', onStateChange);
    onStateChange();
  }

  function attach(reg: ServiceWorkerRegistration): void {
    if (disposed) return;
    if (registration !== reg) {
      registration = reg;
      const onUpdateFound = (): void => track(reg.installing);
      reg.addEventListener('updatefound', onUpdateFound);
      cleanups.push(() => reg.removeEventListener('updatefound', onUpdateFound));
    }
    setStatus({ registration: 'registered', errorCode: null });
    lastUpdateCheck = env.now();

    if (reg.active) {
      if (status.preparation) completePreparation();
      else if (!status.offlineReady) setStatus({ offlineReady: true });
      if (reg.waiting) {
        track(reg.waiting);
        markNeedRefresh();
      }
      track(reg.installing);
    } else if (reg.installing || reg.waiting) {
      track(reg.installing);
      track(reg.waiting);
    } else {
      // Rejestracja bez workera: instalacja już się nie powiodła.
      if (!hadControllerAtStart) {
        startPreparation();
        void failPreparation();
      }
    }
  }

  async function registrationFailed(error: unknown): Promise<void> {
    if (disposed || !sw) return;
    // Start offline: register() odrzuca (nie da się pobrać sw.js), ale istniejąca rejestracja działa.
    let existing: ServiceWorkerRegistration | undefined;
    try {
      existing = await sw.getRegistration(env.scope);
    } catch {
      existing = undefined;
    }
    if (existing && (existing.active || existing.installing || existing.waiting)) {
      attach(existing);
      return;
    }
    console.warn('[DME PWA] Rejestracja Service Workera nie powiodła się', error);
    setStatus({ registration: 'failed', errorCode: 'SW_REGISTER_FAILED' });
    if (status.preparation?.status === 'running') {
      // Ponowienie w toku nie może zostać w stanie „running” bez instalacji.
      await failPreparation();
    } else if (!hadControllerAtStart && isRetryableRegisterError(error)) {
      startPreparation();
      await failPreparation();
    }
  }

  async function retryRegistration(): Promise<void> {
    if (!sw) return;
    if (!status.offlineReady) startPreparation();
    await discardEmptyPrecache();
    try {
      const reg = await sw.register(env.swUrl, { scope: env.scope });
      attach(reg);
    } catch (error) {
      await registrationFailed(error);
    }
  }

  /* ---------- aktualizacja ---------- */

  function reloadNow(): void {
    if (reloading) return;
    reloading = true;
    if (applyTimeout !== null) env.clearTimeout(applyTimeout);
    applyTimeout = null;
    settleApply?.resolve();
    settleApply = null;
    env.reload();
  }

  function onControllerChange(): void {
    if (disposed) return;
    if (status.applying) {
      reloadNow();
      return;
    }
    // Inna karta uruchomiła nową wersję — nie przeładowujemy samoczynnie (może być otwarte pytanie).
    if (hadControllerAtStart) {
      reloadOnly = true;
      markNeedRefresh();
    }
  }

  function setUpdatedFlag(on: boolean): void {
    try {
      if (on) env.storage?.setItem(UPDATED_FLAG_KEY, '1');
      else env.storage?.removeItem(UPDATED_FLAG_KEY);
    } catch {
      // sessionStorage niedostępny — toast „zaktualizowano” się nie pokaże, aktualizacja działa.
    }
  }

  async function applyUpdate(): Promise<void> {
    if (status.applying) return;
    if (!status.needRefresh) throw new PwaError('NO_UPDATE_WAITING');
    let safe = false;
    try {
      safe = options.confirmUpdateSafe() === true;
    } catch {
      safe = false;
    }
    if (!safe) throw new PwaError('UPDATE_NOT_SAFE');

    setStatus({ applying: true });
    setUpdatedFlag(true);

    const done = new Promise<void>((resolve, reject) => {
      settleApply = { resolve, reject };
    });

    const waiting = registration?.waiting ?? null;
    if (!waiting && reloadOnly) {
      reloadNow();
      return done;
    }
    if (waiting) {
      // Strona niekontrolowana (np. pierwsza instalacja w tej sesji) nie dostanie `controllerchange`.
      const onActivated = (): void => {
        if (waiting.state === 'activated') {
          waiting.removeEventListener('statechange', onActivated);
          reloadNow();
        }
      };
      waiting.addEventListener('statechange', onActivated);
    }

    applyTimeout = env.setTimeout(() => {
      applyTimeout = null;
      if (reloading) return;
      setStatus({ applying: false });
      setUpdatedFlag(false);
      settleApply?.reject(new PwaError('UPDATE_TIMEOUT'));
      settleApply = null;
    }, UPDATE_TIMEOUT_MS);

    try {
      // Wysyła SKIP_WAITING do oczekującego SW (workbox-window `messageSkipWaiting`).
      await updateServiceWorker?.(true);
    } catch (error) {
      console.warn('[DME PWA] updateServiceWorker', error);
    }
    // Ten sam komunikat bezpośrednio do workera tej rejestracji (np. po ponowionej rejestracji) — idempotentny.
    waiting?.postMessage({ type: 'SKIP_WAITING' });
    return done;
  }

  async function checkForUpdate(): Promise<void> {
    if (!sw || disposed) return;
    // Przerwane przygotowanie albo nieudana rejestracja → ponowna rejestracja (Workbox pomija pliki obecne w cache).
    if (status.preparation?.status === 'failed' || status.registration === 'failed') {
      await retryRegistration();
      return;
    }
    if (!registration) return;
    lastUpdateCheck = env.now();
    try {
      await registration.update();
    } catch {
      // Brak sieci albo serwera — obecna wersja działa dalej.
    }
  }

  function maybeAutoCheck(): void {
    if (disposed || !registration || status.applying || !env.isOnline()) return;
    if (env.now() - lastUpdateCheck < AUTO_CHECK_INTERVAL_MS) return;
    lastUpdateCheck = env.now();
    registration.update().catch(() => undefined);
  }

  /* ---------- start ---------- */

  if (sw) {
    const onCc = (): void => onControllerChange();
    sw.addEventListener('controllerchange', onCc);
    cleanups.push(() => sw.removeEventListener('controllerchange', onCc));
    cleanups.push(env.onVisible(maybeAutoCheck), env.onOnline(maybeAutoCheck));
    const startRegistration = (): void => {
      if (disposed) return;
      try {
        updateServiceWorker = env.registerSW({
          // Workbox-window czeka na `load` (także gdy już nastąpił — rejestruje od razu).
          immediate: false,
          onNeedRefresh: markNeedRefresh,
          onOfflineReady: completePreparation,
          // Wywoływane po przejęciu strony przez nową wersję (zamiast domyślnego location.reload()).
          onNeedReload: onControllerChange,
          onRegisteredSW: (_swUrl, reg) => {
            if (reg) attach(reg);
            else void registrationFailed(new Error('Brak obiektu rejestracji'));
          },
          onRegisterError: (error: unknown) => {
            void registrationFailed(error);
          },
        });
      } catch (error) {
        void registrationFailed(error);
      }
    };
    // Strona kontrolowana = działająca instalacja (zwykły start). Inaczej najpierw sprzątanie pustego cache (WebKit).
    if (hadControllerAtStart) startRegistration();
    else void discardEmptyPrecache().then(startRegistration);
  }

  /* ---------- port ---------- */

  function sticky(listeners: Set<() => void>, active: () => boolean) {
    return (listener: () => void): (() => void) => {
      listeners.add(listener);
      if (active()) queueMicrotask(() => listeners.has(listener) && active() && safeCall<void>(listener, undefined));
      return () => listeners.delete(listener);
    };
  }

  return {
    onNeedRefresh: sticky(needRefreshListeners, () => status.needRefresh),
    onOfflineReady: sticky(offlineReadyListeners, () => offlineReadyEmitted),
    onPreparationProgress(listener) {
      progressListeners.add(listener);
      if (status.preparation?.status === 'running') {
        queueMicrotask(() => {
          if (progressListeners.has(listener) && status.preparation?.status === 'running') safeCall(listener, progressOf(status.preparation));
        });
      }
      return () => progressListeners.delete(listener);
    },
    onPreparationError(listener) {
      errorListeners.add(listener);
      if (status.preparation?.status === 'failed') {
        queueMicrotask(() => {
          if (errorListeners.has(listener) && status.preparation?.status === 'failed') safeCall(listener, progressOf(status.preparation));
        });
      }
      return () => errorListeners.delete(listener);
    },
    applyUpdate,
    checkForUpdate,
    getStatus: () => status,
    subscribe(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    consumeUpdatedFlag() {
      try {
        const on = env.storage?.getItem(UPDATED_FLAG_KEY) === '1';
        if (on) env.storage?.removeItem(UPDATED_FLAG_KEY);
        return on;
      } catch {
        return false;
      }
    },
    dispose() {
      disposed = true;
      stopPolling();
      if (applyTimeout !== null) env.clearTimeout(applyTimeout);
      for (const c of cleanups.splice(0)) c();
      statusListeners.clear();
      needRefreshListeners.clear();
      offlineReadyListeners.clear();
      progressListeners.clear();
      errorListeners.clear();
    },
  };
}
