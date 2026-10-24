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
import { CONTENT_RELEASE } from '../domain/contentRelease';
import { DB_SCHEMA_VERSION, STORE_KEY_PATHS, STORE_NAMES } from './api';
import type { ContentMetaRecord, MigrationMetaRecord, StoreName } from './api';
import { transformToV15, V15_MIGRATION_ID } from './v15Migration';

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

/** Kontekst migracji (czas i wersja aplikacji z repozytorium). */
export interface MigrationContext {
  now: string;
  appVersion: string;
  /** Wersja bazy przed otwarciem (0 = nowa baza). */
  oldVersion: number;
  /**
   * Przerwanie migracji z przyczyną (wyjątek w callbacku żądania). Wywołanie = `tx.abort()`, baza zostaje
   * w poprzedniej wersji z nietkniętymi danymi.
   */
  abort(error: unknown): void;
}

/** Jedna migracja schematu: `from = version − 1` → `version`. */
export interface Migration {
  version: number;
  description: string;
  /**
   * W transakcji `versionchange`: wyłącznie żądania IndexedDB i kod synchroniczny (także w callbackach
   * żądań — opakowanych tak, by wyjątek przerywał transakcję). Wyjątek = przerwanie migracji.
   */
  up(db: IDBDatabase, tx: IDBTransaction, ctx: MigrationContext): void;
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

/** Opcje migracji v2 (testy: wymuszone przerwanie w środku transformacji). */
export interface MigrationV2Options {
  /** Test: wyjątek po zapisie wskazanego magazynu (dane częściowo nadpisane w transakcji → abort). */
  faultAfterStore?: 'sessions' | 'attempts' | 'questionStats' | 'blocks';
}

const V2_STORES = ['sessions', 'attempts', 'questionStats', 'blocks', 'events', 'packs'] as const;

/**
 * v2: pełna podmiana treści na bank V15 (docs/MIGRACJA_V15.md). W JEDNEJ transakcji `versionchange`:
 * odczyt sesji, prób, statystyk, blokad, zdarzeń i paczek → `transformToV15` (synchronicznie) →
 * zapis wyniku, wyczyszczenie paczek i automatycznych kopii bezpieczeństwa (zawierały starą treść),
 * rekordy `meta`: wersja treści = V15 i rekord migracji. Ustawienia bez zmian. Błąd = abort = baza
 * zostaje w wersji 1 (aplikacja nie startuje na starej puli — ekran „Aktualizacja danych nie powiodła się”).
 */
export function createMigrationV2(options: MigrationV2Options = {}): Migration {
  return {
    version: 2,
    description: 'Bank pytań V15: sesje poprzedniej wersji bez treści (legacy / interrupted_by_update), powtórki i blokady tylko niezmienionych pytań, bez paczek i kopii bezpieczeństwa',
    up(_db, tx, ctx) {
      const values: Partial<Record<(typeof V2_STORES)[number], unknown[]>> = {};
      let pending = V2_STORES.length;
      const guard =
        <A extends unknown[]>(fn: (...args: A) => void) =>
        (...args: A): void => {
          try {
            fn(...args);
          } catch (error) {
            ctx.abort(error);
          }
        };
      const writeAll = (): void => {
        const result = transformToV15(
          {
            sessions: values.sessions ?? [],
            attempts: values.attempts ?? [],
            questionStats: values.questionStats ?? [],
            blocks: values.blocks ?? [],
            events: values.events ?? [],
            packs: values.packs ?? [],
          },
          ctx.now,
        );
        const replace = (name: 'sessions' | 'attempts' | 'questionStats' | 'blocks', records: readonly unknown[]): void => {
          const store = tx.objectStore(name);
          store.clear();
          for (const r of records) store.put(r);
          if (options.faultAfterStore === name) throw new Error(`Wymuszone przerwanie migracji po magazynie ${name} (test)`);
        };
        replace('sessions', result.sessions);
        replace('attempts', result.attempts);
        replace('questionStats', result.questionStats);
        replace('blocks', result.blocks);
        tx.objectStore('packs').clear();
        tx.objectStore('backups').clear();
        const meta = tx.objectStore('meta');
        const content: ContentMetaRecord = {
          key: 'content',
          bankVersion: CONTENT_RELEASE.bankVersion,
          bankSha256: CONTENT_RELEASE.bankSha256,
          updatedAt: ctx.now,
          appVersion: ctx.appVersion,
        };
        const migration: MigrationMetaRecord = {
          key: `migration:${V15_MIGRATION_ID}`,
          migrationId: V15_MIGRATION_ID,
          fromSchemaVersion: ctx.oldVersion,
          toSchemaVersion: 2,
          appVersion: ctx.appVersion,
          report: result.report,
        };
        meta.put(content);
        meta.put(migration);
      };
      for (const name of V2_STORES) {
        const request = tx.objectStore(name).getAll();
        request.onsuccess = guard(() => {
          values[name] = request.result as unknown[];
          pending -= 1;
          if (pending === 0) writeAll();
        });
      }
    },
  };
}

/** Lista migracji aplikacji (rosnąco po wersji). */
export const MIGRATIONS: readonly Migration[] = Object.freeze([MIGRATION_V1, createMigrationV2()]);

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
