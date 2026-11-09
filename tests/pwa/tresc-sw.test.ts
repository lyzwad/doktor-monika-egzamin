/**
 * Ochrona przed powrotem starej puli po stronie Service Workera i okna (docs/MIGRACJA_V18.md):
 * - skrypt przejęcia (scripts/sw-takeover.mjs, importScripts w sw.js) w atrapie zakresu SW:
 *   aktualizacja ze zmianą wersji treści → skipWaiting, clients.claim, DME_CONTENT_UPDATE, navigate;
 *   pierwsza instalacja i aktualizacja bez zmiany treści → bez przejęcia; navigate niedostępne (Safari < 16)
 *   → bez wyjątku (fallback: wiadomość + sprawdzenie przy starcie/powrocie); dawne pliki banków w `data/` → 404;
 * - okno (src/pwa/swController.ts): wiadomość SW / plik wydania z inną wersją → onContentUpdate,
 *   reloadForContentUpdate → update + przeładowanie, controllerchange po wykryciu → przeładowanie.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { takeoverScript } from '../../scripts/sw-takeover.mjs';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';
import { createServiceWorkerPwaWith, parseReleaseInfo, type PwaEnvironment } from '../../src/pwa/swController';

const SCOPE = 'https://dm.example/doktor-monika-egzamin/';

/* ---------------- atrapa zakresu Service Workera ---------------- */

class MemoryCaches {
  readonly stores = new Map<string, Map<string, string>>();
  async open(name: string) {
    let m = this.stores.get(name);
    if (!m) this.stores.set(name, (m = new Map()));
    const store = m;
    return {
      match: async (key: string) => (store.has(key) ? new Response(store.get(key)) : undefined),
      put: async (key: string, res: Response) => void store.set(key, await res.text()),
      delete: async (key: string) => store.delete(key),
    };
  }
}

interface FakeClient {
  url: string;
  messages: unknown[];
  navigated: string[];
  postMessage(m: unknown): void;
  navigate?: (url: string) => Promise<unknown>;
}

function swScope(opts: { active: boolean; navigateSupported?: boolean; caches?: MemoryCaches }) {
  const listeners = new Map<string, ((e: { waitUntil(p: Promise<unknown>): void }) => void)[]>();
  const caches = opts.caches ?? new MemoryCaches();
  const calls = { skipWaiting: 0, claim: 0 };
  const client: FakeClient = {
    url: `${SCOPE}#/sesja/stara`,
    messages: [],
    navigated: [],
    postMessage(m) {
      this.messages.push(m);
    },
  };
  if (opts.navigateSupported !== false) client.navigate = async (url: string) => void client.navigated.push(url);
  else client.navigate = () => {
    throw new DOMException('navigate', 'NotSupportedError');
  };
  const self = {
    registration: { scope: SCOPE, active: opts.active ? {} : null },
    addEventListener: (type: string, l: (e: { waitUntil(p: Promise<unknown>): void }) => void) => listeners.set(type, [...(listeners.get(type) ?? []), l]),
    skipWaiting: async () => void calls.skipWaiting++,
    clients: { claim: async () => void calls.claim++, matchAll: async () => [client] },
  };
  new Function('self', 'caches', takeoverScript(CONTENT_RELEASE))(self, caches);
  const fire = async (type: string): Promise<void> => {
    const pending: Promise<unknown>[] = [];
    for (const l of listeners.get(type) ?? []) l({ waitUntil: (p) => void pending.push(p) });
    await Promise.all(pending);
    await new Promise((r) => setTimeout(r, 0));
  };
  return { fire, calls, client, caches, listeners };
}

describe('skrypt przejęcia Service Workera (zmiana wersji treści)', () => {
  it('aktualizacja ze starej wersji (brak znacznika): skipWaiting, claim, wiadomość i navigate otwartego okna', async () => {
    const sw = swScope({ active: true });
    await sw.fire('install');
    expect(sw.calls.skipWaiting).toBe(1);
    await sw.fire('activate');
    expect(sw.calls.claim).toBe(1);
    expect(sw.client.messages).toEqual([{ type: 'DME_CONTENT_UPDATE', bankVersion: CONTENT_RELEASE.bankVersion }]);
    expect(sw.client.navigated).toEqual([sw.client.url]);
  });

  it('pierwsza instalacja (brak aktywnego workera): bez skipWaiting i bez przejęcia; znacznik zapisany', async () => {
    const sw = swScope({ active: false });
    await sw.fire('install');
    await sw.fire('activate');
    expect(sw.calls).toEqual({ skipWaiting: 0, claim: 0 });
    expect(sw.client.navigated).toEqual([]);
    // Kolejna aktualizacja aplikacji z TĄ SAMĄ wersją treści — zwykły tryb na żądanie.
    const next = swScope({ active: true, caches: sw.caches });
    await next.fire('install');
    await next.fire('activate');
    expect(next.calls).toEqual({ skipWaiting: 0, claim: 0 });
  });

  it('Safari < 16 (navigate rzuca NotSupportedError): aktywacja kończy się, okno dostaje wiadomość', async () => {
    const sw = swScope({ active: true, navigateSupported: false });
    await sw.fire('install');
    await expect(sw.fire('activate')).resolves.toBeUndefined();
    expect(sw.calls.claim).toBe(1);
    expect(sw.client.messages).toHaveLength(1);
  });

  it('dawne pliki banków w scope (V15, sprzed V15, nieznane wersje w data/) → 404 bez sieci; bieżące pliki V18 przechodzą', async () => {
    const sw = swScope({ active: true });
    const fetchListeners = sw.listeners.get('fetch') ?? [];
    expect(fetchListeners.length).toBeGreaterThan(0);
    const request = async (url: string): Promise<number | null> => {
      const holder: { response: Response | null } = { response: null };
      for (const l of fetchListeners) l({ request: { url }, respondWith: (r: Response) => void (holder.response = r), waitUntil: () => undefined } as never);
      return holder.response ? holder.response.status : null;
    };
    for (const old of [
      'data/bank.json',
      'data/bank-37f3980a1129.json',
      'data/retired-question-ids-83b36ff80986.json',
      'data/training-profile-c0edd4ca07c2.json',
      'data/bank-ffffffffffff.json?v=1',
      'data/allowed-question-ids.json',
    ]) {
      expect(await request(`${SCOPE}${old}`), old).toBe(404);
    }
    for (const current of [CONTENT_RELEASE.bankFile, CONTENT_RELEASE.retiredFile, CONTENT_RELEASE.profileFile, 'index.html', 'assets/index.js', 'icons/icon-192.png']) {
      expect(await request(`${SCOPE}${current}`), current).toBeNull();
    }
    // Poza scope aplikacji — bez ingerencji.
    expect(await request('https://dm.example/inna-aplikacja/data/bank.json')).toBeNull();
  });
});

/* ---------------- okno ---------------- */

class Container extends EventTarget {
  controller: object | null = {};
  register = vi.fn();
  getRegistration = vi.fn(async () => undefined);
}

function windowPwa(release: unknown) {
  const container = new Container();
  const reload = vi.fn();
  let messageListener: ((d: unknown) => void) | null = null;
  let visible: (() => void) | null = null;
  const now = { value: 1_000_000 };
  const update = vi.fn(async () => undefined);
  const env: PwaEnvironment = {
    registerSW: (opts) => {
      queueMicrotask(() => opts.onRegisteredSW?.('sw.js', { scope: SCOPE, active: {}, waiting: null, installing: null, update, addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as ServiceWorkerRegistration));
      return async () => undefined;
    },
    serviceWorker: container as unknown as ServiceWorkerContainer,
    caches: null,
    swUrl: '/doktor-monika-egzamin/sw.js',
    scope: '/doktor-monika-egzamin/',
    fetchPrecacheInfo: async () => null,
    reload,
    isOnline: () => true,
    storage: null,
    onVisible: (l) => {
      visible = l;
      return () => undefined;
    },
    onOnline: () => () => undefined,
    now: () => now.value,
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    contentBankVersion: CONTENT_RELEASE.bankVersion,
    fetchRelease: async () => release,
    onServiceWorkerMessage: (l) => {
      messageListener = l;
      return () => undefined;
    },
  };
  const pwa = createServiceWorkerPwaWith(env, { confirmUpdateSafe: () => true });
  return { pwa, container, reload, update, now, message: (d: unknown) => messageListener?.(d), visible: () => visible?.() };
}

describe('okno: wykrycie nowszej wersji treści i przeładowanie', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('parseReleaseInfo', () => {
    expect(parseReleaseInfo({ format: 'dme-release', bankVersion: 'v16' })).toEqual({ bankVersion: 'v16' });
    expect(parseReleaseInfo({ format: 'inny', bankVersion: 'v16' })).toBeNull();
    expect(parseReleaseInfo(null)).toBeNull();
  });

  it('wiadomość DME_CONTENT_UPDATE z inną wersją → onContentUpdate (raz); ta sama wersja → nic', async () => {
    const w = windowPwa(null);
    const seen: string[] = [];
    w.pwa.onContentUpdate?.((i) => seen.push(i.bankVersion));
    w.message({ type: 'DME_CONTENT_UPDATE', bankVersion: CONTENT_RELEASE.bankVersion });
    w.message({ type: 'DME_CONTENT_UPDATE', bankVersion: 'v16' });
    w.message({ type: 'DME_CONTENT_UPDATE', bankVersion: 'v16' });
    expect(seen).toEqual(['v16']);
  });

  it('plik wydania przy powrocie z tła (nie częściej niż co minutę) → onContentUpdate; checkRelease zwraca wersję', async () => {
    const w = windowPwa({ format: 'dme-release', bankVersion: 'v16' });
    const seen: string[] = [];
    w.pwa.onContentUpdate?.((i) => seen.push(i.bankVersion));
    expect(await w.pwa.checkRelease?.()).toEqual({ bankVersion: 'v16' });
    w.visible();
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([]);
    w.now.value += 61_000;
    w.visible();
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual(['v16']);
  });

  it('reloadForContentUpdate: sprawdzenie SW i przeładowanie po czasie na przejęcie; controllerchange po wykryciu → od razu', async () => {
    const w = windowPwa(null);
    await vi.advanceTimersByTimeAsync(0);
    const p = w.pwa.reloadForContentUpdate?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.update).toHaveBeenCalled();
    expect(w.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(8000);
    await p;
    expect(w.reload).toHaveBeenCalledTimes(1);

    const w2 = windowPwa(null);
    w2.message({ type: 'DME_CONTENT_UPDATE', bankVersion: 'v16' });
    w2.container.dispatchEvent(new Event('controllerchange'));
    expect(w2.reload).toHaveBeenCalledTimes(1);
  });
});
