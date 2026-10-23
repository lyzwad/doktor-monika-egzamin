/**
 * Odpowiadanie (DECYZJE §4; kryteria B02, B03): ocena po stałym `optionId` niezależnie od pokazanej
 * kolejności (wszystkie 24 permutacje), idempotencja i odrzucanie niedozwolonych odpowiedzi.
 */
import { describe, expect, it } from 'vitest';
import {
  answer,
  closeUnfinished,
  emptyUserState,
  finishTest,
  isChangesetEmpty,
  markShown,
  reportQuestion,
  reviewItems,
  sessionProgress,
  startTest,
  type OptionId,
  type UserState,
} from '../../src/domain/api';
import { catalogOf, Clock, grid, must, mustFail, q, session, slotAt, wrongOptionOf } from './helpers';

describe('B02 — 24 permutacje kolejności opcji', () => {
  const question = q({ id: 'PERM-1', correct: 'C', options: ['Alfa', 'Beta', 'Gamma', 'Delta'] });
  const catalog = catalogOf([question]);
  const explanation = question.correct_explanation_pl;

  // Zbierz po jednym starcie testu dla każdej z 24 permutacji (seedy deterministyczne).
  const byPermutation = new Map<string, { state: UserState; sessionId: string; seed: number }>();
  for (let seed = 0; seed < 5000 && byPermutation.size < 24; seed++) {
    const clock = new Clock();
    const out = must(startTest(emptyUserState(), catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 1, myErrorsPriority: false }, seed }, clock.ctx()));
    const sessionId = out.value.sessionId;
    const key = slotAt(out.state, sessionId, 0).optionOrder.join('');
    if (!byPermutation.has(key)) byPermutation.set(key, { state: out.state, sessionId, seed });
  }

  it('tasowanie seedem daje wszystkie 24 permutacje', () => {
    expect(byPermutation.size).toBe(24);
  });

  const cases = [...byPermutation.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  it.each(cases)('kolejność %s: poprawność i wyjaśnienie niezależne od pozycji, historia odtwarza kolejność', (order, { state, sessionId }) => {
    const slot = slotAt(state, sessionId, 0);
    expect(slot.snapshot.options.map((o) => o.id).join('')).toBe(order);
    expect(slot.snapshot.correctOptionId).toBe('C');
    // Pokazana litera poprawnej odpowiedzi = pozycja 'C' w tej kolejności.
    const shownLetter = 'ABCD'[order.indexOf('C')];
    expect(shownLetter).toBeDefined();
    for (const optionId of ['A', 'B', 'C', 'D'] as OptionId[]) {
      const clock = new Clock('2026-10-22T09:00:00.000Z');
      const out = must(answer(state, { sessionId, expectedRevision: session(state, sessionId).revision, slotId: slot.id, optionId }, clock.ctx()));
      expect(out.value.correct).toBe(optionId === 'C');
      const after = slotAt(out.state, sessionId, 0);
      expect(after.snapshot.explanation).toBe(explanation);
      expect(after.optionOrder.join('')).toBe(order);
      expect(after.snapshot.options.map((o) => o.text)).toEqual(order.split('').map((id) => ({ A: 'Alfa', B: 'Beta', C: 'Gamma', D: 'Delta' })[id]));
      const logged = Object.values(out.state.attempts)[0];
      expect(logged?.optionOrder.join('')).toBe(order);
      expect(logged?.optionId).toBe(optionId);
      // Wynik i przegląd po zakończeniu.
      const done = must(finishTest(out.state, { sessionId, expectedRevision: session(out.state, sessionId).revision }, clock.ctx()));
      expect(done.value.result.correct).toBe(optionId === 'C' ? 1 : 0);
      expect(reviewItems(done.state, sessionId, 'all')[0]?.status).toBe(optionId === 'C' ? 'correct' : 'wrong');
      expect(slotAt(done.state, sessionId, 0).optionOrder.join('')).toBe(order);
    }
  });
});

describe('B03 — pierwszy tap ocenia, kolejne nic nie zmieniają', () => {
  const catalog = catalogOf(grid(1));
  function setup(): { state: UserState; sessionId: string; clock: Clock } {
    const clock = new Clock();
    const out = must(startTest(emptyUserState(), catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 3, myErrorsPriority: false }, seed: 7 }, clock.ctx()));
    const sessionId = out.value.sessionId;
    const slot = slotAt(out.state, sessionId, 0);
    const shown = must(markShown(out.state, { sessionId, slotId: slot.id }, clock.ctx()));
    return { state: shown.state, sessionId, clock };
  }

  function snapshotCounters(state: UserState, sessionId: string): unknown {
    return {
      progress: sessionProgress(session(state, sessionId)),
      attempts: Object.keys(state.attempts).length,
      stats: Object.values(state.questionStats).map((s) => [s.questionId, s.answeredCount, s.correctCount, s.wrongCount, s.activeError]),
      slotAttempt: slotAt(state, sessionId, 0).attempt,
    };
  }

  it('pierwszy tap zapisuje próbę; drugi tap innej opcji, dwuklik i powtórzony commandId — bez zmian', () => {
    const { state, sessionId, clock } = setup();
    const slot = slotAt(state, sessionId, 0);
    const wrong = wrongOptionOf(slot);
    const firstCtx = clock.ctx('tap-1');
    const first = must(answer(state, { sessionId, expectedRevision: session(state, sessionId).revision, slotId: slot.id, optionId: wrong }, firstCtx));
    expect(first.value).toEqual({ correct: false, replayed: false });
    expect(first.changeset.guards).toEqual([{ sessionId, expectedRevision: session(state, sessionId).revision }]);
    const s1 = first.state;
    const before = snapshotCounters(s1, sessionId);
    expect(sessionProgress(session(s1, sessionId)).answeredValid).toBe(1);

    // Drugi szybki tap innej opcji (widok jeszcze na starej rewizji) → STALE_REVISION.
    mustFail(answer(s1, { sessionId, expectedRevision: session(state, sessionId).revision, slotId: slot.id, optionId: slot.snapshot.correctOptionId }, clock.ctx('tap-2')), 'STALE_REVISION');
    // Tap innej opcji na nowej rewizji → SLOT_ALREADY_ANSWERED.
    mustFail(answer(s1, { sessionId, expectedRevision: session(s1, sessionId).revision, slotId: slot.id, optionId: slot.snapshot.correctOptionId }, clock.ctx('tap-3')), 'SLOT_ALREADY_ANSWERED');
    // Dwuklik tej samej opcji (nowy commandId) → SLOT_ALREADY_ANSWERED.
    mustFail(answer(s1, { sessionId, expectedRevision: session(s1, sessionId).revision, slotId: slot.id, optionId: wrong }, clock.ctx('tap-4')), 'SLOT_ALREADY_ANSWERED');
    // Ponowienie tej samej komendy (np. po restarcie) → replayed, pusty changeset, ten sam stan.
    const replay = must(answer(s1, { sessionId, expectedRevision: session(state, sessionId).revision, slotId: slot.id, optionId: wrong }, { ...clock.ctx(), commandId: 'tap-1' }));
    expect(replay.value).toEqual({ correct: false, replayed: true });
    expect(isChangesetEmpty(replay.changeset)).toBe(true);
    expect(replay.state).toBe(s1);
    // Restart: stan po JSON round-trip, ta sama komenda → nadal replay.
    const restarted = JSON.parse(JSON.stringify(s1)) as UserState;
    const replay2 = must(answer(restarted, { sessionId, expectedRevision: 1, slotId: slot.id, optionId: wrong }, { ...clock.ctx(), commandId: 'tap-1' }));
    expect(replay2.value.replayed).toBe(true);
    // Ten sam commandId z inną opcją → odrzucone.
    mustFail(answer(s1, { sessionId, expectedRevision: session(s1, sessionId).revision, slotId: slot.id, optionId: slot.snapshot.correctOptionId }, { ...clock.ctx(), commandId: 'tap-1' }), 'STALE_REVISION');
    expect(snapshotCounters(s1, sessionId)).toEqual(before);
    // Wynik i liczniki po wszystkich próbach bez zmian: 1 próba, 1 błąd.
    expect(Object.keys(s1.attempts)).toEqual(['tap-1']);
  });

  it('odrzuca: nieistniejącą opcję, slot wykluczony, nieaktualną rewizję, pozycję nieosiągniętą, zamkniętą sesję', () => {
    const { state, sessionId, clock } = setup();
    const s = session(state, sessionId);
    const slot0 = slotAt(state, sessionId, 0);
    const slot2 = slotAt(state, sessionId, 2);
    mustFail(answer(state, { sessionId, expectedRevision: s.revision, slotId: slot0.id, optionId: 'E' }, clock.ctx()), 'OPTION_NOT_FOUND');
    mustFail(answer(state, { sessionId, expectedRevision: s.revision - 1, slotId: slot0.id, optionId: 'A' }, clock.ctx()), 'STALE_REVISION');
    mustFail(answer(state, { sessionId, expectedRevision: s.revision, slotId: slot2.id, optionId: 'A' }, clock.ctx()), 'SLOT_NOT_IN_PLAN');
    mustFail(answer(state, { sessionId, expectedRevision: s.revision, slotId: 'nie-ma', optionId: 'A' }, clock.ctx()), 'SLOT_NOT_FOUND');
    mustFail(answer(state, { sessionId: 'brak', expectedRevision: 1, slotId: slot0.id, optionId: 'A' }, clock.ctx()), 'SESSION_NOT_FOUND');

    // Slot wykluczony zgłoszeniem.
    const reported = must(reportQuestion(state, catalog, { sessionId, slotId: slot0.id, questionId: slot0.questionId, expectedRevision: s.revision }, clock.ctx()));
    mustFail(
      answer(reported.state, { sessionId, expectedRevision: session(reported.state, sessionId).revision, slotId: slot0.id, optionId: 'A' }, clock.ctx()),
      'SLOT_EXCLUDED',
    );

    // Zamknięta sesja.
    const closed = must(closeUnfinished(state, { sessionId, expectedRevision: s.revision }, clock.ctx()));
    mustFail(answer(closed.state, { sessionId, expectedRevision: session(closed.state, sessionId).revision, slotId: slot0.id, optionId: 'A' }, clock.ctx()), 'SESSION_NOT_OPEN');
    expect(Object.keys(closed.state.attempts)).toHaveLength(0);
  });

  it('wejściowy stan nie jest mutowany', () => {
    const { state, sessionId, clock } = setup();
    const frozen = JSON.stringify(state);
    const slot = slotAt(state, sessionId, 0);
    must(answer(state, { sessionId, expectedRevision: session(state, sessionId).revision, slotId: slot.id, optionId: 'A' }, clock.ctx()));
    expect(JSON.stringify(state)).toBe(frozen);
  });
});
