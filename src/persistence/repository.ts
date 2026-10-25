/**
 * Repozytorium IndexedDB (kontrakt: ./api.ts; DECYZJE §1, §10; 03_ARCHITEKTURA §7).
 *
 * - `open` — wersjonowane otwarcie z migracjami (./schema.ts), automatycznie przy pierwszej operacji.
 * - `commit` — changeset domeny w JEDNEJ transakcji readwrite: najpierw `guards` (rewizja sesji),
 *   potem `put`/`delete`; sukces dopiero po `oncomplete`; błąd = brak jakiejkolwiek zmiany.
 * - kopia — eksport (./backup.ts), walidacja bez zmiany danych, zamiana wszystkich danych w jednej
 *   transakcji razem z zapisem automatycznej kopii bieżącego stanu do `backups`.
 * - od V15 brak importu paczek pytań; zapis sesji innej wersji treści (nie-`legacy`) jest odrzucany.
 *
 * W transakcjach nie ma `await` na operacjach spoza IndexedDB: Web Crypto (fingerprinty) i odczyt
 * plików wykonują się PRZED transakcją, a JSON kopii bezpieczeństwa powstaje synchronicznie w callbacku.
 */
import { CONTENT_RELEASE } from '../domain/contentRelease';
import { defaultSettings, isChangesetEmpty } from '../domain/state';
import { USER_STORE_NAMES } from '../domain/types';
import type { Changeset, Session, UserState, UserStoreName } from '../domain/types';
import { DB_NAME, DB_SCHEMA_VERSION } from './api';
import type {
  BackupData,
  BackupRecord,
  BackupRecordInfo,
  CommitInfo,
  ContentMetaRecord,
  MigrationMetaRecord,
  CreateRepository,
  ExportBackupInput,
  ExportedFile,
  MergeInfo,
  MergeMetaRecord,
  MergeUnassignedInput,
  OpenInfo,
  OwnerMetaRecord,
  PersistenceError,
  PersistenceResult,
  ReplaceFromBackupInput,
  ReplaceInfo,
  Repository,
  RepositoryOptions,
  StoreName,
  ValidatedBackup,
} from './api';
import {
  BACKUP_DATA_STORES,
  backupFileName,
  buildBackupFile,
  isRegisteredValidatedBackup,
  parseBackup,
  serializeBackupFile,
  summarizeBackup,
  toExportedFile,
  validateBackupJson,
} from './backup';
import {
  conflict,
  errorName,
  fail,
  mapReadError,
  mapWriteError,
  notFound,
  ok,
  ownerMismatch,
  unavailable,
  writeFailed,
  MSG_NO_INDEXEDDB,
} from './errors';
import { createTransaction, openDatabase, runTransaction } from './idb';
import type { TxBody, TxControl } from './idb';
import { MIGRATIONS } from './schema';
import type { Migration } from './schema';
import { createStorageApi, defaultStorageManager } from './storage';
import { isIsoDateTime, isNonEmptyString, isObject } from './validation';
import { transformToV15, V15_MIGRATION_ID } from './v15Migration';
import { planUnassignedMerge } from './merge';
import type { StoreRecords } from './merge';

/** Ile automatycznych kopii bezpieczeństwa (sprzed wczytania) przechowywać — najstarsze są usuwane. */
export const SAFETY_BACKUPS_KEPT = 5;

/** Opcje wewnętrzne (testy migracji): wersja docelowa i lista migracji. */
export interface InternalRepositoryOptions extends RepositoryOptions {
  schemaVersion?: number;
  migrations?: readonly Migration[];
}

const USER_STORES: readonly UserStoreName[] = USER_STORE_NAMES;

/* ========================================================================== */
/* Changeset                                                                  */
/* ========================================================================== */

/** Komunikat odrzuconego zapisu sesji innej wersji treści. */
export const MSG_STALE_CONTENT_WRITE =
  'Odrzucono zapis sesji z poprzedniej wersji banku pytań. Aplikacja używa wyłącznie banku V15 — uruchom ją ponownie.';

/**
 * (d) Ochrona przed opóźnionymi zapisami: sesja innej wersji treści (i nie-`legacy`) albo ze snapshotem
 * innej wersji nie może zostać zapisana.
 */
function staleContentSession(changeset: Changeset, contentBankVersion: string): Session | null {
  for (const session of changeset.stores.sessions?.put ?? []) {
    if (!isObject(session)) continue;
    if (session.legacy) {
      if (session.status === 'open' || Object.keys(isObject(session.slots) ? session.slots : {}).length > 0) return session;
      continue;
    }
    if (session.bankVersion !== contentBankVersion) return session;
    for (const slot of Object.values(isObject(session.slots) ? session.slots : {})) {
      if (!isObject(slot) || !isObject(slot.snapshot) || slot.snapshot.bankVersion !== contentBankVersion) return session;
    }
  }
  return null;
}

/** Kontrola kształtu changesetu przed otwarciem transakcji (błąd programisty → `WriteFailed`). */
function checkChangeset(changeset: Changeset, allowDeletes: boolean): PersistenceError | null {
  if (!isObject(changeset) || !isObject(changeset.stores) || !Array.isArray(changeset.guards)) {
    return writeFailed(new Error('Niepoprawny changeset'));
  }
  for (const [name, change] of Object.entries(changeset.stores)) {
    if (change === undefined) continue;
    if (!(USER_STORES as readonly string[]).includes(name)) {
      return writeFailed(new Error(`Changeset dotyczy magazynu spoza danych użytkownika: ${name}`));
    }
    if (!isObject(change) || !Array.isArray(change.put) || !Array.isArray(change.delete)) {
      return writeFailed(new Error(`Niepoprawne zmiany magazynu ${name}`));
    }
    if (!allowDeletes && change.delete.length > 0) {
      return writeFailed(new Error('Import puli nie może usuwać danych użytkownika'));
    }
  }
  for (const guard of changeset.guards) {
    if (!isObject(guard) || !isNonEmptyString(guard.sessionId)) return writeFailed(new Error('Niepoprawny warunek rewizji'));
  }
  return null;
}

function changesetStores(changeset: Changeset): StoreName[] {
  const stores = new Set<StoreName>();
  for (const name of USER_STORES) {
    const change = changeset.stores[name];
    if (change && (change.put.length > 0 || change.delete.length > 0)) stores.add(name);
  }
  if (changeset.guards.length > 0) stores.add('sessions');
  return [...stores];
}

/**
 * Wydaje żądania changesetu w otwartej transakcji: najpierw odczyt sesji z `guards`, a dopiero
 * po pozytywnej weryfikacji wszystkich — zapisy. `beforeWrites` (np. zapis paczki) wykonuje się
 * w tej samej transakcji, po weryfikacji.
 */
function applyChangeset(tx: IDBTransaction, control: TxControl, changeset: Changeset, beforeWrites?: () => void): () => CommitInfo {
  let written = 0;
  let deleted = 0;
  const writeAll = (): void => {
    beforeWrites?.();
    for (const name of USER_STORES) {
      const change = changeset.stores[name];
      if (!change || (change.put.length === 0 && change.delete.length === 0)) continue;
      const store = tx.objectStore(name);
      for (const record of change.put) {
        store.put(record);
        written += 1;
      }
      for (const key of change.delete) {
        store.delete(key);
        deleted += 1;
      }
    }
  };
  if (changeset.guards.length === 0) {
    writeAll();
  } else {
    const sessions = tx.objectStore('sessions');
    let pending = changeset.guards.length;
    for (const guard of changeset.guards) {
      const request = sessions.get(guard.sessionId);
      request.onsuccess = control.guard(() => {
        const current = request.result as Session | undefined;
        const satisfied =
          guard.expectedRevision === null ? current === undefined : current !== undefined && current.revision === guard.expectedRevision;
        if (!satisfied) {
          control.fail(conflict(guard.sessionId));
          return;
        }
        pending -= 1;
        if (pending === 0) writeAll();
      });
    }
  }
  return () => ({ written, deleted });
}

/* ========================================================================== */
/* Odczyty                                                                    */
/* ========================================================================== */

function readStores<K extends StoreName>(tx: IDBTransaction, control: TxControl, stores: readonly K[], done?: (values: Record<K, unknown[]>) => void): Record<K, unknown[]> {
  const values = {} as Record<K, unknown[]>;
  let pending = stores.length;
  for (const name of stores) {
    const request = tx.objectStore(name).getAll();
    request.onsuccess = control.guard(() => {
      values[name] = request.result as unknown[];
      pending -= 1;
      if (pending === 0) done?.(values);
    });
  }
  return values;
}

function toUserState(values: Record<UserStoreName, unknown[]>): UserState {
  const byKey = <T>(records: unknown[], key: (r: T) => string): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const record of records as T[]) out[key(record)] = record;
    return out;
  };
  const settings = (values.settings as UserState['settings'][]).find((s) => s.id === 'settings');
  return {
    settings: settings ?? defaultSettings(),
    sessions: byKey<Session>(values.sessions, (s) => s.id),
    attempts: byKey<UserState['attempts'][string]>(values.attempts, (a) => a.id),
    questionStats: byKey<UserState['questionStats'][string]>(values.questionStats, (s) => s.questionId),
    blocks: byKey<UserState['blocks'][string]>(values.blocks, (b) => b.id),
    events: byKey<UserState['events'][string]>(values.events, (e) => e.id),
  };
}

function toBackupData(values: Record<(typeof BACKUP_DATA_STORES)[number], unknown[]>): BackupData {
  return {
    settings: values.settings as BackupData['settings'],
    sessions: values.sessions as BackupData['sessions'],
    attempts: values.attempts as BackupData['attempts'],
    questionStats: values.questionStats as BackupData['questionStats'],
    blocks: values.blocks as BackupData['blocks'],
    events: values.events as BackupData['events'],
    packs: values.packs as BackupData['packs'],
  };
}

function backupInfo(record: BackupRecord): BackupRecordInfo {
  return {
    id: record.id,
    createdAt: record.createdAt,
    reason: record.reason,
    fileName: record.fileName,
    sizeBytes: record.sizeBytes,
  };
}

/* ========================================================================== */
/* Repozytorium                                                               */
/* ========================================================================== */

export function createIndexedDbRepository(options: InternalRepositoryOptions = {}): Repository {
  const dbName = options.dbName ?? DB_NAME;
  const factory: IDBFactory | null = options.indexedDB ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB ?? null;
  const schemaVersion = options.schemaVersion ?? DB_SCHEMA_VERSION;
  const migrations = options.migrations ?? MIGRATIONS;
  const now = options.now ?? (() => new Date().toISOString());
  const appVersion = options.appVersion ?? 'nieznana';
  const contentBankVersion = options.contentBankVersion ?? CONTENT_RELEASE.bankVersion;
  /** Właściciel bazy profilu (DECYZJE §16); `undefined` — baza bez kontroli właściciela. */
  const owner = options.owner;
  let upgradeListener: ((info: { from: number; to: number }) => void) | null = null;
  const storage = createStorageApi(options.storageManager === undefined ? defaultStorageManager() : options.storageManager);

  let db: IDBDatabase | null = null;
  let openInfo: OpenInfo | null = null;
  let opening: Promise<PersistenceResult<OpenInfo>> | null = null;

  const dropConnection = (): void => {
    if (db) {
      try {
        db.close();
      } catch {
        /* już zamknięte */
      }
    }
    db = null;
  };

  const open = (): Promise<PersistenceResult<OpenInfo>> => {
    if (db && openInfo) return Promise.resolve(ok(openInfo));
    if (opening) return opening;
    if (!factory) return Promise.resolve(fail(unavailable(undefined, MSG_NO_INDEXEDDB)));
    opening = openDatabase({
      factory,
      name: dbName,
      version: schemaVersion,
      migrations,
      now,
      appVersion,
      onConnectionLost: (lost) => {
        if (db === lost) db = null;
      },
      onUpgradeStart: (info) => upgradeListener?.(info),
    }).then(async (result) => {
      if (!result.ok) {
        opening = null;
        return result;
      }
      const connection = result.value.db;
      if (owner !== undefined) {
        const claimed = await claimOwner(connection);
        if (!claimed.ok) {
          opening = null;
          try {
            connection.close();
          } catch {
            /* już zamknięte */
          }
          return claimed;
        }
      }
      opening = null;
      db = connection;
      openInfo = result.value.info;
      return ok(openInfo);
    });
    return opening;
  };

  /** Pusta baza profilu: zapis właściciela; istniejąca: sprawdzenie, że należy do tego profilu. */
  const claimOwner = (connection: IDBDatabase): Promise<PersistenceResult<void>> => {
    const expected = owner as string;
    let tx: IDBTransaction;
    try {
      tx = createTransaction(connection, ['meta'], 'readwrite');
    } catch (error) {
      return Promise.resolve(fail(mapWriteError(error)));
    }
    return runTransaction(tx, (t, control) => {
      const store = t.objectStore('meta');
      const request = store.get('owner');
      request.onsuccess = control.guard(() => {
        const found = request.result as OwnerMetaRecord | undefined;
        if (found === undefined) {
          const record: OwnerMetaRecord = { key: 'owner', email: expected, since: now() };
          store.put(record);
        } else if (found.email !== expected) {
          control.fail(ownerMismatch(expected, found.email ?? null));
        }
      });
      return () => undefined;
    }, mapWriteError);
  };

  /**
   * Transakcja na bieżącym połączeniu. Jeśli połączenie zostało utracone (np. Safari po powrocie
   * z tła), jedno ponowne otwarcie przed wydaniem jakiegokolwiek żądania.
   */
  const withTransaction = async <T>(
    stores: readonly StoreName[],
    mode: IDBTransactionMode,
    body: TxBody<T>,
    mapError: (error: unknown) => PersistenceError,
  ): Promise<PersistenceResult<T>> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const opened = await open();
      if (!opened.ok) return opened;
      const connection = db;
      if (!connection) continue;
      const guarded = owner !== undefined && mode === 'readwrite';
      let tx: IDBTransaction;
      try {
        tx = createTransaction(connection, guarded ? [...stores, 'meta'] : stores, mode);
      } catch (error) {
        if (attempt === 0 && errorName(error) === 'InvalidStateError') {
          dropConnection();
          continue;
        }
        return fail(mapError(error));
      }
      let failureName: string | null = null;
      const result = await runTransaction(tx, guarded ? ownerGuarded(body) : body, (error) => {
        failureName = errorName(error);
        return mapError(error);
      });
      // Utracone połączenie (np. WebKit po powrocie z tła): kolejna operacja — w tym „Spróbuj zapisać
      // ponownie” — otworzy bazę od nowa zamiast używać martwego połączenia.
      if (!result.ok && (failureName === 'UnknownError' || failureName === 'InvalidStateError') && db === connection) dropConnection();
      return result;
    }
    return fail(unavailable());
  };

  /**
   * Ciało transakcji zapisu poprzedzone sprawdzeniem właściciela w TEJ SAMEJ transakcji: zapis wydawany jest
   * dopiero po potwierdzeniu, że baza należy do profilu repozytorium (inaczej przerwanie, brak zmian).
   */
  const ownerGuarded = <T>(body: TxBody<T>): TxBody<T> => (tx, control) => {
    let finalize: (() => T) | null = null;
    const request = tx.objectStore('meta').get('owner');
    request.onsuccess = control.guard(() => {
      const found = request.result as OwnerMetaRecord | undefined;
      if (found?.email !== owner) {
        control.fail(ownerMismatch(owner as string, found?.email ?? null));
        return;
      }
      finalize = body(tx, control);
    });
    return () => {
      if (finalize === null) throw new Error('Transakcja bez sprawdzenia właściciela');
      return finalize();
    };
  };

  const readBackupData = (): Promise<PersistenceResult<BackupData>> =>
    withTransaction(BACKUP_DATA_STORES, 'readonly', (tx, control) => {
      const values = readStores(tx, control, BACKUP_DATA_STORES);
      return () => toBackupData(values);
    }, mapReadError);

  const repository: Repository = {
    open,

    async loadUserState() {
      return withTransaction(USER_STORES, 'readonly', (tx, control) => {
        const values = readStores(tx, control, USER_STORES);
        return () => toUserState(values);
      }, mapReadError);
    },

    async commit(changeset) {
      const invalid = checkChangeset(changeset, true);
      if (invalid) return fail(invalid);
      const stale = staleContentSession(changeset, contentBankVersion);
      if (stale) return fail(writeFailed(new Error(`Sesja ${String(stale.id)}: wersja treści ${String(stale.bankVersion)}`), MSG_STALE_CONTENT_WRITE));
      if (isChangesetEmpty(changeset)) return ok({ written: 0, deleted: 0 });
      return withTransaction(changesetStores(changeset), 'readwrite', (tx, control) => applyChangeset(tx, control, changeset), mapWriteError);
    },

    async exportBackup(input: ExportBackupInput): Promise<PersistenceResult<ExportedFile>> {
      const data = await readBackupData();
      if (!data.ok) return data;
      try {
        // (e) Eksport nigdy nie zawiera treści innej wersji banku: ta sama transformacja co migracja
        // (idempotentna — dane po migracji przechodzą bez zmian), bez paczek.
        const t = transformToV15(data.value, input.now);
        const file = buildBackupFile(
          { ...data.value, sessions: t.sessions, attempts: t.attempts, questionStats: t.questionStats, blocks: t.blocks, events: t.events, packs: [] },
          { ...input, profileEmail: owner ?? input.profileEmail ?? null },
        );
        const { text, sizeBytes } = serializeBackupFile(file);
        return ok(toExportedFile(backupFileName('dme-kopia', input.now), text, sizeBytes));
      } catch (error) {
        return fail(writeFailed(error, 'Nie udało się przygotować pliku kopii. Spróbuj ponownie.'));
      }
    },

    parseAndValidateBackup(input, fileName) {
      return parseBackup(input, fileName, now());
    },

    async replaceAllFromBackup(validated: ValidatedBackup, input: ReplaceFromBackupInput): Promise<PersistenceResult<ReplaceInfo>> {
      if (!isNonEmptyString(input.safetyBackupId) || !isIsoDateTime(input.now)) {
        return fail(writeFailed(new Error('Niepoprawne dane automatycznej kopii bezpieczeństwa')));
      }
      let backup = isObject(validated) ? validated.backup : null;
      let summary = isObject(validated) ? validated.summary : null;
      // Obiekt spoza `parseAndValidateBackup` (np. sklonowany) — pełna walidacja ponownie, przed transakcją.
      if (!isObject(validated) || validated.kind !== 'validated-backup' || !isRegisteredValidatedBackup(validated) || !backup || !summary) {
        const recheck = await validateBackupJson(backup, isObject(validated) && typeof validated.fileName === 'string' ? validated.fileName : 'kopia.json');
        if (!recheck.ok) return recheck;
        backup = recheck.value;
        summary = summarizeBackup(backup);
      }
      const incoming = backup.data;
      const incomingSummary = summary;
      const safetyFileName = backupFileName('dme-przed-wczytaniem', input.now);
      let safetyInfo: BackupRecordInfo | null = null;

      return withTransaction([...BACKUP_DATA_STORES, 'backups'], 'readwrite', (tx, control) => {
        readStores(tx, control, BACKUP_DATA_STORES, (current) => {
          // 1. Automatyczna kopia bieżącego stanu (w tej samej transakcji — dokładnie stan sprzed zamiany).
          const safetyFile = buildBackupFile(toBackupData(current), {
            now: input.now,
            appVersion: input.appVersion,
            bankVersions: input.bankVersions,
            profileEmail: owner ?? null,
          });
          const { text, sizeBytes } = serializeBackupFile(safetyFile);
          const record: BackupRecord = {
            id: input.safetyBackupId,
            createdAt: input.now,
            reason: 'before_restore',
            fileName: safetyFileName,
            sizeBytes,
            json: text,
          };
          const backups = tx.objectStore('backups');
          backups.put(record);
          safetyInfo = backupInfo(record);
          // Retencja: najnowsze SAFETY_BACKUPS_KEPT kopii (nigdy bieżąca).
          const keys = backups.index('createdAt').getAllKeys();
          keys.onsuccess = control.guard(() => {
            const ordered = (keys.result as IDBValidKey[]).filter((key) => key !== input.safetyBackupId);
            const excess = ordered.length - (SAFETY_BACKUPS_KEPT - 1);
            for (let i = 0; i < excess; i += 1) backups.delete(ordered[i] as IDBValidKey);
          });
          // 2. Zamiana wszystkich danych użytkownika; paczki pytań nie są przywracane (wyłącznie bank V15).
          for (const name of BACKUP_DATA_STORES) {
            const store = tx.objectStore(name);
            store.clear();
            if (name === 'packs') continue;
            for (const value of incoming[name] as unknown[]) store.put(value);
          }
        });
        return () => {
          if (safetyInfo === null) throw new Error('Brak automatycznej kopii bezpieczeństwa');
          return { safetyBackup: safetyInfo, summary: incomingSummary };
        };
      }, mapWriteError);
    },

    async mergeUnassignedHistory(source: UserState, input: MergeUnassignedInput): Promise<PersistenceResult<MergeInfo>> {
      if (!isNonEmptyString(input.mergeId) || !isNonEmptyString(input.safetyBackupId) || !isIsoDateTime(input.now)) {
        return fail(writeFailed(new Error('Niepoprawne dane przypisania historii')));
      }
      let info: MergeInfo | null = null;
      return withTransaction([...BACKUP_DATA_STORES, 'backups', 'meta'], 'readwrite', (tx, control) => {
        const meta = tx.objectStore('meta');
        const marker = meta.get('merge:unassigned');
        marker.onsuccess = control.guard(() => {
          const done = marker.result as MergeMetaRecord | undefined;
          if (done !== undefined) {
            info = { alreadyMerged: true, counts: done.counts };
            return;
          }
          readStores(tx, control, BACKUP_DATA_STORES, (current) => {
            const plan = planUnassignedMerge(current as unknown as StoreRecords, source);
            // Kopia bezpieczeństwa stanu profilu sprzed przypisania (tylko gdy profil ma już dane).
            const hasData = USER_STORES.some((name) => name !== 'settings' && current[name].length > 0);
            const backups = tx.objectStore('backups');
            if (hasData) {
              const safetyFile = buildBackupFile(toBackupData(current), {
                now: input.now,
                appVersion: input.appVersion,
                bankVersions: input.bankVersions,
                profileEmail: owner ?? null,
              });
              const { text, sizeBytes } = serializeBackupFile(safetyFile);
              const record: BackupRecord = {
                id: input.safetyBackupId,
                createdAt: input.now,
                reason: 'before_assign',
                fileName: backupFileName('dme-przed-wczytaniem', input.now),
                sizeBytes,
                json: text,
              };
              backups.put(record);
            }
            for (const name of USER_STORES) {
              const records = plan.puts[name];
              if (!records || records.length === 0) continue;
              const store = tx.objectStore(name);
              for (const record of records) store.put(record);
            }
            const record: MergeMetaRecord = { key: 'merge:unassigned', mergeId: input.mergeId, mergedAt: input.now, sourceDb: input.sourceDb, counts: plan.counts };
            meta.put(record);
            info = { alreadyMerged: false, counts: plan.counts };
          });
        });
        return () => {
          if (info === null) throw new Error('Przypisanie bez wyniku');
          return info;
        };
      }, mapWriteError);
    },

    async readOwner() {
      return withTransaction(['meta'], 'readonly', (tx, control) => {
        let email: string | null = null;
        const request = tx.objectStore('meta').get('owner');
        request.onsuccess = control.guard(() => {
          email = (request.result as OwnerMetaRecord | undefined)?.email ?? null;
        });
        return () => email;
      }, mapReadError);
    },

    async listBackups() {
      return withTransaction(['backups'], 'readonly', (tx, control) => {
        const values = readStores(tx, control, ['backups'] as const);
        return () =>
          (values.backups as BackupRecord[])
            .map(backupInfo)
            .sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : Date.parse(b.createdAt) - Date.parse(a.createdAt)));
      }, mapReadError);
    },

    async getBackupFile(id) {
      const result = await withTransaction(['backups'], 'readonly', (tx, control) => {
        let found: BackupRecord | undefined;
        const request = tx.objectStore('backups').get(id);
        request.onsuccess = control.guard(() => {
          found = request.result as BackupRecord | undefined;
        });
        return () => found ?? null;
      }, mapReadError);
      if (!result.ok) return result;
      if (result.value === null) return fail(notFound('Nie znaleziono kopii bezpieczeństwa — mogła zostać już usunięta.'));
      const record = result.value;
      return ok(toExportedFile(record.fileName, record.json, record.sizeBytes));
    },

    async readContentMeta() {
      return withTransaction(['meta'], 'readonly', (tx, control) => {
        let content: ContentMetaRecord | null = null;
        let migration: MigrationMetaRecord | null = null;
        const store = tx.objectStore('meta');
        const a = store.get('content');
        a.onsuccess = control.guard(() => {
          content = (a.result as ContentMetaRecord | undefined) ?? null;
        });
        const b = store.get(`migration:${V15_MIGRATION_ID}`);
        b.onsuccess = control.guard(() => {
          migration = (b.result as MigrationMetaRecord | undefined) ?? null;
        });
        return () => ({ content, migration });
      }, mapReadError);
    },

    setUpgradeListener(listener) {
      upgradeListener = listener;
    },

    storage,

    close() {
      dropConnection();
      openInfo = null;
    },
  };
  return repository;
}

/** Tworzy repozytorium IndexedDB (`DB_NAME`, `DB_SCHEMA_VERSION`). */
export const createRepository: CreateRepository = (options?: RepositoryOptions): Repository => createIndexedDbRepository(options);
