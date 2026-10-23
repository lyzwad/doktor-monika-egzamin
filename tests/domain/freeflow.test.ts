/**
 * FREE_FLOW_POLICY_V2 (DECYZJE §7; SPECYFIKACJA §4; kryterium D05): bez limitu, priorytet DEV 0,40,
 * adaptacja z podłogą, odtwarzalność z seedem, brak natychmiastowego powtórzenia.
 */
import { describe, expect, it } from 'vitest';
import {
  answer,
  computeFreeFlowWeights,
  emptyUserState,
  endFreeFlow,
  markShown,
  nextFreeFlowSlot,
  sessionProgress,
  startFreeFlow,
  summarizeSession,
  type Attempt,
  type Catalog,
  type DomainId,
  type SessionConfig,
  type UserState,
} from '../../src/domain/api';
import { catalogOf, Clock, DOMAIN_IDS, grid, must, mustFail, session, slotAt, wrongOptionOf } from './helpers';

const big = catalogOf(grid(40)); // 120 rodzin na domenę

function runFreeFlow(
  catalog: Catalog,
  picks: number,
  opts: { seed?: number; config?: Partial<SessionConfig>; state?: UserState; isCorrect?: (qid: string, i: number) => boolean } = {},
) {
  const clock = new Clock();
  const ff = must(
    startFreeFlow(opts.state ?? emptyUserState(), catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: null, myErrorsPriority: false, ...opts.config }, seed: opts.seed ?? 1 }, clock.ctx()),
  );
  let st = ff.state;
  const sid = ff.value.sessionId;
  const sequence: { id: string; family: string; domain: DomainId }[] = [];
  for (let i = 0; i < picks; i++) {
    const s = session(st, sid);
    const slot = slotAt(st, sid, s.reached);
    expect(sessionProgress(s).questionNumber).toBe(i + 1);
    sequence.push({ id: slot.questionId, family: slot.snapshot.familyId, domain: slot.snapshot.domainId });
    st = must(markShown(st, { sessionId: sid, slotId: slot.id }, clock.ctx())).state;
    const correct = opts.isCorrect ? opts.isCorrect(slot.questionId, i) : true;
    const optionId = correct ? slot.snapshot.correctOptionId : wrongOptionOf(slot);
    st = must(answer(st, { sessionId: sid, expectedRevision: session(st, sid).revision, slotId: slot.id, optionId }, clock.ctx())).state;
    if (i < picks - 1) st = must(nextFreeFlowSlot(st, catalog, { sessionId: sid, expectedRevision: session(st, sid).revision }, clock.ctx())).state;
  }
  return { state: st, sessionId: sid, sequence, clock };
}

function share(seq: { domain: DomainId }[]): Record<DomainId, number> {
  const out = Object.fromEntries(DOMAIN_IDS.map((d) => [d, 0])) as Record<DomainId, number>;
  for (const x of seq) out[x.domain]++;
  for (const d of DOMAIN_IDS) out[d] /= seq.length;
  return out;
}

describe('D05 — Free Flow', () => {
  it('bez limitu: numer pytania rośnie, ręczne zakończenie zapisuje podsumowanie bez progu', () => {
    const r = runFreeFlow(big, 150);
    const ended = must(endFreeFlow(r.state, { sessionId: r.sessionId, expectedRevision: session(r.state, r.sessionId).revision }, r.clock.ctx()));
    expect(ended.value.summary).toMatchObject({ kind: 'freeflow', status: 'ended', answeredValid: 150, correct: 150, passed: null, targetN: null, percent: 100 });
    expect(session(ended.state, r.sessionId).status).toBe('ended');
    expect(ended.changeset.stores.sessions?.put).toHaveLength(1);
  });

  it('priorytet DEV 0,40 i po 0,12 pozostałych w całym zakresie (duża próba, tolerancja ±0,02)', () => {
    const r = runFreeFlow(big, 600, { seed: 5 });
    const s = share(r.sequence);
    expect(Math.abs(s.DEV - 0.4)).toBeLessThan(0.02);
    for (const d of DOMAIN_IDS.filter((x) => x !== 'DEV')) expect(Math.abs(s[d] - 0.12)).toBeLessThan(0.02);
    const weights = session(r.state, r.sessionId).allocation.freeFlowWeights;
    expect(weights?.DEV).toBeCloseTo(0.4, 10);
  });

  it('brak podaży domeny → renormalizacja; domena solo → 100% tej domeny', () => {
    const noDev = catalogOf(grid(10, { domains: ['ANAT', 'INJ', 'SKIN', 'THER', 'SAFE'] }));
    const r = runFreeFlow(noDev, 100);
    expect(r.sequence.some((x) => x.domain === 'DEV')).toBe(false);
    const w = session(r.state, r.sessionId).allocation.freeFlowWeights ?? {};
    for (const d of ['ANAT', 'INJ', 'SKIN', 'THER', 'SAFE'] as const) expect(w[d]).toBeCloseTo(0.2, 10);
    const solo = runFreeFlow(big, 60, { config: { scope: 'SKIN' } });
    expect(solo.sequence.every((x) => x.domain === 'SKIN')).toBe(true);
  });

  it('adaptacja zwiększa wagę słabszej domeny, ale zachowuje podłogę 0,05 dla każdej dostępnej domeny', () => {
    const attempts: Attempt[] = [];
    let n = 0;
    const add = (domainId: DomainId, count: number, wrongEvery: number) => {
      for (let i = 0; i < count; i++) {
        n++;
        attempts.push({
          id: `a${n}`,
          commandId: `a${n}`,
          sessionId: 'S',
          sessionKind: 'freeflow',
          slotId: `s${n}`,
          questionId: `${domainId}-${i}`,
          questionRevision: 1,
          domainId,
          difficulty: 'basic',
          optionId: 'A',
          optionOrder: ['A', 'B', 'C', 'D'],
          correct: wrongEvery === 0 ? true : i % wrongEvery !== 0,
          answeredAt: new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString(),
          excluded: false,
          excludedReason: null,
          excludedAt: null,
        });
      }
    };
    add('SKIN', 30, 1); // 100% błędów
    for (const d of ['ANAT', 'INJ', 'THER', 'DEV', 'SAFE'] as const) add(d, 30, 0);
    const w = computeFreeFlowWeights(attempts, 'ALL', DOMAIN_IDS);
    expect(Object.keys(w).sort()).toEqual([...DOMAIN_IDS].sort());
    expect((w.SKIN ?? 0) > 0.12).toBe(true);
    expect((w.DEV ?? 0) < 0.4).toBe(true);
    const total = Object.values(w).reduce((a, b) => a + (b ?? 0), 0);
    expect(total).toBeCloseTo(1, 10);
    for (const d of DOMAIN_IDS) expect(w[d] ?? 0).toBeGreaterThanOrEqual(0.05 - 1e-12);

    // Ekstremalnie: wszystkie domeny poza DEV bezbłędne, DEV 100% błędów → pozostałe nadal ≥ podłogi.
    const attempts2: Attempt[] = [];
    n = 0;
    const add2 = (d: DomainId, wrong: boolean) => {
      for (let i = 0; i < 30; i++) {
        n++;
        attempts2.push({ ...attempts[0]!, id: `b${n}`, commandId: `b${n}`, domainId: d, correct: !wrong, answeredAt: new Date(Date.UTC(2026, 9, 2, 0, 0, n)).toISOString() });
      }
    };
    add2('DEV', true);
    for (const d of ['ANAT', 'INJ', 'SKIN', 'THER', 'SAFE'] as const) add2(d, false);
    const w2 = computeFreeFlowWeights(attempts2, 'ALL', DOMAIN_IDS);
    for (const d of DOMAIN_IDS) expect(w2[d] ?? 0).toBeGreaterThanOrEqual(0.05 - 1e-12);
    // Mniej niż 10 prób → bez adaptacji.
    expect(computeFreeFlowWeights(attempts.slice(0, 9), 'ALL', DOMAIN_IDS).SKIN).toBeCloseTo(0.12, 10);
    // Domena ze złymi wynikami pojawia się częściej w symulacji, ale żadna domena nie znika.
    const sim = runFreeFlow(big, 400, { seed: 9, isCorrect: (qid) => !qid.startsWith('SKIN') });
    const s = share(sim.sequence);
    expect(s.SKIN).toBeGreaterThan(0.12);
    for (const d of DOMAIN_IDS) expect(s[d]).toBeGreaterThan(0.03);
  });

  it('odtwarzalność z seedem (ten sam seed i odpowiedzi → ta sama sekwencja)', () => {
    const a = runFreeFlow(big, 80, { seed: 77 });
    const b = runFreeFlow(big, 80, { seed: 77 });
    const c = runFreeFlow(big, 80, { seed: 78 });
    expect(b.sequence).toEqual(a.sequence);
    expect(c.sequence).not.toEqual(a.sequence);
  });

  it('nie powtarza poprzedniego pytania; w dużej puli brak powtórek w 10 slotach i rodzin w 5 slotach', () => {
    const r = runFreeFlow(big, 300, { seed: 3, isCorrect: (_q, i) => i % 4 !== 0 });
    for (let i = 1; i < r.sequence.length; i++) {
      expect(r.sequence[i]?.id).not.toBe(r.sequence[i - 1]?.id);
      const last10 = r.sequence.slice(Math.max(0, i - 10), i).map((x) => x.id);
      expect(last10).not.toContain(r.sequence[i]?.id);
      const last5f = r.sequence.slice(Math.max(0, i - 5), i).map((x) => x.family);
      expect(last5f).not.toContain(r.sequence[i]?.family);
    }
    // Powtórki w tej sesji dotyczą wyłącznie pytań z błędną odpowiedzią (należne błędy).
    const wrongIds = new Set(r.sequence.filter((_x, i) => i % 4 === 0).map((x) => x.id));
    const firstSeen = new Set<string>();
    for (const x of r.sequence) {
      if (firstSeen.has(x.id)) expect(wrongIds.has(x.id)).toBe(true);
      firstSeen.add(x.id);
    }
    // Najpierw nowe: przy samych poprawnych odpowiedziach 300 doborów w puli 720 rodzin to różne pytania.
    const allCorrect = runFreeFlow(big, 300, { seed: 4 });
    expect(new Set(allCorrect.sequence.map((x) => x.id)).size).toBe(300);
  });

  it('po wyczerpaniu nowych kontynuuje powtórki (mała pula), „Dalej” wymaga odpowiedzi', () => {
    const small = catalogOf(grid(1, { domains: ['ANAT', 'INJ'], levels: ['basic'] }).concat(grid(1, { domains: ['DEV'], levels: ['basic', 'advanced'] }))); // 4 pytania
    const r = runFreeFlow(small, 30, { seed: 2 });
    expect(new Set(r.sequence.map((x) => x.id)).size).toBe(4);
    for (let i = 1; i < r.sequence.length; i++) expect(r.sequence[i]?.id).not.toBe(r.sequence[i - 1]?.id);
    const s = session(r.state, r.sessionId);
    // Ostatni slot oceniony — „Dalej” możliwe; świeżo dobrany bez odpowiedzi — odrzucone.
    const next = must(nextFreeFlowSlot(r.state, small, { sessionId: s.id, expectedRevision: s.revision }, r.clock.ctx()));
    mustFail(nextFreeFlowSlot(next.state, small, { sessionId: s.id, expectedRevision: session(next.state, s.id).revision }, r.clock.ctx()), 'SLOT_NOT_ANSWERED');
    expect(summarizeSession(session(next.state, s.id)).answeredValid).toBe(30);
  });

  it('pula jednego pytania: po odpowiedzi stan empty (nie powtarza natychmiast), bez pętli', () => {
    const one = catalogOf(grid(1, { domains: ['THER'], levels: ['basic'] }));
    const clock = new Clock();
    const ff = must(startFreeFlow(emptyUserState(), one, { config: { scope: 'ALL', difficulty: 'mixed', targetN: null, myErrorsPriority: false }, seed: 1 }, clock.ctx()));
    const sid = ff.value.sessionId;
    const slot = slotAt(ff.state, sid, 0);
    const st = must(answer(ff.state, { sessionId: sid, expectedRevision: 1, slotId: slot.id, optionId: slot.snapshot.correctOptionId }, clock.ctx())).state;
    const next = must(nextFreeFlowSlot(st, one, { sessionId: sid, expectedRevision: session(st, sid).revision }, clock.ctx()));
    expect(next.value).toEqual({ slotId: null, empty: true, myErrorsExhausted: false });
    expect(session(next.state, sid).freeFlow?.empty).toBe(true);
    const again = must(nextFreeFlowSlot(next.state, one, { sessionId: sid, expectedRevision: session(next.state, sid).revision }, clock.ctx()));
    expect(again.state).toBe(next.state);
  });
});
