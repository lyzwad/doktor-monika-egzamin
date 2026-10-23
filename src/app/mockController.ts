/**
 * MOCK KONTROLERA — działający w pamięci, z UPROSZCZONĄ logiką (bez IndexedDB i bez silnika domeny).
 *
 * Przeznaczenie: praca nad UI przed integracją. Ładowany WYŁĄCZNIE w trybie deweloperskim pod flagą
 * `?mock=1` (dynamiczny import w main.tsx, wycinany z buildu produkcyjnego) oraz w testach UI.
 * Nie zawiera danych demonstracyjnych: startuje z pustą historią i prawdziwym bankiem przekazanym w opcjach.
 *
 * Uproszczenia względem specyfikacji (NIE przenosić do produkcji): dobór = losowe unikalne rodziny
 * bez kwot domen/poziomów; kolejka błędów: poprawna odpowiedź od razu rozwiązuje błąd; brak walidacji
 * paczek i kopii poza podstawową strukturą; „następny dzień” = +24 h.
 * Do testowania stanów UI służy `simulate()` (błąd zapisu, offline, aktualizacja, przygotowanie).
 */
import { bankSummaryOf } from '../domain/catalog';
import { mulberry32, shuffle, type Rng } from '../domain/rng';
import { formatPercentPl, isPassed, passThreshold, truncatedPercent } from '../domain/scoring';
import { DEFAULT_FREE_FLOW_CONFIG, DEFAULT_TEST_CONFIG, N_STEP, QUICK_N_VALUES } from '../domain/policies';
import { emptyUserState } from '../domain/state';
import type {
  Allocation,
  Block,
  BlockId,
  Catalog,
  CatalogQuestion,
  ChartPoint,
  DifficultyChoice,
  DmeEvent,
  DomainId,
  HistoryFilter,
  NValidation,
  OptionId,
  QuestionId,
  QuestionSnapshot,
  QuestionStat,
  RuntimeBank,
  Scope,
  Session,
  SessionConfig,
  SessionId,
  SessionKind,
  Slot,
  SlotId,
  SlotOrigin,
  UserState,
} from '../domain/types';
import type { BackupFileV1, BackupSummary, ExportedFile } from '../persistence/api';
import type { ActionResult, AppController, AppState } from './controller';
import { HOME_ROUTE, type HistoryTab, type ResultOrigin, type ReviewFilter, type Route } from './routes';
import { bankByDomainOf, bankInfoOf } from './screenModels';
import type {
  AnswerCardVM,
  AnswerLetter,
  BackupFlowVM,
  ConfigDraft,
  ConfigLabelVM,
  ConfigVM,
  ExplanationVM,
  FigureVM,
  HistoryVM,
  PoolImportFlowVM,
  PreparationState,
  QuestionVM,
  ResultVM,
  ResumeVM,
  RetryPreviewVM,
  ReviewVM,
  SaveAction,
  SaveStatus,
  ScreenVM,
  ToastKind,
  ToastVM,
  UpdateState,
} from './viewModels';

export interface MockControllerOptions {
  /** Prawdziwy bank (np. `public/data/bank.json`) — mock nie ma własnych danych. */
  bank: RuntimeBank;
  /** Seed PRNG mocka (deterministyczne testy). Domyślnie 1. */
  seed?: number;
  /** Zegar (testy). Domyślnie systemowy. */
  now?: () => Date;
  /** Zapis pliku (eksport kopii). Domyślnie brak operacji. */
  saveFile?: (file: ExportedFile) => void | Promise<void>;
  /** Sztuczne opóźnienie zapisu w ms (pokazuje stan „saving”). Domyślnie 0. */
  latencyMs?: number;
  initialRoute?: Route;
  appVersion?: string;
}

/** Przełączniki symulacji stanów (S24, banery). */
export interface MockSimulation {
  /** Każdy kolejny zapis kończy się błędem (QuotaExceeded) do wyłączenia. */
  saveFailure: boolean;
  offline: boolean;
  updateAvailable: boolean;
  preparation: PreparationState | null;
  /** Pokazuj wskazówkę instalacji (dopóki nie zamknięta). */
  installHint: boolean;
}

export interface MockController extends AppController {
  simulate(patch: Partial<MockSimulation>): void;
}

const LETTERS: readonly AnswerLetter[] = ['A', 'B', 'C', 'D'];

interface PendingCommand {
  commandId: string;
  action: SaveAction;
  apply: (commandId: string) => ActionResult;
  pendingAnswer: { slotId: SlotId; optionId: OptionId } | null;
}

interface UndoState {
  sessionId: SessionId;
  mutationSeq: number;
  previous: Session;
  blockId: BlockId;
}

/* -------------------------------------------------------------------------- */
/* Budowa katalogu (uproszczona — bez walidacji)                               */
/* -------------------------------------------------------------------------- */

function mockCatalog(bank: RuntimeBank): Catalog {
  const questions: CatalogQuestion[] = bank.questions.map((q) => ({
    id: q.id,
    revision: q.revision,
    familyId: q.family_id,
    fingerprint: q.fingerprint,
    domainId: q.domain_id,
    topicIds: q.topic_ids,
    difficulty: q.difficulty,
    stem: q.stem_pl,
    options: q.options.map((o) => ({ id: o.id, text: o.text_pl })),
    correctOptionId: q.correct_option_id,
    explanation: q.correct_explanation_pl,
    sourceIds: q.source_ids,
    sourceLocator: q.source_locator_pl,
    questionType: q.question_type,
    figureId: q.figure_id,
    explanationFigureId: q.explanation_figure_id,
    reviewStatus: q.review_status,
    approvedForQuestionKey: q.approved_for_question_key,
    contentCheckStatus: q.content_check_status,
    cognitiveLevel: q.cognitive_level,
    origin: { kind: 'bank', bankVersion: bank.bank_version },
  }));
  const byId: Record<QuestionId, CatalogQuestion> = {};
  for (const q of questions) byId[q.id] = q;
  return {
    bankSummary: bankSummaryOf(bank, questions),
    bankVersion: bank.bank_version,
    bankVersions: [bank.bank_version],
    builtOn: bank.built_on,
    statusPl: bank.status_pl,
    clinicalSignoff: bank.clinical_signoff,
    domains: bank.domains.map((d) => ({ id: d.id, title: d.title_pl, description: d.description_pl })),
    questions,
    questionsById: byId,
    topics: Object.fromEntries(
      Object.values(bank.topics).map((t) => [
        t.id,
        { id: t.id, title: t.title_pl, domainId: t.domain_id, learningObjective: t.learning_objective_pl, pearls: t.clinical_pearls_pl },
      ]),
    ),
    sources: Object.fromEntries(
      Object.values(bank.sources).map((s) => [
        s.id,
        {
          id: s.id,
          title: s.title,
          url: s.url !== null && s.url.startsWith('https://') ? s.url : null,
          doi: s.doi,
          pmid: s.pmid,
          kindPl: s.kind_pl,
          accessPl: s.access_pl,
          checkedOn: s.checked_on,
        },
      ]),
    ),
    figures: Object.fromEntries(
      Object.values(bank.figures).map((f) => [
        f.id,
        { id: f.id, file: f.file, alt: f.alt_pl, caption: f.caption_pl, variant: f.variant, sourceIds: f.source_ids, reviewStatus: f.review_status },
      ]),
    ),
    issues: [],
  };
}

/* -------------------------------------------------------------------------- */
/* Mock                                                                        */
/* -------------------------------------------------------------------------- */

export function createMockController(options: MockControllerOptions): MockController {
  const clock = options.now ?? (() => new Date());
  const latencyMs = options.latencyMs ?? 0;
  const appVersion = options.appVersion ?? '0.0.0-mock';
  const rng: Rng = mulberry32(options.seed ?? 1);
  let idCounter = 0;
  const newId = (prefix: string) => `${prefix}-${(++idCounter).toString(36)}`;
  const nowIso = () => clock().toISOString();

  let catalog: Catalog | null = null;
  let user: UserState = emptyUserState();
  let booted = false;
  let route: Route = options.initialRoute ?? HOME_ROUTE;
  let viewPosition = 0;
  let drafts: Record<SessionKind, ConfigDraft> = {
    test: draftFrom(DEFAULT_TEST_CONFIG),
    freeflow: draftFrom(DEFAULT_FREE_FLOW_CONFIG),
  };
  let starting = false;
  let save: SaveStatus = { status: 'idle' };
  let pending: PendingCommand | null = null;
  let toast: ToastVM | null = null;
  let undo: UndoState | null = null;
  let backupFlow: BackupFlowVM = { step: 'idle', lastSavedFileName: null };
  let validatedBackup: BackupFileV1 | null = null;
  /** Automatyczne kopie bezpieczeństwa (w pamięci; najnowsze pierwsze, maks. 5 — jak magazyn `backups`). */
  let safetyBackups: Array<{ id: string; createdAt: string; fileName: string; sizeBytes: number; file: ExportedFile }> = [];
  let poolFlow: PoolImportFlowVM = { step: 'idle' };
  let historyTab: HistoryTab = 'tests';
  let historyFilter: HistoryFilter = { kind: 'all' };
  let selectedPoint: SessionId | null = null;
  let ffNotice: SessionId | null = null;
  let persisted: boolean | null = null;
  let sim: MockSimulation = { saveFailure: false, offline: false, updateAvailable: false, preparation: null, installHint: true };
  let updateApplying = false;
  const listeners = new Set<() => void>();
  const failureCounts = new Map<string, number>();
  let state: AppState = buildState();

  function draftFrom(config: Readonly<SessionConfig>): ConfigDraft {
    return {
      scope: config.scope,
      difficulty: config.difficulty,
      nText: String(config.targetN ?? DEFAULT_TEST_CONFIG.targetN),
      myErrorsPriority: config.myErrorsPriority,
    };
  }

  /* ---------- publikacja ---------- */

  function publish(): void {
    state = buildState();
    for (const l of [...listeners]) l();
  }

  function setUser(next: UserState): void {
    user = next;
  }

  function putSession(session: Session): void {
    setUser({ ...user, sessions: { ...user.sessions, [session.id]: session } });
  }

  async function delay(): Promise<void> {
    if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
  }

  function failResult(code: string, messagePl: string): ActionResult {
    return { ok: false, code, messagePl };
  }

  function showToast(kind: ToastKind, params: Record<string, string | number> = {}, canUndo = false): void {
    toast = { id: newId('toast'), kind, canUndo, autoHideMs: canUndo ? null : 4500, params };
  }

  /** Zapis komendy z symulacją błędu (ponowienie używa tego samego `commandId`). */
  async function runCommand(
    action: SaveAction,
    apply: (commandId: string) => ActionResult,
    pendingAnswer: PendingCommand['pendingAnswer'] = null,
    commandId: string = newId('cmd'),
  ): Promise<ActionResult> {
    save = { status: 'saving', commandId, action };
    pending = { commandId, action, apply, pendingAnswer };
    publish();
    await delay();
    if (sim.saveFailure) {
      const failures = (failureCounts.get(commandId) ?? 0) + 1;
      failureCounts.set(commandId, failures);
      const messagePl = 'Symulacja: zapis nie powiódł się.';
      save = { status: 'error', commandId, action, code: 'QuotaExceeded', messagePl, failures };
      publish();
      return failResult('QuotaExceeded', messagePl);
    }
    failureCounts.delete(commandId);
    pending = null;
    save = { status: 'idle' };
    const result = apply(commandId);
    publish();
    return result;
  }

  /* ---------- pula ---------- */

  function activeBlockList(): Block[] {
    return Object.values(user.blocks)
      .filter((b) => b.revokedAt === null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  function isBlocked(q: CatalogQuestion): boolean {
    return activeBlockList().some((b) => b.questionId === q.id || b.fingerprint === q.fingerprint || b.familyId === q.familyId);
  }

  function pool(scope: Scope, difficulty: DifficultyChoice): CatalogQuestion[] {
    if (!catalog) return [];
    return catalog.questions.filter(
      (q) => (scope === 'ALL' || q.domainId === scope) && (difficulty === 'mixed' || q.difficulty === difficulty) && !isBlocked(q),
    );
  }

  function familiesOf(questions: readonly CatalogQuestion[]): Map<string, CatalogQuestion[]> {
    const map = new Map<string, CatalogQuestion[]>();
    for (const q of questions) {
      const list = map.get(q.familyId);
      if (list) list.push(q);
      else map.set(q.familyId, [q]);
    }
    return map;
  }

  function capacity(scope: Scope, difficulty: DifficultyChoice): number {
    return familiesOf(pool(scope, difficulty)).size;
  }

  function isSeen(questionId: QuestionId): boolean {
    return (user.questionStats[questionId]?.seenCount ?? 0) > 0;
  }

  function activeErrorIds(scope: Scope, difficulty: DifficultyChoice): QuestionId[] {
    const ids = new Set(pool(scope, difficulty).map((q) => q.id));
    return Object.values(user.questionStats)
      .filter((s) => s.activeError && ids.has(s.questionId))
      .map((s) => s.questionId);
  }

  function validateN(raw: string, cap: number): NValidation {
    const text = raw.trim();
    if (cap === 0) return { ok: false, code: 'EMPTY_POOL', capacity: cap };
    if (text === '') return { ok: false, code: 'EMPTY', capacity: cap };
    if (!/^-?\d+$/.test(text)) return { ok: false, code: 'NOT_INTEGER', capacity: cap };
    const n = Number(text);
    if (!Number.isSafeInteger(n)) return { ok: false, code: 'NOT_INTEGER', capacity: cap };
    if (n < 1) return { ok: false, code: 'TOO_SMALL', capacity: cap };
    if (n > cap) return { ok: false, code: 'EXCEEDS_CAPACITY', capacity: cap };
    return { ok: true, n };
  }

  /* ---------- sesje ---------- */

  function domainTitle(domainId: DomainId): string {
    return catalog?.domains.find((d) => d.id === domainId)?.title ?? domainId;
  }

  function scopeTitle(scope: Scope): string {
    return scope === 'ALL' ? 'Cały zakres' : domainTitle(scope);
  }

  function snapshotOf(q: CatalogQuestion, order: OptionId[]): QuestionSnapshot {
    const cat = catalog as Catalog;
    const fig = (id: string | null) => {
      const f = id ? cat.figures[id] : undefined;
      return f ? { id: f.id, file: f.file, alt: f.alt, caption: f.caption } : null;
    };
    return {
      questionId: q.id,
      revision: q.revision,
      bankVersion: q.origin.bankVersion,
      familyId: q.familyId,
      fingerprint: q.fingerprint,
      domainId: q.domainId,
      domainTitle: domainTitle(q.domainId),
      topicIds: q.topicIds,
      topics: q.topicIds.flatMap((id) => {
        const t = cat.topics[id];
        return t ? [{ id: t.id, title: t.title, learningObjective: t.learningObjective, pearls: t.pearls }] : [];
      }),
      difficulty: q.difficulty,
      stem: q.stem,
      options: order.map((id) => ({ id, text: q.options.find((o) => o.id === id)?.text ?? '' })),
      correctOptionId: q.correctOptionId,
      explanation: q.explanation,
      sources: q.sourceIds.flatMap((id) => {
        const s = cat.sources[id];
        return s ? [{ id: s.id, title: s.title, url: s.url, doi: s.doi, pmid: s.pmid, kindPl: s.kindPl, accessPl: s.accessPl }] : [];
      }),
      sourceLocator: q.sourceLocator,
      figure: fig(q.figureId),
      explanationFigure: fig(q.explanationFigureId),
      reviewStatus: q.reviewStatus,
      approvedForQuestionKey: q.approvedForQuestionKey,
    };
  }

  function makeSlot(q: CatalogQuestion, origin: SlotOrigin, replacesSlotId: SlotId | null = null): Slot {
    const order = shuffle(
      q.options.map((o) => o.id),
      rng,
    );
    return {
      id: newId('slot'),
      questionId: q.id,
      origin,
      snapshot: snapshotOf(q, order),
      optionOrder: order,
      attempt: null,
      excluded: null,
      replacesSlotId,
      createdAt: nowIso(),
      shownAt: null,
    };
  }

  function emptyAllocation(policy: Allocation['policy'], cap: number): Allocation {
    return {
      policy,
      rotationOffset: 0,
      capacityAtStart: cap,
      domainTargets: {},
      domainActual: {},
      cells: [],
      mandatoryRepeated: 0,
      mandatoryMyErrors: 0,
      fillersUnseen: 0,
      fillersSeen: 0,
      redistributed: [],
      freeFlowWeights: null,
    };
  }

  /** Wybór jednego pytania na rodzinę: preferuj niewidziane, potem losowo. */
  function pickFamilies(candidates: CatalogQuestion[], count: number, excludeFamilies: Set<string>): CatalogQuestion[] {
    const fams = [...familiesOf(candidates).entries()].filter(([f]) => !excludeFamilies.has(f));
    const shuffled = shuffle(fams, rng);
    const unseen = shuffled.filter(([, qs]) => qs.some((q) => !isSeen(q.id)));
    const seen = shuffled.filter(([, qs]) => qs.every((q) => isSeen(q.id)));
    return [...unseen, ...seen].slice(0, count).map(([, qs]) => qs.find((q) => !isSeen(q.id)) ?? (qs[0] as CatalogQuestion));
  }

  function openSessionObj(): Session | null {
    return Object.values(user.sessions).find((s) => s.status === 'open') ?? null;
  }

  function closeOpenSession(): void {
    const open = openSessionObj();
    if (!open) return;
    putSession({
      ...open,
      status: open.kind === 'test' ? 'unfinished' : 'ended',
      closedAt: nowIso(),
      updatedAt: nowIso(),
      revision: open.revision + 1,
      mutationSeq: open.mutationSeq + 1,
    });
  }

  function newSession(kind: SessionKind, config: SessionConfig, slots: Slot[], cap: number, retry: Session['retry']): Session {
    const now = nowIso();
    const sessionId = newId('session');
    const event: DmeEvent = { id: newId('event'), at: now, commandId: null, type: 'session_started', sessionId, kind };
    const session: Session = {
      id: sessionId,
      kind,
      status: 'open',
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      revision: 1,
      mutationSeq: 0,
      config,
      bankVersion: catalog?.bankVersion ?? '',
      seed: Math.floor(rng() * 4294967296),
      allocation: emptyAllocation(kind === 'test' ? 'TEST_POLICY_V2' : 'FREE_FLOW_POLICY_V2', cap),
      retry,
      plan: slots.map((s) => s.id),
      slots: Object.fromEntries(slots.map((s) => [s.id, s])),
      reached: 0,
      awaitingReplacement: [],
      events: [event],
      result: null,
      freeFlow: kind === 'freeflow' ? { myErrorsExhaustedNotified: false, empty: slots.length === 0, picks: slots.length } : null,
    };
    session.allocation.mandatoryRepeated = slots.filter((s) => s.origin === 'repeated_wrong').length;
    session.allocation.mandatoryMyErrors = slots.filter((s) => s.origin === 'my_errors').length;
    session.allocation.fillersUnseen = slots.filter((s) => (s.origin === 'planned' || s.origin === 'filler') && !isSeen(s.questionId)).length;
    session.allocation.fillersSeen = slots.filter((s) => (s.origin === 'planned' || s.origin === 'filler') && isSeen(s.questionId)).length;
    return session;
  }

  function enterQuestion(sessionId: SessionId, position: number): void {
    route = { name: 'question', sessionId };
    viewPosition = position;
    markShownCurrent();
  }

  function markShownCurrent(): void {
    const s = route.name === 'question' ? user.sessions[route.sessionId] : undefined;
    if (!s || s.status !== 'open') return;
    const slotId = s.plan[viewPosition];
    const slot = slotId ? s.slots[slotId] : undefined;
    if (!slot || slot.shownAt !== null) return;
    const now = nowIso();
    const stat = statFor(slot);
    setUser({
      ...user,
      questionStats: {
        ...user.questionStats,
        [slot.questionId]: { ...stat, seenCount: stat.seenCount + 1, firstSeenAt: stat.firstSeenAt ?? now, lastSeenAt: now },
      },
    });
    putSession({ ...s, revision: s.revision + 1, slots: { ...s.slots, [slot.id]: { ...slot, shownAt: now } } });
  }

  function statFor(slot: Slot): QuestionStat {
    return (
      user.questionStats[slot.questionId] ?? {
        questionId: slot.questionId,
        familyId: slot.snapshot.familyId,
        domainId: slot.snapshot.domainId,
        seenCount: 0,
        firstSeenAt: null,
        lastSeenAt: null,
        answeredCount: 0,
        correctCount: 0,
        wrongCount: 0,
        lastAnsweredAt: null,
        activeError: false,
        streak: 0,
        dueAt: null,
        lastWrongAt: null,
        lastWrongSessionId: null,
        streakSessionId: null,
        resolvedAt: null,
      }
    );
  }

  function validCounts(s: Session): { answered: number; correct: number; wrong: number } {
    let answered = 0;
    let correct = 0;
    for (const id of s.plan) {
      const slot = s.slots[id];
      if (!slot || slot.excluded || !slot.attempt) continue;
      answered++;
      if (slot.attempt.correct) correct++;
    }
    return { answered, correct, wrong: answered - correct };
  }

  function nextFreeFlowQuestion(s: Session): CatalogQuestion | null {
    const candidates = pool(s.config.scope, s.config.difficulty);
    const recent = s.plan.slice(-10).map((id) => s.slots[id]?.snapshot.familyId);
    const usedFamilies = new Set(s.plan.flatMap((id) => s.slots[id]?.snapshot.familyId ?? []));
    if (s.config.myErrorsPriority) {
      const errs = activeErrorIds(s.config.scope, s.config.difficulty);
      const errQ = candidates.find((q) => errs.includes(q.id) && !recent.includes(q.familyId));
      if (errQ) return errQ;
    }
    const fresh = pickFamilies(candidates, 1, usedFamilies);
    if (fresh[0]) return fresh[0];
    const again = pickFamilies(candidates, 1, new Set(recent.filter((f): f is string => f !== undefined)));
    return again[0] ?? null;
  }

  /* ---------- VM ---------- */

  function configLabel(config: SessionConfig): ConfigLabelVM {
    return {
      scope: config.scope,
      scopeTitle: scopeTitle(config.scope),
      difficulty: config.difficulty,
      targetN: config.targetN,
      myErrorsPriority: config.myErrorsPriority,
    };
  }

  function resumeVM(): ResumeVM | null {
    const s = openSessionObj();
    if (!s) return null;
    const c = validCounts(s);
    return {
      sessionId: s.id,
      kind: s.kind,
      answeredValid: c.answered,
      targetN: s.config.targetN,
      questionNumber: s.reached + 1,
      config: configLabel(s.config),
      retryRoundIndex: s.retry && s.retry.repeatedCount > 0 ? s.retry.roundIndex : null,
      awaitingReplacement: s.awaitingReplacement.length > 0,
      awaitingCount: s.awaitingReplacement.length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  function configVM(mode: SessionKind): ConfigVM {
    const draft = drafts[mode];
    const cap = capacity(draft.scope, draft.difficulty);
    const p = pool(draft.scope, draft.difficulty);
    const unseen = [...familiesOf(p).values()].filter((qs) => qs.every((q) => !isSeen(q.id))).length;
    const nValidation = mode === 'test' ? validateN(draft.nText, cap) : null;
    const n = Number.parseInt(draft.nText, 10);
    const open = openSessionObj();
    const scopes: Scope[] = ['ALL', ...(catalog?.domains.map((d) => d.id) ?? [])];
    return {
      name: 'config',
      mode,
      draft,
      scopeTitle: scopeTitle(draft.scope),
      scopeOptions: scopes.map((scope) => ({ scope, title: scopeTitle(scope), capacity: capacity(scope, draft.difficulty), questionCount: pool(scope, draft.difficulty).length })),
      capacity: cap,
      questionCount: p.length,
      unseenFamilies: unseen,
      nValidation,
      canDecrement: Number.isFinite(n) && n - N_STEP >= 1,
      canIncrement: (Number.isFinite(n) ? n : 0) + N_STEP <= cap,
      quickValues: QUICK_N_VALUES.map((q) => ({ n: q, enabled: q <= cap, selected: draft.nText.trim() === String(q) })),
      activeErrorsInScope: activeErrorIds(draft.scope, draft.difficulty).length,
      openSession: open
        ? { sessionId: open.id, kind: open.kind, answeredValid: validCounts(open).answered, targetN: open.config.targetN }
        : null,
      canStart: !starting && cap > 0 && (nValidation === null || nValidation.ok),
      starting,
    };
  }

  function figureVM(f: QuestionSnapshot['figure']): FigureVM | null {
    return f ? { figureId: f.id, src: f.file, alt: f.alt, caption: f.caption } : null;
  }

  function questionVM(
    s: Session,
    position: number,
    mode: QuestionVM['mode'],
    reportedLater: boolean,
    reviewNav: QuestionVM['reviewNav'] = null,
  ): QuestionVM | null {
    const slotId = s.plan[position];
    const slot = slotId ? s.slots[slotId] : undefined;
    if (!slot) return null;
    const snap = slot.snapshot;
    const pendingAnswer = pending?.pendingAnswer?.slotId === slot.id ? pending.pendingAnswer : null;
    const attempt = slot.attempt;
    const answers: AnswerCardVM[] = snap.options.map((o, i) => {
      let st: AnswerCardVM['state'] = 'neutral';
      if (attempt) {
        if (o.id === attempt.optionId) st = attempt.correct ? 'selected-correct' : 'selected-wrong';
        else if (o.id === snap.correctOptionId) st = 'correct-unselected';
        else st = 'rest-after-eval';
      } else if (pendingAnswer && pendingAnswer.optionId === o.id) {
        st = 'pending';
      }
      return {
        optionId: o.id,
        letter: LETTERS[i] ?? 'A',
        text: o.text,
        state: st,
        interactive: mode === 'live' && !attempt && !pendingAnswer && !slot.excluded,
      };
    });
    const topic = snap.topics[0];
    const explanation: ExplanationVM | null = attempt
      ? {
          text: snap.explanation,
          figure: figureVM(snap.explanationFigure),
          context: topic ? { topicTitle: topic.title, learningObjective: topic.learningObjective, pearls: topic.pearls } : null,
          sources: snap.sources.map((x) => ({ id: x.id, title: x.title, kindPl: x.kindPl, accessPl: x.accessPl, url: x.url, doi: x.doi, pmid: x.pmid })),
          sourceLocator: snap.sourceLocator,
        }
      : null;
    const counts = validCounts(s);
    const isTest = s.kind === 'test';
    const awaiting = s.awaitingReplacement.includes(slot.id);
    const isLastTestSlot = isTest && position === s.plan.length - 1;
    const ready = isTest && counts.answered === s.config.targetN && s.awaitingReplacement.length === 0;
    const waiting = isTest && s.status === 'open' && mode !== 'review' ? s.awaitingReplacement.map((id) => s.plan.indexOf(id)).filter((i) => i >= 0).sort((a, b) => a - b) : [];
    const firstAwaiting = waiting.find((i) => i !== position);
    const awaitingElsewhere = !awaiting && firstAwaiting !== undefined ? { position: firstAwaiting, count: waiting.length } : null;
    let primary: QuestionVM['primaryAction'] = 'none';
    if (mode === 'preview') primary = 'next';
    if (mode === 'live' && awaiting && !isLastTestSlot) primary = 'next';
    if (mode === 'live' && !awaiting) {
      if (!attempt) primary = pendingAnswer ? 'none' : 'hint';
      else if (isLastTestSlot && ready) primary = 'show-result';
      else if (isLastTestSlot && awaitingElsewhere) primary = 'go-awaiting';
      else if (!isLastTestSlot) primary = 'next';
    }
    return {
      name: 'question',
      sessionId: s.id,
      kind: s.kind,
      mode,
      position,
      reached: s.reached,
      slotId: slot.id,
      progress: isTest
        ? { kind: 'test', answeredValid: counts.answered, targetN: s.config.targetN ?? 0 }
        : { kind: 'freeflow', questionNumber: position + 1 },
      retryRoundIndex: s.retry && s.retry.repeatedCount > 0 ? s.retry.roundIndex : null,
      domainId: snap.domainId,
      domainTitle: snap.domainTitle,
      difficulty: snap.difficulty,
      originTag:
        slot.origin === 'repeated_wrong'
          ? 'repeated_wrong'
          : slot.origin === 'my_errors'
            ? 'my_errors'
            : slot.origin === 'filler' && (user.questionStats[slot.questionId]?.seenCount ?? 0) > 1
              ? 'seen_filler'
              : null,
      excluded: slot.excluded !== null,
      reportedLater,
      stem: snap.stem,
      figure: figureVM(snap.figure),
      answers,
      answered: attempt !== null,
      correct: attempt ? attempt.correct : null,
      explanation,
      canReport: mode === 'review' ? !reportedLater && !slot.excluded : !slot.excluded && s.status === 'open',
      canGoPrevious: mode !== 'review' && position > 0,
      canJumpToCurrent: mode === 'preview',
      primaryAction: primary,
      savingAnswer: pendingAnswer !== null,
      awaitingReplacement: awaiting,
      awaitingElsewhere,
      freeFlowEmpty: s.kind === 'freeflow' && (s.freeFlow?.empty ?? false) && mode === 'live' && slot.attempt !== null,
      myErrorsExhaustedNotice: ffNotice === s.id && mode === 'live',
      reviewNav,
    };
  }

  function retryPreview(parent: Session): RetryPreviewVM | null {
    if (parent.kind !== 'test' || parent.status !== 'completed') return null;
    const wrong = parent.plan
      .map((id) => parent.slots[id])
      .filter((sl): sl is Slot => !!sl && !sl.excluded && !!sl.attempt && !sl.attempt.correct)
      .filter((sl) => {
        const q = catalog?.questionsById[sl.questionId];
        return q ? !isBlocked(q) : false;
      });
    const n = parent.config.targetN ?? 0;
    const cap = capacity(parent.config.scope, parent.config.difficulty);
    const fillers = Math.max(0, n - wrong.length);
    return {
      targetN: n,
      config: configLabel(parent.config),
      repeatedWrong: wrong.length,
      fillersUnseen: fillers,
      fillersSeen: 0,
      nextRoundIndex: (parent.retry?.roundIndex ?? 1) + 1,
      isRetry: wrong.length > 0,
      insufficientCapacity: cap < n ? cap : null,
    };
  }

  function resultVM(s: Session, origin: ResultOrigin): ResultVM {
    const c = validCounts(s);
    const n = s.config.targetN ?? 0;
    return {
      name: 'result',
      sessionId: s.id,
      origin,
      status: s.status === 'completed' ? (s.result?.passed ? 'passed' : 'failed') : 'unfinished',
      correct: c.correct,
      targetN: n,
      answeredValid: c.answered,
      percentText: formatPercentPl(c.correct, s.status === 'completed' ? n : c.answered),
      thresholdCorrect: n > 0 ? passThreshold(n) : 0,
      config: configLabel(s.config),
      retry: s.retry,
      composition: {
        repeatedWrong: s.allocation.mandatoryRepeated,
        myErrors: s.allocation.mandatoryMyErrors,
        fillersUnseen: s.allocation.fillersUnseen,
        fillersSeen: s.allocation.fillersSeen,
      },
      wrongCount: c.wrong,
      createdAt: s.createdAt,
      closedAt: s.closedAt,
      canStartRetry: s.status === 'completed',
      retryPreview: retryPreview(s),
    };
  }

  function reportedLaterSlots(s: Session): Set<SlotId> {
    const set = new Set<SlotId>();
    for (const e of Object.values(user.events)) {
      if (e.type === 'question_reported' && e.sessionId === s.id && e.reportedLaterAt !== null && e.slotId) set.add(e.slotId);
    }
    return set;
  }

  function reviewVM(s: Session, filter: ReviewFilter): ReviewVM {
    const later = reportedLaterSlots(s);
    const all = s.plan.flatMap((id, i) => {
      const sl = s.slots[id];
      if (!sl) return [];
      const status: ReviewVM['items'][number]['status'] = sl.excluded
        ? 'excluded'
        : !sl.attempt
          ? 'unanswered'
          : sl.attempt.correct
            ? 'correct'
            : 'wrong';
      return [{ slotId: sl.id, number: i + 1, status, reportedLater: later.has(sl.id), domainId: sl.snapshot.domainId, domainTitle: sl.snapshot.domainTitle, stem: sl.snapshot.stem }];
    });
    const wrong = all.filter((x) => x.status === 'wrong');
    return {
      name: 'review',
      sessionId: s.id,
      sessionStatus: s.status,
      kind: s.kind,
      filter,
      counts: { all: all.length, wrong: wrong.length },
      items: filter === 'wrong' ? wrong : all,
      canStartRetry: s.kind === 'test' && s.status === 'completed',
      retryPreview: retryPreview(s),
      config: configLabel(s.config),
      createdAt: s.createdAt,
    };
  }

  function configKeyOf(c: SessionConfig): string {
    return `${c.scope}|${c.difficulty}|${c.targetN ?? '-'}|${c.myErrorsPriority ? 'E' : '-'}`;
  }

  function historyVM(): HistoryVM {
    const sessions = Object.values(user.sessions).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const tests = sessions.filter((s) => s.kind === 'test' && (s.status === 'completed' || s.status === 'unfinished'));
    const inFilter = (s: Session) => historyFilter.kind === 'all' || configKeyOf(s.config) === historyFilter.key;
    const chart: ChartPoint[] = tests
      .filter((s) => s.status === 'completed' && s.result && inFilter(s))
      .map((s) => ({
        sessionId: s.id,
        at: s.closedAt ?? s.createdAt,
        percent: s.result?.percent ?? 0,
        passed: s.result?.passed ?? false,
        isRetry: s.retry !== null && s.retry.repeatedCount > 0,
        roundIndex: s.retry?.roundIndex ?? null,
        myErrorsPriority: s.config.myErrorsPriority,
        configKey: configKeyOf(s.config),
      }))
      .reverse();
    const optionsMap = new Map<string, { config: SessionConfig; count: number }>();
    for (const s of tests.filter((t) => t.status === 'completed')) {
      const key = configKeyOf(s.config);
      const prev = optionsMap.get(key);
      optionsMap.set(key, { config: s.config, count: (prev?.count ?? 0) + 1 });
    }
    return {
      name: 'history',
      tab: historyTab,
      filter: historyFilter,
      configOptions: [...optionsMap.entries()].map(([key, v]) => ({ key, config: configLabel(v.config), count: v.count })),
      chart,
      selectedPoint: chart.find((p) => p.sessionId === selectedPoint) ?? null,
      tests: tests.filter(inFilter).map((s) => {
        const c = validCounts(s);
        const n = s.config.targetN ?? 0;
        return {
          sessionId: s.id,
          status: s.status === 'completed' ? 'completed' : 'unfinished',
          correct: c.correct,
          targetN: n,
          answeredValid: c.answered,
          percentText: s.status === 'completed' ? formatPercentPl(c.correct, n) : null,
          passed: s.result?.passed ?? null,
          config: configLabel(s.config),
          isRetry: s.retry !== null && s.retry.repeatedCount > 0,
          roundIndex: s.retry?.roundIndex ?? null,
          createdAt: s.createdAt,
          closedAt: s.closedAt,
        };
      }),
      freeFlow: sessions
        .filter((s) => s.kind === 'freeflow' && s.status === 'ended')
        .map((s) => {
          const c = validCounts(s);
          return {
            sessionId: s.id,
            answeredValid: c.answered,
            correct: c.correct,
            percentText: formatPercentPl(c.correct, c.answered),
            config: configLabel(s.config),
            createdAt: s.createdAt,
            closedAt: s.closedAt,
          };
        }),
    };
  }

  function bankInfo() {
    return bankInfoOf(catalog as Catalog);
  }

  function screenVM(): ScreenVM | null {
    if (!booted || !catalog) return null;
    switch (route.name) {
      case 'home':
        return { name: 'home', showInstallHint: sim.installHint && user.settings.installHintDismissedAt === null, resume: resumeVM() };
      case 'config':
        return configVM(route.mode);
      case 'question': {
        const s = user.sessions[route.sessionId];
        if (!s || s.status !== 'open') return null;
        const pos = Math.min(viewPosition, s.plan.length - 1);
        const slotId = s.plan[pos];
        const answeredEarlier = pos < s.reached && !!slotId && s.slots[slotId]?.attempt != null;
        return questionVM(s, pos, answeredEarlier ? 'preview' : 'live', false);
      }
      case 'reviewItem': {
        const s = user.sessions[route.sessionId];
        if (!s) return null;
        const pos = s.plan.indexOf(route.slotId);
        if (pos < 0) return null;
        const list = reviewVM(s, route.filter).items.map((x) => x.slotId);
        const index = list.indexOf(route.slotId);
        const nav: QuestionVM['reviewNav'] = {
          filter: route.filter,
          index: Math.max(0, index),
          total: list.length,
          prevSlotId: index > 0 ? (list[index - 1] ?? null) : null,
          nextSlotId: index >= 0 && index < list.length - 1 ? (list[index + 1] ?? null) : null,
          sessionDate: s.closedAt ?? s.createdAt,
        };
        return questionVM(s, pos, 'review', reportedLaterSlots(s).has(route.slotId), nav);
      }
      case 'result': {
        const s = user.sessions[route.sessionId];
        return s && s.kind === 'test' ? resultVM(s, route.origin) : null;
      }
      case 'review': {
        const s = user.sessions[route.sessionId];
        return s ? reviewVM(s, route.filter) : null;
      }
      case 'freeflowSummary': {
        const s = user.sessions[route.sessionId];
        if (!s) return null;
        const c = validCounts(s);
        return {
          name: 'freeflowSummary',
          sessionId: s.id,
          origin: route.origin,
          answeredValid: c.answered,
          correct: c.correct,
          percentText: formatPercentPl(c.correct, c.answered),
          config: configLabel(s.config),
          createdAt: s.createdAt,
          closedAt: s.closedAt,
        };
      }
      case 'history':
        return historyVM();
      case 'settings':
        return { name: 'settings', activeBlocksCount: activeBlockList().length, bank: bankInfo(), appVersion };
      case 'about': {
        const cat = catalog;
        return {
          name: 'about',
          bank: bankInfo(),
          byDomain: bankByDomainOf(cat),
          packs: [],
          appVersion,
        };
      }
      case 'backup':
        return { name: 'backup', flow: backupFlow, safetyBackups: safetyBackups.map(({ file: _file, ...info }) => info) };
      case 'poolImport':
        return { name: 'poolImport', flow: poolFlow };
      case 'excluded':
        return {
          name: 'excluded',
          items: activeBlockList().map((b) => ({
            blockId: b.id,
            questionId: b.questionId,
            stem: b.stemPreview,
            domainId: b.domainId,
            domainTitle: domainTitle(b.domainId),
            createdAt: b.createdAt,
          })),
          hasOpenTest: openSessionObj()?.kind === 'test',
        };
    }
  }

  function buildState(): AppState {
    const update: UpdateState = {
      available: sim.updateAvailable,
      canApplyNow: sim.updateAvailable && route.name !== 'question' && save.status === 'idle',
      applying: updateApplying,
    };
    return {
      boot: booted ? { phase: 'ready' } : { phase: 'loading', stage: 'loading-bank' },
      route,
      screen: screenVM(),
      catalog,
      userState: booted ? user : null,
      resume: booted ? resumeVM() : null,
      save,
      toast,
      online: !sim.offline,
      update,
      preparation: sim.preparation,
      storage: { persisted, usageBytes: null, quotaBytes: null },
      appVersion,
    };
  }

  /* ---------- pomocnicze dla akcji ---------- */

  function currentOpen(): { s: Session; slot: Slot; position: number } | null {
    if (route.name !== 'question') return null;
    const s = user.sessions[route.sessionId];
    if (!s || s.status !== 'open') return null;
    const id = s.plan[viewPosition];
    const slot = id ? s.slots[id] : undefined;
    return slot ? { s, slot, position: viewPosition } : null;
  }

  function invalidateUndo(sessionId: SessionId): void {
    if (undo && undo.sessionId === sessionId) {
      undo = null;
      if (toast?.canUndo) toast = null;
    }
  }

  function startSessionCommand(kind: SessionKind, config: SessionConfig, slots: Slot[], cap: number, retry: Session['retry']): Promise<ActionResult> {
    return runCommand('start-session', () => {
      closeOpenSession();
      const session = newSession(kind, config, slots, cap, retry);
      putSession(session);
      const key = kind === 'test' ? 'lastTestConfig' : 'lastFreeFlowConfig';
      setUser({ ...user, settings: { ...user.settings, [key]: config, updatedAt: nowIso() } });
      undo = null;
      toast = null;
      ffNotice = null;
      enterQuestion(session.id, 0);
      return { ok: true };
    });
  }

  /* ---------- kontroler ---------- */

  const controller: MockController = {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async start() {
      catalog = mockCatalog(options.bank);
      booted = true;
      if (route.name === 'question' && !user.sessions[route.sessionId]) route = HOME_ROUTE;
      publish();
    },
    async retryBoot() {
      await controller.start();
    },
    dispose() {
      listeners.clear();
    },

    navigate(next) {
      if (next.name === 'question') {
        const s = user.sessions[next.sessionId];
        if (!s || s.status !== 'open') {
          route = HOME_ROUTE;
          publish();
          return;
        }
        enterQuestion(s.id, s.reached);
      } else {
        route = next;
      }
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
          const s = user.sessions[route.sessionId];
          route = s?.kind === 'freeflow' ? { name: 'freeflowSummary', sessionId: route.sessionId, origin: 'history' } : { name: 'result', sessionId: route.sessionId, origin: 'history' };
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

    resume() {
      const s = openSessionObj();
      if (!s) return;
      enterQuestion(s.id, s.reached);
      publish();
    },
    async dismissInstallHint() {
      return runCommand('settings', () => {
        setUser({ ...user, settings: { ...user.settings, installHintDismissedAt: nowIso(), updatedAt: nowIso() } });
        return { ok: true };
      });
    },

    openConfig(mode) {
      const last = mode === 'test' ? user.settings.lastTestConfig : user.settings.lastFreeFlowConfig;
      drafts = { ...drafts, [mode]: draftFrom(last ?? (mode === 'test' ? DEFAULT_TEST_CONFIG : DEFAULT_FREE_FLOW_CONFIG)) };
      route = { name: 'config', mode };
      publish();
    },
    updateConfigDraft(patch) {
      if (route.name !== 'config') return;
      drafts = { ...drafts, [route.mode]: { ...drafts[route.mode], ...patch } };
      publish();
    },
    async startTest() {
      const draft = drafts.test;
      const cap = capacity(draft.scope, draft.difficulty);
      const v = validateN(draft.nText, cap);
      if (!v.ok) return failResult('INVALID_N', 'Nieprawidłowa liczba pytań.');
      const candidates = pool(draft.scope, draft.difficulty);
      const mandatory: CatalogQuestion[] = [];
      if (draft.myErrorsPriority) {
        const errs = new Set(activeErrorIds(draft.scope, draft.difficulty));
        const seenFam = new Set<string>();
        for (const q of candidates) {
          if (errs.has(q.id) && !seenFam.has(q.familyId) && mandatory.length < v.n) {
            mandatory.push(q);
            seenFam.add(q.familyId);
          }
        }
      }
      const fillers = pickFamilies(candidates, v.n - mandatory.length, new Set(mandatory.map((q) => q.familyId)));
      const slots = shuffle(
        [...mandatory.map((q) => makeSlot(q, 'my_errors')), ...fillers.map((q) => makeSlot(q, 'planned'))],
        rng,
      );
      starting = true;
      const config: SessionConfig = { scope: draft.scope, difficulty: draft.difficulty, targetN: v.n, myErrorsPriority: draft.myErrorsPriority };
      const r = await startSessionCommand('test', config, slots, cap, null);
      starting = false;
      publish();
      return r;
    },
    async startFreeFlow() {
      const draft = drafts.freeflow;
      const cap = capacity(draft.scope, draft.difficulty);
      if (cap === 0) return failResult('EMPTY_POOL', 'Brak dostępnych pytań dla tej konfiguracji.');
      const config: SessionConfig = { scope: draft.scope, difficulty: draft.difficulty, targetN: null, myErrorsPriority: draft.myErrorsPriority };
      const probe: Session = newSession('freeflow', config, [], cap, null);
      const first = nextFreeFlowQuestion(probe);
      const slots = first ? [makeSlot(first, draft.myErrorsPriority && activeErrorIds(draft.scope, draft.difficulty).includes(first.id) ? 'my_errors' : 'freeflow')] : [];
      starting = true;
      const r = await startSessionCommand('freeflow', config, slots, cap, null);
      starting = false;
      publish();
      return r;
    },

    async answer(optionId) {
      const cur = currentOpen();
      if (!cur || cur.slot.attempt || cur.slot.excluded) return failResult('NOT_ALLOWED', 'Odpowiedź niedostępna.');
      if (pending?.pendingAnswer) return failResult('PENDING', 'Poprzednia odpowiedź czeka na zapis.');
      if (!cur.slot.optionOrder.includes(optionId)) return failResult('OPTION_NOT_FOUND', 'Nieznana opcja.');
      const sessionId = cur.s.id;
      const slotId = cur.slot.id;
      return runCommand(
        'answer',
        (commandId) => {
          const s = user.sessions[sessionId];
          const slot = s?.slots[slotId];
          if (!s || !slot || slot.attempt) return { ok: true };
          const now = nowIso();
          const correct = optionId === slot.snapshot.correctOptionId;
          putSession({
            ...s,
            revision: s.revision + 1,
            mutationSeq: s.mutationSeq + 1,
            updatedAt: now,
            slots: { ...s.slots, [slotId]: { ...slot, attempt: { commandId, optionId, correct, answeredAt: now } } },
          });
          const stat = statFor(slot);
          setUser({
            ...user,
            questionStats: {
              ...user.questionStats,
              [slot.questionId]: {
                ...stat,
                answeredCount: stat.answeredCount + 1,
                correctCount: stat.correctCount + (correct ? 1 : 0),
                wrongCount: stat.wrongCount + (correct ? 0 : 1),
                lastAnsweredAt: now,
                activeError: !correct,
                dueAt: correct ? null : now,
                lastWrongAt: correct ? stat.lastWrongAt : now,
                lastWrongSessionId: correct ? stat.lastWrongSessionId : sessionId,
                resolvedAt: correct && stat.activeError ? now : stat.resolvedAt,
              },
            },
          });
          invalidateUndo(sessionId);
          return { ok: true };
        },
        { slotId, optionId },
      );
    },
    async next() {
      const cur = currentOpen();
      if (!cur || (!cur.slot.attempt && !cur.slot.excluded)) return failResult('NOT_ALLOWED', 'Najpierw odpowiedz na pytanie.');
      const s = cur.s;
      if (cur.position < s.reached) {
        // Podgląd (tylko odczyt): krok do następnej pozycji, bez zapisu (Design: „Dalej” w podglądzie).
        viewPosition = Math.min(cur.position + 1, s.reached);
        publish();
        return { ok: true };
      }
      if (s.kind === 'test') {
        if (cur.position >= s.plan.length - 1) {
          // S24g: wcześniejsza pozycja czeka na zastępstwo — „Przejdź do pytania k”.
          const waiting = s.awaitingReplacement.map((id) => s.plan.indexOf(id)).filter((i) => i >= 0 && i !== cur.position);
          if (waiting.length === 0) return failResult('LAST', 'To ostatnie pytanie.');
          viewPosition = Math.min(...waiting);
          publish();
          return { ok: true };
        }
        return runCommand('advance', () => {
          const fresh = user.sessions[s.id] as Session;
          putSession({ ...fresh, reached: fresh.reached + 1, revision: fresh.revision + 1, updatedAt: nowIso() });
          enterQuestion(s.id, fresh.reached + 1);
          return { ok: true };
        });
      }
      return runCommand('next-freeflow', () => {
        const fresh = user.sessions[s.id] as Session;
        const q = nextFreeFlowQuestion(fresh);
        if (fresh.config.myErrorsPriority && activeErrorIds(fresh.config.scope, fresh.config.difficulty).length === 0 && !fresh.freeFlow?.myErrorsExhaustedNotified) {
          ffNotice = fresh.id;
        } else {
          ffNotice = null;
        }
        if (!q) {
          putSession({ ...fresh, freeFlow: { myErrorsExhaustedNotified: fresh.freeFlow?.myErrorsExhaustedNotified ?? false, picks: fresh.freeFlow?.picks ?? 0, empty: true }, revision: fresh.revision + 1 });
          return { ok: false, code: 'EMPTY_POOL', messagePl: 'W tym zakresie nie ma już dostępnych pytań.' };
        }
        const slot = makeSlot(q, 'freeflow');
        putSession({
          ...fresh,
          plan: [...fresh.plan, slot.id],
          slots: { ...fresh.slots, [slot.id]: slot },
          reached: fresh.plan.length,
          revision: fresh.revision + 1,
          updatedAt: nowIso(),
          freeFlow: {
            myErrorsExhaustedNotified: (fresh.freeFlow?.myErrorsExhaustedNotified ?? false) || ffNotice === fresh.id,
            empty: false,
            picks: (fresh.freeFlow?.picks ?? 0) + 1,
          },
        });
        enterQuestion(fresh.id, fresh.plan.length);
        return { ok: true };
      });
    },
    showPrevious() {
      if (route.name !== 'question' || viewPosition <= 0) return;
      viewPosition -= 1;
      publish();
    },
    backToCurrent() {
      if (route.name !== 'question') return;
      const s = user.sessions[route.sessionId];
      if (!s) return;
      viewPosition = s.reached;
      publish();
    },
    async report() {
      if (route.name === 'reviewItem') {
        const s = user.sessions[route.sessionId];
        const slot = s?.slots[route.slotId];
        if (!s || !slot) return failResult('SLOT_NOT_FOUND', 'Nie znaleziono pytania.');
        const slotId = slot.id;
        return runCommand('report', () => {
          const now = nowIso();
          const blockId = newId('block');
          const eventId = newId('event');
          const event: DmeEvent = {
            id: eventId,
            at: now,
            commandId: null,
            type: 'question_reported',
            sessionId: s.id,
            slotId,
            questionId: slot.questionId,
            revision: slot.snapshot.revision,
            blockId,
            phase: 'after_close',
            reportedLaterAt: now,
          };
          setUser({
            ...user,
            blocks: { ...user.blocks, [blockId]: blockFrom(slot, blockId, eventId, s.id, now) },
            events: { ...user.events, [eventId]: event },
          });
          showToast('reported_closed');
          return { ok: true };
        });
      }
      const cur = currentOpen();
      if (!cur || cur.slot.excluded) return failResult('NOT_ALLOWED', 'Zgłoszenie niedostępne.');
      const { s, slot, position } = cur;
      return runCommand('report', () => {
        const now = nowIso();
        const blockId = newId('block');
        const eventId = newId('event');
        const previous = s;
        const block = blockFrom(slot, blockId, eventId, s.id, now);
        setUser({ ...user, blocks: { ...user.blocks, [blockId]: block } });
        const planFamilies = new Set(s.plan.map((id) => s.slots[id]?.snapshot.familyId));
        const replacementQ =
          s.kind === 'freeflow' ? nextFreeFlowQuestion(s) : pickFamilies(pool(s.config.scope, s.config.difficulty), 1, new Set([...planFamilies].filter((f): f is string => !!f)))[0] ?? null;
        const excludedSlot: Slot = { ...slot, excluded: { reason: 'reported', at: now, eventId } };
        const event: DmeEvent = {
          id: eventId,
          at: now,
          commandId: null,
          type: 'question_reported',
          sessionId: s.id,
          slotId: slot.id,
          questionId: slot.questionId,
          revision: slot.snapshot.revision,
          blockId,
          phase: slot.attempt ? 'after_answer' : 'before_answer',
          reportedLaterAt: null,
        };
        let next: Session = { ...s, slots: { ...s.slots, [slot.id]: excludedSlot }, revision: s.revision + 1, mutationSeq: s.mutationSeq + 1, updatedAt: now, events: [...s.events, event] };
        if (replacementQ) {
          const repl = makeSlot(replacementQ, 'replacement', slot.id);
          const plan = [...next.plan];
          plan[position] = repl.id;
          next = { ...next, plan, slots: { ...next.slots, [repl.id]: repl } };
          showToast('reported_replaced', {}, true);
        } else {
          next = { ...next, awaitingReplacement: [...next.awaitingReplacement, slot.id] };
          showToast('reported_awaiting', {}, true);
        }
        putSession(next);
        setUser({ ...user, events: { ...user.events, [eventId]: event } });
        undo = { sessionId: s.id, mutationSeq: next.mutationSeq, previous, blockId };
        enterQuestion(s.id, position);
        return { ok: true };
      });
    },
    async undoReport() {
      const u = undo;
      if (!u) return failResult('UNDO_EXPIRED', 'Cofnięcie nie jest już dostępne.');
      const s = user.sessions[u.sessionId];
      if (!s || s.mutationSeq !== u.mutationSeq) {
        undo = null;
        return failResult('UNDO_EXPIRED', 'Cofnięcie nie jest już dostępne.');
      }
      return runCommand('undo-report', () => {
        const restored: Session = { ...u.previous, revision: s.revision + 1, mutationSeq: s.mutationSeq + 1, updatedAt: nowIso() };
        const blocks = { ...user.blocks };
        delete blocks[u.blockId];
        setUser({ ...user, blocks });
        putSession(restored);
        undo = null;
        showToast('report_undone');
        if (route.name === 'question') enterQuestion(restored.id, Math.min(viewPosition, restored.plan.length - 1));
        return { ok: true };
      });
    },
    async showResult() {
      const cur = currentOpen();
      if (!cur || cur.s.kind !== 'test') return failResult('NOT_ALLOWED', 'Wynik niedostępny.');
      const s = cur.s;
      const c = validCounts(s);
      const n = s.config.targetN ?? 0;
      if (c.answered !== n || s.awaitingReplacement.length > 0) return failResult('TEST_NOT_COMPLETE', 'Test nie jest ukończony.');
      return runCommand('finish', () => {
        const now = nowIso();
        putSession({
          ...s,
          status: 'completed',
          closedAt: now,
          updatedAt: now,
          revision: s.revision + 1,
          mutationSeq: s.mutationSeq + 1,
          result: { correct: c.correct, targetN: n, passed: isPassed(c.correct, n), percent: truncatedPercent(c.correct, n) ?? 0 },
        });
        invalidateUndo(s.id);
        route = { name: 'result', sessionId: s.id, origin: 'session' };
        return { ok: true };
      });
    },
    pauseSession() {
      route = HOME_ROUTE;
      publish();
    },
    async closeUnfinished(sessionId) {
      const s = sessionId ? user.sessions[sessionId] : openSessionObj();
      if (!s || s.status !== 'open' || s.kind !== 'test') return failResult('NOT_ALLOWED', 'Brak otwartego testu.');
      return runCommand('close-unfinished', () => {
        putSession({ ...s, status: 'unfinished', closedAt: nowIso(), updatedAt: nowIso(), revision: s.revision + 1, mutationSeq: s.mutationSeq + 1 });
        invalidateUndo(s.id);
        route = HOME_ROUTE;
        showToast('test_closed_unfinished');
        return { ok: true };
      });
    },
    async endFreeFlow(sessionId) {
      const s = sessionId ? user.sessions[sessionId] : openSessionObj();
      if (!s || s.status !== 'open' || s.kind !== 'freeflow') return failResult('NOT_ALLOWED', 'Brak otwartej sesji Free Flow.');
      return runCommand('end-freeflow', () => {
        putSession({ ...s, status: 'ended', closedAt: nowIso(), updatedAt: nowIso(), revision: s.revision + 1, mutationSeq: s.mutationSeq + 1 });
        invalidateUndo(s.id);
        route = { name: 'freeflowSummary', sessionId: s.id, origin: 'session' };
        showToast('freeflow_saved');
        return { ok: true };
      });
    },
    async retrySave() {
      if (!pending) return failResult('NOTHING_TO_RETRY', 'Brak zapisu do ponowienia.');
      return runCommand(pending.action, pending.apply, pending.pendingAnswer, pending.commandId);
    },
    dismissToast() {
      toast = null;
      publish();
    },

    openReview(sessionId, filter = 'all') {
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
      const id = sourceSessionId ?? (route.name === 'result' || route.name === 'review' ? route.sessionId : undefined);
      const parent = id ? user.sessions[id] : undefined;
      const preview = parent ? retryPreview(parent) : null;
      if (!parent || !preview) return failResult('NOT_RETRYABLE', 'Nowa runda jest dostępna tylko po ukończonym teście.');
      if (preview.insufficientCapacity !== null) return failResult('INSUFFICIENT_CAPACITY', 'Za mało dostępnych pytań.');
      const wrong = parent.plan
        .map((sid) => parent.slots[sid])
        .filter((sl): sl is Slot => !!sl && !sl.excluded && !!sl.attempt && !sl.attempt.correct)
        .flatMap((sl) => {
          const q = catalog?.questionsById[sl.questionId];
          return q && !isBlocked(q) ? [q] : [];
        });
      const n = parent.config.targetN ?? 0;
      const fillers = pickFamilies(pool(parent.config.scope, parent.config.difficulty), n - wrong.length, new Set(wrong.map((q) => q.familyId)));
      const slots = shuffle([...wrong.map((q) => makeSlot(q, 'repeated_wrong')), ...fillers.map((q) => makeSlot(q, 'filler'))], rng);
      // Jak w domenie (D02): powiązanie z rodzicem zawsze; „Powtórka” tylko przy repeatedCount > 0.
      const retry = {
        sourceSessionId: parent.id,
        retryChainId: parent.retry?.retryChainId ?? parent.id,
        roundIndex: (parent.retry?.roundIndex ?? 1) + 1,
        repeatedCount: wrong.length,
      };
      return startSessionCommand('test', parent.config, slots, capacity(parent.config.scope, parent.config.difficulty), retry);
    },

    openHistory(tab = 'tests') {
      historyTab = tab;
      selectedPoint = null;
      route = { name: 'history', tab };
      publish();
    },
    setHistoryTab(tab) {
      historyTab = tab;
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
      const s = user.sessions[sessionId];
      if (!s) return;
      route = s.kind === 'test' ? { name: 'result', sessionId, origin: 'history' } : { name: 'freeflowSummary', sessionId, origin: 'history' };
      publish();
    },

    openSettings() {
      route = { name: 'settings' };
      publish();
    },
    openBackup() {
      route = { name: 'backup' };
      publish();
    },
    openPoolImport() {
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
    async exportBackup() {
      backupFlow = { step: 'saving' };
      publish();
      const file = backupFile(`dme-kopia-${nowIso().slice(0, 10)}.json`);
      await options.saveFile?.(file);
      backupFlow = { step: 'idle', lastSavedFileName: file.fileName };
      showToast('backup_saved', { fileName: file.fileName });
      publish();
      return { ok: true };
    },
    async selectBackupFile(file, fileName) {
      backupFlow = { step: 'checking', fileName };
      publish();
      await delay();
      const fail = (error: Extract<BackupFlowVM, { step: 'error' }>['error']): ActionResult => {
        backupFlow = { step: 'error', fileName, error };
        validatedBackup = null;
        publish();
        return failResult(error.code, error.messagePl);
      };
      if (file.size > 25 * 1024 * 1024) return fail({ code: 'BackupTooLarge', messagePl: 'Plik jest za duży.', reasonsPl: [], foundVersion: null });
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        return fail({ code: 'InvalidBackup', messagePl: 'Niepoprawna struktura JSON.', reasonsPl: ['Plik nie jest poprawnym JSON.'], foundVersion: null });
      }
      const b = parsed as Partial<BackupFileV1> | null;
      if (!b || b.format !== 'dme-backup' || b.appId !== 'doktor-monika-egzamin' || typeof b.formatVersion !== 'number' || !b.data) {
        return fail({ code: 'InvalidBackup', messagePl: 'To nie jest kopia tej aplikacji.', reasonsPl: ['Brak oznaczenia formatu dme-backup.'], foundVersion: null });
      }
      if (b.formatVersion !== 1) {
        return fail({ code: 'UnsupportedBackupVersion', messagePl: 'Kopia z nowszej wersji aplikacji.', reasonsPl: [], foundVersion: b.formatVersion });
      }
      validatedBackup = b as BackupFileV1;
      backupFlow = { step: 'confirm', fileName, summary: summarize(validatedBackup) };
      publish();
      return { ok: true };
    },
    async confirmBackupReplace() {
      if (backupFlow.step !== 'confirm' || !validatedBackup) return failResult('NOT_ALLOWED', 'Najpierw wybierz plik kopii.');
      const fileName = backupFlow.fileName;
      const incoming = validatedBackup;
      backupFlow = { step: 'replacing', fileName };
      publish();
      await delay();
      const safetyFileName = `dme-przed-wczytaniem-${nowIso().slice(0, 10)}.json`;
      const safetyId = newId('backup');
      const safetyFile = backupFile(safetyFileName);
      safetyBackups = [{ id: safetyId, createdAt: nowIso(), fileName: safetyFileName, sizeBytes: safetyFile.sizeBytes, file: safetyFile }, ...safetyBackups].slice(0, 5);
      const d = incoming.data;
      setUser({
        settings: d.settings[0] ?? emptyUserState().settings,
        sessions: Object.fromEntries(d.sessions.map((x) => [x.id, x])),
        attempts: Object.fromEntries(d.attempts.map((x) => [x.id, x])),
        questionStats: Object.fromEntries(d.questionStats.map((x) => [x.questionId, x])),
        blocks: Object.fromEntries(d.blocks.map((x) => [x.id, x])),
        events: Object.fromEntries(d.events.map((x) => [x.id, x])),
      });
      undo = null;
      backupFlow = { step: 'done', summary: summarize(incoming), safetyBackupId: safetyId, safetyFileName };
      validatedBackup = null;
      publish();
      return { ok: true };
    },
    cancelBackupReplace() {
      validatedBackup = null;
      backupFlow = { step: 'idle', lastSavedFileName: null };
      publish();
    },
    async downloadSafetyBackup(backupId) {
      const id = backupId ?? (backupFlow.step === 'done' ? backupFlow.safetyBackupId : null);
      const found = safetyBackups.find((b) => b.id === id);
      if (!found) return failResult('NOT_ALLOWED', 'Brak kopii bezpieczeństwa.');
      await options.saveFile?.(found.file);
      return { ok: true };
    },
    async restoreSafetyBackup(backupId) {
      const found = safetyBackups.find((b) => b.id === backupId);
      if (!found) return failResult('NotFound', 'Nie znaleziono kopii bezpieczeństwa.');
      return controller.selectBackupFile(new Blob([found.file.text], { type: 'application/json' }), found.fileName);
    },
    resetBackupFlow() {
      validatedBackup = null;
      backupFlow = { step: 'idle', lastSavedFileName: null };
      publish();
    },
    async importPackFile(file, fileName) {
      poolFlow = { step: 'checking', fileName };
      publish();
      await delay();
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        poolFlow = { step: 'error', fileName, issues: [{ questionId: null, code: 'INVALID_JSON', messagePl: 'Plik nie jest poprawnym JSON.' }], messagePl: null };
        publish();
        return failResult('INVALID_PACK', 'Plik nie jest poprawnym JSON.');
      }
      const qs = (parsed as { questions?: unknown }).questions;
      if (!Array.isArray(qs)) {
        poolFlow = { step: 'error', fileName, issues: [{ questionId: null, code: 'NO_QUESTIONS', messagePl: 'Brak listy pytań („questions”).' }], messagePl: null };
        publish();
        return failResult('INVALID_PACK', 'Brak listy pytań.');
      }
      const known = new Set(catalog?.questions.map((q) => q.id));
      const added = qs.filter((q: { id?: unknown }) => typeof q?.id === 'string' && !known.has(q.id)).length;
      poolFlow = { step: 'done', fileName, added, updated: 0, skippedSame: qs.length - added, skippedBlocked: 0, rejected: [], activeBlocks: activeBlockList().length };
      publish();
      return { ok: true };
    },
    resetPoolImportFlow() {
      poolFlow = { step: 'idle' };
      publish();
    },
    async restoreBlock(blockId) {
      const b = user.blocks[blockId];
      if (!b || b.revokedAt) return failResult('BLOCK_NOT_FOUND', 'Nie znaleziono wykluczenia.');
      return runCommand('restore-block', () => {
        setUser({ ...user, blocks: { ...user.blocks, [blockId]: { ...b, revokedAt: nowIso() } } });
        showToast(openSessionObj()?.kind === 'test' ? 'block_restored_open_test' : 'block_restored');
        return { ok: true };
      });
    },
    async requestPersistentStorage() {
      persisted = true;
      publish();
      return { ok: true };
    },
    async applyUpdate() {
      if (!state.update.canApplyNow) return failResult('NOT_NOW', 'Aktualizacja możliwa poza ekranem pytania, po zapisie.');
      updateApplying = true;
      publish();
      await delay();
      updateApplying = false;
      sim = { ...sim, updateAvailable: false };
      showToast('app_updated');
      publish();
      return { ok: true };
    },
    async retryPreparation() {
      sim = { ...sim, preparation: null };
      publish();
      return { ok: true };
    },

    simulate(patch) {
      sim = { ...sim, ...patch };
      publish();
    },
  };

  function blockFrom(slot: Slot, blockId: BlockId, eventId: string, sessionId: SessionId, now: string): Block {
    return {
      id: blockId,
      questionId: slot.questionId,
      revision: slot.snapshot.revision,
      fingerprint: slot.snapshot.fingerprint,
      familyId: slot.snapshot.familyId,
      domainId: slot.snapshot.domainId,
      stemPreview: slot.snapshot.stem,
      reason: 'reported',
      createdAt: now,
      sessionId,
      slotId: slot.id,
      eventId,
      revokedAt: null,
    };
  }

  function backupFile(fileName: string): ExportedFile {
    const data: BackupFileV1 = {
      format: 'dme-backup',
      formatVersion: 1,
      appId: 'doktor-monika-egzamin',
      exportedAt: nowIso(),
      appVersion,
      bankVersions: catalog?.bankVersions ?? [],
      data: {
        settings: [user.settings],
        sessions: Object.values(user.sessions),
        attempts: Object.values(user.attempts),
        questionStats: Object.values(user.questionStats),
        blocks: Object.values(user.blocks),
        events: Object.values(user.events),
        packs: [],
      },
    };
    const text = JSON.stringify(data);
    return { fileName, mimeType: 'application/json', text, sizeBytes: text.length };
  }

  function summarize(b: BackupFileV1): BackupSummary {
    const s = b.data.sessions;
    const open = s.find((x) => x.status === 'open');
    return {
      exportedAt: b.exportedAt,
      formatVersion: b.formatVersion,
      appVersion: b.appVersion,
      completedTests: s.filter((x) => x.kind === 'test' && x.status === 'completed').length,
      unfinishedTests: s.filter((x) => x.kind === 'test' && x.status === 'unfinished').length,
      freeFlowSessions: s.filter((x) => x.kind === 'freeflow' && x.status === 'ended').length,
      openSessions: s.filter((x) => x.status === 'open').length,
      openSessionKind: open?.kind ?? null,
      activeBlocks: b.data.blocks.filter((x) => x.revokedAt === null).length,
      attempts: b.data.attempts.length,
      questionStats: b.data.questionStats.length,
      packs: b.data.packs.length,
    };
  }

  return controller;
}
