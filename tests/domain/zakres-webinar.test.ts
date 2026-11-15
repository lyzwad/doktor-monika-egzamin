/**
 * Zakres „Webinar” (CAP-8, decyzja Dominika 15.11; story 5 spec-webinary-247) na rzeczywistym wydaniu „V18 + webinary”:
 * pula = 247 pytań z `webinarEvidence` (ID `WB-`), Test i Free Flow bez profilu treningowego i bez wag DEV 0,40 — dziedziny
 * pytań WB dzielą miejsca proporcjonalnie do swojej podaży (DEV 118, SAFE 47, SKIN 36, INJ 26, THER 14, ANAT 6).
 * „Moje błędy”, runda błędów, blokady i zastępstwa działają w tym zakresie tylko na pytaniach WB; inne zakresy bez zmian.
 */
import { describe, expect, it } from 'vitest';
import {
  answer,
  capacityFor,
  defaultSettings,
  emptyUserState,
  initialFreeFlowConfig,
  initialTestConfig,
  markShown,
  nextFreeFlowSlot,
  poolFor,
  previewRetryRound,
  reportQuestion,
  startFreeFlow,
  startRetryRound,
  startTest,
  WEBINAR_SCOPE,
  type DomainId,
  type Scope,
  type SessionConfig,
  type UserState,
} from '../../src/domain/api';
import { applyAnswer, applyShown, emptyStat } from '../../src/domain/review';
import { isScope, isValidConfigShape } from '../../src/domain/util';
import { currentCatalog } from '../content';
import { catalogOf, Clock, DOMAIN_IDS, grid, must, mustFail, planFamilies, playTest, session, slotAt, warsawNextDayStart } from './helpers';

const catalog = currentCatalog();
const WEBINAR: Scope = 'WEBINAR';
const isWb = (id: string): boolean => id.startsWith('WB-');
const WB_QUESTIONS = catalog.questions.filter((q) => q.webinarEvidence !== null);
/** Podaż pytań WB w dziedzinach (wydanie: DEV 118, SAFE 47, SKIN 36, INJ 26, THER 14, ANAT 6). */
const WB_BY_DOMAIN: Record<DomainId, number> = Object.fromEntries(
  DOMAIN_IDS.map((d) => [d, WB_QUESTIONS.filter((q) => q.domainId === d).length]),
) as Record<DomainId, number>;

function config(scope: Scope, targetN: number | null, myErrorsPriority = false): SessionConfig {
  return { scope, difficulty: 'mixed', targetN, myErrorsPriority };
}

/** Bieżące pytanie Free Flow: wyświetla, odpowiada (poprawnie albo błędnie) i dobiera kolejne. */
function ffStep(state: UserState, sessionId: string, clock: Clock, correct = true): { state: UserState; questionId: string; origin: string } {
  const slot = slotAt(state, sessionId, session(state, sessionId).reached);
  let st = must(markShown(state, { sessionId, slotId: slot.id }, clock.ctx())).state;
  const optionId = correct ? slot.snapshot.correctOptionId : (slot.snapshot.options.find((o) => o.id !== slot.snapshot.correctOptionId)?.id ?? '');
  st = must(answer(st, { sessionId, expectedRevision: session(st, sessionId).revision, slotId: slot.id, optionId }, clock.ctx())).state;
  st = must(nextFreeFlowSlot(st, catalog, { sessionId, expectedRevision: session(st, sessionId).revision }, clock.ctx())).state;
  return { state: st, questionId: slot.questionId, origin: slot.origin };
}

/** Stan z aktywnymi błędami w V18 i WB: test „Cały zakres” 40 pytań, wszystkie odpowiedzi błędne. */
function withMixedErrors(): { state: UserState; clock: Clock; wb: string[]; v18: string[] } {
  const clock = new Clock();
  const out = must(startTest(emptyUserState(), catalog, { config: config('ALL', 40), seed: 77 }, clock.ctx()));
  const state = playTest(out.state, out.value.sessionId, clock, () => false);
  const errors = Object.values(state.questionStats)
    .filter((s) => s.activeError)
    .map((s) => s.questionId);
  return { state, clock, wb: errors.filter(isWb).sort(), v18: errors.filter((id) => !isWb(id)).sort() };
}

describe('zakres „Webinar” — pula i pojemność', () => {
  it('stała zakresu i walidacja: `WEBINAR` jest poprawnym zakresem, nieznany zakres nie', () => {
    expect(WEBINAR_SCOPE).toBe('WEBINAR');
    expect(isScope('WEBINAR')).toBe(true);
    expect(isScope('XYZ')).toBe(false);
    expect(isValidConfigShape(config(WEBINAR, 20))).toBe(true);
  });

  it('pula: 247 pytań WB, pojemność 247, każde ID `WB-`', () => {
    expect(WB_QUESTIONS).toHaveLength(247);
    expect(WB_BY_DOMAIN).toEqual({ ANAT: 6, INJ: 26, SKIN: 36, THER: 14, DEV: 118, SAFE: 47 });
    const pool = poolFor(catalog, emptyUserState(), WEBINAR, 'mixed', '2026-11-15T08:00:00.000Z');
    expect(pool.questionIds).toHaveLength(247);
    expect(pool.capacity).toBe(247);
    expect(pool.unseenFamilies).toBe(247);
    expect(pool.questionIds.every(isWb)).toBe(true);
    expect(capacityFor(catalog, emptyUserState(), WEBINAR, 'mixed')).toBe(247);
  });

  it('blokada (zgłoszenie w teście „Webinar”): pojemność 246, zastępstwo też z WB; inne zakresy tracą to pytanie jak dotąd', () => {
    const clock = new Clock();
    const empty = emptyUserState();
    const out = must(startTest(empty, catalog, { config: config(WEBINAR, 3), seed: 5 }, clock.ctx()));
    const sid = out.value.sessionId;
    const reported = slotAt(out.state, sid, 0);
    expect(isWb(reported.questionId)).toBe(true);
    const domain = reported.snapshot.domainId;
    const rep = must(
      reportQuestion(out.state, catalog, { sessionId: sid, slotId: reported.id, questionId: reported.questionId, expectedRevision: session(out.state, sid).revision }, clock.ctx()),
    );
    expect(rep.value.awaitingReplacement).toBe(false);
    const replacement = slotAt(rep.state, sid, 0);
    expect(replacement.origin).toBe('replacement');
    expect(isWb(replacement.questionId)).toBe(true);
    expect(new Set(planFamilies(rep.state, sid)).size).toBe(3);

    expect(capacityFor(catalog, rep.state, WEBINAR, 'mixed')).toBe(246);
    expect(poolFor(catalog, rep.state, WEBINAR, 'mixed', clock.now).questionIds).not.toContain(reported.questionId);
    expect(capacityFor(catalog, rep.state, 'ALL', 'mixed')).toBe(capacityFor(catalog, empty, 'ALL', 'mixed') - 1);
    expect(capacityFor(catalog, rep.state, domain, 'mixed')).toBe(capacityFor(catalog, empty, domain, 'mixed') - 1);
  });

  it('katalog bez pytań WB: pusta pula — Test odmawia (EMPTY_POOL), Free Flow w stanie `empty`', () => {
    const noWb = catalogOf(grid(2));
    expect(poolFor(noWb, emptyUserState(), WEBINAR, 'mixed', '2026-11-15T08:00:00.000Z')).toMatchObject({ capacity: 0, questionIds: [] });
    const clock = new Clock();
    mustFail(startTest(emptyUserState(), noWb, { config: config(WEBINAR, 5), seed: 1 }, clock.ctx()), 'EMPTY_POOL');
    const ff = must(startFreeFlow(emptyUserState(), noWb, { config: config(WEBINAR, null), seed: 1 }, clock.ctx()));
    const s = session(ff.state, ff.value.sessionId);
    expect(s.plan).toHaveLength(0);
    expect(s.freeFlow?.empty).toBe(true);
  });
});

describe('zakres „Webinar” — Test (przydział proporcjonalny do podaży dziedzin, bez profilu)', () => {
  it('N=20: 20 pytań WB, unikalne rodziny, bez `allocation.profile`, kwoty {DEV:10, SAFE:4, SKIN:3, INJ:2, THER:1, ANAT:0}', () => {
    const out = must(startTest(emptyUserState(), catalog, { config: config(WEBINAR, 20), seed: 2026 }, new Clock().ctx()));
    const s = session(out.state, out.value.sessionId);
    expect(s.config.scope).toBe('WEBINAR');
    expect(s.plan).toHaveLength(20);
    const slots = s.plan.map((id) => s.slots[id]!);
    expect(slots.every((sl) => isWb(sl.questionId))).toBe(true);
    expect(slots.every((sl) => sl.snapshot.stem.trimEnd().endsWith('[webinar]'))).toBe(true);
    expect(new Set(planFamilies(out.state, s.id)).size).toBe(20);
    expect(s.allocation.profile).toBeUndefined();
    expect(s.allocation.policy).toBe('TEST_POLICY_V3');
    expect(s.allocation.domainTargets).toEqual({ DEV: 10, SAFE: 4, SKIN: 3, INJ: 2, THER: 1, ANAT: 0 });
    expect(s.allocation.domainActual).toEqual({ DEV: 10, SAFE: 4, SKIN: 3, INJ: 2, THER: 1 });
    expect(out.state.settings.lastTestConfig).toEqual(config(WEBINAR, 20));
  });

  it.each([1, 2, 7, 50, 120, 246])('N=%i: wyłącznie WB, unikalne rodziny i ID', (n) => {
    const out = must(startTest(emptyUserState(), catalog, { config: config(WEBINAR, n), seed: 400 + n }, new Clock().ctx()));
    const s = session(out.state, out.value.sessionId);
    expect(s.plan).toHaveLength(n);
    expect(s.plan.every((id) => isWb(s.slots[id]!.questionId))).toBe(true);
    expect(new Set(planFamilies(out.state, s.id)).size).toBe(n);
    expect(s.allocation.profile).toBeUndefined();
  });

  it('N=247: każda rodzina WB dokładnie raz, dziedziny = cała podaż (bez przesunięć między dziedzinami)', () => {
    const out = must(startTest(emptyUserState(), catalog, { config: config(WEBINAR, 247), seed: 9 }, new Clock().ctx()));
    const s = session(out.state, out.value.sessionId);
    const families = planFamilies(out.state, s.id);
    expect(families).toHaveLength(247);
    expect(new Set(families)).toEqual(new Set(WB_QUESTIONS.map((q) => q.familyId)));
    expect(s.allocation.domainActual).toEqual(WB_BY_DOMAIN);
    expect(s.allocation.domainTargets).toEqual(WB_BY_DOMAIN);
    expect(s.allocation.redistributed.filter((r) => r.kind === 'domain')).toEqual([]);
  });

  it('N=248: odmowa N_EXCEEDS_CAPACITY z pojemnością 247', () => {
    const r = startTest(emptyUserState(), catalog, { config: config(WEBINAR, 248), seed: 1 }, new Clock().ctx());
    mustFail(r, 'N_EXCEEDS_CAPACITY');
    if (!r.ok) expect(r.error.details?.capacity).toBe(247);
  });

  it('runda błędów po teście „Webinar”: powtórki i uzupełnienia wyłącznie WB', () => {
    const clock = new Clock();
    const out = must(startTest(emptyUserState(), catalog, { config: config(WEBINAR, 10), seed: 31 }, clock.ctx()));
    const sid = out.value.sessionId;
    const done = playTest(out.state, sid, clock, (i) => i % 3 !== 0); // 4 błędne
    expect(session(done, sid).result).toMatchObject({ correct: 6, targetN: 10 });
    const preview = previewRetryRound(done, catalog, sid);
    expect(preview.ok && preview.value).toMatchObject({ repeatedWrong: 4, config: config(WEBINAR, 10) });
    const round = must(startRetryRound(done, catalog, { sourceSessionId: sid, seed: 8 }, clock.ctx()));
    const r = session(round.state, round.value.sessionId);
    expect(r.config.scope).toBe('WEBINAR');
    expect(r.plan).toHaveLength(10);
    expect(r.plan.filter((id) => r.slots[id]?.origin === 'repeated_wrong')).toHaveLength(4);
    expect(r.plan.every((id) => isWb(r.slots[id]!.questionId))).toBe(true);
    expect(new Set(planFamilies(round.state, r.id)).size).toBe(10);
    expect(r.allocation.profile).toBeUndefined();
  });
});

describe('zakres „Webinar” — Free Flow (wagi = udział dziedziny w puli, bez profilu i bez DEV 0,40)', () => {
  it('40 kolejnych pytań: wyłącznie WB, bez `allocation.profile`, wagi = udział dziedziny w puli, udziały dziedzin co do 1 pytania', () => {
    const clock = new Clock();
    const ff = must(startFreeFlow(emptyUserState(), catalog, { config: config(WEBINAR, null), seed: 3 }, clock.ctx()));
    const sid = ff.value.sessionId;
    let st: UserState = ff.state;
    expect(session(st, sid).config.scope).toBe('WEBINAR');
    expect(session(st, sid).allocation.policy).toBe('FREE_FLOW_POLICY_V3');
    expect(st.settings.lastFreeFlowConfig).toEqual(config(WEBINAR, null));
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) {
      const step = ffStep(st, sid, clock);
      st = step.state;
      ids.push(step.questionId);
    }
    expect(ids.every(isWb)).toBe(true);
    const s = session(st, sid);
    expect(s.allocation.profile).toBeUndefined();
    const weights = s.allocation.freeFlowWeights ?? {};
    expect(Object.keys(weights).sort()).toEqual([...DOMAIN_IDS].sort());
    for (const d of DOMAIN_IDS) expect(weights[d]).toBeCloseTo(WB_BY_DOMAIN[d] / 247, 10);
    expect(weights.DEV).toBeCloseTo(118 / 247, 10);
    for (const d of DOMAIN_IDS) {
      const count = ids.filter((id) => catalog.questionsById[id]?.domainId === d).length;
      expect(Math.abs(count - (40 * WB_BY_DOMAIN[d]) / 247), d).toBeLessThanOrEqual(1);
    }
  });
});

describe('zakres „Webinar” — „Moje błędy” biorą tylko błędy WB', () => {
  it('pula „Webinar” liczy tylko aktywne błędy WB; Test z „Moje błędy” bierze tylko je', () => {
    const { state, clock, wb, v18 } = withMixedErrors();
    expect(wb.length).toBeGreaterThan(0);
    expect(v18.length).toBeGreaterThan(0);
    expect(wb.length).toBeLessThanOrEqual(20);
    expect(poolFor(catalog, state, WEBINAR, 'mixed', clock.now).activeErrors).toBe(wb.length);
    expect(poolFor(catalog, state, 'ALL', 'mixed', clock.now).activeErrors).toBe(wb.length + v18.length);

    const out = must(startTest(state, catalog, { config: config(WEBINAR, 20, true), seed: 12 }, clock.ctx()));
    const s = session(out.state, out.value.sessionId);
    const slots = s.plan.map((id) => s.slots[id]!);
    expect(slots).toHaveLength(20);
    expect(slots.every((sl) => isWb(sl.questionId))).toBe(true);
    expect(
      slots
        .filter((sl) => sl.origin === 'my_errors')
        .map((sl) => sl.questionId)
        .sort(),
    ).toEqual(wb);
    expect(s.allocation.mandatoryMyErrors).toBe(wb.length);
    expect(new Set(planFamilies(out.state, s.id)).size).toBe(20);
  });

  it('dziedzina z kwotą 0 (ANAT przy N=20): aktywny błąd WB z ANAT trafia do testu jako `my_errors`', () => {
    const clock = new Clock();
    const anat = WB_QUESTIONS.find((q) => q.domainId === 'ANAT');
    if (!anat) throw new Error('brak pytania WB z ANAT');
    const at = clock.now;
    const stat = applyAnswer(applyShown(emptyStat(anat.id, anat.familyId, anat.domainId), at), {
      correct: false,
      sessionId: 'sesja-wczesniejsza',
      answeredAt: at,
      nextDayStart: warsawNextDayStart(at),
    });
    const state: UserState = { ...emptyUserState(), questionStats: { [anat.id]: stat } };
    expect(poolFor(catalog, state, WEBINAR, 'mixed', clock.now).activeErrors).toBe(1);

    const out = must(startTest(state, catalog, { config: config(WEBINAR, 20, true), seed: 44 }, clock.ctx()));
    const s = session(out.state, out.value.sessionId);
    expect(s.allocation.domainTargets.ANAT).toBe(0);
    const slots = s.plan.map((id) => s.slots[id]!);
    expect(slots.filter((sl) => sl.origin === 'my_errors').map((sl) => sl.questionId)).toEqual([anat.id]);
    expect(slots.every((sl) => isWb(sl.questionId))).toBe(true);
    expect(new Set(planFamilies(out.state, s.id)).size).toBe(20);
    expect(s.allocation.domainActual.ANAT ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('Free Flow z „Moje błędy”: najpierw wszystkie aktywne błędy WB, nigdy błędy V18', () => {
    const { state, clock, wb } = withMixedErrors();
    const ff = must(startFreeFlow(state, catalog, { config: config(WEBINAR, null, true), seed: 21 }, clock.ctx()));
    const sid = ff.value.sessionId;
    let st: UserState = ff.state;
    const steps: { questionId: string; origin: string }[] = [];
    for (let i = 0; i < wb.length + 5; i++) {
      const step = ffStep(st, sid, clock);
      st = step.state;
      steps.push(step);
    }
    expect(steps.every((x) => isWb(x.questionId))).toBe(true);
    expect(
      steps
        .slice(0, wb.length)
        .map((x) => x.questionId)
        .sort(),
    ).toEqual(wb);
    expect(steps.slice(0, wb.length).every((x) => x.origin === 'my_errors')).toBe(true);
    expect(steps.slice(wb.length).every((x) => x.origin === 'freeflow')).toBe(true);
  });
});

describe('inne zakresy bez zmian', () => {
  it('Cały zakres: profil treningowy V3 w Teście i Free Flow', () => {
    const clock = new Clock();
    const t = must(startTest(emptyUserState(), catalog, { config: config('ALL', 20), seed: 1 }, clock.ctx()));
    expect(session(t.state, t.value.sessionId).allocation.profile).toBeDefined();
    const ff = must(startFreeFlow(emptyUserState(), catalog, { config: config('ALL', null), seed: 1 }, clock.ctx()));
    expect(session(ff.state, ff.value.sessionId).allocation.profile).toBeDefined();
  });

  it('dziedzina (SKIN) zawiera swoje pytania WB jak dotąd; suma dziedzin = Cały zakres', () => {
    const now = '2026-11-15T08:00:00.000Z';
    const skin = poolFor(catalog, emptyUserState(), 'SKIN', 'mixed', now);
    expect(skin.questionIds.filter(isWb)).toHaveLength(WB_BY_DOMAIN.SKIN);
    expect(skin.questionIds.length).toBe(catalog.questions.filter((q) => q.domainId === 'SKIN').length);
    const all = poolFor(catalog, emptyUserState(), 'ALL', 'mixed', now);
    expect(all.questionIds).toHaveLength(catalog.questions.length);
    const perDomain = DOMAIN_IDS.reduce((acc, d) => acc + poolFor(catalog, emptyUserState(), d, 'mixed', now).questionIds.length, 0);
    expect(perDomain).toBe(catalog.questions.length);
  });
});

describe('ustawienia: ostatnia konfiguracja z zakresem „Webinar”', () => {
  it('initialTestConfig / initialFreeFlowConfig zwracają zakres WEBINAR; nieznany zakres → domyślna konfiguracja', () => {
    const settings = { ...defaultSettings(), lastTestConfig: config(WEBINAR, 30), lastFreeFlowConfig: config(WEBINAR, null, true) };
    expect(initialTestConfig(settings)).toEqual(config(WEBINAR, 30));
    expect(initialFreeFlowConfig(settings)).toEqual(config(WEBINAR, null, true));
    const unknown = { ...defaultSettings(), lastTestConfig: { ...config('ALL', 30), scope: 'XYZ' as Scope } };
    expect(initialTestConfig(unknown).scope).toBe('ALL');
  });
});
