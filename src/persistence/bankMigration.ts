/**
 * Transformacja danych użytkownika do bieżącego banku V18 (docs/MIGRACJA_V18.md) — czysta, synchroniczna
 * funkcja, wspólna dla:
 *  - migracji IndexedDB każdego profilu (schemat v4, transakcja `versionchange`, ./schema.ts),
 *  - wczytania kopii danych (dowolna starsza wersja aplikacji i banku),
 *  - eksportu kopii (plik nigdy nie zawiera treści pytań spoza allowlisty).
 *
 * Jedyną podstawą decyzji jest allowlista paczki V18 (./v18Allowlist.ts: 700 ID z rewizją, fingerprintem
 * i kluczem). Nie stosujemy reguł prefiksów i nigdy nie przypisujemy dawnych odpowiedzi do innych ID.
 *
 * Pytanie „zgodne” = ID z allowlisty, a każdy jego snapshot w danych ma tę samą rewizję, fingerprint
 * (treść + opcje) i klucz co paczka, każda próba tę samą rewizję.
 *  - sesja bieżącego banku (wersja V18, wszystkie snapshoty V18) — bez zmian;
 *  - sesja innej wersji (np. samodzielne V16 / V17), w której WSZYSTKIE pozycje są zgodne — zostaje aktywna
 *    (także otwarta, do dokończenia): `bankVersion` sesji i snapshotów = V18, `revision + 1`;
 *  - pozostałe sesje (V15, starsze, mieszane, z niezgodną treścią): treść usunięta (`slots = {}`, `plan = []`),
 *    podsumowanie liczbowe w `legacy`; otwarta → `interrupted_by_update` (niewznawialna, poza wykresem);
 *  - próby i stan powtórek: tylko pytań zgodnych (oraz pytań odpowiadanych wyłącznie w zachowanych sesjach);
 *  - zgłoszenia (blokady): aktywne tylko dla pytań zgodnych; pozostałe nieaktywne i bez początku treści;
 *  - zdarzenia nie zawierają treści — zostają; zaimportowane paczki pytań są odrzucane;
 *  - ustawienia: filtr trudności ostatnich konfiguracji → „cała pula” (`mixed`).
 * Idempotentna: ponowne wykonanie na wyniku daje ten sam wynik (sesje `legacy` nie są zmieniane).
 */
import { CONTENT_RELEASE } from '../domain/contentRelease';
import type { Attempt, Block, DmeEvent, IsoDateTime, LegacySessionInfo, QuestionStat, Session, Settings, Slot } from '../domain/types';
import { V18_ALLOWED } from './v18Allowlist';

export const BANK_MIGRATION_ID = 'bank-v18';

/** Rekordy magazynów użytkownika objęte transformacją. */
export interface BankTransformInput {
  sessions: readonly unknown[];
  attempts: readonly unknown[];
  questionStats: readonly unknown[];
  blocks: readonly unknown[];
  events: readonly unknown[];
  packs?: readonly unknown[];
}

export interface BankTransformReport {
  migrationId: typeof BANK_MIGRATION_ID;
  contentBankVersion: string;
  at: IsoDateTime;
  /** Sesje aktywne po migracji (w tym przeniesione z V16/V17). */
  sessionsCurrent: number;
  /** W tym: sesje innej wersji banku, w całości zgodne z allowlistą (`bankVersion` → V18). */
  sessionsRestamped: number;
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
  /** Automatyczne kopie bezpieczeństwa w bazie przekształcone tą samą funkcją (tylko migracja IndexedDB). */
  backupsTransformed?: number;
  /** Kopie bezpieczeństwa nieczytelne (usunięte, bo mogły zawierać dawną treść). */
  backupsRemoved?: number;
  malformedDropped: number;
}

export interface BankTransformResult {
  sessions: Session[];
  attempts: Attempt[];
  questionStats: QuestionStat[];
  blocks: Block[];
  events: DmeEvent[];
  report: BankTransformReport;
}

interface AllowedRef {
  revision: number;
  fingerprint: string;
  correctOptionId: string;
}

const ALLOWED = new Map<string, AllowedRef>(V18_ALLOWED.map(([id, revision, fingerprint, correctOptionId]) => [id, { revision, fingerprint, correctOptionId }]));

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function slotsOf(session: Session): Slot[] {
  return Object.values(isObj(session.slots) ? (session.slots as Record<string, Slot>) : {});
}

/** Snapshot zgodny z paczką V18 (ID z allowlisty, ta sama rewizja, fingerprint i klucz). */
function snapshotMatches(slot: unknown): boolean {
  if (!isObj(slot) || !isObj(slot.snapshot) || typeof slot.questionId !== 'string') return false;
  const ref = ALLOWED.get(slot.questionId);
  const snap = slot.snapshot;
  return ref !== undefined && snap.questionId === slot.questionId && snap.revision === ref.revision && snap.fingerprint === ref.fingerprint && snap.correctOptionId === ref.correctOptionId;
}

/** Sesja w całości bieżącego banku (wersja sesji i każdego snapshotu). */
export function isCurrentBankSession(session: Session): boolean {
  if (session.legacy) return false;
  if (session.bankVersion !== CONTENT_RELEASE.bankVersion) return false;
  return slotsOf(session).every((slot) => isObj(slot) && isObj(slot.snapshot) && slot.snapshot.bankVersion === CONTENT_RELEASE.bankVersion);
}

/** Sesja innej wersji banku, której każda pozycja jest zgodna z allowlistą (plan wskazuje istniejące pozycje). */
function isTransferable(session: Session): boolean {
  if (session.legacy) return false;
  if (!Array.isArray(session.plan) || !isObj(session.slots)) return false;
  const slots = session.slots as Record<string, Slot>;
  if (!session.plan.every((id) => isObj(slots[id]))) return false;
  return slotsOf(session).every(snapshotMatches);
}

function restamp(session: Session): Session {
  const slots: Record<string, Slot> = {};
  for (const [key, slot] of Object.entries(session.slots)) slots[key] = { ...slot, snapshot: { ...slot.snapshot, bankVersion: CONTENT_RELEASE.bankVersion } };
  return {
    ...session,
    bankVersion: CONTENT_RELEASE.bankVersion,
    slots,
    revision: (Number.isSafeInteger(session.revision) ? session.revision : 0) + 1,
    mutationSeq: (Number.isSafeInteger(session.mutationSeq) ? session.mutationSeq : 0) + 1,
  };
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
    reason: 'bank_v18_update',
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

/** Normalizacja sesji już przekształconej (idempotencja; sesja legacy nigdy nie jest otwarta i nie ma treści). */
function normalizeLegacy(session: Session): Session {
  const plain = { ...session, plan: [], slots: {}, reached: 0, awaitingReplacement: [] };
  const already = Array.isArray(session.plan) && session.plan.length === 0 && isObj(session.slots) && Object.keys(session.slots).length === 0 && session.reached === 0 && Array.isArray(session.awaitingReplacement) && session.awaitingReplacement.length === 0;
  if (session.status === 'open') return { ...plain, status: 'interrupted_by_update', result: null, closedAt: session.closedAt ?? session.updatedAt };
  return already ? session : plain;
}

/** Ustawienia: ostatnie konfiguracje bez filtra trudności (cała pula V18); reszta bez zmian. */
export function settingsForCurrentBank(settings: Settings): Settings {
  const fix = <C extends { difficulty?: unknown } | null | undefined>(config: C): C => (isObj(config) && config.difficulty !== 'mixed' ? { ...config, difficulty: 'mixed' } : config);
  const lastTestConfig = fix(settings.lastTestConfig);
  const lastFreeFlowConfig = fix(settings.lastFreeFlowConfig);
  if (lastTestConfig === settings.lastTestConfig && lastFreeFlowConfig === settings.lastFreeFlowConfig) return settings;
  return { ...settings, lastTestConfig, lastFreeFlowConfig };
}

export function transformToCurrentBank(input: BankTransformInput, now: IsoDateTime): BankTransformResult {
  let malformed = 0;
  const rawSessions = input.sessions.filter((s): s is Session => {
    const okShape = isObj(s) && typeof s.id === 'string' && typeof s.status === 'string';
    if (!okShape) malformed++;
    return okShape;
  });

  // Pytania zgodne: ID z allowlisty, bez sprzecznego snapshotu ani próby innej rewizji.
  const contradicted = new Set<string>();
  for (const s of rawSessions) {
    if (s.legacy) continue;
    for (const slot of slotsOf(s)) {
      if (!isObj(slot) || typeof slot.questionId !== 'string') continue;
      if (ALLOWED.has(slot.questionId) && !snapshotMatches(slot)) contradicted.add(slot.questionId);
    }
  }
  for (const a of input.attempts) {
    if (!isObj(a) || typeof a.questionId !== 'string') continue;
    const ref = ALLOWED.get(a.questionId);
    if (ref && a.questionRevision !== ref.revision) contradicted.add(a.questionId);
  }
  const confirmed = (questionId: unknown): boolean => typeof questionId === 'string' && ALLOWED.has(questionId) && !contradicted.has(questionId);

  let current = 0;
  let restamped = 0;
  let legacyCount = 0;
  let interrupted = 0;
  const sessions = rawSessions.map((s) => {
    if (s.legacy) {
      legacyCount++;
      return normalizeLegacy(s);
    }
    if (isCurrentBankSession(s) && slotsOf(s).every(snapshotMatches)) {
      current++;
      return s;
    }
    if (isTransferable(s)) {
      current++;
      restamped++;
      return restamp(s);
    }
    legacyCount++;
    if (s.status === 'open') interrupted++;
    return toLegacy(s, now);
  });
  const sessionIds = new Set(sessions.map((s) => s.id));
  const keptSessionIds = new Set(sessions.filter((s) => !s.legacy).map((s) => s.id));

  // Próby: zachowane sesje — bez zmian; pozostałe — tylko pytania zgodne.
  const attempts: Attempt[] = [];
  let attemptsRemoved = 0;
  for (const a of input.attempts) {
    if (!isObj(a) || typeof a.id !== 'string' || typeof a.sessionId !== 'string' || !sessionIds.has(a.sessionId)) {
      attemptsRemoved++;
      continue;
    }
    if (confirmed(a.questionId) || (keptSessionIds.has(a.sessionId) && ALLOWED.has(a.questionId as string))) attempts.push(a as unknown as Attempt);
    else attemptsRemoved++;
  }

  // Stan powtórek: tylko pytania zgodne.
  const questionStats: QuestionStat[] = [];
  let statsReset = 0;
  for (const st of input.questionStats) {
    if (isObj(st) && confirmed(st.questionId)) questionStats.push(st as unknown as QuestionStat);
    else statsReset++;
  }

  // Zgłoszenia: aktywne tylko dla pytań zgodnych (ten sam fingerprint); pozostałe nieaktywne i bez treści.
  const blocks: Block[] = [];
  let blocksKept = 0;
  let blocksDeactivated = 0;
  for (const b of input.blocks) {
    if (!isObj(b) || typeof b.id !== 'string') {
      malformed++;
      continue;
    }
    const block = b as unknown as Block;
    const ref = ALLOWED.get(block.questionId);
    const matches = ref !== undefined && confirmed(block.questionId) && block.fingerprint === ref.fingerprint;
    if (block.inactiveReason === 'bank_version_changed') {
      blocks.push(block.stemPreview === '' ? block : { ...block, stemPreview: '' });
      blocksDeactivated++;
    } else if (matches) {
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
      migrationId: BANK_MIGRATION_ID,
      contentBankVersion: CONTENT_RELEASE.bankVersion,
      at: now,
      sessionsCurrent: current,
      sessionsRestamped: restamped,
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
