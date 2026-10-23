/**
 * Test dymny silnika na rzeczywistym `public/data/bank.json`. Liczby czytane z pliku — test nie zakłada
 * konkretnej liczebności puli (seed dziś, docelowo większa pula).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCatalog,
  capacityFor,
  emptyUserState,
  endFreeFlow,
  parseRuntimeBank,
  poolFor,
  previewRetryRound,
  startRetryRound,
  startTest,
  validateTestN,
  type DomainId,
} from '../../src/domain/api';
import { Clock, DOMAIN_IDS, must, playTest, planFamilies, session } from './helpers';
import { answer, markShown, nextFreeFlowSlot, startFreeFlow } from '../../src/domain/api';
import { slotAt } from './helpers';

const raw: unknown = JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/bank.json'), 'utf-8'));

describe('rzeczywisty bank.json', () => {
  const parsed = parseRuntimeBank(raw);
  it('przechodzi kontrolę formatu i buduje katalog bez odrzuceń', () => {
    expect(parsed.ok).toBe(true);
  });
  if (!parsed.ok) return;
  const bank = parsed.value;
  const built = buildCatalog(bank, []);
  if (!built.ok) throw new Error(built.error.messagePl);
  const catalog = built.value;
  const families = new Set(bank.questions.map((q) => q.family_id)).size;

  it('liczebności z pliku (bez fałszywych liczników)', () => {
    expect(catalog.issues).toEqual([]);
    expect(catalog.questions).toHaveLength(bank.questions.length);
    expect(catalog.questions).toHaveLength(bank.counts.questions);
    expect(capacityFor(catalog, emptyUserState(), 'ALL', 'mixed')).toBe(families);
    expect(families).toBe(bank.counts.families);
    expect(catalog.clinicalSignoff).toBe(false);
    for (const d of DOMAIN_IDS) expect(capacityFor(catalog, emptyUserState(), d, 'mixed')).toBeGreaterThan(0);
    const info = poolFor(catalog, emptyUserState(), 'ALL', 'mixed', '2026-10-22T10:00:00.000Z');
    expect(info.unseenFamilies).toBe(families);
    expect(validateTestN(families + 1, info.capacity).ok).toBe(false);
    expect(validateTestN(families, info.capacity).ok).toBe(true);
  });

  it('domyślny test 20/mixed/ALL: równy przekrój domen, unikalne rodziny; runda z błędami', () => {
    const clock = new Clock();
    const out = must(startTest(emptyUserState(), catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: 20, myErrorsPriority: false }, seed: 2026 }, clock.ctx()));
    const s = session(out.state, out.value.sessionId);
    expect(s.plan).toHaveLength(20);
    expect(new Set(planFamilies(out.state, s.id)).size).toBe(20);
    expect(s.allocation.domainActual).toEqual({ ANAT: 4, INJ: 4, SKIN: 3, THER: 3, DEV: 3, SAFE: 3 });
    for (const id of s.plan) {
      const slot = s.slots[id]!;
      expect(slot.snapshot.sources.length).toBeGreaterThan(0);
      expect(slot.snapshot.sources.every((src) => src.url === null || src.url.startsWith('https://'))).toBe(true);
      expect(slot.snapshot.options.map((o) => o.id)).toEqual(slot.optionOrder);
      expect(slot.snapshot.approvedForQuestionKey).toBe(false);
    }
    const done = playTest(out.state, s.id, clock, (i) => i % 4 !== 0);
    expect(session(done, s.id).result).toMatchObject({ correct: 15, targetN: 20, passed: true, percent: 75 });
    const preview = previewRetryRound(done, catalog, s.id);
    expect(preview.ok && preview.value.repeatedWrong).toBe(5);
    const round = must(startRetryRound(done, catalog, { sourceSessionId: s.id, seed: 7 }, clock.ctx()));
    const r = session(round.state, round.value.sessionId);
    expect(r.plan.filter((id) => r.slots[id]?.origin === 'repeated_wrong')).toHaveLength(5);
    expect(new Set(planFamilies(round.state, r.id)).size).toBe(20);
  });

  it('każda domena solo: test na pełną pojemność domeny', () => {
    for (const d of DOMAIN_IDS) {
      const cap = capacityFor(catalog, emptyUserState(), d as DomainId, 'mixed');
      const out = must(startTest(emptyUserState(), catalog, { config: { scope: d, difficulty: 'mixed', targetN: cap, myErrorsPriority: false }, seed: 1 }, new Clock().ctx()));
      const s = session(out.state, out.value.sessionId);
      expect(s.plan).toHaveLength(cap);
      expect(s.plan.every((id) => s.slots[id]?.snapshot.domainId === d)).toBe(true);
    }
  });

  it('Free Flow: 60 pytań bez błędu, preferencja DEV, zakończenie', () => {
    const clock = new Clock();
    const ff = must(startFreeFlow(emptyUserState(), catalog, { config: { scope: 'ALL', difficulty: 'mixed', targetN: null, myErrorsPriority: false }, seed: 99 }, clock.ctx()));
    let st = ff.state;
    const sid = ff.value.sessionId;
    const domains: string[] = [];
    for (let i = 0; i < 60; i++) {
      const slot = slotAt(st, sid, session(st, sid).reached);
      domains.push(slot.snapshot.domainId);
      st = must(markShown(st, { sessionId: sid, slotId: slot.id }, clock.ctx())).state;
      st = must(answer(st, { sessionId: sid, expectedRevision: session(st, sid).revision, slotId: slot.id, optionId: slot.snapshot.correctOptionId }, clock.ctx())).state;
      st = must(nextFreeFlowSlot(st, catalog, { sessionId: sid, expectedRevision: session(st, sid).revision }, clock.ctx())).state;
    }
    const dev = domains.filter((d) => d === 'DEV').length / domains.length;
    expect(dev).toBeGreaterThan(0.3);
    expect(new Set(domains).size).toBe(6);
    const ended = must(endFreeFlow(st, { sessionId: sid, expectedRevision: session(st, sid).revision }, clock.ctx()));
    expect(ended.value.summary).toMatchObject({ answeredValid: 60, correct: 60, passed: null });
  });
});
