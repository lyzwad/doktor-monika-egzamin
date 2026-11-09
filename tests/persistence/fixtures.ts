/**
 * Dane testowe trwałości: rekordy użytkownika zbudowane z prawdziwych pytań bieżącego banku (V18)
 * (snapshoty, próby, statystyki, blokada ze zgłoszenia), paczki pytań i fabryka repozytorium
 * na świeżej instancji fake-indexeddb. Wyłącznie do testów.
 */
import { createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { fingerprintRuntimeQuestion } from '../../src/domain/fingerprint';
import type {
  Attempt,
  Block,
  Changeset,
  DmeEvent,
  QuestionSnapshot,
  QuestionStat,
  RuntimeQuestion,
  Session,
  Settings,
  Slot,
} from '../../src/domain/types';
import type { BackupData, Repository } from '../../src/persistence/api';
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
