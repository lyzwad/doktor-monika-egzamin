/**
 * Kontrakt changesetu (DECYZJE §1, §10): zastosowanie changesetu do poprzedniego stanu (jak zrobi to
 * repozytorium w JEDNEJ transakcji) daje dokładnie nowy stan zwrócony przez domenę; rekordy są
 * JSON/structured-clone (bez undefined, Map, Set); strażnicy rewizji dotyczą każdej zapisanej sesji.
 */
import { describe, expect, it } from 'vitest';
import {
  advance,
  answer,
  emptyUserState,
  finishTest,
  isChangesetEmpty,
  markShown,
  nextFreeFlowSlot,
  reportQuestion,
  restoreBlock,
  startFreeFlow,
  startRetryRound,
  startTest,
  undoReport,
  updateSettings,
  type Changeset,
  type CommandResult,
  type DomainOutcome,
  type UserState,
} from '../../src/domain/api';
import { catalogOf, Clock, grid, session, slotAt, wrongOptionOf } from './helpers';

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

const catalog = catalogOf(grid(3));

describe('changeset = pełny opis zmiany stanu', () => {
  it('scenariusz Test + zgłoszenie + Cofnij + runda + Free Flow + Przywróć', () => {
    const clock = new Clock();
    let state = emptyUserState();
    const check = <V>(r: CommandResult<DomainOutcome<V>>): DomainOutcome<V> => {
      if (!r.ok) throw new Error(r.error.code);
      const out = r.value;
      expect(applyChangeset(state, out.changeset)).toStrictEqual(out.state);
      expect(JSON.parse(JSON.stringify(out.state))).toStrictEqual(out.state);
      const written = out.changeset.stores.sessions?.put ?? [];
      expect(out.changeset.guards.map((g) => g.sessionId).sort()).toEqual(written.map((s) => s.id).sort());
      for (const g of out.changeset.guards) expect(g.expectedRevision).toBe(state.sessions[g.sessionId]?.revision ?? null);
      expect(out.changeset.commandId).not.toBeNull();
      if (!isChangesetEmpty(out.changeset)) expect(out.state).not.toBe(state);
      state = out.state;
      return out;
    };

    const t = check(startTest(state, catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 6, myErrorsPriority: false }, seed: 1 }, clock.ctx()));
    const sid = t.value.sessionId;
    for (let i = 0; i < 6; i++) {
      const slot = slotAt(state, sid, session(state, sid).reached);
      check(markShown(state, { sessionId: sid, slotId: slot.id }, clock.ctx()));
      check(answer(state, { sessionId: sid, expectedRevision: session(state, sid).revision, slotId: slot.id, optionId: i < 2 ? wrongOptionOf(slot) : slot.snapshot.correctOptionId }, clock.ctx()));
      if (i === 3) {
        const rep = check(reportQuestion(state, catalog, { sessionId: sid, slotId: slot.id, questionId: slot.questionId, expectedRevision: session(state, sid).revision }, clock.ctx()));
        check(undoReport(state, rep.value.undo!, clock.ctx()));
      }
      if (i < 5) check(advance(state, { sessionId: sid, expectedRevision: session(state, sid).revision }, clock.ctx()));
    }
    check(finishTest(state, { sessionId: sid, expectedRevision: session(state, sid).revision }, clock.ctx()));
    const late = slotAt(state, sid, 0);
    const lateReport = check(reportQuestion(state, catalog, { sessionId: sid, slotId: late.id, questionId: late.questionId, expectedRevision: null }, clock.ctx()));
    const round = check(startRetryRound(state, catalog, { sourceSessionId: sid, seed: 2 }, clock.ctx()));
    expect(session(state, round.value.sessionId).retry?.repeatedCount).toBe(1);
    const ff = check(startFreeFlow(state, catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: null, myErrorsPriority: true }, seed: 3 }, clock.ctx()));
    expect(session(state, round.value.sessionId).status).toBe('unfinished');
    const fsid = ff.value.sessionId;
    for (let i = 0; i < 4; i++) {
      const slot = slotAt(state, fsid, session(state, fsid).reached);
      check(answer(state, { sessionId: fsid, expectedRevision: session(state, fsid).revision, slotId: slot.id, optionId: slot.snapshot.correctOptionId }, clock.ctx()));
      if (i === 2) {
        const rep = check(reportQuestion(state, catalog, { sessionId: fsid, slotId: slot.id, questionId: slot.questionId, expectedRevision: session(state, fsid).revision }, clock.ctx()));
        const replaced = slotAt(state, fsid, session(state, fsid).reached);
        expect(replaced.id).toBe(rep.value.replacementSlotId);
        check(answer(state, { sessionId: fsid, expectedRevision: session(state, fsid).revision, slotId: replaced.id, optionId: replaced.snapshot.correctOptionId }, clock.ctx()));
      }
      check(nextFreeFlowSlot(state, catalog, { sessionId: fsid, expectedRevision: session(state, fsid).revision }, clock.ctx()));
    }
    check(restoreBlock(state, { blockId: lateReport.value.blockId }, clock.ctx()));
    const dismissedAt = clock.now;
    check(updateSettings(state, { installHintDismissedAt: dismissedAt, persistRequestedAt: dismissedAt }, clock.ctx()));
    expect(state.settings.installHintDismissedAt).toBe(dismissedAt);
  });
});
