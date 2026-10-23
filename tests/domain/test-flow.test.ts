/**
 * Przebieg testu (DECYZJE §4; kryteria C02–C05): zamrożony plan, unikalne rodziny, progres,
 * brak wyniku przed końcem, próg całkowitoliczbowy, unfinished bez `passed`.
 */
import { describe, expect, it } from 'vitest';
import {
  advance,
  chartPoints,
  closeUnfinished,
  emptyUserState,
  finishTest,
  formatPercentPl,
  sessionProgress,
  startTest,
  summarizeSession,
  type RuntimeQuestion,
} from '../../src/domain/api';
import { answerCurrent, catalogOf, Clock, grid, must, mustFail, planFamilies, playTest, q, session, slotAt } from './helpers';

const catalog = catalogOf(grid(4)); // 6 × 3 × 4 = 72 rodziny

function start(n: number, seed = 11) {
  const clock = new Clock();
  const out = must(startTest(emptyUserState(), catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: n, myErrorsPriority: false }, seed }, clock.ctx()));
  return { state: out.state, sessionId: out.value.sessionId, clock, out };
}

describe('C02 — plan i konfiguracja zamrożone przy starcie', () => {
  it('odpowiedzi nie zmieniają planu, kolejności opcji ani konfiguracji', () => {
    const { state, sessionId, clock, out } = start(10);
    const s0 = session(state, sessionId);
    expect(s0.plan).toHaveLength(10);
    expect(s0.config).toEqual({ scope: 'ALL', difficulty: 'mixed', targetN: 10, myErrorsPriority: false });
    expect(s0.bankVersion).toBe('test-bank-1');
    expect(s0.allocation.policy).toBe('TEST_POLICY_V2');
    expect(out.changeset.guards).toEqual([{ sessionId, expectedRevision: null }]);
    const frozen = s0.plan.map((id) => [id, s0.slots[id]?.questionId, s0.slots[id]?.optionOrder.join('')]);
    let st = state;
    for (let i = 0; i < 10; i++) {
      st = answerCurrent(st, sessionId, clock, i % 3 === 0);
      const s = session(st, sessionId);
      expect(s.plan.map((id) => [id, s.slots[id]?.questionId, s.slots[id]?.optionOrder.join('')])).toEqual(frozen);
      expect(s.config).toEqual(s0.config);
      if (i < 9) st = must(advance(st, { sessionId, expectedRevision: s.revision }, clock.ctx())).state;
    }
  });

  it('brak dwóch pytań jednej rodziny, także gdy rodzina ma warianty w różnych poziomach', () => {
    const variants: RuntimeQuestion[] = [];
    for (let f = 0; f < 12; f++) {
      for (const level of ['basic', 'intermediate', 'advanced'] as const) {
        variants.push(q({ id: `F${f}-${level}`, family: `FAM-${f}`, domain: 'SKIN', difficulty: level }));
      }
    }
    const c = catalogOf(variants);
    for (let seed = 0; seed < 20; seed++) {
      const clock = new Clock();
      const out = must(startTest(emptyUserState(), c, { config: { scope: 'SKIN', difficulty: 'mixed', targetN: 12, myErrorsPriority: false }, seed }, clock.ctx()));
      const fams = planFamilies(out.state, out.value.sessionId);
      expect(new Set(fams).size).toBe(12);
    }
    const clock = new Clock();
    mustFail(startTest(emptyUserState(), c, { config: { scope: 'SKIN', difficulty: 'mixed', targetN: 13, myErrorsPriority: false }, seed: 1 }, clock.ctx()), 'N_EXCEEDS_CAPACITY');
  });

  it('ten sam seed i stan → ten sam plan (odtwarzalność)', () => {
    const a = start(20, 99);
    const b = start(20, 99);
    const ids = (x: typeof a) => session(x.state, x.sessionId).plan.map((id) => session(x.state, x.sessionId).slots[id]?.questionId);
    expect(ids(a)).toEqual(ids(b));
    expect(ids(start(20, 100))).not.toEqual(ids(a));
  });
});

describe('C03/C05 — progres, brak wyniku przed końcem, unfinished', () => {
  it('progres = ważne ocenione / N; brak wyniku i procentu przed „Pokaż wynik”', () => {
    const { state, sessionId, clock } = start(5);
    let st = state;
    expect(sessionProgress(session(st, sessionId))).toMatchObject({ answeredValid: 0, targetN: 5, readyToFinish: false });
    for (let i = 0; i < 4; i++) {
      st = answerCurrent(st, sessionId, clock, true);
      st = must(advance(st, { sessionId, expectedRevision: session(st, sessionId).revision }, clock.ctx())).state;
      const p = sessionProgress(session(st, sessionId));
      expect(p.answeredValid).toBe(i + 1);
      expect(session(st, sessionId).result).toBeNull();
      expect(summarizeSession(session(st, sessionId)).passed).toBeNull();
    }
    mustFail(finishTest(st, { sessionId, expectedRevision: session(st, sessionId).revision }, clock.ctx()), 'TEST_NOT_COMPLETE');
    st = answerCurrent(st, sessionId, clock, false);
    expect(sessionProgress(session(st, sessionId)).readyToFinish).toBe(true);
    // „Dalej” na ostatniej pozycji nie istnieje — tylko „Pokaż wynik”.
    mustFail(advance(st, { sessionId, expectedRevision: session(st, sessionId).revision }, clock.ctx()), 'SLOT_NOT_IN_PLAN');
    const done = must(finishTest(st, { sessionId, expectedRevision: session(st, sessionId).revision }, clock.ctx()));
    expect(done.value.result).toEqual({ correct: 4, targetN: 5, passed: true, percent: 80 });
    expect(session(done.state, sessionId).status).toBe('completed');
  });

  it('„Dalej” przed odpowiedzią jest odrzucone', () => {
    const { state, sessionId, clock } = start(3);
    mustFail(advance(state, { sessionId, expectedRevision: session(state, sessionId).revision }, clock.ctx()), 'SLOT_NOT_ANSWERED');
  });

  it('unfinished: bez passed, brak odpowiedzi nie jest błędem, poza wykresem; 0 odpowiedzi → procent null', () => {
    const { state, sessionId, clock } = start(10);
    let st = answerCurrent(state, sessionId, clock, true);
    st = must(advance(st, { sessionId, expectedRevision: session(st, sessionId).revision }, clock.ctx())).state;
    st = answerCurrent(st, sessionId, clock, true);
    const closed = must(closeUnfinished(st, { sessionId, expectedRevision: session(st, sessionId).revision }, clock.ctx()));
    const sum = summarizeSession(session(closed.state, sessionId));
    expect(sum).toMatchObject({ status: 'unfinished', answeredValid: 2, correct: 2, targetN: 10, passed: null, percent: 100 });
    expect(session(closed.state, sessionId).result).toBeNull();
    expect(chartPoints(closed.state, { kind: 'all' })).toEqual([]);
    mustFail(finishTest(closed.state, { sessionId, expectedRevision: session(closed.state, sessionId).revision }, clock.ctx()), 'SESSION_NOT_OPEN');

    const zero = start(4);
    const closedZero = must(closeUnfinished(zero.state, { sessionId: zero.sessionId, expectedRevision: 1 }, zero.clock.ctx()));
    const z = summarizeSession(session(closedZero.state, zero.sessionId));
    expect(z.percent).toBeNull();
    expect(z.passed).toBeNull();
    expect(z.answeredValid).toBe(0);
  });

  it('start nowej sesji zamyka przerwaną (test → unfinished) w tym samym changesecie', () => {
    const { state, sessionId, clock } = start(5);
    const next = must(startTest(state, catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 3, myErrorsPriority: false }, seed: 3 }, clock.ctx()));
    expect(next.value.closedSessionId).toBe(sessionId);
    expect(session(next.state, sessionId).status).toBe('unfinished');
    expect(next.changeset.stores.sessions?.put.map((s) => s.id).sort()).toEqual([sessionId, next.value.sessionId].sort());
    expect(next.changeset.guards).toContainEqual({ sessionId, expectedRevision: 1 });
  });
});

describe('C04 — granice zaliczenia na pełnych sesjach (całkowitoliczbowo)', () => {
  const cases: [number, number, boolean][] = [
    [12, 20, false],
    [13, 20, true],
    [19, 30, false],
    [20, 30, true],
    [25, 40, false],
    [26, 40, true],
    [32, 50, false],
    [33, 50, true],
    [38, 60, false],
    [39, 60, true],
    [1, 1, true],
    [0, 1, false],
    [1, 3, false],
    [2, 3, true],
  ];
  it.each(cases)('%i/%i → zaliczony: %s', (correct, n, passed) => {
    const { state, sessionId, clock } = start(n, correct * 1000 + n);
    const done = playTest(state, sessionId, clock, (i) => i < correct);
    const s = session(done, sessionId);
    expect(s.result?.correct).toBe(correct);
    expect(s.result?.passed).toBe(passed);
    expect(summarizeSession(s).passed).toBe(passed);
    expect(slotAt(done, sessionId, 0).attempt).not.toBeNull();
  });

  it('procent obcięty do 0,1 z przecinkiem (64,96 → „64,9%”) i nie decyduje o wyniku', () => {
    expect(formatPercentPl(1624, 2500)).toBe('64,9%'); // 64,96%
    expect(formatPercentPl(13, 20)).toBe('65%');
    expect(formatPercentPl(2, 3)).toBe('66,6%');
    expect(formatPercentPl(0, 0)).toBeNull();
    const { state, sessionId, clock } = start(3, 5);
    const done = playTest(state, sessionId, clock, (i) => i < 2);
    expect(session(done, sessionId).result).toEqual({ correct: 2, targetN: 3, passed: true, percent: 66.6 });
  });
});
