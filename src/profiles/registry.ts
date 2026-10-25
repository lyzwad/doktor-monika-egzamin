/**
 * Rejestr profili na urządzeniu (DECYZJE §16): osobna mała baza IndexedDB, niezależna od danych nauki.
 *
 * - `last` — ostatnio wybrany profil (zapamiętany po zamknięciu aplikacji);
 * - `unassigned` — stan historii sprzed profili: `unknown` (nie sprawdzono), `none` (brak danych),
 *   `unassigned` (czeka na decyzję), `assigning` (przypisanie rozpoczęte — dokończyć po przerwaniu),
 *   `assigned` (przypisana; baza źródłowa zostaje nietknięta jako zabezpieczenie).
 *
 * Zmiana `unassigned → assigning` jest warunkowa w jednej transakcji: dwie karty nie przypiszą tej samej
 * historii dwóm profilom.
 */
import type { IsoDateTime } from '../domain/types';
import { DB_NAME } from '../persistence/api';
import { knownProfile } from './profiles';
import type { ProfileEmail } from './profiles';

export const REGISTRY_DB_NAME = `${DB_NAME}:profile`;
const REGISTRY_VERSION = 1;
const STORE = 'state';

/** Podsumowanie historii bez profilu (do ekranu decyzji; bez treści pytań). */
export interface UnassignedSummary {
  completedTests: number;
  unfinishedTests: number;
  freeFlowSessions: number;
  openSessions: number;
  attempts: number;
  lastActivityAt: IsoDateTime | null;
}

export type UnassignedStatus = 'unknown' | 'none' | 'unassigned' | 'assigning' | 'assigned';

export interface UnassignedRecord {
  key: 'unassigned';
  status: UnassignedStatus;
  /** Profil docelowy (`assigning`/`assigned`). */
  email: ProfileEmail | null;
  /** Identyfikator przypisania — ten sam przy ponowieniu po przerwaniu. */
  mergeId: string | null;
  summary: UnassignedSummary | null;
  updatedAt: IsoDateTime;
}

interface LastRecord {
  key: 'last';
  email: ProfileEmail;
  at: IsoDateTime;
}

export interface RegistrySnapshot {
  last: ProfileEmail | null;
  unassigned: UnassignedRecord | null;
}

export interface ProfileRegistry {
  read(): Promise<RegistrySnapshot>;
  setLast(email: ProfileEmail, at: IsoDateTime): Promise<void>;
  /** Zapis stanu historii bez profilu (bezwarunkowy). */
  setUnassigned(record: Omit<UnassignedRecord, 'key'>): Promise<void>;
  /**
   * Warunkowe rozpoczęcie przypisania: tylko ze stanu `unassigned` (albo `assigning` do tego samego profilu —
   * ponowienie). Zwraca rekord po zmianie albo bieżący, jeśli warunek nie był spełniony.
   */
  beginAssign(email: ProfileEmail, mergeId: string, at: IsoDateTime): Promise<{ started: boolean; record: UnassignedRecord | null }>;
  close(): void;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Błąd rejestru profili'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Przerwana transakcja rejestru profili'));
    tx.onerror = () => undefined;
  });
}

/** Brak `indexedDB` w przeglądarce (nazwa błędu rozpoznawana przy komunikacie). */
export const NO_INDEXEDDB = 'NoIndexedDB';

export function createProfileRegistry(factory: IDBFactory | null | undefined, name: string = REGISTRY_DB_NAME): ProfileRegistry {
  let opening: Promise<IDBDatabase> | null = null;

  const db = (): Promise<IDBDatabase> => {
    if (opening) return opening;
    if (!factory) return Promise.reject(Object.assign(new Error('Brak IndexedDB'), { name: NO_INDEXEDDB }));
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(name, REGISTRY_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const connection = req.result;
        connection.onversionchange = () => {
          connection.close();
          opening = null;
        };
        resolve(connection);
      };
      req.onerror = () => {
        opening = null;
        reject(req.error ?? new Error('Rejestr profili niedostępny'));
      };
      req.onblocked = () => undefined;
    });
    // Odmowa otwarcia (np. wyjątek z `open` w trybie prywatnym) — kolejna próba otwiera od nowa.
    opening.catch(() => {
      opening = null;
    });
    return opening;
  };

  return {
    async read() {
      const tx = (await db()).transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const [last, unassigned] = await Promise.all([request(store.get('last')), request(store.get('unassigned'))]);
      return {
        last: knownProfile((last as LastRecord | undefined)?.email),
        unassigned: (unassigned as UnassignedRecord | undefined) ?? null,
      };
    },
    async setLast(email, at) {
      const tx = (await db()).transaction(STORE, 'readwrite', { durability: 'strict' });
      const record: LastRecord = { key: 'last', email, at };
      tx.objectStore(STORE).put(record);
      await done(tx);
    },
    async setUnassigned(record) {
      const tx = (await db()).transaction(STORE, 'readwrite', { durability: 'strict' });
      tx.objectStore(STORE).put({ key: 'unassigned', ...record });
      await done(tx);
    },
    async beginAssign(email, mergeId, at) {
      const tx = (await db()).transaction(STORE, 'readwrite', { durability: 'strict' });
      const store = tx.objectStore(STORE);
      let started = false;
      let result: UnassignedRecord | null = null;
      const get = store.get('unassigned');
      get.onsuccess = () => {
        const current = (get.result as UnassignedRecord | undefined) ?? null;
        result = current;
        if (current === null) return;
        const retry = current.status === 'assigning' && current.email === email;
        if (current.status !== 'unassigned' && !retry) return;
        const next: UnassignedRecord = { ...current, status: 'assigning', email, mergeId: retry ? (current.mergeId ?? mergeId) : mergeId, updatedAt: at };
        store.put(next);
        result = next;
        started = true;
      };
      await done(tx);
      return { started, record: result };
    },
    close() {
      void opening?.then((c) => c.close()).catch(() => undefined);
      opening = null;
    },
  };
}
