/**
 * Transformacja danych użytkownika do banku V15 (docs/MIGRACJA_V15.md) — czysta funkcja, wspólna dla:
 *  - migracji IndexedDB (schemat v2, transakcja `versionchange`, ./schema.ts),
 *  - wczytania kopii danych (`dme-backup` v1 sprzed migracji albo eksport ze starej aplikacji),
 *  - eksportu kopii (zabezpieczenie: plik nigdy nie zawiera treści innej wersji banku).
 *
 * Zasady:
 *  - sesja banku V15 (`bankVersion` = V15, wszystkie snapshoty V15) zostaje bez zmian;
 *  - sesja innej wersji: treść usunięta (`slots = {}`, `plan = []`), podsumowanie w `legacy`
 *    (liczby policzone ze slotów PRZED usunięciem; wynik ukończonego testu bez zmian), `revision + 1`;
 *    sesja otwarta → `interrupted_by_update` (bez wyniku, niewznawialna, poza wykresem);
 *  - `questionStats` i dziennik prób zostają WYŁĄCZNIE dla pytań potwierdzonych jako niezmienione
 *    (lista ID + fingerprint z ./v15Carryover.ts, zgodna z każdym snapshotem i próbą tego pytania);
 *    pozostałe są usuwane (powtórki od zera, wyłączone ID znikają z kolejek);
 *  - blokady: aktywne tylko dla niezmienionych rekordów; pozostałe → `revokedAt`, `inactiveReason`,
 *    `stemPreview = ''` (bez treści);
 *  - zdarzenia nie zawierają treści — zostają; paczki pytań są odrzucane.
 * Idempotentna: ponowne wykonanie na wyniku daje ten sam wynik (sesje `legacy` nie są zmieniane).
 */
import { CONTENT_RELEASE } from '../domain/contentRelease';
import type { Attempt, Block, DmeEvent, IsoDateTime, LegacySessionInfo, QuestionStat, Session, Slot } from '../domain/types';
import { V15_UNCHANGED } from './v15Carryover';

export const V15_MIGRATION_ID = 'bank-v15';

/** Rekordy magazynów użytkownika objęte transformacją (ustawienia nie są zmieniane). */
export interface V15TransformInput {
  sessions: readonly unknown[];
  attempts: readonly unknown[];
  questionStats: readonly unknown[];
  blocks: readonly unknown[];
  events: readonly unknown[];
  packs?: readonly unknown[];
}

export interface V15TransformReport {
  migrationId: typeof V15_MIGRATION_ID;
  contentBankVersion: string;
  at: IsoDateTime;
  sessionsV15: number;
  sessionsLegacy: number;
  /** W tym: otwarte → `interrupted_by_update`. */
  sessionsInterrupted: number;
  attemptsKept: number;
  attemptsRemoved: number;
  questionStatsKept: number;
  questionStatsReset: number;
  blocksKept: number;
  blocksDeactivated: number;
  packsRemoved: number;
  malformedDropped: number;
}

export interface V15TransformResult {
  sessions: Session[];
  attempts: Attempt[];
  questionStats: QuestionStat[];
  blocks: Block[];
  events: DmeEvent[];
  report: V15TransformReport;
}

const UNCHANGED = new Map<string, { revision: number; fingerprint: string }>(V15_UNCHANGED.map(([id, revision, fingerprint]) => [id, { revision, fingerprint }]));

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Sesja w całości banku V15 (wersja sesji i każdego snapshotu). */
export function isV15Session(session: Session): boolean {
  if (session.legacy) return false;
  if (session.bankVersion !== CONTENT_RELEASE.bankVersion) return false;
  return Object.values(isObj(session.slots) ? session.slots : {}).every((slot) => isObj(slot) && isObj(slot.snapshot) && slot.snapshot.bankVersion === CONTENT_RELEASE.bankVersion);
}

/** Liczby sesji ze slotów (jak `validCounts` w domenie) — przed usunięciem treści. */
function countsOf(session: Session): { answered: number; correct: number; excluded: number } {
  let answered = 0;
  let correct = 0;
  let excluded = 0;
  const plan = Array.isArray(session.plan) ? session.plan : [];
  const slots: Record<string, Slot> = isObj(session.slots) ? (session.slots as Record<string, Slot>) : {};
  for (const s of Object.values(slots)) if (isObj(s) && s.excluded) excluded++;
  for (const id of plan) {
    const s = slots[id];
    if (!isObj(s) || s.excluded) continue;
    if (!s.attempt) continue;
    answered++;
    if (s.attempt.correct === true) correct++;
  }
  return { answered, correct, excluded };
}

function toLegacy(session: Session, now: IsoDateTime): Session {
  const { answered, correct, excluded } = countsOf(session);
  const open = session.status === 'open';
  const legacy: LegacySessionInfo = {
    reason: 'bank_v15_update',
    previousBankVersion: typeof session.bankVersion === 'string' ? session.bankVersion : '',
    contentBankVersion: CONTENT_RELEASE.bankVersion,
    migratedAt: now,
    previousStatus: session.status,
    // Ukończony test: liczby wyniku bez zmian (nie przeliczamy wyniku).
    answeredValid: session.status === 'completed' && session.result ? session.result.targetN : answered,
    correct: session.status === 'completed' && session.result ? session.result.correct : correct,
    excluded,
    planLength: Array.isArray(session.plan) ? session.plan.length : 0,
  };
  return {
    ...session,
    status: open ? 'interrupted_by_update' : session.status,
    closedAt: open ? (session.closedAt ?? session.updatedAt) : session.closedAt,
    result: open ? null : session.result,
    revision: (Number.isSafeInteger(session.revision) ? session.revision : 0) + 1,
    mutationSeq: (Number.isSafeInteger(session.mutationSeq) ? session.mutationSeq : 0) + 1,
    plan: [],
    slots: {},
    reached: 0,
    awaitingReplacement: [],
    legacy,
  };
}

/** Normalizacja sesji już przekształconej (idempotencja; sesja legacy nigdy nie jest otwarta). */
function normalizeLegacy(session: Session): Session {
  const plain = { ...session, plan: [], slots: {}, reached: 0, awaitingReplacement: [] };
  return session.status === 'open' ? { ...plain, status: 'interrupted_by_update', result: null, closedAt: session.closedAt ?? session.updatedAt } : plain;
}

export function transformToV15(input: V15TransformInput, now: IsoDateTime): V15TransformResult {
  let malformed = 0;
  const rawSessions = input.sessions.filter((s): s is Session => {
    const okShape = isObj(s) && typeof s.id === 'string' && typeof s.status === 'string';
    if (!okShape) malformed++;
    return okShape;
  });

  // Pytania potwierdzone jako niezmienione: lista + zgodność każdego snapshotu i każdej próby.
  const contradicted = new Set<string>();
  for (const s of rawSessions) {
    if (s.legacy) continue;
    for (const slot of Object.values(isObj(s.slots) ? (s.slots as Record<string, Slot>) : {})) {
      if (!isObj(slot) || !isObj(slot.snapshot)) continue;
      const ref = UNCHANGED.get(slot.questionId);
      if (ref && (slot.snapshot.fingerprint !== ref.fingerprint || slot.snapshot.revision !== ref.revision)) contradicted.add(slot.questionId);
    }
  }
  for (const a of input.attempts) {
    if (!isObj(a) || typeof a.questionId !== 'string') continue;
    const ref = UNCHANGED.get(a.questionId);
    if (ref && a.questionRevision !== ref.revision) contradicted.add(a.questionId);
  }
  const confirmed = (questionId: unknown): boolean => typeof questionId === 'string' && UNCHANGED.has(questionId) && !contradicted.has(questionId);

  let v15 = 0;
  let legacyCount = 0;
  let interrupted = 0;
  const sessions = rawSessions.map((s) => {
    if (s.legacy) {
      legacyCount++;
      return normalizeLegacy(s);
    }
    if (isV15Session(s)) {
      v15++;
      return s;
    }
    legacyCount++;
    if (s.status === 'open') interrupted++;
    return toLegacy(s, now);
  });
  const sessionIds = new Set(sessions.map((s) => s.id));
  const v15SessionIds = new Set(sessions.filter((s) => !s.legacy).map((s) => s.id));

  // Próby: sesje V15 — bez zmian; sesje poprzedniej wersji — tylko pytania niezmienione.
  const attempts: Attempt[] = [];
  let attemptsRemoved = 0;
  for (const a of input.attempts) {
    if (!isObj(a) || typeof a.id !== 'string' || typeof a.sessionId !== 'string' || !sessionIds.has(a.sessionId)) {
      attemptsRemoved++;
      continue;
    }
    if (v15SessionIds.has(a.sessionId) || confirmed(a.questionId)) attempts.push(a as unknown as Attempt);
    else attemptsRemoved++;
  }

  // Stan powtórek: tylko niezmienione rekordy (oraz pytania odpowiadane wyłącznie w sesjach V15).
  const v15Questions = new Set<string>();
  for (const s of sessions) {
    if (s.legacy) continue;
    for (const slot of Object.values(s.slots)) v15Questions.add(slot.questionId);
  }
  const legacyTouched = new Set<string>();
  for (const s of rawSessions) {
    if (isV15Session(s) || s.legacy) continue;
    for (const slot of Object.values(isObj(s.slots) ? (s.slots as Record<string, Slot>) : {})) if (isObj(slot)) legacyTouched.add(slot.questionId);
  }
  const questionStats: QuestionStat[] = [];
  let statsReset = 0;
  for (const st of input.questionStats) {
    if (!isObj(st) || typeof st.questionId !== 'string') {
      statsReset++;
      continue;
    }
    const qid = st.questionId;
    // Niezmienione rekordy — zawsze; pozostałe — tylko gdy pochodzą wyłącznie z sesji banku V15
    // (np. ponowne wczytanie kopii zapisanej już po migracji). Ślad w starej sesji → reset.
    const keep = confirmed(qid) || (v15Questions.has(qid) && !legacyTouched.has(qid));
    if (keep) questionStats.push(st as unknown as QuestionStat);
    else statsReset++;
  }

  // Blokady: aktywne tylko dla niezmienionych rekordów; pozostałe nieaktywne i bez treści.
  const blocks: Block[] = [];
  let blocksKept = 0;
  let blocksDeactivated = 0;
  for (const b of input.blocks) {
    if (!isObj(b) || typeof b.id !== 'string') {
      malformed++;
      continue;
    }
    const block = b as unknown as Block;
    const ref = UNCHANGED.get(block.questionId);
    const v15Block = block.sessionId !== null && v15SessionIds.has(block.sessionId as string);
    const unchanged = ref !== undefined && !contradicted.has(block.questionId) && block.fingerprint === ref.fingerprint;
    if (block.inactiveReason === 'bank_version_changed') {
      blocks.push({ ...block, stemPreview: '' });
      blocksDeactivated++;
    } else if (unchanged || v15Block) {
      blocks.push(block);
      blocksKept++;
    } else {
      blocks.push({ ...block, stemPreview: '', revokedAt: block.revokedAt ?? now, inactiveReason: 'bank_version_changed' });
      blocksDeactivated++;
    }
  }

  const events = input.events.filter((e): e is DmeEvent => isObj(e) && typeof e.id === 'string');

  return {
    sessions,
    attempts,
    questionStats,
    blocks,
    events,
    report: {
      migrationId: V15_MIGRATION_ID,
      contentBankVersion: CONTENT_RELEASE.bankVersion,
      at: now,
      sessionsV15: v15,
      sessionsLegacy: legacyCount,
      sessionsInterrupted: interrupted,
      attemptsKept: attempts.length,
      attemptsRemoved,
      questionStatsKept: questionStats.length,
      questionStatsReset: statsReset,
      blocksKept,
      blocksDeactivated,
      packsRemoved: Array.isArray(input.packs) ? input.packs.length : 0,
      malformedDropped: malformed,
    },
  };
}
