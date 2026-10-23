/**
 * Komendy sesji (DECYZJE §4–§8): start testu / rundy powtórki / Free Flow, „Dalej”, `markShown`,
 * odpowiedź (idempotentna), uzupełnianie zastępstw, „Pokaż wynik”, zamknięcie bez wyniku, koniec Free Flow.
 */
import type {
  AnswerInput,
  AnswerValue,
  DomainCommandResult,
  MarkShownInput,
  NextFreeFlowValue,
  SessionCommandInput,
  StartFreeFlowInput,
  StartFreeFlowValue,
  StartRetryInput,
  StartSessionValue,
  StartTestInput,
} from './api';
import { pickFreeFlow, type FreeFlowPickResult } from './freeFlowPolicy';
import { blockIndex, familyCount, isBlockedBy, poolQuestions, validateTestN } from './pool';
import { applyAnswer, applyShown, compareByDue, emptyStat } from './review';
import { isPassed, truncatedPercent } from './scoring';
import { buildSeenIndex, type SeenIndex } from './seen';
import { reportInfo, summarizeSession, validCounts } from './selectors';
import { createSlot } from './snapshot';
import { findTestReplacement, planTest, type MandatoryItem, type PlannedPick } from './testPolicy';
import { shuffle, rngFor, toUint32 } from './rng';
import { Tx, unchanged } from './tx';
import type {
  Allocation,
  Attempt,
  Catalog,
  CatalogQuestion,
  CommandContext,
  CommandResult,
  DmeEvent,
  DomainId,
  FamilyId,
  QuestionId,
  QuestionStat,
  RetryInfo,
  RetryPreview,
  Session,
  SessionConfig,
  SessionId,
  SessionKind,
  SessionResult,
  SessionSummary,
  Slot,
  SlotId,
  UserState,
} from './types';
import { copyConfig, fail, isValidConfigShape, ok } from './util';

/* ========================================================================== */
/* Wspólne                                                                    */
/* ========================================================================== */

export const MSG = {
  sessionNotFound: 'Nie znaleziono sesji.',
  sessionNotOpen: 'Ta sesja jest już zamknięta.',
  kindMismatch: 'Ta akcja nie dotyczy tego trybu sesji.',
  stale: 'Sesja zmieniła się w międzyczasie. Odśwież widok i spróbuj ponownie.',
  invalidConfig: 'Nieprawidłowa konfiguracja sesji.',
  emptyPool: 'Brak dostępnych pytań w wybranym zakresie i poziomie. Zmień zakres albo zaimportuj pulę.',
  slotNotFound: 'Nie znaleziono tego pytania w sesji.',
  slotNotAnswered: 'Najpierw odpowiedz na bieżące pytanie.',
} as const;

/** Otwarta sesja z kontrolą rodzaju i rewizji. */
export function requireOpenSession(state: UserState, input: SessionCommandInput, kind?: SessionKind): CommandResult<Session> {
  const session = state.sessions[input.sessionId];
  if (!session) return fail('SESSION_NOT_FOUND', MSG.sessionNotFound);
  if (kind !== undefined && session.kind !== kind) return fail('SESSION_KIND_MISMATCH', MSG.kindMismatch);
  if (session.status !== 'open') return fail('SESSION_NOT_OPEN', MSG.sessionNotOpen);
  if (session.revision !== input.expectedRevision) {
    return fail('STALE_REVISION', MSG.stale, { expectedRevision: input.expectedRevision, revision: session.revision });
  }
  return ok(session);
}

function openSessionOf(state: UserState): Session | null {
  let best: Session | null = null;
  for (const s of Object.values(state.sessions)) {
    if (s.status !== 'open') continue;
    if (!best || s.createdAt > best.createdAt) best = s;
  }
  return best;
}

/** Zamyka otwarte sesje w tej samej zmianie (test → unfinished, Free Flow → ended). */
function closeOpenSessions(tx: Tx): SessionId | null {
  let closedId: SessionId | null = null;
  const open = Object.values(tx.base.sessions).filter((s) => s.status === 'open');
  const newest = openSessionOf(tx.base);
  for (const s of open) {
    const { answered, correct } = validCounts(s);
    const id = tx.ctx.newId('event');
    const base = { id, at: tx.ctx.now, commandId: tx.ctx.commandId };
    const ev: DmeEvent =
      s.kind === 'test'
        ? { ...base, type: 'session_unfinished', sessionId: s.id, answeredValid: answered }
        : { ...base, type: 'freeflow_ended', sessionId: s.id, answeredValid: answered, correct };
    tx.addEvent(ev);
    tx.putSession(
      { ...s, status: s.kind === 'test' ? 'unfinished' : 'ended', closedAt: tx.ctx.now, result: null, events: [...s.events, ev] },
      true,
    );
    if (newest && s.id === newest.id) closedId = s.id;
  }
  return closedId;
}

function startedEvent(ctx: CommandContext, sessionId: SessionId, kind: SessionKind): DmeEvent {
  return { id: ctx.newId('event'), at: ctx.now, commandId: ctx.commandId, type: 'session_started', sessionId, kind };
}

function testCount(state: UserState): number {
  return Object.values(state.sessions).filter((s) => s.kind === 'test').length;
}

function questionOfSlot(slot: Slot): { id: QuestionId; fingerprint: string; familyId: FamilyId } {
  return { id: slot.snapshot.questionId, fingerprint: slot.snapshot.fingerprint, familyId: slot.snapshot.familyId };
}

/* ========================================================================== */
/* Test — dobór i start                                                       */
/* ========================================================================== */

/** „Moje błędy”: aktywne błędy z puli wg należności, jedna pozycja na rodzinę, maks. `max`. */
export function myErrorsMandatory(
  pool: readonly CatalogQuestion[],
  stats: Readonly<Record<QuestionId, QuestionStat>>,
  max: number,
  excludedFamilies: ReadonlySet<FamilyId>,
  excludedQuestions: ReadonlySet<QuestionId>,
): MandatoryItem[] {
  if (max <= 0) return [];
  const errors = pool
    .filter((q) => stats[q.id]?.activeError === true && !excludedQuestions.has(q.id) && !excludedFamilies.has(q.familyId))
    .sort((a, b) => compareByDue(stats[a.id] as QuestionStat, stats[b.id] as QuestionStat));
  const out: MandatoryItem[] = [];
  const families = new Set<FamilyId>();
  for (const q of errors) {
    if (out.length >= max) break;
    if (families.has(q.familyId)) continue;
    families.add(q.familyId);
    out.push({ origin: 'my_errors', questionId: q.id, familyId: q.familyId, domainId: q.domainId, difficulty: q.difficulty, question: q, fallback: null });
  }
  return out;
}

function testSession(
  tx: Tx,
  catalog: Catalog,
  args: { config: SessionConfig; seed: number; picks: readonly PlannedPick[]; allocation: Allocation; retry: RetryInfo | null },
): Session {
  const ctx = tx.ctx;
  const seed = toUint32(args.seed);
  const id = ctx.newId('session');
  const started = startedEvent(ctx, id, 'test');
  tx.addEvent(started);
  const ordered = shuffle(args.picks, rngFor(seed, 'order'));
  const slots: Record<SlotId, Slot> = {};
  const plan: SlotId[] = [];
  for (const p of ordered) {
    const qid = p.question?.id ?? p.fallback?.questionId ?? '';
    const slot = createSlot(catalog, { origin: p.origin, question: p.question, fallback: p.fallback, seed, salt: qid, replacesSlotId: null }, ctx);
    slots[slot.id] = slot;
    plan.push(slot.id);
  }
  return {
    id,
    kind: 'test',
    status: 'open',
    createdAt: ctx.now,
    updatedAt: ctx.now,
    closedAt: null,
    revision: 1,
    mutationSeq: 0,
    config: args.config,
    bankVersion: catalog.bankVersion,
    seed,
    allocation: args.allocation,
    retry: args.retry,
    plan,
    slots,
    reached: 0,
    awaitingReplacement: [],
    events: [started],
    result: null,
    freeFlow: null,
  };
}

/**
 * Start niezależnego testu wg TEST_POLICY_V2 (DECYZJE §6). Błędy: `INVALID_CONFIG`, `INVALID_N`,
 * `N_EXCEEDS_CAPACITY`, `EMPTY_POOL`.
 */
export function startTest(state: UserState, catalog: Catalog, input: StartTestInput, ctx: CommandContext): DomainCommandResult<StartSessionValue> {
  const { config } = input;
  if (!isValidConfigShape(config) || typeof input.seed !== 'number' || !Number.isFinite(input.seed)) {
    return fail('INVALID_CONFIG', MSG.invalidConfig);
  }
  const pool = poolQuestions(catalog, state.blocks, config.scope, config.difficulty);
  const capacity = familyCount(pool);
  if (capacity === 0) return fail('EMPTY_POOL', MSG.emptyPool, { capacity: 0 });
  const v = validateTestN(config.targetN ?? '', capacity);
  if (!v.ok) {
    if (v.code === 'EXCEEDS_CAPACITY') {
      return fail(
        'N_EXCEEDS_CAPACITY',
        `W tym zakresie dostępnych jest ${capacity} różnych zadań (rodzin pytań). Wybierz liczbę od 1 do ${capacity}, zmień zakres albo zaimportuj pulę.`,
        { capacity, requested: config.targetN ?? null },
      );
    }
    return fail('INVALID_N', `Wpisz liczbę całkowitą od 1 do ${capacity}.`, { capacity, reason: v.code });
  }
  const n = v.n;
  const seen = buildSeenIndex(state.questionStats);
  const mandatory = config.myErrorsPriority ? myErrorsMandatory(pool, state.questionStats, n, new Set(), new Set()) : [];
  const plan = planTest({
    pool,
    scope: config.scope,
    difficulty: config.difficulty,
    n,
    mandatory,
    rotationOffset: testCount(state) % 6,
    seed: toUint32(input.seed),
    seen,
    fillerOrigin: 'planned',
    capacityAtStart: capacity,
  });
  if (!plan.ok) {
    return fail('INSUFFICIENT_CAPACITY', `Za mało różnych zadań (rodzin pytań), aby ułożyć test z ${n} pytań. Dostępnych: ${plan.available}.`, {
      capacity: plan.available,
    });
  }
  const tx = new Tx(state, ctx);
  const closedSessionId = closeOpenSessions(tx);
  const frozen = copyConfig(config, n);
  const session = testSession(tx, catalog, { config: frozen, seed: input.seed, picks: plan.picks, allocation: plan.allocation, retry: null });
  tx.putSession(session, false);
  tx.putSettings({ ...state.settings, lastTestConfig: copyConfig(config, n), updatedAt: ctx.now });
  return ok(tx.commit({ sessionId: session.id, closedSessionId }));
}

/* ========================================================================== */
/* Runda „Uwzględnij błędy” / „Nowa runda”                                    */
/* ========================================================================== */

interface RetryPlanContext {
  parent: Session;
  config: SessionConfig;
  n: number;
  pool: CatalogQuestion[];
  capacity: number;
  repeated: MandatoryItem[];
  mandatory: MandatoryItem[];
  seen: SeenIndex;
  rotationOffset: number;
}

function retryContext(state: UserState, catalog: Catalog, sourceSessionId: SessionId): CommandResult<RetryPlanContext> {
  const parent = state.sessions[sourceSessionId];
  if (!parent) return fail('SESSION_NOT_FOUND', MSG.sessionNotFound);
  if (parent.kind !== 'test' || parent.status !== 'completed' || parent.config.targetN === null) {
    return fail('NOT_RETRYABLE', 'Nową rundę można rozpocząć tylko po ukończonym teście.');
  }
  const config = parent.config;
  const n = parent.config.targetN;
  const pool = poolQuestions(catalog, state.blocks, config.scope, config.difficulty);
  const blocks = blockIndex(state.blocks);
  const { reported } = reportInfo(state, parent.id);
  const repeated: MandatoryItem[] = [];
  const families = new Set<FamilyId>();
  for (const slotId of parent.plan) {
    const slot = parent.slots[slotId];
    if (!slot || slot.excluded || !slot.attempt || slot.attempt.correct || reported.has(slot.id)) continue;
    const q = catalog.questionsById[slot.questionId];
    if (q) {
      if (isBlockedBy(blocks, q) || families.has(q.familyId)) continue;
      families.add(q.familyId);
      repeated.push({ origin: 'repeated_wrong', questionId: q.id, familyId: q.familyId, domainId: q.domainId, difficulty: q.difficulty, question: q, fallback: null });
    } else {
      const snap = slot.snapshot;
      if (isBlockedBy(blocks, questionOfSlot(slot)) || families.has(snap.familyId)) continue;
      families.add(snap.familyId);
      repeated.push({
        origin: 'repeated_wrong',
        questionId: snap.questionId,
        familyId: snap.familyId,
        domainId: snap.domainId,
        difficulty: snap.difficulty,
        question: null,
        fallback: snap,
      });
    }
  }
  const mandatory = [...repeated];
  if (config.myErrorsPriority) {
    mandatory.push(
      ...myErrorsMandatory(
        pool,
        state.questionStats,
        n - repeated.length,
        families,
        new Set(repeated.map((r) => r.questionId)),
      ),
    );
  }
  return ok({
    parent,
    config,
    n,
    pool,
    capacity: familyCount(pool),
    repeated,
    mandatory,
    seen: buildSeenIndex(state.questionStats),
    rotationOffset: testCount(state) % 6,
  });
}

/**
 * Powiązanie nowej rundy z rodzicem (SPECYFIKACJA §6: „każda runda ma … parent oraz numer w łańcuchu”).
 * Zapisywane ZAWSZE — także przy zerze błędów rodzica (D02): wtedy `repeatedCount = 0`, a oznaczenie
 * „Powtórka”/◆ (zależne od `repeatedCount > 0`) się nie pojawia.
 */
function retryInfoFor(parent: Session, repeatedCount: number): RetryInfo {
  return {
    sourceSessionId: parent.id,
    retryChainId: parent.retry?.retryChainId ?? parent.id,
    roundIndex: (parent.retry?.roundIndex ?? 1) + 1,
    repeatedCount,
  };
}

/**
 * Podgląd rundy (S18): błędne, niezgłoszone i obecnie niezablokowane pozycje BEZPOŚREDNIEGO rodzica
 * + uzupełnienia do N (liczby niewidzianych/widzianych liczone tą samą polityką co start).
 */
export function previewRetryRound(state: UserState, catalog: Catalog, sourceSessionId: SessionId): CommandResult<RetryPreview> {
  const c = retryContext(state, catalog, sourceSessionId);
  if (!c.ok) return c;
  const { parent, config, n } = c.value;
  const plan = planTest({
    pool: c.value.pool,
    scope: config.scope,
    difficulty: config.difficulty,
    n,
    mandatory: c.value.mandatory,
    rotationOffset: c.value.rotationOffset,
    seed: 0,
    seen: c.value.seen,
    fillerOrigin: 'filler',
    capacityAtStart: c.value.capacity,
  });
  const repeatedWrong = c.value.repeated.length;
  return ok({
    sourceSessionId: parent.id,
    targetN: n,
    config: { ...config },
    repeatedWrong,
    fillersUnseen: plan.ok ? plan.allocation.fillersUnseen : 0,
    fillersSeen: plan.ok ? plan.allocation.fillersSeen : 0,
    nextRoundIndex: (parent.retry?.roundIndex ?? 1) + 1,
    isRetry: repeatedWrong > 0,
    insufficient: plan.ok ? null : { capacity: plan.available },
  });
}

/**
 * Start rundy „Uwzględnij błędy” (DECYZJE §6 pkt 1a): ta sama konfiguracja i N, sloty `repeated_wrong`
 * + `filler`. Przy zerze błędów — N uzupełnień, powiązanie z rodzicem zachowane (`retry.repeatedCount = 0`),
 * bez oznaczenia Powtórka.
 */
export function startRetryRound(state: UserState, catalog: Catalog, input: StartRetryInput, ctx: CommandContext): DomainCommandResult<StartSessionValue> {
  if (typeof input.seed !== 'number' || !Number.isFinite(input.seed)) return fail('INVALID_CONFIG', MSG.invalidConfig);
  const c = retryContext(state, catalog, input.sourceSessionId);
  if (!c.ok) return c;
  const { parent, config, n } = c.value;
  const plan = planTest({
    pool: c.value.pool,
    scope: config.scope,
    difficulty: config.difficulty,
    n,
    mandatory: c.value.mandatory,
    rotationOffset: c.value.rotationOffset,
    seed: toUint32(input.seed),
    seen: c.value.seen,
    fillerOrigin: 'filler',
    capacityAtStart: c.value.capacity,
  });
  if (!plan.ok) {
    return fail(
      'INSUFFICIENT_CAPACITY',
      `Za mało różnych zadań (rodzin pytań) w tym zakresie, aby uzupełnić rundę do ${n}. Dostępnych: ${plan.available}. Zmień konfigurację albo zaimportuj pulę.`,
      { capacity: plan.available, targetN: n },
    );
  }
  const tx = new Tx(state, ctx);
  const closedSessionId = closeOpenSessions(tx);
  const session = testSession(tx, catalog, {
    config: copyConfig(config, n),
    seed: input.seed,
    picks: plan.picks,
    allocation: plan.allocation,
    retry: retryInfoFor(parent, c.value.repeated.length),
  });
  tx.putSession(session, false);
  return ok(tx.commit({ sessionId: session.id, closedSessionId }));
}

/* ========================================================================== */
/* Free Flow                                                                  */
/* ========================================================================== */

function ffDomainActual(plan: readonly SlotId[], slots: Readonly<Record<SlotId, Slot>>): Partial<Record<DomainId, number>> {
  const out: Partial<Record<DomainId, number>> = {};
  for (const id of plan) {
    const s = slots[id];
    if (!s || s.excluded) continue;
    out[s.snapshot.domainId] = (out[s.snapshot.domainId] ?? 0) + 1;
  }
  return out;
}

export interface FreeFlowApplyOptions {
  /** Zastąpienie pozycji planu (zgłoszenie bieżącego pytania Free Flow). */
  replaceIndex: number | null;
  replacesSlotId: SlotId | null;
}

/**
 * Nanosi wynik doboru Free Flow na sesję: nowy slot (dopisany albo na miejscu zgłoszonego),
 * licznik doborów, stan `empty`, wagi, jednorazowy komunikat o wyczerpaniu „Moich błędów”.
 */
export function applyFreeFlowPick(
  tx: Tx,
  catalog: Catalog,
  session: Session,
  pick: FreeFlowPickResult,
  options: FreeFlowApplyOptions,
): { session: Session; slotId: SlotId | null; exhaustedNow: boolean } {
  const ctx = tx.ctx;
  const ff = session.freeFlow ?? { myErrorsExhaustedNotified: false, empty: false, picks: 0 };
  let events = session.events;
  let notified = ff.myErrorsExhaustedNotified;
  let exhaustedNow = false;
  if (session.config.myErrorsPriority && !pick.myErrorsRemaining && !notified) {
    const ev: DmeEvent = { id: ctx.newId('event'), at: ctx.now, commandId: ctx.commandId, type: 'my_errors_exhausted', sessionId: session.id };
    tx.addEvent(ev);
    events = [...events, ev];
    notified = true;
    exhaustedNow = true;
  }
  if (!pick.question) {
    return {
      session: {
        ...session,
        events,
        freeFlow: { ...ff, myErrorsExhaustedNotified: notified, empty: true },
        allocation: { ...session.allocation, freeFlowWeights: pick.weights },
      },
      slotId: null,
      exhaustedNow,
    };
  }
  const origin = options.replacesSlotId !== null ? 'replacement' : pick.origin === 'my_errors' ? 'my_errors' : 'freeflow';
  const slot = createSlot(
    catalog,
    {
      origin,
      question: pick.question,
      fallback: null,
      seed: session.seed,
      salt: `ff:${ff.picks}:${pick.question.id}`,
      replacesSlotId: options.replacesSlotId,
    },
    ctx,
  );
  const slots = { ...session.slots, [slot.id]: slot };
  const plan = [...session.plan];
  let reached: number;
  if (options.replaceIndex !== null) {
    plan[options.replaceIndex] = slot.id;
    reached = Math.max(session.reached, options.replaceIndex);
  } else {
    plan.push(slot.id);
    reached = plan.length - 1;
  }
  const allocation: Allocation = {
    ...session.allocation,
    domainActual: ffDomainActual(plan, slots),
    fillersUnseen: session.allocation.fillersUnseen + (pick.familySeen ? 0 : 1),
    fillersSeen: session.allocation.fillersSeen + (pick.familySeen ? 1 : 0),
    freeFlowWeights: pick.weights,
  };
  return {
    session: {
      ...session,
      slots,
      plan,
      reached,
      events,
      allocation,
      freeFlow: { myErrorsExhaustedNotified: notified, empty: false, picks: ff.picks + 1 },
    },
    slotId: slot.id,
    exhaustedNow,
  };
}

/** Dobór Free Flow dla bieżącego stanu sesji (historia = plan bez pozycji `skipIndex`). */
export function pickForSession(
  catalog: Catalog,
  stateView: { stats: Readonly<Record<QuestionId, QuestionStat>>; attempts: readonly Attempt[]; blocks: UserState['blocks'] },
  session: Session,
  now: string,
  skipIndex: number | null,
): FreeFlowPickResult {
  const pool = poolQuestions(catalog, stateView.blocks, session.config.scope, session.config.difficulty);
  const history = session.plan
    .filter((_, i) => i !== skipIndex)
    .map((id) => session.slots[id])
    .filter((s): s is Slot => s !== undefined);
  return pickFreeFlow({
    pool,
    scope: session.config.scope,
    seen: buildSeenIndex(stateView.stats),
    attempts: stateView.attempts,
    history,
    sessionSlots: Object.values(session.slots),
    now,
    seed: session.seed,
    pickIndex: session.freeFlow?.picks ?? 0,
    myErrorsPriority: session.config.myErrorsPriority,
  });
}

/** Start Free Flow (FREE_FLOW_POLICY_V2) z pierwszym slotem; pusta pula → stan `empty`. */
export function startFreeFlow(state: UserState, catalog: Catalog, input: StartFreeFlowInput, ctx: CommandContext): DomainCommandResult<StartFreeFlowValue> {
  const { config } = input;
  if (!isValidConfigShape(config) || typeof input.seed !== 'number' || !Number.isFinite(input.seed)) {
    return fail('INVALID_CONFIG', MSG.invalidConfig);
  }
  const frozen = copyConfig(config, null);
  const seed = toUint32(input.seed);
  const pool = poolQuestions(catalog, state.blocks, frozen.scope, frozen.difficulty);
  const tx = new Tx(state, ctx);
  const closedSessionId = closeOpenSessions(tx);
  const id = ctx.newId('session');
  const started = startedEvent(ctx, id, 'freeflow');
  tx.addEvent(started);
  const base: Session = {
    id,
    kind: 'freeflow',
    status: 'open',
    createdAt: ctx.now,
    updatedAt: ctx.now,
    closedAt: null,
    revision: 1,
    mutationSeq: 0,
    config: frozen,
    bankVersion: catalog.bankVersion,
    seed,
    allocation: {
      policy: 'FREE_FLOW_POLICY_V2',
      rotationOffset: 0,
      capacityAtStart: familyCount(pool),
      domainTargets: {},
      domainActual: {},
      cells: [],
      mandatoryRepeated: 0,
      mandatoryMyErrors: 0,
      fillersUnseen: 0,
      fillersSeen: 0,
      redistributed: [],
      freeFlowWeights: null,
    },
    retry: null,
    plan: [],
    slots: {},
    reached: 0,
    awaitingReplacement: [],
    events: [started],
    result: null,
    freeFlow: { myErrorsExhaustedNotified: false, empty: false, picks: 0 },
  };
  const pick = pickForSession(catalog, { stats: state.questionStats, attempts: Object.values(state.attempts), blocks: state.blocks }, base, ctx.now, null);
  const applied = applyFreeFlowPick(tx, catalog, base, pick, { replaceIndex: null, replacesSlotId: null });
  tx.putSession(applied.session, false);
  tx.putSettings({ ...state.settings, lastFreeFlowConfig: frozen, updatedAt: ctx.now });
  return ok(tx.commit({ sessionId: id, closedSessionId, firstSlotId: applied.slotId }));
}

/** Free Flow „Dalej”: dobiera i dopisuje kolejny slot. Wymaga oceny (albo wykluczenia) bieżącego slotu. */
export function nextFreeFlowSlot(state: UserState, catalog: Catalog, input: SessionCommandInput, ctx: CommandContext): DomainCommandResult<NextFreeFlowValue> {
  const r = requireOpenSession(state, input, 'freeflow');
  if (!r.ok) return r;
  const session = r.value;
  if (session.plan.length > 0) {
    const current = session.slots[session.plan[session.reached] ?? ''];
    if (current && !current.attempt && !current.excluded) return fail('SLOT_NOT_ANSWERED', MSG.slotNotAnswered);
  }
  const pick = pickForSession(catalog, { stats: state.questionStats, attempts: Object.values(state.attempts), blocks: state.blocks }, session, ctx.now, null);
  const willNotify = session.config.myErrorsPriority && !pick.myErrorsRemaining && !(session.freeFlow?.myErrorsExhaustedNotified ?? false);
  if (!pick.question && session.freeFlow?.empty === true && !willNotify) {
    return ok(unchanged(state, ctx, { slotId: null, empty: true, myErrorsExhausted: false }));
  }
  const tx = new Tx(state, ctx);
  const applied = applyFreeFlowPick(tx, catalog, session, pick, { replaceIndex: null, replacesSlotId: null });
  tx.putSession(applied.session, false);
  return ok(tx.commit({ slotId: applied.slotId, empty: applied.slotId === null, myErrorsExhausted: applied.exhaustedNow }));
}

/* ========================================================================== */
/* Przebieg                                                                   */
/* ========================================================================== */

/** Test „Dalej”: przesuwa `reached` (bez zmiany planu, bez mutacji punktowej). */
export function advance(state: UserState, input: SessionCommandInput, ctx: CommandContext): DomainCommandResult<{ reached: number }> {
  const r = requireOpenSession(state, input, 'test');
  if (!r.ok) return r;
  const session = r.value;
  const current = session.slots[session.plan[session.reached] ?? ''];
  if (!current || (!current.attempt && !current.excluded)) return fail('SLOT_NOT_ANSWERED', MSG.slotNotAnswered);
  if (session.reached >= session.plan.length - 1) {
    return fail('SLOT_NOT_IN_PLAN', 'To ostatnia pozycja testu — użyj „Pokaż wynik”.');
  }
  const reached = session.reached + 1;
  const tx = new Tx(state, ctx);
  tx.putSession({ ...session, reached }, false);
  return ok(tx.commit({ reached }));
}

/** Pierwsze faktyczne wyświetlenie slotu (idempotentne; nie unieważnia „Cofnij”). */
export function markShown(state: UserState, input: MarkShownInput, ctx: CommandContext): DomainCommandResult<{ firstTime: boolean }> {
  const session = state.sessions[input.sessionId];
  if (!session) return fail('SESSION_NOT_FOUND', MSG.sessionNotFound);
  const slot = session.slots[input.slotId];
  if (!slot) return fail('SLOT_NOT_FOUND', MSG.slotNotFound);
  if (slot.shownAt !== null || session.status !== 'open') return ok(unchanged(state, ctx, { firstTime: false }));
  // Pozycja planu jeszcze nieosiągnięta nie mogła być wyświetlona — nie zużywa nowości (DECYZJE §6 pkt 6).
  if (session.plan.indexOf(slot.id) > session.reached) return ok(unchanged(state, ctx, { firstTime: false }));
  const tx = new Tx(state, ctx);
  tx.putSession({ ...session, slots: { ...session.slots, [slot.id]: { ...slot, shownAt: ctx.now } } }, false);
  const snap = slot.snapshot;
  tx.putStat(applyShown(state.questionStats[slot.questionId] ?? emptyStat(slot.questionId, snap.familyId, snap.domainId), ctx.now));
  return ok(tx.commit({ firstTime: true }));
}

/**
 * Pierwsza odpowiedź w slocie (DECYZJE §4): ocena po stałym `optionId`, REVIEW_POLICY_V1,
 * dziennik prób. Idempotentna po `ctx.commandId`.
 */
export function answer(state: UserState, input: AnswerInput, ctx: CommandContext): DomainCommandResult<AnswerValue> {
  const logged = state.attempts[ctx.commandId];
  if (logged) {
    if (logged.sessionId === input.sessionId && logged.slotId === input.slotId && logged.optionId === input.optionId) {
      return ok(unchanged(state, ctx, { correct: logged.correct, replayed: true }));
    }
    return fail('STALE_REVISION', 'Ta komenda została już zapisana dla innej odpowiedzi.');
  }
  const session = state.sessions[input.sessionId];
  if (!session) return fail('SESSION_NOT_FOUND', MSG.sessionNotFound);
  const slot = session.slots[input.slotId];
  if (slot?.attempt && slot.attempt.commandId === ctx.commandId) {
    if (slot.attempt.optionId === input.optionId) return ok(unchanged(state, ctx, { correct: slot.attempt.correct, replayed: true }));
    return fail('STALE_REVISION', 'Ta komenda została już zapisana dla innej odpowiedzi.');
  }
  if (session.status !== 'open') return fail('SESSION_NOT_OPEN', MSG.sessionNotOpen);
  if (session.revision !== input.expectedRevision) {
    return fail('STALE_REVISION', MSG.stale, { expectedRevision: input.expectedRevision, revision: session.revision });
  }
  if (!slot) return fail('SLOT_NOT_FOUND', MSG.slotNotFound);
  if (slot.excluded) return fail('SLOT_EXCLUDED', 'To pytanie zostało wykluczone zgłoszeniem.');
  const index = session.plan.indexOf(slot.id);
  if (index < 0) return fail('SLOT_NOT_IN_PLAN', 'To pytanie nie jest już częścią sesji.');
  if (index > session.reached) return fail('SLOT_NOT_IN_PLAN', 'To pytanie nie jest jeszcze dostępne.');
  if (slot.attempt) return fail('SLOT_ALREADY_ANSWERED', 'Na to pytanie udzielono już odpowiedzi.');
  if (!slot.snapshot.options.some((o) => o.id === input.optionId)) return fail('OPTION_NOT_FOUND', 'Nieznana odpowiedź.');

  const correct = input.optionId === slot.snapshot.correctOptionId;
  const tx = new Tx(state, ctx);
  const firstShow = slot.shownAt === null;
  const updatedSlot: Slot = {
    ...slot,
    shownAt: slot.shownAt ?? ctx.now,
    attempt: { commandId: ctx.commandId, optionId: input.optionId, correct, answeredAt: ctx.now },
  };
  tx.putSession({ ...session, slots: { ...session.slots, [slot.id]: updatedSlot } }, true);
  const attempt: Attempt = {
    id: ctx.commandId,
    commandId: ctx.commandId,
    sessionId: session.id,
    sessionKind: session.kind,
    slotId: slot.id,
    questionId: slot.questionId,
    questionRevision: slot.snapshot.revision,
    domainId: slot.snapshot.domainId,
    difficulty: slot.snapshot.difficulty,
    optionId: input.optionId,
    optionOrder: [...slot.optionOrder],
    correct,
    answeredAt: ctx.now,
    excluded: false,
    excludedReason: null,
    excludedAt: null,
    nextDayStart: ctx.nextDayStart,
  };
  tx.putAttempt(attempt);
  let stat = state.questionStats[slot.questionId] ?? emptyStat(slot.questionId, slot.snapshot.familyId, slot.snapshot.domainId);
  if (firstShow) stat = applyShown(stat, ctx.now);
  tx.putStat(applyAnswer(stat, { correct, sessionId: session.id, answeredAt: ctx.now, nextDayStart: ctx.nextDayStart }));
  return ok(tx.commit({ correct, replayed: false }));
}

/** Ponowna próba obsadzenia pozycji `awaitingReplacement` (np. po imporcie puli lub „Przywróć”). */
export function fillAwaitingReplacements(
  state: UserState,
  catalog: Catalog,
  input: SessionCommandInput,
  ctx: CommandContext,
): DomainCommandResult<{ filled: number; stillAwaiting: number }> {
  const r = requireOpenSession(state, input);
  if (!r.ok) return r;
  const session = r.value;
  if (session.awaitingReplacement.length === 0) return ok(unchanged(state, ctx, { filled: 0, stillAwaiting: 0 }));
  const tx = new Tx(state, ctx);
  const pool = poolQuestions(catalog, state.blocks, session.config.scope, session.config.difficulty);
  const seen = buildSeenIndex(state.questionStats);
  const slots: Record<SlotId, Slot> = { ...session.slots };
  const plan = [...session.plan];
  const events = [...session.events];
  const families = new Set(Object.values(slots).map((s) => s.snapshot.familyId));
  const qids = new Set(Object.values(slots).map((s) => s.questionId));
  const still: SlotId[] = [];
  let filled = 0;
  const ordered = [...session.awaitingReplacement].sort((a, b) => plan.indexOf(a) - plan.indexOf(b));
  for (const slotId of ordered) {
    const excluded = slots[slotId];
    const index = plan.indexOf(slotId);
    if (!excluded || index < 0) continue;
    const found = findTestReplacement({
      pool,
      scope: session.config.scope,
      difficulty: session.config.difficulty,
      excludedFamilies: families,
      excludedQuestionIds: qids,
      preferDomain: excluded.snapshot.domainId,
      preferDifficulty: excluded.snapshot.difficulty,
      seen,
      seed: session.seed,
      salt: `replacement:${Object.keys(slots).length}`,
    });
    if (!found) {
      still.push(slotId);
      continue;
    }
    const slot = createSlot(
      catalog,
      { origin: 'replacement', question: found.question, fallback: null, seed: session.seed, salt: `replacement:${Object.keys(slots).length}:${found.question.id}`, replacesSlotId: slotId },
      ctx,
    );
    slots[slot.id] = slot;
    plan[index] = slot.id;
    families.add(found.question.familyId);
    qids.add(found.question.id);
    const ev: DmeEvent = {
      id: ctx.newId('event'),
      at: ctx.now,
      commandId: ctx.commandId,
      type: 'slot_replaced',
      sessionId: session.id,
      excludedSlotId: slotId,
      replacementSlotId: slot.id,
      questionId: found.question.id,
    };
    tx.addEvent(ev);
    events.push(ev);
    filled++;
  }
  if (filled === 0) return ok(unchanged(state, ctx, { filled: 0, stillAwaiting: still.length }));
  tx.putSession({ ...session, slots, plan, events, awaitingReplacement: still }, true);
  return ok(tx.commit({ filled, stillAwaiting: still.length }));
}

/* ========================================================================== */
/* Zakończenie                                                                */
/* ========================================================================== */

/** „Pokaż wynik”: test → `completed` z wynikiem (próg całkowitoliczbowy). */
export function finishTest(state: UserState, input: SessionCommandInput, ctx: CommandContext): DomainCommandResult<{ result: SessionResult }> {
  const r = requireOpenSession(state, input, 'test');
  if (!r.ok) return r;
  const session = r.value;
  const targetN = session.config.targetN ?? 0;
  if (session.awaitingReplacement.length > 0) {
    return fail('AWAITING_REPLACEMENT', 'Brakuje pytania zastępczego. Wynik będzie dostępny po uzupełnieniu wszystkich pozycji.', {
      awaiting: session.awaitingReplacement.length,
    });
  }
  const { answered, correct } = validCounts(session);
  if (targetN < 1 || answered !== targetN || session.plan.length !== targetN) {
    return fail('TEST_NOT_COMPLETE', `Test nie jest jeszcze ukończony: odpowiedziano na ${answered} z ${targetN} pytań.`, {
      answeredValid: answered,
      targetN,
    });
  }
  const result: SessionResult = {
    correct,
    targetN,
    passed: isPassed(correct, targetN),
    percent: truncatedPercent(correct, targetN) ?? 0,
  };
  const ev: DmeEvent = {
    id: ctx.newId('event'),
    at: ctx.now,
    commandId: ctx.commandId,
    type: 'session_completed',
    sessionId: session.id,
    correct,
    targetN,
    passed: result.passed,
  };
  const tx = new Tx(state, ctx);
  tx.addEvent(ev);
  tx.putSession({ ...session, status: 'completed', closedAt: ctx.now, result, events: [...session.events, ev] }, true);
  return ok(tx.commit({ result }));
}

/** „Zamknij test bez wyniku”: → `unfinished`, `passed = null`; brakujące odpowiedzi nie są błędami. */
export function closeUnfinished(state: UserState, input: SessionCommandInput, ctx: CommandContext): DomainCommandResult<{ sessionId: SessionId }> {
  const r = requireOpenSession(state, input, 'test');
  if (!r.ok) return r;
  const session = r.value;
  const ev: DmeEvent = {
    id: ctx.newId('event'),
    at: ctx.now,
    commandId: ctx.commandId,
    type: 'session_unfinished',
    sessionId: session.id,
    answeredValid: validCounts(session).answered,
  };
  const tx = new Tx(state, ctx);
  tx.addEvent(ev);
  tx.putSession({ ...session, status: 'unfinished', closedAt: ctx.now, result: null, events: [...session.events, ev] }, true);
  return ok(tx.commit({ sessionId: session.id }));
}

/** „Zakończ sesję” Free Flow: → `ended`, podsumowanie bez progu. */
export function endFreeFlow(state: UserState, input: SessionCommandInput, ctx: CommandContext): DomainCommandResult<{ summary: SessionSummary }> {
  const r = requireOpenSession(state, input, 'freeflow');
  if (!r.ok) return r;
  const session = r.value;
  const { answered, correct } = validCounts(session);
  const ev: DmeEvent = {
    id: ctx.newId('event'),
    at: ctx.now,
    commandId: ctx.commandId,
    type: 'freeflow_ended',
    sessionId: session.id,
    answeredValid: answered,
    correct,
  };
  const tx = new Tx(state, ctx);
  tx.addEvent(ev);
  const ended: Session = { ...session, status: 'ended', closedAt: ctx.now, result: null, events: [...session.events, ev] };
  tx.putSession(ended, true);
  return ok(tx.commit({ summary: summarizeSession(ended) }));
}
