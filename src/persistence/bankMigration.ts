/**
 * Transformacja danych użytkownika do wydania treści (docs/MIGRACJA_V18.md; spec-webinary-247) — czysta,
 * synchroniczna funkcja, wspólna dla:
 *  - migracji IndexedDB każdego profilu (schemat v5, transakcja `versionchange`, ./schema.ts),
 *  - wczytania kopii danych (dowolna starsza wersja aplikacji i banku),
 *  - eksportu kopii (plik nigdy nie zawiera treści pytań spoza allowlisty).
 *
 * Wydanie docelowe (`BankTarget`) jest parametrem: wersja banku, SHA banku, allowlista (ID z rewizją,
 * fingerprintem i kluczem) i wersje-poprzednicy. Domyślnie bieżące wydanie (`CONTENT_RELEASE` + ./v18Allowlist.ts,
 * poprzednik V18). Jedyną podstawą decyzji jest allowlista. Nie stosujemy reguł prefiksów i nigdy nie
 * przypisujemy dawnych odpowiedzi do innych ID.
 *
 * Pytanie „zgodne” = ID z allowlisty, a każdy jego snapshot w danych ma tę samą rewizję, fingerprint
 * (treść + opcje) i klucz co wydanie, każda próba tę samą rewizję.
 *  - sesja wydania docelowego (wersja sesji i wszystkich snapshotów) — bez zmian;
 *  - sesja innej wersji (np. V18 przed wydaniem z webinarami, samodzielne V16 / V17), w której WSZYSTKIE pozycje
 *    są zgodne — zostaje aktywna (także otwarta, do dokończenia): `bankVersion` sesji i snapshotów = wydanie,
 *    `revision + 1`; sesja bez pozycji (pusta) zostaje aktywna tylko dla wersji-poprzednika (V18);
 *  - pozostałe sesje (V15, starsze, mieszane, z niezgodną treścią, puste innych wersji): treść usunięta
 *    (`slots = {}`, `plan = []`), podsumowanie liczbowe w `legacy`; otwarta → `interrupted_by_update`
 *    (niewznawialna, poza wykresem);
 *  - próby i stan powtórek: tylko pytań zgodnych (oraz pytań odpowiadanych wyłącznie w zachowanych sesjach);
 *  - zgłoszenia (blokady): aktywne tylko dla pytań zgodnych; pozostałe nieaktywne i bez początku treści;
 *  - zdarzenia nie zawierają treści — zostają; zaimportowane paczki pytań są odrzucane;
 *  - ustawienia: filtr trudności ostatnich konfiguracji → „cała pula” (`mixed`).
 * Idempotentna: ponowne wykonanie na wyniku daje ten sam wynik (sesje `legacy` nie są zmieniane).
 */
import { CONTENT_RELEASE } from '../domain/contentRelease';
import type { Attempt, Block, DmeEvent, IsoDateTime, LegacySessionInfo, QuestionStat, Session, Settings, Slot } from '../domain/types';
import { V18_ALLOWED } from './v18Allowlist';

/** Migracja treści schematu v5 (wydanie „V18 + webinary”); klucz rekordu `meta`: `migration:<id>`. */
export const BANK_MIGRATION_ID = 'bank-v18-webinary';
/** Historyczna migracja treści schematu v4 (bank V18) — jej rekord `meta` zostaje w bazie. */
export const BANK_MIGRATION_ID_V18 = 'bank-v18';

/** Wersja banku V18 (700 pytań) — poprzednik wydania z webinarami. */
export const V18_BANK_VERSION = 'chatgpt-combined-v18-2026-11-09-1fb7f7546332';

/** Wiersz allowlisty: [id, rewizja, fingerprint, klucz, rodzina, dziedzina]. */
export type AllowedQuestionRow = readonly [string, number, string, string, string, string];

/** Wydanie treści, do którego przekształcane są dane użytkownika. */
export interface BankTarget {
  /** `bank_version` wydania. */
  bankVersion: string;
  /** SHA-256 pliku banku wydania (rekord `meta.content`). */
  bankSha256: string;
  /** Allowlista wydania — jedyna podstawa decyzji o zgodności. */
  allowed: readonly AllowedQuestionRow[];
  /**
   * Wersje-poprzednicy: wydanie jest ich nadzbiorem, więc ich sesja bez żadnej pozycji (pusta) zostaje aktywna.
   * Puste sesje innych wersji (V15, V16, V17) nie są przenoszone.
   */
  predecessorBankVersions: readonly string[];
}

/** Domyślne wydanie docelowe: bieżąca treść aplikacji (`CONTENT_RELEASE`) i jej allowlista, poprzednik V18. */
export const CURRENT_BANK_TARGET: BankTarget = Object.freeze({
  bankVersion: CONTENT_RELEASE.bankVersion,
  bankSha256: CONTENT_RELEASE.bankSha256,
  allowed: V18_ALLOWED,
  predecessorBankVersions: Object.freeze([V18_BANK_VERSION]),
});

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
  migrationId: string;
  contentBankVersion: string;
  at: IsoDateTime;
  /** Sesje aktywne po migracji (w tym przeniesione z innej wersji banku). */
  sessionsCurrent: number;
  /** W tym: sesje innej wersji banku, w całości zgodne z allowlistą (`bankVersion` → wydanie docelowe). */
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
  familyId: string;
  domainId: string;
}

/** Allowlista wydania jako mapa (wyliczana raz na obiekt wydania). */
const allowedMaps = new WeakMap<BankTarget, ReadonlyMap<string, AllowedRef>>();

function allowedOf(target: BankTarget): ReadonlyMap<string, AllowedRef> {
  let map = allowedMaps.get(target);
  if (!map) {
    map = new Map(target.allowed.map(([id, revision, fingerprint, correctOptionId, familyId, domainId]) => [id, { revision, fingerprint, correctOptionId, familyId, domainId }]));
    allowedMaps.set(target, map);
  }
  return map;
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function slotsOf(session: Session): Slot[] {
  return Object.values(isObj(session.slots) ? (session.slots as Record<string, Slot>) : {});
}

/** Snapshot zgodny z wydaniem (ID z allowlisty, ta sama rewizja, fingerprint i klucz). */
function snapshotMatches(slot: unknown, allowed: ReadonlyMap<string, AllowedRef>): boolean {
  if (!isObj(slot) || !isObj(slot.snapshot) || typeof slot.questionId !== 'string') return false;
  const ref = allowed.get(slot.questionId);
  const snap = slot.snapshot;
  return ref !== undefined && snap.questionId === slot.questionId && snap.revision === ref.revision && snap.fingerprint === ref.fingerprint && snap.correctOptionId === ref.correctOptionId;
}

/** Sesja w całości wydania docelowego (wersja sesji i każdego snapshotu). */
export function isCurrentBankSession(session: Session, target: BankTarget = CURRENT_BANK_TARGET): boolean {
  if (session.legacy) return false;
  if (session.bankVersion !== target.bankVersion) return false;
  return slotsOf(session).every((slot) => isObj(slot) && isObj(slot.snapshot) && slot.snapshot.bankVersion === target.bankVersion);
}

/**
 * Sesja innej wersji banku, której każda pozycja jest zgodna z allowlistą (plan wskazuje istniejące pozycje).
 * Sesja bez żadnej pozycji nie dowodzi zgodności — jest przenoszona wyłącznie z wersji-poprzednika (wydanie
 * jest jej nadzbiorem); pusta sesja innej wersji zostaje podsumowaniem.
 */
function isTransferable(session: Session, target: BankTarget, allowed: ReadonlyMap<string, AllowedRef>): boolean {
  if (session.legacy) return false;
  if (!Array.isArray(session.plan) || !isObj(session.slots)) return false;
  const slots = session.slots as Record<string, Slot>;
  if (slotsOf(session).length === 0 && !target.predecessorBankVersions.includes(session.bankVersion)) return false;
  if (!session.plan.every((id) => isObj(slots[id]))) return false;
  return slotsOf(session).every((slot) => snapshotMatches(slot, allowed));
}

/** Konfiguracja zachowanej sesji: cała pula (dawny filtr trudności nie ogranicza dalszych pytań ani rund błędów). */
function wholePool(config: Session['config']): Session['config'] {
  return isObj(config) && config.difficulty !== 'mixed' ? { ...config, difficulty: 'mixed' } : config;
}

/** Sesja wydania docelowego: tylko wyrównanie konfiguracji do całej puli (bez zmiany, gdy już jest `mixed`). */
function keepCurrent(session: Session): Session {
  const config = wholePool(session.config);
  if (config === session.config) return session;
  return {
    ...session,
    config,
    revision: (Number.isSafeInteger(session.revision) ? session.revision : 0) + 1,
    mutationSeq: (Number.isSafeInteger(session.mutationSeq) ? session.mutationSeq : 0) + 1,
  };
}

function restamp(session: Session, bankVersion: string): Session {
  const slots: Record<string, Slot> = {};
  for (const [key, slot] of Object.entries(session.slots)) slots[key] = { ...slot, snapshot: { ...slot.snapshot, bankVersion } };
  return {
    ...session,
    config: wholePool(session.config),
    bankVersion,
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

function toLegacy(session: Session, now: IsoDateTime, contentBankVersion: string): Session {
  const { answered, correct, excluded } = countsOf(session);
  const open = session.status === 'open';
  const legacy: LegacySessionInfo = {
    reason: 'bank_v18_update',
    previousBankVersion: typeof session.bankVersion === 'string' ? session.bankVersion : '',
    contentBankVersion,
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

/** Ustawienia: ostatnie konfiguracje bez filtra trudności (cała pula); reszta bez zmian. */
export function settingsForCurrentBank(settings: Settings): Settings {
  const fix = <C extends { difficulty?: unknown } | null | undefined>(config: C): C => (isObj(config) && config.difficulty !== 'mixed' ? { ...config, difficulty: 'mixed' } : config);
  const lastTestConfig = fix(settings.lastTestConfig);
  const lastFreeFlowConfig = fix(settings.lastFreeFlowConfig);
  if (lastTestConfig === settings.lastTestConfig && lastFreeFlowConfig === settings.lastFreeFlowConfig) return settings;
  return { ...settings, lastTestConfig, lastFreeFlowConfig };
}

/**
 * Przekształca dane użytkownika do wydania `target` (domyślnie bieżące wydanie aplikacji).
 * Raport (`migrationId`) dotyczy migracji `BANK_MIGRATION_ID`.
 */
export function transformToCurrentBank(input: BankTransformInput, now: IsoDateTime, target: BankTarget = CURRENT_BANK_TARGET): BankTransformResult {
  const allowed = allowedOf(target);
  const matches = (slot: unknown): boolean => snapshotMatches(slot, allowed);
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
      if (allowed.has(slot.questionId) && !matches(slot)) contradicted.add(slot.questionId);
    }
  }
  for (const a of input.attempts) {
    if (!isObj(a) || typeof a.questionId !== 'string') continue;
    const ref = allowed.get(a.questionId);
    if (ref && a.questionRevision !== ref.revision) contradicted.add(a.questionId);
  }
  const confirmed = (questionId: unknown): boolean => typeof questionId === 'string' && allowed.has(questionId) && !contradicted.has(questionId);

  let current = 0;
  let restamped = 0;
  let legacyCount = 0;
  let interrupted = 0;
  const sessions = rawSessions.map((s) => {
    if (s.legacy) {
      legacyCount++;
      return normalizeLegacy(s);
    }
    if (isCurrentBankSession(s, target) && slotsOf(s).every(matches)) {
      current++;
      return keepCurrent(s);
    }
    if (isTransferable(s, target, allowed)) {
      current++;
      restamped++;
      return restamp(s, target.bankVersion);
    }
    legacyCount++;
    if (s.status === 'open') interrupted++;
    return toLegacy(s, now, target.bankVersion);
  });
  const sessionIds = new Set(sessions.map((s) => s.id));
  const keptSessionIds = new Set(sessions.filter((s) => !s.legacy).map((s) => s.id));

  // Próby: tylko pytania z allowlisty z rewizją wydania; poza zachowanymi sesjami — tylko pytania zgodne.
  const attempts: Attempt[] = [];
  let attemptsRemoved = 0;
  for (const a of input.attempts) {
    if (!isObj(a) || typeof a.id !== 'string' || typeof a.sessionId !== 'string' || !sessionIds.has(a.sessionId)) {
      attemptsRemoved++;
      continue;
    }
    const ref = typeof a.questionId === 'string' ? allowed.get(a.questionId) : undefined;
    const sameRevision = ref !== undefined && a.questionRevision === ref.revision;
    if (sameRevision && (confirmed(a.questionId) || keptSessionIds.has(a.sessionId))) attempts.push(a as unknown as Attempt);
    else attemptsRemoved++;
  }

  // Dowód zgodności pytania, który ZOSTAJE w danych po przekształceniu (idempotencja: ponowne przekształcenie
  // widzi ten sam dowód): zgodny snapshot w sesji zachowanej jako aktywna albo zachowana próba z rewizją wydania.
  const evidenced = new Set<string>();
  for (const s of sessions) {
    if (s.legacy) continue;
    for (const slot of slotsOf(s)) if (matches(slot)) evidenced.add(slot.questionId);
  }
  for (const a of attempts) evidenced.add(a.questionId);

  // Stan powtórek: tylko pytania zgodne, z tą samą rodziną oraz dziedziną co wydanie i z dowodem zgodności.
  // Statystyka samego wyświetlenia (bez odpowiedzi, bez błędu i terminu powtórki) nie niesie wyniku nauki — nie
  // wymaga dowodu (np. pytanie pokazane w sesji, która stała się podsumowaniem już w poprzedniej migracji).
  const questionStats: QuestionStat[] = [];
  let statsReset = 0;
  for (const st of input.questionStats) {
    const ref = isObj(st) && typeof st.questionId === 'string' ? allowed.get(st.questionId) : undefined;
    const seenOnly = isObj(st) && st.answeredCount === 0 && st.correctCount === 0 && st.wrongCount === 0 && st.activeError === false && st.dueAt === null;
    const keep = ref !== undefined && isObj(st) && confirmed(st.questionId) && (seenOnly || evidenced.has(st.questionId as string)) && st.familyId === ref.familyId && st.domainId === ref.domainId;
    if (keep) questionStats.push(st as unknown as QuestionStat);
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
    const ref = allowed.get(block.questionId);
    const matches = ref !== undefined && confirmed(block.questionId) && block.fingerprint === ref.fingerprint && block.familyId === ref.familyId;
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
      contentBankVersion: target.bankVersion,
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
