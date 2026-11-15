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
import type { ContentMetaRecord, MigrationMetaRecord, StoreName } from './api';
import type { Settings } from '../domain/types';
import { BANK_MIGRATION_ID, CURRENT_BANK_TARGET, settingsForCurrentBank, transformToCurrentBank } from './bankMigration';
import type { BankTarget } from './bankMigration';

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

/**
 * v2 (historyczna): podmiana treści na bank V15 (24.10.2026, docs/MIGRACJA_V15.md). Przekształcenie danych
 * wykonuje WYŁĄCZNIE migracja v5 (allowlista wydania) — w tej samej transakcji `versionchange`, więc baza
 * sprzed V15 (v1) przechodzi v1 → v5 jednym krokiem z punktu widzenia danych. Ten krok nie zmienia danych.
 */
const MIGRATION_V2: Migration = {
  version: 2,
  description: 'Historyczna (bank V15) — bez zmian danych; przekształcenie treści wykonuje v5',
  up() {
    /* brak zmian magazynów */
  },
};

/**
 * v4 (historyczna): bank V18 — komplet 700 pytań (09.11.2026, docs/MIGRACJA_V18.md). Bazy obecnych użytkowników
 * (aplikacja V18) są już w tej wersji z danymi przekształconymi do V18. Od wydania „V18 + webinary” przekształcenie
 * danych wykonuje WYŁĄCZNIE migracja v5 — baza v3 (lub v1) przechodzi do v5 jedną transformacją. Ten krok nie
 * zmienia danych.
 */
const MIGRATION_V4: Migration = {
  version: 4,
  description: 'Historyczna (bank V18, 700 pytań) — bez zmian danych; przekształcenie treści wykonuje v5',
  up() {
    /* brak zmian magazynów */
  },
};

/** Opcje migracji v5 (wydanie docelowe; testy: wymuszone przerwanie w środku transformacji). */
export interface MigrationV5Options {
  /** Test: wyjątek po zapisie wskazanego magazynu (dane częściowo nadpisane w transakcji → abort). */
  faultAfterStore?: 'sessions' | 'attempts' | 'questionStats' | 'blocks';
  /** Wydanie treści, do którego przekształcane są dane (domyślnie bieżące — `CURRENT_BANK_TARGET`). */
  target?: BankTarget;
}

const V5_STORES = ['settings', 'sessions', 'attempts', 'questionStats', 'blocks', 'events', 'packs', 'backups'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * v5: wydanie „V18 + webinary” (spec-webinary-247). W JEDNEJ transakcji `versionchange` bazy profilu:
 * odczyt wszystkich magazynów → `transformToCurrentBank` (allowlista wydania, synchronicznie) → zapis wyniku;
 * sesje V18 (także puste) zostają aktywne z nową wersją banku; ustawienia bez filtra trudności; paczki pytań
 * usunięte; automatyczne kopie bezpieczeństwa przekształcone tą samą funkcją (nieczytelne — usunięte);
 * `meta`: wersja treści wydania i rekord migracji `migration:bank-v18-webinary` (rekord `migration:bank-v18`
 * z v4 zostaje). Błąd = abort = baza zostaje w poprzedniej wersji z nietkniętymi danymi (aplikacja nie
 * pokazuje pytań).
 */
export function createMigrationV5(options: MigrationV5Options = {}): Migration {
  const target = options.target ?? CURRENT_BANK_TARGET;
  return {
    version: 5,
    description: 'Wydanie „V18 + webinary”: sesje zgodne z allowlistą (w tym puste sesje V18) zostają aktywne w nowej wersji, pozostałe bez treści (legacy / interrupted_by_update), bez paczek; kopie bezpieczeństwa przekształcone',
    up(_db, tx, ctx) {
      const values: Partial<Record<(typeof V5_STORES)[number], unknown[]>> = {};
      let pending = V5_STORES.length;
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
        const result = transformToCurrentBank(
          {
            sessions: values.sessions ?? [],
            attempts: values.attempts ?? [],
            questionStats: values.questionStats ?? [],
            blocks: values.blocks ?? [],
            events: values.events ?? [],
            packs: values.packs ?? [],
          },
          ctx.now,
          target,
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
        const settingsStore = tx.objectStore('settings');
        for (const st of values.settings ?? []) {
          if (!isRecord(st)) continue;
          const fixed = settingsForCurrentBank(st as unknown as Settings);
          if (fixed !== (st as unknown)) settingsStore.put(fixed);
        }
        // Kopie bezpieczeństwa w bazie: ta sama transformacja (zostają liczby, znika treść spoza allowlisty).
        let backupsTransformed = 0;
        let backupsRemoved = 0;
        const backups = tx.objectStore('backups');
        for (const record of values.backups ?? []) {
          if (!isRecord(record)) continue;
          if (typeof record.id !== 'string') {
            // Rekord bez tekstowego klucza (nie zapisuje go ta aplikacja) — usunięty, bo mógł zawierać dawną treść.
            if (typeof record.id === 'number') {
              backups.delete(record.id);
              backupsRemoved++;
            }
            continue;
          }
          let parsed: unknown = null;
          try {
            parsed = typeof record.json === 'string' ? JSON.parse(record.json) : null;
          } catch {
            parsed = null;
          }
          const data = isRecord(parsed) && isRecord(parsed.data) ? parsed.data : null;
          if (!isRecord(parsed) || !data) {
            backups.delete(record.id);
            backupsRemoved++;
            continue;
          }
          const arr = (key: string): unknown[] => (Array.isArray(data[key]) ? (data[key] as unknown[]) : []);
          const t = transformToCurrentBank({ sessions: arr('sessions'), attempts: arr('attempts'), questionStats: arr('questionStats'), blocks: arr('blocks'), events: arr('events'), packs: arr('packs') }, ctx.now, target);
          const settings = arr('settings').map((st) => (isRecord(st) ? settingsForCurrentBank(st as unknown as Settings) : st));
          const json = JSON.stringify({ ...parsed, data: { ...data, settings, sessions: t.sessions, attempts: t.attempts, questionStats: t.questionStats, blocks: t.blocks, events: t.events, packs: [] } });
          backups.put({ ...record, json, sizeBytes: new TextEncoder().encode(json).length });
          backupsTransformed++;
        }
        const meta = tx.objectStore('meta');
        const content: ContentMetaRecord = {
          key: 'content',
          bankVersion: target.bankVersion,
          bankSha256: target.bankSha256,
          updatedAt: ctx.now,
          appVersion: ctx.appVersion,
        };
        const migration: MigrationMetaRecord = {
          key: `migration:${BANK_MIGRATION_ID}`,
          migrationId: BANK_MIGRATION_ID,
          fromSchemaVersion: ctx.oldVersion,
          toSchemaVersion: 5,
          appVersion: ctx.appVersion,
          report: { ...result.report, backupsTransformed, backupsRemoved },
        };
        meta.put(content);
        meta.put(migration);
      };
      for (const name of V5_STORES) {
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

/**
 * v3 (profile, DECYZJE §16): bez zmian magazynów i danych. Podniesienie wersji sprawia, że kod sprzed profili
 * (otwierający wersję 2) nie otworzy tej bazy, a jego otwarte połączenie z bazą historii bez profilu zostaje
 * zamknięte (`versionchange`) — stary kod nie dopisze danych po przypisaniu historii profilowi.
 * Właściciel bazy profilu (`meta.owner`) zapisuje repozytorium przy otwarciu.
 */
const MIGRATION_V3: Migration = {
  version: 3,
  description: 'Profile: wersja 3 bez zmian danych (blokada zapisu kodu sprzed profili)',
  up() {
    /* brak zmian magazynów */
  },
};

/** Lista migracji 1…5 (rosnąco po wersji) z migracją v5 do wskazanego wydania (testy: inne wydanie, przerwanie). */
export function createMigrations(options: MigrationV5Options = {}): readonly Migration[] {
  return Object.freeze([MIGRATION_V1, MIGRATION_V2, MIGRATION_V3, MIGRATION_V4, createMigrationV5(options)]);
}

/** Lista migracji aplikacji (rosnąco po wersji); v5 do bieżącego wydania. */
export const MIGRATIONS: readonly Migration[] = createMigrations();

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
