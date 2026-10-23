/**
 * Import dodatkowej puli pytań (DECYZJE §10; 03_ARCHITEKTURA §7, §9; S22h–S22i): odczyt pliku,
 * walidacja, przeliczenie fingerprintu (funkcja domeny, Web Crypto), plan importu i rekord paczki.
 *
 * Wejście: schemat banku 1.0 (`schema_version: "1.0"`, z rejestrem `sources` w pliku) albo
 * runtime v1 (`format: "dme-runtime-bank"`, `format_version: 1`).
 *
 * Reguły (jak walidator paczki):
 * - niezgodności strukturalne i bezpieczeństwa → `fatal` (cały plik odrzucony, pula bez zmian):
 *   kształt, 4 różne warianty, jeden klucz wśród wariantów, unikalne ID, źródła z rejestru paczki
 *   z URL `https:` albo bez URL, zakazane pola (`option_rationales_pl`, `oral_case`,
 *   `expected_reasoning_pl`, część ustna), znaczniki HTML/skrypty/`javascript:` w treściach,
 *   ścieżki mediów spoza paczki, duplikat treści w pliku, niezgodny fingerprint;
 * - pozycje pojedyncze (`rejected`): ta sama ID z inną treścią bez wyższej rewizji, ilustracja
 *   niedostarczona (plik JSON nie dostarcza plików ilustracji — dopuszczalne są tylko figury już
 *   obecne w aplikacji);
 * - blokady: aktywna blokada po `questionId`, `fingerprint` LUB `familyId` → pozycja pominięta
 *   (zablokowana treść nie wraca pod nowym ID — kryterium E06); dodatkowo po TREŚCI zablokowanych
 *   pytań z katalogu i ze snapshotów historii — odporne na nieaktualny fingerprint zapisany w banku
 *   (ARCHITEKTURA_APP §8.1) i na pytania wycofane z katalogu;
 * - ta sama treść (to samo ID bez zmian albo ta sama treść pod innym ID w katalogu) → pominięta;
 *   wyższa rewizja → nowa rewizja (chyba że powiela treść innego pytania → odrzucona pozycja).
 *   „Ta sama treść” = znormalizowany stem i posortowane warianty (jak fingerprint, liczone z tekstu
 *   katalogu, nie z zapisanego odcisku), a dla tego samego ID także klucz, wyjaśnienie, rodzina,
 *   domena i poziom (jak `buildCatalog`).
 *
 * Wywołanie z kontrolera: `parseAndValidatePack(plik, {fileName, packId, now}, catalog, userState)`
 * → przy pustym `fatal`: `repository.importPack(plan.record, changesetZdarzenia)`.
 */
import { fingerprintPayload, fingerprintRuntimeQuestion, normalizeText } from '../domain/fingerprint';
import { pluralPl } from '../domain/scoring';
import { DIFFICULTIES, DOMAIN_IDS, QUESTION_TYPES } from '../domain/types';
import type {
  Block,
  BlockId,
  CatalogQuestion,
  FigureId,
  Fingerprint,
  IsoDateTime,
  PackId,
  PackImportPlan,
  PackIssue,
  PackRecord,
  QuestionId,
  RuntimeFigure,
  RuntimeQuestion,
  RuntimeSource,
  RuntimeTopic,
  Session,
  SessionId,
  SourceId,
  TopicId,
} from '../domain/types';
import { formatMegabytesPl } from './errors';
import {
  findUnsafeStrings,
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
  readJsonInput,
  show,
} from './validation';
import type { JsonObject } from './validation';

/* ========================================================================== */
/* Stałe i typy                                                               */
/* ========================================================================== */

/** Limit rozmiaru pliku puli (jak dla kopii). */
export const PACK_MAX_BYTES = 25 * 1024 * 1024;
/** Maksymalna liczba niezgodności zwracanych w `fatal`/`rejected` (resztę podsumowuje jedna pozycja). */
export const PACK_MAX_ISSUES = 100;
/** Pola poza zakresem aplikacji na poziomie pliku. */
export const PACK_FORBIDDEN_TOP_LEVEL_KEYS = ['oral_cases', 'oral_questions', 'option_rationales_pl'] as const;
/** Pola poza zakresem aplikacji w pytaniu. */
export const PACK_FORBIDDEN_QUESTION_KEYS = ['option_rationales_pl', 'oral_case', 'expected_reasoning_pl'] as const;
/** Status treści pytania z importu bez deklarowanej proweniencji (nie status seedbanku — LOG-07). */
export const IMPORTED_UNREVIEWED_STATUS = 'imported_unreviewed';

const FINGERPRINT_RE = /^[0-9a-f]{64}$/;

export type PackSourceFormat = PackRecord['sourceFormat'];

/** Metadane importu (z kontrolera). */
export interface PackFileMeta {
  fileName: string;
  /** Identyfikator nowej paczki (`crypto.randomUUID()` w kontrolerze). */
  packId: PackId;
  now: IsoDateTime;
}

/** Pola pytania katalogu potrzebne do porównania treści i wykrycia kolizji ID. */
export type PackCatalogQuestionView = Pick<
  CatalogQuestion,
  'revision' | 'fingerprint' | 'familyId' | 'domainId' | 'difficulty' | 'stem' | 'options' | 'correctOptionId' | 'explanation'
>;

/**
 * Widok katalogu potrzebny do importu — `Catalog` z domeny spełnia ten kształt.
 * `topics`/`figures`: rejestry już dostępne w aplikacji (bank + wcześniejsze paczki).
 */
export interface PackCatalogView {
  questionsById: Readonly<Record<QuestionId, PackCatalogQuestionView>>;
  topics?: Readonly<Record<TopicId, unknown>>;
  figures?: Readonly<Record<FigureId, unknown>>;
}

/** Widok stanu użytkowniczki potrzebny do importu — `UserState` spełnia ten kształt. */
export interface PackStateView {
  blocks: Readonly<Record<BlockId, Block>>;
  /**
   * Sesje (snapshoty pytań) — treść zablokowanych pytań, których nie ma już w katalogu albo których
   * blokada ma nieaktualny fingerprint. Bez tego pola blokady działają po ID, odcisku, rodzinie
   * i treści pytań z katalogu.
   */
  sessions?: Readonly<Record<SessionId, Pick<Session, 'slots'>>>;
}

/* ========================================================================== */
/* Pomocnicze                                                                 */
/* ========================================================================== */

class IssueList {
  readonly items: PackIssue[] = [];
  private overflow = 0;

  add(questionId: QuestionId | null, code: string, messagePl: string): void {
    if (this.items.length < PACK_MAX_ISSUES) this.items.push({ questionId, code, messagePl });
    else this.overflow += 1;
  }

  get count(): number {
    return this.items.length + this.overflow;
  }

  toArray(): PackIssue[] {
    if (this.overflow === 0) return [...this.items];
    return [
      ...this.items,
      {
        questionId: null,
        code: 'MORE_ISSUES',
        messagePl: `…oraz ${this.overflow} ${pluralPl(this.overflow, 'kolejna niezgodność', 'kolejne niezgodności', 'kolejnych niezgodności')}.`,
      },
    ];
  }
}

function q(text: string): string {
  return `„${text}”`;
}

function emptySummary(): PackRecord['summary'] {
  return { added: 0, updated: 0, skippedSame: 0, skippedBlocked: 0, rejected: 0 };
}

function fatalPlan(meta: PackFileMeta, sourceFormat: PackSourceFormat, bankVersion: string, fatal: PackIssue[]): PackImportPlan {
  return {
    record: {
      id: meta.packId,
      importedAt: meta.now,
      fileName: meta.fileName,
      bankVersion,
      sourceFormat,
      questions: [],
      sources: {},
      topics: {},
      figures: {},
      summary: emptySummary(),
    },
    addedIds: [],
    updatedIds: [],
    skippedSameIds: [],
    skippedBlockedIds: [],
    rejected: [],
    fatal,
  };
}

/** Rekordy rejestru: mapa `id → rekord`, lista rekordów albo grupy list (jak `canonical_sources.json`). */
function collectRegistryRecords(value: unknown): { records: JsonObject[]; malformed: number } {
  const records: JsonObject[] = [];
  let malformed = 0;
  if (value === undefined || value === null) return { records, malformed };
  const take = (item: unknown, fallbackId: string | null): void => {
    if (isObject(item)) {
      records.push(item.id === undefined && fallbackId !== null ? { ...item, id: fallbackId } : item);
    } else {
      malformed += 1;
    }
  };
  if (Array.isArray(value)) {
    for (const item of value) take(item, null);
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (Array.isArray(item)) for (const nested of item) take(nested, null);
      else take(item, key);
    }
  } else {
    malformed += 1;
  }
  return { records, malformed };
}

/**
 * Klucz treści pytania: znormalizowany stem + posortowane znormalizowane warianty (to samo, z czego
 * liczony jest fingerprint). Liczony z tekstu — niezależny od zapisanego odcisku.
 */
function contentKey(stem: string, optionTexts: readonly string[]): string {
  return fingerprintPayload(stem, optionTexts);
}

/** Klucz treści pytania katalogu albo snapshotu (`stem`, `options[].text`). */
function catalogContentKey(question: { readonly stem: string; readonly options: readonly { readonly text: string }[] }): string {
  return contentKey(
    question.stem,
    question.options.map((o) => o.text),
  );
}

function keyText(options: readonly { id: string; text: string }[], correctOptionId: string): string {
  return normalizeText(options.find((o) => o.id === correctOptionId)?.text ?? '');
}

/**
 * To samo pytanie pod tym samym ID i tą samą rewizją: ta sama treść, klucz (po tekście wariantu,
 * nie po jego ID), wyjaśnienie, rodzina, domena i poziom — jak `sameContent` w `buildCatalog`.
 */
function sameQuestionContent(existing: PackCatalogQuestionView, question: RuntimeQuestion, key: string): boolean {
  const options = question.options.map((o) => ({ id: o.id, text: o.text_pl }));
  return (
    catalogContentKey(existing) === key &&
    keyText(existing.options, existing.correctOptionId) === keyText(options, question.correct_option_id) &&
    normalizeText(existing.explanation) === normalizeText(question.correct_explanation_pl) &&
    existing.familyId === question.family_id &&
    existing.domainId === question.domain_id &&
    existing.difficulty === question.difficulty
  );
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/* ========================================================================== */
/* Rejestry paczki                                                            */
/* ========================================================================== */

function normalizeSources(value: unknown, issues: IssueList): Map<SourceId, RuntimeSource> {
  const out = new Map<SourceId, RuntimeSource>();
  const { records, malformed } = collectRegistryRecords(value);
  if (malformed > 0) issues.add(null, 'SOURCE_SHAPE', 'Rejestr źródeł zawiera pozycje, które nie są obiektami.');
  for (const rec of records) {
    const id = rec.id;
    if (!isSafeId(id)) {
      issues.add(null, 'SOURCE_SHAPE', 'Źródło w rejestrze nie ma poprawnego identyfikatora.');
      continue;
    }
    if (out.has(id)) {
      issues.add(null, 'SOURCE_ID', `Źródło ${q(id)} występuje w rejestrze więcej niż raz.`);
      continue;
    }
    const title = isNonEmptyString(rec.title) ? rec.title : isNonEmptyString(rec.title_pl) ? rec.title_pl : null;
    if (title === null) {
      issues.add(null, 'SOURCE_SHAPE', `Źródło ${q(id)} nie ma tytułu.`);
      continue;
    }
    let url: string | null = null;
    if (rec.url !== undefined && rec.url !== null) {
      if (!isSafeHttpsUrl(rec.url)) {
        issues.add(null, 'UNSAFE_URL', `Źródło ${q(id)}: adres musi zaczynać się od https:// (otrzymano ${q(show(rec.url))}).`);
        continue;
      }
      url = rec.url;
    }
    const kind = stringOrNull(rec.kind);
    const access = stringOrNull(rec.access);
    out.set(id, {
      id,
      title,
      url,
      doi: stringOrNull(rec.doi),
      pmid: stringOrNull(rec.pmid),
      kind,
      kind_pl: isNonEmptyString(rec.kind_pl) ? rec.kind_pl : (kind ?? 'źródło'),
      access,
      access_pl: typeof rec.access_pl === 'string' ? rec.access_pl : (access ?? ''),
      checked_on: isIsoDate(rec.checked_on) ? rec.checked_on : null,
    });
  }
  return out;
}

function normalizeTopics(value: unknown, issues: IssueList): Map<TopicId, RuntimeTopic> {
  const out = new Map<TopicId, RuntimeTopic>();
  const { records, malformed } = collectRegistryRecords(value);
  if (malformed > 0) issues.add(null, 'TOPIC_SHAPE', 'Rejestr tematów zawiera pozycje, które nie są obiektami.');
  for (const rec of records) {
    const id = rec.id;
    const title = isNonEmptyString(rec.title_pl) ? rec.title_pl : isNonEmptyString(rec.title) ? rec.title : null;
    const domain = rec.domain_id;
    const objective = rec.learning_objective_pl;
    const pearls = rec.clinical_pearls_pl ?? [];
    if (
      !isSafeId(id) ||
      title === null ||
      !(DOMAIN_IDS as readonly unknown[]).includes(domain) ||
      !(objective === undefined || objective === null || typeof objective === 'string') ||
      !isStringArray(pearls)
    ) {
      issues.add(null, 'TOPIC_SHAPE', `Temat ${q(show(id ?? '?'))}: niepoprawny rekord (wymagane id, title_pl, domain_id, lista clinical_pearls_pl).`);
      continue;
    }
    if (out.has(id)) {
      issues.add(null, 'TOPIC_SHAPE', `Temat ${q(id)} występuje w rejestrze więcej niż raz.`);
      continue;
    }
    out.set(id, {
      id,
      title_pl: title,
      domain_id: domain as RuntimeTopic['domain_id'],
      learning_objective_pl: typeof objective === 'string' ? objective : null,
      clinical_pearls_pl: pearls,
    });
  }
  return out;
}

/**
 * Rejestr ilustracji paczki — sprawdzany tylko pod kątem bezpieczeństwa ścieżek (plik JSON nie
 * dostarcza samych plików; pytania mogą używać wyłącznie ilustracji obecnych w aplikacji).
 */
function checkFigureRegistry(value: unknown, issues: IssueList): void {
  const { records, malformed } = collectRegistryRecords(value);
  if (malformed > 0) issues.add(null, 'FIGURE_SHAPE', 'Rejestr ilustracji zawiera pozycje, które nie są obiektami.');
  for (const rec of records) {
    const path = rec.file ?? rec.path;
    if (!isSafeRelativeMediaPath(path)) {
      issues.add(
        null,
        'UNSAFE_MEDIA_PATH',
        `Ilustracja ${q(show(rec.id ?? '?'))}: ścieżka ${q(show(path))} wychodzi poza paczkę albo nie jest względną ścieżką pliku.`,
      );
    }
  }
}

/* ========================================================================== */
/* Pytanie                                                                    */
/* ========================================================================== */

interface QuestionCheckContext {
  format: PackSourceFormat;
  isKnownSource: (id: string) => boolean;
  isKnownTopic: (id: string) => boolean;
  issues: IssueList;
  /** Prefiks miejsca dla pytań bez ID. */
  label: (index: number) => string;
}

/**
 * Strukturalna kontrola jednego pytania (bez fingerprintu). Zwraca pytanie w formacie runtime
 * (fingerprint z pliku albo pusty — do uzupełnienia) albo `null` przy niezgodnościach.
 */
function checkQuestion(raw: unknown, index: number, ctx: QuestionCheckContext): RuntimeQuestion | null {
  const before = ctx.issues.count;
  if (!isObject(raw)) {
    ctx.issues.add(null, 'QUESTION_SHAPE', `${ctx.label(index)}: pytanie musi być obiektem.`);
    return null;
  }
  const qid = isSafeId(raw.id) ? raw.id : null;
  const label = qid ?? ctx.label(index);
  const add = (code: string, message: string): void => ctx.issues.add(qid, code, `${label}: ${message}`);

  if (qid === null) add('QUESTION_ID', 'brak identyfikatora pytania');
  for (const key of PACK_FORBIDDEN_QUESTION_KEYS) {
    if (key in raw) add('OUT_OF_SCOPE', `pole ${q(key)} jest niedozwolone (część ustna lub uzasadnienia błędnych wariantów)`);
  }
  if (!isInt(raw.revision, 1)) add('REVISION', 'rewizja musi być liczbą całkowitą ≥ 1');
  if (!isSafeId(raw.family_id)) add('FAMILY', 'brak rodziny bliskich wariantów (family_id)');
  if (!(DOMAIN_IDS as readonly unknown[]).includes(raw.domain_id)) add('DOMAIN', `nieznana domena ${q(show(raw.domain_id))}`);
  if (!(DIFFICULTIES as readonly unknown[]).includes(raw.difficulty)) add('DIFFICULTY', `nieznany poziom trudności ${q(show(raw.difficulty))}`);
  for (const field of ['stem_pl', 'correct_explanation_pl', 'source_locator_pl', 'review_status'] as const) {
    if (!isNonEmptyString(raw[field])) add('TEXT_FIELD', `brak treści w polu ${q(field)}`);
  }

  const topicIds = raw.topic_ids;
  if (!isIdArray(topicIds) || topicIds.length === 0 || new Set(topicIds).size !== topicIds.length) {
    add('TOPIC_REFERENCE', 'wymagana niepusta lista różnych tematów (topic_ids)');
  } else {
    for (const topicId of topicIds) if (!ctx.isKnownTopic(topicId)) add('TOPIC_REFERENCE', `nieznany temat ${q(topicId)}`);
  }

  const options = raw.options;
  let optionIds: string[] = [];
  if (!Array.isArray(options) || options.length !== 4 || !options.every(isObject)) {
    const n = Array.isArray(options) ? options.length : 0;
    add('OPTIONS_NOT_4', `${n} ${pluralPl(n, 'wariant', 'warianty', 'wariantów')} odpowiedzi zamiast 4`);
  } else {
    optionIds = options.map((o) => o.id).filter(isNonEmptyString);
    if (optionIds.length !== 4 || new Set(optionIds).size !== 4) add('OPTION_IDS', 'warianty wymagają czterech różnych identyfikatorów');
    const texts = options.map((o) => o.text_pl);
    if (!texts.every(isNonEmptyString) || new Set(texts.map((t) => normalizeText(t))).size !== 4) {
      add('OPTION_TEXTS', 'treści czterech wariantów muszą być niepuste i różne');
    }
  }
  const key = raw.correct_option_id;
  if (Array.isArray(key)) add('KEY_NOT_IN_OPTIONS', 'klucz musi wskazywać dokładnie jeden wariant (podano listę)');
  else if (!isNonEmptyString(key) || !optionIds.includes(key)) add('KEY_NOT_IN_OPTIONS', `klucz ${q(show(key))} nie wskazuje żadnego z czterech wariantów`);

  const sourceIds = raw.source_ids;
  if (!isIdArray(sourceIds) || sourceIds.length === 0 || new Set(sourceIds).size !== sourceIds.length) {
    add('SOURCE_REFERENCES', 'wymagana niepusta lista różnych źródeł (source_ids)');
  } else {
    for (const sourceId of sourceIds) {
      if (!ctx.isKnownSource(sourceId)) add('SOURCE_NOT_IN_REGISTRY', `źródło ${q(sourceId)} nie występuje w rejestrze źródeł paczki`);
    }
  }

  if (typeof raw.approved_for_question_key !== 'boolean') add('APPROVAL_FIELD', 'brak jawnej wartości approved_for_question_key (true/false)');
  else if (ctx.format === 'bank-1.0' && raw.approved_for_question_key && !isObject(raw.clinical_review)) {
    add('APPROVAL_WITHOUT_REVIEW', 'zatwierdzenie klucza wymaga metadanych recenzji klinicznej (clinical_review)');
  }

  if (!(QUESTION_TYPES as readonly unknown[]).includes(raw.question_type)) add('QUESTION_TYPE', `nieznany typ pytania ${q(show(raw.question_type))}`);
  const figureField = (field: 'figure_id' | 'explanation_figure_id'): string | null => {
    const value = raw[field];
    if (value === undefined || value === null) return null;
    if (isNonEmptyString(value)) return value;
    add('FIGURE_REFERENCE', `niepoprawny identyfikator ilustracji w polu ${q(field)}`);
    return null;
  };
  const figureId = figureField('figure_id');
  const explanationFigureId = figureField('explanation_figure_id');
  if (raw.question_type === 'schematic' && figureId === null) add('FIGURE_REFERENCE', 'pytanie ze schematem wymaga ilustracji (figure_id)');

  // Pytanie z importu bez deklarowanej proweniencji nie udaje statusu seedbanku (LOG-07): jawnie
  // „zaimportowane, nieprzejrzane”. Status z pliku (runtime `content_check_status` albo `provenance`)
  // jest przenoszony bez zmian — to deklaracja autora paczki, nie weryfikacja aplikacji.
  let contentCheckStatus = IMPORTED_UNREVIEWED_STATUS;
  if (ctx.format === 'runtime-v1') {
    if (!(typeof raw.fingerprint === 'string' && FINGERPRINT_RE.test(raw.fingerprint))) add('FINGERPRINT_FORMAT', 'niepoprawny fingerprint (oczekiwano SHA-256 hex)');
    if (!isNonEmptyString(raw.content_check_status)) add('TEXT_FIELD', `brak treści w polu ${q('content_check_status')}`);
    else contentCheckStatus = raw.content_check_status;
  } else {
    const provenance = raw.provenance;
    if (isObject(provenance) && isNonEmptyString(provenance.content_check_status)) contentCheckStatus = provenance.content_check_status;
  }
  const cognitive = raw.cognitive_level;
  if (!(cognitive === undefined || cognitive === null || isNonEmptyString(cognitive))) add('TEXT_FIELD', `niepoprawna wartość pola ${q('cognitive_level')}`);

  if (ctx.issues.count > before || qid === null || !Array.isArray(options)) return null;

  return {
    id: qid,
    revision: raw.revision as number,
    family_id: raw.family_id as string,
    fingerprint: ctx.format === 'runtime-v1' ? (raw.fingerprint as string) : '',
    domain_id: raw.domain_id as RuntimeQuestion['domain_id'],
    topic_ids: [...(topicIds as string[])],
    difficulty: raw.difficulty as RuntimeQuestion['difficulty'],
    stem_pl: raw.stem_pl as string,
    options: (options as JsonObject[]).map((o) => ({ id: o.id as string, text_pl: o.text_pl as string })),
    correct_option_id: key as string,
    correct_explanation_pl: raw.correct_explanation_pl as string,
    source_ids: [...(sourceIds as string[])],
    source_locator_pl: raw.source_locator_pl as string,
    question_type: raw.question_type as RuntimeQuestion['question_type'],
    figure_id: figureId,
    explanation_figure_id: explanationFigureId,
    review_status: raw.review_status as string,
    approved_for_question_key: raw.approved_for_question_key as boolean,
    content_check_status: contentCheckStatus,
    cognitive_level: isNonEmptyString(cognitive) ? cognitive : null,
  };
}

/** Zgłoszenia niebezpiecznej treści (jedno na pytanie/miejsce). */
function reportUnsafeStrings(json: JsonObject, issues: IssueList): void {
  const questions = Array.isArray(json.questions) ? json.questions : [];
  const reported = new Set<string>();
  for (const path of findUnsafeStrings(json)) {
    const m = /^questions\[(\d+)\](?:\.([^.[]+))?/.exec(path);
    if (m) {
      const question = questions[Number(m[1])];
      const qid = isObject(question) && isNonEmptyString(question.id) ? question.id : null;
      const where = qid ?? `pytanie nr ${Number(m[1]) + 1}`;
      const field = m[2] ?? 'treść';
      const dedupe = `${where}|${field}`;
      if (reported.has(dedupe)) continue;
      reported.add(dedupe);
      issues.add(qid, 'UNSAFE_CONTENT', `${where}: treść zawiera znaczniki HTML, skrypt lub niedozwolony adres (pole ${q(field)})`);
    } else {
      issues.add(null, 'UNSAFE_CONTENT', `Plik zawiera znaczniki HTML, skrypt lub niedozwolony adres (${path || 'treść'}).`);
    }
  }
}

/* ========================================================================== */
/* Odczyt pliku                                                               */
/* ========================================================================== */

export type PackReadResult = { ok: true; json: unknown; sizeBytes: number } | { ok: false; issues: PackIssue[] };

/** Odczyt pliku puli: limit 25 MB, JSON. */
export async function readPackFile(input: Blob | string): Promise<PackReadResult> {
  const read = await readJsonInput(input, PACK_MAX_BYTES);
  if (read.ok) return read;
  switch (read.reason) {
    case 'too_large':
      return {
        ok: false,
        issues: [
          {
            questionId: null,
            code: 'FILE_TOO_LARGE',
            messagePl: `Plik ma ${formatMegabytesPl(read.sizeBytes, true)} — więcej niż limit ${formatMegabytesPl(PACK_MAX_BYTES)} dla puli pytań.`,
          },
        ],
      };
    case 'unreadable':
      return { ok: false, issues: [{ questionId: null, code: 'READ_FAILED', messagePl: 'Nie udało się odczytać wybranego pliku.' }] };
    default:
      return { ok: false, issues: [{ questionId: null, code: 'INVALID_JSON', messagePl: 'Plik nie jest poprawnym plikiem JSON (niepoprawna struktura).' }] };
  }
}

/* ========================================================================== */
/* Walidacja i plan importu                                                   */
/* ========================================================================== */

/**
 * Walidacja paczki i plan importu. Asynchroniczna (SHA-256 przez Web Crypto) — wywoływać PRZED
 * transakcją zapisu (`repository.importPack`). Nie zmienia żadnych danych.
 */
export async function validatePackFile(
  json: unknown,
  meta: PackFileMeta,
  catalog: PackCatalogView,
  state: PackStateView,
): Promise<PackImportPlan> {
  const fatal = new IssueList();
  if (!isObject(json)) {
    fatal.add(null, 'NOT_OBJECT', 'Plik nie zawiera obiektu puli pytań.');
    return fatalPlan(meta, 'bank-1.0', '', fatal.toArray());
  }

  /* ---- format ---- */
  let sourceFormat: PackSourceFormat;
  if (json.format === 'dme-backup') {
    fatal.add(null, 'WRONG_FILE', 'To jest plik kopii danych, nie pula pytań. Wczytaj go w ustawieniach: „Kopia danych”.');
    return fatalPlan(meta, 'bank-1.0', '', fatal.toArray());
  } else if (json.format === 'dme-runtime-bank') {
    sourceFormat = 'runtime-v1';
    if (json.format_version !== 1) {
      fatal.add(null, 'UNSUPPORTED_VERSION', `Nieobsługiwana wersja formatu puli (${show(json.format_version)}); ta wersja aplikacji obsługuje format 1.`);
    }
    if (json.schema_version !== undefined && json.schema_version !== '1.0') {
      fatal.add(null, 'UNSUPPORTED_VERSION', `Nieobsługiwana wersja schematu banku (${show(json.schema_version)}); obsługiwana: 1.0.`);
    }
    if (fatal.count > 0) return fatalPlan(meta, sourceFormat, '', fatal.toArray());
  } else if (json.format !== undefined) {
    fatal.add(null, 'UNKNOWN_FORMAT', `Nieznany format pliku ${q(show(json.format))} — oczekiwano puli pytań (schemat banku 1.0 albo dme-runtime-bank 1).`);
    return fatalPlan(meta, 'bank-1.0', '', fatal.toArray());
  } else if (json.schema_version === '1.0') {
    sourceFormat = 'bank-1.0';
  } else if (json.schema_version !== undefined) {
    fatal.add(null, 'UNSUPPORTED_VERSION', `Nieobsługiwana wersja schematu banku (${show(json.schema_version)}); obsługiwana: 1.0.`);
    return fatalPlan(meta, 'bank-1.0', '', fatal.toArray());
  } else {
    fatal.add(null, 'UNKNOWN_FORMAT', 'Nieznany format pliku — oczekiwano puli pytań (schemat banku 1.0 albo dme-runtime-bank 1).');
    return fatalPlan(meta, 'bank-1.0', '', fatal.toArray());
  }

  /* ---- pola pliku ---- */
  const bankVersion = isNonEmptyString(json.bank_version) ? json.bank_version : '';
  if (bankVersion === '') fatal.add(null, 'BANK_VERSION', 'Brak wersji puli (bank_version).');
  if (json.official_exam_question_bank !== false) {
    fatal.add(null, 'OFFICIAL_BANK', 'Pula nie może mieć statusu oficjalnego banku egzaminacyjnego (official_exam_question_bank musi mieć wartość false).');
  }
  if (typeof json.clinical_signoff !== 'boolean') fatal.add(null, 'CLINICAL_SIGNOFF_FIELD', 'Pole clinical_signoff musi mieć jawną wartość true/false.');
  for (const key of PACK_FORBIDDEN_TOP_LEVEL_KEYS) {
    if (key in json) fatal.add(null, 'OUT_OF_SCOPE', `Pole ${q(key)} jest niedozwolone (część ustna lub uzasadnienia błędnych wariantów).`);
  }
  const questions = json.questions;
  if (!Array.isArray(questions)) {
    fatal.add(null, 'QUESTIONS_SHAPE', 'Brak listy pytań (questions).');
    return fatalPlan(meta, sourceFormat, bankVersion, fatal.toArray());
  }
  if (questions.length === 0) fatal.add(null, 'EMPTY_PACK', 'Lista pytań jest pusta.');

  /* ---- bezpieczeństwo treści (cały plik) ---- */
  reportUnsafeStrings(json, fatal);

  /* ---- rejestry ---- */
  const sources = normalizeSources(json.sources, fatal);
  const topics = normalizeTopics(json.topics, fatal);
  checkFigureRegistry(json.figures, fatal);
  const knownTopics = catalog.topics ?? {};
  const knownFigures = catalog.figures ?? {};

  /* ---- pytania (struktura) ---- */
  const ctx: QuestionCheckContext = {
    format: sourceFormat,
    isKnownSource: (id) => sources.has(id),
    isKnownTopic: (id) => topics.has(id) || Object.hasOwn(knownTopics, id),
    issues: fatal,
    label: (index) => `Pytanie nr ${index + 1}`,
  };
  const parsed: RuntimeQuestion[] = [];
  const seenIds = new Set<QuestionId>();
  questions.forEach((raw, index) => {
    const question = checkQuestion(raw, index, ctx);
    const rawId = isObject(raw) && isNonEmptyString(raw.id) ? raw.id : null;
    if (rawId !== null) {
      if (seenIds.has(rawId)) fatal.add(rawId, 'DUPLICATE_ID', `${rawId}: identyfikator występuje w pliku więcej niż raz`);
      seenIds.add(rawId);
    }
    if (question) parsed.push(question);
  });
  if (fatal.count > 0) return fatalPlan(meta, sourceFormat, bankVersion, fatal.toArray());

  /* ---- fingerprint (Web Crypto — przed jakąkolwiek transakcją) ---- */
  const computed = new Map<QuestionId, Fingerprint>();
  try {
    for (const question of parsed) computed.set(question.id, await fingerprintRuntimeQuestion(question));
  } catch {
    fatal.add(null, 'CRYPTO_UNAVAILABLE', 'Nie można sprawdzić puli: brak Web Crypto (aplikacja wymaga https albo localhost).');
    return fatalPlan(meta, sourceFormat, bankVersion, fatal.toArray());
  }
  const firstByFingerprint = new Map<Fingerprint, QuestionId>();
  for (const question of parsed) {
    const fp = computed.get(question.id) as Fingerprint;
    if (sourceFormat === 'runtime-v1' && question.fingerprint !== fp) {
      fatal.add(question.id, 'FINGERPRINT_MISMATCH', `${question.id}: fingerprint w pliku nie zgadza się z treścią pytania`);
    }
    const first = firstByFingerprint.get(fp);
    if (first !== undefined) fatal.add(question.id, 'EXACT_DUPLICATE', `${question.id}: ta sama treść i warianty co ${first}`);
    else firstByFingerprint.set(fp, question.id);
  }
  if (fatal.count > 0) return fatalPlan(meta, sourceFormat, bankVersion, fatal.toArray());

  /* ---- klasyfikacja: blokady, kolizje, ilustracje ---- */
  const active = Object.values(state.blocks).filter((block) => block.revokedAt === null);
  const blockedIds = new Set(active.map((b) => b.questionId));
  const blockedFingerprints = new Set(active.map((b) => b.fingerprint));
  const blockedFamilies = new Set(active.map((b) => b.familyId));
  const isBlockedItem = (id: QuestionId, fingerprint: Fingerprint, familyId: string): boolean =>
    blockedIds.has(id) || blockedFingerprints.has(fingerprint) || blockedFamilies.has(familyId);

  // Treść pytań katalogu (z tekstu) i treść zablokowana: pytania katalogu objęte blokadą oraz
  // snapshoty z historii (pytanie wycofane z katalogu albo blokada z nieaktualnym odciskiem).
  const existingByFingerprint = new Map<Fingerprint, QuestionId>();
  const existingByContent = new Map<string, QuestionId>();
  const blockedContent = new Set<string>();
  for (const [id, existing] of Object.entries(catalog.questionsById)) {
    const key = catalogContentKey(existing);
    if (!existingByFingerprint.has(existing.fingerprint)) existingByFingerprint.set(existing.fingerprint, id);
    if (!existingByContent.has(key)) existingByContent.set(key, id);
    if (active.length > 0 && isBlockedItem(id, existing.fingerprint, existing.familyId)) blockedContent.add(key);
  }
  if (active.length > 0) {
    for (const session of Object.values(state.sessions ?? {})) {
      for (const slot of Object.values(session.slots)) {
        const snapshot = slot.snapshot;
        if (isBlockedItem(snapshot.questionId, snapshot.fingerprint, snapshot.familyId)) blockedContent.add(catalogContentKey(snapshot));
      }
    }
  }

  const rejected = new IssueList();
  const addedIds: QuestionId[] = [];
  const updatedIds: QuestionId[] = [];
  const skippedSameIds: QuestionId[] = [];
  const skippedBlockedIds: QuestionId[] = [];
  const accepted: RuntimeQuestion[] = [];

  for (const question of parsed) {
    const fp = computed.get(question.id) as Fingerprint;
    const key = contentKey(
      question.stem_pl,
      question.options.map((o) => o.text_pl),
    );
    if (isBlockedItem(question.id, fp, question.family_id) || blockedFingerprints.has(question.fingerprint) || blockedContent.has(key)) {
      skippedBlockedIds.push(question.id);
      continue;
    }
    const existing = Object.hasOwn(catalog.questionsById, question.id) ? catalog.questionsById[question.id] : undefined;
    const twin = existingByContent.get(key) ?? existingByFingerprint.get(fp);
    let kind: 'added' | 'updated';
    if (existing) {
      if (question.revision > existing.revision) {
        if (twin !== undefined && twin !== question.id) {
          rejected.add(
            question.id,
            'DUPLICATE_CONTENT',
            `${question.id}: nowa rewizja powtarza treść pytania ${twin} (ta sama treść pod innym identyfikatorem) — pozycja pominięta`,
          );
          continue;
        }
        kind = 'updated';
      } else if (sameQuestionContent(existing, question, key)) {
        skippedSameIds.push(question.id);
        continue;
      } else {
        rejected.add(
          question.id,
          'ID_CONFLICT',
          `${question.id}: inna treść lub klasyfikacja niż pytanie o tym identyfikatorze w aplikacji, bez wyższej rewizji (${question.revision} ≤ ${existing.revision}) — pozycja pominięta`,
        );
        continue;
      }
    } else if (twin !== undefined) {
      // Ta sama treść pod nowym ID — duplikat istniejącego pytania.
      skippedSameIds.push(question.id);
      continue;
    } else {
      kind = 'added';
    }
    const missingFigure = [question.figure_id, question.explanation_figure_id].find(
      (fid): fid is string => fid !== null && !Object.hasOwn(knownFigures, fid),
    );
    if (missingFigure !== undefined) {
      rejected.add(
        question.id,
        'FIGURE_NOT_DELIVERED',
        `${question.id}: ilustracja ${q(missingFigure)} nie jest dostępna w aplikacji (plik puli nie dostarcza plików ilustracji) — pozycja pominięta`,
      );
      continue;
    }
    accepted.push({ ...question, fingerprint: fp });
    (kind === 'added' ? addedIds : updatedIds).push(question.id);
  }

  const usedSources: Record<SourceId, RuntimeSource> = {};
  const usedTopics: Record<TopicId, RuntimeTopic> = {};
  for (const question of accepted) {
    for (const sid of question.source_ids) {
      const source = sources.get(sid);
      if (source) usedSources[sid] = source;
    }
    for (const tid of question.topic_ids) {
      const topic = topics.get(tid);
      if (topic) usedTopics[tid] = topic;
    }
  }
  const rejectedList = rejected.toArray();
  const record: PackRecord = {
    id: meta.packId,
    importedAt: meta.now,
    fileName: meta.fileName,
    bankVersion,
    sourceFormat,
    questions: accepted,
    sources: usedSources,
    topics: usedTopics,
    figures: {} as Record<FigureId, RuntimeFigure>,
    summary: {
      added: addedIds.length,
      updated: updatedIds.length,
      skippedSame: skippedSameIds.length,
      skippedBlocked: skippedBlockedIds.length,
      rejected: rejected.count,
    },
  };
  return { record, addedIds, updatedIds, skippedSameIds, skippedBlockedIds, rejected: rejectedList, fatal: [] };
}

/** Odczyt + walidacja pliku puli (jedno wywołanie dla kontrolera). */
export async function parseAndValidatePack(
  input: Blob | string,
  meta: PackFileMeta,
  catalog: PackCatalogView,
  state: PackStateView,
): Promise<PackImportPlan> {
  const read = await readPackFile(input);
  if (!read.ok) return fatalPlan(meta, 'bank-1.0', '', read.issues);
  return validatePackFile(read.json, meta, catalog, state);
}

/* ========================================================================== */
/* Paczki zapisane w kopii danych                                             */
/* ========================================================================== */

/**
 * Kontrola rekordu paczki pochodzącego z pliku kopii (te same reguły treści co przy imporcie,
 * bez porównania z katalogiem). Zwraca listę przyczyn po polsku (pusta = poprawny).
 */
export function checkStoredPackRecord(raw: unknown, where: string): string[] {
  const issues = new IssueList();
  if (!isObject(raw)) return [`${where}: paczka musi być obiektem.`];
  const reasons: string[] = [];
  if (!isNonEmptyString(raw.id)) reasons.push(`${where}: brak identyfikatora paczki.`);
  if (!isIsoDateTime(raw.importedAt)) reasons.push(`${where}: niepoprawna data importu (importedAt).`);
  if (typeof raw.fileName !== 'string') reasons.push(`${where}: brak nazwy pliku (fileName).`);
  if (typeof raw.bankVersion !== 'string') reasons.push(`${where}: brak wersji puli (bankVersion).`);
  if (raw.sourceFormat !== 'bank-1.0' && raw.sourceFormat !== 'runtime-v1') reasons.push(`${where}: niedozwolony format źródłowy ${q(show(raw.sourceFormat))}.`);
  const summary = raw.summary;
  if (!isObject(summary) || !['added', 'updated', 'skippedSame', 'skippedBlocked', 'rejected'].every((k) => isInt(summary[k], 0))) {
    reasons.push(`${where}: niepoprawne podsumowanie importu (summary).`);
  }
  for (const path of findUnsafeStrings(raw).slice(0, 20)) {
    reasons.push(`${where}: treść zawiera znaczniki HTML, skrypt lub niedozwolony adres (${path}).`);
  }
  if (!isObject(raw.sources) || !isObject(raw.topics) || !isObject(raw.figures)) {
    reasons.push(`${where}: wymagane rejestry sources, topics i figures (obiekty).`);
    return reasons;
  }
  const sources = normalizeSources(raw.sources, issues);
  normalizeTopics(raw.topics, issues);
  checkFigureRegistry(raw.figures, issues);
  if (!Array.isArray(raw.questions)) {
    reasons.push(`${where}: brak listy pytań.`);
    return reasons;
  }
  const ctx: QuestionCheckContext = {
    format: 'runtime-v1',
    isKnownSource: (id) => sources.has(id),
    isKnownTopic: () => true,
    issues,
    label: (index) => `pytanie nr ${index + 1}`,
  };
  const seen = new Set<string>();
  raw.questions.forEach((question, index) => {
    const checked = checkQuestion(question, index, ctx);
    if (checked) {
      if (seen.has(checked.id)) issues.add(checked.id, 'DUPLICATE_ID', `${checked.id}: identyfikator występuje w paczce więcej niż raz`);
      seen.add(checked.id);
    }
  });
  for (const issue of issues.toArray()) reasons.push(`${where}: ${issue.messagePl}`);
  return reasons;
}

/**
 * Pytania zapisanej paczki, których fingerprint nie zgadza się z treścią (asynchronicznie —
 * Web Crypto). Wywoływać tylko dla rekordów, które przeszły `checkStoredPackRecord`.
 */
export async function storedPackFingerprintMismatches(record: PackRecord): Promise<QuestionId[]> {
  const mismatched: QuestionId[] = [];
  for (const question of record.questions) {
    if ((await fingerprintRuntimeQuestion(question)) !== question.fingerprint) mismatched.push(question.id);
  }
  return mismatched;
}
