/**
 * Budowa modeli widoku (S01–S24) z TRWALE zapisanego stanu i katalogu — czyste funkcje kontrolera.
 *
 * Liczby (pojemność, postęp, wynik, próg, skład rundy, wykres) pochodzą wyłącznie z selektorów
 * i komend domeny (src/domain); tu jest tylko mapowanie na kontrakt `viewModels.ts`.
 * Ochrona przed podpowiedzią (B04): przed odpowiedzią `QuestionVM` nie zawiera klucza, wyjaśnienia,
 * źródeł ani figury objaśnienia — dane te są kopiowane z migawki dopiero, gdy slot ma zapisaną próbę.
 */
import {
  activeBlocks,
  activeSession,
  chartPoints,
  configKey,
  formatPercentPl,
  passThreshold,
  poolFor,
  previewRetryRound,
  QUICK_N_VALUES,
  reportInfo,
  reviewItems,
  sessionProgress,
  stepTestN,
  summarizeHistory,
  summarizeSession,
  validateTestN,
  N_STEP,
} from '../domain/api';
import type {
  Catalog,
  Difficulty,
  DomainId,
  HistoryFilter,
  IsoDateTime,
  OptionId,
  QuestionSnapshot,
  Scope,
  Session,
  SessionConfig,
  SessionId,
  SessionKind,
  Slot,
  SlotId,
  UserState,
} from '../domain/types';
import type { ResultOrigin, ReviewFilter, Route } from './routes';
import type {
  AboutVM,
  AnswerCardVM,
  AnswerLetter,
  AwaitingElsewhereVM,
  BackupFlowVM,
  BankInfoVM,
  ConfigDraft,
  ConfigLabelVM,
  ConfigVM,
  ExcludedVM,
  ExplanationVM,
  FigureVM,
  FreeFlowSummaryVM,
  HistoryVM,
  OriginTag,
  PoolImportFlowVM,
  PrimaryAction,
  QuestionMode,
  QuestionVM,
  ResultVM,
  ResumeVM,
  RetryPreviewVM,
  ReviewNavVM,
  ReviewVM,
  SafetyBackupVM,
  ScreenVM,
  SettingsVM,
} from './viewModels';

const LETTERS: readonly AnswerLetter[] = ['A', 'B', 'C', 'D'];

/** Odpowiedź wybrana, ale jeszcze nie zapisana (zapis w toku albo nieudany). */
export interface PendingAnswer {
  sessionId: SessionId;
  slotId: SlotId;
  optionId: OptionId;
}

/** Wejście budowy ekranu: trwały stan + stan lokalny kontrolera (trasa, szkice, przepływy). */
export interface ViewInput {
  catalog: Catalog;
  user: UserState;
  now: IsoDateTime;
  route: Route;
  /** Pozycja pokazywana w otwartej sesji (trasa `question`). */
  viewPosition: number;
  drafts: Readonly<Record<SessionKind, ConfigDraft>>;
  starting: boolean;
  pendingAnswer: PendingAnswer | null;
  /** Free Flow: sesja, w której pokazać jednorazowy komunikat o wyczerpaniu „Moich błędów”. */
  ffNotice: SessionId | null;
  historyFilter: HistoryFilter;
  selectedPoint: SessionId | null;
  backupFlow: BackupFlowVM;
  /** Lista automatycznych kopii bezpieczeństwa (F03); `null` — jeszcze nie wczytana. */
  safetyBackups: SafetyBackupVM[] | null;
  poolFlow: PoolImportFlowVM;
  appVersion: string;
  /** Czy pokazywać wskazówkę instalacji (dopóki nie zamknięta w ustawieniach). */
  installHint: boolean;
}

/* ========================================================================== */
/* Wspólne                                                                    */
/* ========================================================================== */

export function domainTitleOf(catalog: Catalog, domainId: DomainId): string {
  return catalog.domains.find((d) => d.id === domainId)?.title ?? domainId;
}

export function scopeTitleOf(catalog: Catalog, scope: Scope): string {
  return scope === 'ALL' ? 'Cały zakres' : domainTitleOf(catalog, scope);
}

export function configLabelOf(catalog: Catalog, config: SessionConfig): ConfigLabelVM {
  return {
    scope: config.scope,
    scopeTitle: scopeTitleOf(catalog, config.scope),
    difficulty: config.difficulty,
    targetN: config.targetN,
    myErrorsPriority: config.myErrorsPriority,
  };
}

export function draftFromConfig(config: Readonly<SessionConfig>, fallbackN: number): ConfigDraft {
  return {
    scope: config.scope,
    difficulty: config.difficulty,
    nText: String(config.targetN ?? fallbackN),
    myErrorsPriority: config.myErrorsPriority,
  };
}

function figureVM(f: QuestionSnapshot['figure']): FigureVM | null {
  return f ? { figureId: f.id, src: f.file, alt: f.alt, caption: f.caption } : null;
}

function slotAt(session: Session, position: number): Slot | null {
  const id = session.plan[position];
  return id ? (session.slots[id] ?? null) : null;
}

/** Ważne ocenione i poprawne w planie. */
function counts(session: Session): { answered: number; correct: number } {
  const p = sessionProgress(session);
  return { answered: p.answeredValid, correct: p.correctValid };
}

/* ========================================================================== */
/* S01–S02 Start                                                              */
/* ========================================================================== */

export function resumeVMOf(catalog: Catalog, user: UserState): ResumeVM | null {
  const s = activeSession(user);
  if (!s) return null;
  const p = sessionProgress(s);
  return {
    sessionId: s.id,
    kind: s.kind,
    answeredValid: p.answeredValid,
    targetN: s.config.targetN,
    questionNumber: p.questionNumber,
    config: configLabelOf(catalog, s.config),
    retryRoundIndex: s.retry && s.retry.repeatedCount > 0 ? s.retry.roundIndex : null,
    awaitingReplacement: p.awaitingReplacement,
    awaitingCount: s.awaitingReplacement.length,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/* ========================================================================== */
/* S03–S05 Konfiguracja                                                       */
/* ========================================================================== */

function configVM(input: ViewInput, mode: SessionKind): ConfigVM {
  const { catalog, user } = input;
  const draft = input.drafts[mode];
  const pool = poolFor(catalog, user, draft.scope, draft.difficulty, input.now);
  const cap = pool.capacity;
  const nValidation = mode === 'test' ? validateTestN(draft.nText, cap) : null;
  const open = activeSession(user);
  const scopes: Scope[] = ['ALL', ...catalog.domains.map((d) => d.id)];
  return {
    name: 'config',
    mode,
    draft,
    scopeTitle: scopeTitleOf(catalog, draft.scope),
    scopeOptions: scopes.map((scope) => {
      const p = scope === draft.scope ? pool : poolFor(catalog, user, scope, draft.difficulty, input.now);
      return { scope, title: scopeTitleOf(catalog, scope), capacity: p.capacity, questionCount: p.questionIds.length };
    }),
    capacity: cap,
    questionCount: pool.questionIds.length,
    unseenFamilies: pool.unseenFamilies,
    nValidation,
    canDecrement: stepTestN(draft.nText, -N_STEP, cap) !== null,
    canIncrement: stepTestN(draft.nText, N_STEP, cap) !== null,
    quickValues: QUICK_N_VALUES.map((n) => ({ n, enabled: n <= cap, selected: draft.nText.trim() === String(n) })),
    activeErrorsInScope: pool.activeErrors,
    openSession: open
      ? { sessionId: open.id, kind: open.kind, answeredValid: counts(open).answered, targetN: open.config.targetN }
      : null,
    canStart: !input.starting && cap > 0 && (nValidation === null || nValidation.ok),
    starting: input.starting,
  };
}

/* ========================================================================== */
/* S06–S15, S24 Pytanie                                                       */
/* ========================================================================== */

/** Rodzina pytania była wyświetlona przed rozpoczęciem tej sesji („Z wcześniejszej nauki”). */
function familySeenBefore(user: UserState, familyId: string, before: IsoDateTime): boolean {
  for (const stat of Object.values(user.questionStats)) {
    if (stat.familyId === familyId && stat.firstSeenAt !== null && stat.firstSeenAt < before) return true;
  }
  return false;
}

function originTagOf(user: UserState, session: Session, slot: Slot): OriginTag {
  if (slot.origin === 'repeated_wrong') return 'repeated_wrong';
  if (slot.origin === 'my_errors') return 'my_errors';
  if (slot.origin === 'filler' && familySeenBefore(user, slot.snapshot.familyId, session.createdAt)) return 'seen_filler';
  return null;
}

/** Pierwsza pozycja ≤ `reached` bez ważnej odpowiedzi (np. zastępstwo wcześniejszej pozycji testu). */
export function firstOpenPosition(session: Session): number | null {
  for (let i = 0; i <= Math.min(session.reached, session.plan.length - 1); i++) {
    const slot = slotAt(session, i);
    if (slot && !slot.attempt && !slot.excluded) return i;
  }
  return null;
}

/**
 * Pozycje planu otwartego testu czekające na zastępstwo (S24g), rosnąco. Wykluczony slot bez
 * zastępstwa zostaje na swojej pozycji w `plan`, więc pozycję wyznacza indeks w planie.
 */
export function awaitingPositions(session: Session): number[] {
  if (session.kind !== 'test' || session.status !== 'open') return [];
  return session.awaitingReplacement
    .map((id) => session.plan.indexOf(id))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
}

/** Tryb pozycji: wcześniejsza z zapisaną odpowiedzią albo wykluczona = podgląd tylko do odczytu. */
export function modeAt(session: Session, position: number): QuestionMode {
  const slot = slotAt(session, position);
  if (!slot) return 'live';
  if (position < session.reached && (slot.attempt !== null || slot.excluded !== null)) return 'preview';
  return 'live';
}

export function questionVMOf(
  input: ViewInput,
  session: Session,
  position: number,
  mode: QuestionMode,
  reportedLater: boolean,
  reviewNav: ReviewNavVM | null = null,
): QuestionVM | null {
  const { catalog, user } = input;
  const slot = slotAt(session, position);
  if (!slot) return null;
  const snap = slot.snapshot;
  const attempt = slot.attempt;
  const pending =
    mode === 'live' && input.pendingAnswer && input.pendingAnswer.sessionId === session.id && input.pendingAnswer.slotId === slot.id && !attempt
      ? input.pendingAnswer
      : null;
  const open = session.status === 'open';
  const answers: AnswerCardVM[] = snap.options.map((o, i) => {
    let state: AnswerCardVM['state'] = 'neutral';
    if (attempt) {
      if (o.id === attempt.optionId) state = attempt.correct ? 'selected-correct' : 'selected-wrong';
      else if (o.id === snap.correctOptionId) state = 'correct-unselected';
      else state = 'rest-after-eval';
    } else if (pending && pending.optionId === o.id) {
      state = 'pending';
    }
    return {
      optionId: o.id,
      letter: LETTERS[i] ?? 'A',
      text: o.text,
      state,
      interactive: mode === 'live' && open && !attempt && !pending && !slot.excluded,
    };
  });

  // Wyjaśnienie, źródła i figura objaśnienia — WYŁĄCZNIE po zapisanej odpowiedzi (B04).
  let explanation: ExplanationVM | null = null;
  if (attempt) {
    const topic = snap.topics[0];
    explanation = {
      text: snap.explanation,
      figure: figureVM(snap.explanationFigure),
      context: topic ? { topicTitle: topic.title, learningObjective: topic.learningObjective, pearls: [...topic.pearls] } : null,
      sources: snap.sources.map((s) => ({ id: s.id, title: s.title, kindPl: s.kindPl, accessPl: s.accessPl, url: s.url, doi: s.doi, pmid: s.pmid })),
      sourceLocator: snap.sourceLocator,
    };
  }

  const progress = sessionProgress(session);
  const isTest = session.kind === 'test';
  const awaiting = session.awaitingReplacement.includes(slot.id);
  const isLastTestSlot = isTest && position === session.plan.length - 1;
  const ffEmpty = session.kind === 'freeflow' && (session.freeFlow?.empty ?? false) && mode === 'live' && open && (attempt !== null || slot.excluded !== null);
  // S24g na poziomie sesji (E03): inna pozycja czeka na zastępstwo — informacja i droga do niej z każdej pozycji.
  const waiting = mode === 'review' ? [] : awaitingPositions(session);
  const firstAwaiting = waiting.find((i) => i !== position);
  const awaitingElsewhere: AwaitingElsewhereVM | null = !awaiting && firstAwaiting !== undefined ? { position: firstAwaiting, count: waiting.length } : null;

  let primary: PrimaryAction = 'none';
  if (mode === 'preview') primary = 'next';
  else if (mode === 'live' && open && !ffEmpty) {
    if (awaiting) {
      // Pozycja bez zastępstwa (baner S24g z akcjami): kolejne pozycje planu można dalej rozwiązywać,
      // a z ostatniej „Dalej” prowadzi do wcześniejszej pozycji bez odpowiedzi (jeśli jest).
      if (isTest && (!isLastTestSlot || firstOpenPosition(session) !== null)) primary = 'next';
    } else if (!attempt && !slot.excluded) primary = pending ? 'none' : 'hint';
    else if (isTest && isLastTestSlot) {
      if (progress.readyToFinish) primary = 'show-result';
      // Ostatnia pozycja oceniona, ale wcześniej czeka zastępstwo bez odpowiedzi → „Dalej” prowadzi do niego.
      else if (firstOpenPosition(session) !== null) primary = 'next';
      // Wszystko ocenione, ale wcześniejsza pozycja nie ma zastępstwa → przejście do niej (baner S24g z akcjami).
      else if (awaitingElsewhere !== null) primary = 'go-awaiting';
    } else primary = 'next';
  }

  return {
    name: 'question',
    sessionId: session.id,
    kind: session.kind,
    mode,
    position,
    reached: session.reached,
    slotId: slot.id,
    progress: isTest
      ? { kind: 'test', answeredValid: progress.answeredValid, targetN: session.config.targetN ?? 0 }
      : { kind: 'freeflow', questionNumber: position + 1 },
    retryRoundIndex: session.retry && session.retry.repeatedCount > 0 ? session.retry.roundIndex : null,
    domainId: snap.domainId,
    domainTitle: snap.domainTitle || domainTitleOf(catalog, snap.domainId),
    difficulty: snap.difficulty,
    originTag: originTagOf(user, session, slot),
    excluded: slot.excluded !== null,
    reportedLater,
    stem: snap.stem,
    figure: figureVM(snap.figure),
    answers,
    answered: attempt !== null,
    correct: attempt ? attempt.correct : null,
    explanation,
    canReport: mode === 'review' ? !reportedLater && !slot.excluded : open && !slot.excluded,
    canGoPrevious: mode !== 'review' && position > 0,
    canJumpToCurrent: mode === 'preview',
    primaryAction: primary,
    savingAnswer: pending !== null,
    awaitingReplacement: awaiting,
    awaitingElsewhere,
    freeFlowEmpty: ffEmpty,
    myErrorsExhaustedNotice: input.ffNotice === session.id && mode === 'live',
    reviewNav,
  };
}

/* ========================================================================== */
/* S16–S18 Wynik, przegląd, nowa runda                                        */
/* ========================================================================== */

export function retryPreviewVMOf(catalog: Catalog, user: UserState, session: Session): RetryPreviewVM | null {
  if (session.kind !== 'test' || session.status !== 'completed') return null;
  const r = previewRetryRound(user, catalog, session.id);
  if (!r.ok) return null;
  const p = r.value;
  return {
    targetN: p.targetN,
    config: configLabelOf(catalog, p.config),
    repeatedWrong: p.repeatedWrong,
    fillersUnseen: p.fillersUnseen,
    fillersSeen: p.fillersSeen,
    nextRoundIndex: p.nextRoundIndex,
    isRetry: p.isRetry,
    insufficientCapacity: p.insufficient ? p.insufficient.capacity : null,
  };
}

function resultVM(input: ViewInput, session: Session, origin: ResultOrigin): ResultVM {
  const { catalog, user } = input;
  const summary = summarizeSession(session);
  const n = session.config.targetN ?? 0;
  const completed = session.status === 'completed' && session.result !== null;
  const correct = completed && session.result ? session.result.correct : summary.correct;
  const { answered, correct: validCorrect } = counts(session);
  const legacy = Boolean(session.legacy);
  return {
    name: 'result',
    sessionId: session.id,
    origin,
    status: completed ? (session.result?.passed ? 'passed' : 'failed') : session.status === 'interrupted_by_update' ? 'interrupted' : 'unfinished',
    legacy,
    correct,
    targetN: n,
    answeredValid: answered,
    percentText: completed ? formatPercentPl(correct, n) : formatPercentPl(validCorrect, answered),
    thresholdCorrect: n > 0 ? passThreshold(n) : 0,
    config: configLabelOf(catalog, session.config),
    retry: session.retry,
    composition: {
      repeatedWrong: session.allocation.mandatoryRepeated,
      myErrors: session.allocation.mandatoryMyErrors,
      fillersUnseen: session.allocation.fillersUnseen,
      fillersSeen: session.allocation.fillersSeen,
    },
    wrongCount: answered - validCorrect,
    createdAt: session.createdAt,
    closedAt: session.closedAt,
    // Runda błędów z sesji poprzedniej wersji banku jest niedostępna (treść usunięta w migracji).
    canStartRetry: completed && !legacy,
    retryPreview: legacy ? null : retryPreviewVMOf(catalog, user, session),
  };
}

function reviewVM(input: ViewInput, session: Session, filter: ReviewFilter): ReviewVM {
  const { catalog, user } = input;
  const legacy = Boolean(session.legacy);
  const all = legacy ? [] : reviewItems(user, session.id, 'all');
  const items = filter === 'wrong' ? all.filter((x) => x.status === 'wrong') : all;
  return {
    name: 'review',
    sessionId: session.id,
    sessionStatus: session.status,
    kind: session.kind,
    filter,
    counts: { all: all.length, wrong: all.filter((x) => x.status === 'wrong').length },
    items: items.map((x) => ({ ...x, domainTitle: domainTitleOf(catalog, x.domainId) })),
    canStartRetry: session.kind === 'test' && session.status === 'completed' && !legacy,
    retryPreview: legacy ? null : retryPreviewVMOf(catalog, user, session),
    legacy,
    config: configLabelOf(catalog, session.config),
    createdAt: session.createdAt,
  };
}

function reviewItemVM(input: ViewInput, session: Session, slotId: SlotId, filter: ReviewFilter): QuestionVM | null {
  const position = session.plan.indexOf(slotId);
  if (position < 0) return null;
  const list = reviewItems(input.user, session.id, filter).map((x) => x.slotId);
  const index = list.indexOf(slotId);
  const nav: ReviewNavVM = {
    filter,
    index: Math.max(0, index),
    total: list.length,
    prevSlotId: index > 0 ? (list[index - 1] ?? null) : null,
    nextSlotId: index >= 0 && index < list.length - 1 ? (list[index + 1] ?? null) : null,
    sessionDate: session.closedAt ?? session.createdAt,
  };
  const later = reportInfo(input.user, session.id).reportedLater.has(slotId);
  return questionVMOf(input, session, position, 'review', later, nav);
}

/* ========================================================================== */
/* S19–S20 Podsumowanie Free Flow, historia                                   */
/* ========================================================================== */

function freeFlowSummaryVM(input: ViewInput, session: Session, origin: ResultOrigin): FreeFlowSummaryVM {
  const { answered, correct } = counts(session);
  return {
    name: 'freeflowSummary',
    sessionId: session.id,
    origin,
    answeredValid: answered,
    correct,
    percentText: formatPercentPl(correct, answered),
    config: configLabelOf(input.catalog, session.config),
    createdAt: session.createdAt,
    closedAt: session.closedAt,
    legacy: Boolean(session.legacy),
    interrupted: session.status === 'interrupted_by_update',
  };
}

function historyVM(input: ViewInput, tab: HistoryVM['tab']): HistoryVM {
  const { catalog, user } = input;
  const summary = summarizeHistory(user);
  const requested = input.historyFilter;
  // Filtr konfiguracji, której już nie ma (np. po wczytaniu kopii) → wszystkie.
  const filter: HistoryFilter = requested.kind === 'config' && summary.configs.some((c) => c.key === requested.key) ? requested : { kind: 'all' };
  const inFilter = (config: SessionConfig): boolean => filter.kind === 'all' || configKey(config) === filter.key;
  const chart = chartPoints(user, filter);
  return {
    name: 'history',
    tab,
    filter,
    configOptions: summary.configs.map((c) => ({ key: c.key, config: configLabelOf(catalog, c.config), count: c.count })),
    chart,
    selectedPoint: chart.find((p) => p.sessionId === input.selectedPoint) ?? null,
    tests: summary.tests
      .filter((t) => inFilter(t.config))
      .map((t) => {
        const n = t.targetN ?? 0;
        const completed = t.status === 'completed';
        return {
          sessionId: t.sessionId,
          status: completed ? ('completed' as const) : t.status === 'interrupted_by_update' ? ('interrupted' as const) : ('unfinished' as const),
          legacy: user.sessions[t.sessionId]?.legacy ? true : false,
          correct: t.correct,
          targetN: n,
          answeredValid: t.answeredValid,
          percentText: completed ? formatPercentPl(t.correct, n) : null,
          passed: t.passed,
          config: configLabelOf(catalog, t.config),
          isRetry: t.retry !== null && t.retry.repeatedCount > 0,
          roundIndex: t.retry?.roundIndex ?? null,
          createdAt: t.createdAt,
          closedAt: t.closedAt,
        };
      }),
    freeFlow: summary.freeFlow.map((f) => ({
      sessionId: f.sessionId,
      interrupted: f.status === 'interrupted_by_update',
      legacy: user.sessions[f.sessionId]?.legacy ? true : false,
      answeredValid: f.answeredValid,
      correct: f.correct,
      percentText: formatPercentPl(f.correct, f.answeredValid),
      config: configLabelOf(catalog, f.config),
      createdAt: f.createdAt,
      closedAt: f.closedAt,
    })),
  };
}

/* ========================================================================== */
/* S21–S23 Ustawienia                                                         */
/* ========================================================================== */

const DIFFICULTY_ORDER: readonly Difficulty[] = ['basic', 'intermediate', 'advanced'];

/** Stan bazy: liczby wbudowanej puli z `catalog.bankSummary` (policzone), cały katalog osobno. */
export function bankInfoOf(catalog: Catalog): BankInfoVM {
  const sum = catalog.bankSummary;
  return {
    bankVersion: catalog.bankVersion,
    builtOn: catalog.builtOn,
    questionCount: sum.questions,
    familyCount: sum.families,
    byDifficulty: DIFFICULTY_ORDER.map((difficulty) => ({ difficulty, count: sum.byDifficulty[difficulty] ?? 0 })),
    independentlyCheckedCount: sum.independentlyChecked,
    schematicCount: sum.schematic,
    poolNotePl: sum.poolNotePl,
    catalogQuestionCount: catalog.questions.length,
    catalogFamilyCount: new Set(catalog.questions.map((q) => q.familyId)).size,
    statusPl: catalog.statusPl,
    clinicalSignoff: catalog.clinicalSignoff,
    retiredCount: (catalog.retiredQuestionIds ?? []).length,
    profileShares: catalog.profile ? catalog.profile.groupOrder.map((group) => ({ group, percent: (catalog.profile?.weightsBp[group] ?? 0) / 100 })) : null,
  };
}

/** Liczba pytań wbudowanej puli w dziedzinach (z `bankSummary`), w kolejności domen katalogu. */
export function bankByDomainOf(catalog: Catalog): AboutVM['byDomain'] {
  return catalog.domains.map((d) => ({ domainId: d.id, title: d.title, count: catalog.bankSummary.byDomain[d.id] ?? 0 }));
}

function settingsVM(input: ViewInput): SettingsVM {
  return { name: 'settings', activeBlocksCount: activeBlocks(input.user).length, bank: bankInfoOf(input.catalog), appVersion: input.appVersion };
}

function aboutVM(input: ViewInput): AboutVM {
  const { catalog } = input;
  return {
    name: 'about',
    bank: bankInfoOf(catalog),
    byDomain: bankByDomainOf(catalog),
    // Od V15 katalog nie łączy żadnych paczek — lista zaimportowanych pul jest zawsze pusta.
    packs: [],
    appVersion: input.appVersion,
  };
}

function excludedVM(input: ViewInput): ExcludedVM {
  const open = activeSession(input.user);
  return {
    name: 'excluded',
    items: activeBlocks(input.user).map((b) => ({
      blockId: b.id,
      questionId: b.questionId,
      stem: b.stemPreview,
      domainId: b.domainId,
      domainTitle: domainTitleOf(input.catalog, b.domainId),
      createdAt: b.createdAt,
    })),
    hasOpenTest: open?.kind === 'test',
  };
}

/* ========================================================================== */
/* Trasa → ekran                                                              */
/* ========================================================================== */

/**
 * Czy trasa ma sens dla bieżącego stanu (np. sesja istnieje, pytanie należy do otwartej sesji).
 * Nieważna trasa → kontroler przekierowuje na start.
 */
export function isRouteValid(route: Route, user: UserState): boolean {
  switch (route.name) {
    case 'question': {
      const s = user.sessions[route.sessionId];
      return s !== undefined && s.status === 'open' && s.plan.length > 0;
    }
    case 'result': {
      const s = user.sessions[route.sessionId];
      return s !== undefined && s.kind === 'test' && s.status !== 'open';
    }
    case 'freeflowSummary': {
      const s = user.sessions[route.sessionId];
      return s !== undefined && s.kind === 'freeflow' && s.status !== 'open';
    }
    case 'review': {
      const s = user.sessions[route.sessionId];
      return s !== undefined && s.status !== 'open';
    }
    case 'reviewItem': {
      const s = user.sessions[route.sessionId];
      return s !== undefined && s.status !== 'open' && s.slots[route.slotId] !== undefined && s.plan.includes(route.slotId);
    }
    default:
      return true;
  }
}

export function buildScreen(input: ViewInput): ScreenVM | null {
  const { route, user } = input;
  switch (route.name) {
    case 'home':
      return {
        name: 'home',
        showInstallHint: input.installHint && user.settings.installHintDismissedAt === null,
        resume: resumeVMOf(input.catalog, user),
      };
    case 'config':
      return configVM(input, route.mode);
    case 'question': {
      const s = user.sessions[route.sessionId];
      if (!s || s.status !== 'open' || s.plan.length === 0) return null;
      const pos = Math.max(0, Math.min(input.viewPosition, s.reached, s.plan.length - 1));
      return questionVMOf(input, s, pos, modeAt(s, pos), false);
    }
    case 'reviewItem': {
      const s = user.sessions[route.sessionId];
      return s ? reviewItemVM(input, s, route.slotId, route.filter) : null;
    }
    case 'result': {
      const s = user.sessions[route.sessionId];
      return s && s.kind === 'test' ? resultVM(input, s, route.origin) : null;
    }
    case 'review': {
      const s = user.sessions[route.sessionId];
      return s ? reviewVM(input, s, route.filter) : null;
    }
    case 'freeflowSummary': {
      const s = user.sessions[route.sessionId];
      return s ? freeFlowSummaryVM(input, s, route.origin) : null;
    }
    case 'history':
      return historyVM(input, route.tab);
    case 'settings':
      return settingsVM(input);
    case 'about':
      return aboutVM(input);
    case 'backup':
      return { name: 'backup', flow: input.backupFlow, safetyBackups: input.safetyBackups };
    case 'poolImport':
      return { name: 'poolImport', flow: input.poolFlow };
    case 'excluded':
      return excludedVM(input);
  }
}
