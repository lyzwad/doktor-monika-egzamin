/**
 * Test dymny silnika na rzeczywistym banku V18 (`public/data/bank-<sha12>.json` + retired_question_ids +
 * training_profile): profil treningowy 35/25/40 (TEST_POLICY_V3, FREE_FLOW_POLICY_V3), zakres jednej domeny bez
 * profilu, test o maksymalnym N. Plik i katalog (700 rekordów 1:1 z paczką) — tests/domain/bank-v18.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  answer,
  capacityFor,
  CONTENT_RELEASE,
  emptyUserState,
  endFreeFlow,
  markShown,
  nextFreeFlowSlot,
  previewRetryRound,
  startFreeFlow,
  startRetryRound,
  startTest,
  type DomainId,
  type UserState,
} from '../../src/domain/api';
import { largestRemainderQuotas } from '../../src/domain/testPolicy';
import { PROFILE, PROFILE_RAW, RETIRED_IDS, currentCatalog } from '../content';
import { Clock, DOMAIN_IDS, must, playTest, planFamilies, session, slotAt } from './helpers';

const catalog = currentCatalog();
const groupOf = (id: string): string => PROFILE.groupOf[id] ?? '?';

describe('TEST_POLICY_V3 — profil treningowy 35/25/40 (metoda największych reszt)', () => {
  it('kwoty: 20 → 7+5+8, 30 → 11+7+12, 40 → 14+10+16, 50 → 18+12+20, 60 → 21+15+24, 1–3', () => {
    const q = (n: number) => Object.fromEntries(largestRemainderQuotas(n, PROFILE.groupOrder, PROFILE.weightsBp));
    expect(PROFILE.weightsBp).toEqual({ skin: 3500, facial_anatomy: 2500, other: 4000 });
    expect(q(20)).toEqual({ skin: 7, facial_anatomy: 5, other: 8 });
    // Przykład z pliku profilu (example_20_question_test).
    expect(q(20)).toEqual((PROFILE_RAW as unknown as { example_20_question_test: Record<string, number> }).example_20_question_test);
    expect(q(30)).toEqual({ skin: 11, facial_anatomy: 7, other: 12 });
    expect(q(40)).toEqual({ skin: 14, facial_anatomy: 10, other: 16 });
    expect(q(50)).toEqual({ skin: 18, facial_anatomy: 12, other: 20 });
    expect(q(60)).toEqual({ skin: 21, facial_anatomy: 15, other: 24 });
    expect(q(1)).toEqual({ skin: 0, facial_anatomy: 0, other: 1 });
    expect(q(2)).toEqual({ skin: 1, facial_anatomy: 0, other: 1 });
    expect(q(3)).toEqual({ skin: 1, facial_anatomy: 1, other: 1 });
  });

  it.each([1, 2, 3, 20, 30, 40, 50, 60])('Test %i/mixed/ALL: grupy wg profilu, unikalne rodziny i ID, tylko V18, bez wyłączonych', (n) => {
    const out = must(startTest(emptyUserState(), catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: n, myErrorsPriority: false }, seed: 2026 + n }, new Clock().ctx()));
    const s = session(out.state, out.value.sessionId);
    expect(s.allocation.policy).toBe('TEST_POLICY_V3');
    const expected = Object.fromEntries([...largestRemainderQuotas(n, PROFILE.groupOrder, PROFILE.weightsBp)].filter(([, v]) => v > 0));
    const actual: Record<string, number> = {};
    for (const id of s.plan) {
      const g = groupOf(s.slots[id]!.questionId);
      actual[g] = (actual[g] ?? 0) + 1;
    }
    expect(actual).toEqual(expected);
    expect(s.allocation.profile?.groupTargets).toEqual(Object.fromEntries(largestRemainderQuotas(n, PROFILE.groupOrder, PROFILE.weightsBp)));
    expect(s.allocation.profile?.redistributed).toEqual([]);
    expect(new Set(planFamilies(out.state, s.id)).size).toBe(n);
    expect(new Set(s.plan.map((id) => s.slots[id]!.questionId)).size).toBe(n);
    const retired = new Set(RETIRED_IDS);
    for (const id of s.plan) {
      const slot = s.slots[id]!;
      expect(retired.has(slot.questionId)).toBe(false);
      expect(slot.snapshot.bankVersion).toBe(CONTENT_RELEASE.bankVersion);
      expect(slot.snapshot.fingerprint).toBe(catalog.questionsById[slot.questionId]?.fingerprint);
    }
  });

  it('poziom mixed w grupie: równy podział poziomów (20 → skin 7 = 3+2+2 w dowolnej kolejności rotacji)', () => {
    const out = must(startTest(emptyUserState(), catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 20, myErrorsPriority: false }, seed: 5 }, new Clock().ctx()));
    const cells = session(out.state, out.value.sessionId).allocation.profile?.cells ?? [];
    const skin = cells.filter((c) => c.group === 'skin').map((c) => c.target).sort();
    expect(skin).toEqual([2, 2, 3]);
    expect(cells.every((c) => c.actual === c.target)).toBe(true);
  });

  it('niedobór pojemności grupy → redystrybucja na pozostałe grupy z zapisem, bez duplikatów; N = pojemność obejmuje każdą rodzinę', () => {
    // Bank V18: skin 160 i facial_anatomy 141 rodzin < kwot 242 i 173 przy N = 692 (wszystkie rodziny) → przesunięcie na „other”.
    const cap = (g: string) => new Set(catalog.questions.filter((q) => groupOf(q.id) === g).map((q) => q.familyId)).size;
    expect([cap('skin'), cap('facial_anatomy'), cap('other')]).toEqual([160, 141, 391]);
    const n = capacityFor(catalog, emptyUserState(), 'ALL', 'mixed');
    expect(n).toBe(692);
    const quotas = largestRemainderQuotas(n, PROFILE.groupOrder, PROFILE.weightsBp);
    const out = must(startTest(emptyUserState(), catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: n, myErrorsPriority: false }, seed: 9 }, new Clock().ctx()));
    const s = session(out.state, out.value.sessionId);
    expect(s.plan).toHaveLength(n);
    expect(new Set(planFamilies(out.state, s.id)).size).toBe(n);
    expect(new Set(s.plan.map((id) => s.slots[id]!.questionId)).size).toBe(n);
    const actual = s.allocation.profile?.groupActual ?? {};
    expect(actual).toEqual({ skin: 160, facial_anatomy: 141, other: 391 });
    const short = PROFILE.groupOrder.filter((g) => cap(g) < (quotas.get(g) ?? 0));
    expect(short).toEqual(['skin', 'facial_anatomy']);
    const moved = (s.allocation.profile?.redistributed ?? []).filter((r) => r.kind === 'group');
    expect(moved.every((r) => r.reason === 'supply' && r.toGroup === 'other')).toBe(true);
    expect(moved.reduce((a, r) => a + r.count, 0)).toBe((quotas.get('skin') ?? 0) - 160 + (quotas.get('facial_anatomy') ?? 0) - 141);
  });

  it('zakres jednej domeny: bez profilu (przydział domenowy jak V2), polityka V3', () => {
    for (const d of DOMAIN_IDS) {
      const out = must(startTest(emptyUserState(), catalog, { config: { scope: d as DomainId, difficulty: 'mixed', targetN: 20, myErrorsPriority: false }, seed: 1 }, new Clock().ctx()));
      const s = session(out.state, out.value.sessionId);
      expect(s.plan).toHaveLength(20);
      expect(s.allocation.profile).toBeUndefined();
      expect(s.allocation.domainActual).toEqual({ [d]: 20 });
      expect(s.plan.every((id) => s.slots[id]?.snapshot.domainId === d)).toBe(true);
    }
  });

  it('Moje błędy jako priorytet i runda błędów działają w profilu (bez duplikatów)', () => {
    const clock = new Clock();
    const out = must(startTest(emptyUserState(), catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 20, myErrorsPriority: false }, seed: 2026 }, clock.ctx()));
    const s = session(out.state, out.value.sessionId);
    const done = playTest(out.state, s.id, clock, (i) => i % 4 !== 0);
    expect(session(done, s.id).result).toMatchObject({ correct: 15, targetN: 20, passed: true, percent: 75 });
    const preview = previewRetryRound(done, catalog, s.id);
    expect(preview.ok && preview.value.repeatedWrong).toBe(5);
    const round = must(startRetryRound(done, catalog, { sourceSessionId: s.id, seed: 7 }, clock.ctx()));
    const r = session(round.state, round.value.sessionId);
    expect(r.allocation.policy).toBe('TEST_POLICY_V3');
    expect(r.plan.filter((id) => r.slots[id]?.origin === 'repeated_wrong')).toHaveLength(5);
    expect(new Set(planFamilies(round.state, r.id)).size).toBe(20);
    const mine = must(startTest(done, catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 20, myErrorsPriority: true }, seed: 11 }, clock.ctx()));
    const m = session(mine.state, mine.value.sessionId);
    expect(m.plan.filter((id) => m.slots[id]?.origin === 'my_errors')).toHaveLength(5);
    expect(new Set(planFamilies(mine.state, m.id)).size).toBe(20);
  });
});

describe('FREE_FLOW_POLICY_V3 — wagi grup profilu (zamiast DEV 40%)', () => {
  it('cały zakres: 100 pytań ≈ 35/25/40 wg grup; adaptacja z podłogą; zakończenie', () => {
    const clock = new Clock();
    const ff = must(startFreeFlow(emptyUserState(), catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: null, myErrorsPriority: false }, seed: 99 }, clock.ctx()));
    let st: UserState = ff.state;
    const sid = ff.value.sessionId;
    expect(session(st, sid).allocation.policy).toBe('FREE_FLOW_POLICY_V3');
    const groups: string[] = [];
    for (let i = 0; i < 100; i++) {
      const slot = slotAt(st, sid, session(st, sid).reached);
      groups.push(groupOf(slot.questionId));
      expect(RETIRED_IDS.includes(slot.questionId)).toBe(false);
      st = must(markShown(st, { sessionId: sid, slotId: slot.id }, clock.ctx())).state;
      st = must(answer(st, { sessionId: sid, expectedRevision: session(st, sid).revision, slotId: slot.id, optionId: slot.snapshot.correctOptionId }, clock.ctx())).state;
      st = must(nextFreeFlowSlot(st, catalog, { sessionId: sid, expectedRevision: session(st, sid).revision }, clock.ctx())).state;
    }
    const share = (g: string) => groups.filter((x) => x === g).length;
    // Bezbłędna sesja: brak różnic błędów między grupami → wagi bazowe; deficyt daje udziały co do 1 pytania.
    expect(Math.abs(share('skin') - 35)).toBeLessThanOrEqual(1);
    expect(Math.abs(share('facial_anatomy') - 25)).toBeLessThanOrEqual(1);
    expect(Math.abs(share('other') - 40)).toBeLessThanOrEqual(1);
    const w = session(st, sid).allocation.profile?.freeFlowWeights ?? {};
    expect(Object.values(w).reduce<number>((a, b) => a + (b ?? 0), 0)).toBeCloseTo(1, 9);
    for (const g of PROFILE.groupOrder) expect(w[g] ?? 0).toBeGreaterThanOrEqual(0.05);
    const ended = must(endFreeFlow(st, { sessionId: sid, expectedRevision: session(st, sid).revision }, clock.ctx()));
    expect(ended.value.summary).toMatchObject({ answeredValid: 100, correct: 100, passed: null });
  });

  it('zakres jednej domeny: tylko ta domena, bez profilu', () => {
    const clock = new Clock();
    const ff = must(startFreeFlow(emptyUserState(), catalog, { config: { scope: 'SKIN', difficulty: 'mixed', targetN: null, myErrorsPriority: false }, seed: 4 }, clock.ctx()));
    const s = session(ff.state, ff.value.sessionId);
    expect(s.allocation.profile).toBeUndefined();
    expect(slotAt(ff.state, s.id, 0).snapshot.domainId).toBe('SKIN');
  });
});
