/**
 * Regresje zgłoszeń weryfikatorów dotyczących polityk doboru:
 * - D04-NIEWIDZIANE-W-KOSZYKU → TEST_POLICY_V2: „najpierw niewidziane” w całym wybranym zakresie
 *   (SPECYFIKACJA §6, kryterium D04), nie tylko w koszyku domena × poziom; to samo dla zastępstwa.
 * - LOG-04 → FREE_FLOW_POLICY_V2: przy luzowaniu wykluczeń w małej puli odstęp błędnych w sesji
 *   (≥ 8 innych pytań) obowiązuje na każdej ścieżce, dopóki istnieje inny kandydat.
 */
import { describe, expect, it } from 'vitest';
import {
  answer,
  emptyUserState,
  markShown,
  nextFreeFlowSlot,
  poolFor,
  reportQuestion,
  startFreeFlow,
  startTest,
  type Catalog,
  type SessionConfig,
  type UserState,
} from '../../src/domain/api';
import { v15Catalog } from '../content';
import { catalogOf, cell, Clock, grid, must, playTest, q, session, slotAt, wrongOptionOf } from './helpers';

/** Liczba pozycji planu z rodzin wyświetlonych przed startem sesji. */
function seenFamilyPositions(before: UserState, after: UserState, sessionId: string): string[] {
  const seenFamilies = new Set(Object.values(before.questionStats).filter((s) => s.seenCount > 0).map((s) => s.familyId));
  const s = session(after, sessionId);
  return s.plan.map((id) => s.slots[id]).filter((slot) => slot && seenFamilies.has(slot.snapshot.familyId)).map((slot) => slot?.questionId ?? '');
}

function start(state: UserState, catalog: Catalog, config: Partial<SessionConfig> & { targetN: number }, seed: number, clock: Clock) {
  const out = must(startTest(state, catalog, { config: { scope: 'ALL', difficulty: 'mixed', myErrorsPriority: false, ...config }, seed }, clock.ctx()));
  return { state: out.state, sessionId: out.value.sessionId };
}

describe('TEST_POLICY_V2 — najpierw niewidziane w całym zakresie (D04)', () => {
  it('rzeczywisty bank: kolejne niezależne testy 20/mixed/ALL nie biorą widzianych rodzin, dopóki niewidzianych jest ≥ N', () => {
    // Bank V15 z profilem: cały zakres = TEST_POLICY_V3 (grupy profilu), reguła „najpierw niewidziane” bez zmian.
    const catalog = v15Catalog();
    const clock = new Clock();
    const n = 20;
    let state = emptyUserState();
    let checked = 0;
    // Bez założeń o liczbie pytań banku: sprawdzamy tyle testów, ile pozwala liczba niewidzianych rodzin (maks. 6).
    for (let round = 0; round < 6; round++) {
      const unseenBefore = poolFor(catalog, state, 'ALL', 'mixed', clock.now).unseenFamilies;
      if (unseenBefore < n) break;
      const r = start(state, catalog, { targetN: n }, 100 + round, clock);
      const s = session(r.state, r.sessionId);
      expect(s.allocation.policy).toBe('TEST_POLICY_V3');
      expect(seenFamilyPositions(state, r.state, r.sessionId), `test ${round + 1}: ${unseenBefore} niewidzianych rodzin przed startem`).toEqual([]);
      expect(s.allocation.fillersSeen).toBe(0);
      expect(s.allocation.fillersUnseen).toBe(n);
      expect(new Set(s.plan.map((id) => s.slots[id]?.snapshot.familyId)).size).toBe(n);
      state = playTest(r.state, r.sessionId, clock, () => true);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  });

  it('koszyk bez niewidzianych → miejsce na innym poziomie tej domeny (redystrybucja „unseen”)', () => {
    // DEV/advanced: 1 rodzina; DEV/basic i DEV/intermediate: po 5 niewidzianych.
    const catalog = catalogOf([...cell('DEV', 'advanced', 1), ...cell('DEV', 'basic', 5), ...cell('DEV', 'intermediate', 5)]);
    const clock = new Clock();
    const first = start(emptyUserState(), catalog, { scope: 'DEV', difficulty: 'advanced', targetN: 1 }, 1, clock);
    const seenState = playTest(first.state, first.sessionId, clock, () => true);
    expect(Object.values(seenState.questionStats).filter((s) => s.seenCount > 0)).toHaveLength(1);

    const r = start(seenState, catalog, { scope: 'DEV', difficulty: 'mixed', targetN: 3 }, 2, clock);
    const s = session(r.state, r.sessionId);
    expect(seenFamilyPositions(seenState, r.state, r.sessionId)).toEqual([]);
    expect(s.allocation).toMatchObject({ fillersUnseen: 3, fillersSeen: 0 });
    expect(s.allocation.cells.find((c) => c.difficulty === 'advanced')).toMatchObject({ target: 1, actual: 0 });
    const moves = s.allocation.redistributed;
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ kind: 'difficulty', fromDomainId: 'DEV', fromDifficulty: 'advanced', toDomainId: 'DEV', reason: 'unseen', count: 1 });
  });

  it('domena bez niewidzianych → miejsce w innej domenie zakresu (redystrybucja „unseen”)', () => {
    // SAFE: 3 rodziny (po jednej na poziom), wszystkie wcześniej wyświetlone; pozostałe domeny niewidziane.
    const catalog = catalogOf(grid(3, { domains: ['ANAT', 'INJ', 'SKIN', 'THER', 'DEV'] }).concat(grid(1, { domains: ['SAFE'] })));
    const clock = new Clock();
    const first = start(emptyUserState(), catalog, { scope: 'SAFE', targetN: 3 }, 1, clock);
    const seenState = playTest(first.state, first.sessionId, clock, () => true);

    const r = start(seenState, catalog, { targetN: 12 }, 3, clock);
    const s = session(r.state, r.sessionId);
    expect(seenFamilyPositions(seenState, r.state, r.sessionId)).toEqual([]);
    expect(s.allocation.domainTargets.SAFE).toBe(2);
    expect(s.allocation.domainActual.SAFE ?? 0).toBe(0);
    const domainMoves = s.allocation.redistributed.filter((m) => m.kind === 'domain');
    expect(domainMoves.every((m) => m.fromDomainId === 'SAFE' && m.toDomainId !== 'SAFE' && m.reason === 'unseen')).toBe(true);
    expect(domainMoves.reduce((a, m) => a + m.count, 0)).toBe(2);
  });

  it('po wyczerpaniu niewidzianych w zakresie: najdawniej widziane, najpierw z własnego koszyka (bilans jak w V1)', () => {
    const catalog = catalogOf(grid(2, { domains: ['ANAT'] })); // 6 rodzin, po dwie w komórce
    const clock = new Clock();
    const first = start(emptyUserState(), catalog, { scope: 'ANAT', targetN: 6 }, 1, clock);
    const seenState = playTest(first.state, first.sessionId, clock, () => true);
    const r = start(seenState, catalog, { scope: 'ANAT', targetN: 6 }, 4, clock);
    const s = session(r.state, r.sessionId);
    expect(s.allocation).toMatchObject({ fillersUnseen: 0, fillersSeen: 6 });
    expect(s.allocation.redistributed).toEqual([]);
    expect(s.allocation.cells.every((c) => c.actual === c.target)).toBe(true);
  });

  it('część niewidzianych: najpierw wszystkie niewidziane z zakresu, resztę uzupełniają widziane', () => {
    const catalog = catalogOf([...cell('SKIN', 'basic', 2), ...cell('SKIN', 'intermediate', 4), ...cell('SKIN', 'advanced', 2)]);
    const clock = new Clock();
    // Wyświetl obie rodziny SKIN/basic i obie SKIN/advanced.
    const a = start(emptyUserState(), catalog, { scope: 'SKIN', difficulty: 'basic', targetN: 2 }, 1, clock);
    let st = playTest(a.state, a.sessionId, clock, () => true);
    const b = start(st, catalog, { scope: 'SKIN', difficulty: 'advanced', targetN: 2 }, 2, clock);
    st = playTest(b.state, b.sessionId, clock, () => true);
    // Test 6 z mixed: 4 niewidziane (wszystkie intermediate) + 2 widziane.
    const r = start(st, catalog, { scope: 'SKIN', targetN: 6 }, 5, clock);
    const s = session(r.state, r.sessionId);
    expect(s.allocation).toMatchObject({ fillersUnseen: 4, fillersSeen: 2 });
    const intermediate = s.plan.filter((id) => s.slots[id]?.snapshot.difficulty === 'intermediate');
    expect(intermediate).toHaveLength(4);
  });

  it('zastępstwo: najpierw niewidziana rodzina z innego poziomu, zanim widziana z tego samego koszyka', () => {
    // INJ/advanced: 3 rodziny (2 wcześniej widziane), INJ/basic: 2 niewidziane.
    const catalog = catalogOf([...cell('INJ', 'advanced', 3), ...cell('INJ', 'basic', 2)]);
    const clock = new Clock();
    const prior = start(emptyUserState(), catalog, { scope: 'INJ', difficulty: 'advanced', targetN: 2 }, 1, clock);
    const st = playTest(prior.state, prior.sessionId, clock, () => true);
    const seenIds = new Set(Object.values(st.questionStats).filter((x) => x.seenCount > 0).map((x) => x.questionId));
    expect(seenIds.size).toBe(2);

    // Test INJ/mixed N=1 → wybierze niewidziane; zgłoszenie szuka zastępstwa.
    const r = start(st, catalog, { scope: 'INJ', targetN: 1 }, 7, clock);
    let state = r.state;
    const slot = slotAt(state, r.sessionId, 0);
    state = must(markShown(state, { sessionId: r.sessionId, slotId: slot.id }, clock.ctx())).state;
    const out = must(
      reportQuestion(state, catalog, { sessionId: r.sessionId, slotId: slot.id, questionId: slot.questionId, expectedRevision: session(state, r.sessionId).revision }, clock.ctx()),
    );
    const rs = session(out.state, r.sessionId);
    const replacement = rs.slots[rs.plan[0] ?? ''];
    expect(replacement?.origin).toBe('replacement');
    expect(seenIds.has(replacement?.questionId ?? '')).toBe(false);
  });
});

describe('FREE_FLOW_POLICY_V2 — odstęp błędnych przy luzowaniu wykluczeń (LOG-04)', () => {
  function runFreeFlow(catalog: Catalog, steps: number, wrongAt: ReadonlySet<number>) {
    const clock = new Clock();
    const started = must(
      startFreeFlow(emptyUserState(), catalog, { config: { scope: 'INJ', difficulty: 'mixed', targetN: null, myErrorsPriority: false }, seed: 3 }, clock.ctx()),
    );
    let st = started.state;
    const sid = started.value.sessionId;
    expect(session(st, sid).allocation.policy).toBe('FREE_FLOW_POLICY_V2');
    const seq: string[] = [];
    for (let step = 0; step < steps; step++) {
      const s = session(st, sid);
      const slot = slotAt(st, sid, s.reached);
      seq.push(slot.questionId);
      st = must(markShown(st, { sessionId: sid, slotId: slot.id }, clock.ctx())).state;
      const optionId = wrongAt.has(step) ? wrongOptionOf(slot) : slot.snapshot.correctOptionId;
      st = must(answer(st, { sessionId: sid, expectedRevision: session(st, sid).revision, slotId: slot.id, optionId }, clock.ctx())).state;
      st = must(nextFreeFlowSlot(st, catalog, { sessionId: sid, expectedRevision: session(st, sid).revision }, clock.ctx())).state;
    }
    return seq;
  }

  it('6 pytań (6 rodzin), pierwsze błędne: wraca dopiero po 8 innych, choć pula wymusza luzowanie okien', () => {
    const catalog = catalogOf(Array.from({ length: 6 }, (_, i) => q({ id: `INJ-${i}`, domain: 'INJ', family: `F${i}` })));
    const seq = runFreeFlow(catalog, 12, new Set([0]));
    const wrong = seq[0] as string;
    const back = seq.indexOf(wrong, 1);
    expect(back, `kolejność: ${seq.join(', ')}`).toBeGreaterThan(0);
    expect(back - 1).toBeGreaterThanOrEqual(8);
    // Poprzednie pytanie nigdy nie wraca bezpośrednio.
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
  });

  it('jedyny kandydat łamiący odstęp — nadal wybierany (bez pustego stanu i bez pętli)', () => {
    const catalog = catalogOf([q({ id: 'INJ-A', domain: 'INJ', family: 'FA' }), q({ id: 'INJ-B', domain: 'INJ', family: 'FB' })]);
    const seq = runFreeFlow(catalog, 5, new Set([0, 1, 2, 3, 4]));
    expect(seq).toHaveLength(5);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    expect(new Set(seq)).toEqual(new Set(['INJ-A', 'INJ-B']));
  });
});
