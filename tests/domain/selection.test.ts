/**
 * TEST_POLICY_V2 (DECYZJE §6; kwoty i redystrybucja jak w V1): równe kwoty domen z rotacją reszty, polityka `mixed`, redystrybucja
 * przy niedoborze (z zapisem), rodziny unikalne, nowość wg faktycznych wyświetleń (kryterium D04).
 */
import { describe, expect, it } from 'vitest';
import {
  advance,
  closeUnfinished,
  domainQuotas,
  emptyUserState,
  markShown,
  startFreeFlow,
  nextFreeFlowSlot,
  startTest,
  type Catalog,
  type DomainId,
  type SessionConfig,
  type UserState,
} from '../../src/domain/api';
import { answerCurrent, catalogOf, cell, Clock, grid, must, mustFail, planFamilies, planQuestionIds, q, session } from './helpers';

function startWith(state: UserState, catalog: Catalog, config: Partial<SessionConfig> & { targetN: number }, seed = 5, clock = new Clock()) {
  const out = must(
    startTest(state, catalog, { config: { scope: 'ALL', difficulty: 'mixed', myErrorsPriority: false, ...config }, seed }, clock.ctx()),
  );
  return { state: out.state, sessionId: out.value.sessionId, clock };
}

function domainCounts(state: UserState, sessionId: string): Partial<Record<DomainId, number>> {
  const s = session(state, sessionId);
  const out: Partial<Record<DomainId, number>> = {};
  for (const id of s.plan) {
    const d = s.slots[id]?.snapshot.domainId;
    if (d) out[d] = (out[d] ?? 0) + 1;
  }
  return out;
}

describe('kwoty domen dla całego zakresu', () => {
  const catalog = catalogOf(grid(5)); // 15 rodzin na domenę

  it('floor(N/6) każdej domenie, reszta rotacyjnie od przesunięcia „testy mod 6”', () => {
    expect(Object.fromEntries(domainQuotas('ALL', 20, 0))).toEqual({ ANAT: 4, INJ: 4, SKIN: 3, THER: 3, DEV: 3, SAFE: 3 });
    expect(Object.fromEntries(domainQuotas('ALL', 20, 1))).toEqual({ INJ: 4, SKIN: 4, THER: 3, DEV: 3, SAFE: 3, ANAT: 3 });
    expect(Object.fromEntries(domainQuotas('ALL', 20, 5))).toEqual({ SAFE: 4, ANAT: 4, INJ: 3, SKIN: 3, THER: 3, DEV: 3 });
    expect(Object.fromEntries(domainQuotas('ALL', 6, 3))).toEqual({ THER: 1, DEV: 1, SAFE: 1, ANAT: 1, INJ: 1, SKIN: 1 });
    expect(Object.fromEntries(domainQuotas('DEV', 20, 3))).toEqual({ DEV: 20 });
  });

  it('kolejne testy przesuwają rotację reszty', () => {
    let state = emptyUserState();
    const clock = new Clock();
    const expected: Partial<Record<DomainId, number>>[] = [
      { ANAT: 4, INJ: 4, SKIN: 3, THER: 3, DEV: 3, SAFE: 3 },
      { ANAT: 3, INJ: 4, SKIN: 4, THER: 3, DEV: 3, SAFE: 3 },
      { ANAT: 3, INJ: 3, SKIN: 4, THER: 4, DEV: 3, SAFE: 3 },
    ];
    for (let i = 0; i < 3; i++) {
      const r = startWith(state, catalog, { targetN: 20 }, 40 + i, clock);
      state = r.state;
      const s = session(state, r.sessionId);
      expect(s.allocation.rotationOffset).toBe(i);
      expect(s.allocation.domainTargets).toEqual(expected[i]);
      expect(s.allocation.domainActual).toEqual(expected[i]);
      expect(domainCounts(state, r.sessionId)).toEqual(expected[i]);
      expect(s.allocation.redistributed).toEqual([]);
      expect(s.allocation.capacityAtStart).toBe(90);
    }
  });

  it('mixed: równy podział poziomów w kwocie domeny, reszta rotacyjnie', () => {
    const { state, sessionId } = startWith(emptyUserState(), catalog, { targetN: 20 });
    const cells = session(state, sessionId).allocation.cells;
    // ANAT (indeks 0, przesunięcie 0): kwota 4 → basic 2, intermediate 1, advanced 1.
    expect(cells.filter((c) => c.domainId === 'ANAT').map((c) => [c.difficulty, c.target, c.actual])).toEqual([
      ['basic', 2, 2],
      ['intermediate', 1, 1],
      ['advanced', 1, 1],
    ]);
    // INJ (indeks 1): kwota 4 → kolejność poziomów od intermediate: intermediate 2, advanced 1, basic 1.
    expect(cells.filter((c) => c.domainId === 'INJ').map((c) => [c.difficulty, c.target])).toEqual([
      ['intermediate', 2],
      ['advanced', 1],
      ['basic', 1],
    ]);
    // SKIN (kwota 3) → po jednym na poziom.
    expect(cells.filter((c) => c.domainId === 'SKIN').every((c) => c.target === 1 && c.actual === 1)).toBe(true);
    const s = session(state, sessionId);
    const levels = s.plan.map((id) => s.slots[id]?.snapshot.difficulty);
    expect(levels.filter((l) => l === 'basic').length + levels.filter((l) => l === 'intermediate').length + levels.filter((l) => l === 'advanced').length).toBe(20);
  });

  it('pojedynczy poziom: tylko ten poziom; konkretna domena: tylko ta domena', () => {
    const a = startWith(emptyUserState(), catalog, { targetN: 18, difficulty: 'advanced' });
    const sa = session(a.state, a.sessionId);
    expect(sa.plan.every((id) => sa.slots[id]?.snapshot.difficulty === 'advanced')).toBe(true);
    const b = startWith(emptyUserState(), catalog, { targetN: 15, scope: 'THER' });
    expect(domainCounts(b.state, b.sessionId)).toEqual({ THER: 15 });
  });
});

describe('redystrybucja przy niedoborze podaży (z zapisem)', () => {
  it('niedobór domeny → miejsca rotacyjnie na domeny z wolną pojemnością', () => {
    const questions = [...grid(3, { domains: ['ANAT', 'INJ', 'SKIN', 'THER', 'SAFE'] }), ...cell('DEV', 'basic', 1)];
    const catalog = catalogOf(questions);
    const { state, sessionId } = startWith(emptyUserState(), catalog, { targetN: 18 });
    const s = session(state, sessionId);
    expect(s.plan).toHaveLength(18);
    expect(new Set(planFamilies(state, sessionId)).size).toBe(18);
    expect(s.allocation.domainTargets.DEV).toBe(3);
    expect(s.allocation.domainActual.DEV).toBe(1);
    const domainMoves = s.allocation.redistributed.filter((r) => r.kind === 'domain');
    expect(domainMoves.every((r) => r.fromDomainId === 'DEV' && r.toDomainId !== 'DEV')).toBe(true);
    expect(domainMoves.reduce((a, r) => a + r.count, 0)).toBe(2);
    // Rotacyjnie: dwa różne odbiorcy.
    expect(new Set(domainMoves.map((r) => r.toDomainId)).size).toBe(2);
    const actualSum = Object.values(s.allocation.domainActual).reduce((a, b) => a + (b ?? 0), 0);
    expect(actualSum).toBe(18);
  });

  it('niedobór poziomu → inne poziomy tej domeny (kind = difficulty)', () => {
    const catalog = catalogOf(cell('ANAT', 'intermediate', 8));
    const { state, sessionId } = startWith(emptyUserState(), catalog, { targetN: 6, scope: 'ANAT' });
    const s = session(state, sessionId);
    expect(s.plan).toHaveLength(6);
    const moves = s.allocation.redistributed;
    expect(moves.every((r) => r.kind === 'difficulty' && r.fromDomainId === 'ANAT' && r.toDifficulty === 'intermediate')).toBe(true);
    expect(moves.reduce((a, r) => a + r.count, 0)).toBe(4);
    expect(s.allocation.cells.find((c) => c.difficulty === 'intermediate')).toMatchObject({ target: 2, actual: 6 });
  });

  it('nie wychodzi poza zakres ani trudność, by osiągnąć N', () => {
    const catalog = catalogOf([...cell('ANAT', 'basic', 3), ...cell('INJ', 'basic', 10)]);
    mustFail(startTest(emptyUserState(), catalog, { config: { scope: 'ANAT', difficulty: 'mixed', targetN: 4, myErrorsPriority: false }, seed: 1 }, new Clock().ctx()), 'N_EXCEEDS_CAPACITY');
    mustFail(startTest(emptyUserState(), catalog, { config: { scope: 'ALL', difficulty: 'advanced', targetN: 1, myErrorsPriority: false }, seed: 1 }, new Clock().ctx()), 'EMPTY_POOL');
  });
});

describe('D04 — najpierw niewidziane, potem dawno widziane; mała i pusta pula', () => {
  const catalog = catalogOf(cell('SKIN', 'basic', 10));
  const config = { scope: 'SKIN' as const, difficulty: 'basic' as const };

  /** Wyświetla (markShown) pierwsze `k` pozycji testu, odpowiada i zamyka jako niedokończony. */
  function see(state: UserState, k: number, clock: Clock, seed: number): { state: UserState; seenIds: string[] } {
    const r = startWith(state, catalog, { ...config, targetN: k }, seed, clock);
    let st = r.state;
    const ids = planQuestionIds(st, r.sessionId);
    for (let i = 0; i < k; i++) {
      st = answerCurrent(st, r.sessionId, clock, true);
      if (i < k - 1) st = must(advance(st, { sessionId: r.sessionId, expectedRevision: session(st, r.sessionId).revision }, clock.ctx())).state;
    }
    st = must(closeUnfinished(st, { sessionId: r.sessionId, expectedRevision: session(st, r.sessionId).revision }, clock.ctx())).state;
    return { state: st, seenIds: ids };
  }

  it('niewidziane mają pierwszeństwo; po ich wyczerpaniu najdawniej widziane', () => {
    const clock = new Clock();
    const first = see(emptyUserState(), 3, clock, 1); // najdawniej widziane
    clock.tick(3600_000);
    const second = see(first.state, 3, clock, 2); // później widziane
    const seenAll = new Set([...first.seenIds, ...second.seenIds]);
    expect(seenAll.size).toBe(6);
    // N=4: dokładnie 4 niewidziane.
    const a = startWith(second.state, catalog, { ...config, targetN: 4 }, 3, clock);
    expect(planQuestionIds(a.state, a.sessionId).every((id) => !seenAll.has(id))).toBe(true);
    expect(session(a.state, a.sessionId).allocation.fillersUnseen).toBe(4);
    // N=7: 4 niewidziane + 3 najdawniej widziane (z pierwszej sesji).
    const b = startWith(second.state, catalog, { ...config, targetN: 7 }, 4, clock);
    const ids = planQuestionIds(b.state, b.sessionId);
    const seenPicked = ids.filter((id) => seenAll.has(id));
    expect(seenPicked.sort()).toEqual([...first.seenIds].sort());
    expect(session(b.state, b.sessionId).allocation).toMatchObject({ fillersUnseen: 4, fillersSeen: 3 });
    expect(new Set(ids).size).toBe(7);
  });

  it('rezerwacja w planie nie zużywa nowości (seen = faktyczne wyświetlenie)', () => {
    const clock = new Clock();
    const r = startWith(emptyUserState(), catalog, { ...config, targetN: 5 }, 9, clock);
    // Pokazano tylko pierwszą pozycję.
    const first = session(r.state, r.sessionId).plan[0] as string;
    let st = must(markShown(r.state, { sessionId: r.sessionId, slotId: first }, clock.ctx())).state;
    st = must(closeUnfinished(st, { sessionId: r.sessionId, expectedRevision: session(st, r.sessionId).revision }, clock.ctx())).state;
    const statsSeen = Object.values(st.questionStats).filter((s) => s.seenCount > 0);
    expect(statsSeen).toHaveLength(1);
    const next = startWith(st, catalog, { ...config, targetN: 9 }, 10, clock);
    expect(session(next.state, next.sessionId).allocation.fillersUnseen).toBe(9);
  });

  it('markShown pozycji jeszcze nieosiągniętej nic nie zmienia (nie mogła być wyświetlona)', () => {
    const clock = new Clock();
    const r = startWith(emptyUserState(), catalog, { ...config, targetN: 3 }, 9, clock);
    const later = session(r.state, r.sessionId).plan[2] as string;
    const out = must(markShown(r.state, { sessionId: r.sessionId, slotId: later }, clock.ctx()));
    expect(out.value).toEqual({ firstTime: false });
    expect(out.state).toBe(r.state);
    expect(out.changeset.stores).toEqual({});
  });

  it('mała pula, jedna rodzina, pusta pula — stan obsłużony bez pętli', () => {
    const one = catalogOf([q({ id: 'V1', family: 'F', domain: 'DEV' }), q({ id: 'V2', family: 'F', domain: 'DEV' })]);
    const clock = new Clock();
    const ok1 = startWith(emptyUserState(), one, { targetN: 1 }, 1, clock);
    expect(session(ok1.state, ok1.sessionId).plan).toHaveLength(1);
    mustFail(startTest(emptyUserState(), one, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 2, myErrorsPriority: false }, seed: 1 }, clock.ctx()), 'N_EXCEEDS_CAPACITY');
    mustFail(startTest(emptyUserState(), catalogOf([]), { config: { scope: 'ALL', difficulty: 'mixed', targetN: 1, myErrorsPriority: false }, seed: 1 }, clock.ctx()), 'EMPTY_POOL');
    // Free Flow na pustej puli: stan empty, kolejne „Dalej” bez zmian (bez pętli).
    const ff = must(startFreeFlow(emptyUserState(), catalogOf([]), { config: { scope: 'ALL', difficulty: 'mixed', targetN: null, myErrorsPriority: false }, seed: 1 }, clock.ctx()));
    expect(ff.value.firstSlotId).toBeNull();
    const s = session(ff.state, ff.value.sessionId);
    expect(s.freeFlow?.empty).toBe(true);
    const again = must(nextFreeFlowSlot(ff.state, catalogOf([]), { sessionId: s.id, expectedRevision: s.revision }, clock.ctx()));
    expect(again.value).toEqual({ slotId: null, empty: true, myErrorsExhausted: false });
    expect(again.state).toBe(ff.state);
  });
});
