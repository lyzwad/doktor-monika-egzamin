/**
 * Schemat IndexedDB i wersjonowane migracje (DECYZJE §10; 03_ARCHITEKTURA §7).
 *
 * Każda migracja podnosi schemat o jedną wersję i działa WYŁĄCZNIE w transakcji `versionchange`
 * (`onupgradeneeded`), bez operacji asynchronicznych spoza IndexedDB. Błąd migracji przerywa
 * transakcję — baza zostaje w poprzedniej wersji z nietkniętymi danymi.
 *
 * Nowa wersja schematu = nowy wpis w `MIGRATIONS` + podniesienie `DB_SCHEMA_VERSION` w ./api.ts
 * + test migracji z poprzedniej wersji (tests/persistence).
 */
import { DB_SCHEMA_VERSION, STORE_KEY_PATHS, STORE_NAMES } from './api';
import type { StoreName } from './api';

/** Definicja indeksu: nazwa = ścieżka pola (nieunikalny, bez multiEntry). */
export interface IndexDefinition {
  name: string;
  keyPath: string;
}

/**
 * Indeksy schematu v1. Rekordy, w których pole indeksu jest `null`/boolean (niepoprawny klucz
 * IndexedDB), po prostu nie trafiają do indeksu — stąd kolejka błędów opiera się na `dueAt`
 * (`null` = brak aktywnego błędu), a nie na `activeError` (boolean nie jest kluczem).
 */
export const STORE_INDEXES_V1: Readonly<Record<StoreName, readonly IndexDefinition[]>> = Object.freeze({
  meta: [],
  settings: [],
  sessions: [
    { name: 'status', keyPath: 'status' },
    { name: 'createdAt', keyPath: 'createdAt' },
    { name: 'kind', keyPath: 'kind' },
  ],
  attempts: [
    { name: 'sessionId', keyPath: 'sessionId' },
    { name: 'questionId', keyPath: 'questionId' },
    { name: 'answeredAt', keyPath: 'answeredAt' },
  ],
  questionStats: [
    { name: 'dueAt', keyPath: 'dueAt' },
    { name: 'domainId', keyPath: 'domainId' },
    { name: 'familyId', keyPath: 'familyId' },
  ],
  blocks: [
    { name: 'fingerprint', keyPath: 'fingerprint' },
    { name: 'familyId', keyPath: 'familyId' },
    { name: 'questionId', keyPath: 'questionId' },
  ],
  events: [
    { name: 'at', keyPath: 'at' },
    { name: 'type', keyPath: 'type' },
    { name: 'sessionId', keyPath: 'sessionId' },
  ],
  packs: [{ name: 'importedAt', keyPath: 'importedAt' }],
  backups: [{ name: 'createdAt', keyPath: 'createdAt' }],
});

/** Jedna migracja schematu: `from = version − 1` → `version`. */
export interface Migration {
  version: number;
  description: string;
  /** Synchronicznie, w transakcji `versionchange`. Wyjątek = przerwanie migracji. */
  up(db: IDBDatabase, tx: IDBTransaction): void;
}

/** v1: wszystkie magazyny z kluczami głównymi i indeksami. */
const MIGRATION_V1: Migration = {
  version: 1,
  description: 'Magazyny meta, settings, sessions, attempts, questionStats, blocks, events, packs, backups + indeksy',
  up(db) {
    for (const name of STORE_NAMES) {
      const store = db.objectStoreNames.contains(name)
        ? null
        : db.createObjectStore(name, { keyPath: STORE_KEY_PATHS[name] });
      if (!store) continue;
      for (const index of STORE_INDEXES_V1[name]) {
        store.createIndex(index.name, index.keyPath, { unique: false, multiEntry: false });
      }
    }
  },
};

/** Lista migracji aplikacji (rosnąco po wersji). */
export const MIGRATIONS: readonly Migration[] = Object.freeze([MIGRATION_V1]);

/**
 * Migracje do wykonania przy przejściu `oldVersion → newVersion`. Rzuca, jeśli brakuje którejś
 * wersji pośredniej (błąd programisty, nie danych).
 */
export function migrationsBetween(
  migrations: readonly Migration[],
  oldVersion: number,
  newVersion: number,
): Migration[] {
  const byVersion = new Map(migrations.map((m) => [m.version, m]));
  const steps: Migration[] = [];
  for (let v = oldVersion + 1; v <= newVersion; v += 1) {
    const step = byVersion.get(v);
    if (!step) throw new Error(`Brak migracji schematu do wersji ${v}`);
    steps.push(step);
  }
  return steps;
}

/** Sprawdzenie spójności: migracje pokrywają wersje 1…DB_SCHEMA_VERSION. */
export function assertMigrationsComplete(migrations: readonly Migration[] = MIGRATIONS, target: number = DB_SCHEMA_VERSION): void {
  migrationsBetween(migrations, 0, target);
}
