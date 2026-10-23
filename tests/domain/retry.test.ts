/**
 * Runda „Uwzględnij błędy” (SPECYFIKACJA §6; DECYZJE §6 pkt 1a; kryteria D01–D03).
 */
import { describe, expect, it } from 'vitest';
import {
  chartPoints,
  emptyUserState,
  previewRetryRound,
  reportQuestion,
  startRetryRound,
  startTest,
  type Catalog,
  type Session,
  type UserState,
} from '../../src/domain/api';
import { catalogOf, Clock, grid, must, mustFail, planFamilies, playTest, session } from './helpers';

const catalog = catalogOf(grid(4)); // 72 rodziny

function wrongIds(state: UserState, sessionId: string): string[] {
  const s = session(state, sessionId);
  return s.plan.flatMap((id) => {
    const slot = s.slots[id];
    return slot?.attempt && !slot.attempt.correct && !slot.excluded ? [slot.questionId] : [];
  });
}

function originsOf(s: Session): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of s.plan) {
    const o = s.slots[id]?.origin ?? '?';
    out[o] = (out[o] ?? 0) + 1;
  }
  return out;
}

function firstTest(clock: Clock, wrongCount: number, cat: Catalog = catalog) {
  const out = must(startTest(emptyUserState(), cat, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 20, myErrorsPriority: false }, seed: 21 }, clock.ctx()));
  const state = playTest(out.state, out.value.sessionId, clock, (i) => i >= wrongCount);
  return { state, sessionId: out.value.sessionId };
}

describe('D01–D02 — błędy bezpośredniego rodzica + uzupełnienia do N, bez kumulacji', () => {
  it('20 z 7 błędami → 7 + 13; potem 4 → 4 + 16; parent/chain/roundIndex spójne', () => {
    const clock = new Clock();
    const r1 = firstTest(clock, 7);
    const wrong1 = wrongIds(r1.state, r1.sessionId);
    expect(wrong1).toHaveLength(7);

    const preview = previewRetryRound(r1.state, catalog, r1.sessionId);
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.value).toMatchObject({ targetN: 20, repeatedWrong: 7, nextRoundIndex: 2, isRetry: true, insufficient: null });
      expect(preview.value.fillersUnseen + preview.value.fillersSeen).toBe(13);
    }

    const round2 = must(startRetryRound(r1.state, catalog, { sourceSessionId: r1.sessionId, seed: 22 }, clock.ctx()));
    const s2 = session(round2.state, round2.value.sessionId);
    expect(s2.config).toEqual(session(r1.state, r1.sessionId).config);
    expect(s2.plan).toHaveLength(20);
    expect(originsOf(s2)).toEqual({ repeated_wrong: 7, filler: 13 });
    const repeated = s2.plan.map((id) => s2.slots[id]!).filter((sl) => sl.origin === 'repeated_wrong');
    expect(repeated.map((sl) => sl.questionId).sort()).toEqual([...wrong1].sort());
    expect(new Set(planFamilies(round2.state, s2.id)).size).toBe(20);
    expect(s2.retry).toEqual({ sourceSessionId: r1.sessionId, retryChainId: r1.sessionId, roundIndex: 2, repeatedCount: 7 });
    expect(s2.allocation.mandatoryRepeated).toBe(7);
    // Uzupełnienia: najpierw niewidziane (72 rodziny, 20 widzianych).
    expect(s2.allocation.fillersUnseen).toBe(13);
    // Błędy wymieszane w planie (nie wszystkie na początku) — dla tego seeda.
    const positions = s2.plan.map((id, i) => (s2.slots[id]?.origin === 'repeated_wrong' ? i : -1)).filter((i) => i >= 0);
    expect(positions).not.toEqual([0, 1, 2, 3, 4, 5, 6]);
    // Każdy snapshot spójny z zapisaną kolejnością opcji.
    for (const sl of repeated) expect(sl.snapshot.options.map((o) => o.id)).toEqual(sl.optionOrder);

    // Runda 2: 4 błędy (2 powtórzone + 2 uzupełnienia).
    const repeatedIds = new Set(repeated.map((sl) => sl.questionId));
    let rep = 0;
    let fil = 0;
    const state2 = playTest(round2.state, s2.id, clock, (_i, slot) => {
      if (repeatedIds.has(slot.questionId) && rep < 2) return (rep++, false);
      if (!repeatedIds.has(slot.questionId) && fil < 2) return (fil++, false);
      return true;
    });
    const wrong2 = wrongIds(state2, s2.id);
    expect(wrong2).toHaveLength(4);

    const round3 = must(startRetryRound(state2, catalog, { sourceSessionId: s2.id, seed: 23 }, clock.ctx()));
    const s3 = session(round3.state, round3.value.sessionId);
    expect(originsOf(s3)).toEqual({ repeated_wrong: 4, filler: 16 });
    expect(
      s3.plan
        .map((id) => s3.slots[id]!)
        .filter((sl) => sl.origin === 'repeated_wrong')
        .map((sl) => sl.questionId)
        .sort(),
    ).toEqual([...wrong2].sort());
    expect(s3.retry).toEqual({ sourceSessionId: s2.id, retryChainId: r1.sessionId, roundIndex: 3, repeatedCount: 4 });

    // Wykres oznacza powtórki.
    const done3 = playTest(round3.state, s3.id, clock, () => true);
    const points = chartPoints(done3, { kind: 'all' });
    expect(points.map((p) => [p.isRetry, p.roundIndex])).toEqual([
      [false, null],
      [true, 2],
      [true, 3],
    ]);
  });
});

describe('D03 — zero błędów, zgłoszone później, ten sam obowiązkowy błąd', () => {
  it('rodzic bezbłędny → N uzupełniających, powiązanie z rodzicem (D02), bez oznaczenia Powtórka', () => {
    const clock = new Clock();
    const r1 = firstTest(clock, 0);
    const preview = previewRetryRound(r1.state, catalog, r1.sessionId);
    expect(preview.ok && preview.value.isRetry).toBe(false);
    expect(preview.ok && preview.value.repeatedWrong).toBe(0);
    expect(preview.ok && preview.value.nextRoundIndex).toBe(2);
    const next = must(startRetryRound(r1.state, catalog, { sourceSessionId: r1.sessionId, seed: 5 }, clock.ctx()));
    const s = session(next.state, next.value.sessionId);
    // SPECYFIKACJA §6: każda runda ma parent i numer w łańcuchu — także bez błędów rodzica.
    expect(s.retry).toEqual({ sourceSessionId: r1.sessionId, retryChainId: r1.sessionId, roundIndex: 2, repeatedCount: 0 });
    expect(originsOf(s)).toEqual({ filler: 20 });
    expect(s.allocation.fillersUnseen).toBe(20);
    // Wykres: runda bez błędów rodzica nie jest powtórką (bez ◆), ale niesie numer rundy.
    const done = playTest(next.state, s.id, clock, () => true);
    expect(chartPoints(done, { kind: 'all' }).map((p) => [p.sessionId, p.isRetry, p.roundIndex])).toEqual([
      [r1.sessionId, false, null],
      [s.id, false, 2],
    ]);
    // Łańcuch trwa: kolejna runda po niej ma ten sam łańcuch i numer 3.
    const third = must(startRetryRound(done, catalog, { sourceSessionId: s.id, seed: 6 }, clock.ctx()));
    expect(session(third.state, third.value.sessionId).retry).toEqual({ sourceSessionId: s.id, retryChainId: r1.sessionId, roundIndex: 3, repeatedCount: 0 });
  });

  it('wszystkie błędy rodzica zgłoszone → runda bez powtórzeń, ale z powiązaniem (repeatedCount 0)', () => {
    const clock = new Clock();
    const r1 = firstTest(clock, 2);
    let state = r1.state;
    const parent = session(state, r1.sessionId);
    for (const slotId of parent.plan) {
      const slot = parent.slots[slotId];
      if (!slot?.attempt || slot.attempt.correct) continue;
      state = must(reportQuestion(state, catalog, { sessionId: parent.id, slotId, questionId: slot.questionId, expectedRevision: null }, clock.ctx())).state;
    }
    const next = must(startRetryRound(state, catalog, { sourceSessionId: r1.sessionId, seed: 9 }, clock.ctx()));
    const s = session(next.state, next.value.sessionId);
    expect(s.retry).toEqual({ sourceSessionId: r1.sessionId, retryChainId: r1.sessionId, roundIndex: 2, repeatedCount: 0 });
    expect(originsOf(s)).toEqual({ filler: 20 });
  });

  it('błędne później zgłoszone (w przeglądzie zamkniętego testu) nie wracają', () => {
    const clock = new Clock();
    const r1 = firstTest(clock, 7);
    let st = r1.state;
    const s1 = session(st, r1.sessionId);
    const wrongSlots = s1.plan.map((id) => s1.slots[id]!).filter((sl) => sl.attempt && !sl.attempt.correct);
    for (const sl of wrongSlots.slice(0, 2)) {
      st = must(reportQuestion(st, catalog, { sessionId: s1.id, slotId: sl.id, questionId: sl.questionId, expectedRevision: null }, clock.ctx())).state;
    }
    const next = must(startRetryRound(st, catalog, { sourceSessionId: s1.id, seed: 8 }, clock.ctx()));
    const s = session(next.state, next.value.sessionId);
    expect(originsOf(s)).toEqual({ repeated_wrong: 5, filler: 15 });
    const reportedIds = new Set(wrongSlots.slice(0, 2).map((sl) => sl.questionId));
    expect(s.plan.some((id) => reportedIds.has(s.slots[id]!.questionId))).toBe(false);
  });

  it('obowiązkowy błąd = to samo pytanie; bieżąca rewizja z katalogu, a gdy pytania brak — snapshot rodzica', () => {
    const clock = new Clock();
    const r1 = firstTest(clock, 3);
    const s1 = session(r1.state, r1.sessionId);
    const wrongSlots = s1.plan.map((id) => s1.slots[id]!).filter((sl) => sl.attempt && !sl.attempt.correct);
    const removed = wrongSlots[0]!.questionId;
    const revised = wrongSlots[1]!.questionId;
    // Nowy katalog: jedno pytanie usunięte, jedno z rewizją 2 (inna treść), reszta bez zmian.
    const questions = grid(4)
      .filter((x) => x.id !== removed)
      .map((x) => (x.id === revised ? { ...x, revision: 2, stem_pl: `${x.stem_pl} (wersja 2)` } : x));
    const catalog2 = catalogOf(questions);
    const next = must(startRetryRound(r1.state, catalog2, { sourceSessionId: r1.sessionId, seed: 9 }, clock.ctx()));
    const s = session(next.state, next.value.sessionId);
    const rep = s.plan.map((id) => s.slots[id]!).filter((sl) => sl.origin === 'repeated_wrong');
    expect(rep.map((sl) => sl.questionId).sort()).toEqual(wrongSlots.map((sl) => sl.questionId).sort());
    const fromSnapshot = rep.find((sl) => sl.questionId === removed)!;
    expect(fromSnapshot.snapshot.stem).toBe(wrongSlots[0]!.snapshot.stem);
    expect(fromSnapshot.snapshot.options.map((o) => o.id)).toEqual(fromSnapshot.optionOrder);
    const fromCatalog = rep.find((sl) => sl.questionId === revised)!;
    expect(fromCatalog.snapshot.revision).toBe(2);
    expect(fromCatalog.snapshot.stem.endsWith('(wersja 2)')).toBe(true);
    // Żadne uzupełnienie nie pochodzi z rodziny obowiązkowej.
    expect(new Set(planFamilies(next.state, s.id)).size).toBe(20);
  });

  it('tylko ukończony test może mieć rundę; za mało rodzin → INSUFFICIENT_CAPACITY z pojemnością', () => {
    const clock = new Clock();
    const small = catalogOf(grid(1, { levels: ['basic'] }).concat(grid(3, { domains: ['DEV'], levels: ['advanced'], prefix: 'X' }))); // 6 + 3 = 9 rodzin
    const out = must(startTest(emptyUserState(), small, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 9, myErrorsPriority: false }, seed: 2 }, clock.ctx()));
    mustFail(previewRetryRound(out.state, small, out.value.sessionId), 'NOT_RETRYABLE');
    mustFail(startRetryRound(out.state, small, { sourceSessionId: out.value.sessionId, seed: 1 }, clock.ctx()), 'NOT_RETRYABLE');
    mustFail(startRetryRound(out.state, small, { sourceSessionId: 'brak', seed: 1 }, clock.ctx()), 'SESSION_NOT_FOUND');
    const done = playTest(out.state, out.value.sessionId, clock, (i) => i > 1);
    // Zablokuj jedną z poprawnych rodzin → zostaje 8 rodzin < 9.
    const s = session(done, out.value.sessionId);
    const correctSlot = s.plan.map((id) => s.slots[id]!).find((sl) => sl.attempt?.correct)!;
    const blocked = must(reportQuestion(done, small, { sessionId: s.id, slotId: correctSlot.id, questionId: correctSlot.questionId, expectedRevision: null }, clock.ctx())).state;
    const preview = previewRetryRound(blocked, small, s.id);
    expect(preview.ok && preview.value.insufficient).toEqual({ capacity: 8 });
    const r = startRetryRound(blocked, small, { sourceSessionId: s.id, seed: 3 }, clock.ctx());
    mustFail(r, 'INSUFFICIENT_CAPACITY');
    if (!r.ok) expect(r.error.details?.capacity).toBe(8);
  });
});
