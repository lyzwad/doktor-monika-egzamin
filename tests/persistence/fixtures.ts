/**
 * Dane testowe trwałości: rekordy użytkownika zbudowane z prawdziwych pytań bieżącego banku (V18)
 * (snapshoty, próby, statystyki, blokada ze zgłoszenia), paczki pytań i fabryka repozytorium
 * na świeżej instancji fake-indexeddb. Wyłącznie do testów.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { buildCatalog, parseTrainingProfile } from '../../src/domain/catalog';
import { fingerprintPayload, fingerprintRuntimeQuestion } from '../../src/domain/fingerprint';
import type {
  Attempt,
  Block,
  Catalog,
  Changeset,
  DmeEvent,
  QuestionSnapshot,
  QuestionStat,
  RuntimeBank,
  RuntimeQuestion,
  Session,
  Settings,
  Slot,
} from '../../src/domain/types';
import type { BackupData, Repository } from '../../src/persistence/api';
import type { BankTarget } from '../../src/persistence/bankMigration';
import { createIndexedDbRepository } from '../../src/persistence/repository';
import type { InternalRepositoryOptions } from '../../src/persistence/repository';

import { BANK } from '../content';

export { BANK };

/** Pytania z banku, których zapisany fingerprint zgadza się z treścią (patrz ARCHITEKTURA_APP §8.1). */
export async function bankQuestionsWithValidFingerprint(count: number, skip = 0): Promise<RuntimeQuestion[]> {
  const out: RuntimeQuestion[] = [];
  let skipped = 0;
  for (const question of BANK.questions) {
    if ((await fingerprintRuntimeQuestion(question)) !== question.fingerprint) continue;
    if (skipped < skip) {
      skipped += 1;
      continue;
    }
    out.push(question);
    if (out.length === count) break;
  }
  return out;
}

export function bankQuestion(id: string): RuntimeQuestion {
  const question = BANK.questions.find((q) => q.id === id);
  if (!question) throw new Error(`Brak pytania ${id} w banku`);
  return question;
}

let dbCounter = 0;

/** Repozytorium na świeżej (pustej) fabryce fake-indexeddb, z unikalną nazwą bazy. */
export function freshRepository(options: InternalRepositoryOptions = {}): { repo: Repository; factory: IDBFactory; dbName: string } {
  const factory = options.indexedDB ?? new IDBFactory();
  dbCounter += 1;
  const dbName = options.dbName ?? `dme-test-${dbCounter}`;
  const repo = createIndexedDbRepository({
    appVersion: 'test',
    now: () => '2026-10-22T10:00:00.000Z',
    storageManager: null,
    ...options,
    indexedDB: factory,
    dbName,
  });
  return { repo, factory, dbName };
}

/* ========================================================================== */
/* Rekordy                                                                    */
/* ========================================================================== */

export function snapshotOf(question: RuntimeQuestion, order: string[], bank: RuntimeBank = BANK): QuestionSnapshot {
  const domain = bank.domains.find((d) => d.id === question.domain_id);
  return {
    questionId: question.id,
    revision: question.revision,
    bankVersion: bank.bank_version,
    familyId: question.family_id,
    fingerprint: question.fingerprint,
    domainId: question.domain_id,
    domainTitle: domain?.title_pl ?? question.domain_id,
    topicIds: [...question.topic_ids],
    topics: question.topic_ids.map((id) => {
      const topic = bank.topics[id];
      return {
        id,
        title: topic?.title_pl ?? id,
        learningObjective: topic?.learning_objective_pl ?? null,
        pearls: topic?.clinical_pearls_pl ?? [],
      };
    }),
    difficulty: question.difficulty,
    stem: question.stem_pl,
    options: order.map((id) => ({ id, text: question.options.find((o) => o.id === id)?.text_pl ?? '' })),
    correctOptionId: question.correct_option_id,
    explanation: question.correct_explanation_pl,
    sources: question.source_ids.map((id) => {
      const source = bank.sources[id];
      return {
        id,
        title: source?.title ?? id,
        url: source?.url ?? null,
        doi: source?.doi ?? null,
        pmid: source?.pmid ?? null,
        kindPl: source?.kind_pl ?? '',
        accessPl: source?.access_pl ?? '',
      };
    }),
    sourceLocator: question.source_locator_pl,
    figure: null,
    explanationFigure: null,
    reviewStatus: question.review_status,
    approvedForQuestionKey: question.approved_for_question_key,
  };
}

const ORDER = ['C', 'A', 'D', 'B'];

export function makeSlot(
  id: string,
  question: RuntimeQuestion,
  options: {
    createdAt: string;
    answer?: { commandId: string; optionId: string; at: string };
    excluded?: { at: string; eventId: string };
    origin?: Slot['origin'];
    replacesSlotId?: string | null;
  },
): Slot {
  return {
    id,
    questionId: question.id,
    origin: options.origin ?? 'planned',
    snapshot: snapshotOf(question, ORDER),
    optionOrder: [...ORDER],
    attempt: options.answer
      ? {
          commandId: options.answer.commandId,
          optionId: options.answer.optionId,
          correct: options.answer.optionId === question.correct_option_id,
          answeredAt: options.answer.at,
        }
      : null,
    excluded: options.excluded ? { reason: 'reported', at: options.excluded.at, eventId: options.excluded.eventId } : null,
    replacesSlotId: options.replacesSlotId ?? null,
    createdAt: options.createdAt,
    shownAt: options.createdAt,
  };
}

function attemptFor(session: Session, slot: Slot, question: RuntimeQuestion, excluded: { at: string } | null = null): Attempt {
  if (!slot.attempt) throw new Error('slot bez odpowiedzi');
  return {
    id: slot.attempt.commandId,
    commandId: slot.attempt.commandId,
    sessionId: session.id,
    sessionKind: session.kind,
    slotId: slot.id,
    questionId: question.id,
    questionRevision: question.revision,
    domainId: question.domain_id,
    difficulty: question.difficulty,
    optionId: slot.attempt.optionId,
    optionOrder: [...slot.optionOrder],
    correct: slot.attempt.correct,
    answeredAt: slot.attempt.answeredAt,
    excluded: excluded !== null,
    excludedReason: excluded ? 'reported' : null,
    excludedAt: excluded ? excluded.at : null,
  };
}

function allocation(policy: 'TEST_POLICY_V1' | 'FREE_FLOW_POLICY_V1'): Session['allocation'] {
  return {
    policy,
    rotationOffset: 0,
    capacityAtStart: 246,
    domainTargets: {},
    domainActual: {},
    cells: [],
    mandatoryRepeated: 0,
    mandatoryMyErrors: 0,
    fillersUnseen: 0,
    fillersSeen: 0,
    redistributed: [],
    freeFlowWeights: policy === 'FREE_FLOW_POLICY_V1' ? { DEV: 0.4, ANAT: 0.12, INJ: 0.12, SKIN: 0.12, THER: 0.12, SAFE: 0.12 } : null,
  };
}

function wrongOption(question: RuntimeQuestion): string {
  return question.options.find((o) => o.id !== question.correct_option_id)?.id ?? 'A';
}

/**
 * Spójny zestaw danych użytkowniczki: ukończony test (3 pytania, 1 błąd), otwarta runda powtórki
 * ze zgłoszeniem i zastępstwem, zakończony Free Flow, statystyki, blokada i zdarzenia.
 */
export function sampleUserData(): BackupData {
  const [q1, q2, q3, q4, q5, q6, q7] = BANK.questions.slice(0, 7) as [
    RuntimeQuestion,
    RuntimeQuestion,
    RuntimeQuestion,
    RuntimeQuestion,
    RuntimeQuestion,
    RuntimeQuestion,
    RuntimeQuestion,
  ];
  const t0 = '2026-10-20T08:00:00.000Z';

  // Test ukończony: s1-a ✓, s1-b ✗, s1-c ✓.
  const s1Slots = [
    makeSlot('s1-a', q1, { createdAt: t0, answer: { commandId: 'cmd-1', optionId: q1.correct_option_id, at: '2026-10-20T08:01:00.000Z' } }),
    makeSlot('s1-b', q2, { createdAt: t0, answer: { commandId: 'cmd-2', optionId: wrongOption(q2), at: '2026-10-20T08:02:00.000Z' } }),
    makeSlot('s1-c', q3, { createdAt: t0, answer: { commandId: 'cmd-3', optionId: q3.correct_option_id, at: '2026-10-20T08:03:00.000Z' } }),
  ];
  const s1Events: DmeEvent[] = [
    { id: 'ev-s1-start', at: t0, commandId: 'cmd-start-1', type: 'session_started', sessionId: 'sess-1', kind: 'test' },
    { id: 'ev-s1-done', at: '2026-10-20T08:04:00.000Z', commandId: 'cmd-finish-1', type: 'session_completed', sessionId: 'sess-1', correct: 2, targetN: 3, passed: true },
  ];
  const s1: Session = {
    id: 'sess-1',
    kind: 'test',
    status: 'completed',
    createdAt: t0,
    updatedAt: '2026-10-20T08:04:00.000Z',
    closedAt: '2026-10-20T08:04:00.000Z',
    revision: 7,
    mutationSeq: 4,
    config: { scope: 'ALL', difficulty: 'mixed', targetN: 3, myErrorsPriority: false },
    bankVersion: BANK.bank_version,
    seed: 123456789,
    allocation: allocation('TEST_POLICY_V1'),
    retry: null,
    plan: s1Slots.map((s) => s.id),
    slots: Object.fromEntries(s1Slots.map((s) => [s.id, s])),
    reached: 2,
    awaitingReplacement: [],
    events: s1Events,
    result: { correct: 2, targetN: 3, passed: true, percent: 66.6 },
    freeFlow: null,
  };

  // Otwarta runda powtórki: s2-a (błąd z rodzica) odpowiedziane, s2-b zgłoszone → zastępstwo s2-c.
  const t2 = '2026-10-21T18:00:00.000Z';
  const reportEvent: DmeEvent = {
    id: 'ev-report-1',
    at: '2026-10-21T18:03:00.000Z',
    commandId: 'cmd-report-1',
    type: 'question_reported',
    sessionId: 'sess-2',
    slotId: 's2-b',
    questionId: q4.id,
    revision: q4.revision,
    blockId: 'block-1',
    phase: 'after_answer',
    reportedLaterAt: null,
  };
  const replacedEvent: DmeEvent = {
    id: 'ev-replaced-1',
    at: '2026-10-21T18:03:00.000Z',
    commandId: 'cmd-report-1',
    type: 'slot_replaced',
    sessionId: 'sess-2',
    excludedSlotId: 's2-b',
    replacementSlotId: 's2-c',
    questionId: q5.id,
  };
  const s2Slots = [
    makeSlot('s2-a', q2, { createdAt: t2, origin: 'repeated_wrong', answer: { commandId: 'cmd-4', optionId: q2.correct_option_id, at: '2026-10-21T18:01:00.000Z' } }),
    makeSlot('s2-b', q4, {
      createdAt: t2,
      origin: 'filler',
      answer: { commandId: 'cmd-5', optionId: wrongOption(q4), at: '2026-10-21T18:02:00.000Z' },
      excluded: { at: '2026-10-21T18:03:00.000Z', eventId: 'ev-report-1' },
    }),
    makeSlot('s2-c', q5, { createdAt: '2026-10-21T18:03:00.000Z', origin: 'replacement', replacesSlotId: 's2-b' }),
  ];
  const s2: Session = {
    id: 'sess-2',
    kind: 'test',
    status: 'open',
    createdAt: t2,
    updatedAt: '2026-10-21T18:03:00.000Z',
    closedAt: null,
    revision: 5,
    mutationSeq: 3,
    config: { scope: 'ALL', difficulty: 'mixed', targetN: 2, myErrorsPriority: false },
    bankVersion: BANK.bank_version,
    seed: 42,
    allocation: { ...allocation('TEST_POLICY_V1'), mandatoryRepeated: 1 },
    retry: { sourceSessionId: 'sess-1', retryChainId: 'chain-1', roundIndex: 2, repeatedCount: 1 },
    plan: ['s2-a', 's2-c'],
    slots: Object.fromEntries(s2Slots.map((s) => [s.id, s])),
    reached: 1,
    awaitingReplacement: [],
    events: [{ id: 'ev-s2-start', at: t2, commandId: 'cmd-start-2', type: 'session_started', sessionId: 'sess-2', kind: 'test' }, reportEvent, replacedEvent],
    result: null,
    freeFlow: null,
  };

  // Free Flow zakończony: 2 pytania.
  const t3 = '2026-10-19T07:00:00.000Z';
  const s3Slots = [
    makeSlot('s3-a', q6, { createdAt: t3, origin: 'freeflow', answer: { commandId: 'cmd-6', optionId: q6.correct_option_id, at: '2026-10-19T07:01:00.000Z' } }),
    makeSlot('s3-b', q7, { createdAt: '2026-10-19T07:01:30.000Z', origin: 'freeflow', answer: { commandId: 'cmd-7', optionId: wrongOption(q7), at: '2026-10-19T07:02:00.000Z' } }),
  ];
  const s3Events: DmeEvent[] = [
    { id: 'ev-s3-start', at: t3, commandId: 'cmd-start-3', type: 'session_started', sessionId: 'sess-3', kind: 'freeflow' },
    { id: 'ev-s3-end', at: '2026-10-19T07:05:00.000Z', commandId: 'cmd-end-3', type: 'freeflow_ended', sessionId: 'sess-3', answeredValid: 2, correct: 1 },
  ];
  const s3: Session = {
    id: 'sess-3',
    kind: 'freeflow',
    status: 'ended',
    createdAt: t3,
    updatedAt: '2026-10-19T07:05:00.000Z',
    closedAt: '2026-10-19T07:05:00.000Z',
    revision: 6,
    mutationSeq: 3,
    config: { scope: 'ALL', difficulty: 'mixed', targetN: null, myErrorsPriority: false },
    bankVersion: BANK.bank_version,
    seed: 7,
    allocation: allocation('FREE_FLOW_POLICY_V1'),
    retry: null,
    plan: s3Slots.map((s) => s.id),
    slots: Object.fromEntries(s3Slots.map((s) => [s.id, s])),
    reached: 1,
    awaitingReplacement: [],
    events: s3Events,
    result: null,
    freeFlow: { myErrorsExhaustedNotified: false, empty: false, picks: 2 },
  };

  const slot = (s: Session, id: string): Slot => s.slots[id] as Slot;
  const attempts: Attempt[] = [
    attemptFor(s1, slot(s1, 's1-a'), q1),
    attemptFor(s1, slot(s1, 's1-b'), q2),
    attemptFor(s1, slot(s1, 's1-c'), q3),
    attemptFor(s2, slot(s2, 's2-a'), q2),
    attemptFor(s2, slot(s2, 's2-b'), q4, { at: '2026-10-21T18:03:00.000Z' }),
    attemptFor(s3, slot(s3, 's3-a'), q6),
    attemptFor(s3, slot(s3, 's3-b'), q7),
  ];

  const stat = (question: RuntimeQuestion, patch: Partial<QuestionStat>): QuestionStat => ({
    questionId: question.id,
    familyId: question.family_id,
    domainId: question.domain_id,
    seenCount: 1,
    firstSeenAt: t3,
    lastSeenAt: t3,
    answeredCount: 1,
    correctCount: 1,
    wrongCount: 0,
    lastAnsweredAt: t3,
    activeError: false,
    streak: 0,
    dueAt: null,
    lastWrongAt: null,
    lastWrongSessionId: null,
    streakSessionId: null,
    resolvedAt: null,
    ...patch,
  });
  const questionStats: QuestionStat[] = [
    stat(q1, {}),
    stat(q2, {
      seenCount: 2,
      answeredCount: 2,
      correctCount: 1,
      wrongCount: 1,
      activeError: true,
      streak: 1,
      dueAt: '2026-10-21T22:00:00.000Z',
      lastWrongAt: '2026-10-20T08:02:00.000Z',
      lastWrongSessionId: 'sess-1',
      streakSessionId: 'sess-2',
    }),
    stat(q3, {}),
    stat(q6, {}),
    stat(q7, { correctCount: 0, wrongCount: 1, activeError: true, dueAt: '2026-10-19T07:02:00.000Z', lastWrongAt: '2026-10-19T07:02:00.000Z', lastWrongSessionId: 'sess-3' }),
  ];

  const block: Block = {
    id: 'block-1',
    questionId: q4.id,
    revision: q4.revision,
    fingerprint: q4.fingerprint,
    familyId: q4.family_id,
    domainId: q4.domain_id,
    stemPreview: q4.stem_pl,
    reason: 'reported',
    createdAt: '2026-10-21T18:03:00.000Z',
    sessionId: 'sess-2',
    slotId: 's2-b',
    eventId: 'ev-report-1',
    revokedAt: null,
  };

  const settings: Settings = {
    id: 'settings',
    lastTestConfig: { scope: 'ALL', difficulty: 'mixed', targetN: 3, myErrorsPriority: false },
    lastFreeFlowConfig: { scope: 'ALL', difficulty: 'mixed', targetN: null, myErrorsPriority: false },
    installHintDismissedAt: null,
    persistRequestedAt: '2026-10-19T07:01:00.000Z',
    updatedAt: '2026-10-21T18:00:00.000Z',
  };

  const events: DmeEvent[] = [...s1Events, ...s2.events, ...s3Events];
  return {
    settings: [settings],
    sessions: [s1, s2, s3],
    attempts,
    questionStats,
    blocks: [block],
    events,
    packs: [],
  };
}

/** Changeset zapisujący wszystkie rekordy użytkownika (bez paczek). */
export function seedChangeset(data: BackupData, commandId = 'seed'): Changeset {
  return {
    commandId,
    guards: [],
    stores: {
      settings: { put: data.settings, delete: [] },
      sessions: { put: data.sessions, delete: [] },
      attempts: { put: data.attempts, delete: [] },
      questionStats: { put: data.questionStats, delete: [] },
      blocks: { put: data.blocks, delete: [] },
      events: { put: data.events, delete: [] },
    },
  };
}

/** Repozytorium z zapisanym `sampleUserData()`. */
export async function seededRepository(options: InternalRepositoryOptions = {}): Promise<{ repo: Repository; factory: IDBFactory; dbName: string; data: BackupData }> {
  const env = freshRepository(options);
  const data = sampleUserData();
  const result = await env.repo.commit(seedChangeset(data));
  if (!result.ok) throw new Error(`seed: ${result.error.code}`);
  return { ...env, data };
}

/* ========================================================================== */
/* Profile z innych wersji banku (migracja do V18, docs/MIGRACJA_V18.md)      */
/* ========================================================================== */

/** Wersje banków spotykane w danych użytkowników (V15 wdrożony; V16 i V17 — paczki samodzielne). */
export const PRE_V15_BANK_VERSION = 'release-2026-10-23c';
export const V15_BANK_VERSION = 'chatgpt-editorial-v15-2026-10-24-f020a0440df8';
export const V16_BANK_VERSION = 'chatgpt-exam-v16-2026-11-09-581c2e15f0ce';
export const V17_BANK_VERSION = 'chatgpt-short-v17-2026-11-09-9fb0fdb25268';

/** Znaczniki treści spoza allowlisty — nie mogą przetrwać migracji ani wczytania kopii. */
export const OLD_MARKERS = ['[DAWNA TREŚĆ', '[DAWNA OPCJA', '[DAWNE WYJAŚNIENIE', 'PACK-Q1'];

/**
 * Pytanie spoza allowlisty V18 (np. ID banku V15 albo nieznane): dawna treść ze znacznikami, własny fingerprint.
 */
export function retiredQuestion(id: string): RuntimeQuestion {
  const base = structuredClone(BANK.questions[0]!);
  return {
    ...base,
    id,
    family_id: `FAM-${id}`,
    stem_pl: `[DAWNA TREŚĆ ${id}] Które stwierdzenie jest prawdziwe?`,
    options: base.options.map((o) => ({ ...o, text_pl: `[DAWNA OPCJA ${id}] ${o.id}` })),
    correct_explanation_pl: `[DAWNE WYJAŚNIENIE ${id}] Uzasadnienie dawnej wersji.`,
    topic_ids: [],
    source_ids: [],
    revision: 3,
    fingerprint: createHash('sha256').update(`dawne:${id}`).digest('hex'),
  };
}

/** Pytanie V16/V17 o tym samym ID, ale innej treści niż w paczce (inna rewizja i fingerprint). */
export function alteredQuestion(id: string): RuntimeQuestion {
  const q = structuredClone(bankQuestion(id));
  q.stem_pl = `[DAWNA TREŚĆ ${id}] ${q.stem_pl}`;
  q.options = q.options.map((o) => ({ ...o, text_pl: `[DAWNA OPCJA] ${o.text_pl}` }));
  q.correct_explanation_pl = `[DAWNE WYJAŚNIENIE ${id}] ${q.correct_explanation_pl}`;
  q.revision = q.revision + 1;
  q.fingerprint = createHash('sha256').update(`zmienione:${id}`).digest('hex');
  return q;
}

/**
 * Dane profilu zapisane przez aplikację innej wersji banku: `sampleUserData()` (ukończony test, otwarta runda
 * powtórki ze zgłoszeniem i zastępstwem, zakończony Free Flow, statystyki, blokada, zdarzenia), w którym
 * i-te pytanie (0…6, kolejność q1…q7) zastępuje `pick(i, pytanie V18)`, a sesje i snapshoty mają `bankVersion`.
 */
export function profileData(bankVersion: string, pick: (index: number, current: RuntimeQuestion) => RuntimeQuestion): BackupData & { packs: unknown[] } {
  const base = sampleUserData();
  const originals = BANK.questions.slice(0, 7);
  const mapped = new Map(originals.map((q, i) => [q.id, pick(i, q)]));
  const qOf = (id: string): RuntimeQuestion => mapped.get(id) ?? bankQuestion(id);
  const sessions = base.sessions.map((s) => {
    const slots = Object.fromEntries(
      Object.entries(s.slots).map(([k, slot]) => {
        const q = qOf(slot.questionId);
        const snap = { ...snapshotOf(q, slot.optionOrder), bankVersion };
        const optionId = slot.attempt ? (slot.attempt.correct ? q.correct_option_id : wrongOption(q)) : null;
        return [k, { ...slot, questionId: q.id, snapshot: snap, attempt: slot.attempt && optionId ? { ...slot.attempt, optionId } : null }];
      }),
    );
    const events = s.events.map((e) => ('questionId' in e ? { ...e, questionId: qOf(e.questionId).id } : e));
    return { ...s, bankVersion, slots, events } as Session;
  });
  const attempts = base.attempts.map((a) => {
    const s = sessions.find((x) => x.id === a.sessionId)!;
    const slot = s.slots[a.slotId]!;
    const q = qOf(a.questionId);
    return { ...a, questionId: q.id, questionRevision: q.revision, optionId: slot.attempt?.optionId ?? a.optionId };
  });
  const questionStats = base.questionStats.map((st) => {
    const q = qOf(st.questionId);
    return { ...st, questionId: q.id, familyId: q.family_id, domainId: q.domain_id };
  });
  const blocks: Block[] = base.blocks.map((b) => {
    const q = qOf(b.questionId);
    return { ...b, questionId: q.id, revision: q.revision, fingerprint: q.fingerprint, familyId: q.family_id, domainId: q.domain_id, stemPreview: q.stem_pl };
  });
  const events = base.events.map((e) => ('questionId' in e ? { ...e, questionId: qOf(e.questionId).id } : e)) as DmeEvent[];
  return { settings: base.settings, sessions, attempts, questionStats, blocks, events, packs: [] };
}

/** ID z listy wycofanych V18 (dawny bank V15) — do budowy profilu V15. */
export function v15Ids(retired: readonly string[], count = 7): string[] {
  return retired.filter((id) => !id.startsWith('V1')).slice(0, count);
}

/** Profil z danymi banku V15 (wszystkie pytania spoza allowlisty V18) oraz paczką pytań starej aplikacji. */
export function v15ProfileData(retired: readonly string[]): BackupData & { packs: unknown[] } {
  const ids = v15Ids(retired);
  const data = profileData(V15_BANK_VERSION, (i) => retiredQuestion(ids[i]!));
  data.packs = [
    {
      id: 'pack-old-1',
      importedAt: '2026-10-21T10:00:00.000Z',
      fileName: 'pula.json',
      bankVersion: 'pula-stara-1',
      sourceFormat: 'runtime-v1',
      questions: [{ ...retiredQuestion('PACK-Q1') }],
      sources: {},
      topics: {},
      figures: {},
      summary: { added: 1, updated: 0, skippedSame: 0, skippedBlocked: 0, rejected: 0 },
    },
  ];
  return data;
}

/* ========================================================================== */
/* Wydanie „V18 + webinary” (migracja v5, spec-webinary-247)                  */
/* ========================================================================== */

/** Wersja banku V18 (aplikacja produkcyjna `39d9d46`, baza IndexedDB v4). */
export const V18_BANK_VERSION = 'chatgpt-combined-v18-2026-11-09-1fb7f7546332';

/**
 * Bank V18 bajt w bajt (`content/v18/bank.json`) — baza syntetycznego wydania, niezależna od tego, które
 * wydanie jest bieżące w `CONTENT_RELEASE` (historia 1 podmienia je na „V18 + webinary”).
 */
export const V18_BANK = JSON.parse(readFileSync(resolve(process.cwd(), 'content/v18/bank.json'), 'utf-8')) as RuntimeBank;

/** Rekord dodatku webinarowego (`content/webinary-2026-11-15/bank_webinar_addendum.json`). */
interface AddendumQuestion {
  id: string;
  domain_id: string;
  stem_pl: string;
  options: { id: string; text_pl: string }[];
  correct_option_id: string;
  correct_explanation_pl: string;
  source_id: string;
  source_ids: string[];
  evidence_unit_ids: string[];
  evidence_quote: string;
  source_note_pl: string;
  question_type: string;
  revision: number;
  family_id: string;
  difficulty: string;
  difficulty_is_technical_placeholder: boolean;
}
interface AddendumSource {
  id: string;
  title: string;
  filename: string;
  sha256: string;
}
const ADDENDUM = JSON.parse(readFileSync(resolve(process.cwd(), 'content/webinary-2026-11-15/bank_webinar_addendum.json'), 'utf-8')) as {
  sources: Record<string, AddendumSource>;
  questions: AddendumQuestion[];
};

/** Dwa pytania WB syntetycznego wydania (różne webinary i działy). */
export const SYNTH_WB_IDS = ['WB-LIGHT-001', 'WB-PIGMENT-001'] as const;

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Rekord runtime pytania WB wg kontrakt-danych.md (adapter dodatku), fingerprint algorytmem aplikacji. */
function webinarRuntimeQuestion(raw: AddendumQuestion): RuntimeQuestion {
  const locator = raw.source_ids.map((sid) => `${sid}: ${raw.evidence_unit_ids.filter((u) => u.startsWith(`${sid}-`)).join(', ')}`).join('; ');
  const record = {
    id: raw.id,
    domain_id: raw.domain_id,
    stem_pl: raw.stem_pl,
    options: raw.options.map((o) => ({ ...o })),
    correct_option_id: raw.correct_option_id,
    correct_explanation_pl: raw.correct_explanation_pl,
    source_ids: [...raw.source_ids],
    revision: raw.revision,
    family_id: raw.family_id,
    difficulty: raw.difficulty,
    difficulty_is_technical_placeholder: raw.difficulty_is_technical_placeholder,
    question_type: raw.question_type,
    evidence_quote: raw.evidence_quote,
    evidence_unit_ids: [...raw.evidence_unit_ids],
    source_note_pl: raw.source_note_pl,
    source_id: raw.source_id,
    clinical_signoff: false,
    origin: 'webinar',
    topic_ids: [`WB-T-${raw.source_id}-${raw.domain_id}`],
    figure_id: null,
    explanation_figure_id: null,
    review_status: 'draft_pending_clinical_review',
    approved_for_question_key: false,
    content_check_status: 'source_checked_AI_draft',
    cognitive_level: null,
    fingerprint: sha256(fingerprintPayload(raw.stem_pl, raw.options.map((o) => o.text_pl))),
    source_locator_pl: locator,
  };
  return record as unknown as RuntimeQuestion;
}

/** Pytania WB syntetycznego wydania (z prawdziwego dodatku, z `evidence_quote` / `evidence_unit_ids`). */
export const SYNTH_WB_QUESTIONS: readonly RuntimeQuestion[] = SYNTH_WB_IDS.map((id) => {
  const raw = ADDENDUM.questions.find((q) => q.id === id);
  if (!raw) throw new Error(`Brak pytania ${id} w dodatku`);
  return webinarRuntimeQuestion(raw);
});

/** Syntetyczna `bank_version` wydania „V18 + 2 WB” (testy prawdziwego przejścia V18 → nowa wersja). */
export const SYNTH_BANK_VERSION = 'dme-v18-webinary-test-syntetyczne-000000000000';

function synthBank(): RuntimeBank {
  const base = structuredClone(V18_BANK);
  const sources: Record<string, unknown> = { ...base.sources };
  const topics: Record<string, unknown> = { ...base.topics };
  for (const q of SYNTH_WB_QUESTIONS) {
    const raw = q as unknown as { source_id: string; domain_id: string };
    const src = ADDENDUM.sources[raw.source_id];
    if (!src) throw new Error(`Brak źródła ${raw.source_id} w dodatku`);
    sources[src.id] = {
      id: src.id,
      title: src.title,
      url: null,
      doi: null,
      pmid: null,
      kind: 'user_supplied_webinar_transcript',
      kind_pl: 'transkrypcja webinaru',
      access: 'source_unit',
      access_pl: 'fragmenty automatycznych napisów',
      checked_on: null,
      filename: src.filename,
      sha256: src.sha256,
      locator_type: 'source_unit',
      audio_verified: false,
    };
    topics[`WB-T-${raw.source_id}-${raw.domain_id}`] = {
      id: `WB-T-${raw.source_id}-${raw.domain_id}`,
      title_pl: src.title,
      domain_id: raw.domain_id,
      learning_objective_pl: null,
      clinical_pearls_pl: [],
    };
  }
  const questions = [...base.questions, ...SYNTH_WB_QUESTIONS.map((q) => structuredClone(q))];
  const count = (key: (q: RuntimeQuestion) => string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const q of questions) out[key(q)] = (out[key(q)] ?? 0) + 1;
    return out;
  };
  return {
    ...base,
    bank_version: SYNTH_BANK_VERSION,
    counts: {
      ...base.counts,
      questions: questions.length,
      families: new Set(questions.map((q) => q.family_id)).size,
      by_domain: count((q) => q.domain_id),
      by_difficulty: count((q) => q.difficulty),
      // Licznik pytań WB (kontrakt-danych.md); typ liczników rozszerza historia 1.
      source_checked_AI_draft: SYNTH_WB_QUESTIONS.length,
    } as RuntimeBank['counts'],
    sources: sources as RuntimeBank['sources'],
    topics: topics as RuntimeBank['topics'],
    questions,
  };
}

/** Bank syntetycznego wydania: 700 rekordów V18 bez zmian + 2 WB. */
export const SYNTH_BANK: RuntimeBank = synthBank();
export const SYNTH_BANK_SHA256 = sha256(JSON.stringify(SYNTH_BANK));

type AllowedRow = readonly [string, number, string, string, string, string];
const rowOf = (q: RuntimeQuestion): AllowedRow => [q.id, q.revision, q.fingerprint, q.correct_option_id, q.family_id, q.domain_id];

/** Allowlista V18 (700) policzona z `content/v18/bank.json`. */
export const V18_ROWS: readonly AllowedRow[] = V18_BANK.questions.map(rowOf);

/** Wydanie docelowe migracji v5 w testach: V18 (700) + 2 WB, poprzednik = V18. */
export const SYNTH_TARGET: BankTarget = {
  bankVersion: SYNTH_BANK_VERSION,
  bankSha256: SYNTH_BANK_SHA256,
  allowed: [...V18_ROWS, ...SYNTH_WB_QUESTIONS.map(rowOf)],
  predecessorBankVersions: [V18_BANK_VERSION],
};

/** Profil treningowy syntetycznego wydania (grupy wg działu jak w kontrakcie: SKIN / ANAT / pozostałe). */
export const SYNTH_PROFILE_RAW = (() => {
  const groups: Record<string, string[]> = { skin: [], facial_anatomy: [], other: [] };
  for (const q of SYNTH_BANK.questions) groups[q.domain_id === 'SKIN' ? 'skin' : q.domain_id === 'ANAT' ? 'facial_anatomy' : 'other']!.push(q.id);
  return { bank_version: SYNTH_BANK_VERSION, weights: { skin: 0.35, facial_anatomy: 0.25, other: 0.4 }, groups };
})();

/** Katalog syntetycznego wydania (jak w aplikacji: asercja wersji, profil). */
export function synthCatalog(): Catalog {
  const profile = parseTrainingProfile(structuredClone(SYNTH_PROFILE_RAW), SYNTH_BANK_VERSION);
  if (!profile.ok) throw new Error(profile.error.messagePl);
  const r = buildCatalog(structuredClone(SYNTH_BANK), { retiredQuestionIds: [], profile: profile.value, requiredBankVersion: SYNTH_BANK_VERSION });
  if (!r.ok) throw new Error(r.error.messagePl);
  return r.value;
}

/** Snapshot pytania WB z polami webinaru (`webinarEvidence`, `sources[].fileName`, `sources[].webinar`). */
export function webinarSnapshotOf(question: RuntimeQuestion, order: string[]): QuestionSnapshot {
  const base = snapshotOf(question, order, SYNTH_BANK);
  const raw = question as unknown as { evidence_quote: string; evidence_unit_ids: string[]; source_note_pl: string };
  const snapshot = {
    ...base,
    sources: base.sources.map((s) => {
      const src = SYNTH_BANK.sources[s.id] as unknown as { filename?: string; kind?: string } | undefined;
      return { ...s, fileName: src?.filename ?? null, webinar: src?.kind === 'user_supplied_webinar_transcript' };
    }),
    webinarEvidence: { quote: raw.evidence_quote, unitIds: [...raw.evidence_unit_ids], note: raw.source_note_pl },
  };
  return snapshot as QuestionSnapshot;
}

/** Podsumowania sesji V15 zapisane przez migrację v4 (aplikacja V18): bez treści, z `legacy`. */
export function v18LegacySessions(): Session[] {
  const legacy = (id: string, status: 'completed' | 'interrupted_by_update', patch: Partial<Session>, info: Partial<NonNullable<Session['legacy']>>): Session =>
    ({
      id,
      kind: 'test',
      status,
      createdAt: '2026-10-25T08:00:00.000Z',
      updatedAt: '2026-10-25T08:30:00.000Z',
      closedAt: '2026-10-25T08:30:00.000Z',
      revision: 9,
      mutationSeq: 5,
      config: { scope: 'ALL', difficulty: 'mixed', targetN: 20, myErrorsPriority: false },
      bankVersion: V15_BANK_VERSION,
      seed: 5,
      allocation: allocation('TEST_POLICY_V1'),
      retry: null,
      plan: [],
      slots: {},
      reached: 0,
      awaitingReplacement: [],
      events: [],
      result: null,
      freeFlow: null,
      ...patch,
      legacy: {
        reason: 'bank_v18_update',
        previousBankVersion: V15_BANK_VERSION,
        contentBankVersion: V18_BANK_VERSION,
        migratedAt: '2026-11-09T21:00:00.000Z',
        previousStatus: 'completed',
        answeredValid: 20,
        correct: 15,
        excluded: 0,
        planLength: 20,
        ...info,
      },
    }) as Session;
  return [
    legacy('sess-v15-done', 'completed', { result: { correct: 15, targetN: 20, passed: true, percent: 75 } }, {}),
    legacy('sess-v15-open', 'interrupted_by_update', { createdAt: '2026-10-26T08:00:00.000Z', updatedAt: '2026-10-26T08:10:00.000Z', closedAt: '2026-10-26T08:10:00.000Z' }, { previousStatus: 'open', answeredValid: 4, correct: 3 }),
  ];
}

/**
 * Profil z aplikacji V18 (baza v4): `sampleUserData()` w wersji V18 (ukończony test, otwarta runda błędów
 * ze zgłoszeniem i zastępstwem, zakończony Free Flow, próby, powtórki, blokada), otwarty Free Flow z jedną
 * błędną odpowiedzią, pusta otwarta sesja (bez slotów) oraz podsumowania V15 z migracji v4.
 */
export function v18ProfileData(): BackupData {
  const data = profileData(V18_BANK_VERSION, (_i, q) => q);
  const q8 = BANK.questions[7]!;
  const t4 = '2026-11-12T19:00:00.000Z';
  const slot4 = makeSlot('s4-a', q8, { createdAt: t4, origin: 'freeflow', answer: { commandId: 'cmd-8', optionId: wrongOption(q8), at: '2026-11-12T19:01:00.000Z' } });
  const s4Start: DmeEvent = { id: 'ev-s4-start', at: t4, commandId: 'cmd-start-4', type: 'session_started', sessionId: 'sess-4', kind: 'freeflow' };
  const s4: Session = {
    id: 'sess-4',
    kind: 'freeflow',
    status: 'open',
    createdAt: t4,
    updatedAt: '2026-11-12T19:01:00.000Z',
    closedAt: null,
    revision: 3,
    mutationSeq: 2,
    config: { scope: 'ALL', difficulty: 'mixed', targetN: null, myErrorsPriority: false },
    bankVersion: V18_BANK_VERSION,
    seed: 99,
    allocation: allocation('FREE_FLOW_POLICY_V1'),
    retry: null,
    plan: ['s4-a'],
    slots: { 's4-a': { ...slot4, snapshot: { ...slot4.snapshot, bankVersion: V18_BANK_VERSION } } },
    reached: 0,
    awaitingReplacement: [],
    events: [s4Start],
    result: null,
    freeFlow: { myErrorsExhaustedNotified: false, empty: false, picks: 1 },
  };
  // Pusta otwarta sesja (np. zakres bez dostępnych pytań) — starsza niż otwarty Free Flow.
  const t5 = '2026-11-11T07:00:00.000Z';
  const s5Start: DmeEvent = { id: 'ev-s5-start', at: t5, commandId: 'cmd-start-5', type: 'session_started', sessionId: 'sess-5', kind: 'freeflow' };
  const s5: Session = {
    ...s4,
    id: 'sess-5',
    createdAt: t5,
    updatedAt: t5,
    revision: 1,
    mutationSeq: 1,
    config: { scope: 'SAFE', difficulty: 'mixed', targetN: null, myErrorsPriority: true },
    seed: 77,
    plan: [],
    slots: {},
    reached: 0,
    events: [s5Start],
    freeFlow: { myErrorsExhaustedNotified: false, empty: true, picks: 0 },
  };
  const attempt4 = attemptFor(s4, s4.slots['s4-a']!, q8);
  const stat4: QuestionStat = {
    questionId: q8.id,
    familyId: q8.family_id,
    domainId: q8.domain_id,
    seenCount: 1,
    firstSeenAt: t4,
    lastSeenAt: t4,
    answeredCount: 1,
    correctCount: 0,
    wrongCount: 1,
    lastAnsweredAt: '2026-11-12T19:01:00.000Z',
    activeError: true,
    streak: 0,
    dueAt: '2026-11-12T23:00:00.000Z',
    lastWrongAt: '2026-11-12T19:01:00.000Z',
    lastWrongSessionId: 'sess-4',
    streakSessionId: null,
    resolvedAt: null,
  };
  return {
    settings: data.settings,
    sessions: [...v18LegacySessions(), ...data.sessions, s4, s5],
    attempts: [...data.attempts, attempt4],
    questionStats: [...data.questionStats, stat4],
    blocks: data.blocks,
    events: [...data.events, s4Start, s5Start],
    packs: [],
  };
}

/**
 * Dane profilu z sesją pytań WB w syntetycznym wydaniu: zakończony Free Flow (WB-LIGHT-001 dobrze,
 * WB-PIGMENT-001 źle), snapshoty z polami webinaru, próby, stan powtórek i zdarzenia.
 */
export function webinarProfileData(): BackupData {
  const [wb1, wb2] = SYNTH_WB_QUESTIONS as [RuntimeQuestion, RuntimeQuestion];
  const t0 = '2026-11-15T18:00:00.000Z';
  const slotOf = (id: string, q: RuntimeQuestion, optionId: string, at: string): Slot => {
    const slot = makeSlot(id, q, { createdAt: t0, origin: 'freeflow', answer: { commandId: `cmd-${id}`, optionId, at } });
    return { ...slot, snapshot: { ...webinarSnapshotOf(q, slot.optionOrder), bankVersion: SYNTH_BANK_VERSION } };
  };
  const slots = [slotOf('wb-a', wb1, wb1.correct_option_id, '2026-11-15T18:01:00.000Z'), slotOf('wb-b', wb2, wrongOption(wb2), '2026-11-15T18:02:00.000Z')];
  const events: DmeEvent[] = [
    { id: 'ev-wb-start', at: t0, commandId: 'cmd-wb-start', type: 'session_started', sessionId: 'sess-wb', kind: 'freeflow' },
    { id: 'ev-wb-end', at: '2026-11-15T18:03:00.000Z', commandId: 'cmd-wb-end', type: 'freeflow_ended', sessionId: 'sess-wb', answeredValid: 2, correct: 1 },
  ];
  const session: Session = {
    id: 'sess-wb',
    kind: 'freeflow',
    status: 'ended',
    createdAt: t0,
    updatedAt: '2026-11-15T18:03:00.000Z',
    closedAt: '2026-11-15T18:03:00.000Z',
    revision: 5,
    mutationSeq: 3,
    config: { scope: 'ALL', difficulty: 'mixed', targetN: null, myErrorsPriority: false },
    bankVersion: SYNTH_BANK_VERSION,
    seed: 2026,
    allocation: allocation('FREE_FLOW_POLICY_V1'),
    retry: null,
    plan: slots.map((s) => s.id),
    slots: Object.fromEntries(slots.map((s) => [s.id, s])),
    reached: 1,
    awaitingReplacement: [],
    events,
    result: null,
    freeFlow: { myErrorsExhaustedNotified: false, empty: false, picks: 2 },
  };
  const attempts = [attemptFor(session, slots[0]!, wb1), attemptFor(session, slots[1]!, wb2)];
  const stat = (q: RuntimeQuestion, wrong: boolean): QuestionStat => ({
    questionId: q.id,
    familyId: q.family_id,
    domainId: q.domain_id,
    seenCount: 1,
    firstSeenAt: t0,
    lastSeenAt: t0,
    answeredCount: 1,
    correctCount: wrong ? 0 : 1,
    wrongCount: wrong ? 1 : 0,
    lastAnsweredAt: t0,
    activeError: wrong,
    streak: 0,
    dueAt: wrong ? '2026-11-15T23:00:00.000Z' : null,
    lastWrongAt: wrong ? t0 : null,
    lastWrongSessionId: wrong ? 'sess-wb' : null,
    streakSessionId: null,
    resolvedAt: null,
  });
  const settings: Settings = { id: 'settings', lastTestConfig: null, lastFreeFlowConfig: session.config, installHintDismissedAt: null, persistRequestedAt: null, updatedAt: t0 };
  return { settings: [settings], sessions: [session], attempts, questionStats: [stat(wb1, false), stat(wb2, true)], blocks: [], events, packs: [] };
}
