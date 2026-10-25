/**
 * KONTRAKT TRWAŁOŚCI — IndexedDB (DECYZJE §1, §10; 03_ARCHITEKTURA §7).
 *
 * - Każdy `commit(changeset)` = JEDNA transakcja readwrite na wszystkich dotkniętych magazynach
 *   (wraz ze sprawdzeniem `guards`). Sukces zwracany dopiero po `transaction.oncomplete`.
 * - Błędy są mapowane na `PersistenceError` (QuotaExceededError, odmowa, przerwanie, konflikt rewizji).
 *   Nigdy fałszywy sukces.
 * - Import kopii: walidacja przed jakąkolwiek zmianą; automatyczna kopia bieżącego stanu do magazynu
 *   `backups` i zamiana wszystkich danych użytkownika w jednej transakcji. Błąd = stary stan nietknięty.
 * - Bez `await` na operacjach spoza IndexedDB (sieć, pliki, Web Crypto) wewnątrz otwartej transakcji.
 */
import type {
  Attempt,
  BankVersion,
  Block,
  Changeset,
  CommandResult,
  DmeEvent,
  IsoDateTime,
  QuestionStat,
  Session,
  SessionId,
  SessionKind,
  Settings,
  UserState,
} from '../domain/types';
import type { V15TransformReport } from './v15Migration';

/* ========================================================================== */
/* Schemat bazy                                                               */
/* ========================================================================== */

export const DB_NAME = 'doktor-monika-egzamin';
/** Wersja schematu IndexedDB (migracje wersjonowane, `onupgradeneeded`). */
export const DB_SCHEMA_VERSION = 3;

/** Magazyny (DECYZJE §10). */
export const STORE_NAMES = [
  'meta',
  'settings',
  'sessions',
  'attempts',
  'questionStats',
  'blocks',
  'events',
  'packs',
  'backups',
] as const;
export type StoreName = (typeof STORE_NAMES)[number];

/**
 * Klucze główne magazynów (keyPath). Klucze w `Changeset.stores[x].delete` to wartości tych pól.
 * Uwaga: wartości boolean nie są poprawnymi kluczami IndexedDB — indeks kolejki błędów opieraj
 * na `dueAt` (`null` = brak aktywnego błędu, nieindeksowane).
 */
export const STORE_KEY_PATHS: Readonly<Record<StoreName, string>> = Object.freeze({
  meta: 'key',
  settings: 'id',
  sessions: 'id',
  attempts: 'id',
  questionStats: 'questionId',
  blocks: 'id',
  events: 'id',
  packs: 'id',
  backups: 'id',
});

/**
 * Właściciel bazy profilu (magazyn `meta`, klucz `'owner'`, DECYZJE §16). Zapisany przy pierwszym otwarciu
 * bazy profilu; każda transakcja zapisu sprawdza go w tej samej transakcji — zapis z repozytorium innego
 * profilu (opóźniony, z innej karty) jest odrzucany zamiast trafić do cudzych danych.
 */
export interface OwnerMetaRecord {
  key: 'owner';
  email: string;
  since: IsoDateTime;
}

/** Wynik przypisania historii bez profilu (magazyn `meta`, klucz `'merge:unassigned'`) — chroni przed powtórzeniem. */
export interface MergeMetaRecord {
  key: 'merge:unassigned';
  mergeId: string;
  mergedAt: IsoDateTime;
  sourceDb: string;
  counts: MergeCounts;
}

export interface MergeCounts {
  sessions: number;
  attempts: number;
  questionStats: number;
  blocks: number;
  events: number;
}

/** Rekord metadanych schematu (magazyn `meta`, klucz `'schema'`). */
export interface MetaRecord {
  key: 'schema';
  schemaVersion: number;
  createdAt: IsoDateTime;
  migratedAt: IsoDateTime | null;
  /** Wersja aplikacji, która ostatnio migrowała bazę. */
  appVersion: string;
}

/** Rekord `meta` z wersją treści (klucz `'content'`): bank pytań, do którego dostosowano dane (V15). */
export interface ContentMetaRecord {
  key: 'content';
  bankVersion: string;
  bankSha256: string;
  updatedAt: IsoDateTime;
  appVersion: string;
}

/** Rekord `meta` wykonanej migracji treści (klucz `migration:<id>`), z raportem liczbowym. */
export interface MigrationMetaRecord {
  key: string;
  migrationId: string;
  fromSchemaVersion: number;
  toSchemaVersion: number;
  appVersion: string;
  report: V15TransformReport;
}

/* ========================================================================== */
/* Kopia danych (DECYZJE §10)                                                 */
/* ========================================================================== */

export const BACKUP_FORMAT = 'dme-backup';
/** Format 2 (profile): pole `profileEmail`. Format 1 (bez maila) nadal się wczytuje — z wyborem profilu docelowego. */
export const BACKUP_FORMAT_VERSION = 2;
export const SUPPORTED_BACKUP_FORMAT_VERSIONS: readonly number[] = [1, 2];
export const APP_ID = 'doktor-monika-egzamin';
/** Limit rozmiaru pliku kopii przy imporcie. */
export const BACKUP_MAX_BYTES = 25 * 1024 * 1024;

/** Dane użytkownika w kopii — zrzut magazynów (tablice; `settings` ma 0–1 element). */
export interface BackupData {
  settings: Settings[];
  sessions: Session[];
  attempts: Attempt[];
  questionStats: QuestionStat[];
  blocks: Block[];
  events: DmeEvent[];
  /**
   * Zaimportowane pule — od V15 zawsze puste przy eksporcie; przy wczytaniu starszej kopii są odrzucane
   * (aplikacja używa wyłącznie banku V15).
   */
  packs: unknown[];
}

/**
 * Plik kopii, format 1 albo 2. Nie zawiera banku pytań, kluczy API, haseł ani danych pacjentów.
 * Format 2: `profileEmail` = profil, którego dane zawiera plik (`null` — dane bez profilu).
 */
export interface BackupFileV1 {
  format: typeof BACKUP_FORMAT;
  formatVersion: 1 | 2;
  /** (Format 2) Mail profilu źródłowego; brak w formacie 1. */
  profileEmail?: string | null;
  appId: typeof APP_ID;
  exportedAt: IsoDateTime;
  appVersion: string;
  bankVersions: BankVersion[];
  data: BackupData;
}

/** Podsumowanie kopii do ekranu decyzji (S22: „6 ukończonych testów i 1 niedokończony…”). */
export interface BackupSummary {
  exportedAt: IsoDateTime;
  formatVersion: number;
  appVersion: string;
  /** Profil źródłowy z pliku (format 2) albo `null` (format 1 / dane bez profilu). */
  profileEmail: string | null;
  completedTests: number;
  unfinishedTests: number;
  freeFlowSessions: number;
  /** Otwarte (przerwane) sesje w kopii. */
  openSessions: number;
  openSessionKind: SessionKind | null;
  /** Aktywne (nieodwołane) blokady. */
  activeBlocks: number;
  attempts: number;
  questionStats: number;
  packs: number;
  /**
   * (Dodane addytywnie przez agenta trwałości — repozytorium IndexedDB zawsze je ustawia.)
   * Liczba wszystkich sesji w kopii (Test + Free Flow, dowolny status).
   */
  totalSessions?: number;
  /** Najwcześniejsza data aktywności w kopii (sesje, próby, zdarzenia, blokady) albo `null` przy pustej kopii. */
  firstActivityAt?: IsoDateTime | null;
  /** Najpóźniejsza data aktywności w kopii albo `null` przy pustej kopii. */
  lastActivityAt?: IsoDateTime | null;
  /** (V15) Sesje z poprzedniej wersji banku (tylko podsumowania, bez treści) — po transformacji. */
  legacySessions?: number;
  /** (V15) Sesje przerwane aktualizacją banku pytań. */
  interruptedSessions?: number;
  /** (V15) Zaimportowane pule w pliku — odrzucone przy wczytaniu. */
  packsDropped?: number;
}

/** Kopia po pełnej walidacji (JSON, schemat, enumy, daty, referencje, wersja, rozmiar). */
export interface ValidatedBackup {
  readonly kind: 'validated-backup';
  fileName: string;
  sizeBytes: number;
  backup: BackupFileV1;
  summary: BackupSummary;
}

/** Automatyczna kopia bezpieczeństwa (magazyn `backups`). */
export interface BackupRecord {
  id: string;
  createdAt: IsoDateTime;
  /** `before_restore` — przed „Wczytaj kopię”; `before_assign` — przed przypisaniem historii bez profilu. */
  reason: 'before_restore' | 'before_assign';
  /** Np. `dme-przed-wczytaniem-2026-10-22.json`. */
  fileName: string;
  sizeBytes: number;
  /** Treść pliku kopii (JSON `BackupFileV1`). */
  json: string;
}
export type BackupRecordInfo = Omit<BackupRecord, 'json'>;

/** Plik do zapisania przez użytkowniczkę (zapis jest akcją użytkownika — UI/platforma). */
export interface ExportedFile {
  /** Np. `dme-kopia-2026-10-22.json`. */
  fileName: string;
  mimeType: 'application/json';
  text: string;
  sizeBytes: number;
}

export interface ExportBackupInput {
  now: IsoDateTime;
  appVersion: string;
  bankVersions: BankVersion[];
  /** Mail profilu w pliku (repozytorium profilu wpisuje właściciela bazy; jawna wartość tylko w testach). */
  profileEmail?: string | null;
}

export interface ReplaceFromBackupInput {
  now: IsoDateTime;
  /** Identyfikator automatycznej kopii bieżącego stanu (z kontrolera). */
  safetyBackupId: string;
  appVersion: string;
  bankVersions: BankVersion[];
}

export interface ReplaceInfo {
  safetyBackup: BackupRecordInfo;
  summary: BackupSummary;
}

export interface MergeUnassignedInput {
  now: IsoDateTime;
  /** Identyfikator przypisania (ten sam przy ponowieniu po przerwaniu). */
  mergeId: string;
  /** Nazwa bazy źródłowej (diagnostyka). */
  sourceDb: string;
  safetyBackupId: string;
  appVersion: string;
  bankVersions: BankVersion[];
}

export interface MergeInfo {
  /** `true` — przypisanie było już zapisane wcześniej (ponowienie po przerwaniu); dane bez zmian. */
  alreadyMerged: boolean;
  counts: MergeCounts;
}

/* ========================================================================== */
/* Wyniki i błędy                                                             */
/* ========================================================================== */

export interface OpenInfo {
  schemaVersion: number;
  /** Wersja, z której migrowano przy tym otwarciu, albo `null`. */
  migratedFrom: number | null;
  /** Pierwsze uruchomienie (baza utworzona teraz). */
  created: boolean;
}

export interface CommitInfo {
  /** Liczba zapisanych/usuniętych rekordów (diagnostyka). */
  written: number;
  deleted: number;
}

export type PersistenceErrorCode = PersistenceError['code'];

/**
 * Błędy trwałości z komunikatem PL. UI pokazuje stan „niezapisane” z ponowieniem tej samej komendy.
 */
export type PersistenceError =
  /** Brak IndexedDB, tryb bez zapisu danych witryny, odmowa otwarcia. */
  | { code: 'Unavailable'; messagePl: string; cause?: string }
  /** Inna karta blokuje aktualizację schematu. */
  | { code: 'Blocked'; messagePl: string }
  | { code: 'MigrationFailed'; messagePl: string; cause?: string }
  /** QuotaExceededError — brak miejsca. */
  | { code: 'QuotaExceeded'; messagePl: string }
  /** Inny błąd zapisu/przerwana transakcja. */
  | { code: 'WriteFailed'; messagePl: string; cause?: string }
  /** Baza należy do innego profilu niż repozytorium (zapis odrzucony, dane bez zmian). */
  | { code: 'OwnerMismatch'; messagePl: string; expected: string; found: string | null }
  /** Niespełniony `SessionRevisionGuard` (np. zmiana z innej karty). */
  | { code: 'Conflict'; messagePl: string; sessionId: SessionId }
  | { code: 'NotFound'; messagePl: string }
  /** Uszkodzony JSON, zły schemat, enumy, daty, referencje — lista przyczyn po polsku. */
  | { code: 'InvalidBackup'; messagePl: string; reasonsPl: string[] }
  /** Kopia z nieznanej (np. nowszej) wersji formatu (S24e). */
  | { code: 'UnsupportedBackupVersion'; messagePl: string; foundVersion: number; supportedVersion: number }
  | { code: 'BackupTooLarge'; messagePl: string; sizeBytes: number; maxBytes: number };

export type PersistenceResult<T> = CommandResult<T, PersistenceError>;

/* ========================================================================== */
/* Pamięć trwała przeglądarki (navigator.storage)                             */
/* ========================================================================== */

export type PersistRequestResult = 'granted' | 'denied' | 'unsupported';

export interface StorageEstimateInfo {
  usageBytes: number | null;
  quotaBytes: number | null;
}

/** Opakowanie `navigator.storage` — persystencja to prośba, nie gwarancja. */
export interface StorageApi {
  /** `null` = API niedostępne. */
  persisted(): Promise<boolean | null>;
  /** Prośba o trwałe przechowywanie (po pierwszej zapisanej odpowiedzi). */
  requestPersist(): Promise<PersistRequestResult>;
  /** `null` = API niedostępne. */
  estimate(): Promise<StorageEstimateInfo | null>;
}

/* ========================================================================== */
/* Repozytorium                                                               */
/* ========================================================================== */

export interface RepositoryOptions {
  /** Nazwa bazy (testy: unikalna na test). Domyślnie `DB_NAME`. */
  dbName?: string;
  /** Fabryka IndexedDB (testy: fake-indexeddb). Domyślnie `globalThis.indexedDB`. */
  indexedDB?: IDBFactory;
  /** `navigator.storage` albo `null`, gdy niedostępne. */
  storageManager?: StorageManager | null;
  /** Wersja aplikacji zapisywana w `meta`. */
  appVersion?: string;
  /**
   * (Dodane addytywnie.) Zegar dla znaczników czasu w `meta` (utworzenie/migracja bazy).
   * Domyślnie `new Date().toISOString()`; w aplikacji można przekazać `platform.nowIso`.
   */
  now?: () => IsoDateTime;
  /**
   * Wersja treści, której sesje wolno zapisywać (domyślnie bank V15). Zapis sesji innej wersji, która
   * nie jest sesją `legacy`, jest odrzucany (ochrona przed opóźnionym zapisem starego kodu).
   */
  contentBankVersion?: string;
  /**
   * (Profile, DECYZJE §16) Mail profilu — właściciel bazy. Przy otwarciu: zapis właściciela w pustej bazie albo
   * sprawdzenie zgodności; każda transakcja zapisu sprawdza właściciela w tej samej transakcji.
   * `undefined` — bez kontroli (baza historii bez profilu, testy).
   */
  owner?: string;
}

export interface Repository {
  /** Otwiera bazę i wykonuje migracje. Bezpieczne do wielokrotnego wywołania. */
  open(): Promise<PersistenceResult<OpenInfo>>;

  /** Wczytuje pełny `UserState` (pusty stan przy pierwszym uruchomieniu). */
  loadUserState(): Promise<PersistenceResult<UserState>>;

  /**
   * Zapisuje changeset w JEDNEJ transakcji readwrite: sprawdza `guards`, wykonuje `put`/`delete`
   * dla każdego magazynu. Pusty changeset → sukces bez transakcji.
   */
  commit(changeset: Changeset): Promise<PersistenceResult<CommitInfo>>;

  /** Buduje plik kopii (`BackupFileV1`) ze wszystkich danych użytkownika i paczek. */
  exportBackup(input: ExportBackupInput): Promise<PersistenceResult<ExportedFile>>;

  /**
   * Czyta i waliduje plik kopii BEZ zmiany danych: limit 25 MB, JSON, `format`/`appId`,
   * `formatVersion` (nieznana → `UnsupportedBackupVersion`), schemat, enumy, daty ISO,
   * referencje (sloty→snapshoty pytań, próby→sesje/sloty, blokady→zdarzenia).
   * @param input `File`/`Blob` z wyboru pliku albo tekst JSON
   * @param fileName nazwa do komunikatów (dla `File` domyślnie `file.name`)
   */
  parseAndValidateBackup(input: Blob | string, fileName?: string): Promise<PersistenceResult<ValidatedBackup>>;

  /**
   * Zastępuje WSZYSTKIE dane użytkownika danymi z kopii. W jednej transakcji: zapis automatycznej
   * kopii bieżącego stanu do `backups`, wyczyszczenie magazynów użytkownika i `packs`, zapis danych kopii.
   * Błąd → stary stan nietknięty.
   */
  replaceAllFromBackup(validated: ValidatedBackup, input: ReplaceFromBackupInput): Promise<PersistenceResult<ReplaceInfo>>;

  /**
   * (Profile) Dołącza historię bez profilu do tej bazy w JEDNEJ transakcji: kopia bezpieczeństwa bieżącego
   * stanu, suma sesji/prób/zdarzeń/blokad (rekordy już obecne zostają), statystyki pytań obecne w obu
   * odtworzone z połączonego dziennika prób, rekord `meta` przypisania. Ponowienie z tym samym `mergeId`
   * po przerwaniu nic nie duplikuje (`alreadyMerged`).
   */
  mergeUnassignedHistory(source: UserState, input: MergeUnassignedInput): Promise<PersistenceResult<MergeInfo>>;

  /** Właściciel bazy (`meta.owner`) albo `null`. */
  readOwner(): Promise<PersistenceResult<string | null>>;

  /** Automatyczne kopie bezpieczeństwa (najnowsze pierwsze). */
  listBackups(): Promise<PersistenceResult<BackupRecordInfo[]>>;

  /** Treść automatycznej kopii do pobrania („propozycja pobrania” po imporcie). */
  getBackupFile(id: string): Promise<PersistenceResult<ExportedFile>>;

  /** Rekordy `meta`: wersja treści (V15) i rekord migracji (diagnostyka, testy). */
  readContentMeta(): Promise<PersistenceResult<{ content: ContentMetaRecord | null; migration: MigrationMetaRecord | null }>>;

  /**
   * Powiadomienie o rozpoczęciu migracji schematu przy otwarciu (ekran „Aktualizacja banku pytań…”).
   * Od V15 import dodatkowych pul pytań jest wyłączony (brak `importPack`/`listPacks`).
   */
  setUpgradeListener(listener: ((info: { from: number; to: number }) => void) | null): void;

  /** `navigator.storage`: persist/estimate. */
  readonly storage: StorageApi;

  /** Zamyka połączenie z bazą. */
  close(): void;
}

/** Fabryka repozytorium (implementacja: src/persistence/repository.ts). */
export type CreateRepository = (options?: RepositoryOptions) => Repository;
