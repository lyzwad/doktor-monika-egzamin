/**
 * Dane testowe trwałości: rekordy użytkownika zbudowane z prawdziwych pytań `public/data/bank.json`
 * (snapshoty, próby, statystyki, blokada ze zgłoszenia), paczki pytań i fabryka repozytorium
 * na świeżej instancji fake-indexeddb. Wyłącznie do testów.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { fingerprintRuntimeQuestion } from '../../src/domain/fingerprint';
import type {
  Attempt,
  Block,
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
import { createIndexedDbRepository } from '../../src/persistence/repository';
import type { InternalRepositoryOptions } from '../../src/persistence/repository';
import type { PackCatalogView } from '../../src/persistence/packs';

export const BANK = JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/bank.json'), 'utf-8')) as RuntimeBank;

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

export function snapshotOf(question: RuntimeQuestion, order: string[]): QuestionSnapshot {
  const domain = BANK.domains.find((d) => d.id === question.domain_id);
  return {
    questionId: question.id,
    revision: question.revision,
    bankVersion: BANK.bank_version,
    familyId: question.family_id,
    fingerprint: question.fingerprint,
    domainId: question.domain_id,
    domainTitle: domain?.title_pl ?? question.domain_id,
    topicIds: [...question.topic_ids],
    topics: question.topic_ids.map((id) => {
      const topic = BANK.topics[id];
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
      const source = BANK.sources[id];
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
/* Paczki pytań                                                               */
/* ========================================================================== */

/** Widok katalogu z banku (bez paczek). */
export function bankCatalogView(): PackCatalogView {
  return {
    questionsById: Object.fromEntries(
      BANK.questions.map((q) => [
        q.id,
        {
          revision: q.revision,
          fingerprint: q.fingerprint,
          familyId: q.family_id,
          domainId: q.domain_id,
          difficulty: q.difficulty,
          stem: q.stem_pl,
          options: q.options.map((o) => ({ id: o.id, text: o.text_pl })),
          correctOptionId: q.correct_option_id,
          explanation: q.correct_explanation_pl,
        },
      ]),
    ),
    topics: BANK.topics,
    figures: BANK.figures,
  };
}

/** Nowe pytanie (nowe ID, rodzina i treść) na bazie pytania z banku, z przeliczonym fingerprintem. */
export async function derivedQuestion(base: RuntimeQuestion, newId: string, stemSuffix = ' (wariant z paczki)'): Promise<RuntimeQuestion> {
  const question: RuntimeQuestion = {
    ...structuredClone(base),
    id: newId,
    family_id: `${newId}-F`,
    stem_pl: `${base.stem_pl}${stemSuffix}`,
  };
  question.fingerprint = await fingerprintRuntimeQuestion(question);
  return question;
}

/** Plik puli w formacie runtime v1 (rejestry źródeł/tematów z banku dla użytych ID). */
export function runtimePack(questions: RuntimeQuestion[], patch: Record<string, unknown> = {}): Record<string, unknown> {
  const sourceIds = new Set(questions.flatMap((q) => q.source_ids));
  const topicIds = new Set(questions.flatMap((q) => q.topic_ids));
  return {
    format: 'dme-runtime-bank',
    format_version: 1,
    schema_version: '1.0',
    bank_version: 'paczka-test-2026-10-22',
    built_on: '2026-10-22',
    clinical_signoff: false,
    official_exam_question_bank: false,
    status_pl: 'Paczka testowa.',
    counts: {},
    domains: BANK.domains,
    topics: Object.fromEntries([...topicIds].map((id) => [id, BANK.topics[id]])),
    sources: Object.fromEntries([...sourceIds].map((id) => [id, BANK.sources[id]])),
    figures: {},
    questions,
    ...patch,
  };
}

/** Plik puli w schemacie banku 1.0 (bez fingerprintów, z rejestrem źródeł jako listą). */
export function bank10Pack(questions: RuntimeQuestion[], patch: Record<string, unknown> = {}): Record<string, unknown> {
  const sourceIds = new Set(questions.flatMap((q) => q.source_ids));
  return {
    schema_version: '1.0',
    bank_version: 'paczka-bank10-2026-10-22',
    clinical_signoff: false,
    official_exam_question_bank: false,
    sources: [...sourceIds].map((id) => {
      const s = BANK.sources[id];
      return { id, title: s?.title, url: s?.url, doi: s?.doi, pmid: s?.pmid, kind: s?.kind, access: s?.access, checked_on: s?.checked_on };
    }),
    questions: questions.map((q) => {
      const copy: Record<string, unknown> = { ...structuredClone(q) };
      delete copy.fingerprint;
      delete copy.content_check_status;
      return copy;
    }),
    ...patch,
  };
}
