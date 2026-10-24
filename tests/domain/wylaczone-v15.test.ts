/**
 * Wyłączone ID (retired_question_ids.json, 133) nie trafiają do ŻADNEGO trybu: Test, Free Flow, runda błędów,
 * zastępstwa i „Moje błędy” — nawet gdy dane użytkowniczki (np. stara kopia) zawierają aktywny błąd takiego ID.
 * Sesja poprzedniej wersji banku (`legacy`) nie daje rundy błędów.
 */
import { describe, expect, it } from 'vitest';
import {
  emptyUserState,
  nextFreeFlowSlot,
  reportQuestion,
  startFreeFlow,
  startRetryRound,
  startTest,
  answer,
  markShown,
  type QuestionStat,
  type Session,
  type UserState,
} from '../../src/domain/api';
import { emptyStat } from '../../src/domain/review';
import { BANK, RETIRED_IDS, v15Catalog } from '../content';
import { Clock, must, playTest, session, slotAt } from './helpers';

const catalog = v15Catalog();
const retired = new Set(RETIRED_IDS);

/** Stan z aktywnymi błędami WSZYSTKICH wyłączonych ID i kilku zwykłych (jak po wczytaniu starej kopii). */
function stateWithRetiredErrors(): UserState {
  const stats: Record<string, QuestionStat> = {};
  const err = (id: string, familyId: string, domainId: QuestionStat['domainId']): QuestionStat => ({
    ...emptyStat(id, familyId, domainId),
    seenCount: 1,
    firstSeenAt: '2026-10-20T08:00:00.000Z',
    lastSeenAt: '2026-10-20T08:00:00.000Z',
    answeredCount: 1,
    wrongCount: 1,
    lastAnsweredAt: '2026-10-20T08:00:00.000Z',
    activeError: true,
    dueAt: '2026-10-20T08:00:00.000Z',
    lastWrongAt: '2026-10-20T08:00:00.000Z',
  });
  for (const id of RETIRED_IDS) stats[id] = err(id, `FAM-${id}`, (id.split('-')[0] as QuestionStat['domainId']) ?? 'SAFE');
  for (const q of BANK.questions.slice(0, 3)) stats[q.id] = err(q.id, q.family_id, q.domain_id);
  return { ...emptyUserState(), questionStats: stats };
}

function slotIds(s: Session): string[] {
  return Object.values(s.slots).map((x) => x.questionId);
}

describe('wyłączone ID poza każdym trybem', () => {
  it('Test z „Moje błędy”: tylko aktywne błędy z katalogu V15, żadnego wyłączonego ID', () => {
    const st = stateWithRetiredErrors();
    const out = must(startTest(st, catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 20, myErrorsPriority: true }, seed: 3 }, new Clock().ctx()));
    const s = session(out.state, out.value.sessionId);
    expect(slotIds(s).some((id) => retired.has(id))).toBe(false);
    expect(s.plan.filter((id) => s.slots[id]?.origin === 'my_errors')).toHaveLength(3);
  });

  it('Free Flow z „Moje błędy”: 40 pytań bez wyłączonych ID', () => {
    const clock = new Clock();
    let st = stateWithRetiredErrors();
    const ff = must(startFreeFlow(st, catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: null, myErrorsPriority: true }, seed: 8 }, clock.ctx()));
    st = ff.state;
    const sid = ff.value.sessionId;
    for (let i = 0; i < 40; i++) {
      const slot = slotAt(st, sid, session(st, sid).reached);
      expect(retired.has(slot.questionId)).toBe(false);
      st = must(markShown(st, { sessionId: sid, slotId: slot.id }, clock.ctx())).state;
      st = must(answer(st, { sessionId: sid, expectedRevision: session(st, sid).revision, slotId: slot.id, optionId: slot.snapshot.correctOptionId }, clock.ctx())).state;
      st = must(nextFreeFlowSlot(st, catalog, { sessionId: sid, expectedRevision: session(st, sid).revision }, clock.ctx())).state;
    }
  });

  it('zgłoszenie z zastępstwem i runda błędów: bez wyłączonych ID', () => {
    const clock = new Clock();
    const out = must(startTest(emptyUserState(), catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 30, myErrorsPriority: false }, seed: 13 }, clock.ctx()));
    const sid = out.value.sessionId;
    const first = slotAt(out.state, sid, 0);
    const reported = must(reportQuestion(out.state, catalog, { sessionId: sid, slotId: first.id, questionId: first.questionId, expectedRevision: session(out.state, sid).revision }, clock.ctx()));
    expect(reported.value.replacementSlotId).not.toBeNull();
    const done = playTest(reported.state, sid, clock, (i) => i % 3 !== 0);
    const round = must(startRetryRound(done, catalog, { sourceSessionId: sid, seed: 21 }, clock.ctx()));
    const all = [...slotIds(session(done, sid)), ...slotIds(session(round.state, round.value.sessionId))];
    expect(all.some((id) => retired.has(id))).toBe(false);
  });

  it('runda błędów z sesji poprzedniej wersji banku (legacy) → LEGACY_SESSION', () => {
    const clock = new Clock();
    const out = must(startTest(emptyUserState(), catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 3, myErrorsPriority: false }, seed: 1 }, clock.ctx()));
    const done = playTest(out.state, out.value.sessionId, clock, () => false);
    const s = session(done, out.value.sessionId);
    const legacy: Session = {
      ...s,
      bankVersion: 'release-2026-10-23c',
      plan: [],
      slots: {},
      legacy: { reason: 'bank_v15_update', previousBankVersion: 'release-2026-10-23c', contentBankVersion: catalog.bankVersion, migratedAt: clock.now, previousStatus: 'completed', answeredValid: 3, correct: 0, excluded: 0, planLength: 3 },
    };
    const st: UserState = { ...done, sessions: { ...done.sessions, [s.id]: legacy } };
    const r = startRetryRound(st, catalog, { sourceSessionId: s.id, seed: 2 }, clock.ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('LEGACY_SESSION');
  });
});
