/**
 * REVIEW_POLICY_V1 (DECYZJE §8): pełna maszyna stanów kolejki błędów na rzeczywistych sesjach.
 * błąd → poprawna w innej sesji (termin = początek następnego dnia w Europe/Warsaw) →
 * druga poprawna po terminie w jeszcze innej sesji usuwa błąd; błąd zeruje serię;
 * poprawna w tej samej sesji co błąd nie liczy się; próba wykluczona zgłoszeniem nie wpływa na stan.
 */
import { describe, expect, it } from 'vitest';
import {
  answer,
  emptyUserState,
  nextFreeFlowSlot,
  reportQuestion,
  startFreeFlow,
  startTest,
  type QuestionStat,
  type UserState,
} from '../../src/domain/api';
import { applyAnswer, emptyStat, recomputeStat } from '../../src/domain/review';
import { catalogOf, Clock, must, playTest, q, session, slotAt, warsawNextDayStart, wrongOptionOf } from './helpers';

const only = catalogOf([q({ id: 'Q1', domain: 'INJ' })]);

/** Jednopytaniowy test (N=1) z odpowiedzią poprawną/błędną — każda sesja jest „inną sesją”. */
function round(state: UserState, clock: Clock, correct: boolean): { state: UserState; sessionId: string } {
  const out = must(startTest(state, only, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 1, myErrorsPriority: true }, seed: 1 }, clock.ctx()));
  return { state: playTest(out.state, out.value.sessionId, clock, () => correct), sessionId: out.value.sessionId };
}

const stat = (st: UserState): QuestionStat => st.questionStats.Q1 as QuestionStat;

describe('REVIEW_POLICY_V1 na sesjach', () => {
  it('błąd → poprawna (inna sesja) → termin jutro → poprawna przed terminem nic nie zmienia → poprawna po terminie usuwa', () => {
    const clock = new Clock('2026-10-22T08:00:00.000Z'); // 10:00 w Warszawie
    const r1 = round(emptyUserState(), clock, false);
    expect(stat(r1.state)).toMatchObject({ activeError: true, streak: 0, lastWrongSessionId: r1.sessionId, wrongCount: 1 });
    expect(stat(r1.state).dueAt).toBe(stat(r1.state).lastWrongAt);

    clock.tick(60_000);
    const r2 = round(r1.state, clock, true);
    const s2 = stat(r2.state);
    expect(s2).toMatchObject({ activeError: true, streak: 1, streakSessionId: r2.sessionId });
    expect(s2.dueAt).toBe('2026-10-22T22:00:00.000Z'); // 23.10.2026 00:00 CEST
    expect(s2.dueAt).toBe(warsawNextDayStart(s2.lastAnsweredAt as string));

    clock.tick(3600_000);
    const r3 = round(r2.state, clock, true); // ten sam dzień, inna sesja, przed terminem
    expect(stat(r3.state)).toMatchObject({ activeError: true, streak: 1, streakSessionId: r2.sessionId, dueAt: s2.dueAt });

    clock.set('2026-10-23T06:00:00.000Z'); // po terminie
    const r4 = round(r3.state, clock, true);
    expect(stat(r4.state)).toMatchObject({ activeError: false, streak: 0, dueAt: null, correctCount: 3, wrongCount: 1 });
    expect(stat(r4.state).resolvedAt).not.toBeNull();
  });

  it('kolejny błąd zeruje serię', () => {
    const clock = new Clock();
    const r1 = round(emptyUserState(), clock, false);
    const r2 = round(r1.state, clock, true);
    expect(stat(r2.state).streak).toBe(1);
    const r3 = round(r2.state, clock, false);
    expect(stat(r3.state)).toMatchObject({ activeError: true, streak: 0, streakSessionId: null, lastWrongSessionId: r3.sessionId });
    expect(stat(r3.state).dueAt).toBe(stat(r3.state).lastWrongAt);
  });

  it('poprawna odpowiedź w tej samej sesji co błąd nie liczy się do serii', () => {
    const catalog = catalogOf([q({ id: 'Q1', domain: 'INJ' }), q({ id: 'Q2', domain: 'INJ' })]);
    const clock = new Clock();
    const ff = must(startFreeFlow(emptyUserState(), catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: null, myErrorsPriority: false }, seed: 4 }, clock.ctx()));
    let st = ff.state;
    const sid = ff.value.sessionId;
    const seen: string[] = [];
    let target: string | null = null;
    for (let i = 0; i < 4; i++) {
      const slot = slotAt(st, sid, session(st, sid).reached);
      seen.push(slot.questionId);
      target ??= slot.questionId;
      const wrong = i === 0;
      st = must(answer(st, { sessionId: sid, expectedRevision: session(st, sid).revision, slotId: slot.id, optionId: wrong ? wrongOptionOf(slot) : slot.snapshot.correctOptionId }, clock.ctx())).state;
      st = must(nextFreeFlowSlot(st, catalog, { sessionId: sid, expectedRevision: session(st, sid).revision }, clock.ctx())).state;
    }
    // Mała pula: pytania przeplatają się (nigdy to samo dwa razy z rzędu).
    expect(seen.filter((x) => x === target).length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    expect(st.questionStats[target as string]).toMatchObject({ activeError: true, streak: 0, correctCount: 1, wrongCount: 1 });
  });

  it('próba wykluczona zgłoszeniem nie zmienia stanu powtórek', () => {
    const catalog = catalogOf([q({ id: 'Q1', domain: 'INJ' }), q({ id: 'Q2', domain: 'INJ' })]);
    const clock = new Clock();
    const out = must(startTest(emptyUserState(), catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 1, myErrorsPriority: false }, seed: 1 }, clock.ctx()));
    const sid = out.value.sessionId;
    const slot = slotAt(out.state, sid, 0);
    const answered = must(answer(out.state, { sessionId: sid, expectedRevision: 1, slotId: slot.id, optionId: wrongOptionOf(slot) }, clock.ctx())).state;
    expect(answered.questionStats[slot.questionId]?.activeError).toBe(true);
    const reported = must(reportQuestion(answered, catalog, { sessionId: sid, slotId: slot.id, questionId: slot.questionId, expectedRevision: session(answered, sid).revision }, clock.ctx()));
    expect(reported.state.questionStats[slot.questionId]).toMatchObject({ activeError: false, answeredCount: 0, wrongCount: 0, dueAt: null, seenCount: 1 });
    expect(reported.state.attempts[slot.attempt?.commandId ?? Object.keys(answered.attempts)[0]!]).toMatchObject({ excluded: true, excludedReason: 'reported' });
  });
});

describe('REVIEW_POLICY_V1 — przejścia jednostkowe i odtwarzanie z dziennika', () => {
  const base = emptyStat('Q', 'F', 'DEV');
  const t = (h: number) => new Date(Date.UTC(2026, 9, 22, h)).toISOString();

  it('poprawna bez aktywnego błędu nie tworzy kolejki', () => {
    const s = applyAnswer(base, { correct: true, sessionId: 'S1', answeredAt: t(8), nextDayStart: t(22) });
    expect(s).toMatchObject({ activeError: false, streak: 0, dueAt: null, correctCount: 1 });
  });

  it('druga poprawna w tej samej sesji co pierwsza poprawna nie rozwiązuje błędu', () => {
    let s = applyAnswer(base, { correct: false, sessionId: 'S1', answeredAt: t(8), nextDayStart: t(22) });
    s = applyAnswer(s, { correct: true, sessionId: 'S2', answeredAt: t(9), nextDayStart: t(22) });
    s = applyAnswer(s, { correct: true, sessionId: 'S2', answeredAt: t(23), nextDayStart: t(46) });
    expect(s).toMatchObject({ activeError: true, streak: 1, streakSessionId: 'S2' });
    s = applyAnswer(s, { correct: true, sessionId: 'S3', answeredAt: t(23), nextDayStart: t(46) });
    expect(s.activeError).toBe(false);
  });

  it('recomputeStat odtwarza stan z ważnych prób (pomija wykluczone)', () => {
    const attempts = [
      { correct: false, sessionId: 'S1', answeredAt: t(8), nextDayStart: t(22), excluded: false },
      { correct: true, sessionId: 'S2', answeredAt: t(9), nextDayStart: t(22), excluded: false },
      { correct: false, sessionId: 'S3', answeredAt: t(10), nextDayStart: t(22), excluded: true },
    ].map((a, i) => ({
      id: `c${i}`,
      commandId: `c${i}`,
      sessionKind: 'test' as const,
      slotId: `s${i}`,
      questionId: 'Q',
      questionRevision: 1,
      domainId: 'DEV' as const,
      difficulty: 'basic' as const,
      optionId: 'A',
      optionOrder: ['A', 'B', 'C', 'D'],
      excludedReason: a.excluded ? ('reported' as const) : null,
      excludedAt: a.excluded ? t(11) : null,
      ...a,
    }));
    const incremental = applyAnswer(applyAnswer(base, attempts[0]!), attempts[1]!);
    const recomputed = recomputeStat({ ...base, seenCount: 3, firstSeenAt: t(8), lastSeenAt: t(10) }, attempts);
    expect(recomputed).toEqual({ ...incremental, seenCount: 3, firstSeenAt: t(8), lastSeenAt: t(10) });
  });
});
