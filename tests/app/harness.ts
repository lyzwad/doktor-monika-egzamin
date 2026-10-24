/**
 * Uprząż testów integracyjnych rzeczywistego kontrolera: prawdziwy silnik domeny, prawdziwe
 * repozytorium IndexedDB (fake-indexeddb), prawdziwy bank V15 (`public/data/bank-<sha12>.json`),
 * sterowalna platforma (zegar, identyfikatory, hash, pliki, sieć) i atrapa portu PWA.
 */
import { IDBFactory } from 'fake-indexeddb';
import { createAppController } from '../../src/app/appController';
import type { AppController, ContentBundle, Platform } from '../../src/app/controller';
import { nextDayStartInZone } from '../../src/app/platform';
import type { QuestionVM } from '../../src/app/viewModels';
import type { Session, UserState } from '../../src/domain/types';
import type { ExportedFile, Repository } from '../../src/persistence/api';
import { createIndexedDbRepository } from '../../src/persistence/repository';
import type { PreparationProgress, PwaPort } from '../../src/pwa/api';

import { BANK, contentBundle } from '../content';

export { BANK, contentBundle };

export interface FakePlatform extends Platform {
  hash: string;
  hashWrites: { hash: string; mode: 'push' | 'replace' }[];
  files: ExportedFile[];
  /** Symulacja zmiany adresu przez przeglądarkę (Wstecz, ręczna zmiana). */
  browserHash(hash: string): void;
  setOnline(value: boolean): void;
  advance(ms: number): void;
  nowMs: number;
}

export function fakePlatform(startIso = '2026-10-22T08:00:00.000Z'): FakePlatform {
  let ids = 0;
  const hashListeners = new Set<(hash: string) => void>();
  const onlineListeners = new Set<(online: boolean) => void>();
  let online = true;
  let seed = 12345;
  const p: FakePlatform = {
    nowMs: Date.parse(startIso),
    hash: '',
    hashWrites: [],
    files: [],
    nowIso() {
      p.nowMs += 1000;
      return new Date(p.nowMs).toISOString();
    },
    nextDayStartIso: (iso) => nextDayStartInZone(iso),
    randomId: () => `id-${(++ids).toString().padStart(5, '0')}`,
    randomSeed: () => (seed = (seed * 1103515245 + 12345) >>> 0),
    async saveFile(file) {
      p.files.push(file);
    },
    isOnline: () => online,
    onOnlineChange(listener) {
      onlineListeners.add(listener);
      return () => onlineListeners.delete(listener);
    },
    getHash: () => p.hash,
    setHash(hash, mode) {
      p.hash = hash;
      p.hashWrites.push({ hash, mode });
    },
    onHashChange(listener) {
      hashListeners.add(listener);
      return () => hashListeners.delete(listener);
    },
    browserHash(hash) {
      p.hash = hash;
      for (const l of [...hashListeners]) l(hash);
    },
    setOnline(value) {
      online = value;
      for (const l of [...onlineListeners]) l(value);
    },
    advance(ms) {
      p.nowMs += ms;
    },
  };
  return p;
}

export interface FakePwa extends PwaPort {
  needRefresh(): void;
  offlineReady(): void;
  progress(p: PreparationProgress): void;
  error(p: PreparationProgress): void;
  applied: number;
  checks: number;
}

export function fakePwa(): FakePwa {
  const need = new Set<() => void>();
  const ready = new Set<() => void>();
  const prog = new Set<(p: PreparationProgress) => void>();
  const err = new Set<(p: PreparationProgress) => void>();
  const add =
    <T>(set: Set<T>) =>
    (l: T) => {
      set.add(l);
      return () => set.delete(l);
    };
  const pwa: FakePwa = {
    applied: 0,
    checks: 0,
    onNeedRefresh: add(need),
    onOfflineReady: add(ready),
    onPreparationProgress: add(prog),
    onPreparationError: add(err),
    async applyUpdate() {
      pwa.applied += 1;
    },
    async checkForUpdate() {
      pwa.checks += 1;
    },
    needRefresh: () => need.forEach((l) => l()),
    offlineReady: () => ready.forEach((l) => l()),
    progress: (x) => prog.forEach((l) => l(x)),
    error: (x) => err.forEach((l) => l(x)),
  };
  return pwa;
}

export interface FakeStorageManager {
  persistCalls: number;
  persisted: boolean;
  manager: StorageManager;
}

export function fakeStorageManager(grant = true): FakeStorageManager {
  const s: FakeStorageManager = {
    persistCalls: 0,
    persisted: false,
    manager: {
      persist: async () => {
        s.persistCalls += 1;
        s.persisted = grant;
        return grant;
      },
      persisted: async () => s.persisted,
      estimate: async () => ({ usage: 2048, quota: 1024 * 1024 * 1024 }),
      getDirectory: async () => {
        throw new Error('nieobsługiwane');
      },
    } as StorageManager,
  };
  return s;
}

let dbCounter = 0;

export interface Harness {
  controller: AppController;
  platform: FakePlatform;
  pwa: FakePwa;
  repository: Repository;
  storage: FakeStorageManager;
  factory: IDBFactory;
  dbName: string;
}

export interface HarnessOptions {
  factory?: IDBFactory;
  dbName?: string;
  platform?: FakePlatform;
  repository?: Repository;
  wrapRepository?: (repo: Repository) => Repository;
  loadBank?: () => Promise<ContentBundle>;
  hash?: string;
  storage?: FakeStorageManager;
}

/** Kontroler na świeżej (albo podanej) bazie; `start()` wykonane. */
export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const factory = options.factory ?? new IDBFactory();
  const dbName = options.dbName ?? `dme-app-test-${++dbCounter}`;
  const platform = options.platform ?? fakePlatform();
  if (options.hash !== undefined) platform.hash = options.hash;
  const pwa = fakePwa();
  const storage = options.storage ?? fakeStorageManager();
  const base =
    options.repository ??
    createIndexedDbRepository({ indexedDB: factory, dbName, appVersion: 'test', storageManager: storage.manager, now: () => new Date(platform.nowMs).toISOString() });
  const repository = options.wrapRepository ? options.wrapRepository(base) : base;
  const controller = createAppController({
    repository,
    loadBank: options.loadBank ?? (async () => contentBundle()),
    platform,
    pwa,
    appVersion: 'test-1',
  });
  await controller.start();
  return { controller, platform, pwa, repository, storage, factory, dbName };
}

/** Czeka, aż kolejka komend kontrolera się opróżni (zapisy w tle, np. `markShown`). */
export async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

export function question(c: AppController): QuestionVM {
  const s = c.getState().screen;
  if (s?.name !== 'question') throw new Error(`oczekiwano ekranu pytania, jest ${s?.name ?? 'null'}`);
  return s;
}

export function openSession(c: AppController): Session {
  const s = Object.values(c.getState().userState?.sessions ?? {}).find((x) => x.status === 'open');
  if (!s) throw new Error('brak otwartej sesji');
  return s;
}

export function userState(c: AppController): UserState {
  const u = c.getState().userState;
  if (!u) throw new Error('brak stanu użytkowniczki');
  return u;
}

/** Klucz bieżącego pytania — z migawki w zapisanym stanie (sterowanie testem, nie UI). */
export function keyOf(c: AppController): string {
  const q = question(c);
  const slot = c.getState().userState?.sessions[q.sessionId]?.slots[q.slotId];
  if (!slot) throw new Error('brak slotu');
  return slot.snapshot.correctOptionId;
}

export function wrongOf(c: AppController): string {
  const key = keyOf(c);
  const q = question(c);
  const wrong = q.answers.find((a) => a.optionId !== key);
  if (!wrong) throw new Error('brak błędnej opcji');
  return wrong.optionId;
}

/** Repozytorium, którego `commit` można zmusić do błędu (QuotaExceeded / Conflict). */
export function failingRepository(repo: Repository): Repository & { failNext: (code: 'QuotaExceeded' | 'WriteFailed' | 'Conflict', times?: number) => void; commits: string[] } {
  let failCode: 'QuotaExceeded' | 'WriteFailed' | 'Conflict' | null = null;
  let remaining = 0;
  const commits: string[] = [];
  const wrapped = Object.create(repo) as Repository & { failNext: (code: 'QuotaExceeded' | 'WriteFailed' | 'Conflict', times?: number) => void; commits: string[] };
  wrapped.commits = commits;
  wrapped.failNext = (code, times = 1) => {
    failCode = code;
    remaining = times;
  };
  wrapped.commit = async (changeset) => {
    commits.push(changeset.commandId ?? '');
    if (failCode && remaining > 0) {
      remaining -= 1;
      const code = failCode;
      if (remaining === 0) failCode = null;
      if (code === 'Conflict') return { ok: false, error: { code, messagePl: 'Sesja została w międzyczasie zmieniona.', sessionId: 'x' } };
      return { ok: false, error: { code, messagePl: code === 'QuotaExceeded' ? 'Brak miejsca.' : 'Błąd zapisu.' } };
    }
    return repo.commit(changeset);
  };
  return wrapped;
}
