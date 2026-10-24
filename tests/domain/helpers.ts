/**
 * Pomocnicze konstrukcje testów domeny: syntetyczne katalogi budowane w kodzie, deterministyczny
 * kontekst komend (stały zegar, licznikowe identyfikatory) i skróty przebiegu sesji.
 */
import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import {
  advance,
  answer,
  buildCatalog,
  emptyUserState,
  finishTest,
  fingerprintPayload,
  markShown,
  type Catalog,
  type CommandContext,
  type CommandResult,
  type Difficulty,
  type DomainId,
  type DomainOutcome,
  type IdKind,
  type OptionId,
  type CatalogContent,
  type RuntimeBank,
  type RuntimeQuestion,
  type Session,
  type Slot,
  type UserState,
} from '../../src/domain/api';
import { DIFFICULTIES, DOMAIN_IDS } from '../../src/domain/types';

export { DIFFICULTIES, DOMAIN_IDS };

export function sha(stem: string, options: readonly string[]): string {
  return createHash('sha256').update(fingerprintPayload(stem, options), 'utf8').digest('hex');
}

export interface QSpec {
  id: string;
  domain?: DomainId;
  difficulty?: Difficulty;
  family?: string;
  stem?: string;
  options?: [string, string, string, string];
  correct?: OptionId;
  revision?: number;
  topic?: string;
}

const OPTION_IDS = ['A', 'B', 'C', 'D'] as const;

export function q(spec: QSpec): RuntimeQuestion {
  const domain = spec.domain ?? 'ANAT';
  const stem = spec.stem ?? `Pytanie ${spec.id}: które stwierdzenie jest prawidłowe?`;
  const texts = spec.options ?? [`Wariant pierwszy ${spec.id}`, `Wariant drugi ${spec.id}`, `Wariant trzeci ${spec.id}`, `Wariant czwarty ${spec.id}`];
  return {
    id: spec.id,
    revision: spec.revision ?? 1,
    family_id: spec.family ?? spec.id,
    fingerprint: sha(stem, texts),
    domain_id: domain,
    topic_ids: [spec.topic ?? `${domain}-T1`],
    difficulty: spec.difficulty ?? 'intermediate',
    stem_pl: stem,
    options: OPTION_IDS.map((id, i) => ({ id, text_pl: texts[i] as string })),
    correct_option_id: spec.correct ?? 'B',
    correct_explanation_pl: `Wyjaśnienie poprawnego wariantu dla ${spec.id}.`,
    source_ids: ['S1'],
    source_locator_pl: 'S1: abstrakt.',
    question_type: 'text',
    figure_id: null,
    explanation_figure_id: null,
    review_status: 'draft_pending_clinical_review',
    approved_for_question_key: false,
    content_check_status: 'seed_draft_not_rechecked',
    cognitive_level: 'mechanism',
  };
}

/** Siatka pytań: `perCell` pytań (każde własna rodzina) w każdej komórce domena × poziom. */
export function grid(perCell: number, opts: { domains?: readonly DomainId[]; levels?: readonly Difficulty[]; prefix?: string } = {}): RuntimeQuestion[] {
  const out: RuntimeQuestion[] = [];
  for (const d of opts.domains ?? DOMAIN_IDS) {
    for (const l of opts.levels ?? DIFFICULTIES) {
      for (let i = 1; i <= perCell; i++) {
        const id = `${opts.prefix ?? ''}${d}-${l.slice(0, 3)}-${String(i).padStart(3, '0')}`;
        out.push(q({ id, domain: d, difficulty: l, correct: OPTION_IDS[i % 4] }));
      }
    }
  }
  return out;
}

/** Pytania tylko jednej domeny i poziomu. */
export function cell(domain: DomainId, difficulty: Difficulty, count: number, prefix = ''): RuntimeQuestion[] {
  return grid(count, { domains: [domain], levels: [difficulty], prefix });
}

export function bank(questions: RuntimeQuestion[], version = 'test-bank-1'): RuntimeBank {
  const topics: RuntimeBank['topics'] = {};
  for (const d of DOMAIN_IDS) {
    topics[`${d}-T1`] = {
      id: `${d}-T1`,
      title_pl: `Temat ${d}`,
      domain_id: d,
      learning_objective_pl: `Cel nauki ${d}`,
      clinical_pearls_pl: [`Perełka ${d}`],
    };
  }
  return {
    format: 'dme-runtime-bank',
    format_version: 1,
    schema_version: '1.0',
    bank_version: version,
    built_on: '2026-10-22',
    clinical_signoff: false,
    official_exam_question_bank: false,
    status_pl: 'Materiał testowy.',
    counts: { questions: questions.length, families: 0, by_domain: {}, by_difficulty: {}, schematic: 0, independently_checked_draft: 0 },
    domains: DOMAIN_IDS.map((id) => ({ id, title_pl: `Domena ${id}`, description_pl: '' })),
    topics,
    sources: {
      S1: {
        id: 'S1',
        title: 'Źródło testowe',
        url: 'https://example.org/zrodlo',
        doi: null,
        pmid: null,
        kind: 'review',
        kind_pl: 'przegląd',
        access: 'abstract',
        access_pl: 'abstrakt',
        checked_on: '2026-10-22',
      },
    },
    figures: {},
    questions,
  };
}

export function catalogOf(questions: RuntimeQuestion[], content: CatalogContent = {}, version?: string): Catalog {
  const r = buildCatalog(bank(questions, version), content);
  if (!r.ok) throw new Error(r.error.messagePl);
  return r.value;
}

/* ========================================================================== */
/* Kontekst komend                                                            */
/* ========================================================================== */

/** Początek następnego dnia w Europe/Warsaw (jak kontroler) — liczony przez Intl w teście. */
export function warsawNextDayStart(nowIso: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(nowIso)).map((p) => [p.type, p.value]));
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  for (const offset of [2, 1]) {
    const candidate = Date.UTC(y, m - 1, d + 1, 0, 0, 0) - offset * 3600_000;
    const hp = Object.fromEntries(fmt.formatToParts(new Date(candidate)).map((p) => [p.type, p.value]));
    if (Number(hp.hour) % 24 === 0) return new Date(candidate).toISOString();
  }
  throw new Error('warsawNextDayStart');
}

export class Clock {
  private t: number;
  private cmd = 0;
  private id = 0;
  constructor(start = '2026-10-22T08:00:00.000Z') {
    this.t = Date.parse(start);
  }
  get now(): string {
    return new Date(this.t).toISOString();
  }
  /** Przesuwa zegar (ms). */
  tick(ms = 1000): void {
    this.t += ms;
  }
  set(iso: string): void {
    this.t = Date.parse(iso);
  }
  /** Kolejny kontekst komendy (zegar +1 s, nowy commandId). */
  ctx(commandId?: string): CommandContext {
    this.tick(1000);
    const now = this.now;
    return {
      now,
      nextDayStart: warsawNextDayStart(now),
      commandId: commandId ?? `cmd-${++this.cmd}`,
      newId: (kind: IdKind) => `${kind}-${++this.id}`,
    };
  }
}

/* ========================================================================== */
/* Wyniki i przebieg                                                          */
/* ========================================================================== */

export function must<V>(r: CommandResult<DomainOutcome<V>>): DomainOutcome<V> {
  if (!r.ok) throw new Error(`Oczekiwano sukcesu, otrzymano ${r.error.code}: ${r.error.messagePl}`);
  return r.value;
}

export function mustFail<V>(r: CommandResult<V>, code: string): void {
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.code).toBe(code);
}

export function session(state: UserState, id: string): Session {
  const s = state.sessions[id];
  if (!s) throw new Error(`Brak sesji ${id}`);
  return s;
}

export function slotAt(state: UserState, sessionId: string, index: number): Slot {
  const s = session(state, sessionId);
  const slot = s.slots[s.plan[index] ?? ''];
  if (!slot) throw new Error(`Brak slotu ${index}`);
  return slot;
}

export function wrongOptionOf(slot: Slot): OptionId {
  const o = slot.snapshot.options.find((x) => x.id !== slot.snapshot.correctOptionId);
  if (!o) throw new Error('brak błędnej opcji');
  return o.id;
}

/** Wyświetla i odpowiada na bieżącą pozycję (`reached`). */
export function answerCurrent(state: UserState, sessionId: string, clock: Clock, correct: boolean): UserState {
  let st = state;
  const s = session(st, sessionId);
  const slot = slotAt(st, sessionId, s.reached);
  st = must(markShown(st, { sessionId, slotId: slot.id }, clock.ctx())).state;
  const optionId = correct ? slot.snapshot.correctOptionId : wrongOptionOf(slot);
  const rev = session(st, sessionId).revision;
  st = must(answer(st, { sessionId, expectedRevision: rev, slotId: slot.id, optionId }, clock.ctx())).state;
  return st;
}

/**
 * Przechodzi cały test: odpowiada na każdą pozycję (decyzja `isCorrect(index, slot)`) i — jeśli
 * `finish` — wywołuje „Pokaż wynik”.
 */
export function playTest(
  state: UserState,
  sessionId: string,
  clock: Clock,
  isCorrect: (index: number, slot: Slot) => boolean,
  finish = true,
): UserState {
  let st = state;
  const n = session(st, sessionId).plan.length;
  for (let i = 0; i < n; i++) {
    const s = session(st, sessionId);
    const slot = slotAt(st, sessionId, s.reached);
    st = answerCurrent(st, sessionId, clock, isCorrect(i, slot));
    if (i < n - 1) st = must(advance(st, { sessionId, expectedRevision: session(st, sessionId).revision }, clock.ctx())).state;
  }
  if (finish) st = must(finishTest(st, { sessionId, expectedRevision: session(st, sessionId).revision }, clock.ctx())).state;
  return st;
}

export function fresh(): UserState {
  return emptyUserState();
}

export function planQuestionIds(state: UserState, sessionId: string): string[] {
  const s = session(state, sessionId);
  return s.plan.map((id) => s.slots[id]?.questionId ?? '');
}

export function planFamilies(state: UserState, sessionId: string): string[] {
  const s = session(state, sessionId);
  return s.plan.map((id) => s.slots[id]?.snapshot.familyId ?? '');
}
