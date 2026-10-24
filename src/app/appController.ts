/**
 * RZECZYWISTY KONTROLER APLIKACJI (DECYZJE §1, §3, §9–§11): spina silnik domeny (src/domain),
 * repozytorium IndexedDB (src/persistence) i Service Worker (src/pwa).
 *
 * Przepływ komendy:
 *   1. akcja UI → `commandId`, czas i początek następnego dnia (Europe/Warsaw) z `Platform`, seed sesji;
 *   2. funkcja domeny na OSTATNIM TRWALE ZAPISANYM `UserState` (błąd domeny = komunikat, bez zapisu);
 *   3. `repository.commit(changeset)` — jedna transakcja; w trakcie `save.status = 'saving'`;
 *   4. sukces → publikacja nowego stanu jako trwałego; porażka → `save.status = 'error'`, stan trwały
 *      bez zmian, „Spróbuj zapisać ponownie” wysyła TEN SAM changeset (ten sam `commandId`).
 *      Konflikt rewizji (np. zmiana w innej karcie) → ponowne wczytanie danych z bazy i komunikat.
 * Komendy wykonują się kolejno (kolejka), więc żadna nie liczy się na nieaktualnym stanie.
 * Dopóki zmiana jest niezapisana, kolejne komendy zapisujące są odrzucane (nic nie udaje sukcesu).
 *
 * Pozostałe obowiązki: `markShown` przy pierwszym pokazaniu slotu (w tle; nie unieważnia „Cofnij”),
 * prośba `navigator.storage.persist()` po pierwszej zapisanej odpowiedzi, token „Cofnij” w pamięci,
 * synchronizacja `location.hash`, baner aktualizacji tylko poza ekranem pytania i po zapisie,
 * pierwsze przygotowanie offline, brak IndexedDB → ekran błędu (nauka bez zapisu jest niemożliwa).
 */
import {
  activeSession,
  advance as domainAdvance,
  answer as domainAnswer,
  buildCatalog,
  capacityFor,
  closeUnfinished as domainCloseUnfinished,
  defaultSettings,
  endFreeFlow as domainEndFreeFlow,
  fillAwaitingReplacements,
  finishTest,
  initialFreeFlowConfig,
  initialTestConfig,
  isChangesetEmpty,
  isUndoValid,
  markShown,
  nextFreeFlowSlot,
  parseRuntimeBank,
  reportQuestion,
  restoreBlock as domainRestoreBlock,
  startFreeFlow as domainStartFreeFlow,
  startRetryRound as domainStartRetryRound,
  startTest as domainStartTest,
  undoReport as domainUndoReport,
  updateSettings,
  validateTestN,
  parseRetiredIds,
  parseTrainingProfile,
  CONTENT_RELEASE,
  DEFAULT_TEST_N,
  type DomainCommandResult,
} from '../domain/api';
import type {
  Catalog,
  Changeset,
  CommandContext,
  DmeEvent,
  DomainOutcome,
  HistoryFilter,
  RuntimeBank,
  TrainingProfile,
  Session,
  SessionConfig,
  SessionId,
  SessionKind,
  Slot,
  UndoToken,
  UserState,
} from '../domain/types';
import type { PersistenceError, ValidatedBackup } from '../persistence/api';
import { isUpdateSafe } from '../pwa/updateGuard';
import type { ActionResult, AppController, AppState, ControllerDeps, CreateAppController } from './controller';
import { HOME_ROUTE, parseHash, routeToHash, sameRoute, type HistoryTab, type ResultOrigin, type Route } from './routes';
import {
  awaitingPositions,
  buildScreen,
  draftFromConfig,
  firstOpenPosition,
  isRouteValid,
  modeAt,
  resumeVMOf,
  type PendingAnswer,
  type ViewInput,
} from './screenModels';
import type {
  BackupErrorVM,
  BackupFlowVM,
  BootState,
  ConfigDraft,
  PoolImportFlowVM,
  PreparationState,
  SafetyBackupVM,
  SaveAction,
  SaveStatus,
  StorageStatusVM,
  ToastKind,
  ToastVM,
} from './viewModels';

/* ========================================================================== */
/* Komunikaty                                                                 */
/* ========================================================================== */

const MSG_UNSAVED = 'Poprzednia zmiana nie została zapisana. Użyj „Spróbuj zapisać ponownie”.';
const MSG_NOT_READY = 'Aplikacja jeszcze się uruchamia.';
const MSG_NO_STORAGE_SUFFIX =
  ' Bez zapisu na tym urządzeniu nauka nie jest możliwa: odpowiedzi, przerwane sesje, wyniki i powtórki muszą być zapisywane lokalnie.';
const MSG_BANK_UNAVAILABLE =
  'Nie udało się wczytać pytań. Przy pierwszym uruchomieniu potrzebny jest internet — sprawdź połączenie i spróbuj ponownie. Po pełnym wczytaniu aplikacja działa bez internetu.';
const MSG_INTERNAL = 'Wystąpił nieoczekiwany błąd. Zmiana nie została zapisana — spróbuj ponownie.';
/** Import puli / wczytanie kopii przy niezapisanej zmianie (DECYZJE §1: najpierw ponowienie tej samej komendy). */
const MSG_UNSAVED_DATA =
  'Najpierw zapisz poprzednią zmianę („Spróbuj zapisać ponownie”). Dopiero potem można importować pulę lub wczytać kopię — dane na urządzeniu nie zostały zmienione.';

const MSG_CLOSING = 'Sesja jest właśnie zamykana.';

/** Import dodatkowych pul jest wyłączony (docs/MIGRACJA_V15.md). */
export const MSG_PACKS_DISABLED = 'Aplikacja używa wyłącznie banku pytań V15 — import dodatkowych pul pytań jest wyłączony.';
const MSG_MIGRATION_FAILED =
  'Aktualizacja danych nie powiodła się. Dane na urządzeniu pozostały w poprzedniej wersji i nie zostały usunięte; pytania będą dostępne po udanej aktualizacji. Spróbuj ponownie.';
const MSG_MIGRATION_BLOCKED =
  'Aktualizacja danych czeka: aplikacja jest otwarta w innej karcie lub oknie ze starszą wersją. Zamknij pozostałe karty z aplikacją i dotknij „Spróbuj ponownie”.';
const MSG_CONTENT_UPDATE_FAILED =
  'Nie udało się uruchomić nowej wersji banku pytań. Sprawdź połączenie z internetem i spróbuj ponownie.';
/** Czas na przejęcie strony przez nową wersję po wykryciu nowszego banku (potem — błąd z ponowieniem). */
const CONTENT_UPDATE_TIMEOUT_MS = 60_000;
/** Limit czasu sprawdzenia pliku wydania przy starcie (offline/wolna sieć nie blokuje nauki). */
const RELEASE_CHECK_TIMEOUT_MS = 2500;

const TOAST_HIDE_MS = 4500;

/* ========================================================================== */
/* Typy wewnętrzne                                                            */
/* ========================================================================== */

interface CommandSpec<V> {
  action: SaveAction;
  /** Komenda domeny na bieżącym trwałym stanie i katalogu. */
  run: (user: UserState, catalog: Catalog, ctx: CommandContext) => DomainCommandResult<V>;
  /** Po udanym zapisie (nowy stan jest już trwały). */
  onSaved?: (value: V, outcome: DomainOutcome<V>) => void;
  /** Zapis w tle (`markShown`, znacznik prośby o trwałe przechowywanie): bez stanu „zapisywanie” i bez komunikatu. */
  background?: boolean;
  /** Odpowiedź pokazywana jako `pending` do czasu zapisu. */
  pendingAnswer?: PendingAnswer;
}

/** Niezapisana zmiana czekająca na „Spróbuj zapisać ponownie”. */
interface PendingSave {
  commandId: string;
  action: SaveAction;
  changeset: Changeset;
  /** Stan, z którego wyszła domena (ponowienie ma sens tylko na tym samym stanie). */
  base: UserState;
  next: UserState;
  onSaved: () => void;
  failures: number;
  background: boolean;
}

function okResult(): ActionResult {
  return { ok: true };
}

function failResult(code: string, messagePl: string): ActionResult {
  return { ok: false, code, messagePl };
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'messagePl' in error && typeof (error as { messagePl: unknown }).messagePl === 'string') {
    return (error as { messagePl: string }).messagePl;
  }
  return fallback;
}

function backupErrorVM(error: PersistenceError): BackupErrorVM {
  return {
    code: error.code,
    messagePl: error.messagePl,
    reasonsPl: error.code === 'InvalidBackup' ? error.reasonsPl : [],
    foundVersion: error.code === 'UnsupportedBackupVersion' ? error.foundVersion : null,
  };
}

/** Port PWA z opcjonalną flagą „zaktualizowano” (ServiceWorkerPwa z src/pwa/registerSW.ts). */
function consumeUpdatedFlag(pwa: ControllerDeps['pwa']): boolean {
  const candidate = pwa as Partial<{ consumeUpdatedFlag: () => boolean }>;
  try {
    return typeof candidate.consumeUpdatedFlag === 'function' ? candidate.consumeUpdatedFlag() === true : false;
  } catch {
    return false;
  }
}

/* ========================================================================== */
/* Kontroler                                                                  */
/* ========================================================================== */

export const createAppController: CreateAppController = (deps: ControllerDeps): AppController => {
  const { repository, platform, pwa, appVersion } = deps;

  /* ---------- stan ---------- */
  let boot: BootState = { phase: 'loading', stage: 'opening-storage' };
  let bank: RuntimeBank | null = null;
  let catalog: Catalog | null = null;
  let retiredIds: string[] = [];
  let profile: TrainingProfile | null = null;
  let user: UserState | null = null;
  /** Wykryto nowszą wersję treści — przeładowanie przed pokazaniem pytań. */
  let contentUpdating = false;
  let route: Route = HOME_ROUTE;
  let viewPosition = 0;
  let drafts: Record<SessionKind, ConfigDraft> = {
    test: draftFromConfig(initialTestConfig(defaultSettings()), DEFAULT_TEST_N),
    freeflow: draftFromConfig(initialFreeFlowConfig(defaultSettings()), DEFAULT_TEST_N),
  };
  let starting = false;
  let save: SaveStatus = { status: 'idle' };
  let pending: PendingSave | null = null;
  let pendingAnswer: PendingAnswer | null = null;
  let toast: ToastVM | null = null;
  let undo: UndoToken | null = null;
  let ffNotice: SessionId | null = null;
  let reviewOrigin: ResultOrigin = 'history';
  let historyFilter: HistoryFilter = { kind: 'all' };
  let selectedPoint: SessionId | null = null;
  let backupFlow: BackupFlowVM = { step: 'idle', lastSavedFileName: null };
  let validatedBackup: ValidatedBackup | null = null;
  /** Lista automatycznych kopii bezpieczeństwa (F03); `null` — jeszcze nie wczytana. */
  let safetyBackups: SafetyBackupVM[] | null = null;
  let poolFlow: PoolImportFlowVM = { step: 'idle' };
  let online = true;
  let needRefresh = false;
  let updateApplying = false;
  let preparation: PreparationState | null = null;
  let storage: StorageStatusVM = { persisted: null, usageBytes: null, quotaBytes: null };
  let persistAsked = false;
  let started = false;
  let booting: Promise<void> | null = null;
  let disposed = false;

  const listeners = new Set<() => void>();
  const unsubscribers: Array<() => void> = [];
  /** Sloty, dla których zlecono już `markShown` (bez ponawiania w pętli). */
  const shownRequested = new Set<string>();

  /** Ostatnia trasa zapisana w / odczytana z `location.hash` i tryb kolejnego zapisu. */
  let hashRoute: Route | null = null;
  let hashMode: 'push' | 'replace' = 'replace';

  /* ---------- kolejka komend ---------- */
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  /* ---------- publikacja ---------- */

  function isReady(): boolean {
    return boot.phase === 'ready' && catalog !== null && user !== null;
  }

  function viewInput(): ViewInput {
    return {
      catalog: catalog as Catalog,
      user: user as UserState,
      now: platform.nowIso(),
      route,
      viewPosition,
      drafts,
      starting,
      pendingAnswer,
      ffNotice,
      historyFilter,
      selectedPoint,
      backupFlow,
      safetyBackups,
      poolFlow,
      appVersion,
      installHint: true,
    };
  }

  function buildState(): AppState {
    let screen = null;
    if (isReady()) {
      if (!isRouteValid(route, user as UserState)) {
        route = HOME_ROUTE;
        hashMode = 'replace';
      }
      screen = buildScreen(viewInput());
      if (screen === null) {
        route = HOME_ROUTE;
        hashMode = 'replace';
        screen = buildScreen(viewInput());
      }
    }
    const next: AppState = {
      boot,
      route,
      screen,
      catalog,
      userState: user,
      resume: isReady() ? resumeVMOf(catalog as Catalog, user as UserState) : null,
      save,
      toast,
      online,
      update: { available: needRefresh, canApplyNow: false, applying: updateApplying },
      preparation,
      storage,
      appVersion,
    };
    next.update = { available: needRefresh, canApplyNow: needRefresh && !updateApplying && isUpdateSafe(next), applying: updateApplying };
    return next;
  }

  let state: AppState = buildState();

  function publish(): void {
    if (disposed) return;
    state = buildState();
    for (const l of [...listeners]) {
      try {
        l();
      } catch (error) {
        console.error('[DME] Błąd subskrybenta stanu', error);
      }
    }
    syncHash();
    scheduleMarkShown();
  }

  function syncHash(): void {
    if (!isReady()) return;
    if (hashRoute && sameRoute(hashRoute, route)) {
      hashMode = 'push';
      return;
    }
    try {
      platform.setHash(routeToHash(route), hashMode);
    } catch (error) {
      console.warn('[DME] Nie udało się zapisać adresu', error);
    }
    hashRoute = route;
    hashMode = 'push';
  }

  function showToast(kind: ToastKind, params: Record<string, string | number> = {}, canUndo = false): void {
    toast = { id: platform.randomId(), kind, canUndo, autoHideMs: canUndo ? null : TOAST_HIDE_MS, params };
  }

  /**
   * Komunikat o odrzuconej akcji. Gdy widoczny jest toast z WAŻNYM „Cofnij”, błąd nie może go zastąpić
   * (LOG-05: utrata możliwości cofnięcia zgłoszenia) — toast zostaje, a błąd idzie osobnym kanałem
   * (`alertPl`, w UI `role="alert"`).
   */
  function showFailure(messagePl: string): void {
    if (toast?.canUndo && undo && user && isUndoValid(user, undo)) {
      toast = { ...toast, alertPl: messagePl };
      return;
    }
    showToast('action_failed', { messagePl });
  }

  /** „Cofnij” wygasa przy każdej mutacji punktowej sesji (odpowiedź, zgłoszenie, zamknięcie…). */
  function validateUndo(): void {
    if (undo && (!user || !isUndoValid(user, undo))) {
      undo = null;
      if (toast?.canUndo) toast = null;
    }
  }

  function dropUndo(): void {
    undo = null;
    if (toast?.canUndo) toast = null;
  }

  /* ---------- trasy ---------- */

  function enterQuestion(sessionId: SessionId, position: number): void {
    route = { name: 'question', sessionId };
    viewPosition = Math.max(0, position);
  }

  function currentSession(): Session | null {
    if (route.name !== 'question' || !user) return null;
    const s = user.sessions[route.sessionId];
    return s && s.status === 'open' ? s : null;
  }

  function currentPosition(s: Session): number {
    return Math.max(0, Math.min(viewPosition, s.reached, s.plan.length - 1));
  }

  function currentSlot(): { session: Session; slot: Slot; position: number } | null {
    const s = currentSession();
    if (!s) return null;
    const position = currentPosition(s);
    const id = s.plan[position];
    const slot = id ? s.slots[id] : undefined;
    return slot ? { session: s, slot, position } : null;
  }

  /* ---------- markShown (DECYZJE §6 pkt 6) ---------- */

  function scheduleMarkShown(): void {
    if (!isReady() || pending) return;
    const cur = currentSlot();
    if (!cur || cur.slot.shownAt !== null || cur.slot.attempt !== null) return;
    if (modeAt(cur.session, cur.position) !== 'live') return;
    const key = `${cur.session.id}:${cur.slot.id}`;
    if (shownRequested.has(key)) return;
    shownRequested.add(key);
    const sessionId = cur.session.id;
    const slotId = cur.slot.id;
    void execute({
      action: 'mark-shown',
      background: true,
      run: (u, _c, ctx) => markShown(u, { sessionId, slotId }, ctx),
    });
  }

  /* ---------- wykonanie komendy ---------- */

  function makeContext(): CommandContext {
    const now = platform.nowIso();
    return { now, nextDayStart: platform.nextDayStartIso(now), commandId: platform.randomId(), newId: () => platform.randomId() };
  }

  function clearPendingAnswer(spec: { pendingAnswer?: PendingAnswer }): void {
    if (spec.pendingAnswer && pendingAnswer === spec.pendingAnswer) pendingAnswer = null;
  }

  async function settle(p: PendingSave, result: Awaited<ReturnType<typeof repository.commit>>, answerRef: PendingAnswer | undefined): Promise<ActionResult> {
    if (result.ok) {
      user = p.next;
      pending = null;
      save = { status: 'idle' };
      if (answerRef && pendingAnswer === answerRef) pendingAnswer = null;
      p.onSaved();
      validateUndo();
      publish();
      afterSaved(p.action);
      return okResult();
    }
    const error = result.error;
    if (p.background) {
      console.warn('[DME] Zapis w tle nie powiódł się', error.code);
      return failResult(error.code, error.messagePl);
    }
    if (error.code === 'Conflict') {
      // Dane zmieniono gdzie indziej (np. w innej karcie): odśwież stan z bazy, zmiana porzucona jawnie.
      pending = null;
      save = { status: 'idle' };
      if (answerRef && pendingAnswer === answerRef) pendingAnswer = null;
      await reloadUserData();
      validateUndo();
      showFailure(error.messagePl);
      publish();
      return failResult(error.code, error.messagePl);
    }
    p.failures += 1;
    pending = p;
    save = { status: 'error', commandId: p.commandId, action: p.action, code: error.code, messagePl: error.messagePl, failures: p.failures };
    publish();
    return failResult(error.code, error.messagePl);
  }

  /** Komendy użytkownika przyjęte do kolejki, a jeszcze nie zakończone (synchronicznie — przed startem zadania). */
  let userCommandsInFlight = 0;

  function execute<V>(spec: CommandSpec<V>): Promise<ActionResult> {
    if (spec.background) return runCommand(spec);
    userCommandsInFlight += 1;
    const done = (): void => {
      userCommandsInFlight -= 1;
    };
    const result = runCommand(spec);
    result.then(done, done);
    return result;
  }

  function runCommand<V>(spec: CommandSpec<V>): Promise<ActionResult> {
    return enqueue(async () => {
      if (!isReady() || disposed) {
        clearPendingAnswer(spec);
        return failResult('NOT_READY', MSG_NOT_READY);
      }
      if (pending) {
        clearPendingAnswer(spec);
        if (!spec.background) publish();
        return failResult('UNSAVED_PENDING', MSG_UNSAVED);
      }
      const base = user as UserState;
      const ctx = makeContext();
      let result: DomainCommandResult<V>;
      try {
        result = spec.run(base, catalog as Catalog, ctx);
      } catch (error) {
        console.error('[DME] Błąd komendy domeny', error);
        result = { ok: false, error: { code: 'INVALID_CONFIG', messagePl: MSG_INTERNAL } };
      }
      if (!result.ok) {
        clearPendingAnswer(spec);
        if (!spec.background) {
          showFailure(result.error.messagePl);
          publish();
        }
        return failResult(result.error.code, result.error.messagePl);
      }
      const outcome = result.value;
      const p: PendingSave = {
        commandId: ctx.commandId,
        action: spec.action,
        changeset: outcome.changeset,
        base,
        next: outcome.state,
        onSaved: () => spec.onSaved?.(outcome.value, outcome),
        failures: 0,
        background: spec.background === true,
      };
      if (isChangesetEmpty(outcome.changeset)) {
        // Nic do zapisania (np. idempotentne powtórzenie) — stan bez zmian.
        return settle(p, { ok: true, value: { written: 0, deleted: 0 } }, spec.pendingAnswer);
      }
      if (!p.background) {
        save = { status: 'saving', commandId: ctx.commandId, action: spec.action };
        publish();
      }
      let commit: Awaited<ReturnType<typeof repository.commit>>;
      try {
        commit = await repository.commit(outcome.changeset);
      } catch (error) {
        commit = { ok: false, error: { code: 'WriteFailed', messagePl: errorMessage(error, MSG_INTERNAL) } };
      }
      return settle(p, commit, spec.pendingAnswer);
    });
  }

  function afterSaved(action: SaveAction): void {
    if (action === 'answer' && !persistAsked && user && user.settings.persistRequestedAt === null) {
      persistAsked = true;
      void requestPersistInBackground();
    }
  }

  async function requestPersistInBackground(): Promise<void> {
    try {
      await repository.storage.requestPersist();
    } catch {
      /* prośba, nie gwarancja */
    }
    await refreshStorage();
    await execute({ action: 'settings', background: true, run: (u, _c, ctx) => updateSettings(u, { persistRequestedAt: ctx.now }, ctx) });
  }

  async function refreshStorage(): Promise<void> {
    try {
      const [persisted, estimate] = await Promise.all([repository.storage.persisted(), repository.storage.estimate()]);
      storage = { persisted, usageBytes: estimate?.usageBytes ?? null, quotaBytes: estimate?.quotaBytes ?? null };
      publish();
    } catch {
      /* status pozostaje nieznany */
    }
  }

  /** Katalog WYŁĄCZNIE z banku V15 (bez paczek), z wyłączonymi ID i profilem; asercja wersji i liczb. */
  function buildContentCatalog(): ReturnType<typeof buildCatalog> {
    if (!bank) return { ok: false, error: { code: 'INVALID_BANK', messagePl: 'Brak banku pytań.' } };
    const built = buildCatalog(bank, { retiredQuestionIds: retiredIds, profile, requiredBankVersion: CONTENT_RELEASE.bankVersion });
    if (!built.ok) return built;
    const sum = built.value.bankSummary;
    const c = CONTENT_RELEASE.counts;
    if (
      sum.questions !== c.questions ||
      built.value.questions.length !== c.questions ||
      (sum.byDifficulty.basic ?? 0) !== c.basic ||
      (sum.byDifficulty.intermediate ?? 0) !== c.intermediate ||
      (sum.byDifficulty.advanced ?? 0) !== c.advanced ||
      built.value.retiredQuestionIds.length !== c.retired
    ) {
      return { ok: false, error: { code: 'INVALID_BANK', messagePl: 'Liczby pytań w pliku nie zgadzają się z bankiem V15.' } };
    }
    return built;
  }

  async function reloadUserData(): Promise<boolean> {
    const loaded = await repository.loadUserState();
    if (!loaded.ok || !bank) return false;
    const built = buildContentCatalog();
    if (!built.ok) return false;
    user = loaded.value;
    catalog = built.value;
    return true;
  }

  function resetDrafts(): void {
    if (!user) return;
    drafts = {
      test: draftFromConfig(initialTestConfig(user.settings), DEFAULT_TEST_N),
      freeflow: draftFromConfig(initialFreeFlowConfig(user.settings), DEFAULT_TEST_N),
    };
  }

  /* ---------- uruchomienie ---------- */

  function fatal(code: Extract<BootState, { phase: 'fatal' }>['code'], messagePl: string): void {
    boot = { phase: 'fatal', code, messagePl, canRetry: true };
    publish();
  }

  function storageFatal(error: PersistenceError): void {
    // Migracja do V15 nieudana albo zablokowana: baza zostaje w poprzedniej wersji, pytań nie pokazujemy.
    if (error.code === 'MigrationFailed') fatal('MIGRATION_FAILED', MSG_MIGRATION_FAILED);
    else if (error.code === 'Blocked') fatal('MIGRATION_BLOCKED', MSG_MIGRATION_BLOCKED);
    else if (error.code === 'Unavailable' || error.code === 'QuotaExceeded') fatal('STORAGE_UNAVAILABLE', error.messagePl + MSG_NO_STORAGE_SUFFIX);
    else fatal('STORAGE_UNAVAILABLE', error.messagePl);
  }

  async function runBoot(): Promise<void> {
    boot = { phase: 'loading', stage: 'opening-storage' };
    publish();
    // Migracja schematu (podmiana treści na V15) — komunikat „Aktualizacja banku pytań…”.
    repository.setUpgradeListener((info) => {
      if (info.from > 0) {
        boot = { phase: 'loading', stage: 'migrating' };
        publish();
      }
    });
    let opened;
    try {
      opened = await repository.open();
    } catch (error) {
      opened = { ok: false as const, error: { code: 'Unavailable' as const, messagePl: errorMessage(error, 'Lokalna baza danych jest niedostępna.') } };
    }
    if (!opened.ok) {
      storageFatal(opened.error);
      return;
    }

    boot = { phase: 'loading', stage: 'loading-bank' };
    publish();
    if (!bank) {
      let raw: unknown;
      try {
        raw = await deps.loadBank();
      } catch (error) {
        console.warn('[DME] Wczytanie banku nie powiodło się', error);
        fatal('BANK_UNAVAILABLE', MSG_BANK_UNAVAILABLE);
        return;
      }
      const content = parseContent(raw);
      if (!content.ok) {
        fatal('BANK_INVALID', `Plik pytań jest uszkodzony albo nie jest bankiem V15. ${content.messagePl}`);
        return;
      }
      bank = content.bank;
      retiredIds = content.retired;
      profile = content.profile;
    }

    boot = { phase: 'loading', stage: 'loading-user-data' };
    publish();
    const loaded = await repository.loadUserState();
    if (!loaded.ok) {
      storageFatal(loaded.error);
      return;
    }
    const built = buildContentCatalog();
    if (!built.ok) {
      fatal('BANK_INVALID', `Nie udało się zbudować katalogu pytań. ${built.error.messagePl}`);
      return;
    }
    // Nowsza wersja treści na serwerze (np. V16) — przeładowanie PRZED pokazaniem pytań (fallback, gdy
    // nowy Service Worker nie przejął strony sam). Offline / brak pliku: start na bieżącym banku V15.
    if (await newerContentAvailable()) {
      void startContentUpdate();
      return;
    }
    user = loaded.value;
    catalog = built.value;
    if (catalog.issues.length > 0) console.warn(`[DME] Pominięto ${catalog.issues.length} niepoprawnych rekordów pytań`, catalog.issues);
    resetDrafts();

    // Trasa z adresu (odświeżenie dowolnego ekranu, DECYZJE §11).
    const fromHash = parseHash(platform.getHash());
    hashRoute = fromHash;
    hashMode = 'replace';
    applyRoute(fromHash);
    boot = { phase: 'ready' };
    if (consumeUpdatedFlag(pwa)) showToast('app_updated');
    publish();
    void refreshStorage();
    // Nowy bank (np. po aktualizacji aplikacji) może uzupełnić pozycje czekające na zastępstwo (LOG-02).
    void fillAwaitingIfNeeded(true);
  }

  type ParsedContent = { ok: true; bank: RuntimeBank; retired: string[]; profile: TrainingProfile } | { ok: false; messagePl: string };

  /** Asercja treści V15: SHA-256 pliku, `bank_version` wszystkich trzech plików, kształt. */
  function parseContent(raw: unknown): ParsedContent {
    if (typeof raw !== 'object' || raw === null || !('bank' in raw)) return { ok: false, messagePl: 'Brak pliku banku.' };
    const bundle = raw as { bank: unknown; retired: unknown; profile: unknown; bankSha256: string | null };
    if (bundle.bankSha256 !== null && bundle.bankSha256 !== CONTENT_RELEASE.bankSha256) {
      return { ok: false, messagePl: 'Suma kontrolna pliku pytań nie zgadza się z bankiem V15.' };
    }
    const parsed = parseRuntimeBank(bundle.bank);
    if (!parsed.ok) return { ok: false, messagePl: parsed.error.messagePl };
    if (parsed.value.bank_version !== CONTENT_RELEASE.bankVersion) {
      return { ok: false, messagePl: `Nieoczekiwana wersja banku (${parsed.value.bank_version}).` };
    }
    const retired = parseRetiredIds(bundle.retired, CONTENT_RELEASE.bankVersion);
    if (!retired.ok) return { ok: false, messagePl: retired.error.messagePl };
    const prof = parseTrainingProfile(bundle.profile, CONTENT_RELEASE.bankVersion);
    if (!prof.ok) return { ok: false, messagePl: prof.error.messagePl };
    return { ok: true, bank: parsed.value, retired: retired.value, profile: prof.value };
  }

  /** Plik wydania na serwerze wskazuje inną wersję banku niż ta aplikacja. */
  async function newerContentAvailable(): Promise<boolean> {
    if (!pwa.checkRelease || !platform.isOnline()) return false;
    try {
      const release = await Promise.race([
        pwa.checkRelease(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), RELEASE_CHECK_TIMEOUT_MS)),
      ]);
      return release !== null && release.bankVersion !== CONTENT_RELEASE.bankVersion;
    } catch {
      return false;
    }
  }

  /** Nowsza wersja treści: ekran „Aktualizacja banku pytań…”, przejęcie przez nowy SW albo przeładowanie. */
  async function startContentUpdate(): Promise<void> {
    if (contentUpdating || disposed) return;
    // Niezapisana zmiana w toku — najpierw zapis (kolejka komend), potem przeładowanie.
    await queue;
    contentUpdating = true;
    boot = { phase: 'loading', stage: 'content-update' };
    publish();
    try {
      await Promise.race([
        pwa.reloadForContentUpdate ? pwa.reloadForContentUpdate() : Promise.resolve(),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), CONTENT_UPDATE_TIMEOUT_MS)),
      ]);
    } catch {
      contentUpdating = false;
      fatal('CONTENT_UPDATE_FAILED', MSG_CONTENT_UPDATE_FAILED);
    }
  }

  function boot_(): Promise<void> {
    if (!booting) {
      booting = runBoot()
        .catch((error: unknown) => {
          console.error('[DME] Błąd uruchomienia', error);
          fatal('UNKNOWN', 'Wystąpił nieoczekiwany błąd przy uruchamianiu aplikacji.');
        })
        .finally(() => {
          booting = null;
        });
    }
    return booting;
  }

  /** Ustawienie trasy z zewnątrz (adres, przycisk Wstecz przeglądarki) z normalizacją. */
  function applyRoute(target: Route): void {
    if (!user) {
      route = target;
      return;
    }
    switch (target.name) {
      case 'question': {
        const s = user.sessions[target.sessionId];
        if (s && s.status === 'open') enterQuestion(s.id, s.reached);
        else route = HOME_ROUTE;
        return;
      }
      case 'review':
        if (route.name !== 'reviewItem') reviewOrigin = route.name === 'result' || route.name === 'freeflowSummary' ? route.origin : reviewOrigin;
        route = target;
        return;
      case 'history':
        selectedPoint = null;
        route = target;
        return;
      default:
        route = target;
    }
  }

  /* ---------- PWA i sieć ---------- */

  function subscribeEnvironment(): void {
    online = platform.isOnline();
    unsubscribers.push(
      platform.onOnlineChange((value) => {
        online = value;
        publish();
      }),
      platform.onHashChange((hash) => {
        if (!isReady()) return;
        const target = parseHash(hash);
        hashRoute = target;
        if (sameRoute(target, route)) return;
        hashMode = 'replace';
        applyRoute(target);
        publish();
        hashMode = 'push';
      }),
      pwa.onNeedRefresh(() => {
        needRefresh = true;
        publish();
      }),
      pwa.onOfflineReady(() => {
        preparation = null;
        publish();
      }),
      pwa.onPreparationProgress((p) => {
        preparation = { status: 'running', done: p.done, total: p.total };
        publish();
      }),
      pwa.onPreparationError((p) => {
        preparation = { status: 'failed', done: p.done, total: p.total };
        publish();
      }),
    );
    if (pwa.onContentUpdate) {
      unsubscribers.push(
        pwa.onContentUpdate((info) => {
          if (info.bankVersion !== CONTENT_RELEASE.bankVersion) void startContentUpdate();
        }),
      );
    }
  }

  /* ---------- pomocnicze akcje ---------- */

  /**
   * Ponowna próba obsadzenia pozycji czekających na zastępstwo (DECYZJE §4, 03_ARCH §4: test „może być
   * kontynuowany po dostarczeniu dopuszczalnych pytań”). Wywoływana po imporcie puli, „Przywróć”,
   * po uruchomieniu (np. nowy `bank.json` po aktualizacji aplikacji) i przy „Kontynuuj”.
   * `background` — próba okazjonalna: bez stanu „zapisywanie”; nieudany zapis nie zostawia
   * niezapisanej zmiany (kolejna próba przy następnym uruchomieniu/wznowieniu).
   */
  async function fillAwaitingIfNeeded(background = false): Promise<void> {
    if (!user) return;
    const s = activeSession(user);
    if (!s || s.kind !== 'test' || s.awaitingReplacement.length === 0) return;
    const sessionId = s.id;
    await execute({
      action: 'fill-replacement',
      background,
      run: (u, c, ctx) => {
        const fresh = u.sessions[sessionId];
        return fillAwaitingReplacements(u, c, { sessionId, expectedRevision: fresh?.revision ?? -1 }, ctx);
      },
    });
  }

  async function refreshSafetyBackups(): Promise<void> {
    try {
      const r = await repository.listBackups();
      if (!r.ok) {
        console.warn('[DME] Nie udało się odczytać listy kopii bezpieczeństwa', r.error.code);
        return;
      }
      safetyBackups = r.value.map((b) => ({ id: b.id, createdAt: b.createdAt, fileName: b.fileName, sizeBytes: b.sizeBytes }));
      publish();
    } catch (error) {
      console.warn('[DME] Nie udało się odczytać listy kopii bezpieczeństwa', error);
    }
  }

  function startSession<V extends { sessionId: SessionId }>(
    run: (u: UserState, c: Catalog, ctx: CommandContext) => DomainCommandResult<V>,
    onStarted?: (value: V, outcome: DomainOutcome<V>) => void,
  ): Promise<ActionResult> {
    starting = true;
    publish();
    return execute<V>({
      action: 'start-session',
      run,
      onSaved: (value, outcome) => {
        dropUndo();
        toast = null;
        ffNotice = null;
        enterQuestion(value.sessionId, 0);
        onStarted?.(value, outcome);
      },
    }).finally(() => {
      starting = false;
      publish();
    });
  }

  /** Zapis w toku albo niezapisana zmiana — kolejne dotknięcie (np. podwójne „Dalej”) jest ignorowane. */
  function busy(): ActionResult | null {
    if (save.status === 'saving' || userCommandsInFlight > 0) return failResult('BUSY', 'Trwa zapis poprzedniej zmiany.');
    if (save.status === 'error') return failResult('UNSAVED_PENDING', MSG_UNSAVED);
    return null;
  }

  /** Sesje w trakcie zamykania („Zakończ sesję”, „Zamknij test bez wyniku”) — blokada podwójnego wywołania (LOG-06). */
  const closing = new Set<SessionId>();

  function guardClosing(sessionId: SessionId, run: Promise<ActionResult>): Promise<ActionResult> {
    closing.add(sessionId);
    return run.finally(() => {
      closing.delete(sessionId);
    });
  }

  function hasEvent(events: readonly DmeEvent[], type: DmeEvent['type']): boolean {
    return events.some((e) => e.type === type);
  }

  function openSessionById(sessionId: SessionId | undefined, kind: SessionKind): Session | null {
    if (!user) return null;
    const s = sessionId ? user.sessions[sessionId] : activeSession(user);
    return s && s.status === 'open' && s.kind === kind ? s : null;
  }

  /* ========================================================================== */
  /* Kontroler (metody bez `this`)                                             */
  /* ========================================================================== */

  const controller: AppController = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async start() {
      if (started) return booting ?? undefined;
      started = true;
      subscribeEnvironment();
      await boot_();
    },
    async retryBoot() {
      if (boot.phase === 'ready') return;
      if (boot.phase === 'fatal' && boot.code === 'CONTENT_UPDATE_FAILED') {
        void startContentUpdate();
        return;
      }
      await boot_();
    },
    dispose() {
      disposed = true;
      for (const u of unsubscribers.splice(0)) {
        try {
          u();
        } catch {
          /* ignoruj */
        }
      }
      listeners.clear();
    },

    /* ---------- Nawigacja ---------- */

    navigate(next) {
      if (!isReady()) return;
      applyRoute(next);
      publish();
    },
    goBack() {
      switch (route.name) {
        case 'result':
          route = route.origin === 'history' ? { name: 'history', tab: 'tests' } : HOME_ROUTE;
          break;
        case 'freeflowSummary':
          route = route.origin === 'history' ? { name: 'history', tab: 'freeflow' } : HOME_ROUTE;
          break;
        case 'review': {
          const s = user?.sessions[route.sessionId];
          route =
            s?.kind === 'freeflow'
              ? { name: 'freeflowSummary', sessionId: route.sessionId, origin: reviewOrigin }
              : { name: 'result', sessionId: route.sessionId, origin: reviewOrigin };
          break;
        }
        case 'reviewItem':
          route = { name: 'review', sessionId: route.sessionId, filter: route.filter };
          break;
        case 'backup':
        case 'poolImport':
        case 'excluded':
        case 'about':
          route = { name: 'settings' };
          break;
        default:
          route = HOME_ROUTE;
      }
      publish();
    },
    goHome() {
      route = HOME_ROUTE;
      publish();
    },

    /* ---------- Start ---------- */

    resume() {
      if (!user) return;
      const s = activeSession(user);
      if (!s) return;
      enterQuestion(s.id, s.reached);
      publish();
      if (s.kind === 'test' && s.awaitingReplacement.length > 0) void fillAwaitingIfNeeded(true);
    },
    dismissInstallHint() {
      return execute({ action: 'settings', run: (u, _c, ctx) => updateSettings(u, { installHintDismissedAt: ctx.now }, ctx) });
    },

    /* ---------- Konfiguracja ---------- */

    openConfig(mode) {
      if (!isReady()) return;
      resetDrafts();
      route = { name: 'config', mode };
      publish();
    },
    updateConfigDraft(patch) {
      if (route.name !== 'config') return;
      drafts = { ...drafts, [route.mode]: { ...drafts[route.mode], ...patch } };
      publish();
    },
    async startTest() {
      if (!isReady() || starting) return failResult('NOT_ALLOWED', MSG_NOT_READY);
      const draft = drafts.test;
      const cap = capacityFor(catalog as Catalog, user as UserState, draft.scope, draft.difficulty);
      const v = validateTestN(draft.nText, cap);
      if (!v.ok) return failResult('INVALID_N', 'Nieprawidłowa liczba pytań.');
      const config: SessionConfig = { scope: draft.scope, difficulty: draft.difficulty, targetN: v.n, myErrorsPriority: draft.myErrorsPriority };
      const seed = platform.randomSeed();
      return startSession((u, c, ctx) => domainStartTest(u, c, { config, seed }, ctx));
    },
    async startFreeFlow() {
      if (!isReady() || starting) return failResult('NOT_ALLOWED', MSG_NOT_READY);
      const draft = drafts.freeflow;
      const config: SessionConfig = { scope: draft.scope, difficulty: draft.difficulty, targetN: null, myErrorsPriority: draft.myErrorsPriority };
      const seed = platform.randomSeed();
      const started_: { emptySessionId: SessionId | null } = { emptySessionId: null };
      const r = await startSession(
        (u, c, ctx) => domainStartFreeFlow(u, c, { config, seed }, ctx),
        (value, outcome) => {
          if (hasEvent(outcome.events, 'my_errors_exhausted')) ffNotice = value.sessionId;
          if (value.firstSlotId === null) started_.emptySessionId = value.sessionId;
        },
      );
      const id = started_.emptySessionId;
      if (id !== null) {
        // Pusta pula (np. wszystkie pytania zakresu wykluczone) — sesja bez pytań nie zostaje otwarta.
        await execute({
          action: 'end-freeflow',
          run: (u, _c, ctx) => domainEndFreeFlow(u, { sessionId: id, expectedRevision: u.sessions[id]?.revision ?? -1 }, ctx),
          onSaved: () => {
            route = { name: 'config', mode: 'freeflow' };
            showFailure('W tym zakresie nie ma dostępnych pytań. Wybierz szerszy zakres albo przywróć wykluczone pytania.');
          },
        });
        return failResult('EMPTY_POOL', 'W tym zakresie nie ma dostępnych pytań.');
      }
      return r;
    },

    /* ---------- Pytanie ---------- */

    async answer(optionId) {
      const cur = currentSlot();
      if (!cur || modeAt(cur.session, cur.position) !== 'live') return failResult('NOT_ALLOWED', 'Odpowiedź niedostępna.');
      if (cur.slot.attempt || cur.slot.excluded) return failResult('NOT_ALLOWED', 'Na to pytanie udzielono już odpowiedzi.');
      if (pendingAnswer) return failResult('PENDING', 'Poprzednia odpowiedź czeka na zapis.');
      if (pending) return failResult('UNSAVED_PENDING', MSG_UNSAVED);
      // LOG-05: równoczesne zgłoszenie (albo inna komenda w toku) — dotknięcie odpowiedzi jest ignorowane,
      // zamiast trafić do kolejki za zgłoszeniem i po nim zakończyć się błędem zabierającym „Cofnij”.
      const blocked = busy();
      if (blocked) return blocked;
      if (!cur.slot.optionOrder.includes(optionId)) return failResult('OPTION_NOT_FOUND', 'Nieznana odpowiedź.');
      const sessionId = cur.session.id;
      const slotId = cur.slot.id;
      const ref: PendingAnswer = { sessionId, slotId, optionId };
      pendingAnswer = ref;
      publish();
      return execute({
        action: 'answer',
        pendingAnswer: ref,
        run: (u, _c, ctx) => {
          const s = u.sessions[sessionId];
          return domainAnswer(u, { sessionId, expectedRevision: s?.revision ?? -1, slotId, optionId }, ctx);
        },
      });
    },
    async next() {
      const blocked = busy();
      if (blocked) return blocked;
      const s = currentSession();
      if (!s) return failResult('NOT_ALLOWED', 'Brak otwartej sesji.');
      const pos = currentPosition(s);
      const slotId = s.plan[pos];
      const slot = slotId ? s.slots[slotId] : undefined;
      if (!slot) return failResult('NOT_ALLOWED', 'Brak pytania.');
      if (modeAt(s, pos) === 'preview') {
        viewPosition = Math.min(pos + 1, s.reached);
        publish();
        return okResult();
      }
      if (!slot.attempt && !slot.excluded) return failResult('SLOT_NOT_ANSWERED', 'Najpierw odpowiedz na pytanie.');
      if (pos < s.reached) {
        viewPosition = pos + 1;
        publish();
        return okResult();
      }
      const sessionId = s.id;
      if (s.kind === 'test') {
        if (pos >= s.plan.length - 1) {
          // Najpierw wcześniejsza pozycja bez odpowiedzi (zastępstwo), potem pozycja czekająca na zastępstwo (S24g).
          const open = firstOpenPosition(s) ?? awaitingPositions(s).find((i) => i !== pos) ?? null;
          if (open === null) {
            return s.awaitingReplacement.length > 0
              ? failResult('AWAITING_REPLACEMENT', 'Ta pozycja czeka na pytanie zastępcze — wynik będzie dostępny po jej uzupełnieniu.')
              : failResult('LAST', 'To ostatnia pozycja testu — użyj „Pokaż wynik”.');
          }
          viewPosition = open;
          publish();
          return okResult();
        }
        return execute({
          action: 'advance',
          run: (u, _c, ctx) => domainAdvance(u, { sessionId, expectedRevision: u.sessions[sessionId]?.revision ?? -1 }, ctx),
          onSaved: (value) => {
            if (route.name === 'question' && route.sessionId === sessionId) viewPosition = value.reached;
          },
        });
      }
      return execute({
        action: 'next-freeflow',
        run: (u, c, ctx) => nextFreeFlowSlot(u, c, { sessionId, expectedRevision: u.sessions[sessionId]?.revision ?? -1 }, ctx),
        onSaved: (value) => {
          ffNotice = value.myErrorsExhausted ? sessionId : null;
          const fresh = user?.sessions[sessionId];
          if (fresh && route.name === 'question' && route.sessionId === sessionId) viewPosition = fresh.reached;
        },
      });
    },
    showPrevious() {
      const s = currentSession();
      if (!s) return;
      const pos = currentPosition(s);
      if (pos <= 0) return;
      viewPosition = pos - 1;
      publish();
    },
    backToCurrent() {
      const s = currentSession();
      if (!s) return;
      viewPosition = s.reached;
      publish();
    },
    async report() {
      if (!isReady()) return failResult('NOT_READY', MSG_NOT_READY);
      const blocked = busy();
      if (blocked) return blocked;
      if (route.name === 'reviewItem') {
        const s = (user as UserState).sessions[route.sessionId];
        const slot = s?.slots[route.slotId];
        if (!s || !slot) return failResult('SLOT_NOT_FOUND', 'Nie znaleziono pytania.');
        const sessionId = s.id;
        return execute({
          action: 'report',
          run: (u, c, ctx) => reportQuestion(u, c, { sessionId, slotId: slot.id, questionId: slot.questionId, expectedRevision: null }, ctx),
          onSaved: () => showToast('reported_closed'),
        });
      }
      const cur = currentSlot();
      if (!cur || cur.slot.excluded) return failResult('NOT_ALLOWED', 'Zgłoszenie niedostępne.');
      const sessionId = cur.session.id;
      const slotId = cur.slot.id;
      const questionId = cur.slot.questionId;
      return execute({
        action: 'report',
        run: (u, c, ctx) => reportQuestion(u, c, { sessionId, slotId, questionId, expectedRevision: u.sessions[sessionId]?.revision ?? null }, ctx),
        onSaved: (value) => {
          undo = value.undo;
          const kind: ToastKind = value.replacementSlotId ? 'reported_replaced' : value.awaitingReplacement ? 'reported_awaiting' : 'reported_excluded';
          showToast(kind, {}, value.undo !== null);
        },
      });
    },
    async undoReport() {
      const blocked = busy();
      if (blocked) return blocked;
      const token = undo;
      if (!token || !user || !isUndoValid(user, token)) {
        dropUndo();
        publish();
        return failResult('UNDO_EXPIRED', 'Nie można już cofnąć tego zgłoszenia.');
      }
      return execute({
        action: 'undo-report',
        run: (u, _c, ctx) => domainUndoReport(u, token, ctx),
        onSaved: () => {
          undo = null;
          showToast('report_undone');
        },
      });
    },
    async showResult() {
      const blocked = busy();
      if (blocked) return blocked;
      const s = currentSession();
      if (!s || s.kind !== 'test') return failResult('NOT_ALLOWED', 'Wynik niedostępny.');
      const sessionId = s.id;
      return execute({
        action: 'finish',
        run: (u, _c, ctx) => finishTest(u, { sessionId, expectedRevision: u.sessions[sessionId]?.revision ?? -1 }, ctx),
        onSaved: () => {
          dropUndo();
          toast = null;
          route = { name: 'result', sessionId, origin: 'session' };
        },
      });
    },
    pauseSession() {
      // „Kontynuuj później”: sesja zostaje otwarta; „Cofnij” wygasa przy przerwaniu (PRZEKAZANIE §8).
      dropUndo();
      ffNotice = null;
      route = HOME_ROUTE;
      publish();
    },
    async closeUnfinished(sessionId) {
      const s = openSessionById(sessionId, 'test');
      if (!s) return failResult('NOT_ALLOWED', 'Brak otwartego testu.');
      const id = s.id;
      // LOG-06: drugie wywołanie w trakcie zamykania tej samej sesji nic nie robi (bez fałszywego błędu).
      if (closing.has(id)) return failResult('BUSY', MSG_CLOSING);
      return guardClosing(
        id,
        execute({
          action: 'close-unfinished',
          run: (u, _c, ctx) => domainCloseUnfinished(u, { sessionId: id, expectedRevision: u.sessions[id]?.revision ?? -1 }, ctx),
          onSaved: () => {
            dropUndo();
            if (route.name === 'question') route = HOME_ROUTE;
            showToast('test_closed_unfinished');
          },
        }),
      );
    },
    async endFreeFlow(sessionId) {
      const s = openSessionById(sessionId, 'freeflow');
      if (!s) return failResult('NOT_ALLOWED', 'Brak otwartej sesji Free Flow.');
      const id = s.id;
      if (closing.has(id)) return failResult('BUSY', MSG_CLOSING);
      return guardClosing(
        id,
        execute({
          action: 'end-freeflow',
          run: (u, _c, ctx) => domainEndFreeFlow(u, { sessionId: id, expectedRevision: u.sessions[id]?.revision ?? -1 }, ctx),
          onSaved: () => {
            dropUndo();
            ffNotice = null;
            route = { name: 'freeflowSummary', sessionId: id, origin: 'session' };
            showToast('freeflow_saved');
          },
        }),
      );
    },
    retrySave() {
      return enqueue(async () => {
        const p = pending;
        if (!p) return failResult('NOTHING_TO_RETRY', 'Brak zmiany do ponownego zapisu.');
        if (p.base !== user) {
          // Stan zmienił się inną drogą (np. wczytanie kopii) — tej zmiany nie da się już bezpiecznie zapisać.
          pending = null;
          save = { status: 'idle' };
          pendingAnswer = null;
          showFailure('Niezapisana zmiana straciła aktualność i została porzucona.');
          publish();
          return failResult('STALE', 'Niezapisana zmiana straciła aktualność.');
        }
        save = { status: 'saving', commandId: p.commandId, action: p.action };
        publish();
        let commit: Awaited<ReturnType<typeof repository.commit>>;
        try {
          commit = await repository.commit(p.changeset);
        } catch (error) {
          commit = { ok: false, error: { code: 'WriteFailed', messagePl: errorMessage(error, MSG_INTERNAL) } };
        }
        const ref = pendingAnswer ?? undefined;
        return settle(p, commit, ref);
      });
    },
    dismissToast() {
      toast = null;
      publish();
    },

    /* ---------- Wynik, przegląd, nowa runda ---------- */

    openReview(sessionId, filter = 'all') {
      if (route.name === 'result' || route.name === 'freeflowSummary') reviewOrigin = route.origin;
      route = { name: 'review', sessionId, filter };
      publish();
    },
    setReviewFilter(filter) {
      if (route.name === 'review' || route.name === 'reviewItem') route = { name: 'review', sessionId: route.sessionId, filter };
      publish();
    },
    openReviewItem(slotId) {
      if (route.name !== 'review') return;
      route = { name: 'reviewItem', sessionId: route.sessionId, slotId, filter: route.filter };
      publish();
    },
    async startRetryRound(sourceSessionId) {
      // LOG-06: jak startTest/startFreeFlow — drugi start w toku nie tworzy fantomowej rundy.
      if (!isReady() || starting) return failResult('NOT_ALLOWED', MSG_NOT_READY);
      const id = sourceSessionId ?? (route.name === 'result' || route.name === 'review' ? route.sessionId : undefined);
      if (!id) return failResult('NOT_RETRYABLE', 'Nowa runda jest dostępna tylko po ukończonym teście.');
      const seed = platform.randomSeed();
      return startSession((u, c, ctx) => domainStartRetryRound(u, c, { sourceSessionId: id, seed }, ctx));
    },

    /* ---------- Historia ---------- */

    openHistory(tab: HistoryTab = 'tests') {
      selectedPoint = null;
      route = { name: 'history', tab };
      publish();
    },
    setHistoryTab(tab) {
      route = { name: 'history', tab };
      publish();
    },
    setHistoryFilter(filter) {
      historyFilter = filter;
      selectedPoint = null;
      publish();
    },
    selectChartPoint(sessionId) {
      selectedPoint = sessionId;
      publish();
    },
    openHistoryEntry(sessionId) {
      const s = user?.sessions[sessionId];
      if (!s || s.status === 'open') return;
      route = s.kind === 'test' ? { name: 'result', sessionId, origin: 'history' } : { name: 'freeflowSummary', sessionId, origin: 'history' };
      publish();
    },

    /* ---------- Ustawienia, kopia, import ---------- */

    openSettings() {
      route = { name: 'settings' };
      publish();
      void refreshStorage();
    },
    openBackup() {
      if (backupFlow.step === 'done' || backupFlow.step === 'error' || backupFlow.step === 'confirm') {
        backupFlow = { step: 'idle', lastSavedFileName: null };
        validatedBackup = null;
      }
      route = { name: 'backup' };
      publish();
      void refreshSafetyBackups();
    },
    openPoolImport() {
      if (poolFlow.step === 'done' || poolFlow.step === 'error') poolFlow = { step: 'idle' };
      route = { name: 'poolImport' };
      publish();
    },
    openExcluded() {
      route = { name: 'excluded' };
      publish();
    },
    openAbout() {
      route = { name: 'about' };
      publish();
    },
    exportBackup() {
      return enqueue(async () => {
        if (!isReady()) return failResult('NOT_READY', MSG_NOT_READY);
        const previous = backupFlow.step === 'idle' ? backupFlow.lastSavedFileName : null;
        backupFlow = { step: 'saving' };
        publish();
        const r = await repository.exportBackup({ now: platform.nowIso(), appVersion, bankVersions: (catalog as Catalog).bankVersions });
        if (!r.ok) {
          backupFlow = { step: 'idle', lastSavedFileName: previous };
          showFailure(r.error.messagePl);
          publish();
          return failResult(r.error.code, r.error.messagePl);
        }
        try {
          await platform.saveFile(r.value);
        } catch (error) {
          backupFlow = { step: 'idle', lastSavedFileName: previous };
          const msg = errorMessage(error, 'Nie udało się zapisać pliku kopii. Spróbuj ponownie.');
          showFailure(msg);
          publish();
          return failResult('SAVE_FILE_FAILED', msg);
        }
        backupFlow = { step: 'idle', lastSavedFileName: r.value.fileName };
        showToast('backup_saved', { fileName: r.value.fileName });
        publish();
        return okResult();
      });
    },
    async selectBackupFile(file, fileName) {
      if (!isReady()) return failResult('NOT_READY', MSG_NOT_READY);
      validatedBackup = null;
      backupFlow = { step: 'checking', fileName };
      publish();
      const r = await repository.parseAndValidateBackup(file, fileName);
      if (!r.ok) {
        backupFlow = { step: 'error', fileName, error: backupErrorVM(r.error) };
        publish();
        return failResult(r.error.code, r.error.messagePl);
      }
      validatedBackup = r.value;
      backupFlow = { step: 'confirm', fileName, summary: r.value.summary };
      publish();
      return okResult();
    },
    confirmBackupReplace() {
      return enqueue(async () => {
        const v = validatedBackup;
        if (backupFlow.step !== 'confirm' || !v || !isReady()) return failResult('NOT_ALLOWED', 'Najpierw wybierz plik kopii.');
        if (pending) {
          // Niezapisana zmiana czeka na ponowienie tej samej komendy (DECYZJE §1) — bez zamiany danych.
          showFailure(MSG_UNSAVED_DATA);
          publish();
          return failResult('UNSAVED_PENDING', MSG_UNSAVED_DATA);
        }
        const fileName = backupFlow.fileName;
        backupFlow = { step: 'replacing', fileName };
        publish();
        const r = await repository.replaceAllFromBackup(v, {
          now: platform.nowIso(),
          safetyBackupId: platform.randomId(),
          appVersion,
          bankVersions: (catalog as Catalog).bankVersions,
        });
        validatedBackup = null;
        if (!r.ok) {
          backupFlow = { step: 'error', fileName, error: backupErrorVM(r.error) };
          publish();
          return failResult(r.error.code, r.error.messagePl);
        }
        // Dane zastąpione w całości: stan lokalny kontrolera wraca do zera, dane wczytane z bazy.
        pending = null;
        save = { status: 'idle' };
        pendingAnswer = null;
        undo = null;
        toast = null;
        ffNotice = null;
        historyFilter = { kind: 'all' };
        selectedPoint = null;
        shownRequested.clear();
        persistAsked = false;
        const reloaded = await reloadUserData();
        if (!reloaded) {
          fatal('STORAGE_UNAVAILABLE', 'Kopia została wczytana, ale nie udało się odczytać danych. Uruchom aplikację ponownie.');
          return failResult('RELOAD_FAILED', 'Nie udało się odczytać danych po wczytaniu kopii.');
        }
        resetDrafts();
        backupFlow = { step: 'done', summary: r.value.summary, safetyBackupId: r.value.safetyBackup.id, safetyFileName: r.value.safetyBackup.fileName };
        publish();
        await refreshSafetyBackups();
        return okResult();
      });
    },
    cancelBackupReplace() {
      validatedBackup = null;
      backupFlow = { step: 'idle', lastSavedFileName: null };
      publish();
    },
    async downloadSafetyBackup(backupId) {
      const id = backupId ?? (backupFlow.step === 'done' ? backupFlow.safetyBackupId : null);
      if (!id) return failResult('NOT_ALLOWED', 'Brak kopii bezpieczeństwa.');
      const r = await repository.getBackupFile(id);
      if (!r.ok) {
        showFailure(r.error.messagePl);
        publish();
        return failResult(r.error.code, r.error.messagePl);
      }
      try {
        await platform.saveFile(r.value);
      } catch (error) {
        const msg = errorMessage(error, 'Nie udało się zapisać pliku kopii. Spróbuj ponownie.');
        showFailure(msg);
        publish();
        return failResult('SAVE_FILE_FAILED', msg);
      }
      showToast('backup_saved', { fileName: r.value.fileName });
      publish();
      return okResult();
    },
    async restoreSafetyBackup(backupId) {
      if (!isReady()) return failResult('NOT_READY', MSG_NOT_READY);
      const r = await repository.getBackupFile(backupId);
      if (!r.ok) {
        showFailure(r.error.messagePl);
        publish();
        void refreshSafetyBackups();
        return failResult(r.error.code, r.error.messagePl);
      }
      // Ta sama ścieżka co plik wybrany przez użytkowniczkę: walidacja → podsumowanie → decyzja.
      return controller.selectBackupFile(new Blob([r.value.text], { type: 'application/json' }), r.value.fileName);
    },
    resetBackupFlow() {
      validatedBackup = null;
      backupFlow = { step: 'idle', lastSavedFileName: null };
      publish();
    },
    importPackFile(_file, fileName) {
      // Od V15 import dodatkowych pul jest wyłączony w logice (nie tylko w UI): katalog = wyłącznie bank V15.
      poolFlow = { step: 'error', fileName, issues: [], messagePl: MSG_PACKS_DISABLED };
      publish();
      return Promise.resolve(failResult('PACKS_DISABLED', MSG_PACKS_DISABLED));
    },
    resetPoolImportFlow() {
      poolFlow = { step: 'idle' };
      publish();
    },
    async restoreBlock(blockId) {
      return execute({
        action: 'restore-block',
        run: (u, _c, ctx) => domainRestoreBlock(u, { blockId }, ctx),
        onSaved: () => {
          const open = user ? activeSession(user) : null;
          showToast(open?.kind === 'test' ? 'block_restored_open_test' : 'block_restored');
          void fillAwaitingIfNeeded();
        },
      });
    },
    async requestPersistentStorage() {
      let result: 'granted' | 'denied' | 'unsupported';
      try {
        result = await repository.storage.requestPersist();
      } catch {
        result = 'denied';
      }
      await refreshStorage();
      if (result === 'granted') return okResult();
      const msg =
        result === 'unsupported'
          ? 'Ta przeglądarka nie obsługuje trwałego przechowywania. Zapisuj kopię danych w ustawieniach.'
          : 'Przeglądarka nie potwierdziła trwałego przechowywania. Dane są nadal zapisywane — zapisuj też kopię danych.';
      showFailure(msg);
      publish();
      return failResult(result === 'unsupported' ? 'PERSIST_UNSUPPORTED' : 'PERSIST_DENIED', msg);
    },

    /* ---------- PWA ---------- */

    async applyUpdate() {
      if (!state.update.available || !state.update.canApplyNow) {
        return failResult('UPDATE_NOT_SAFE', 'Aktualizacja możliwa poza ekranem pytania, po zapisie.');
      }
      updateApplying = true;
      publish();
      try {
        await pwa.applyUpdate();
        return okResult();
      } catch (error) {
        updateApplying = false;
        const msg = errorMessage(error, 'Nie udało się uruchomić nowej wersji. Obecna wersja działa dalej.');
        showFailure(msg);
        publish();
        return failResult('UPDATE_FAILED', msg);
      }
    },
    async retryPreparation() {
      if (preparation) {
        preparation = { status: 'running', done: preparation.done, total: preparation.total };
        publish();
      }
      try {
        await pwa.checkForUpdate();
        return okResult();
      } catch (error) {
        const msg = errorMessage(error, 'Nie udało się pobrać materiałów.');
        return failResult('PREPARATION_FAILED', msg);
      }
    },
  };

  return controller;
};
