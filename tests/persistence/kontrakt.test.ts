/**
 * Kontrakt trwałości: stałe schematu i działanie środowiska testowego IndexedDB (fake-indexeddb).
 * Testy implementacji repozytorium dopisuje agent trwałości.
 */
import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT_VERSION, BACKUP_MAX_BYTES, DB_SCHEMA_VERSION, STORE_KEY_PATHS, STORE_NAMES } from '../../src/persistence/api';
import { USER_STORE_NAMES } from '../../src/domain/types';

describe('schemat magazynów (DECYZJE §10)', () => {
  it('obejmuje wszystkie magazyny z decyzji i ma klucz główny dla każdego', () => {
    expect([...STORE_NAMES].sort()).toEqual(
      ['attempts', 'backups', 'blocks', 'events', 'meta', 'packs', 'questionStats', 'sessions', 'settings'].sort(),
    );
    for (const name of STORE_NAMES) expect(STORE_KEY_PATHS[name]).toMatch(/^\w+$/);
  });

  it('magazyny changesetu domeny są podzbiorem magazynów bazy', () => {
    for (const name of USER_STORE_NAMES) expect(STORE_NAMES).toContain(name);
  });

  it('wersje i limity', () => {
    expect(DB_SCHEMA_VERSION).toBe(2);
    expect(BACKUP_FORMAT_VERSION).toBe(1);
    expect(BACKUP_MAX_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe('środowisko testowe IndexedDB', () => {
  it('fake-indexeddb udostępnia indexedDB z transakcją obejmującą kilka magazynów', async () => {
    const dbName = `kontrakt-${Math.random().toString(36).slice(2)}`;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        for (const name of STORE_NAMES) req.result.createObjectStore(name, { keyPath: STORE_KEY_PATHS[name] });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['sessions', 'blocks'], 'readwrite');
      tx.objectStore('sessions').put({ id: 's1', revision: 1 });
      tx.objectStore('blocks').put({ id: 'b1', revokedAt: null });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const value = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction('sessions').objectStore('sessions').get('s1');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect(value).toEqual({ id: 's1', revision: 1 });
    db.close();
  });
});
