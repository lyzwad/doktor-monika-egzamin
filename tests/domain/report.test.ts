/**
 * Zgłoszenie, zastępstwo, „Cofnij”, „Przywróć” (DECYZJE §9; SPECYFIKACJA §8; kryteria E01–E06).
 */
import { describe, expect, it } from 'vitest';
import {
  activeBlocks,
  advance,
  answer,
  buildCatalog,
  closeUnfinished,
  emptyUserState,
  fillAwaitingReplacements,
  finishTest,
  isUndoValid,
  markShown,
  nextFreeFlowSlot,
  poolFor,
  reportQuestion,
  restoreBlock,
  reviewItems,
  sessionProgress,
  startFreeFlow,
  startTest,
  summarizeSession,
  undoReport,
  type Catalog,
  type PackRecord,
  type RuntimeQuestion,
  type UserState,
} from '../../src/domain/api';
import { validatePackFile } from '../../src/persistence/packs';
import { answerCurrent, bank, catalogOf, Clock, grid, must, mustFail, playTest, q, session, slotAt, wrongOptionOf } from './helpers';

const catalog = catalogOf(grid(3)); // 54 rodziny

function startN(n: number, cat: Catalog = catalog, seed = 13) {
  const clock = new Clock();
  const out = must(startTest(emptyUserState(), cat, { config: { scope: 'ALL', difficulty: 'mixed', targetN: n, myErrorsPriority: false }, seed }, clock.ctx()));
  return { state: out.state, sessionId: out.value.sessionId, clock };
}

function report(state: UserState, sessionId: string, index: number, clock: Clock, cat: Catalog = catalog) {
  const slot = slotAt(state, sessionId, index);
  const s = session(state, sessionId);
  return must(
    reportQuestion(state, cat, { sessionId, slotId: slot.id, questionId: slot.questionId, expectedRevision: s.status === 'open' ? s.revision : null }, clock.ctx()),
  );
}

describe('E01–E02 — zgłoszenie w otwartym teście', () => {
  it('przed odpowiedzią: blokada (id, fingerprint, rodzina), zastępstwo na tej samej pozycji, N bez zmian', () => {
    const { state, sessionId, clock } = startN(5);
    const original = slotAt(state, sessionId, 0);
    const out = report(state, sessionId, 0, clock);
    const s = session(out.state, sessionId);
    expect(out.value.phase).toBe('before_answer');
    expect(out.value.awaitingReplacement).toBe(false);
    expect(s.config.targetN).toBe(5);
    expect(s.plan).toHaveLength(5);
    const replacement = slotAt(out.state, sessionId, 0);
    expect(replacement.id).toBe(out.value.replacementSlotId);
    expect(replacement.origin).toBe('replacement');
    expect(replacement.replacesSlotId).toBe(original.id);
    expect(s.slots[original.id]?.excluded).toMatchObject({ reason: 'reported', eventId: out.value.eventId });
    // Zastępstwo spoza planu i rodzin planu.
    const others = s.plan.slice(1).map((id) => s.slots[id]!.snapshot.familyId);
    expect(others).not.toContain(replacement.snapshot.familyId);
    expect(replacement.snapshot.familyId).not.toBe(original.snapshot.familyId);
    // Ten sam koszyk (domena × poziom), gdy jest podaż.
    expect([replacement.snapshot.domainId, replacement.snapshot.difficulty]).toEqual([original.snapshot.domainId, original.snapshot.difficulty]);
    const block = out.state.blocks[out.value.blockId]!;
    expect(block).toMatchObject({
      questionId: original.questionId,
      revision: original.snapshot.revision,
      fingerprint: original.snapshot.fingerprint,
      familyId: original.snapshot.familyId,
      sessionId,
      slotId: original.id,
      revokedAt: null,
    });
    expect(out.changeset.stores.blocks?.put).toHaveLength(1);
    expect(out.changeset.stores.events?.put.map((e) => e.type)).toEqual(['question_reported', 'slot_replaced']);
    expect(Object.keys(out.changeset.stores)).not.toContain('attempts');
    // Blokada nie obejmuje całego tematu: inne pytania tej domeny/tematu nadal w puli.
    const pool = poolFor(catalog, out.state, 'ALL', 'mixed', clock.now);
    expect(pool.questionIds).not.toContain(original.questionId);
    expect(pool.questionIds.filter((id) => catalog.questionsById[id]?.topicIds[0] === original.snapshot.topicIds[0]).length).toBeGreaterThan(0);
  });

  it.each([
    ['błędnej', false],
    ['poprawnej', true],
  ])('po %s odpowiedzi: próba wyłączona z punktacji (audyt zostaje), zastępstwo czeka na odpowiedź', (_l, correct) => {
    const { state, sessionId, clock } = startN(5);
    let st = answerCurrent(state, sessionId, clock, correct);
    const answered = slotAt(st, sessionId, 0);
    expect(sessionProgress(session(st, sessionId)).answeredValid).toBe(1);
    const out = report(st, sessionId, 0, clock);
    st = out.state;
    expect(out.value.phase).toBe('after_answer');
    expect(sessionProgress(session(st, sessionId))).toMatchObject({ answeredValid: 0, correctValid: 0 });
    const logged = st.attempts[answered.attempt!.commandId]!;
    expect(logged).toMatchObject({ excluded: true, excludedReason: 'reported', optionId: answered.attempt!.optionId, correct });
    expect(st.questionStats[answered.questionId]).toMatchObject({ answeredCount: 0, activeError: false, seenCount: 1 });
    // Zastępstwo nieocenione, można odpowiedzieć (ta sama pozycja).
    const rep = slotAt(st, sessionId, 0);
    expect(rep.attempt).toBeNull();
    st = answerCurrent(st, sessionId, clock, true);
    expect(sessionProgress(session(st, sessionId)).answeredValid).toBe(1);
  });

  it('E03 — wcześniejsza pozycja: zastępstwo na tej pozycji, N zachowane, wynik dopiero po ocenie zastępstwa', () => {
    const { state, sessionId, clock } = startN(4);
    let st = state;
    for (let i = 0; i < 3; i++) {
      st = answerCurrent(st, sessionId, clock, true);
      st = must(advance(st, { sessionId, expectedRevision: session(st, sessionId).revision }, clock.ctx())).state;
    }
    st = answerCurrent(st, sessionId, clock, true); // pozycja 3 (ostatnia)
    const out = report(st, sessionId, 1, clock);
    st = out.state;
    const s = session(st, sessionId);
    expect(s.reached).toBe(3);
    expect(sessionProgress(s)).toMatchObject({ answeredValid: 3, targetN: 4, readyToFinish: false });
    mustFail(finishTest(st, { sessionId, expectedRevision: s.revision }, clock.ctx()), 'TEST_NOT_COMPLETE');
    const rep = slotAt(st, sessionId, 1);
    st = must(answer(st, { sessionId, expectedRevision: s.revision, slotId: rep.id, optionId: rep.snapshot.correctOptionId }, clock.ctx())).state;
    const done = must(finishTest(st, { sessionId, expectedRevision: session(st, sessionId).revision }, clock.ctx()));
    expect(done.value.result).toMatchObject({ correct: 4, targetN: 4, passed: true });
  });

  it('E03 — brak zastępstwa: spójny stan oczekujący (bez ukończenia z N−1), potem uzupełnienie po imporcie', () => {
    const exact = catalogOf(grid(1, { levels: ['basic'] })); // 6 rodzin
    const { state, sessionId, clock } = startN(6, exact);
    let st = answerCurrent(state, sessionId, clock, true);
    const out = report(st, sessionId, 0, clock, exact);
    st = out.state;
    expect(out.value).toMatchObject({ replacementSlotId: null, awaitingReplacement: true });
    const s = session(st, sessionId);
    expect(s.awaitingReplacement).toEqual([s.plan[0]]);
    expect(s.plan).toHaveLength(6);
    expect(Object.values(st.events).map((e) => e.type)).toContain('replacement_unavailable');
    // Kontynuacja pozostałych pozycji.
    st = must(advance(st, { sessionId, expectedRevision: s.revision }, clock.ctx())).state;
    for (let i = 1; i < 6; i++) {
      st = answerCurrent(st, sessionId, clock, true);
      if (i < 5) st = must(advance(st, { sessionId, expectedRevision: session(st, sessionId).revision }, clock.ctx())).state;
    }
    expect(sessionProgress(session(st, sessionId))).toMatchObject({ answeredValid: 5, awaitingReplacement: true, readyToFinish: false });
    mustFail(finishTest(st, { sessionId, expectedRevision: session(st, sessionId).revision }, clock.ctx()), 'AWAITING_REPLACEMENT');
    // Bez nowych pytań — nic do uzupełnienia, stan bez zmian.
    const none = must(fillAwaitingReplacements(st, exact, { sessionId, expectedRevision: session(st, sessionId).revision }, clock.ctx()));
    expect(none.value).toEqual({ filled: 0, stillAwaiting: 1 });
    expect(none.state).toBe(st);
    // Import puli (nowy katalog) → uzupełnienie i ukończenie.
    const extended = catalogOf([...grid(1, { levels: ['basic'] }), q({ id: 'NOWE-1', domain: 'ANAT', difficulty: 'basic' })]);
    const filled = must(fillAwaitingReplacements(st, extended, { sessionId, expectedRevision: session(st, sessionId).revision }, clock.ctx()));
    expect(filled.value).toEqual({ filled: 1, stillAwaiting: 0 });
    st = filled.state;
    const rep = slotAt(st, sessionId, 0);
    expect(rep.questionId).toBe('NOWE-1');
    st = must(answer(st, { sessionId, expectedRevision: session(st, sessionId).revision, slotId: rep.id, optionId: rep.snapshot.correctOptionId }, clock.ctx())).state;
    expect(must(finishTest(st, { sessionId, expectedRevision: session(st, sessionId).revision }, clock.ctx())).value.result.targetN).toBe(6);
  });

  it('powtórne zgłoszenie tego samego slotu i nieaktualna rewizja są odrzucane', () => {
    const { state, sessionId, clock } = startN(3);
    const slot = slotAt(state, sessionId, 0);
    const out = report(state, sessionId, 0, clock);
    mustFail(
      reportQuestion(out.state, catalog, { sessionId, slotId: slot.id, questionId: slot.questionId, expectedRevision: session(out.state, sessionId).revision }, clock.ctx()),
      'ALREADY_REPORTED',
    );
    // Jednoczesne zgłoszenie i odpowiedź: druga komenda na starej rewizji → STALE_REVISION.
    const answeredFirst = answerCurrent(state, sessionId, clock, true);
    mustFail(reportQuestion(answeredFirst, catalog, { sessionId, slotId: slot.id, questionId: slot.questionId, expectedRevision: 1 }, clock.ctx()), 'STALE_REVISION');
    mustFail(answer(out.state, { sessionId, expectedRevision: 1, slotId: slot.id, optionId: 'A' }, clock.ctx()), 'STALE_REVISION');
    mustFail(reportQuestion(state, catalog, { sessionId, slotId: slot.id, questionId: 'INNE', expectedRevision: 1 }, clock.ctx()), 'SLOT_NOT_FOUND');
    // Pozycja jeszcze nieosiągnięta (niewyświetlona) — zgłoszenie niedostępne, nic nie zapisano.
    const later = slotAt(state, sessionId, 2);
    mustFail(reportQuestion(state, catalog, { sessionId, slotId: later.id, questionId: later.questionId, expectedRevision: 1 }, clock.ctx()), 'SLOT_NOT_IN_PLAN');
  });
});

describe('E04 — zgłoszenie w zamkniętej sesji', () => {
  it('blokuje przyszłość, nie przepisuje wyniku, oznacza „Wykluczone później”', () => {
    const { state, sessionId, clock } = startN(5);
    const done = playTest(state, sessionId, clock, (i) => i < 3);
    const before = session(done, sessionId);
    const out = report(done, sessionId, 4, clock);
    const after = session(out.state, sessionId);
    expect(after).toBe(before); // rekord sesji nietknięty
    expect(out.changeset.stores.sessions).toBeUndefined();
    expect(out.value).toMatchObject({ phase: 'after_close', undo: null, replacementSlotId: null });
    expect(summarizeSession(after)).toEqual(summarizeSession(before));
    const items = reviewItems(out.state, sessionId, 'all');
    expect(items[4]).toMatchObject({ reportedLater: true, status: 'wrong' });
    expect(items.filter((i) => i.reportedLater)).toHaveLength(1);
    const ev = out.state.events[out.value.eventId];
    expect(ev?.type === 'question_reported' && ev.reportedLaterAt).toBeTruthy();
    expect(poolFor(catalog, out.state, 'ALL', 'mixed', clock.now).questionIds).not.toContain(slotAt(done, sessionId, 4).questionId);
    mustFail(
      reportQuestion(out.state, catalog, { sessionId, slotId: slotAt(done, sessionId, 4).id, questionId: slotAt(done, sessionId, 4).questionId, expectedRevision: null }, clock.ctx()),
      'ALREADY_REPORTED',
    );
  });
});

describe('E05 — „Cofnij” i „Przywróć”', () => {
  it('Cofnij przed następną mutacją przywraca dokładnie stan i punktację sprzed zgłoszenia', () => {
    const { state, sessionId, clock } = startN(5);
    let st = answerCurrent(state, sessionId, clock, false);
    st = must(advance(st, { sessionId, expectedRevision: session(st, sessionId).revision }, clock.ctx())).state;
    st = answerCurrent(st, sessionId, clock, true);
    const pre = st;
    const preSession = session(pre, sessionId);
    const out = report(pre, sessionId, 0, clock);
    expect(isUndoValid(out.state, out.value.undo!)).toBe(true);
    // markShown zastępstwa nie unieważnia „Cofnij”.
    const shown = must(markShown(out.state, { sessionId, slotId: out.value.replacementSlotId!, }, clock.ctx())).state;
    expect(isUndoValid(shown, out.value.undo!)).toBe(true);
    const undone = must(undoReport(shown, out.value.undo!, clock.ctx()));
    const s = session(undone.state, sessionId);
    expect(s.plan).toEqual(preSession.plan);
    expect(s.slots).toEqual(preSession.slots);
    expect(s.awaitingReplacement).toEqual(preSession.awaitingReplacement);
    expect(s.reached).toBe(preSession.reached);
    expect(sessionProgress(s)).toEqual(sessionProgress(preSession));
    expect(s.revision).toBeGreaterThan(session(shown, sessionId).revision);
    expect(s.mutationSeq).toBe(session(shown, sessionId).mutationSeq + 1);
    expect(undone.state.blocks[out.value.blockId]).toBeUndefined();
    expect(undone.changeset.stores.blocks?.delete).toEqual([out.value.blockId]);
    const q0 = slotAt(pre, sessionId, 0).questionId;
    expect(undone.state.questionStats[q0]).toEqual(pre.questionStats[q0]);
    expect(undone.state.attempts).toEqual(pre.attempts);
    expect(s.events.at(-1)?.type).toBe('report_undone');
    expect(activeBlocks(undone.state)).toEqual([]);
    expect(poolFor(catalog, undone.state, 'ALL', 'mixed', clock.now).questionIds).toContain(q0);
    // Token wykorzystany — drugi raz nieważny.
    mustFail(undoReport(undone.state, out.value.undo!, clock.ctx()), 'UNDO_EXPIRED');
  });

  it('Cofnij zachowuje późniejszy nie-punktowy postęp („Dalej”) i nie cofa odpowiedzi', () => {
    const { state, sessionId, clock } = startN(5);
    let st = answerCurrent(state, sessionId, clock, true);
    st = must(advance(st, { sessionId, expectedRevision: session(st, sessionId).revision }, clock.ctx())).state;
    st = answerCurrent(st, sessionId, clock, true);
    const out = report(st, sessionId, 0, clock);
    const moved = must(advance(out.state, { sessionId, expectedRevision: session(out.state, sessionId).revision }, clock.ctx())).state;
    expect(isUndoValid(moved, out.value.undo!)).toBe(true);
    const undone = must(undoReport(moved, out.value.undo!, clock.ctx()));
    expect(session(undone.state, sessionId).reached).toBe(2);
    expect(sessionProgress(session(undone.state, sessionId)).answeredValid).toBe(2);
  });

  it('Cofnij przywraca punktację i powtórki, ale zachowuje późniejsze wyświetlenia (markShown)', () => {
    const exact = catalogOf(grid(1, { levels: ['basic'] })); // 6 rodzin — brak zastępstwa
    const { state, sessionId, clock } = startN(6, exact);
    const slot = slotAt(state, sessionId, 0);
    // Zgłoszenie przed wyświetleniem (np. markShown jeszcze nie zapisany) → pozycja czeka na zastępstwo.
    const out = report(state, sessionId, 0, clock, exact);
    expect(out.value.awaitingReplacement).toBe(true);
    const shown = must(markShown(out.state, { sessionId, slotId: slot.id }, clock.ctx()));
    expect(shown.value.firstTime).toBe(true);
    expect(isUndoValid(shown.state, out.value.undo!)).toBe(true);
    const undone = must(undoReport(shown.state, out.value.undo!, clock.ctx()));
    const restored = slotAt(undone.state, sessionId, 0);
    expect(restored.excluded).toBeNull();
    expect(restored.shownAt).not.toBeNull();
    expect(session(undone.state, sessionId).awaitingReplacement).toEqual([]);
    expect(undone.state.questionStats[slot.questionId]).toMatchObject({ seenCount: 1, answeredCount: 0, activeError: false });
  });

  it.each(['odpowiedź na zastępstwo', 'kolejne zgłoszenie', 'zamknięcie sesji'])('Cofnij wygasa po: %s', (kind) => {
    const { state, sessionId, clock } = startN(5);
    const out = report(state, sessionId, 0, clock);
    let st = out.state;
    if (kind === 'odpowiedź na zastępstwo') st = answerCurrent(st, sessionId, clock, true);
    if (kind === 'kolejne zgłoszenie') st = report(st, sessionId, 0, clock).state;
    if (kind === 'zamknięcie sesji') st = must(closeUnfinished(st, { sessionId, expectedRevision: session(st, sessionId).revision }, clock.ctx())).state;
    expect(isUndoValid(st, out.value.undo!)).toBe(false);
    mustFail(undoReport(st, out.value.undo!, clock.ctx()), 'UNDO_EXPIRED');
    if (kind === 'odpowiedź na zastępstwo') expect(slotAt(st, sessionId, 0).attempt).not.toBeNull();
  });

  it('Przywróć w ustawieniach: tylko przyszłe losowania, historia bez zmian', () => {
    const { state, sessionId, clock } = startN(5);
    const original = slotAt(state, sessionId, 0);
    const out = report(state, sessionId, 0, clock);
    const st = answerCurrent(out.state, sessionId, clock, true); // odpowiedź na zastępstwo — Cofnij wygasa
    const sessionBefore = session(st, sessionId);
    expect(activeBlocks(st).map((b) => b.id)).toEqual([out.value.blockId]);
    const restored = must(restoreBlock(st, { blockId: out.value.blockId }, clock.ctx()));
    expect(restored.state.blocks[out.value.blockId]?.revokedAt).not.toBeNull();
    expect(session(restored.state, sessionId)).toBe(sessionBefore);
    expect(slotAt(restored.state, sessionId, 0).attempt).not.toBeNull();
    expect(restored.state.sessions[sessionId]?.slots[original.id]?.excluded).not.toBeNull();
    expect(activeBlocks(restored.state)).toEqual([]);
    expect(poolFor(catalog, restored.state, 'ALL', 'mixed', clock.now).questionIds).toContain(original.questionId);
    mustFail(restoreBlock(restored.state, { blockId: out.value.blockId }, clock.ctx()), 'BLOCK_ALREADY_REVOKED');
    mustFail(restoreBlock(restored.state, { blockId: 'brak' }, clock.ctx()), 'BLOCK_NOT_FOUND');
  });
});

describe('E06 — ta sama treść pod nowym ID nadal zablokowana', () => {
  it('fingerprint blokuje kopię w paczce i w katalogu; rodzina blokuje warianty', async () => {
    const { state, sessionId, clock } = startN(3);
    const original = slotAt(state, sessionId, 0);
    const out = report(state, sessionId, 0, clock);
    const source = catalog.questionsById[original.questionId]!;
    const copy: RuntimeQuestion = {
      ...q({ id: 'KOPIA-NOWE-ID', family: 'NOWA-RODZINA', domain: source.domainId, difficulty: source.difficulty }),
      stem_pl: source.stem,
      options: source.options.map((o) => ({ id: o.id, text_pl: o.text })),
      fingerprint: source.fingerprint,
    };
    const variant = q({ id: 'WARIANT', family: source.familyId, domain: source.domainId, stem: 'Bliski wariant?' });
    // Jedyny walidator paczek (LOG-07): src/persistence/packs.ts.
    const plan = await validatePackFile(
      { ...bank([copy, variant], 'paczka-1'), questions: [copy, variant] },
      { fileName: 'p.json', packId: 'p1', now: clock.now },
      catalog,
      out.state,
    );
    expect(plan.fatal).toEqual([]);
    expect(plan.skippedBlockedIds.sort()).toEqual(['KOPIA-NOWE-ID', 'WARIANT']);
    // Gdyby kopia trafiła do katalogu (np. starszy import), pula i tak ją pomija.
    const pack: PackRecord = { ...plan.record, questions: [copy, variant] };
    const cat2 = buildCatalog({ ...bank(grid(3)) }, [pack]);
    expect(cat2.ok).toBe(true);
    if (!cat2.ok) return;
    const ids = poolFor(cat2.value, out.state, 'ALL', 'mixed', clock.now).questionIds;
    expect(ids).not.toContain('KOPIA-NOWE-ID');
    expect(ids).not.toContain('WARIANT');
  });
});

describe('Free Flow — zgłoszenie bieżącego pytania zastępuje je kolejnym', () => {
  it('bieżąca pozycja: nowy dobór na tym samym miejscu; wcześniejsza: tylko wykluczenie; Cofnij przywraca', () => {
    const clock = new Clock();
    const ff = must(startFreeFlow(emptyUserState(), catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: null, myErrorsPriority: false }, seed: 3 }, clock.ctx()));
    const sid = ff.value.sessionId;
    let st = ff.state;
    const first = slotAt(st, sid, 0);
    st = must(answer(st, { sessionId: sid, expectedRevision: 1, slotId: first.id, optionId: wrongOptionOf(first) }, clock.ctx())).state;
    st = must(nextFreeFlowSlot(st, catalog, { sessionId: sid, expectedRevision: session(st, sid).revision }, clock.ctx())).state;
    const current = slotAt(st, sid, 1);
    const out = report(st, sid, 1, clock);
    const s = session(out.state, sid);
    expect(s.plan).toHaveLength(2);
    expect(out.value.replacementSlotId).toBe(s.plan[1]);
    expect(slotAt(out.state, sid, 1).questionId).not.toBe(current.questionId);
    expect(slotAt(out.state, sid, 1).origin).toBe('replacement');
    // Cofnij → poprzednie pytanie wraca na miejsce.
    const undone = must(undoReport(out.state, out.value.undo!, clock.ctx()));
    expect(slotAt(undone.state, sid, 1).id).toBe(current.id);
    expect(session(undone.state, sid).plan).toEqual(session(st, sid).plan);
    // Zgłoszenie wcześniejszej (ocenionej) pozycji: wykluczenie bez zastępstwa, błąd nie liczy się.
    const earlier = report(st, sid, 0, clock);
    expect(earlier.value.replacementSlotId).toBeNull();
    expect(earlier.value.awaitingReplacement).toBe(false);
    expect(slotAt(earlier.state, sid, 0).excluded).not.toBeNull();
    expect(earlier.state.questionStats[first.questionId]?.activeError).toBe(false);
    expect(summarizeSession(session(earlier.state, sid)).answeredValid).toBe(0);
  });

  it('zgłoszenie poza sesją: tylko blokada; drugi raz → ALREADY_REPORTED', () => {
    const clock = new Clock();
    const out = must(reportQuestion(emptyUserState(), catalog, { sessionId: null, slotId: null, questionId: 'ANAT-bas-001', expectedRevision: null }, clock.ctx()));
    expect(out.value).toMatchObject({ phase: 'outside_session', undo: null });
    expect(Object.keys(out.state.blocks)).toHaveLength(1);
    mustFail(reportQuestion(out.state, catalog, { sessionId: null, slotId: null, questionId: 'ANAT-bas-001', expectedRevision: null }, clock.ctx()), 'ALREADY_REPORTED');
    mustFail(reportQuestion(out.state, catalog, { sessionId: null, slotId: null, questionId: 'NIE-MA', expectedRevision: null }, clock.ctx()), 'QUESTION_NOT_FOUND');
  });
});
