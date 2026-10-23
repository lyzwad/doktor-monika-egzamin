/**
 * Testy logiki PWA po stronie okna (src/pwa/swController.ts, src/pwa/updateGuard.ts) na atrapach
 * Service Workera — bez przeglądarki. Zachowanie prawdziwego SW (precache, offline, aktualizacja pod
 * podścieżką) sprawdza scripts/check-offline.mjs w Chromium i WebKit.
 *
 * Uruchomienie: npx vitest run tests/pwa (projekt `pwa` w vitest.config.ts; także w `npm test`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import {
  computePrecacheProgress,
  createServiceWorkerPwaWith,
  parsePrecacheInfo,
  precacheCacheKey,
  PRECACHE_CACHE_PREFIX,
  PwaError,
  UPDATED_FLAG_KEY,
  type PwaEnvironment,
  type ServiceWorkerPwa,
} from '../../src/pwa/swController';
import { isUpdateSafe, type UpdateSafetyState } from '../../src/pwa/updateGuard';

const ORIGIN = 'https://dm.example';
const BASE = '/doktor-monika-egzamin/';
const SCOPE = `${ORIGIN}${BASE}`;
const SW_URL = `${SCOPE}sw.js`;

/* ---------------- atrapy ---------------- */

class FakeWorker extends EventTarget {
  state: ServiceWorkerState;
  readonly scriptURL = SW_URL;
  readonly messages: unknown[] = [];
  constructor(state: ServiceWorkerState = 'installing') {
    super();
    this.state = state;
  }
  postMessage(message: unknown): void {
    this.messages.push(message);
  }
  setState(state: ServiceWorkerState): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  readonly scope = SCOPE;
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  active: FakeWorker | null = null;
  update = vi.fn(async () => undefined);
  unregister = vi.fn(async () => true);
  startInstall(worker = new FakeWorker()): FakeWorker {
    this.installing = worker;
    this.dispatchEvent(new Event('updatefound'));
    return worker;
  }
  /** Przejście installing → installed → (bez aktywnego) activated / (z aktywnym) waiting. */
  finishInstall(): void {
    const w = this.installing;
    if (!w) throw new Error('brak instalacji');
    this.installing = null;
    if (this.active) {
      this.waiting = w;
      w.setState('installed');
    } else {
      w.setState('installed');
      this.active = w;
      w.setState('activating');
      w.setState('activated');
    }
  }
  failInstall(): void {
    const w = this.installing;
    if (!w) throw new Error('brak instalacji');
    this.installing = null;
    w.setState('redundant');
  }
}

class FakeContainer extends EventTarget {
  controller: FakeWorker | null = null;
  register = vi.fn(async (_url: string, _opts?: RegistrationOptions): Promise<FakeRegistration> => new FakeRegistration());
  getRegistration = vi.fn(async (_scope?: string): Promise<FakeRegistration | undefined> => undefined);
}

const PRECACHE_NAME = PRECACHE_CACHE_PREFIX + SCOPE;

class FakeCaches {
  readonly store = new Map<string, string[]>();
  readonly deleted: string[] = [];
  async has(name: string): Promise<boolean> {
    return this.store.has(name);
  }
  async open(name: string): Promise<{ keys(): Promise<Array<{ url: string }>> }> {
    if (!this.store.has(name)) this.store.set(name, []);
    return { keys: async () => (this.store.get(name) ?? []).map((url) => ({ url })) };
  }
  async delete(name: string): Promise<boolean> {
    this.deleted.push(name);
    return this.store.delete(name);
  }
  put(url: string): void {
    this.store.set(PRECACHE_NAME, [...(this.store.get(PRECACHE_NAME) ?? []), url]);
  }
  /** Komplet wpisów z INFO (jak po udanej instalacji Workboxa). */
  putAll(): void {
    for (const e of INFO.entries) {
      const key = e.revision ? `${SCOPE}${e.url}?__WB_REVISION__=${e.revision}` : `${SCOPE}${e.url}`;
      if (!(this.store.get(PRECACHE_NAME) ?? []).includes(key)) this.put(key);
    }
  }
}

const INFO = {
  format: 'dme-precache-info',
  version: 1,
  entries: [
    { url: 'index.html', revision: 'r1', size: 1000 },
    { url: 'data/bank.json', revision: 'r2', size: 8000 },
    { url: 'assets/index-abc.js', revision: null, size: 1000 },
  ],
};

interface Harness {
  pwa: ServiceWorkerPwa;
  container: FakeContainer;
  caches: FakeCaches;
  options: () => RegisterSWOptions;
  updateSW: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  storage: Map<string, string>;
  confirm: { value: boolean };
  visible: () => void;
  now: { value: number };
}

interface SetupOptions {
  controller?: boolean;
  supported?: boolean;
  /** Zawartość `pwa-precache.json` (null = brak listy). */
  info?: unknown;
  /** Stan Cache Storage przed startem (nazwa → klucze). */
  cached?: Record<string, string[]>;
  /** Rejestracja zwracana przez getRegistration() przed startem. */
  existing?: FakeRegistration;
}

function setup({ controller = false, supported = true, info = INFO, cached = {}, existing }: SetupOptions = {}): Harness {
  const container = new FakeContainer();
  if (controller) container.controller = new FakeWorker('activated');
  if (existing) container.getRegistration.mockResolvedValue(existing);
  const caches = new FakeCaches();
  for (const [name, keys] of Object.entries(cached)) caches.store.set(name, [...keys]);
  const storage = new Map<string, string>();
  const updateSW = vi.fn(async () => undefined);
  const reload = vi.fn();
  const confirm = { value: true };
  const now = { value: 1_000_000 };
  let captured: RegisterSWOptions | null = null;
  let visibleListener: (() => void) | null = null;
  const env: PwaEnvironment = {
    registerSW: (opts) => {
      captured = opts;
      return updateSW;
    },
    serviceWorker: supported ? (container as unknown as ServiceWorkerContainer) : null,
    caches: caches as unknown as CacheStorage,
    swUrl: `${BASE}sw.js`,
    scope: BASE,
    scopeUrl: SCOPE,
    fetchPrecacheInfo: async () => info,
    reload,
    isOnline: () => true,
    storage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => void storage.set(k, v),
      removeItem: (k) => void storage.delete(k),
    },
    onVisible: (l) => {
      visibleListener = l;
      return () => {
        visibleListener = null;
      };
    },
    onOnline: () => () => undefined,
    now: () => now.value,
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const pwa = createServiceWorkerPwaWith(env, { confirmUpdateSafe: () => confirm.value });
  return {
    pwa,
    container,
    caches,
    options: () => {
      if (!captured) throw new Error('registerSW nie wywołane');
      return captured;
    },
    updateSW,
    reload,
    storage,
    confirm,
    visible: () => visibleListener?.(),
    now,
  };
}

/** Opróżnia kolejkę mikrozadań i obietnic (bez przesuwania zegara). */
async function flush(): Promise<void> {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

/**
 * Start z rejestracją: przy stronie niekontrolowanej registerSW jest wywoływane dopiero po sprawdzeniu
 * (i ewentualnym usunięciu) pustego cache precache — asynchronicznie.
 */
async function setupStarted(options: SetupOptions = {}): Promise<Harness> {
  const h = setup(options);
  await flush();
  return h;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
});

/* ---------------- czyste funkcje ---------------- */

describe('lista precache i postęp', () => {
  it('klucz cache jak w Workbox (parametr __WB_REVISION__ tylko dla wpisów z rewizją)', () => {
    expect(precacheCacheKey({ url: 'index.html', revision: 'abc' }, SW_URL)).toBe(`${SCOPE}index.html?__WB_REVISION__=abc`);
    expect(precacheCacheKey({ url: 'assets/a.js', revision: null }, SW_URL)).toBe(`${SCOPE}assets/a.js`);
  });

  it('postęp w bajtach z wpisów obecnych w cache; bez listy — nieznany', () => {
    const info = parsePrecacheInfo(INFO);
    expect(info?.totalBytes).toBe(10_000);
    const cached = [`${SCOPE}index.html?__WB_REVISION__=r1`, `${SCOPE}assets/index-abc.js`, `${SCOPE}data/bank.json?__WB_REVISION__=stara`];
    expect(computePrecacheProgress(info, cached, SW_URL)).toEqual({ done: 2000, total: 10_000 });
    expect(computePrecacheProgress(null, cached, SW_URL)).toEqual({ done: 0, total: 0 });
  });

  it('porównanie kluczy odporne na kolejność parametrów; inna rewizja albo ścieżka to brak', () => {
    const info = parsePrecacheInfo(INFO);
    const cached = [`${SCOPE}index.html?a=1&__WB_REVISION__=r1`, `${SCOPE}data/bank.json`, `${ORIGIN}/assets/index-abc.js`, 'nie-url'];
    expect(computePrecacheProgress(info, cached, SW_URL)).toEqual({ done: 1000, total: 10_000 });
  });

  it('odrzuca niepoprawny plik listy', () => {
    expect(parsePrecacheInfo(null)).toBeNull();
    expect(parsePrecacheInfo({ ...INFO, format: 'inny' })).toBeNull();
    expect(parsePrecacheInfo({ ...INFO, entries: [{ url: 'a', revision: 1, size: 1 }] })).toBeNull();
    expect(parsePrecacheInfo({ ...INFO, entries: [{ url: 'a', revision: null, size: -1 }] })).toBeNull();
  });
});

describe('isUpdateSafe', () => {
  const ok: UpdateSafetyState = {
    boot: { phase: 'ready' },
    route: { name: 'home' },
    screen: null,
    save: { status: 'idle' },
  };
  it('pozwala poza ekranem pytania, gdy stan zapisany', () => {
    expect(isUpdateSafe(ok)).toBe(true);
    expect(isUpdateSafe({ ...ok, route: { name: 'history', tab: 'tests' } })).toBe(true);
  });
  it('odmawia na ekranie pytania, w trakcie/po błędzie zapisu i przy uruchamianiu', () => {
    expect(isUpdateSafe({ ...ok, route: { name: 'question', sessionId: 's1' as never } })).toBe(false);
    expect(isUpdateSafe({ ...ok, save: { status: 'saving', commandId: 'c', action: 'answer' } })).toBe(false);
    expect(isUpdateSafe({ ...ok, save: { status: 'error', commandId: 'c', action: 'answer', code: 'WriteFailed', messagePl: 'x', failures: 1 } as never })).toBe(false);
    expect(isUpdateSafe({ ...ok, boot: { phase: 'loading', stage: 'loading-bank' } })).toBe(false);
  });
});

/* ---------------- kontroler SW ---------------- */

describe('brak Service Workera', () => {
  it('nie blokuje: stan unsupported, brak rejestracji i przygotowania', async () => {
    const h = setup({ supported: false });
    expect(h.pwa.getStatus()).toMatchObject({ registration: 'unsupported', errorCode: 'SW_UNSUPPORTED', preparation: null, needRefresh: false });
    await expect(h.pwa.checkForUpdate()).resolves.toBeUndefined();
    await expect(h.pwa.applyUpdate()).rejects.toMatchObject({ code: 'NO_UPDATE_WAITING' });
  });
});

describe('pierwsze przygotowanie offline (S24a)', () => {
  it('postęp z Cache Storage, potem offlineReady (raz) — dopiero przy komplecie plików', async () => {
    const h = await setupStarted();
    const progress: Array<{ done: number; total: number }> = [];
    const ready = vi.fn();
    h.pwa.onPreparationProgress((p) => progress.push(p));
    h.pwa.onOfflineReady(ready);
    const reg = new FakeRegistration();
    reg.startInstall();
    h.options().onRegisteredSW?.(SW_URL, reg as unknown as ServiceWorkerRegistration);
    expect(h.pwa.getStatus().preparation).toMatchObject({ status: 'running' });
    await vi.advanceTimersByTimeAsync(0);
    expect(progress.at(-1)).toEqual({ done: 0, total: 10_000 });

    h.caches.put(`${SCOPE}index.html?__WB_REVISION__=r1`);
    h.caches.put(`${SCOPE}data/bank.json?__WB_REVISION__=r2`);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.pwa.getStatus().preparation).toEqual({ status: 'running', done: 9000, total: 10_000 });

    h.caches.putAll();
    reg.finishInstall();
    h.options().onOfflineReady?.(); // vite-plugin-pwa zgłasza to samo — bez dubla
    await flush();
    expect(h.pwa.getStatus()).toMatchObject({ preparation: null, offlineReady: true });
    expect(ready).toHaveBeenCalledTimes(1);
    expect(reg.unregister).not.toHaveBeenCalled();
  });

  it('przerwanie → failed z postępem i ponowienie przez checkForUpdate', async () => {
    const h = await setupStarted();
    const errors: Array<{ done: number; total: number }> = [];
    h.pwa.onPreparationError((p) => errors.push(p));
    const reg = new FakeRegistration();
    reg.startInstall();
    h.options().onRegisteredSW?.(SW_URL, reg as unknown as ServiceWorkerRegistration);
    h.caches.put(`${SCOPE}index.html?__WB_REVISION__=r1`);
    reg.failInstall();
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(h.pwa.getStatus().preparation).toEqual({ status: 'failed', done: 1000, total: 10_000 });
    expect(errors).toEqual([{ done: 1000, total: 10_000 }]);

    // Spóźniony subskrybent dostaje bieżący błąd (np. ekran S24a2 po przeładowaniu widoku).
    const late = vi.fn();
    h.pwa.onPreparationError(late);
    await flush();
    expect(late).toHaveBeenCalledWith({ done: 1000, total: 10_000 });

    const retryReg = new FakeRegistration();
    h.container.register.mockResolvedValueOnce(retryReg);
    retryReg.installing = new FakeWorker();
    const retry = h.pwa.checkForUpdate();
    expect(h.pwa.getStatus().preparation?.status).toBe('running');
    await retry;
    expect(h.container.register).toHaveBeenCalledWith(`${BASE}sw.js`, { scope: BASE });
    // Niepusty cache (Chromium zachowuje zapisane części) nie jest usuwany przed ponowieniem.
    expect(h.caches.deleted).toEqual([]);
    h.caches.putAll();
    retryReg.finishInstall();
    await flush();
    expect(h.pwa.getStatus()).toMatchObject({ preparation: null, offlineReady: true, registration: 'registered' });
  });

  it('instalacja zakończona z niekompletnym cache (WebKit) → bez offlineReady: wyrejestrowanie, czysty cache, ponowienie', async () => {
    const h = await setupStarted();
    const ready = vi.fn();
    const errors: Array<{ done: number; total: number }> = [];
    h.pwa.onOfflineReady(ready);
    h.pwa.onPreparationError((p) => errors.push(p));
    const reg = new FakeRegistration();
    const worker = reg.startInstall();
    h.options().onRegisteredSW?.(SW_URL, reg as unknown as ServiceWorkerRegistration);
    h.caches.put(`${SCOPE}index.html?__WB_REVISION__=r1`); // 1 z 3 plików
    reg.finishInstall();
    h.options().onOfflineReady?.();
    await flush();
    expect(h.pwa.getStatus()).toMatchObject({ offlineReady: false, preparation: { status: 'failed', done: 0, total: 10_000 } });
    expect(ready).not.toHaveBeenCalled();
    expect(errors).toEqual([{ done: 0, total: 10_000 }]);
    expect(reg.unregister).toHaveBeenCalledTimes(1);
    expect(h.caches.deleted).toEqual([PRECACHE_NAME]);

    // Ponowienie: nowa rejestracja i pełna instalacja; spóźnione zdarzenie usuniętego workera nic nie zmienia.
    const retryReg = new FakeRegistration();
    retryReg.installing = new FakeWorker();
    h.container.register.mockResolvedValueOnce(retryReg);
    await h.pwa.checkForUpdate();
    worker.setState('redundant');
    await flush();
    expect(h.pwa.getStatus().preparation?.status).toBe('running');
    h.caches.putAll();
    retryReg.finishInstall();
    await flush();
    expect(h.pwa.getStatus()).toMatchObject({ preparation: null, offlineReady: true });
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('bez listy precache kompletu nie da się sprawdzić — gotowość po instalacji jak dotąd', async () => {
    const h = await setupStarted({ info: null });
    const reg = new FakeRegistration();
    reg.startInstall();
    h.options().onRegisteredSW?.(SW_URL, reg as unknown as ServiceWorkerRegistration);
    reg.finishInstall();
    await flush();
    expect(h.pwa.getStatus()).toMatchObject({ preparation: null, offlineReady: true });
    expect(reg.unregister).not.toHaveBeenCalled();
  });

  it('pusty cache precache tej aplikacji jest usuwany przed rejestracją bez działającej instalacji (WebKit)', async () => {
    const other = `${PRECACHE_CACHE_PREFIX}${ORIGIN}/inna-aplikacja/`;
    const h = setup({ cached: { [PRECACHE_NAME]: [], [other]: [] } });
    expect(() => h.options()).toThrow(); // rejestracja dopiero po sprzątaniu
    await flush();
    expect(h.caches.deleted).toEqual([PRECACHE_NAME]);
    expect(h.caches.store.has(other)).toBe(true); // cache innej aplikacji tego originu nietknięty
    expect(() => h.options()).not.toThrow();
  });

  it('cache nie jest usuwany, gdy jest niepusty, gdy trwa/istnieje instalacja albo strona jest kontrolowana', async () => {
    const partial = await setupStarted({ cached: { [PRECACHE_NAME]: [`${SCOPE}index.html?__WB_REVISION__=r1`] } });
    expect(partial.caches.deleted).toEqual([]);

    const installing = new FakeRegistration();
    installing.installing = new FakeWorker();
    const busy = await setupStarted({ cached: { [PRECACHE_NAME]: [] }, existing: installing });
    expect(busy.caches.deleted).toEqual([]);

    const controlled = setup({ controller: true, cached: { [PRECACHE_NAME]: [] } });
    expect(() => controlled.options()).not.toThrow(); // zwykły start: rejestracja od razu
    expect(controlled.container.getRegistration).not.toHaveBeenCalled();
    expect(controlled.caches.deleted).toEqual([]);
  });

  it('pusty cache po przerwaniu jest usuwany także przed ponowieniem', async () => {
    const h = await setupStarted();
    h.options().onRegisterError?.(new TypeError('Failed to fetch'));
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    h.caches.store.set(PRECACHE_NAME, []);
    h.container.register.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await h.pwa.checkForUpdate();
    expect(h.caches.deleted).toEqual([PRECACHE_NAME]);
  });

  it('start offline z istniejącą rejestracją: błąd register() nie jest błędem aplikacji', async () => {
    const h = setup({ controller: true });
    const existing = new FakeRegistration();
    existing.active = new FakeWorker('activated');
    h.container.getRegistration.mockResolvedValueOnce(existing);
    h.options().onRegisterError?.(new TypeError('Load failed'));
    await flush();
    expect(h.pwa.getStatus()).toMatchObject({ registration: 'registered', offlineReady: true, preparation: null, errorCode: null });
  });

  it('pierwsze uruchomienie: błąd sieci przy rejestracji → przygotowanie przerwane (z ponowieniem)', async () => {
    const h = await setupStarted();
    h.options().onRegisterError?.(new TypeError('Failed to fetch'));
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(h.pwa.getStatus()).toMatchObject({ registration: 'failed', errorCode: 'SW_REGISTER_FAILED', preparation: { status: 'failed' } });
  });

  it('nieudane ponowienie (brak sieci) wraca do stanu failed, nie zostaje „running”', async () => {
    const h = await setupStarted();
    h.options().onRegisterError?.(new TypeError('Failed to fetch'));
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    h.container.register.mockRejectedValueOnce(new DOMException('blocked', 'SecurityError'));
    await h.pwa.checkForUpdate();
    await flush();
    expect(h.pwa.getStatus()).toMatchObject({ registration: 'failed', preparation: { status: 'failed' } });
  });

  it('odmowa przeglądarki (SecurityError) → bez ekranu przygotowania, nauka online', async () => {
    const h = await setupStarted();
    h.options().onRegisterError?.(new DOMException('insecure', 'SecurityError'));
    await flush();
    expect(h.pwa.getStatus()).toMatchObject({ registration: 'failed', preparation: null });
  });
});

describe('aktualizacja na żądanie', () => {
  function withWaiting(): { h: Harness; reg: FakeRegistration; waiting: FakeWorker } {
    const h = setup({ controller: true });
    const reg = new FakeRegistration();
    reg.active = new FakeWorker('activated');
    const waiting = new FakeWorker('installed');
    reg.waiting = waiting;
    h.options().onRegisteredSW?.(SW_URL, reg as unknown as ServiceWorkerRegistration);
    return { h, reg, waiting };
  }

  it('czekająca wersja przy starcie → needRefresh (także dla spóźnionego subskrybenta)', async () => {
    const { h } = withWaiting();
    expect(h.pwa.getStatus().needRefresh).toBe(true);
    const listener = vi.fn();
    h.pwa.onNeedRefresh(listener);
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('nowa wersja pobrana w trakcie pracy → needRefresh, bez przeładowania', () => {
    const h = setup({ controller: true });
    const reg = new FakeRegistration();
    reg.active = new FakeWorker('activated');
    h.options().onRegisteredSW?.(SW_URL, reg as unknown as ServiceWorkerRegistration);
    expect(h.pwa.getStatus()).toMatchObject({ needRefresh: false, preparation: null, offlineReady: true });
    reg.startInstall();
    expect(h.pwa.getStatus().preparation).toBeNull(); // aktualizacja to nie „przygotowanie”
    reg.finishInstall();
    expect(h.pwa.getStatus().needRefresh).toBe(true);
    expect(h.reload).not.toHaveBeenCalled();
  });

  it('bez potwierdzenia kontrolera — odmowa i brak SKIP_WAITING', async () => {
    const { h, waiting } = withWaiting();
    h.confirm.value = false;
    await expect(h.pwa.applyUpdate()).rejects.toBeInstanceOf(PwaError);
    await expect(h.pwa.applyUpdate()).rejects.toMatchObject({ code: 'UPDATE_NOT_SAFE' });
    expect(h.updateSW).not.toHaveBeenCalled();
    expect(waiting.messages).toEqual([]);
    expect(h.pwa.getStatus().applying).toBe(false);
  });

  it('z potwierdzeniem: SKIP_WAITING, przeładowanie po przejęciu, flaga „zaktualizowano”', async () => {
    const { h, waiting } = withWaiting();
    const done = h.pwa.applyUpdate();
    await flush();
    expect(h.updateSW).toHaveBeenCalledTimes(1);
    expect(waiting.messages).toContainEqual({ type: 'SKIP_WAITING' });
    expect(h.pwa.getStatus().applying).toBe(true);
    expect(h.storage.get(UPDATED_FLAG_KEY)).toBe('1');
    h.container.dispatchEvent(new Event('controllerchange'));
    h.options().onNeedReload?.();
    await done;
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.pwa.consumeUpdatedFlag()).toBe(true);
    expect(h.pwa.consumeUpdatedFlag()).toBe(false);
  });

  it('brak przejęcia w czasie → UPDATE_TIMEOUT, stara wersja działa, flaga usunięta', async () => {
    const { h } = withWaiting();
    const done = h.pwa.applyUpdate();
    const assertion = expect(done).rejects.toMatchObject({ code: 'UPDATE_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(15_001);
    await assertion;
    expect(h.pwa.getStatus()).toMatchObject({ applying: false, needRefresh: true });
    expect(h.storage.has(UPDATED_FLAG_KEY)).toBe(false);
    expect(h.reload).not.toHaveBeenCalled();
  });

  it('nowa wersja uruchomiona w innej karcie: bez samoczynnego przeładowania, potem przeładowanie na żądanie', async () => {
    const h = setup({ controller: true });
    const reg = new FakeRegistration();
    reg.active = new FakeWorker('activated');
    h.options().onRegisteredSW?.(SW_URL, reg as unknown as ServiceWorkerRegistration);
    h.container.dispatchEvent(new Event('controllerchange'));
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.pwa.getStatus().needRefresh).toBe(true);
    h.confirm.value = false;
    await expect(h.pwa.applyUpdate()).rejects.toMatchObject({ code: 'UPDATE_NOT_SAFE' });
    h.confirm.value = true;
    await h.pwa.applyUpdate();
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it('sprawdzanie aktualizacji przy powrocie do aplikacji najwyżej co godzinę', () => {
    const h = setup({ controller: true });
    const reg = new FakeRegistration();
    reg.active = new FakeWorker('activated');
    h.options().onRegisteredSW?.(SW_URL, reg as unknown as ServiceWorkerRegistration);
    h.now.value += 30 * 60 * 1000;
    h.visible();
    expect(reg.update).not.toHaveBeenCalled();
    h.now.value += 31 * 60 * 1000;
    h.visible();
    expect(reg.update).toHaveBeenCalledTimes(1);
  });
});
