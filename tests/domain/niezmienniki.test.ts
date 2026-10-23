/**
 * Niezmienniki silnika na losowych (seedowanych) przebiegach komend — test właściwości.
 *
 * Generator wykonuje mieszankę komend (start testu/rundy/Free Flow, wyświetlenie, odpowiedź, „Dalej”,
 * zgłoszenie przed/po odpowiedzi i w zamkniętej sesji, „Cofnij”, „Przywróć”, uzupełnienie zastępstw,
 * zakończenie, zamknięcie, nieaktualne rewizje i powtórzone komendy, skoki zegara o dni) na katalogu
 * z nierówną podażą (niedobory domen i poziomów, rodziny w kilku poziomach i domenach).
 * Po każdej udanej komendzie sprawdza:
 * - changeset zastosowany do poprzedniego stanu = nowy stan; rekordy JSON; strażnicy rewizji,
 * - najwyżej jedna otwarta sesja; test ma zawsze N pozycji i unikalne rodziny we WSZYSTKICH slotach,
 * - wykluczone sloty w planie = oczekujące na zastępstwo; ukończony test ma N ważnych odpowiedzi
 *   i wynik zgodny z progiem całkowitoliczbowym,
 * - dziennik prób ↔ sloty (jedna ważna pierwsza odpowiedź na slot, stan wykluczenia zgodny),
 * - `questionStats` = odtworzenie REVIEW_POLICY_V1 z dziennika ważnych prób,
 * - aktywne blokady nie wracają do puli; Free Flow nie powtarza poprzedniego pytania,
 * - podgląd rundy (S18) zgadza się ze startem rundy,
 * - poprawne N (1…pojemność) zawsze daje start testu (dobór nie zawodzi przy wystarczającej podaży).
 * Na koniec: ten sam seed → identyczny stan końcowy (odtwarzalność).
 */
import { describe, expect, it } from 'vitest';
import {
  activeSession,
  advance,
  answer,
  capacityFor,
  closeUnfinished,
  endFreeFlow,
  fillAwaitingReplacements,
  finishTest,
  isPassed,
  isUndoValid,
  markShown,
  mulberry32,
  nextFreeFlowSlot,
  poolQuestions,
  previewRetryRound,
  reportQuestion,
  restoreBlock,
  startFreeFlow,
  startRetryRound,
  startTest,
  truncatedPercent,
  undoReport,
  emptyUserState,
  type Catalog,
  type Changeset,
  type CommandResult,
  type DifficultyChoice,
  type DomainOutcome,
  type Rng,
  type RuntimeQuestion,
  type Scope,
  type Session,
  type UndoToken,
  type UserState,
} from '../../src/domain/api';
import { recomputeStat } from '../../src/domain/review';
import { validCounts } from '../../src/domain/selectors';
import { catalogOf, cell, Clock, DIFFICULTIES, DOMAIN_IDS, q } from './helpers';

const KEY: Record<string, string> = { sessions: 'id', attempts: 'id', questionStats: 'questionId', blocks: 'id', events: 'id' };

function applyChangeset(state: UserState, cs: Changeset): UserState {
  const next = { ...state } as unknown as Record<string, unknown>;
  for (const [store, change] of Object.entries(cs.stores)) {
    if (!change) continue;
    if (store === 'settings') {
      if (change.put[0]) next.settings = change.put[0];
      continue;
    }
    const key = KEY[store] as string;
    const records = { ...(next[store] as Record<string, unknown>) };
    for (const rec of change.put as unknown as Record<string, string>[]) records[rec[key] as string] = rec;
    for (const k of change.delete) delete records[k];
    next[store] = records;
  }
  return next as unknown as UserState;
}

/** Katalog z nierówną podażą: niedobory domen/poziomów, rodziny wielopoziomowe i międzydomenowe. */
function unevenCatalog(): Catalog {
  const questions: RuntimeQuestion[] = [
    ...cell('ANAT', 'basic', 3),
    ...cell('ANAT', 'intermediate', 3),
    ...cell('ANAT', 'advanced', 1),
    ...cell('INJ', 'intermediate', 5),
    ...cell('SKIN', 'basic', 2),
    ...cell('SKIN', 'advanced', 2),
    ...cell('THER', 'intermediate', 1),
    ...cell('DEV', 'basic', 4),
    ...cell('DEV', 'intermediate', 6),
    ...cell('DEV', 'advanced', 3),
    // SAFE: brak podaży.
    // Rodzina w dwóch poziomach jednej domeny.
    q({ id: 'SKIN-FAM-a', domain: 'SKIN', difficulty: 'basic', family: 'SKIN-FAM' }),
    q({ id: 'SKIN-FAM-b', domain: 'SKIN', difficulty: 'advanced', family: 'SKIN-FAM' }),
    q({ id: 'SKIN-FAM-c', domain: 'SKIN', difficulty: 'intermediate', family: 'SKIN-FAM' }),
    // Rodzina międzydomenowa.
    q({ id: 'X-FAM-anat', domain: 'ANAT', difficulty: 'intermediate', family: 'X-FAM' }),
    q({ id: 'X-FAM-ther', domain: 'THER', difficulty: 'basic', family: 'X-FAM' }),
    // Dwa warianty w tej samej komórce.
    q({ id: 'DEV-PAIR-1', domain: 'DEV', difficulty: 'basic', family: 'DEV-PAIR' }),
    q({ id: 'DEV-PAIR-2', domain: 'DEV', difficulty: 'basic', family: 'DEV-PAIR' }),
  ];
  return catalogOf(questions);
}

const SCOPES: Scope[] = ['ALL', ...DOMAIN_IDS];
const CHOICES: DifficultyChoice[] = ['mixed', ...DIFFICULTIES];

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}

interface RunStats {
  ok: number;
  failed: Record<string, number>;
  completed: number;
  retries: number;
  reports: number;
  undos: number;
  awaiting: number;
  freeFlowSlots: number;
}

function checkInvariants(prev: UserState, out: DomainOutcome<unknown>, catalog: Catalog): void {
  const state = out.state;
  // Changeset = pełny opis zmiany; rekordy JSON; strażnicy rewizji.
  expect(applyChangeset(prev, out.changeset)).toStrictEqual(state);
  expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
  const written = out.changeset.stores.sessions?.put ?? [];
  expect(out.changeset.guards.map((g) => g.sessionId).sort()).toEqual(written.map((s) => s.id).sort());
  for (const g of out.changeset.guards) expect(g.expectedRevision).toBe(prev.sessions[g.sessionId]?.revision ?? null);
  for (const s of written) {
    const before = prev.sessions[s.id];
    expect(s.revision).toBe(before ? before.revision + 1 : 1);
    expect(s.mutationSeq).toBeGreaterThanOrEqual(before?.mutationSeq ?? 0);
  }

  const sessions = Object.values(state.sessions);
  expect(sessions.filter((s) => s.status === 'open').length).toBeLessThanOrEqual(1);

  for (const s of sessions) checkSession(state, s);

  // Dziennik prób ↔ sloty.
  for (const a of Object.values(state.attempts)) {
    const slot = state.sessions[a.sessionId]?.slots[a.slotId];
    expect(slot, `próba ${a.id} bez slotu`).toBeDefined();
    expect(slot?.attempt?.commandId).toBe(a.id);
    expect(a.excluded).toBe(slot?.excluded !== null);
  }

  // Statystyki = odtworzenie z dziennika ważnych prób; wyświetlenia ≥ wyświetlone sloty.
  const attempts = Object.values(state.attempts);
  const shownSlots = new Map<string, number>();
  for (const s of sessions) {
    for (const slot of Object.values(s.slots)) {
      if (slot.shownAt !== null) shownSlots.set(slot.questionId, (shownSlots.get(slot.questionId) ?? 0) + 1);
    }
  }
  for (const stat of Object.values(state.questionStats)) {
    expect(recomputeStat(stat, attempts.filter((a) => a.questionId === stat.questionId))).toEqual(stat);
    expect(stat.seenCount).toBeGreaterThanOrEqual(shownSlots.get(stat.questionId) ?? 0);
  }
  for (const [qid, count] of shownSlots) expect(state.questionStats[qid]?.seenCount ?? 0).toBeGreaterThanOrEqual(count);

  // Aktywne blokady nie wracają do puli (żaden zakres i poziom).
  const active = Object.values(state.blocks).filter((b) => b.revokedAt === null);
  if (active.length > 0) {
    const pool = poolQuestions(catalog, state.blocks, 'ALL', 'mixed');
    for (const b of active) {
      for (const pq of pool) {
        expect(pq.id === b.questionId || pq.fingerprint === b.fingerprint || pq.familyId === b.familyId).toBe(false);
      }
    }
  }
}

function checkSession(state: UserState, s: Session): void {
  expect(new Set(s.plan).size).toBe(s.plan.length);
  for (const id of s.plan) expect(s.slots[id]).toBeDefined();
  for (const slot of Object.values(s.slots)) {
    expect(slot.snapshot.options.map((o) => o.id)).toEqual(slot.optionOrder);
    expect(new Set(slot.optionOrder).size).toBe(4);
    if (slot.attempt) {
      expect(state.attempts[slot.attempt.commandId]).toMatchObject({ optionId: slot.attempt.optionId, correct: slot.attempt.correct });
      expect(slot.attempt.correct).toBe(slot.attempt.optionId === slot.snapshot.correctOptionId);
      expect(slot.shownAt).not.toBeNull();
    }
  }
  const { answered, correct } = validCounts(s);
  if (s.kind === 'test') {
    const n = s.config.targetN ?? -1;
    expect(s.plan).toHaveLength(n);
    // Unikalne rodziny we wszystkich slotach (także wykluczonych i zastępstwach).
    const all = Object.values(s.slots);
    expect(new Set(all.map((x) => x.snapshot.familyId)).size).toBe(all.length);
    expect(new Set(all.map((x) => x.questionId)).size).toBe(all.length);
    expect(s.reached).toBeGreaterThanOrEqual(0);
    expect(s.reached).toBeLessThanOrEqual(n - 1);
    const excludedInPlan = s.plan.filter((id) => s.slots[id]?.excluded !== null);
    expect([...s.awaitingReplacement].sort()).toEqual(excludedInPlan.sort());
    s.plan.forEach((id, i) => {
      if (s.slots[id]?.attempt) expect(i).toBeLessThanOrEqual(s.reached);
    });
    if (s.status === 'completed') {
      expect(answered).toBe(n);
      expect(s.awaitingReplacement).toEqual([]);
      expect(s.result).toEqual({ correct, targetN: n, passed: isPassed(correct, n), percent: truncatedPercent(correct, n) });
    } else {
      expect(s.result).toBeNull();
    }
    expect(s.freeFlow).toBeNull();
  } else {
    expect(s.config.targetN).toBeNull();
    expect(s.result).toBeNull();
    expect(s.awaitingReplacement).toEqual([]);
    if (s.plan.length > 0) expect(s.reached).toBe(s.plan.length - 1);
    // Nie wraca natychmiast do tego samego pytania.
    for (let i = 1; i < s.plan.length; i++) {
      expect(s.slots[s.plan[i] as string]?.questionId).not.toBe(s.slots[s.plan[i - 1] as string]?.questionId);
    }
  }
}

function run(seed: number, steps: number, catalog: Catalog): { state: UserState; stats: RunStats } {
  const rng = mulberry32(seed);
  const clock = new Clock('2026-10-22T06:00:00.000Z');
  let state = emptyUserState();
  let undo: UndoToken | null = null;
  const stats: RunStats = { ok: 0, failed: {}, completed: 0, retries: 0, reports: 0, undos: 0, awaiting: 0, freeFlowSlots: 0 };

  const apply = <V>(r: CommandResult<DomainOutcome<V>>, allowed: readonly string[]): DomainOutcome<V> | null => {
    if (!r.ok) {
      expect(allowed, `nieoczekiwany błąd ${r.error.code}: ${r.error.messagePl}`).toContain(r.error.code);
      stats.failed[r.error.code] = (stats.failed[r.error.code] ?? 0) + 1;
      return null;
    }
    checkInvariants(state, r.value as DomainOutcome<unknown>, catalog);
    state = r.value.state;
    stats.ok++;
    return r.value;
  };

  const startAnyTest = (): void => {
    const config = { scope: pick(rng, SCOPES), difficulty: pick(rng, CHOICES), targetN: 0, myErrorsPriority: rng() < 0.4 };
    const capacity = capacityFor(catalog, state, config.scope, config.difficulty);
    const roll = rng();
    config.targetN = roll < 0.1 ? capacity + 1 + Math.floor(rng() * 3) : roll < 0.15 ? 0 : 1 + Math.floor(rng() * Math.max(1, Math.min(capacity, 12)));
    const valid = capacity > 0 && config.targetN >= 1 && config.targetN <= capacity;
    const out = apply(startTest(state, catalog, { config, seed: Math.floor(rng() * 2 ** 32) }, clock.ctx()), valid ? [] : ['INVALID_N', 'N_EXCEEDS_CAPACITY', 'EMPTY_POOL']);
    if (valid) expect(out).not.toBeNull();
    if (out) undo = null;
  };

  const startRound = (): void => {
    const completed = Object.values(state.sessions).filter((s) => s.kind === 'test' && s.status === 'completed');
    if (completed.length === 0) return startAnyTest();
    const parent = pick(rng, completed.sort((a, b) => (a.id < b.id ? -1 : 1)));
    const preview = previewRetryRound(state, catalog, parent.id);
    expect(preview.ok).toBe(true);
    const out = apply(startRetryRound(state, catalog, { sourceSessionId: parent.id, seed: Math.floor(rng() * 2 ** 32) }, clock.ctx()), ['INSUFFICIENT_CAPACITY']);
    if (preview.ok) {
      expect(preview.value.insufficient === null).toBe(out !== null);
      if (out) {
        const s = state.sessions[out.value.sessionId] as Session;
        expect(s.allocation.mandatoryRepeated).toBe(preview.value.repeatedWrong);
        expect(s.retry?.repeatedCount ?? 0).toBe(preview.value.repeatedWrong);
        // D02: powiązanie z rodzicem zawsze; „Powtórka” = repeatedCount > 0.
        expect(s.retry).not.toBeNull();
        expect(s.retry?.sourceSessionId).toBe(parent.id);
        expect((s.retry?.repeatedCount ?? 0) > 0).toBe(preview.value.isRetry);
        expect(s.allocation.fillersUnseen).toBe(preview.value.fillersUnseen);
        expect(s.allocation.fillersSeen).toBe(preview.value.fillersSeen);
        expect(s.config).toEqual(parent.config);
        stats.retries++;
        undo = null;
      }
    }
  };

  const startFF = (): void => {
    const config = { scope: pick(rng, SCOPES), difficulty: pick(rng, CHOICES), targetN: null, myErrorsPriority: rng() < 0.5 };
    const out = apply(startFreeFlow(state, catalog, { config, seed: Math.floor(rng() * 2 ** 32) }, clock.ctx()), []);
    if (out) undo = null;
  };

  const reportClosed = (): void => {
    const closed = Object.values(state.sessions)
      .filter((s) => s.status !== 'open' && s.plan.length > 0)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (closed.length === 0) return;
    const s = pick(rng, closed);
    const slot = s.slots[pick(rng, s.plan)];
    if (!slot) return;
    const out = apply(
      reportQuestion(state, catalog, { sessionId: s.id, slotId: slot.id, questionId: slot.questionId, expectedRevision: null }, clock.ctx()),
      ['ALREADY_REPORTED'],
    );
    if (out) {
      expect(out.changeset.stores.sessions).toBeUndefined();
      stats.reports++;
    }
  };

  const restoreSome = (): void => {
    const active = Object.values(state.blocks)
      .filter((b) => b.revokedAt === null)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (active.length === 0) return;
    apply(restoreBlock(state, { blockId: pick(rng, active).id }, clock.ctx()), []);
  };

  for (let step = 0; step < steps; step++) {
    if (rng() < 0.03) clock.tick(Math.floor(rng() * 3 * 86_400_000));
    const open = activeSession(state);
    const r = rng();
    if (!open) {
      if (r < 0.5) startAnyTest();
      else if (r < 0.7) startRound();
      else if (r < 0.9) startFF();
      else if (r < 0.96) reportClosed();
      else restoreSome();
      continue;
    }
    const sid = open.id;
    const input = { sessionId: sid, expectedRevision: open.revision };
    const current = open.slots[open.plan[open.reached] ?? ''];
    if (r < 0.06) {
      // Wyświetlenie bieżącej pozycji (w tle, nie unieważnia „Cofnij”).
      if (current) {
        const out = apply(markShown(state, { sessionId: sid, slotId: current.id }, clock.ctx()), []);
        if (out && undo) expect(isUndoValid(out.state, undo)).toBe(true);
      }
    } else if (r < 0.42) {
      // Odpowiedź na bieżącą albo losową osiągniętą pozycję.
      const index = rng() < 0.8 ? open.reached : Math.floor(rng() * (open.reached + 1));
      const slot = open.slots[open.plan[index] ?? ''];
      if (!slot) continue;
      const optionId = pick(rng, slot.optionOrder);
      const ctx = clock.ctx();
      const out = apply(answer(state, { ...input, slotId: slot.id, optionId }, ctx), ['SLOT_ALREADY_ANSWERED', 'SLOT_EXCLUDED']);
      if (out) {
        undo = null;
        // Powtórzenie tej samej komendy (restart) i drugi tap innej opcji: bez zmian.
        const replay = answer(out.state, { ...input, slotId: slot.id, optionId }, { ...clock.ctx(), commandId: ctx.commandId });
        expect(replay.ok && replay.value.value.replayed && replay.value.state === out.state).toBe(true);
        const other = slot.optionOrder.find((o) => o !== optionId) as string;
        const second = answer(out.state, { sessionId: sid, expectedRevision: (out.state.sessions[sid] as Session).revision, slotId: slot.id, optionId: other }, clock.ctx());
        expect(!second.ok && second.error.code).toBe('SLOT_ALREADY_ANSWERED');
        const stale = answer(out.state, { ...input, slotId: slot.id, optionId: other }, clock.ctx());
        expect(!stale.ok && stale.error.code).toBe('STALE_REVISION');
      }
    } else if (r < 0.62) {
      if (open.kind === 'test') {
        apply(advance(state, input, clock.ctx()), ['SLOT_NOT_ANSWERED', 'SLOT_NOT_IN_PLAN']);
      } else {
        const out = apply(nextFreeFlowSlot(state, catalog, input, clock.ctx()), ['SLOT_NOT_ANSWERED']);
        if (out?.value.slotId) stats.freeFlowSlots++;
      }
    } else if (r < 0.72) {
      // Zgłoszenie osiągniętej pozycji (przed albo po odpowiedzi).
      const index = Math.floor(rng() * (open.reached + 1));
      const slot = open.slots[open.plan[index] ?? ''];
      if (!slot) continue;
      const out = apply(reportQuestion(state, catalog, { ...input, slotId: slot.id, questionId: slot.questionId }, clock.ctx()), ['ALREADY_REPORTED']);
      if (out) {
        stats.reports++;
        if (out.value.awaitingReplacement) stats.awaiting++;
        expect(out.value.undo).not.toBeNull();
        undo = out.value.undo;
        // Zgłoszenie na nieaktualnej rewizji jest odrzucane.
        const stale = reportQuestion(out.state, catalog, { ...input, slotId: slot.id, questionId: slot.questionId }, clock.ctx());
        expect(stale.ok).toBe(false);
      }
    } else if (r < 0.78) {
      if (!undo) continue;
      const valid = isUndoValid(state, undo);
      const before = undo;
      const out = apply(undoReport(state, before, clock.ctx()), valid ? [] : ['UNDO_EXPIRED']);
      if (out) {
        stats.undos++;
        expect(out.state.blocks[before.blockId]).toBeUndefined();
        const s = out.state.sessions[before.sessionId] as Session;
        expect(validCounts(s)).toEqual(validCounts(before.checkpoint.session));
        expect(s.awaitingReplacement).toEqual(before.checkpoint.session.awaitingReplacement);
      }
      undo = null;
    } else if (r < 0.88) {
      if (open.kind === 'test') {
        const out = apply(finishTest(state, input, clock.ctx()), ['TEST_NOT_COMPLETE', 'AWAITING_REPLACEMENT']);
        if (out) {
          stats.completed++;
          if (undo) expect(isUndoValid(out.state, undo)).toBe(false);
          undo = null;
        }
      } else if (rng() < 0.3) {
        apply(endFreeFlow(state, input, clock.ctx()), []);
        undo = null;
      }
    } else if (r < 0.9) {
      apply(fillAwaitingReplacements(state, catalog, input, clock.ctx()), []);
    } else if (r < 0.92) {
      if (open.kind === 'test') apply(closeUnfinished(state, input, clock.ctx()), []);
      else apply(endFreeFlow(state, input, clock.ctx()), []);
      undo = null;
    } else if (r < 0.95) {
      // Nowa sesja zamyka otwartą w tym samym changesecie.
      if (rng() < 0.5) startAnyTest();
      else startFF();
    } else if (r < 0.98) {
      reportClosed();
    } else {
      restoreSome();
    }
  }
  return { state, stats };
}

describe('niezmienniki silnika na losowych przebiegach (seed)', () => {
  const catalog = unevenCatalog();
  const total = { completed: 0, retries: 0, reports: 0, undos: 0, awaiting: 0, freeFlowSlots: 0 };

  it.each([1, 2, 3, 4, 5, 6])('przebieg %i: niezmienniki po każdej komendzie i odtwarzalność', (seed) => {
    const first = run(seed, 300, catalog);
    // Przebieg faktycznie wykonuje komendy (nie tylko odrzucenia).
    expect(first.stats.ok).toBeGreaterThan(100);
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += first.stats[k];
    const again = run(seed, 300, catalog);
    expect(JSON.stringify(again.state)).toBe(JSON.stringify(first.state));
  }, 60_000);

  it('pokrycie ścieżek w sumie przebiegów (ukończenia, rundy, zgłoszenia, cofnięcia, oczekiwanie)', () => {
    expect(total.completed).toBeGreaterThan(0);
    expect(total.retries).toBeGreaterThan(0);
    expect(total.reports).toBeGreaterThan(0);
    expect(total.undos).toBeGreaterThan(0);
    expect(total.awaiting).toBeGreaterThan(0);
    expect(total.freeFlowSlots).toBeGreaterThan(0);
  });
});
