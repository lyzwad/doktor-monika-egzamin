/**
 * Niskopoziomowe operacje IndexedDB: otwarcie z migracjami i transakcja z mapowaniem błędów.
 *
 * Zasady (DECYZJE §1, §10; 03_ARCHITEKTURA §7):
 * - sukces zwracany dopiero po `transaction.oncomplete`; przerwanie (`onabort`) → błąd, nigdy sukces,
 * - wewnątrz transakcji wyłącznie żądania IndexedDB i synchroniczny kod (brak `await` na sieci,
 *   plikach, Web Crypto) — inaczej transakcja zostałaby automatycznie zatwierdzona w połowie,
 * - wyjątek w kodzie transakcji przerywa ją w całości (brak częściowego zapisu).
 */
import type { IsoDateTime } from '../domain/types';
import { STORE_NAMES } from './api';
import type { MetaRecord, OpenInfo, PersistenceError, PersistenceResult, StoreName } from './api';
import { fail, mapOpenError, migrationFailed, blocked, ok } from './errors';
import { migrationsBetween } from './schema';
import type { Migration } from './schema';

/* ========================================================================== */
/* Otwarcie bazy                                                              */
/* ========================================================================== */

export interface OpenDatabaseOptions {
  factory: IDBFactory;
  name: string;
  version: number;
  migrations: readonly Migration[];
  now: () => IsoDateTime;
  appVersion: string;
  /** Połączenie zamknięte z zewnątrz (inna karta podnosi wersję, utrata połączenia). */
  onConnectionLost?: (db: IDBDatabase) => void;
  /** Początek migracji (`onupgradeneeded`) — np. komunikat „Aktualizacja banku pytań…”. */
  onUpgradeStart?: (info: { from: number; to: number }) => void;
}

export interface OpenedDatabase {
  db: IDBDatabase;
  info: OpenInfo;
}

/** Rekord `meta` po migracji. */
function metaRecord(previous: MetaRecord | undefined, version: number, oldVersion: number, now: IsoDateTime, appVersion: string): MetaRecord {
  return {
    key: 'schema',
    schemaVersion: version,
    createdAt: previous?.createdAt ?? now,
    migratedAt: oldVersion === 0 ? null : now,
    appVersion,
  };
}

/**
 * Otwiera bazę w wersji `version`, wykonując brakujące migracje w transakcji `versionchange`.
 * Błąd migracji przerywa transakcję (baza zostaje w poprzedniej wersji, dane nietknięte).
 */
export function openDatabase(options: OpenDatabaseOptions): Promise<PersistenceResult<OpenedDatabase>> {
  const { factory, name, version, migrations, now, appVersion, onConnectionLost, onUpgradeStart } = options;
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: PersistenceResult<OpenedDatabase>): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, version);
    } catch (error) {
      settle(fail(mapOpenError(error)));
      return;
    }

    let upgrading = false;
    let oldVersion = 0;
    let migrationError: unknown = null;

    request.onupgradeneeded = (event) => {
      upgrading = true;
      oldVersion = event.oldVersion;
      const db = request.result;
      const tx = request.transaction;
      if (!tx) {
        migrationError = new Error('Brak transakcji versionchange');
        return;
      }
      const abort = (error: unknown): void => {
        if (migrationError === null) migrationError = error;
        try {
          tx.abort();
        } catch {
          /* transakcja już zakończona */
        }
      };
      try {
        onUpgradeStart?.({ from: oldVersion, to: version });
      } catch {
        /* powiadomienie pomocnicze */
      }
      try {
        const stamp = now();
        for (const step of migrationsBetween(migrations, oldVersion, version)) step.up(db, tx, { now: stamp, appVersion, oldVersion, abort });
        const metaStore = tx.objectStore('meta');
        const previous = metaStore.get('schema');
        previous.onsuccess = () => {
          try {
            metaStore.put(metaRecord(previous.result as MetaRecord | undefined, version, oldVersion, now(), appVersion));
          } catch (error) {
            abort(error);
          }
        };
      } catch (error) {
        abort(error);
      }
    };

    request.onblocked = () => {
      // Inna karta trzyma połączenie ze starszą wersją. Zgłaszamy blokadę; jeśli otwarcie
      // powiedzie się później, połączenie zostanie od razu zamknięte (ponowne `open()` je odtworzy).
      settle(fail(blocked()));
    };

    request.onerror = (event) => {
      event.preventDefault();
      const error = migrationError ?? request.error;
      settle(fail(upgrading ? migrationFailed(error) : mapOpenError(error)));
    };

    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      const missing = STORE_NAMES.filter((store) => !db.objectStoreNames.contains(store));
      if (missing.length > 0) {
        db.close();
        settle(fail(migrationFailed(new Error(`Brak magazynów: ${missing.join(', ')}`))));
        return;
      }
      db.onversionchange = () => {
        db.close();
        onConnectionLost?.(db);
      };
      db.onclose = () => onConnectionLost?.(db);
      settle(
        ok({
          db,
          info: {
            schemaVersion: db.version,
            migratedFrom: upgrading && oldVersion > 0 ? oldVersion : null,
            created: upgrading && oldVersion === 0,
          },
        }),
      );
    };
  });
}

/* ========================================================================== */
/* Transakcja                                                                 */
/* ========================================================================== */

export interface TxControl {
  /** Przerywa transakcję z podanym błędem (np. konflikt rewizji). Zapis nie nastąpi. */
  fail(error: PersistenceError): void;
  /** Opakowuje callback żądania: wyjątek w nim przerywa transakcję z tą przyczyną. */
  guard<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void;
}

/**
 * Ciało transakcji: wydaje żądania synchronicznie (i w callbackach `guard`), zwraca funkcję
 * obliczającą wynik — wywoływaną dopiero po `oncomplete`.
 */
export type TxBody<T> = (tx: IDBTransaction, control: TxControl) => () => T;

/** Tworzy transakcję (rzuca np. `InvalidStateError`, gdy połączenie jest zamykane). */
export function createTransaction(db: IDBDatabase, stores: readonly StoreName[], mode: IDBTransactionMode): IDBTransaction {
  const scope = [...new Set(stores)];
  // `strict`: `complete` dopiero po utrwaleniu na dysku (przeglądarki bez tej opcji ją pomijają).
  return mode === 'readwrite' ? db.transaction(scope, mode, { durability: 'strict' }) : db.transaction(scope, mode);
}

/**
 * Wykonuje ciało w transakcji. Wynik:
 * - `oncomplete` → `{ ok: true }`,
 * - przerwanie → `{ ok: false }` z przyczyną: jawny błąd (`control.fail`) > `transaction.error`
 *   (np. QuotaExceededError) > wyjątek z kodu > ogólne przerwanie.
 */
export function runTransaction<T>(
  tx: IDBTransaction,
  body: TxBody<T>,
  mapError: (error: unknown) => PersistenceError,
): Promise<PersistenceResult<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: PersistenceResult<T>): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let explicit: PersistenceError | null = null;
    let thrown: unknown = null;
    let finalize: (() => T) | null = null;

    const abort = (): void => {
      try {
        tx.abort();
      } catch {
        /* transakcja już zakończona albo przerwana */
      }
    };
    const recordThrown = (error: unknown): void => {
      if (thrown === null) thrown = error ?? new Error('Nieznany wyjątek');
    };
    const control: TxControl = {
      fail(error) {
        if (explicit === null) explicit = error;
        abort();
      },
      guard(fn) {
        return (...args) => {
          try {
            fn(...args);
          } catch (error) {
            recordThrown(error);
            abort();
          }
        };
      },
    };

    tx.oncomplete = () => {
      if (explicit !== null) {
        settle({ ok: false, error: explicit });
        return;
      }
      if (finalize === null) {
        settle({ ok: false, error: mapError(thrown ?? new Error('Transakcja bez wyniku')) });
        return;
      }
      try {
        settle({ ok: true, value: finalize() });
      } catch (error) {
        settle({ ok: false, error: mapError(error) });
      }
    };
    tx.onabort = () => {
      if (explicit !== null) {
        settle({ ok: false, error: explicit });
        return;
      }
      const cause = tx.error ?? thrown ?? new DOMException('Transakcja przerwana', 'AbortError');
      settle({ ok: false, error: mapError(cause) });
    };
    // Błąd pojedynczego żądania (bez `preventDefault`) przerywa całą transakcję → `onabort`.
    tx.onerror = () => undefined;

    try {
      finalize = body(tx, control);
    } catch (error) {
      recordThrown(error);
      abort();
    }
  });
}
