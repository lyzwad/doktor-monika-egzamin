/**
 * Ochrona przed powrotem starej puli po stronie Service Workera i okna (docs/MIGRACJA_V18.md, docs/MIGRACJA_WEBINARY.md):
 * - skrypt przejęcia (scripts/sw-takeover.mjs, importScripts w sw.js) w atrapie zakresu SW:
 *   aktualizacja ze zmianą wersji treści → skipWaiting, clients.claim, DME_CONTENT_UPDATE, navigate;
 *   pierwsza instalacja i aktualizacja bez zmiany treści → bez przejęcia; navigate niedostępne (Safari < 16)
 *   → bez wyjątku (fallback: wiadomość + sprawdzenie przy starcie/powrocie); dawne pliki banków w `data/` → 404;
 * - przejście z wydania V18 (produkcja `39d9d46`) na następne wydanie treści (syntetyczne: inna `bankVersion`,
 *   SHA i trzy nowe pliki): znacznik V18 w Cache Storage → przejęcie; pliki V18 i V15 → 404; pliki nowego
 *   wydania przechodzą; inna nazwa skryptu przejęcia; ten sam znacznik → bez przejęcia;
 * - okno (src/pwa/swController.ts): wiadomość SW / plik wydania z inną wersją → onContentUpdate,
 *   reloadForContentUpdate → update + przeładowanie, controllerchange po wykryciu → przeładowanie.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_EPOCH, takeoverFileName, takeoverScript } from '../../scripts/sw-takeover.mjs';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';
import { createServiceWorkerPwaWith, parseReleaseInfo, type PwaEnvironment } from '../../src/pwa/swController';

const SCOPE = 'https://dm.example/doktor-monika-egzamin/';

/** Pola wydania treści, z których korzysta skrypt przejęcia (podzbiór `CONTENT_RELEASE`). */
interface TakeoverRelease {
  bankVersion: string;
  bankSha256: string;
  bankFile: string;
  retiredFile: string;
  profileFile: string;
}

/** Nazwy plików `data/` wydania: prefiks + pierwsze 12 znaków SHA-256 (jak w `public/data`). */
function releaseFiles(sha: { bank: string; retired: string; profile: string }): Pick<TakeoverRelease, 'bankFile' | 'retiredFile' | 'profileFile'> {
  return {
    bankFile: `data/bank-${sha.bank.slice(0, 12)}.json`,
    retiredFile: `data/retired-question-ids-${sha.retired.slice(0, 12)}.json`,
    profileFile: `data/training-profile-${sha.profile.slice(0, 12)}.json`,
  };
}

/**
 * Wydanie V18 (produkcja `39d9d46`, docs/MIGRACJA_V18.md) — z manifestu paczki V18 w `content/v18/`, która zostaje
 * w repozytorium jako wejście scalania także po zmianie `CONTENT_RELEASE`.
 */
const V18_MANIFEST = JSON.parse(readFileSync(resolve(process.cwd(), 'content/v18/MANIFEST.json'), 'utf-8')) as { bank_version: string; files: Record<string, string> };
const V18_RELEASE: TakeoverRelease = {
  bankVersion: V18_MANIFEST.bank_version,
  bankSha256: V18_MANIFEST.files['runtime/bank.json']!,
  ...releaseFiles({ bank: V18_MANIFEST.files['runtime/bank.json']!, retired: V18_MANIFEST.files['runtime/retired_question_ids.json']!, profile: V18_MANIFEST.files['runtime/training_profile.json']! }),
};
/** Dawne pliki V15 i sprzed V15 (docs/MIGRACJA_V18.md §1). */
const V15_DATA_FILES = ['data/bank.json', 'data/bank-37f3980a1129.json', 'data/retired-question-ids-83b36ff80986.json', 'data/training-profile-c0edd4ca07c2.json'];

/** Syntetyczne „następne wydanie” treści: inna wersja, inne SHA, trzy nowe pliki w `data/`. */
const nextSha = (part: string): string => createHash('sha256').update(`następne wydanie treści (test): ${part}`).digest('hex');
const NEXT_RELEASE: TakeoverRelease = {
  bankVersion: `dme-test-nastepne-wydanie-${nextSha('bank').slice(0, 12)}`,
  bankSha256: nextSha('bank'),
  ...releaseFiles({ bank: nextSha('bank'), retired: nextSha('retired'), profile: nextSha('profile') }),
};

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

/** Atrapa zakresu SW z wykonanym skryptem przejęcia wydania `release` (domyślnie bieżące `CONTENT_RELEASE`). */
function swScope(opts: { active: boolean; navigateSupported?: boolean; caches?: MemoryCaches; release?: TakeoverRelease }) {
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
  new Function('self', 'caches', takeoverScript(opts.release ?? CONTENT_RELEASE))(self, caches);
  const fire = async (type: string): Promise<void> => {
    const pending: Promise<unknown>[] = [];
    for (const l of listeners.get(type) ?? []) l({ waitUntil: (p) => void pending.push(p) });
    await Promise.all(pending);
    await new Promise((r) => setTimeout(r, 0));
  };
  return { fire, calls, client, caches, listeners };
}

/** Żądanie przez obsługę `fetch` skryptu: status odpowiedzi SW albo `null` (SW nie odpowiada — precache/sieć). */
async function swRequest(sw: ReturnType<typeof swScope>, url: string): Promise<number | null> {
  const holder: { response: Response | null } = { response: null };
  for (const l of sw.listeners.get('fetch') ?? []) l({ request: { url }, respondWith: (r: Response) => void (holder.response = r), waitUntil: () => undefined } as never);
  return holder.response ? holder.response.status : null;
}

/** Wartości zapisane w Cache Storage znacznika treści (dme-content-marker-v1). */
function markerValues(caches: MemoryCaches): string[] {
  return [...caches.stores.entries()].filter(([name]) => name.startsWith('dme-content-marker-v1:')).flatMap(([, store]) => [...store.values()]);
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

  it('dawne pliki banków w scope (V15, sprzed V15, nieznane wersje w data/) → 404 bez sieci; bieżące pliki wydania przechodzą', async () => {
    const sw = swScope({ active: true });
    expect((sw.listeners.get('fetch') ?? []).length).toBeGreaterThan(0);
    for (const old of [...V15_DATA_FILES, 'data/bank-ffffffffffff.json?v=1', 'data/allowed-question-ids.json']) {
      expect(await swRequest(sw, `${SCOPE}${old}`), old).toBe(404);
    }
    for (const current of [CONTENT_RELEASE.bankFile, CONTENT_RELEASE.retiredFile, CONTENT_RELEASE.profileFile, 'index.html', 'assets/index.js', 'icons/icon-192.png']) {
      expect(await swRequest(sw, `${SCOPE}${current}`), current).toBeNull();
    }
    // Poza scope aplikacji — bez ingerencji.
    expect(await swRequest(sw, 'https://dm.example/inna-aplikacja/data/bank.json')).toBeNull();
  });
});

describe('skrypt przejęcia: wydanie V18 (produkcja 39d9d46) → następne wydanie treści', () => {
  /** Stan telefonu z produkcji: aktywny SW V18 zapisał swój znacznik w Cache Storage. */
  async function v18Installed(): Promise<MemoryCaches> {
    const v18 = swScope({ active: false, release: V18_RELEASE });
    await v18.fire('install');
    await v18.fire('activate');
    return v18.caches;
  }

  it('znacznik V18 w Cache Storage = `<bankVersion V18>#<epoka>`', async () => {
    expect(markerValues(await v18Installed())).toEqual([`${V18_RELEASE.bankVersion}#${DATA_EPOCH}`]);
    expect(`${V18_RELEASE.bankVersion}#${DATA_EPOCH}`).toBe('chatgpt-combined-v18-2026-11-09-1fb7f7546332#profile-1');
  });

  it('instalacja następnego wydania przy aktywnym SW V18: skipWaiting, clients.claim, DME_CONTENT_UPDATE z nową wersją, navigate okna', async () => {
    const sw = swScope({ active: true, caches: await v18Installed(), release: NEXT_RELEASE });
    await sw.fire('install');
    expect(sw.calls.skipWaiting).toBe(1);
    await sw.fire('activate');
    expect(sw.calls.claim).toBe(1);
    expect(sw.client.messages).toEqual([{ type: 'DME_CONTENT_UPDATE', bankVersion: NEXT_RELEASE.bankVersion }]);
    expect(sw.client.navigated).toEqual([sw.client.url]);
    expect(markerValues(sw.caches)).toEqual([`${NEXT_RELEASE.bankVersion}#${DATA_EPOCH}`]);
  });

  it('Safari < 16 (navigate rzuca): przejście z V18 kończy aktywację, okno dostaje wiadomość z nową wersją', async () => {
    const sw = swScope({ active: true, navigateSupported: false, caches: await v18Installed(), release: NEXT_RELEASE });
    await sw.fire('install');
    await expect(sw.fire('activate')).resolves.toBeUndefined();
    expect(sw.calls.claim).toBe(1);
    expect(sw.client.messages).toEqual([{ type: 'DME_CONTENT_UPDATE', bankVersion: NEXT_RELEASE.bankVersion }]);
  });

  it('ten sam znacznik (następne wydanie już aktywne): kolejna instalacja bez przejęcia — aktualizacja na żądanie', async () => {
    const first = swScope({ active: true, caches: await v18Installed(), release: NEXT_RELEASE });
    await first.fire('install');
    await first.fire('activate');
    const again = swScope({ active: true, caches: first.caches, release: NEXT_RELEASE });
    await again.fire('install');
    await again.fire('activate');
    expect(again.calls).toEqual({ skipWaiting: 0, claim: 0 });
    expect(again.client.messages).toEqual([]);
    expect(again.client.navigated).toEqual([]);
  });

  it('SW następnego wydania: pliki V18 i V15 w data/ (także z ?v=) → 404 bez sieci; pliki nowego wydania, index.html i assets przechodzą', async () => {
    const sw = swScope({ active: true, release: NEXT_RELEASE });
    const v18Files = [V18_RELEASE.bankFile, V18_RELEASE.retiredFile, V18_RELEASE.profileFile];
    for (const old of [...v18Files, ...v18Files.map((f) => `${f}?v=${V18_RELEASE.bankSha256.slice(0, 8)}`), ...V15_DATA_FILES]) {
      expect(await swRequest(sw, `${SCOPE}${old}`), old).toBe(404);
    }
    for (const current of [NEXT_RELEASE.bankFile, NEXT_RELEASE.retiredFile, NEXT_RELEASE.profileFile, 'index.html', 'assets/index-abc123.js', 'icons/icon-192.png']) {
      expect(await swRequest(sw, `${SCOPE}${current}`), current).toBeNull();
    }
  });

  it('nazwa skryptu przejęcia następnego wydania różni się od V18 (nowy plik importScripts → inny bajtowo sw.js)', () => {
    expect(takeoverFileName(NEXT_RELEASE)).not.toBe(takeoverFileName(V18_RELEASE));
    expect(takeoverFileName(NEXT_RELEASE)).toContain(NEXT_RELEASE.bankSha256.slice(0, 12));
  });
});

describe('skrypt przejęcia BIEŻĄCEGO wydania (CONTENT_RELEASE) na telefonie z produkcji V18 (39d9d46)', () => {
  it('bieżące wydanie jest inne niż V18: inna wersja, inne trzy pliki data/, inna nazwa skryptu przejęcia', () => {
    expect(CONTENT_RELEASE.bankVersion).not.toBe(V18_RELEASE.bankVersion);
    const current = [CONTENT_RELEASE.bankFile, CONTENT_RELEASE.retiredFile, CONTENT_RELEASE.profileFile];
    for (const f of [V18_RELEASE.bankFile, V18_RELEASE.retiredFile, V18_RELEASE.profileFile]) expect(current, f).not.toContain(f);
    expect(takeoverFileName(CONTENT_RELEASE)).not.toBe(takeoverFileName(V18_RELEASE));
  });

  it('znacznik V18 w Cache Storage → przejęcie kart przez SW bieżącego wydania (skipWaiting, claim, DME_CONTENT_UPDATE, navigate)', async () => {
    const v18 = swScope({ active: false, release: V18_RELEASE });
    await v18.fire('install');
    await v18.fire('activate');
    const sw = swScope({ active: true, caches: v18.caches });
    await sw.fire('install');
    expect(sw.calls.skipWaiting).toBe(1);
    await sw.fire('activate');
    expect(sw.calls.claim).toBe(1);
    expect(sw.client.messages).toEqual([{ type: 'DME_CONTENT_UPDATE', bankVersion: CONTENT_RELEASE.bankVersion }]);
    expect(sw.client.navigated).toEqual([sw.client.url]);
    expect(markerValues(sw.caches)).toEqual([`${CONTENT_RELEASE.bankVersion}#${DATA_EPOCH}`]);
  });

  it('pliki V18 w data/ (bank-5db40505308f.json i pliki towarzyszące, także z ?v=) → 404 z SW bieżącego wydania; jego trzy pliki przechodzą', async () => {
    const sw = swScope({ active: true });
    const v18Files = [V18_RELEASE.bankFile, V18_RELEASE.retiredFile, V18_RELEASE.profileFile];
    expect(v18Files).toEqual(['data/bank-5db40505308f.json', 'data/retired-question-ids-54a05ea91281.json', 'data/training-profile-2bdad504f50e.json']);
    for (const old of [...v18Files, ...v18Files.map((f) => `${f}?v=1`)]) {
      expect(await swRequest(sw, `${SCOPE}${old}`), old).toBe(404);
    }
    for (const current of [CONTENT_RELEASE.bankFile, CONTENT_RELEASE.retiredFile, CONTENT_RELEASE.profileFile]) {
      expect(await swRequest(sw, `${SCOPE}${current}`), current).toBeNull();
    }
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
