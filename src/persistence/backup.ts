/**
 * Kopia danych (DECYZJE §10; 03_ARCHITEKTURA §7; S22a–S22g, S24e): budowa pliku `BackupFileV1`,
 * nazwy plików, pełna walidacja pliku (rozmiar, JSON, format, wersja, schemat, enumy, daty,
 * referencje, snapshoty, paczki) i podsumowanie do ekranu decyzji. Bez IndexedDB.
 */
import { REVIEW_TIME_ZONE } from '../domain/policies';
import {
  DIFFICULTIES,
  DIFFICULTY_CHOICES,
  DOMAIN_IDS,
  SESSION_KINDS,
  SESSION_STATUSES,
  SLOT_ORIGINS,
} from '../domain/types';
import type { DmeEvent, IsoDateTime, PackRecord, Session } from '../domain/types';
import { APP_ID, BACKUP_FORMAT, BACKUP_FORMAT_VERSION, BACKUP_MAX_BYTES } from './api';
import type {
  BackupData,
  BackupFileV1,
  BackupSummary,
  ExportBackupInput,
  ExportedFile,
  PersistenceResult,
  ValidatedBackup,
} from './api';
import { backupTooLarge, fail, invalidBackup, ok, unsupportedBackupVersion } from './errors';
import { checkStoredPackRecord, storedPackFingerprintMismatches } from './packs';
import {
  ReasonList,
  compareKeys,
  isFiniteNumber,
  isIdArray,
  isInt,
  isIsoDate,
  isIsoDateTime,
  isNonEmptyString,
  isObject,
  isSafeHttpsUrl,
  isSafeId,
  isSafeRelativeMediaPath,
  isStringArray,
  isoTime,
  readJsonInput,
  show,
  utf8ByteLength,
} from './validation';
import type { JsonObject } from './validation';

/* ========================================================================== */
/* Budowa pliku                                                               */
/* ========================================================================== */

/** Magazyny danych użytkownika w kopii (kolejność pól `BackupData`). */
export const BACKUP_DATA_STORES = ['settings', 'sessions', 'attempts', 'questionStats', 'blocks', 'events', 'packs'] as const satisfies readonly (keyof BackupData)[];

/** Klucz główny rekordu danego magazynu kopii. */
function recordKey(store: keyof BackupData, record: unknown): string {
  const field = store === 'questionStats' ? 'questionId' : 'id';
  const value = isObject(record) ? record[field] : undefined;
  return typeof value === 'string' ? value : '';
}

/** Dane kopii w deterministycznej kolejności (po kluczu głównym) — stabilny round-trip. */
export function sortBackupData(data: BackupData): BackupData {
  const sorted = <K extends keyof BackupData>(store: K): BackupData[K] =>
    [...data[store]].sort((a, b) => compareKeys(recordKey(store, a), recordKey(store, b))) as BackupData[K];
  return {
    settings: sorted('settings'),
    sessions: sorted('sessions'),
    attempts: sorted('attempts'),
    questionStats: sorted('questionStats'),
    blocks: sorted('blocks'),
    events: sorted('events'),
    packs: sorted('packs'),
  };
}

export function buildBackupFile(data: BackupData, input: ExportBackupInput): BackupFileV1 {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appId: APP_ID,
    exportedAt: input.now,
    appVersion: input.appVersion,
    bankVersions: [...input.bankVersions],
    data: sortBackupData(data),
  };
}

/** Serializacja pliku kopii (JSON UTF-8, bez wcięć) z rozmiarem w bajtach. */
export function serializeBackupFile(file: BackupFileV1): { text: string; sizeBytes: number } {
  const text = JSON.stringify(file);
  return { text, sizeBytes: utf8ByteLength(text) };
}

/** Data kalendarzowa `YYYY-MM-DD` w strefie Europe/Warsaw (nazwy plików). */
export function localDateForFileName(now: IsoDateTime): string {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) return 'bez-daty';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: REVIEW_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const get = (type: string): string | undefined => parts.find((p) => p.type === type)?.value;
    const y = get('year');
    const m = get('month');
    const d = get('day');
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    /* brak Intl ze strefami — data UTC */
  }
  return date.toISOString().slice(0, 10);
}

/** Nazwa pliku kopii: `dme-kopia-2026-10-22.json` / `dme-przed-wczytaniem-2026-10-22.json`. */
export function backupFileName(prefix: 'dme-kopia' | 'dme-przed-wczytaniem', now: IsoDateTime): string {
  return `${prefix}-${localDateForFileName(now)}.json`;
}

export function toExportedFile(fileName: string, text: string, sizeBytes: number): ExportedFile {
  return { fileName, mimeType: 'application/json', text, sizeBytes };
}

/* ========================================================================== */
/* Podsumowanie                                                               */
/* ========================================================================== */

/** Podsumowanie kopii do ekranu decyzji (S22: „6 ukończonych testów i 1 niedokończony…”). */
export function summarizeBackup(file: BackupFileV1): BackupSummary {
  const { sessions, attempts, blocks, events, questionStats, packs } = file.data;
  const open = sessions.find((s) => s.status === 'open') ?? null;
  const times: string[] = [];
  for (const s of sessions) times.push(s.createdAt, s.updatedAt, ...(s.closedAt ? [s.closedAt] : []));
  for (const a of attempts) times.push(a.answeredAt);
  for (const e of events) times.push(e.at);
  for (const b of blocks) times.push(b.createdAt, ...(b.revokedAt ? [b.revokedAt] : []));
  let first: string | null = null;
  let last: string | null = null;
  for (const t of times) {
    if (first === null || isoTime(t) < isoTime(first)) first = t;
    if (last === null || isoTime(t) > isoTime(last)) last = t;
  }
  return {
    exportedAt: file.exportedAt,
    formatVersion: file.formatVersion,
    appVersion: file.appVersion,
    completedTests: sessions.filter((s) => s.kind === 'test' && s.status === 'completed').length,
    unfinishedTests: sessions.filter((s) => s.kind === 'test' && s.status === 'unfinished').length,
    freeFlowSessions: sessions.filter((s) => s.kind === 'freeflow' && s.status === 'ended').length,
    openSessions: sessions.filter((s) => s.status === 'open').length,
    openSessionKind: open?.kind ?? null,
    activeBlocks: blocks.filter((b) => b.revokedAt === null).length,
    attempts: attempts.length,
    questionStats: questionStats.length,
    packs: packs.length,
    totalSessions: sessions.length,
    firstActivityAt: first,
    lastActivityAt: last,
  };
}

/* ========================================================================== */
/* Walidacja: specyfikacje pól                                                */
/* ========================================================================== */

interface FieldCheck {
  test: (value: unknown) => boolean;
  expect: string;
}

const FINGERPRINT_RE = /^[0-9a-f]{64}$/;

function oneOf(values: readonly unknown[]): FieldCheck {
  return {
    test: (v) => values.includes(v),
    expect: `niedozwolona wartość (dozwolone: ${values.map((v) => (v === null ? 'null' : String(v))).join(', ')})`,
  };
}

function nullOr(check: FieldCheck): FieldCheck {
  return { test: (v) => v === null || check.test(v), expect: `${check.expect} albo null` };
}

const C = {
  id: { test: isSafeId, expect: 'oczekiwano niepustego identyfikatora' },
  text: { test: (v: unknown) => typeof v === 'string', expect: 'oczekiwano tekstu' },
  nonEmptyText: { test: isNonEmptyString, expect: 'oczekiwano niepustego tekstu' },
  iso: { test: isIsoDateTime, expect: 'oczekiwano daty ISO 8601 (np. 2026-10-22T18:42:00.000Z)' },
  isoDate: { test: isIsoDate, expect: 'oczekiwano daty RRRR-MM-DD' },
  bool: { test: (v: unknown) => typeof v === 'boolean', expect: 'oczekiwano wartości true/false' },
  int0: { test: (v: unknown) => isInt(v, 0), expect: 'oczekiwano liczby całkowitej ≥ 0' },
  int1: { test: (v: unknown) => isInt(v, 1), expect: 'oczekiwano liczby całkowitej ≥ 1' },
  // Seed 32-bitowy: akceptowana reprezentacja bez znaku (0…2³²−1) i ze znakiem (−2³¹…).
  int32: { test: (v: unknown) => isInt(v, -0x80000000) && (v as number) <= 0xffffffff, expect: 'oczekiwano 32-bitowej liczby całkowitej' },
  number: { test: isFiniteNumber, expect: 'oczekiwano liczby' },
  object: { test: isObject, expect: 'oczekiwano obiektu' },
  array: { test: Array.isArray, expect: 'oczekiwano listy' },
  idArray: { test: isIdArray, expect: 'oczekiwano listy identyfikatorów' },
  stringArray: { test: isStringArray, expect: 'oczekiwano listy tekstów' },
  fingerprint: { test: (v: unknown) => typeof v === 'string' && FINGERPRINT_RE.test(v), expect: 'oczekiwano fingerprintu SHA-256 (64 znaki hex)' },
  url: { test: (v: unknown) => v === null || isSafeHttpsUrl(v), expect: 'dozwolony wyłącznie adres https:// albo null' },
  mediaPath: { test: isSafeRelativeMediaPath, expect: 'oczekiwano względnej ścieżki pliku wewnątrz aplikacji' },
} satisfies Record<string, FieldCheck>;

const SCOPES = ['ALL', ...DOMAIN_IDS] as const;
const POLICIES = ['TEST_POLICY_V1', 'TEST_POLICY_V2', 'FREE_FLOW_POLICY_V1', 'FREE_FLOW_POLICY_V2'] as const;
const REPORT_PHASES = ['before_answer', 'after_answer', 'after_close', 'outside_session'] as const;

type Spec = Record<string, FieldCheck>;

/** Sprawdza pola obiektu; zwraca `true`, gdy wszystkie poprawne. */
function checkFields(obj: JsonObject, spec: Spec, where: string, reasons: ReasonList): boolean {
  let valid = true;
  for (const [field, check] of Object.entries(spec)) {
    const value = obj[field];
    if (!check.test(value)) {
      valid = false;
      reasons.add(`${where}: pole „${field}” — ${check.expect}${value === undefined ? ' (brak pola)' : ` (jest: ${show(value)})`}.`);
    }
  }
  return valid;
}

function checkObject(value: unknown, spec: Spec, where: string, reasons: ReasonList): value is JsonObject {
  if (!isObject(value)) {
    reasons.add(`${where}: oczekiwano obiektu.`);
    return false;
  }
  return checkFields(value, spec, where, reasons);
}

const CONFIG_SPEC: Spec = {
  scope: oneOf(SCOPES),
  difficulty: oneOf(DIFFICULTY_CHOICES),
  targetN: nullOr(C.int1),
  myErrorsPriority: C.bool,
};

const SETTINGS_SPEC: Spec = {
  id: oneOf(['settings']),
  lastTestConfig: nullOr(C.object),
  lastFreeFlowConfig: nullOr(C.object),
  installHintDismissedAt: nullOr(C.iso),
  persistRequestedAt: nullOr(C.iso),
  updatedAt: nullOr(C.iso),
};

const SESSION_SPEC: Spec = {
  id: C.id,
  kind: oneOf(SESSION_KINDS),
  status: oneOf(SESSION_STATUSES),
  createdAt: C.iso,
  updatedAt: C.iso,
  closedAt: nullOr(C.iso),
  revision: C.int0,
  mutationSeq: C.int0,
  config: C.object,
  bankVersion: C.text,
  seed: C.int32,
  allocation: C.object,
  retry: nullOr(C.object),
  plan: C.idArray,
  slots: C.object,
  reached: C.int0,
  awaitingReplacement: C.idArray,
  events: C.array,
  result: nullOr(C.object),
  freeFlow: nullOr(C.object),
};

const ALLOCATION_SPEC: Spec = {
  policy: oneOf(POLICIES),
  rotationOffset: C.int0,
  capacityAtStart: C.int0,
  domainTargets: C.object,
  domainActual: C.object,
  cells: C.array,
  mandatoryRepeated: C.int0,
  mandatoryMyErrors: C.int0,
  fillersUnseen: C.int0,
  fillersSeen: C.int0,
  redistributed: C.array,
  freeFlowWeights: nullOr(C.object),
};

const RETRY_SPEC: Spec = { sourceSessionId: C.id, retryChainId: C.id, roundIndex: C.int1, repeatedCount: C.int0 };
const RESULT_SPEC: Spec = { correct: C.int0, targetN: C.int1, passed: C.bool, percent: C.number };
const FREE_FLOW_SPEC: Spec = { myErrorsExhaustedNotified: C.bool, empty: C.bool, picks: C.int0 };

const SLOT_SPEC: Spec = {
  id: C.id,
  questionId: C.id,
  origin: oneOf(SLOT_ORIGINS),
  snapshot: C.object,
  optionOrder: C.idArray,
  attempt: nullOr(C.object),
  excluded: nullOr(C.object),
  replacesSlotId: nullOr(C.id),
  createdAt: C.iso,
  shownAt: nullOr(C.iso),
};
const SLOT_ATTEMPT_SPEC: Spec = { commandId: C.id, optionId: C.id, correct: C.bool, answeredAt: C.iso };
const SLOT_EXCLUSION_SPEC: Spec = { reason: oneOf(['reported']), at: C.iso, eventId: C.id };

const SNAPSHOT_SPEC: Spec = {
  questionId: C.id,
  revision: C.int1,
  bankVersion: C.text,
  familyId: C.id,
  fingerprint: C.fingerprint,
  domainId: oneOf(DOMAIN_IDS),
  domainTitle: C.text,
  topicIds: C.idArray,
  topics: C.array,
  difficulty: oneOf(DIFFICULTIES),
  stem: C.nonEmptyText,
  options: C.array,
  correctOptionId: C.id,
  explanation: C.text,
  sources: C.array,
  sourceLocator: C.text,
  figure: nullOr(C.object),
  explanationFigure: nullOr(C.object),
  reviewStatus: C.text,
  approvedForQuestionKey: C.bool,
};
const SNAPSHOT_OPTION_SPEC: Spec = { id: C.id, text: C.nonEmptyText };
const SNAPSHOT_TOPIC_SPEC: Spec = { id: C.id, title: C.text, learningObjective: nullOr(C.text), pearls: C.stringArray };
const SNAPSHOT_SOURCE_SPEC: Spec = {
  id: C.id,
  title: C.text,
  url: C.url,
  doi: nullOr(C.text),
  pmid: nullOr(C.text),
  kindPl: C.text,
  accessPl: C.text,
};
const SNAPSHOT_FIGURE_SPEC: Spec = { id: C.id, file: C.mediaPath, alt: C.text, caption: C.text };

const ATTEMPT_SPEC: Spec = {
  id: C.id,
  commandId: C.id,
  sessionId: C.id,
  sessionKind: oneOf(SESSION_KINDS),
  slotId: C.id,
  questionId: C.id,
  questionRevision: C.int1,
  domainId: oneOf(DOMAIN_IDS),
  difficulty: oneOf(DIFFICULTIES),
  optionId: C.id,
  optionOrder: C.idArray,
  correct: C.bool,
  answeredAt: C.iso,
  excluded: C.bool,
  excludedReason: oneOf(['reported', null]),
  excludedAt: nullOr(C.iso),
};

const QUESTION_STAT_SPEC: Spec = {
  questionId: C.id,
  familyId: C.id,
  domainId: oneOf(DOMAIN_IDS),
  seenCount: C.int0,
  firstSeenAt: nullOr(C.iso),
  lastSeenAt: nullOr(C.iso),
  answeredCount: C.int0,
  correctCount: C.int0,
  wrongCount: C.int0,
  lastAnsweredAt: nullOr(C.iso),
  activeError: C.bool,
  streak: oneOf([0, 1]),
  dueAt: nullOr(C.iso),
  lastWrongAt: nullOr(C.iso),
  lastWrongSessionId: nullOr(C.id),
  streakSessionId: nullOr(C.id),
  resolvedAt: nullOr(C.iso),
};

const BLOCK_SPEC: Spec = {
  id: C.id,
  questionId: C.id,
  revision: C.int1,
  fingerprint: C.fingerprint,
  familyId: C.id,
  domainId: oneOf(DOMAIN_IDS),
  stemPreview: C.text,
  reason: oneOf(['reported']),
  createdAt: C.iso,
  sessionId: nullOr(C.id),
  slotId: nullOr(C.id),
  eventId: C.id,
  revokedAt: nullOr(C.iso),
};

const EVENT_BASE_SPEC: Spec = { id: C.id, at: C.iso, commandId: nullOr(C.id) };
const EVENT_SPECS: Readonly<Record<DmeEvent['type'], Spec>> = {
  session_started: { sessionId: C.id, kind: oneOf(SESSION_KINDS) },
  question_reported: {
    sessionId: nullOr(C.id),
    slotId: nullOr(C.id),
    questionId: C.id,
    revision: C.int1,
    blockId: C.id,
    phase: oneOf(REPORT_PHASES),
    reportedLaterAt: nullOr(C.iso),
  },
  slot_replaced: { sessionId: C.id, excludedSlotId: C.id, replacementSlotId: C.id, questionId: C.id },
  replacement_unavailable: { sessionId: C.id, excludedSlotId: C.id },
  report_undone: { sessionId: C.id, reportEventId: C.id, blockId: C.id },
  session_completed: { sessionId: C.id, correct: C.int0, targetN: C.int1, passed: C.bool },
  session_unfinished: { sessionId: C.id, answeredValid: C.int0 },
  freeflow_ended: { sessionId: C.id, answeredValid: C.int0, correct: C.int0 },
  my_errors_exhausted: { sessionId: C.id },
  block_revoked: { blockId: C.id, questionId: C.id },
  pack_imported: { packId: C.id, added: C.int0, updated: C.int0, skipped: C.int0 },
  backup_restored: { exportedAt: C.iso, safetyBackupId: C.id },
};
const EVENT_TYPES = Object.keys(EVENT_SPECS);

/* ========================================================================== */
/* Walidacja: rekordy                                                         */
/* ========================================================================== */

function checkEvent(value: unknown, where: string, reasons: ReasonList): value is DmeEvent {
  if (!checkObject(value, EVENT_BASE_SPEC, where, reasons)) return false;
  const type = value.type;
  if (typeof type !== 'string' || !EVENT_TYPES.includes(type)) {
    reasons.add(`${where}: nieznany typ zdarzenia ${show(type)}.`);
    return false;
  }
  return checkFields(value, EVENT_SPECS[type as DmeEvent['type']], `${where} (${type})`, reasons);
}

function checkConfig(value: unknown, where: string, reasons: ReasonList): boolean {
  return checkObject(value, CONFIG_SPEC, where, reasons);
}

function checkSnapshot(snapshot: JsonObject, where: string, reasons: ReasonList): string[] | null {
  if (!checkFields(snapshot, SNAPSHOT_SPEC, where, reasons)) return null;
  const options = snapshot.options as unknown[];
  let valid = true;
  if (options.length !== 4) {
    reasons.add(`${where}: snapshot musi mieć dokładnie 4 warianty (jest ${options.length}).`);
    valid = false;
  }
  options.forEach((o, i) => {
    if (!checkObject(o, SNAPSHOT_OPTION_SPEC, `${where}, wariant ${i + 1}`, reasons)) valid = false;
  });
  const ids = options.map((o) => (isObject(o) ? o.id : undefined)).filter(isNonEmptyString);
  if (new Set(ids).size !== ids.length) {
    reasons.add(`${where}: powtórzony identyfikator wariantu w snapshocie.`);
    valid = false;
  }
  if (!ids.includes(snapshot.correctOptionId as string)) {
    reasons.add(`${where}: klucz ${show(snapshot.correctOptionId)} nie wskazuje wariantu ze snapshotu.`);
    valid = false;
  }
  (snapshot.topics as unknown[]).forEach((t, i) => {
    if (!checkObject(t, SNAPSHOT_TOPIC_SPEC, `${where}, temat ${i + 1}`, reasons)) valid = false;
  });
  (snapshot.sources as unknown[]).forEach((s, i) => {
    if (!checkObject(s, SNAPSHOT_SOURCE_SPEC, `${where}, źródło ${i + 1}`, reasons)) valid = false;
  });
  for (const field of ['figure', 'explanationFigure'] as const) {
    const figure = snapshot[field];
    if (figure !== null && !checkObject(figure, SNAPSHOT_FIGURE_SPEC, `${where}, ilustracja (${field})`, reasons)) valid = false;
  }
  return valid ? ids : null;
}

/** Struktura sesji z slotami, snapshotami i zdarzeniami sesji. */
function checkSession(value: unknown, where: string, reasons: ReasonList): value is Session {
  if (!isObject(value)) {
    reasons.add(`${where}: oczekiwano obiektu.`);
    return false;
  }
  // Błąd jednego pola nie przerywa sprawdzania pozostałych części (pełniejsza lista przyczyn).
  let valid = checkFields(value, SESSION_SPEC, where, reasons);
  if (isObject(value.config) && !checkConfig(value.config, `${where}, konfiguracja`, reasons)) valid = false;
  if (isObject(value.allocation) && !checkFields(value.allocation, ALLOCATION_SPEC, `${where}, przydział`, reasons)) valid = false;
  if (isObject(value.retry) && !checkFields(value.retry, RETRY_SPEC, `${where}, powtórka`, reasons)) valid = false;
  if (isObject(value.result) && !checkFields(value.result, RESULT_SPEC, `${where}, wynik`, reasons)) valid = false;
  if (isObject(value.freeFlow) && !checkFields(value.freeFlow, FREE_FLOW_SPEC, `${where}, Free Flow`, reasons)) valid = false;

  const kind = value.kind as Session['kind'];
  const status = value.status as Session['status'];
  if (kind === 'test' && status === 'ended') {
    reasons.add(`${where}: status „ended” dotyczy wyłącznie Free Flow.`);
    valid = false;
  }
  if (kind === 'freeflow' && (status === 'completed' || status === 'unfinished')) {
    reasons.add(`${where}: status „${status}” dotyczy wyłącznie Testu.`);
    valid = false;
  }
  if ((status === 'completed') !== (value.result !== null)) {
    reasons.add(`${where}: wynik może (i musi) mieć wyłącznie ukończony test.`);
    valid = false;
  }
  if (isObject(value.result) && isInt(value.result.correct, 0) && isInt(value.result.targetN, 1) && value.result.correct > value.result.targetN) {
    reasons.add(`${where}: liczba poprawnych odpowiedzi przekracza N.`);
    valid = false;
  }
  if (isObject(value.config)) {
    const targetN = value.config.targetN;
    if (kind === 'test' && !isInt(targetN, 1)) {
      reasons.add(`${where}: test wymaga liczby pytań N ≥ 1.`);
      valid = false;
    }
    if (kind === 'freeflow' && targetN !== null) {
      reasons.add(`${where}: Free Flow nie ma liczby pytań N.`);
      valid = false;
    }
  }

  const slots: JsonObject = isObject(value.slots) ? value.slots : {};
  for (const [slotKey, slot] of Object.entries(slots)) {
    const slotWhere = `${where}, slot „${slotKey}”`;
    if (!checkObject(slot, SLOT_SPEC, slotWhere, reasons)) {
      valid = false;
      continue;
    }
    if (slot.id !== slotKey) {
      reasons.add(`${slotWhere}: identyfikator slotu różni się od klucza.`);
      valid = false;
    }
    const snapshot = slot.snapshot as JsonObject;
    const optionIds = checkSnapshot(snapshot, `${slotWhere}, snapshot`, reasons);
    if (optionIds === null) {
      valid = false;
      continue;
    }
    if (snapshot.questionId !== slot.questionId) {
      reasons.add(`${slotWhere}: snapshot dotyczy innego pytania (${show(snapshot.questionId)}) niż slot (${show(slot.questionId)}).`);
      valid = false;
    }
    const order = slot.optionOrder as string[];
    if (order.length !== optionIds.length || !order.every((id) => optionIds.includes(id)) || new Set(order).size !== order.length) {
      reasons.add(`${slotWhere}: kolejność wariantów nie odpowiada wariantom ze snapshotu.`);
      valid = false;
    }
    if (slot.attempt !== null) {
      if (!checkObject(slot.attempt, SLOT_ATTEMPT_SPEC, `${slotWhere}, odpowiedź`, reasons)) valid = false;
      else {
        const optionId = slot.attempt.optionId as string;
        if (!optionIds.includes(optionId)) {
          reasons.add(`${slotWhere}: odpowiedź wskazuje nieistniejący wariant ${show(optionId)}.`);
          valid = false;
        } else if (slot.attempt.correct !== (optionId === snapshot.correctOptionId)) {
          reasons.add(`${slotWhere}: ocena odpowiedzi nie zgadza się z kluczem ze snapshotu.`);
          valid = false;
        }
      }
    }
    if (slot.excluded !== null && !checkObject(slot.excluded, SLOT_EXCLUSION_SPEC, `${slotWhere}, wykluczenie`, reasons)) valid = false;
  }

  const plan: string[] = isIdArray(value.plan) ? value.plan : [];
  if (new Set(plan).size !== plan.length) {
    reasons.add(`${where}: plan zawiera powtórzony slot.`);
    valid = false;
  }
  for (const slotId of plan) {
    if (!Object.hasOwn(slots, slotId)) {
      reasons.add(`${where}: plan wskazuje nieistniejący slot „${slotId}”.`);
      valid = false;
    }
  }
  for (const slotId of isIdArray(value.awaitingReplacement) ? value.awaitingReplacement : []) {
    if (!Object.hasOwn(slots, slotId)) {
      reasons.add(`${where}: oczekujące zastępstwo wskazuje nieistniejący slot „${slotId}”.`);
      valid = false;
    }
  }
  for (const [slotKey, slot] of Object.entries(slots)) {
    if (isObject(slot) && isNonEmptyString(slot.replacesSlotId) && !Object.hasOwn(slots, slot.replacesSlotId)) {
      reasons.add(`${where}, slot „${slotKey}”: zastępuje nieistniejący slot „${slot.replacesSlotId}”.`);
      valid = false;
    }
  }
  if (isInt(value.reached, 0) && value.reached > plan.length) {
    reasons.add(`${where}: osiągnięta pozycja (${show(value.reached)}) wykracza poza plan (${plan.length}).`);
    valid = false;
  }
  const sessionEventIds = new Set<string>();
  (Array.isArray(value.events) ? value.events : []).forEach((event: unknown, i) => {
    if (!checkEvent(event, `${where}, zdarzenie ${i + 1}`, reasons)) valid = false;
    else if (sessionEventIds.has(event.id)) {
      reasons.add(`${where}: powtórzone zdarzenie „${event.id}”.`);
      valid = false;
    } else sessionEventIds.add(event.id);
  });
  return valid;
}

/* ========================================================================== */
/* Walidacja: całość                                                          */
/* ========================================================================== */

const STORE_LABELS: Readonly<Record<keyof BackupData, string>> = {
  settings: 'Ustawienia',
  sessions: 'Sesja',
  attempts: 'Próba',
  questionStats: 'Statystyka pytania',
  blocks: 'Blokada',
  events: 'Zdarzenie',
  packs: 'Paczka pytań',
};

function label(store: keyof BackupData, record: unknown, index: number): string {
  const key = recordKey(store, record);
  return key ? `${STORE_LABELS[store]} „${key}”` : `${STORE_LABELS[store]} nr ${index + 1}`;
}

/** Struktura, enumy, daty, unikalność kluczy i referencje (synchronicznie). */
function checkBackupStructure(json: JsonObject, reasons: ReasonList): boolean {
  if (!isIsoDateTime(json.exportedAt)) reasons.add(`Niepoprawna data utworzenia kopii (exportedAt): ${show(json.exportedAt)}.`);
  if (typeof json.appVersion !== 'string') reasons.add('Brak wersji aplikacji (appVersion).');
  if (!isStringArray(json.bankVersions)) reasons.add('Brak listy wersji puli (bankVersions).');
  const data = json.data;
  if (!isObject(data)) {
    reasons.add('Brak danych kopii (data).');
    return false;
  }
  let shapeOk = true;
  for (const store of BACKUP_DATA_STORES) {
    if (!Array.isArray(data[store])) {
      reasons.add(`Brak listy „${store}” w danych kopii.`);
      shapeOk = false;
    }
  }
  if (!shapeOk) return false;
  const d = data as unknown as Record<keyof BackupData, unknown[]>;

  /* ---- rekordy ---- */
  let recordsOk = true;
  if (d.settings.length > 1) {
    reasons.add('Kopia zawiera więcej niż jeden rekord ustawień.');
    recordsOk = false;
  }
  d.settings.forEach((rec, i) => {
    const where = label('settings', rec, i);
    if (!checkObject(rec, SETTINGS_SPEC, where, reasons)) recordsOk = false;
    else {
      if (rec.lastTestConfig !== null && !checkConfig(rec.lastTestConfig, `${where}, ostatni test`, reasons)) recordsOk = false;
      if (rec.lastFreeFlowConfig !== null && !checkConfig(rec.lastFreeFlowConfig, `${where}, ostatni Free Flow`, reasons)) recordsOk = false;
    }
  });
  d.sessions.forEach((rec, i) => {
    if (!checkSession(rec, label('sessions', rec, i), reasons)) recordsOk = false;
  });
  d.attempts.forEach((rec, i) => {
    const where = label('attempts', rec, i);
    if (!checkObject(rec, ATTEMPT_SPEC, where, reasons)) recordsOk = false;
    else if (rec.id !== rec.commandId) {
      reasons.add(`${where}: klucz próby musi być równy identyfikatorowi komendy.`);
      recordsOk = false;
    }
  });
  d.questionStats.forEach((rec, i) => {
    if (!checkObject(rec, QUESTION_STAT_SPEC, label('questionStats', rec, i), reasons)) recordsOk = false;
  });
  d.blocks.forEach((rec, i) => {
    if (!checkObject(rec, BLOCK_SPEC, label('blocks', rec, i), reasons)) recordsOk = false;
  });
  d.events.forEach((rec, i) => {
    if (!checkEvent(rec, label('events', rec, i), reasons)) recordsOk = false;
  });
  d.packs.forEach((rec, i) => {
    const problems = checkStoredPackRecord(rec, label('packs', rec, i));
    if (problems.length > 0) {
      recordsOk = false;
      for (const problem of problems) reasons.add(problem);
    }
  });

  /* ---- unikalność kluczy ---- */
  for (const store of BACKUP_DATA_STORES) {
    const seen = new Set<string>();
    for (const rec of d[store]) {
      const key = recordKey(store, rec);
      if (!key) continue;
      if (seen.has(key)) {
        reasons.add(`${STORE_LABELS[store]} „${key}” występuje w kopii więcej niż raz.`);
        recordsOk = false;
      }
      seen.add(key);
    }
  }
  if (!recordsOk) return false;

  /* ---- referencje ---- */
  const data2 = d as unknown as BackupData;
  const sessions = new Map(data2.sessions.map((s) => [s.id, s]));
  const eventIds = new Set<string>(data2.events.map((e) => e.id));
  for (const s of data2.sessions) for (const e of s.events) eventIds.add(e.id);
  let refsOk = true;
  const refFail = (message: string): void => {
    reasons.add(message);
    refsOk = false;
  };

  const openSessions = data2.sessions.filter((s) => s.status === 'open');
  if (openSessions.length > 1) refFail(`Kopia zawiera ${openSessions.length} otwarte sesje — dozwolona jest najwyżej jedna.`);

  for (const s of data2.sessions) {
    const where = `Sesja „${s.id}”`;
    if (s.retry !== null) {
      const parent = sessions.get(s.retry.sourceSessionId);
      if (!parent) refFail(`${where}: powtórka wskazuje nieistniejącą sesję „${s.retry.sourceSessionId}”.`);
      else if (parent.kind !== 'test') refFail(`${where}: powtórka wskazuje sesję, która nie jest testem.`);
    }
    for (const slot of Object.values(s.slots)) {
      if (slot.excluded !== null && !eventIds.has(slot.excluded.eventId)) {
        refFail(`${where}, slot „${slot.id}”: wykluczenie wskazuje nieistniejące zdarzenie „${slot.excluded.eventId}”.`);
      }
    }
  }
  const checkEventRefs = (e: DmeEvent, where: string): void => {
    if (!('sessionId' in e) || e.sessionId === null) return;
    const session = sessions.get(e.sessionId);
    if (!session) {
      refFail(`${where}: wskazuje nieistniejącą sesję „${e.sessionId}”.`);
      return;
    }
    if (e.type === 'question_reported' && e.slotId !== null && !Object.hasOwn(session.slots, e.slotId)) {
      refFail(`${where}: wskazuje nieistniejący slot „${e.slotId}”.`);
    }
  };
  for (const e of data2.events) checkEventRefs(e, `Zdarzenie „${e.id}”`);
  for (const s of data2.sessions) for (const e of s.events) checkEventRefs(e, `Sesja „${s.id}”, zdarzenie „${e.id}”`);

  for (const a of data2.attempts) {
    const where = `Próba „${a.id}”`;
    const session = sessions.get(a.sessionId);
    if (!session) {
      refFail(`${where}: wskazuje nieistniejącą sesję „${a.sessionId}”.`);
      continue;
    }
    if (session.kind !== a.sessionKind) refFail(`${where}: rodzaj sesji nie zgadza się z sesją „${a.sessionId}”.`);
    const slot = Object.hasOwn(session.slots, a.slotId) ? session.slots[a.slotId] : undefined;
    if (!slot) {
      refFail(`${where}: wskazuje nieistniejący slot „${a.slotId}” w sesji „${a.sessionId}”.`);
      continue;
    }
    if (slot.questionId !== a.questionId) refFail(`${where}: pytanie nie zgadza się z pytaniem slotu „${a.slotId}”.`);
    if (!slot.snapshot.options.some((o) => o.id === a.optionId)) refFail(`${where}: wskazuje wariant spoza snapshotu pytania.`);
  }

  for (const b of data2.blocks) {
    const where = `Blokada „${b.id}”`;
    if (b.sessionId !== null) {
      const session = sessions.get(b.sessionId);
      if (!session) refFail(`${where}: wskazuje nieistniejącą sesję „${b.sessionId}”.`);
      else if (b.slotId !== null && !Object.hasOwn(session.slots, b.slotId)) refFail(`${where}: wskazuje nieistniejący slot „${b.slotId}”.`);
    }
    if (!eventIds.has(b.eventId)) refFail(`${where}: wskazuje nieistniejące zdarzenie zgłoszenia „${b.eventId}”.`);
  }

  for (const st of data2.questionStats) {
    for (const field of ['lastWrongSessionId', 'streakSessionId'] as const) {
      const ref = st[field];
      if (ref !== null && !sessions.has(ref)) refFail(`Statystyka pytania „${st.questionId}”: pole „${field}” wskazuje nieistniejącą sesję „${ref}”.`);
    }
  }
  return refsOk;
}

/** Rejestr obiektów zwróconych przez `parseBackup` (pełna walidacja już wykonana). */
const validatedRegistry = new WeakSet<object>();

export function isRegisteredValidatedBackup(value: ValidatedBackup): boolean {
  return validatedRegistry.has(value);
}

/**
 * Walidacja sparsowanego JSON jako kopii `BackupFileV1` (format, wersja, schemat, referencje,
 * fingerprinty paczek). Nie zmienia danych.
 */
export async function validateBackupJson(json: unknown, fileName: string): Promise<PersistenceResult<BackupFileV1>> {
  if (!isObject(json)) return fail(invalidBackup(fileName, ['Plik nie zawiera obiektu kopii danych.']));
  if (json.format !== BACKUP_FORMAT || json.appId !== APP_ID) {
    const reasons = ['Brak oznaczenia kopii aplikacji Doktor Monika Egzamin (format „dme-backup”).'];
    if (json.format === 'dme-runtime-bank' || json.schema_version !== undefined) {
      reasons.push('To jest plik puli pytań — zaimportuj go w ustawieniach: „Import puli pytań”.');
    }
    return fail(invalidBackup(fileName, reasons));
  }
  if (!isInt(json.formatVersion, 0)) return fail(invalidBackup(fileName, ['Brak numeru formatu kopii (formatVersion).']));
  if (json.formatVersion !== BACKUP_FORMAT_VERSION) return fail(unsupportedBackupVersion(fileName, json.formatVersion));

  const reasons = new ReasonList();
  if (!checkBackupStructure(json, reasons) || !reasons.empty) return fail(invalidBackup(fileName, reasons.toArray()));
  const backup = json as unknown as BackupFileV1;

  try {
    for (const pack of backup.data.packs as PackRecord[]) {
      const mismatched = await storedPackFingerprintMismatches(pack);
      for (const id of mismatched) reasons.add(`Paczka pytań „${pack.id}”: fingerprint pytania ${id} nie zgadza się z treścią.`);
    }
  } catch {
    reasons.add('Nie można sprawdzić paczek pytań: brak Web Crypto (aplikacja wymaga https albo localhost).');
  }
  if (!reasons.empty) return fail(invalidBackup(fileName, reasons.toArray()));
  return ok(backup);
}

/** Nazwa pliku z `File` (jeśli jest) albo domyślna. */
function inputFileName(input: Blob | string, fileName: string | undefined): string {
  if (fileName !== undefined && fileName.length > 0) return fileName;
  if (typeof input !== 'string' && 'name' in input && typeof (input as { name: unknown }).name === 'string') {
    const name = (input as { name: string }).name;
    if (name.length > 0) return name;
  }
  return 'kopia.json';
}

/**
 * Odczyt i pełna walidacja pliku kopii BEZ zmiany danych (S22c–S22g, S24e):
 * limit 25 MB → JSON → format/appId → `formatVersion` → schemat/enumy/daty → referencje.
 */
export async function parseBackup(input: Blob | string, fileName?: string): Promise<PersistenceResult<ValidatedBackup>> {
  const name = inputFileName(input, fileName);
  const read = await readJsonInput(input, BACKUP_MAX_BYTES);
  if (!read.ok) {
    if (read.reason === 'too_large') return fail(backupTooLarge(name, read.sizeBytes));
    if (read.reason === 'unreadable') return fail(invalidBackup(name, ['Nie udało się odczytać wybranego pliku.']));
    return fail(invalidBackup(name, ['Plik nie jest poprawnym plikiem JSON (niepoprawna struktura).']));
  }
  const checked = await validateBackupJson(read.json, name);
  if (!checked.ok) return checked;
  const validated: ValidatedBackup = {
    kind: 'validated-backup',
    fileName: name,
    sizeBytes: read.sizeBytes,
    backup: checked.value,
    summary: summarizeBackup(checked.value),
  };
  validatedRegistry.add(validated);
  return ok(validated);
}
