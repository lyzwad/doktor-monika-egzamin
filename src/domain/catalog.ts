/**
 * Runtime bank i katalog pytań (DECYZJE §2, §5, §10; 03_ARCHITEKTURA §2, §9).
 *
 * - `parseRuntimeBank` — kontrola struktury pliku `bank.json` (bez zakładania liczby pytań).
 * - `buildCatalog` — WYŁĄCZNIE wbudowany bank (od V15 bez paczek importowanych), mapowanie na camelCase,
 *   wykluczenie ID z `retired_question_ids.json`, przypisanie grup profilu treningowego.
 *   Niepoprawne rekordy trafiają do `catalog.issues` i poza pulę.
 * - `parseRetiredIds`, `parseTrainingProfile` — kontrola plików towarzyszących bankowi V15.
 * - `checkRuntimeQuestion` — wspólna walidacja rekordu (katalog i import paczek).
 */
import { normalizeText } from './fingerprint';
import {
  DOMAIN_IDS,
  type BankVersion,
  type Catalog,
  type CatalogBankSummary,
  type CatalogDomain,
  type CatalogFigure,
  type CatalogIssue,
  type CatalogQuestion,
  type CatalogSource,
  type CatalogTopic,
  type CommandResult,
  type FigureId,
  type QuestionId,
  type QuestionOrigin,
  type RuntimeBank,
  type RuntimeBankCounts,
  type RuntimeQuestion,
  type SourceId,
  type TopicId,
  type TrainingProfile,
} from './types';
import { fail, isDifficulty, isDomainId, isNonEmptyString, isRecord, ok } from './util';

/* ========================================================================== */
/* Bezpieczeństwo treści                                                      */
/* ========================================================================== */

/** URL publikacji: wyłącznie `https:` bez białych znaków i znaków sterujących. */
export function isSafeHttpsUrl(url: unknown): url is string {
  return typeof url === 'string' && /^https:\/\/[^\s<>"'`\\]+$/i.test(url) && !/[\u0000-\u001f\u007f]/.test(url);
}

/** Znaczniki HTML, skrypty i niebezpieczne schematy URL w tekście do wyświetlenia. */
const UNSAFE_TEXT = /<\s*\/?\s*[a-z!?][^<>]*>|<\s*script\b|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html/i;

export function hasUnsafeMarkup(text: string): boolean {
  return UNSAFE_TEXT.test(text);
}

/** Ścieżka figury względna do `base`, bez wychodzenia poza pakiet i bez schematu URL. */
export function isSafeRelativePath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 300) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('/') || path.startsWith('\\')) return false;
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return false;
  return path.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/** Pola niedozwolone w runtime (ustne, uzasadnienia błędnych opcji). */
export const FORBIDDEN_QUESTION_KEYS = ['option_rationales_pl', 'oral_case', 'expected_reasoning_pl'] as const;
export const FORBIDDEN_TOP_LEVEL_KEYS = ['oral_cases', 'oral_questions', 'option_rationales_pl'] as const;

/* ========================================================================== */
/* Walidacja rekordu pytania                                                  */
/* ========================================================================== */

export interface RecordIssue {
  code: string;
  messagePl: string;
}

export interface QuestionRegistries {
  /** Czy źródło istnieje w rejestrze (bank/paczka). */
  hasSource(id: SourceId): boolean;
  hasFigure(id: FigureId): boolean;
}

function label(raw: Record<string, unknown>, index: number | null): string {
  if (isNonEmptyString(raw.id)) return raw.id;
  return index === null ? 'Pytanie' : `Pytanie nr ${index + 1}`;
}

/**
 * Walidacja strukturalna rekordu pytania w formacie runtime (DECYZJE §2, §10):
 * 4 opcje o unikalnych ID i różnych tekstach, istniejący klucz, źródła z rejestru,
 * figury istnieją, brak pól ustnych/uzasadnień błędnych opcji, brak HTML/skryptów.
 * To nie jest walidacja medyczna.
 */
export function checkRuntimeQuestion(raw: unknown, registries: QuestionRegistries, index: number | null = null): RecordIssue[] {
  if (!isRecord(raw)) return [{ code: 'QUESTION_SHAPE', messagePl: `${index === null ? 'Pytanie' : `Pytanie nr ${index + 1}`}: rekord nie jest obiektem` }];
  const issues: RecordIssue[] = [];
  const who = label(raw, index);
  const add = (code: string, text: string): void => {
    issues.push({ code, messagePl: `${who}: ${text}` });
  };

  if (!isNonEmptyString(raw.id)) add('QUESTION_ID', 'brak identyfikatora pytania');
  if (typeof raw.revision !== 'number' || !Number.isSafeInteger(raw.revision) || raw.revision < 1) {
    add('REVISION', 'wersja pytania musi być dodatnią liczbą całkowitą');
  }
  if (!isNonEmptyString(raw.family_id)) add('FAMILY', 'brak rodziny bliskich wariantów');
  if (typeof raw.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(raw.fingerprint)) add('FINGERPRINT', 'brak poprawnego odcisku treści');
  if (!isDomainId(raw.domain_id)) add('DOMAIN', 'nieznana domena');
  if (!isDifficulty(raw.difficulty)) add('DIFFICULTY', 'nieznany poziom trudności');
  if (!Array.isArray(raw.topic_ids) || raw.topic_ids.length === 0 || !raw.topic_ids.every(isNonEmptyString)) {
    add('TOPIC_REFERENCE', 'wymagana niepusta lista tematów');
  }
  for (const field of ['stem_pl', 'correct_explanation_pl', 'source_locator_pl', 'review_status', 'content_check_status'] as const) {
    if (!isNonEmptyString(raw[field])) add('TEXT_FIELD', `brak wymaganego tekstu (${field})`);
  }
  if (typeof raw.approved_for_question_key !== 'boolean') add('APPROVAL_FIELD', 'brak jawnego pola approved_for_question_key');
  if (raw.cognitive_level !== null && raw.cognitive_level !== undefined && typeof raw.cognitive_level !== 'string') {
    add('COGNITIVE_LEVEL', 'nieprawidłowy poziom poznawczy');
  }

  // Opcje
  const options = raw.options;
  let optionIds: string[] = [];
  let optionTexts: string[] = [];
  if (!Array.isArray(options) || !options.every(isRecord)) {
    add('OPTIONS_NOT_4', 'warianty odpowiedzi mają nieprawidłową strukturę');
  } else if (options.length !== 4) {
    add('OPTIONS_NOT_4', `${options.length} ${options.length === 1 ? 'wariant' : options.length >= 2 && options.length <= 4 ? 'warianty' : 'wariantów'} odpowiedzi zamiast 4`);
  } else {
    optionIds = options.map((o) => (isNonEmptyString(o.id) ? o.id : ''));
    optionTexts = options.map((o) => (isNonEmptyString(o.text_pl) ? o.text_pl : ''));
    if (optionIds.some((id) => id === '') || new Set(optionIds).size !== 4) add('OPTION_IDS', 'opcje wymagają czterech unikalnych identyfikatorów');
    if (optionTexts.some((t) => t === '') || new Set(optionTexts.map(normalizeText)).size !== 4) {
      add('OPTION_TEXTS', 'teksty czterech opcji muszą być niepuste i różne');
    }
    if (!isNonEmptyString(raw.correct_option_id) || !optionIds.includes(raw.correct_option_id)) {
      add('KEY_NOT_IN_OPTIONS', 'klucz nie wskazuje żadnej z czterech opcji');
    }
  }

  // Źródła
  if (!Array.isArray(raw.source_ids) || raw.source_ids.length === 0 || !raw.source_ids.every(isNonEmptyString)) {
    add('SOURCE_REFERENCES', 'wymagana niepusta lista źródeł');
  } else {
    for (const sid of raw.source_ids) {
      if (!registries.hasSource(sid)) add('SOURCE_NOT_IN_REGISTRY', `źródło ${sid} nie występuje w rejestrze`);
    }
  }

  // Typ i figury
  if (raw.question_type !== 'text' && raw.question_type !== 'schematic') add('QUESTION_TYPE', 'nieznany typ pytania');
  if (raw.question_type === 'schematic' && !isNonEmptyString(raw.figure_id)) add('FIGURE_REFERENCE', 'pytanie ze schematem wymaga figury');
  for (const field of ['figure_id', 'explanation_figure_id'] as const) {
    const fid = raw[field];
    if (fid === null || fid === undefined) continue;
    if (!isNonEmptyString(fid) || !registries.hasFigure(fid)) add('UNKNOWN_FIGURE', `nieznana figura (${field})`);
  }

  // Zakres i bezpieczeństwo treści
  if (FORBIDDEN_QUESTION_KEYS.some((k) => k in raw)) add('OUT_OF_SCOPE', 'rekord zawiera część ustną albo uzasadnienia błędnych opcji');
  const visible = [raw.stem_pl, raw.correct_explanation_pl, raw.source_locator_pl, ...optionTexts].filter(
    (t): t is string => typeof t === 'string',
  );
  if (visible.some(hasUnsafeMarkup)) add('UNSAFE_CONTENT', 'treść zawiera znaczniki HTML, skrypt albo niedozwolony adres');

  return issues;
}

/* ========================================================================== */
/* Konwersje runtime → katalog                                                */
/* ========================================================================== */

export function toCatalogQuestion(raw: RuntimeQuestion, origin: QuestionOrigin): CatalogQuestion {
  return {
    id: raw.id,
    revision: raw.revision,
    familyId: raw.family_id,
    fingerprint: raw.fingerprint,
    domainId: raw.domain_id,
    topicIds: [...raw.topic_ids],
    difficulty: raw.difficulty,
    stem: raw.stem_pl,
    options: raw.options.map((o) => ({ id: o.id, text: o.text_pl })),
    correctOptionId: raw.correct_option_id,
    explanation: raw.correct_explanation_pl,
    sourceIds: [...raw.source_ids],
    sourceLocator: raw.source_locator_pl,
    questionType: raw.question_type,
    figureId: raw.figure_id ?? null,
    explanationFigureId: raw.explanation_figure_id ?? null,
    reviewStatus: raw.review_status,
    approvedForQuestionKey: raw.approved_for_question_key,
    contentCheckStatus: raw.content_check_status,
    cognitiveLevel: raw.cognitive_level ?? null,
    origin,
  };
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function strOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** Źródło do katalogu; niebezpieczny URL → `null` (+ zgłoszenie przez `onUnsafeUrl`). */
export function toCatalogSource(id: SourceId, raw: unknown, onUnsafeUrl?: () => void): CatalogSource | null {
  if (!isRecord(raw) || !isNonEmptyString(raw.title)) return null;
  let url: string | null = null;
  if (raw.url !== null && raw.url !== undefined) {
    if (isSafeHttpsUrl(raw.url)) url = raw.url;
    else onUnsafeUrl?.();
  }
  return {
    id,
    title: raw.title,
    url,
    doi: strOrNull(raw.doi),
    pmid: strOrNull(raw.pmid),
    kindPl: strOr(raw.kind_pl, strOr(raw.kind, '')),
    accessPl: strOr(raw.access_pl, strOr(raw.access, '')),
    checkedOn: strOrNull(raw.checked_on),
  };
}

export function toCatalogTopic(id: TopicId, raw: unknown): CatalogTopic | null {
  if (!isRecord(raw) || !isNonEmptyString(raw.title_pl) || !isDomainId(raw.domain_id)) return null;
  const pearls = Array.isArray(raw.clinical_pearls_pl) ? raw.clinical_pearls_pl.filter((p): p is string => typeof p === 'string') : [];
  return {
    id,
    title: raw.title_pl,
    domainId: raw.domain_id,
    learningObjective: strOrNull(raw.learning_objective_pl),
    pearls,
  };
}

export function toCatalogFigure(id: FigureId, raw: unknown): CatalogFigure | null {
  if (!isRecord(raw) || !isSafeRelativePath(raw.file)) return null;
  const alt = strOr(raw.alt_pl, '');
  const caption = strOr(raw.caption_pl, '');
  if (hasUnsafeMarkup(alt) || hasUnsafeMarkup(caption)) return null;
  return {
    id,
    file: raw.file,
    alt,
    caption,
    variant: strOr(raw.variant, ''),
    sourceIds: Array.isArray(raw.source_ids) ? raw.source_ids.filter(isNonEmptyString) : [],
    reviewStatus: strOr(raw.review_status, ''),
  };
}

/* ========================================================================== */
/* parseRuntimeBank                                                           */
/* ========================================================================== */

function computeCounts(questions: readonly unknown[]): RuntimeBankCounts {
  const byDomain: Partial<Record<(typeof DOMAIN_IDS)[number], number>> = {};
  const byDifficulty: RuntimeBankCounts['by_difficulty'] = {};
  const families = new Set<string>();
  let schematic = 0;
  let independentlyChecked = 0;
  for (const q of questions) {
    if (!isRecord(q)) continue;
    if (isDomainId(q.domain_id)) byDomain[q.domain_id] = (byDomain[q.domain_id] ?? 0) + 1;
    if (isDifficulty(q.difficulty)) byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] ?? 0) + 1;
    if (isNonEmptyString(q.family_id)) families.add(q.family_id);
    if (q.question_type === 'schematic') schematic++;
    if (q.content_check_status === 'independently_checked_draft') independentlyChecked++;
  }
  return {
    questions: questions.length,
    families: families.size,
    by_domain: byDomain,
    by_difficulty: byDifficulty,
    schematic,
    independently_checked_draft: independentlyChecked,
  };
}

/**
 * Strukturalna kontrola wczytanego `bank.json` (format `dme-runtime-bank`, `format_version: 1`).
 * Nieznany format/wersja albo brak wymaganych sekcji → `INVALID_BANK`. Pojedyncze rekordy pytań
 * sprawdza `buildCatalog` (niepoprawne → `issues`). Nie zakłada liczby pytań.
 */
export function parseRuntimeBank(input: unknown): CommandResult<RuntimeBank> {
  const bad = (why: string): CommandResult<RuntimeBank> =>
    fail('INVALID_BANK', `Plik pytań ma nieprawidłowy format (${why}).`, { reason: why });
  if (!isRecord(input)) return bad('to nie jest obiekt JSON');
  if (input.format !== 'dme-runtime-bank') return bad('nieznany format pliku');
  if (input.format_version !== 1) return bad('nieobsługiwana wersja formatu');
  if (!isNonEmptyString(input.bank_version)) return bad('brak wersji banku');
  if (!Array.isArray(input.questions)) return bad('brak listy pytań');
  if (!Array.isArray(input.domains)) return bad('brak listy domen');
  for (const key of ['topics', 'sources', 'figures'] as const) {
    if (!isRecord(input[key])) return bad(`brak sekcji ${key}`);
  }
  if (input.official_exam_question_bank === true) return bad('plik deklaruje oficjalny bank egzaminacyjny');
  if (FORBIDDEN_TOP_LEVEL_KEYS.some((k) => k in input)) return bad('plik zawiera część ustną albo uzasadnienia błędnych opcji');

  const counts = isRecord(input.counts) ? (input.counts as unknown as RuntimeBankCounts) : computeCounts(input.questions);
  const poolNote = strOr(input.pool_note_pl, '');
  const mergesNote = strOr(input.family_merges_note_pl, '');
  if (hasUnsafeMarkup(poolNote) || hasUnsafeMarkup(mergesNote)) return bad('opis stanu puli zawiera znaczniki HTML albo skrypt');
  const bank: RuntimeBank = {
    format: 'dme-runtime-bank',
    format_version: 1,
    schema_version: strOr(input.schema_version, '1.0'),
    bank_version: input.bank_version,
    built_on: strOr(input.built_on, ''),
    clinical_signoff: input.clinical_signoff === true,
    official_exam_question_bank: false,
    status_pl: strOr(input.status_pl, ''),
    counts,
    pool_note_pl: poolNote,
    family_merges_note_pl: mergesNote,
    domains: input.domains as RuntimeBank['domains'],
    topics: input.topics as RuntimeBank['topics'],
    sources: input.sources as RuntimeBank['sources'],
    figures: input.figures as RuntimeBank['figures'],
    questions: input.questions as RuntimeQuestion[],
  };
  return ok(bank);
}

/* ========================================================================== */
/* Podsumowanie wbudowanej puli                                               */
/* ========================================================================== */

function sameCountMap(a: Partial<Record<string, number>> | undefined, b: Partial<Record<string, number>>): boolean {
  if (!isRecord(a)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

/**
 * Liczby wbudowanej puli policzone z pytań banku, które faktycznie są w katalogu (po walidacji; pytanie
 * banku zaktualizowane paczką liczy się z bieżącą rewizją), porównane z `bank.counts`. UI pokazuje
 * WYŁĄCZNIE liczby policzone — deklaracja z pliku służy tylko do kontroli spójności.
 */
export function bankSummaryOf(bank: RuntimeBank, questions: readonly CatalogQuestion[]): CatalogBankSummary {
  const bankIds = new Set<string>();
  for (const raw of Array.isArray(bank.questions) ? bank.questions : []) {
    if (isRecord(raw) && isNonEmptyString(raw.id)) bankIds.add(raw.id);
  }
  const builtIn = questions.filter((q) => bankIds.has(q.id));
  const byDomain: CatalogBankSummary['byDomain'] = {};
  const byDifficulty: CatalogBankSummary['byDifficulty'] = {};
  const families = new Set<string>();
  let schematic = 0;
  let independentlyChecked = 0;
  for (const q of builtIn) {
    byDomain[q.domainId] = (byDomain[q.domainId] ?? 0) + 1;
    byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] ?? 0) + 1;
    families.add(q.familyId);
    if (q.questionType === 'schematic') schematic++;
    if (q.contentCheckStatus === 'independently_checked_draft') independentlyChecked++;
  }
  const declared = isRecord(bank.counts) ? bank.counts : null;
  const declaredCountsMatch =
    declared !== null &&
    declared.questions === builtIn.length &&
    declared.families === families.size &&
    sameCountMap(declared.by_domain, byDomain) &&
    sameCountMap(declared.by_difficulty, byDifficulty) &&
    (declared.schematic === undefined || declared.schematic === schematic) &&
    (declared.independently_checked_draft === undefined || declared.independently_checked_draft === independentlyChecked);
  return {
    questions: builtIn.length,
    families: families.size,
    byDomain,
    byDifficulty,
    schematic,
    independentlyChecked,
    declaredCountsMatch,
    poolNotePl: strOr(bank.pool_note_pl, ''),
    familyMergesNotePl: strOr(bank.family_merges_note_pl, ''),
  };
}

/* ========================================================================== */
/* buildCatalog                                                               */
/* ========================================================================== */

/** Pliki towarzyszące bankowi (V15): wyłączone ID, profil treningowy, wymagana wersja. */
export interface CatalogContent {
  /** ID wyłączone z aktywnej puli — nigdy nie trafiają do katalogu (wszystkie tryby). */
  retiredQuestionIds?: readonly string[];
  /** Profil treningowy (grupy ID i udziały) albo `null`. */
  profile?: TrainingProfile | null;
  /** Jedyna dopuszczalna `bank_version` — inna wersja pliku = `INVALID_BANK` (asercja wersji banku). */
  requiredBankVersion?: string;
}

/**
 * Buduje katalog WYŁĄCZNIE z wbudowanego banku (od V15 katalog nie łączy żadnych paczek): walidacja
 * rekordów, mapowanie na camelCase, wykluczenie ID wyłączonych, grupy profilu. Niepoprawne rekordy →
 * `catalog.issues`, poza pulą. Identyczna treść (fingerprint) pod innym `id` → `DUPLICATE_FINGERPRINT`.
 */
export function buildCatalog(bank: RuntimeBank, content: CatalogContent = {}): CommandResult<Catalog> {
  if (!isRecord(bank) || bank.format !== 'dme-runtime-bank' || bank.format_version !== 1 || !Array.isArray(bank.questions)) {
    return fail('INVALID_BANK', 'Plik pytań ma nieprawidłowy format.');
  }
  if (content.requiredBankVersion !== undefined && bank.bank_version !== content.requiredBankVersion) {
    return fail('INVALID_BANK', `Plik pytań ma nieoczekiwaną wersję (${String(bank.bank_version)}) — aplikacja używa wyłącznie banku ${content.requiredBankVersion}.`, {
      found: String(bank.bank_version),
      required: content.requiredBankVersion,
    });
  }
  const profile = content.profile ?? null;
  if (profile && profile.bankVersion !== bank.bank_version) {
    return fail('INVALID_BANK', 'Profil treningowy dotyczy innej wersji banku pytań.', { profile: profile.bankVersion, bank: bank.bank_version });
  }
  const retired = new Set<string>(content.retiredQuestionIds ?? []);
  const issues: CatalogIssue[] = [];
  const bankOrigin: QuestionOrigin = { kind: 'bank', bankVersion: bank.bank_version };

  const sources: Record<SourceId, CatalogSource> = {};
  const topics: Record<TopicId, CatalogTopic> = {};
  const figures: Record<FigureId, CatalogFigure> = {};
  for (const [id, raw] of Object.entries(isRecord(bank.sources) ? bank.sources : {})) {
    const src = toCatalogSource(id, raw, () =>
      issues.push({ questionId: null, origin: bankOrigin, code: 'UNSAFE_URL', messagePl: `Źródło ${id}: adres publikacji pominięty (dozwolone tylko https).` }),
    );
    if (src) sources[id] = src;
    else issues.push({ questionId: null, origin: bankOrigin, code: 'INVALID_SOURCE', messagePl: `Źródło ${id}: nieprawidłowy rekord.` });
  }
  for (const [id, raw] of Object.entries(isRecord(bank.topics) ? bank.topics : {})) {
    const t = toCatalogTopic(id, raw);
    if (t) topics[id] = t;
  }
  for (const [id, raw] of Object.entries(isRecord(bank.figures) ? bank.figures : {})) {
    const f = toCatalogFigure(id, raw);
    if (f) figures[id] = f;
    else issues.push({ questionId: null, origin: bankOrigin, code: 'UNSAFE_FIGURE', messagePl: `Figura ${id}: nieprawidłowa ścieżka albo opis.` });
  }
  const registries: QuestionRegistries = {
    hasSource: (id) => sources[id] !== undefined,
    hasFigure: (id) => figures[id] !== undefined,
  };

  const byFingerprint = new Map<string, QuestionId>();
  const seenIds = new Set<QuestionId>();
  const questions: CatalogQuestion[] = [];
  bank.questions.forEach((raw, index) => {
    const found = checkRuntimeQuestion(raw, registries, index);
    const qid = isRecord(raw) && isNonEmptyString(raw.id) ? raw.id : null;
    if (found.length > 0) {
      for (const f of found) issues.push({ questionId: qid, origin: bankOrigin, code: f.code, messagePl: f.messagePl });
      return;
    }
    const q = toCatalogQuestion(raw as RuntimeQuestion, bankOrigin);
    if (retired.has(q.id)) {
      issues.push({ questionId: q.id, origin: bankOrigin, code: 'RETIRED', messagePl: `${q.id}: pytanie wyłączone z aktywnej puli — pominięto.` });
      return;
    }
    if (seenIds.has(q.id)) {
      issues.push({ questionId: q.id, origin: bankOrigin, code: 'DUPLICATE_ID', messagePl: `${q.id}: powtórzony identyfikator w tym samym pliku.` });
      return;
    }
    seenIds.add(q.id);
    const other = byFingerprint.get(q.fingerprint);
    if (other !== undefined) {
      issues.push({ questionId: q.id, origin: bankOrigin, code: 'DUPLICATE_FINGERPRINT', messagePl: `${q.id}: ta sama treść co ${other} — pominięto.` });
      return;
    }
    if (profile && profile.groupOf[q.id] === undefined) {
      issues.push({ questionId: q.id, origin: bankOrigin, code: 'PROFILE_GROUP_MISSING', messagePl: `${q.id}: brak grupy w profilu treningowym — pominięto.` });
      return;
    }
    byFingerprint.set(q.fingerprint, q.id);
    questions.push(q);
  });
  const questionsById: Record<QuestionId, CatalogQuestion> = {};
  for (const q of questions) questionsById[q.id] = q;

  const domains: CatalogDomain[] = [];
  const domainSeen = new Set<string>();
  for (const d of Array.isArray(bank.domains) ? bank.domains : []) {
    if (!isRecord(d) || !isDomainId(d.id) || domainSeen.has(d.id)) continue;
    domainSeen.add(d.id);
    domains.push({ id: d.id, title: strOr(d.title_pl, d.id), description: strOr(d.description_pl, '') });
  }
  for (const id of DOMAIN_IDS) {
    if (!domainSeen.has(id) && questions.some((q) => q.domainId === id)) domains.push({ id, title: id, description: '' });
  }

  const bankSummary = bankSummaryOf(bank, questions);
  if (!bankSummary.declaredCountsMatch) {
    issues.push({
      questionId: null,
      origin: bankOrigin,
      code: 'COUNTS_MISMATCH',
      messagePl: 'Liczby zadeklarowane w pliku pytań (counts) nie zgadzają się z policzonymi — pokazywane są liczby policzone.',
    });
  }

  return ok({
    bankSummary,
    bankVersion: bank.bank_version,
    bankVersions: [bank.bank_version] as BankVersion[],
    builtOn: strOr(bank.built_on, ''),
    statusPl: strOr(bank.status_pl, ''),
    clinicalSignoff: bank.clinical_signoff === true,
    domains,
    questions,
    questionsById,
    topics,
    sources,
    figures,
    issues,
    retiredQuestionIds: [...retired].sort(),
    profile,
  });
}

/* ========================================================================== */
/* Pliki towarzyszące V15: wyłączone ID, profil treningowy                    */
/* ========================================================================== */

/** `retired_question_ids.json`: `{ bank_version, reason, ids[] }`. Inna wersja albo kształt → `INVALID_BANK`. */
export function parseRetiredIds(input: unknown, requiredBankVersion: string): CommandResult<string[]> {
  if (!isRecord(input) || input.bank_version !== requiredBankVersion) {
    return fail('INVALID_BANK', 'Lista wyłączonych pytań dotyczy innej wersji banku albo ma nieprawidłowy format.');
  }
  const ids = input.ids;
  if (!Array.isArray(ids) || !ids.every(isNonEmptyString) || new Set(ids).size !== ids.length) {
    return fail('INVALID_BANK', 'Lista wyłączonych pytań ma nieprawidłowy format.');
  }
  return ok([...ids]);
}

/**
 * `training_profile.json`: `{ bank_version, weights{grupa: udział}, groups{grupa: [ID]} }`. Udziały są
 * zamieniane na punkty bazowe (suma dokładnie 10 000), każde ID należy do dokładnie jednej grupy.
 */
export function parseTrainingProfile(input: unknown, requiredBankVersion: string): CommandResult<TrainingProfile> {
  const bad = (why: string): CommandResult<TrainingProfile> => fail('INVALID_BANK', `Profil treningowy ma nieprawidłowy format (${why}).`);
  if (!isRecord(input)) return bad('to nie jest obiekt JSON');
  if (input.bank_version !== requiredBankVersion) return bad('inna wersja banku');
  if (!isRecord(input.weights) || !isRecord(input.groups)) return bad('brak udziałów albo grup');
  const groupOrder = Object.keys(input.weights);
  if (groupOrder.length === 0) return bad('brak grup');
  const weightsBp: Record<string, number> = {};
  let total = 0;
  for (const g of groupOrder) {
    const w = input.weights[g];
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) return bad(`udział grupy ${g}`);
    const bp = Math.round(w * 10000);
    if (Math.abs(bp - w * 10000) > 1e-6) return bad(`udział grupy ${g} ma więcej niż 4 miejsca po przecinku`);
    weightsBp[g] = bp;
    total += bp;
  }
  if (total !== 10000) return bad('udziały nie sumują się do 1');
  if (Object.keys(input.groups).some((g) => !groupOrder.includes(g))) return bad('grupa bez udziału');
  const groupOf: Record<string, string> = {};
  for (const g of groupOrder) {
    const ids = input.groups[g];
    if (!Array.isArray(ids) || !ids.every(isNonEmptyString)) return bad(`lista ID grupy ${g}`);
    for (const id of ids) {
      if (groupOf[id] !== undefined) return bad(`ID ${id} w więcej niż jednej grupie`);
      groupOf[id] = g;
    }
  }
  return ok({ bankVersion: requiredBankVersion, groupOrder, weightsBp, groupOf });
}

/** Tytuł domeny z katalogu (zapasowo identyfikator). */
export function domainTitle(catalog: Catalog, domainId: string): string {
  return catalog.domains.find((d) => d.id === domainId)?.title ?? domainId;
}
