/**
 * Powłoka profili (DECYZJE §16) nad kontrolerem aplikacji: wybór profilu, zapamiętanie, zmiana profilu
 * i przypisanie historii bez profilu. Każdy profil ma własne repozytorium (osobna baza IndexedDB z właścicielem
 * w `meta`) i własny kontroler — zmiana profilu czeka na zakończenie zapisów w kolejce bieżącego kontrolera,
 * a opóźniony zapis zawsze trafia do bazy profilu, który go wywołał (kontrola właściciela w transakcji).
 *
 * Bez React i bez przeglądarki (testowalne z fake-indexeddb). UI: src/ui/ProfileRoot.tsx.
 */
import type { AppController } from '../app/controller';
import type { IsoDateTime } from '../domain/types';
import type { Repository, RepositoryOptions } from '../persistence/api';
import { mapOpenError, MSG_NO_INDEXEDDB, MSG_NO_STORAGE_SUFFIX } from '../persistence/errors';
import { hasLearningData } from '../persistence/merge';
import { knownProfile, LEGACY_DB_NAME, PROFILE_EMAILS, profileDbName } from './profiles';
import type { ProfileEmail } from './profiles';
import { NO_INDEXEDDB } from './registry';
import type { ProfileRegistry, UnassignedRecord, UnassignedSummary } from './registry';

/** Zależności kontrolera związane z profilem (ControllerDeps.profile). */
export interface ControllerProfileDeps {
  email: ProfileEmail;
  emails: readonly ProfileEmail[];
  /** Historia bez profilu czekająca na decyzję (`null` — brak); odczyt bieżący. */
  getUnassigned(): UnassignedSummary | null;
  /** Repozytorium innego profilu (wczytanie kopii do wskazanego profilu); wywołujący zamyka je po użyciu. */
  repositoryFor(email: ProfileEmail): Repository;
  /** „Zmień profil”. */
  switchProfile(): void;
  /** „Przypisz historię bez profilu do tego profilu”. */
  assignUnassigned(): void;
  /** Dane profilu zastąpione z kopii (powiadomienie innych kart z tym profilem). */
  dataReplaced(email: ProfileEmail): void;
}

export type ShellState =
  | { phase: 'loading'; messagePl?: string }
  | { phase: 'picker'; last: ProfileEmail | null; unassigned: UnassignedSummary | null; busy: boolean; messagePl: string | null }
  | { phase: 'assign'; email: ProfileEmail; unassigned: UnassignedSummary; busy: boolean; messagePl: string | null }
  | { phase: 'app'; email: ProfileEmail; controller: AppController; generation: number }
  | { phase: 'fatal'; messagePl: string; canRetry: boolean };

export type ShellMessage = { type: 'data-replaced'; email: ProfileEmail } | { type: 'unassigned-changed' };

export interface ShellChannel {
  post(message: ShellMessage): void;
  onMessage(listener: (message: ShellMessage) => void): () => void;
}

export interface ProfileShellDeps {
  registry: ProfileRegistry;
  createRepository(options: RepositoryOptions): Repository;
  createController(input: { email: ProfileEmail; repository: Repository; profile: ControllerProfileDeps }): AppController;
  /** Czy istnieje baza historii bez profilu (`null` — nie wiadomo, np. brak `indexedDB.databases()`). */
  legacyDatabaseExists(): Promise<boolean | null>;
  now(): IsoDateTime;
  randomId(): string;
  appVersion: string;
  bankVersions: readonly string[];
  /** Profil tej karty (sessionStorage) — odświeżenie karty zostaje przy jej profilu. */
  tabProfile?: { get(): string | null; set(email: ProfileEmail): void };
  channel?: ShellChannel;
  /** Przed uruchomieniem kontrolera innego profilu: trasa startowa (bez hasha poprzedniego profilu). */
  resetRoute?(): void;
}

export interface ProfileShell {
  getState(): ShellState;
  subscribe(listener: () => void): () => void;
  start(): Promise<void>;
  /** „Spróbuj ponownie” po błędzie uruchomienia (np. zablokowane dane witryny). */
  retry(): Promise<void>;
  /** Wybór profilu na ekranie „Wybierz profil”. */
  choose(email: string): Promise<void>;
  /** „Zmień profil”: zakończenie zapisów bieżącego profilu i ekran wyboru. */
  openPicker(): Promise<void>;
  /** Przypisanie historii bez profilu do profilu (z ekranu decyzji albo z Ustawień aktywnego profilu). */
  assignUnassigned(email: string): Promise<void>;
  /** „Nie teraz” — historia zostaje bez profilu; wejście do wybranego profilu. */
  deferUnassigned(): Promise<void>;
  dispose(): void;
}

export const MSG_ASSIGN_OTHER = 'Historia bez profilu jest właśnie przypisywana w innej karcie albo została już przypisana. Odśwież aplikację.';
export const MSG_CONTENT_UPDATE = 'Aktualizacja banku pytań…';
/** Błąd lokalnej bazy przy uruchomieniu — ten sam opis przyczyny co w aplikacji (kontroler). */
function storageMessage(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  const base = name === NO_INDEXEDDB ? MSG_NO_INDEXEDDB : mapOpenError(error).messagePl;
  return base + MSG_NO_STORAGE_SUFFIX;
}

function summarize(state: Awaited<ReturnType<Repository['loadUserState']>>): UnassignedSummary | null {
  if (!state.ok || !hasLearningData(state.value)) return null;
  const sessions = Object.values(state.value.sessions);
  let last: string | null = null;
  for (const s of sessions) {
    for (const t of [s.createdAt, s.updatedAt, s.closedAt]) if (t && (last === null || Date.parse(t) > Date.parse(last))) last = t;
  }
  for (const a of Object.values(state.value.attempts)) if (last === null || Date.parse(a.answeredAt) > Date.parse(last)) last = a.answeredAt;
  return {
    completedTests: sessions.filter((s) => s.kind === 'test' && s.status === 'completed').length,
    unfinishedTests: sessions.filter((s) => s.kind === 'test' && s.status !== 'completed' && s.status !== 'open').length,
    freeFlowSessions: sessions.filter((s) => s.kind === 'freeflow' && s.status !== 'open').length,
    openSessions: sessions.filter((s) => s.status === 'open').length,
    attempts: Object.keys(state.value.attempts).length,
    lastActivityAt: last,
  };
}

export function createProfileShell(deps: ProfileShellDeps): ProfileShell {
  let state: ShellState = { phase: 'loading' };
  let unassigned: UnassignedRecord | null = null;
  let generation = 0;
  let repository: Repository | null = null;
  let disposed = false;
  /** Profil wybrany na ekranie wyboru, czekający na decyzję o historii bez profilu. */
  let pendingChoice: ProfileEmail | null = null;
  const listeners = new Set<() => void>();
  const cleanups: Array<() => void> = [];
  /** Operacje powłoki jedna po drugiej (zmiana profilu, przypisanie). */
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);
    chain = run.catch(() => undefined);
    return run;
  };

  const publish = (next: ShellState): void => {
    if (disposed) return;
    state = next;
    for (const l of [...listeners]) l();
  };

  const waitingSummary = (): UnassignedSummary | null => (unassigned?.status === 'unassigned' ? unassigned.summary : null);

  const showPicker = (messagePl: string | null = null, last: ProfileEmail | null = null): void => {
    publish({ phase: 'picker', last, unassigned: waitingSummary(), busy: false, messagePl });
  };

  /** Zakończenie bieżącego profilu: zapisy z kolejki kończą się w jego bazie, potem zamknięcie. */
  const stopCurrent = async (): Promise<void> => {
    if (state.phase !== 'app') return;
    const { controller } = state;
    publish({ phase: 'loading' });
    try {
      await controller.whenIdle();
    } finally {
      controller.dispose();
      repository?.close();
      repository = null;
    }
  };

  const profileDeps = (email: ProfileEmail): ControllerProfileDeps => ({
    email,
    emails: PROFILE_EMAILS,
    getUnassigned: waitingSummary,
    repositoryFor: (other) => deps.createRepository({ dbName: profileDbName(other), owner: other, appVersion: deps.appVersion, now: deps.now }),
    switchProfile: () => void shell.openPicker(),
    assignUnassigned: () => void shell.assignUnassigned(email),
    dataReplaced: (other) => deps.channel?.post({ type: 'data-replaced', email: other }),
  });

  const startProfile = async (email: ProfileEmail): Promise<void> => {
    await stopCurrent();
    try {
      await deps.registry.setLast(email, deps.now());
    } catch {
      /* zapamiętanie to wygoda — profil działa i bez niego */
    }
    deps.tabProfile?.set(email);
    // Odświeżenie karty zachowuje ekran z adresu (DECYZJE §11); po zmianie profilu — start.
    if (generation > 0) deps.resetRoute?.();
    repository = deps.createRepository({ dbName: profileDbName(email), owner: email, appVersion: deps.appVersion, now: deps.now });
    const controller = deps.createController({ email, repository, profile: profileDeps(email) });
    generation += 1;
    publish({ phase: 'app', email, controller, generation });
    await controller.start();
  };

  /** Stan historii bez profilu: rejestr, a przy nieznanym — odczyt bazy sprzed profili (bez zmian danych). */
  const inspectUnassigned = async (): Promise<void> => {
    const snapshot = await deps.registry.read();
    unassigned = snapshot.unassigned;
    if (unassigned && unassigned.status !== 'unknown') return;
    const exists = await deps.legacyDatabaseExists();
    let summary: UnassignedSummary | null = null;
    if (exists !== false) {
      const legacy = deps.createRepository({ dbName: LEGACY_DB_NAME, appVersion: deps.appVersion, now: deps.now });
      // Dane sprzed V15 (schemat 1): migracja treści przy tym odczycie — ten sam komunikat co w aplikacji.
      legacy.setUpgradeListener((info) => {
        if (info.from > 0 && info.from < 2) publish({ phase: 'loading', messagePl: MSG_CONTENT_UPDATE });
      });
      try {
        summary = summarize(await legacy.loadUserState());
      } finally {
        legacy.close();
      }
    }
    const record = { status: summary ? ('unassigned' as const) : ('none' as const), email: null, mergeId: null, summary, updatedAt: deps.now() };
    await deps.registry.setUnassigned(record);
    unassigned = { key: 'unassigned', ...record };
  };

  /** Przypisanie (także dokończenie po przerwaniu): odczyt źródła → jedna transakcja w bazie profilu → rejestr. */
  const completeAssign = async (record: UnassignedRecord): Promise<void> => {
    const email = record.email as ProfileEmail;
    const legacy = deps.createRepository({ dbName: LEGACY_DB_NAME, appVersion: deps.appVersion, now: deps.now });
    const target = deps.createRepository({ dbName: profileDbName(email), owner: email, appVersion: deps.appVersion, now: deps.now });
    try {
      const source = await legacy.loadUserState();
      if (!source.ok) throw new Error(source.error.messagePl);
      const merged = await target.mergeUnassignedHistory(source.value, {
        now: deps.now(),
        mergeId: record.mergeId ?? deps.randomId(),
        sourceDb: LEGACY_DB_NAME,
        safetyBackupId: deps.randomId(),
        appVersion: deps.appVersion,
        bankVersions: [...deps.bankVersions],
      });
      if (!merged.ok) throw new Error(merged.error.messagePl);
    } finally {
      legacy.close();
      target.close();
    }
    const assigned = { status: 'assigned' as const, email, mergeId: record.mergeId, summary: record.summary, updatedAt: deps.now() };
    await deps.registry.setUnassigned(assigned);
    unassigned = { key: 'unassigned', ...assigned };
    deps.channel?.post({ type: 'unassigned-changed' });
    deps.channel?.post({ type: 'data-replaced', email });
  };

  /** Uruchomienie: stan historii bez profilu, dokończenie przerwanego przypisania, profil karty / ostatni. */
  const boot = async (): Promise<void> => {
    let snapshot;
    try {
      await inspectUnassigned();
      snapshot = await deps.registry.read();
    } catch (error) {
      publish({ phase: 'fatal', messagePl: storageMessage(error), canRetry: true });
      return;
    }
    // Przypisanie przerwane wcześniej (zamknięcie karty, brak zasilania) — dokończenie bez duplikatów.
    if (unassigned?.status === 'assigning' && unassigned.email) {
      try {
        await completeAssign(unassigned);
      } catch {
        showPicker('Nie udało się dokończyć przypisania historii bez profilu. Dane są bez zmian — spróbuj ponownie.');
        return;
      }
    }
    const fromTab = knownProfile(deps.tabProfile?.get() ?? null);
    const email = fromTab ?? snapshot.last;
    if (email) await startProfile(email);
    else showPicker();
  };

  const shell: ProfileShell = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start() {
      if (deps.channel && cleanups.length === 0) {
        cleanups.push(
          deps.channel.onMessage((message) => {
            if (message.type === 'data-replaced' && state.phase === 'app' && state.email === message.email) {
              // Dane tego profilu zmieniono w innej karcie (kopia, przypisanie) — wczytanie od nowa.
              const email = state.email;
              void serial(() => startProfile(email));
            } else if (message.type === 'unassigned-changed') {
              void serial(async () => {
                unassigned = (await deps.registry.read()).unassigned;
                // W aplikacji stan odczytuje kontroler przy kolejnym odświeżeniu widoku (bez restartu profilu).
                if (state.phase === 'picker') showPicker(state.messagePl, state.last);
              });
            }
          }),
        );
      }
      return serial(boot);
    },

    retry() {
      return serial(async () => {
        if (state.phase !== 'fatal') return;
        publish({ phase: 'loading' });
        await boot();
      });
    },

    choose(value) {
      return serial(async () => {
        const email = knownProfile(value);
        if (!email) return;
        if (unassigned?.status === 'unassigned' && unassigned.summary) {
          pendingChoice = email;
          publish({ phase: 'assign', email, unassigned: unassigned.summary, busy: false, messagePl: null });
          return;
        }
        await startProfile(email);
      });
    },

    openPicker() {
      return serial(async () => {
        const last = state.phase === 'app' ? state.email : null;
        await stopCurrent();
        try {
          unassigned = (await deps.registry.read()).unassigned;
        } catch {
          /* bez odświeżenia stanu historii */
        }
        showPicker(null, last);
      });
    },

    assignUnassigned(value) {
      return serial(async () => {
        const email = knownProfile(value);
        if (!email) return;
        await stopCurrent();
        publish({ phase: 'assign', email, unassigned: unassigned?.summary ?? emptySummary(), busy: true, messagePl: null });
        let begun;
        try {
          begun = await deps.registry.beginAssign(email, deps.randomId(), deps.now());
        } catch {
          begun = null;
        }
        if (!begun || !begun.started || !begun.record) {
          unassigned = begun?.record ?? unassigned;
          pendingChoice = null;
          if (begun?.record?.status === 'assigned' && begun.record.email === email) await startProfile(email);
          else showPicker(MSG_ASSIGN_OTHER);
          return;
        }
        try {
          await completeAssign(begun.record);
        } catch {
          // Rejestr zostaje w `assigning` — kolejne uruchomienie albo ponowienie dokończy przypisanie.
          unassigned = begun.record;
          publish({
            phase: 'assign',
            email,
            unassigned: begun.record.summary ?? emptySummary(),
            busy: false,
            messagePl: 'Nie udało się przypisać historii. Dane obu miejsc są bez zmian — spróbuj ponownie.',
          });
          return;
        }
        pendingChoice = null;
        await startProfile(email);
      });
    },

    deferUnassigned() {
      return serial(async () => {
        const email = pendingChoice ?? (state.phase === 'assign' ? state.email : null);
        pendingChoice = null;
        if (email) await startProfile(email);
        else showPicker();
      });
    },

    dispose() {
      for (const c of cleanups.splice(0)) c();
      if (state.phase === 'app') state.controller.dispose();
      repository?.close();
      disposed = true;
      listeners.clear();
    },
  };
  return shell;
}

function emptySummary(): UnassignedSummary {
  return { completedTests: 0, unfinishedTests: 0, freeFlowSessions: 0, openSessions: 0, attempts: 0, lastActivityAt: null };
}
