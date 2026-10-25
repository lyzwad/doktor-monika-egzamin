/**
 * Błędy trwałości z komunikatami po polsku (kontrakt: `PersistenceError` w ./api.ts).
 *
 * Zasada: każdy błąd zapisu kończy się `{ ok: false }` — nigdy fałszywym sukcesem. Komunikaty są
 * gotowe do pokazania (S24f „Odpowiedź nie została zapisana…”, S22g, S24e).
 */
import type { SessionId } from '../domain/types';
import { BACKUP_FORMAT_VERSION, BACKUP_MAX_BYTES } from './api';
import type { PersistenceError, PersistenceResult } from './api';

export function ok<T>(value: T): PersistenceResult<T> {
  return { ok: true, value };
}

export function fail<T>(error: PersistenceError): PersistenceResult<T> {
  return { ok: false, error };
}

/** Nazwa wyjątku (DOMException, Error) albo `null`. */
export function errorName(error: unknown): string | null {
  if (error && typeof error === 'object' && 'name' in error && typeof (error as { name: unknown }).name === 'string') {
    return (error as { name: string }).name;
  }
  return null;
}

/** Krótki opis techniczny przyczyny (do pola `cause`, nie do UI). */
export function describeCause(error: unknown): string | undefined {
  if (error === null || error === undefined) return undefined;
  const name = errorName(error);
  const message =
    error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string'
      ? (error as { message: string }).message
      : typeof error === 'string'
        ? error
        : '';
  const text = [name, message].filter((part) => part && part.length > 0).join(': ');
  return text.length > 0 ? text : undefined;
}

function withCause<E extends PersistenceError>(error: E, cause: unknown): E {
  const text = describeCause(cause);
  return text === undefined ? error : { ...error, cause: text };
}

export const MSG_QUOTA =
  'Zmiany nie zostały zapisane: brakuje miejsca na urządzeniu albo przeglądarka odrzuciła zapis. ' +
  'Zwolnij miejsce i spróbuj ponownie lub zapisz kopię danych w ustawieniach.';
export const MSG_WRITE_FAILED =
  'Nie udało się zapisać zmian. Dane na tym urządzeniu pozostały bez zmian — spróbuj ponownie.';
export const MSG_UNAVAILABLE =
  'Lokalna baza danych jest niedostępna. Sprawdź, czy przeglądarka nie blokuje danych witryn ' +
  '(np. tryb prywatny), i uruchom aplikację ponownie.';
export const MSG_NO_INDEXEDDB =
  'Ta przeglądarka nie udostępnia lokalnej bazy danych (IndexedDB), więc wyniki nie mogą zostać zapisane. ' +
  'Otwórz aplikację w Safari (poza trybem prywatnym) albo dodaj ją do ekranu głównego.';
/** Dopisek do błędów braku lokalnej bazy przy uruchomieniu (kontroler i ekran wyboru profilu). */
export const MSG_NO_STORAGE_SUFFIX =
  ' Bez zapisu na tym urządzeniu nauka nie jest możliwa: odpowiedzi, przerwane sesje, wyniki i powtórki muszą być zapisywane lokalnie.';
export const MSG_NEWER_DB =
  'Dane na tym urządzeniu zapisała nowsza wersja aplikacji. Odśwież aplikację, aby wczytać aktualną wersję. ' +
  'Dane nie zostały zmienione.';
export const MSG_BLOCKED =
  'Aplikacja jest otwarta w innej karcie ze starszą wersją bazy danych. Zamknij pozostałe karty z aplikacją i spróbuj ponownie.';
export const MSG_MIGRATION =
  'Nie udało się zaktualizować lokalnej bazy danych do nowej wersji. Dane pozostały w poprzedniej wersji i nie zostały usunięte. ' +
  'Uruchom aplikację ponownie.';
export const MSG_CONFLICT =
  'Sesja została w międzyczasie zmieniona (np. w innej karcie). Zmiany nie zostały zapisane — odśwież widok i spróbuj ponownie.';

export function quotaExceeded(): PersistenceError {
  return { code: 'QuotaExceeded', messagePl: MSG_QUOTA };
}

export function writeFailed(cause?: unknown, messagePl: string = MSG_WRITE_FAILED): PersistenceError {
  return withCause({ code: 'WriteFailed', messagePl }, cause);
}

export function unavailable(cause?: unknown, messagePl: string = MSG_UNAVAILABLE): PersistenceError {
  return withCause({ code: 'Unavailable', messagePl }, cause);
}

export function blocked(): PersistenceError {
  return { code: 'Blocked', messagePl: MSG_BLOCKED };
}

export function migrationFailed(cause?: unknown): PersistenceError {
  return withCause({ code: 'MigrationFailed', messagePl: MSG_MIGRATION }, cause);
}

export function conflict(sessionId: SessionId): PersistenceError {
  return { code: 'Conflict', messagePl: MSG_CONFLICT, sessionId };
}

/** Baza należy do innego profilu (DECYZJE §16) — zapis odrzucony. */
export function ownerMismatch(expected: string, found: string | null): PersistenceError {
  return {
    code: 'OwnerMismatch',
    messagePl: `Te dane należą do innego profilu (${found ?? 'bez profilu'}), a nie do ${expected}. Zapis odrzucono — dane obu profili są bez zmian. Wybierz profil ponownie.`,
    expected,
    found,
  };
}

export function notFound(messagePl: string): PersistenceError {
  return { code: 'NotFound', messagePl };
}

function quoted(fileName: string): string {
  return `„${fileName}”`;
}

export function invalidBackup(fileName: string, reasonsPl: string[]): PersistenceError {
  return {
    code: 'InvalidBackup',
    messagePl:
      `Nie można wczytać pliku ${quoted(fileName)}. Plik jest uszkodzony albo nie jest kopią tej aplikacji. ` +
      'Dane na tym urządzeniu nie zostały zmienione.',
    reasonsPl,
  };
}

export function unsupportedBackupVersion(fileName: string, foundVersion: number): PersistenceError {
  const messagePl =
    foundVersion > BACKUP_FORMAT_VERSION
      ? `Ta kopia pochodzi z nowszej wersji aplikacji. Plik ${quoted(fileName)} ma format ${foundVersion}, ` +
        `a ta wersja obsługuje formaty 1–${BACKUP_FORMAT_VERSION}. Zaktualizuj aplikację, a potem wczytaj kopię ponownie. ` +
        'Dane na tym urządzeniu nie zostały zmienione.'
      : `Plik ${quoted(fileName)} ma nieobsługiwany format kopii (${foundVersion}); ta wersja obsługuje formaty ` +
        `1–${BACKUP_FORMAT_VERSION}. Dane na tym urządzeniu nie zostały zmienione.`;
  return { code: 'UnsupportedBackupVersion', messagePl, foundVersion, supportedVersion: BACKUP_FORMAT_VERSION };
}

/**
 * Rozmiar w MB z przecinkiem dziesiętnym (np. „25,3 MB”). `roundUp` — zaokrąglenie w górę do 0,1
 * (rozmiar pliku ponad limit nigdy nie wygląda na równy limitowi).
 */
export function formatMegabytesPl(bytes: number, roundUp = false): string {
  const tenths = (bytes / (1024 * 1024)) * 10;
  const mb = (roundUp ? Math.ceil(tenths) : Math.floor(tenths)) / 10;
  return `${String(mb).replace('.', ',')} MB`;
}

export function backupTooLarge(fileName: string, sizeBytes: number): PersistenceError {
  return {
    code: 'BackupTooLarge',
    messagePl:
      `Plik ${quoted(fileName)} ma ${formatMegabytesPl(sizeBytes, true)} — więcej niż limit ` +
      `${formatMegabytesPl(BACKUP_MAX_BYTES)} dla kopii. Dane na tym urządzeniu nie zostały zmienione.`,
    sizeBytes,
    maxBytes: BACKUP_MAX_BYTES,
  };
}

/**
 * Mapowanie wyjątku/`transaction.error` operacji zapisu na `PersistenceError`.
 * `QuotaExceededError` (także jako przyczyna przerwania transakcji) → `QuotaExceeded`;
 * utrata połączenia/bazy → `Unavailable`; pozostałe → `WriteFailed`.
 */
export function mapWriteError(error: unknown): PersistenceError {
  const name = errorName(error);
  switch (name) {
    case 'QuotaExceededError':
      return quotaExceeded();
    case 'InvalidStateError':
    case 'UnknownError':
      // Połączenie z bazą zamknięte/utracone (np. Safari po wyczyszczeniu danych witryny).
      return writeFailed(error);
    case 'SecurityError':
      return unavailable(error);
    default:
      return writeFailed(error);
  }
}

/** Mapowanie błędu odczytu (pełny stan, kopia, lista paczek). */
export function mapReadError(error: unknown): PersistenceError {
  const name = errorName(error);
  if (name === 'SecurityError' || name === 'InvalidStateError' || name === 'UnknownError') return unavailable(error);
  return writeFailed(error, 'Nie udało się odczytać danych z lokalnej bazy. Spróbuj ponownie.');
}

/** Mapowanie błędu otwarcia bazy. */
export function mapOpenError(error: unknown): PersistenceError {
  const name = errorName(error);
  if (name === 'VersionError') return unavailable(error, MSG_NEWER_DB);
  if (name === 'QuotaExceededError') return quotaExceeded();
  return unavailable(error);
}
