/**
 * Konstruktory pustych struktur (bez logiki doboru/punktacji).
 */
import type { Changeset, CommandId, DomainError, DomainErrorCode, Settings, UserState } from './types';

/** Ustawienia pierwszego uruchomienia (konfiguracje `null` = użyj domyślnych z policies.ts). */
export function defaultSettings(): Settings {
  return {
    id: 'settings',
    lastTestConfig: null,
    lastFreeFlowConfig: null,
    installHintDismissedAt: null,
    persistRequestedAt: null,
    updatedAt: null,
  };
}

/** Pusty stan użytkowniczki (pierwsze uruchomienie). */
export function emptyUserState(): UserState {
  return {
    settings: defaultSettings(),
    sessions: {},
    attempts: {},
    questionStats: {},
    blocks: {},
    events: {},
  };
}

/** Pusty changeset dla komendy. */
export function emptyChangeset(commandId: CommandId | null): Changeset {
  return { commandId, guards: [], stores: {} };
}

/** Czy changeset nie zawiera żadnych zmian (wtedy kontroler nie wykonuje zapisu). */
export function isChangesetEmpty(changeset: Changeset): boolean {
  return Object.values(changeset.stores).every(
    (change) => change === undefined || (change.put.length === 0 && change.delete.length === 0),
  );
}

/** Błąd domeny z komunikatem PL. */
export function domainError(
  code: DomainErrorCode,
  messagePl: string,
  details?: Readonly<Record<string, string | number | boolean | null>>,
): DomainError {
  return details === undefined ? { code, messagePl } : { code, messagePl, details };
}

/** Wyjątek dla funkcji kontraktu, których implementacja należy do agenta silnika. */
export class NotImplementedError extends Error {
  constructor(functionName: string) {
    super(`not implemented: ${functionName}`);
    this.name = 'NotImplementedError';
  }
}
