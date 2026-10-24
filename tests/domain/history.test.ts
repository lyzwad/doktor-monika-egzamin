/**
 * Snapshoty i historia (03_ARCHITEKTURA §3, §7; SPECYFIKACJA §9; kryteria F04, F05).
 */
import { describe, expect, it } from 'vitest';
import {
  answer,
  chartPoints,
  closeUnfinished,
  configKey,
  emptyUserState,
  endFreeFlow,
  reviewItems,
  startFreeFlow,
  startRetryRound,
  startTest,
  summarizeHistory,
  summarizeSession,
  type SessionConfig,
  type SessionSummary,
  type UserState,
} from '../../src/domain/api';
import { catalogOf, Clock, grid, must, playTest, session, slotAt } from './helpers';

const questions = grid(4);
const catalog = catalogOf(questions);

function test(state: UserState, clock: Clock, config: Partial<SessionConfig> & { targetN: number }, correct: (i: number) => boolean, seed = 1) {
  const out = must(startTest(state, catalog, { config: { scope: 'ALL', difficulty: 'mixed', myErrorsPriority: false, ...config }, seed }, clock.ctx()));
  return { state: playTest(out.state, out.value.sessionId, clock, (i) => correct(i)), sessionId: out.value.sessionId };
}

describe('F04 — snapshoty niezależne od późniejszej zmiany katalogu', () => {
  it('nowa rewizja, zmieniony klucz i usunięcie pytania nie zmieniają zamkniętej historii', () => {
    const clock = new Clock();
    const r = test(emptyUserState(), clock, { targetN: 10 }, (i) => i % 2 === 0);
    const before = JSON.stringify(session(r.state, r.sessionId));
    const itemsBefore = reviewItems(r.state, r.sessionId, 'all');
    const slot0 = slotAt(r.state, r.sessionId, 0);
    // Nowy bank: inna treść i inny klucz dla wszystkich, jedno pytanie usunięte.
    const changed = questions
      .filter((x) => x.id !== slot0.questionId)
      .map((x) => ({ ...x, revision: 2, stem_pl: `ZMIENIONE ${x.stem_pl}`, correct_option_id: 'A' }));
    const catalog2 = catalogOf(changed, {}, 'test-bank-2');
    // Kolejna sesja na nowym katalogu nie dotyka starej.
    const next = must(startRetryRound(r.state, catalog2, { sourceSessionId: r.sessionId, seed: 2 }, clock.ctx()));
    expect(JSON.stringify(session(next.state, r.sessionId))).toBe(before);
    expect(reviewItems(next.state, r.sessionId, 'all')).toEqual(itemsBefore);
    const s = session(next.state, r.sessionId);
    expect(s.bankVersion).toBe('test-bank-1');
    expect(s.plan.every((id) => !s.slots[id]!.snapshot.stem.startsWith('ZMIENIONE'))).toBe(true);
    expect(s.slots[slot0.id]!.snapshot.correctOptionId).toBe(slot0.snapshot.correctOptionId);
    // Nowe sloty mają nową wersję banku w snapshocie.
    const ns = session(next.state, next.value.sessionId);
    expect(ns.plan.map((id) => ns.slots[id]!.snapshot.bankVersion).filter((v) => v === 'test-bank-2').length).toBeGreaterThan(0);
  });

  it('snapshot nie współdzieli referencji z katalogiem', () => {
    const local = catalogOf(grid(1));
    const clock = new Clock();
    const out = must(startTest(emptyUserState(), local, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 3, myErrorsPriority: false }, seed: 1 }, clock.ctx()));
    const slot = slotAt(out.state, out.value.sessionId, 0);
    const copy = JSON.stringify(slot.snapshot);
    const topic = local.topics[slot.snapshot.topicIds[0]!]!;
    (topic.pearls as string[]).push('dopisane później');
    (local.questionsById[slot.questionId]!.options as { id: string; text: string }[])[0]!.text = 'zmienione';
    expect(JSON.stringify(slot.snapshot)).toBe(copy);
  });
});

describe('F05 — historia i wykres', () => {
  it('pusta historia: brak wpisów i punktów (bez NaN i udawanego 0%)', () => {
    expect(summarizeHistory(emptyUserState())).toEqual({ tests: [], freeFlow: [], configs: [] });
    expect(chartPoints(emptyUserState(), { kind: 'all' })).toEqual([]);
  });

  it('rozróżnia Test i Free Flow; wykres tylko ukończonych testów z oznaczeniem powtórek i filtra błędów', () => {
    const clock = new Clock();
    let st = emptyUserState();
    const t1 = test(st, clock, { targetN: 10 }, (i) => i >= 4); // 6/10, 4 błędy
    st = t1.state;
    const retry = must(startRetryRound(st, catalog, { sourceSessionId: t1.sessionId, seed: 3 }, clock.ctx()));
    st = playTest(retry.state, retry.value.sessionId, clock, () => true);
    const t3 = test(st, clock, { targetN: 10, myErrorsPriority: true }, () => true, 4);
    st = t3.state;
    // Niedokończony test z 0 odpowiedzi.
    const open = must(startTest(st, catalog, { config: { scope: 'DEV', difficulty: 'mixed', targetN: 5, myErrorsPriority: false }, seed: 5 }, clock.ctx()));
    st = must(closeUnfinished(open.state, { sessionId: open.value.sessionId, expectedRevision: 1 }, clock.ctx())).state;
    // Free Flow z odpowiedzią i Free Flow bez odpowiedzi.
    const ff1 = must(startFreeFlow(st, catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: null, myErrorsPriority: false }, seed: 6 }, clock.ctx()));
    const ffSlot = slotAt(ff1.state, ff1.value.sessionId, 0);
    st = must(answer(ff1.state, { sessionId: ff1.value.sessionId, expectedRevision: 1, slotId: ffSlot.id, optionId: ffSlot.snapshot.correctOptionId }, clock.ctx())).state;
    st = must(endFreeFlow(st, { sessionId: ff1.value.sessionId, expectedRevision: session(st, ff1.value.sessionId).revision }, clock.ctx())).state;
    const ff2 = must(startFreeFlow(st, catalog, { config: { scope: 'SKIN', difficulty: 'basic', targetN: null, myErrorsPriority: false }, seed: 7 }, clock.ctx()));
    st = must(endFreeFlow(ff2.state, { sessionId: ff2.value.sessionId, expectedRevision: 1 }, clock.ctx())).state;
    // Otwarta sesja nie trafia do historii.
    st = must(startTest(st, catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 3, myErrorsPriority: false }, seed: 8 }, clock.ctx())).state;

    const h = summarizeHistory(st);
    expect(h.tests.map((t) => t.status)).toEqual(['unfinished', 'completed', 'completed', 'completed']);
    expect(h.tests.map((t) => t.sessionId)).toEqual([open.value.sessionId, t3.sessionId, retry.value.sessionId, t1.sessionId]);
    expect(h.freeFlow.map((f) => f.sessionId)).toEqual([ff2.value.sessionId, ff1.value.sessionId]);
    const unfinished = h.tests[0] as SessionSummary;
    expect(unfinished).toMatchObject({ percent: null, passed: null, answeredValid: 0 });
    expect(h.freeFlow[0]).toMatchObject({ percent: null, passed: null, answeredValid: 0, targetN: null });
    expect(h.freeFlow[1]).toMatchObject({ percent: 100, passed: null, answeredValid: 1 });
    const allNumbers = [...h.tests, ...h.freeFlow].flatMap((x) => [x.percent, x.correct, x.answeredValid]);
    expect(allNumbers.every((v) => v === null || Number.isFinite(v))).toBe(true);

    const points = chartPoints(st, { kind: 'all' });
    expect(points.map((p) => [p.sessionId, p.percent, p.passed, p.isRetry, p.roundIndex, p.myErrorsPriority])).toEqual([
      [t1.sessionId, 60, false, false, null, false],
      [retry.value.sessionId, 100, true, true, 2, false],
      [t3.sessionId, 100, true, false, null, true],
    ]);
    const key = configKey({ scope: 'ALL', difficulty: 'mixed', targetN: 10, myErrorsPriority: true });
    expect(chartPoints(st, { kind: 'config', key }).map((p) => p.sessionId)).toEqual([t3.sessionId]);
    expect(h.configs.find((c) => c.key === configKey({ scope: 'ALL', difficulty: 'mixed', targetN: 10, myErrorsPriority: false }))?.count).toBe(2);
    expect(summarizeSession(session(st, t1.sessionId))).toMatchObject({ correct: 6, targetN: 10, passed: false, percent: 60 });
  });
});
