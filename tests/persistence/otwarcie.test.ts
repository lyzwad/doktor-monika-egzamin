/**
 * Otwarcie bazy, migracje (v1 + szkielet kolejnych wersji) i ponowne otwarcie (DECYZJE §10).
 */
import { IDBFactory, forceCloseDatabase } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { emptyUserState } from '../../src/domain/state';
import { DB_SCHEMA_VERSION, STORE_KEY_PATHS, STORE_NAMES } from '../../src/persistence/api';
import type { MetaRecord } from '../../src/persistence/api';
import { MIGRATIONS, STORE_INDEXES_V1, assertMigrationsComplete, migrationsBetween } from '../../src/persistence/schema';
import type { Migration } from '../../src/persistence/schema';
import { createRepository } from '../../src/persistence/repository';
import { freshRepository, seededRepository } from './fixtures';

function rawOpen(factory: IDBFactory, name: string, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = version === undefined ? factory.open(name) : factory.open(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function rawGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

describe('otwarcie bazy i migracja v1', () => {
  it('tworzy wszystkie magazyny z kluczami głównymi, indeksy i rekord meta', async () => {
    const { repo, factory, dbName } = freshRepository();
    const opened = await repo.open();
    expect(opened).toEqual({ ok: true, value: { schemaVersion: DB_SCHEMA_VERSION, migratedFrom: null, created: true } });
    repo.close();

    const db = await rawOpen(factory, dbName);
    expect(db.version).toBe(DB_SCHEMA_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual([...STORE_NAMES].sort());
    const tx = db.transaction([...STORE_NAMES]);
    for (const name of STORE_NAMES) {
      const store = tx.objectStore(name);
      expect(store.keyPath).toBe(STORE_KEY_PATHS[name]);
      expect([...store.indexNames].sort()).toEqual(STORE_INDEXES_V1[name].map((i) => i.name).sort());
    }
    // Kolejka błędów: indeks po `dueAt` (boolean nie jest kluczem IndexedDB), blokady po fingerprincie i rodzinie.
    expect(tx.objectStore('questionStats').index('dueAt').keyPath).toBe('dueAt');
    expect(tx.objectStore('blocks').index('fingerprint').keyPath).toBe('fingerprint');
    expect(tx.objectStore('blocks').index('familyId').keyPath).toBe('familyId');
    expect(tx.objectStore('sessions').index('status').keyPath).toBe('status');
    expect(tx.objectStore('sessions').index('createdAt').keyPath).toBe('createdAt');
    const meta = await rawGet<MetaRecord>(db, 'meta', 'schema');
    expect(meta).toEqual({
      key: 'schema',
      schemaVersion: DB_SCHEMA_VERSION,
      createdAt: '2026-10-22T10:00:00.000Z',
      migratedAt: null,
      appVersion: 'test',
    });
    db.close();
  });

  it('pierwsze uruchomienie: pusty stan użytkowniczki z domyślnymi ustawieniami', async () => {
    const { repo } = freshRepository();
    const loaded = await repo.loadUserState();
    expect(loaded).toEqual({ ok: true, value: emptyUserState() });
    repo.close();
  });

  it('wielokrotne open() jest bezpieczne; ponowne otwarcie zachowuje dane i nie migruje', async () => {
    const { repo, factory, dbName, data } = await seededRepository();
    const again = await repo.open();
    expect(again.ok).toBe(true);
    const before = await repo.loadUserState();
    repo.close();

    const reopened = createRepository({ indexedDB: factory, dbName, storageManager: null });
    const info = await reopened.open();
    expect(info).toEqual({ ok: true, value: { schemaVersion: DB_SCHEMA_VERSION, migratedFrom: null, created: false } });
    const after = await reopened.loadUserState();
    expect(after).toEqual(before);
    if (!after.ok) throw new Error('load');
    expect(Object.keys(after.value.sessions).sort()).toEqual(data.sessions.map((s) => s.id).sort());
    expect(Object.keys(after.value.attempts)).toHaveLength(data.attempts.length);
    reopened.close();
  });

  it('operacje otwierają bazę automatycznie; po close() kolejna operacja łączy się ponownie', async () => {
    const { repo } = freshRepository();
    const first = await repo.loadUserState();
    expect(first.ok).toBe(true);
    repo.close();
    const again = await repo.loadUserState();
    expect(again).toEqual(first);
    repo.close();
  });

  it('utrata połączenia (forceCloseDatabase) — kolejna operacja otwiera bazę ponownie', async () => {
    const factory = new IDBFactory();
    const dbName = 'dme-force-close';
    let captured: IDBDatabase | null = null;
    const proxyFactory = {
      open(name: string, version?: number) {
        const request = factory.open(name, version);
        request.addEventListener('success', () => {
          captured = request.result;
        });
        return request;
      },
      deleteDatabase: factory.deleteDatabase.bind(factory),
      databases: factory.databases.bind(factory),
      cmp: factory.cmp.bind(factory),
    } as unknown as IDBFactory;
    const repo = createRepository({ indexedDB: proxyFactory, dbName, storageManager: null });
    expect((await repo.open()).ok).toBe(true);
    expect(captured).not.toBeNull();
    forceCloseDatabase(captured as unknown as typeof IDBDatabase);
    const loaded = await repo.loadUserState();
    expect(loaded.ok).toBe(true);
    repo.close();
  });

  it('migracje pokrywają wersje 1…DB_SCHEMA_VERSION', () => {
    expect(() => assertMigrationsComplete()).not.toThrow();
    expect(MIGRATIONS.map((m) => m.version)).toEqual(Array.from({ length: DB_SCHEMA_VERSION }, (_, i) => i + 1));
    expect(() => migrationsBetween(MIGRATIONS, 0, DB_SCHEMA_VERSION + 1)).toThrow(/Brak migracji/);
  });
});

describe('migracja do kolejnej wersji (szkielet wersjonowania)', () => {
  const v3: Migration = {
    version: 3,
    description: 'test: indeks attempts.domainId',
    up(_db, tx) {
      tx.objectStore('attempts').createIndex('domainId', 'domainId');
    },
  };

  it('v2 → v3 zachowuje dane, zapisuje migratedFrom i migratedAt', async () => {
    const { repo, factory, dbName } = await seededRepository();
    const before = await repo.loadUserState();
    repo.close();

    const { repo: upgraded } = freshRepository({
      indexedDB: factory,
      dbName,
      schemaVersion: 3,
      migrations: [...MIGRATIONS, v3],
      now: () => '2026-11-01T09:00:00.000Z',
    });
    const info = await upgraded.open();
    expect(info).toEqual({ ok: true, value: { schemaVersion: 3, migratedFrom: 2, created: false } });
    expect(await upgraded.loadUserState()).toEqual(before);
    upgraded.close();

    const db = await rawOpen(factory, dbName);
    expect(db.version).toBe(3);
    expect([...db.transaction('attempts').objectStore('attempts').indexNames]).toContain('domainId');
    const meta = await rawGet<MetaRecord>(db, 'meta', 'schema');
    expect(meta).toMatchObject({ schemaVersion: 3, createdAt: '2026-10-22T10:00:00.000Z', migratedAt: '2026-11-01T09:00:00.000Z' });
    db.close();
  });

  it('błąd migracji → MigrationFailed; baza zostaje w v2 z nietkniętymi danymi', async () => {
    const { repo, factory, dbName } = await seededRepository();
    const before = await repo.loadUserState();
    repo.close();

    const broken: Migration = {
      version: 3,
      description: 'test: migracja z błędem w połowie',
      up(db) {
        db.deleteObjectStore('attempts');
        throw new Error('awaria migracji');
      },
    };
    const { repo: failing } = freshRepository({ indexedDB: factory, dbName, schemaVersion: 3, migrations: [...MIGRATIONS, broken] });
    const info = await failing.open();
    expect(info.ok).toBe(false);
    if (info.ok) return;
    expect(info.error.code).toBe('MigrationFailed');
    expect(info.error.messagePl).toMatch(/nie zostały usunięte/);
    failing.close();

    const db = await rawOpen(factory, dbName);
    expect(db.version).toBe(2);
    expect([...db.objectStoreNames]).toContain('attempts');
    db.close();
    const { repo: v2r } = freshRepository({ indexedDB: factory, dbName });
    expect(await v2r.loadUserState()).toEqual(before);
    v2r.close();
  });

  it('baza z nowszej wersji aplikacji → Unavailable z komunikatem o odświeżeniu (bez zmian danych)', async () => {
    const { repo, factory, dbName } = await seededRepository();
    repo.close();
    const { repo: newer } = freshRepository({ indexedDB: factory, dbName, schemaVersion: 3, migrations: [...MIGRATIONS, v3] });
    expect((await newer.open()).ok).toBe(true);
    newer.close();

    const { repo: older } = freshRepository({ indexedDB: factory, dbName });
    const info = await older.open();
    expect(info.ok).toBe(false);
    if (info.ok) return;
    expect(info.error.code).toBe('Unavailable');
    expect(info.error.messagePl).toMatch(/nowsza wersja aplikacji/);
    const load = await older.loadUserState();
    expect(load.ok).toBe(false);
  });

  it('inna karta blokuje podniesienie wersji → Blocked; po jej zamknięciu ponowne open() działa', async () => {
    const { repo, factory, dbName } = await seededRepository();
    repo.close();
    const otherTab = await rawOpen(factory, dbName);
    // Starsza karta nie reaguje na versionchange (nie zamyka połączenia).
    otherTab.onversionchange = () => undefined;
    const { repo: upgrading } = freshRepository({ indexedDB: factory, dbName, schemaVersion: 3, migrations: [...MIGRATIONS, v3] });
    const blocked = await upgrading.open();
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.code).toBe('Blocked');
    otherTab.close();
    await new Promise((r) => setTimeout(r, 20));
    const retry = await upgrading.open();
    expect(retry.ok).toBe(true);
    upgrading.close();
  });

  it('brak IndexedDB → Unavailable z komunikatem PL', async () => {
    const original = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    try {
      Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true, writable: true });
      const missing = createRepository({ dbName: 'brak', storageManager: null });
      const info = await missing.open();
      expect(info.ok).toBe(false);
      if (info.ok) return;
      expect(info.error.code).toBe('Unavailable');
      expect(info.error.messagePl).toMatch(/IndexedDB/);
      const load = await missing.loadUserState();
      expect(load.ok).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', { value: original, configurable: true, writable: true });
    }
  });
});
