/**
 * „Moje błędy” jako priorytet doboru, nie filtr pojemności (SPECYFIKACJA §7; kryteria D06, D07).
 */
import { describe, expect, it } from 'vitest';
import {
  answer,
  emptyUserState,
  markShown,
  nextFreeFlowSlot,
  poolFor,
  startFreeFlow,
  startTest,
  type Catalog,
  type UserState,
} from '../../src/domain/api';
import { catalogOf, Clock, grid, must, mustFail, playTest, session, slotAt, wrongOptionOf } from './helpers';

/** 30 rodzin: 6 domen × 5 pytań poziomu intermediate. */
const catalog30 = catalogOf(grid(5, { levels: ['intermediate'] }));

/** Test N=20 z `wrong` błędami → stan z `wrong` aktywnymi błędami. */
function withErrors(catalog: Catalog, wrong: number, clock: Clock, n = 20): { state: UserState; errorIds: string[] } {
  const out = must(startTest(emptyUserState(), catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: n, myErrorsPriority: false }, seed: 31 }, clock.ctx()));
  const state = playTest(out.state, out.value.sessionId, clock, (i) => i >= wrong);
  const errorIds = Object.values(state.questionStats)
    .filter((s) => s.activeError)
    .map((s) => s.questionId);
  return { state, errorIds };
}

describe('D07 — Test z „Moje błędy” w puli o pojemności 30', () => {
  it('7 aktywnych błędów, N=20 → start dozwolony: 7 błędów + 13 uzupełniających, bez powtórzeń', () => {
    const clock = new Clock();
    const { state, errorIds } = withErrors(catalog30, 7, clock);
    expect(errorIds).toHaveLength(7);
    expect(poolFor(catalog30, state, 'ALL', 'mixed', clock.now)).toMatchObject({ capacity: 30, activeErrors: 7 });
    const out = must(startTest(state, catalog30, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 20, myErrorsPriority: true }, seed: 32 }, clock.ctx()));
    const s = session(out.state, out.value.sessionId);
    const slots = s.plan.map((id) => s.slots[id]!);
    expect(slots).toHaveLength(20);
    expect(slots.filter((sl) => sl.origin === 'my_errors').map((sl) => sl.questionId).sort()).toEqual([...errorIds].sort());
    expect(slots.filter((sl) => sl.origin === 'planned')).toHaveLength(13);
    expect(new Set(slots.map((sl) => sl.snapshot.familyId)).size).toBe(20);
    expect(s.allocation).toMatchObject({ mandatoryMyErrors: 7, capacityAtStart: 30 });
    expect(s.config.myErrorsPriority).toBe(true);
  });

  it('0 błędów → 20 uzupełniających', () => {
    const clock = new Clock();
    const { state } = withErrors(catalog30, 0, clock);
    const out = must(startTest(state, catalog30, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 20, myErrorsPriority: true }, seed: 33 }, clock.ctx()));
    const s = session(out.state, out.value.sessionId);
    expect(s.plan.every((id) => s.slots[id]?.origin === 'planned')).toBe(true);
    expect(s.allocation.mandatoryMyErrors).toBe(0);
  });

  it('pojemność 19 przy N=20 → odmowa niezależnie od liczby błędów', () => {
    const catalog19 = catalogOf(grid(3, { levels: ['basic'] }).concat(grid(1, { levels: ['advanced'], domains: ['ANAT'] }))); // 18 + 1
    const clock = new Clock();
    const { state, errorIds } = withErrors(catalog19, 7, clock, 19);
    expect(errorIds).toHaveLength(7);
    const r = startTest(state, catalog19, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 20, myErrorsPriority: true }, seed: 1 }, clock.ctx());
    mustFail(r, 'N_EXCEEDS_CAPACITY');
    if (!r.ok) expect(r.error.details?.capacity).toBe(19);
  });

  it('więcej błędów niż N → N najbardziej należnych; zakres i blokady respektowane', () => {
    const clock = new Clock();
    const { state, errorIds } = withErrors(catalog30, 7, clock);
    const out = must(startTest(state, catalog30, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 5, myErrorsPriority: true }, seed: 34 }, clock.ctx()));
    const s = session(out.state, out.value.sessionId);
    const chosen = s.plan.map((id) => s.slots[id]!);
    expect(chosen.every((sl) => sl.origin === 'my_errors')).toBe(true);
    // Najbardziej należne = najwcześniejsze dueAt (pierwsze błędne odpowiedzi testu).
    const byDue = [...errorIds].sort((a, b) => (state.questionStats[a]!.dueAt! < state.questionStats[b]!.dueAt! ? -1 : 1));
    expect(chosen.map((sl) => sl.questionId).sort()).toEqual(byDue.slice(0, 5).sort());
    // Zakres jednej domeny: tylko błędy tej domeny.
    const domain = state.questionStats[errorIds[0]!]!.domainId;
    const inDomain = errorIds.filter((id) => state.questionStats[id]!.domainId === domain);
    const scoped = must(startTest(state, catalog30, { config: { scope: domain, difficulty: 'mixed', targetN: 5, myErrorsPriority: true }, seed: 35 }, clock.ctx()));
    const ss = session(scoped.state, scoped.value.sessionId);
    expect(ss.plan.every((id) => ss.slots[id]?.snapshot.domainId === domain)).toBe(true);
    expect(ss.plan.filter((id) => ss.slots[id]?.origin === 'my_errors')).toHaveLength(inDomain.length);
  });
});

describe('D06 — Free Flow z „Moje błędy”', () => {
  it('najpierw aktywne błędy; po wyczerpaniu jednorazowy komunikat i zwykły zakres; poprawne powtórzenie nie wraca od razu', () => {
    const clock = new Clock();
    const { state, errorIds } = withErrors(catalog30, 3, clock);
    clock.tick(3600_000);
    const ff = must(startFreeFlow(state, catalog30, { config: { scope: 'ALL', difficulty: 'mixed', targetN: null, myErrorsPriority: true }, seed: 41 }, clock.ctx()));
    let st = ff.state;
    const sid = ff.value.sessionId;
    const seenOrigins: string[] = [];
    const notices: boolean[] = [];
    const shownIds: string[] = [];
    for (let i = 0; i < 12; i++) {
      const s = session(st, sid);
      const slot = slotAt(st, sid, s.reached);
      seenOrigins.push(slot.origin);
      shownIds.push(slot.questionId);
      st = must(markShown(st, { sessionId: sid, slotId: slot.id }, clock.ctx())).state;
      st = must(answer(st, { sessionId: sid, expectedRevision: session(st, sid).revision, slotId: slot.id, optionId: slot.snapshot.correctOptionId }, clock.ctx())).state;
      const next = must(nextFreeFlowSlot(st, catalog30, { sessionId: sid, expectedRevision: session(st, sid).revision }, clock.ctx()));
      notices.push(next.value.myErrorsExhausted);
      st = next.state;
    }
    expect(seenOrigins.slice(0, 3)).toEqual(['my_errors', 'my_errors', 'my_errors']);
    expect(shownIds.slice(0, 3).sort()).toEqual([...errorIds].sort());
    expect(seenOrigins.slice(3).every((o) => o === 'freeflow')).toBe(true);
    // Komunikat dokładnie raz — przy pierwszym doborze po wyczerpaniu błędów.
    expect(notices.filter(Boolean)).toHaveLength(1);
    expect(notices[2]).toBe(true);
    expect(Object.values(st.events).filter((e) => e.type === 'my_errors_exhausted')).toHaveLength(1);
    // Poprawnie powtórzone błędy nie wracają w tej sesji.
    for (const id of errorIds) expect(shownIds.filter((x) => x === id)).toHaveLength(1);
    // Seria utrwalenia: po poprawnej w innej sesji termin następnego dnia, błąd nadal aktywny.
    for (const id of errorIds) expect(st.questionStats[id]).toMatchObject({ activeError: true, streak: 1 });
  });

  it('błąd w tej sesji wraca dopiero po odstępie (≥ 8 innych pytań)', () => {
    const clock = new Clock();
    const ff = must(startFreeFlow(emptyUserState(), catalog30, { config: { scope: 'ALL', difficulty: 'mixed', targetN: null, myErrorsPriority: true }, seed: 42 }, clock.ctx()));
    let st = ff.state;
    const sid = ff.value.sessionId;
    const sequence: string[] = [];
    let wrongId: string | null = null;
    for (let i = 0; i < 25; i++) {
      const slot = slotAt(st, sid, session(st, sid).reached);
      sequence.push(slot.questionId);
      const answerWrong = i === 0;
      if (answerWrong) wrongId = slot.questionId;
      const optionId = answerWrong ? wrongOptionOf(slot) : slot.snapshot.correctOptionId;
      st = must(answer(st, { sessionId: sid, expectedRevision: session(st, sid).revision, slotId: slot.id, optionId }, clock.ctx())).state;
      st = must(nextFreeFlowSlot(st, catalog30, { sessionId: sid, expectedRevision: session(st, sid).revision }, clock.ctx())).state;
    }
    const returns = sequence.map((id, i) => (id === wrongId ? i : -1)).filter((i) => i >= 0);
    expect(returns.length).toBeGreaterThanOrEqual(2);
    expect((returns[1] ?? 0) - (returns[0] ?? 0) - 1).toBeGreaterThanOrEqual(8);
  });
});
