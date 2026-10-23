/**
 * Pula, pojemność i walidacja N (DECYZJE §5; kryteria C01, D07, E01).
 */
import { describe, expect, it } from 'vitest';
import {
  capacityFor,
  emptyUserState,
  initialFreeFlowConfig,
  initialTestConfig,
  isQuestionBlocked,
  poolFor,
  startTest,
  stepTestN,
  validateTestN,
  QUICK_N_VALUES,
  type Block,
  type UserState,
} from '../../src/domain/api';
import { catalogOf, Clock, grid, must, mustFail, q } from './helpers';

describe('C01 — walidacja N (1…pojemność)', () => {
  const cap = 46;
  it.each<[string | number, string]>([
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    ['0', 'TOO_SMALL'],
    [0, 'TOO_SMALL'],
    ['-0', 'TOO_SMALL'],
    ['-5', 'TOO_SMALL'],
    [-5, 'TOO_SMALL'],
    ['−5', 'TOO_SMALL'],
    ['2.5', 'NOT_INTEGER'],
    ['2,5', 'NOT_INTEGER'],
    [2.5, 'NOT_INTEGER'],
    [Number.NaN, 'NOT_INTEGER'],
    ['NaN', 'NOT_INTEGER'],
    [Number.POSITIVE_INFINITY, 'NOT_INTEGER'],
    ['1e3', 'NOT_INTEGER'],
    ['abc', 'NOT_INTEGER'],
    ['2 0', 'NOT_INTEGER'],
    ['47', 'EXCEEDS_CAPACITY'],
    [47, 'EXCEEDS_CAPACITY'],
    ['99999999999999999999999', 'EXCEEDS_CAPACITY'],
  ])('%j → %s', (raw, code) => {
    const v = validateTestN(raw, cap);
    expect(v).toEqual({ ok: false, code, capacity: cap });
  });

  it.each<[string | number, number]>([
    ['1', 1],
    [1, 1],
    ['20', 20],
    [' 20 ', 20],
    ['020', 20],
    ['+30', 30],
    [46, 46],
  ])('%j → dozwolone %i', (raw, n) => {
    expect(validateTestN(raw, cap)).toEqual({ ok: true, n });
  });

  it('pusta pula → EMPTY_POOL niezależnie od wpisu', () => {
    expect(validateTestN('20', 0)).toEqual({ ok: false, code: 'EMPTY_POOL', capacity: 0 });
    expect(validateTestN('', 0)).toEqual({ ok: false, code: 'EMPTY_POOL', capacity: 0 });
  });

  it('szybkie wartości 20/30/40/50/60 przy pojemności 46: 50 i 60 niedozwolone', () => {
    const allowed = QUICK_N_VALUES.map((n) => validateTestN(n, cap).ok);
    expect(allowed).toEqual([true, true, true, false, false]);
  });

  it('±10 nie ustawia wartości niedozwolonej (granice)', () => {
    expect(stepTestN('20', 10, cap)).toBe(30);
    expect(stepTestN('36', 10, cap)).toBe(46);
    expect(stepTestN('37', 10, cap)).toBeNull();
    expect(stepTestN('40', 10, cap)).toBeNull();
    expect(stepTestN('11', -10, cap)).toBe(1);
    expect(stepTestN('10', -10, cap)).toBeNull();
    expect(stepTestN('5', -10, cap)).toBeNull();
    expect(stepTestN('', 10, cap)).toBe(10);
    expect(stepTestN('', -10, cap)).toBeNull();
    expect(stepTestN('2.5', 10, cap)).toBeNull();
    expect(stepTestN('abc', -10, cap)).toBeNull();
    expect(stepTestN('60', -10, cap)).toBeNull(); // 50 > 46
    expect(stepTestN('20', 10, 0)).toBeNull();
    for (let n = 1; n <= cap; n++) {
      for (const d of [-10, 10]) {
        const next = stepTestN(String(n), d, cap);
        if (next !== null) expect(validateTestN(next, cap).ok).toBe(true);
      }
    }
  });

  it('pierwsze uruchomienie: 20 / mieszany / cały zakres; potem ostatnia jawna konfiguracja', () => {
    const st = emptyUserState();
    expect(initialTestConfig(st.settings)).toEqual({ scope: 'ALL', difficulty: 'mixed', targetN: 20, myErrorsPriority: false });
    expect(initialFreeFlowConfig(st.settings)).toEqual({ scope: 'ALL', difficulty: 'mixed', targetN: null, myErrorsPriority: false });
    const catalog = catalogOf(grid(3));
    const clock = new Clock();
    const out = must(startTest(st, catalog, { config: { scope: 'INJ', difficulty: 'basic', targetN: 2, myErrorsPriority: true }, seed: 1 }, clock.ctx()));
    expect(initialTestConfig(out.state.settings)).toEqual({ scope: 'INJ', difficulty: 'basic', targetN: 2, myErrorsPriority: true });
    expect(out.changeset.stores.settings?.put).toHaveLength(1);
  });

  it('startTest odrzuca niedozwolone N i nie zapisuje niczego', () => {
    const catalog = catalogOf(grid(1)); // 18 rodzin
    const clock = new Clock();
    const st = emptyUserState();
    for (const n of [0, -1, 2.5, Number.NaN, null]) {
      const r = startTest(st, catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: n, myErrorsPriority: false }, seed: 1 }, clock.ctx());
      mustFail(r, 'INVALID_N');
    }
    const over = startTest(st, catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 19, myErrorsPriority: false }, seed: 1 }, clock.ctx());
    mustFail(over, 'N_EXCEEDS_CAPACITY');
    if (!over.ok) expect(over.error.details?.capacity).toBe(18);
    const empty = startTest(st, catalogOf([]), { config: { scope: 'ALL', difficulty: 'mixed', targetN: 1, myErrorsPriority: false }, seed: 1 }, clock.ctx());
    mustFail(empty, 'EMPTY_POOL');
    const badCfg = startTest(st, catalog, { config: { scope: 'XYZ' as never, difficulty: 'mixed', targetN: 1, myErrorsPriority: false }, seed: 1 }, clock.ctx());
    mustFail(badCfg, 'INVALID_CONFIG');
  });
});

describe('pojemność = liczba rodzin w puli po zakresie, trudności i blokadach', () => {
  const questions = [
    q({ id: 'A1', domain: 'ANAT', difficulty: 'basic', family: 'F1', topic: 'ANAT-T1' }),
    q({ id: 'A2', domain: 'ANAT', difficulty: 'intermediate', family: 'F1', topic: 'ANAT-T1' }),
    q({ id: 'A3', domain: 'ANAT', difficulty: 'advanced', family: 'F3', topic: 'ANAT-T1' }),
    q({ id: 'I1', domain: 'INJ', difficulty: 'basic', family: 'F4' }),
  ];
  const catalog = catalogOf(questions);

  it('liczy rodziny, nie rekordy', () => {
    const st = emptyUserState();
    expect(capacityFor(catalog, st, 'ALL', 'mixed')).toBe(3);
    expect(capacityFor(catalog, st, 'ANAT', 'mixed')).toBe(2);
    expect(capacityFor(catalog, st, 'ANAT', 'basic')).toBe(1);
    expect(capacityFor(catalog, st, 'SKIN', 'mixed')).toBe(0);
    const info = poolFor(catalog, st, 'ALL', 'mixed', '2026-10-22T10:00:00.000Z');
    expect(info).toMatchObject({ capacity: 3, unseenFamilies: 3, activeErrors: 0 });
    expect(info.questionIds).toEqual(['A1', 'A2', 'A3', 'I1']);
  });

  function block(over: Partial<Block>): Block {
    return {
      id: 'b1',
      questionId: 'X',
      revision: 1,
      fingerprint: 'f'.repeat(64),
      familyId: 'FX',
      domainId: 'ANAT',
      stemPreview: '',
      reason: 'reported',
      createdAt: '2026-10-22T10:00:00.000Z',
      sessionId: null,
      slotId: null,
      eventId: 'e1',
      revokedAt: null,
      ...over,
    };
  }

  it('E01: blokada po ID, fingerprincie albo rodzinie — nie po temacie', () => {
    const a1 = catalog.questionsById.A1!;
    const a3 = catalog.questionsById.A3!;
    expect(isQuestionBlocked(a1, { b1: block({ questionId: 'A1' }) })).toBe(true);
    expect(isQuestionBlocked(a1, { b1: block({ fingerprint: a1.fingerprint }) })).toBe(true);
    expect(isQuestionBlocked(a1, { b1: block({ familyId: 'F1' }) })).toBe(true);
    expect(isQuestionBlocked(a1, { b1: block({ questionId: 'A1', revokedAt: '2026-10-23T10:00:00.000Z' }) })).toBe(false);
    // Ten sam temat (ANAT-T1), inna rodzina → nie zablokowane.
    expect(isQuestionBlocked(a3, { b1: block({ questionId: 'A1', fingerprint: a1.fingerprint, familyId: 'F1' }) })).toBe(false);
    const st: UserState = { ...emptyUserState(), blocks: { b1: block({ questionId: 'A1', fingerprint: a1.fingerprint, familyId: 'F1' }) } };
    expect(capacityFor(catalog, st, 'ANAT', 'mixed')).toBe(1);
    expect(poolFor(catalog, st, 'ANAT', 'mixed', '2026-10-22T10:00:00.000Z').questionIds).toEqual(['A3']);
  });
});
