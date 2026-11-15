#!/usr/bin/env node
/**
 * Wydanie treści „V18 + webinary” (spec-webinary-247, kontrakt-danych.md): bajtowo niezmieniony bank V18 (700)
 * + kanoniczny dodatek `dme-webinar-addendum` (247 pytań WB) → jedno wydanie `dme-runtime-bank`.
 *
 * Czyste funkcje (testy: tests/domain/webinary-addendum.test.ts, tests/domain/bank-webinary.test.ts):
 *  - `adaptAddendum` — adapter dodatku do rekordów runtime (pola dodatku 1:1 + pola adaptera, fingerprint
 *    algorytmem aplikacji z src/domain/fingerprint.ts, `source_locator_pl`, tematy `WB-T-<Wxx>-<DOM>`, źródła Wxx);
 *  - `mergeBank` — idempotentne scalanie: pytania bazy bez zmian, WB dopisane; ten sam ID / źródło / temat /
 *    wpis `addenda` identyczny → pominięty, inny → błąd z listą pól; nic nie jest usuwane;
 *  - `identicalContentPairs` — raport pytań o tym samym fingerprincie pod różnymi ID (bez usuwania);
 *  - `buildRetired`, `buildProfile`, `buildAllowlist` — pliki towarzyszące nowej wersji;
 *  - `buildRelease` — kontrola wejść (SHA z V18 MANIFEST i MANIFEST dodatku, liczba, `active_ids`, `mode`)
 *    i treść wszystkich wyjść (serializacja `JSON.stringify(x, null, 2) + '\n'`, deterministyczna).
 *
 * CLI (tylko jako główny moduł): zapisuje 3 pliki `public/data/*-<sha12>.json`,
 * `content/v18-webinary/allowed_question_ids.json`, `src/persistence/v18Allowlist.ts`, usuwa z `public/data/`
 * pozostałe pliki banku/retired/profilu i drukuje raport. Ponowne uruchomienie daje bajtowo te same pliki.
 *
 * Użycie: node scripts/webinary-addendum.mjs [katalog projektu]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fingerprintRuntimeQuestion } from '../src/domain/fingerprint.ts';
import { isMainModule, renderAllowlistModule } from './v18-allowlist.mjs';

/* ========================================================================== */
/* Stałe kontraktu                                                            */
/* ========================================================================== */

export const RELEASE_PREFIX = 'dme-v18-webinary-2026-11-15-';
export const BUILT_ON = '2026-11-15';
export const ADDENDUM_FORMAT = 'dme-webinar-addendum';
export const WEBINAR_SOURCE_KIND = 'user_supplied_webinar_transcript';
export const ID_PREFIX = 'WB-';
export const ALLOWLIST_MODE = 'v18_plus_webinar_addendum';

/** Wejścia (ścieżki względem katalogu projektu). */
export const INPUT_PATHS = Object.freeze({
  v18Manifest: 'content/v18/MANIFEST.json',
  v18Bank: 'content/v18/bank.json',
  v18Allowed: 'content/v18/allowed_question_ids.json',
  v18Retired: 'content/v18/retired_question_ids.json',
  v18Profile: 'content/v18/training_profile.json',
  addendumManifest: 'content/webinary-2026-11-15/MANIFEST.json',
  addendum: 'content/webinary-2026-11-15/bank_webinar_addendum.json',
  excluded: 'content/webinary-2026-11-15/Wykluczone_powtorzenia.json',
});

/** Wyjścia poza `public/data/` (ścieżki względem katalogu projektu). */
export const OUTPUT_PATHS = Object.freeze({
  dataDir: 'public/data',
  allowlist: 'content/v18-webinary/allowed_question_ids.json',
  allowlistModule: 'src/persistence/v18Allowlist.ts',
});

/** Klucz pliku w V18 MANIFEST (`files`) dla każdego wejścia V18. */
const V18_MANIFEST_FILES = Object.freeze({
  v18Bank: 'runtime/bank.json',
  v18Allowed: 'runtime/allowed_question_ids.json',
  v18Retired: 'runtime/retired_question_ids.json',
  v18Profile: 'runtime/training_profile.json',
});

/** Pola pytania dodatku przenoszone 1:1 (inne pole = błąd: adapter nie może go zgubić). */
const ADDENDUM_QUESTION_KEYS = new Set([
  'id',
  'domain_id',
  'stem_pl',
  'options',
  'correct_option_id',
  'correct_explanation_pl',
  'source_id',
  'evidence_unit_ids',
  'evidence_quote',
  'source_note_pl',
  'review_status',
  'source_ids',
  'subdomain',
  'question_type',
  'revision',
  'family_id',
  'difficulty',
  'difficulty_is_technical_placeholder',
  'origin',
  'clinical_signoff',
]);
const ADDENDUM_SOURCE_KEYS = new Set(['id', 'title', 'filename', 'sha256', 'kind', 'url', 'locator_type', 'audio_verified']);
/** `review_status` w dodatku → `content_check_status` w runtime. */
const ADDENDUM_REVIEW_STATUS = 'source_checked_AI_draft';
const UNIT_ID = /^(W\d\d)-U\d{4}$/;
/** Oznaczenie końca treści pytania z webinaru (wyświetlane dosłownie). */
const WEBINAR_STEM_MARKER = '[webinar]';
/** Grupa profilu treningowego wg działu (pozostałe działy → `other`). */
const PROFILE_GROUP = Object.freeze({ SKIN: 'skin', ANAT: 'facial_anatomy' });

/* ========================================================================== */
/* Pomocnicze                                                                 */
/* ========================================================================== */

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Serializacja wszystkich plików JSON wydania (tak są zapisane wejścia). */
export function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** SHA-256 (hex) bajtów albo tekstu UTF-8. */
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** `bank_version` wydania: prefiks + 12 znaków SHA-256 z tekstu `"<sha banku V18>+<sha dodatku>"`. */
export function releaseBankVersion(v18Sha256, addendumSha256) {
  return `${RELEASE_PREFIX}${sha256Hex(`${v18Sha256}+${addendumSha256}`).slice(0, 12)}`;
}

/** Temat pytania WB: para (webinar z `source_id`, dział). */
export function webinarTopicId(sourceId, domainId) {
  return `WB-T-${sourceId}-${domainId}`;
}

/** JSON z posortowanymi kluczami (porównanie treści niezależne od kolejności kluczy). */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort(byCodeUnits)
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function shortValue(value) {
  if (value === undefined) return '—';
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

/** Ten sam rekord pod tym samym ID: identyczny → w porządku, inny → błąd z listą pól (stara i nowa wartość). */
function assertSameRecord(label, existing, incoming) {
  if (canonical(existing) === canonical(incoming)) return;
  const keys = [...Object.keys(existing), ...Object.keys(incoming).filter((k) => !Object.hasOwn(existing, k))];
  const fields = keys
    .filter((k) => canonical(existing[k]) !== canonical(incoming[k]))
    .map((k) => `${k} (w banku: ${shortValue(existing[k])}; w dodatku: ${shortValue(incoming[k])})`);
  throw new Error(`${label}: inna treść niż w banku — pola: ${fields.join('; ')}`);
}

/** Kopia obiektu z podmienionymi wartościami, w tej samej kolejności kluczy. */
function withValues(base, updates) {
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, Object.hasOwn(updates, k) ? updates[k] : structuredClone(v)]));
}

/** Liczności w kolejności kluczy `order`, nowe klucze na końcu (w kolejności pierwszego wystąpienia). */
function orderedTally(order, values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const out = {};
  for (const key of Object.keys(isObject(order) ? order : {})) if (counts.has(key)) out[key] = counts.get(key);
  for (const [key, n] of counts) if (!Object.hasOwn(out, key)) out[key] = n;
  return out;
}

/* ========================================================================== */
/* Adapter dodatku                                                            */
/* ========================================================================== */

/**
 * `source_locator_pl`: dla każdego źródła z `source_ids` (ich kolejność) grupa `"<sid>: <fragmenty>"`
 * (fragmenty z prefiksem sid w kolejności dodatku), grupy bez fragmentów pominięte, łącznik `"; "`.
 * Fragment spoza `source_ids` albo w złym formacie → błąd.
 */
export function sourceLocator(question) {
  const units = question.evidence_unit_ids;
  const sids = question.source_ids;
  const prefixOf = (unit) => UNIT_ID.exec(String(unit))?.[1] ?? null;
  for (const unit of units) {
    const prefix = prefixOf(unit);
    if (prefix === null) throw new Error(`${question.id}: nieprawidłowy identyfikator fragmentu ${unit} (oczekiwano Wxx-Unnnn)`);
    if (!sids.includes(prefix)) throw new Error(`${question.id}: fragment ${unit} nie należy do żadnego źródła z source_ids (${sids.join(', ')})`);
  }
  return sids
    .map((sid) => {
      const own = units.filter((u) => prefixOf(u) === sid);
      return own.length > 0 ? `${sid}: ${own.join(', ')}` : null;
    })
    .filter((group) => group !== null)
    .join('; ');
}

function expectValue(label, record, field, expected) {
  if (record[field] !== expected) {
    throw new Error(`${label}: pole ${field} = ${shortValue(record[field])} — oczekiwano ${JSON.stringify(expected)}`);
  }
}

function adaptSource(key, raw) {
  if (!isObject(raw)) throw new Error(`${key}: rekord źródła nie jest obiektem`);
  const unknown = Object.keys(raw).filter((k) => !ADDENDUM_SOURCE_KEYS.has(k));
  if (unknown.length > 0) throw new Error(`${key}: nieznane pola źródła (${unknown.join(', ')})`);
  expectValue(key, raw, 'id', key);
  expectValue(key, raw, 'kind', WEBINAR_SOURCE_KIND);
  expectValue(key, raw, 'url', null);
  expectValue(key, raw, 'locator_type', 'source_unit');
  expectValue(key, raw, 'audio_verified', false);
  if (!/^W\d\d$/.test(key)) throw new Error(`${key}: identyfikator źródła webinaru w formacie Wxx`);
  if (!isNonEmptyString(raw.title)) throw new Error(`${key}: brak tytułu webinaru (title)`);
  if (!isNonEmptyString(raw.filename)) throw new Error(`${key}: brak nazwy pliku transkrypcji (filename)`);
  if (typeof raw.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.sha256)) throw new Error(`${key}: sha256 musi być 64 znakami hex`);
  return {
    id: key,
    title: raw.title,
    url: null,
    doi: null,
    pmid: null,
    kind: WEBINAR_SOURCE_KIND,
    kind_pl: 'transkrypcja webinaru',
    access: 'source_unit',
    access_pl: 'fragmenty automatycznych napisów',
    checked_on: null,
    filename: raw.filename,
    sha256: raw.sha256,
    locator_type: 'source_unit',
    audio_verified: false,
  };
}

async function adaptQuestion(raw, sources) {
  if (!isObject(raw) || !isNonEmptyString(raw.id)) throw new Error('Pytanie dodatku bez identyfikatora (id)');
  const id = raw.id;
  const unknown = Object.keys(raw).filter((k) => !ADDENDUM_QUESTION_KEYS.has(k));
  if (unknown.length > 0) throw new Error(`${id}: nieznane pola pytania (${unknown.join(', ')}) — adapter nie przeniesie ich 1:1`);
  if (!id.startsWith(ID_PREFIX)) throw new Error(`${id}: identyfikator bez prefiksu ${ID_PREFIX}`);
  for (const field of ADDENDUM_QUESTION_KEYS) {
    if (field !== 'subdomain' && !Object.hasOwn(raw, field)) throw new Error(`${id}: brak pola ${field}`);
  }
  expectValue(id, raw, 'review_status', ADDENDUM_REVIEW_STATUS);
  expectValue(id, raw, 'origin', 'webinar');
  expectValue(id, raw, 'clinical_signoff', false);
  if (typeof raw.stem_pl !== 'string' || !raw.stem_pl.endsWith(WEBINAR_STEM_MARKER)) {
    throw new Error(`${id}: treść pytania (stem_pl) musi kończyć się oznaczeniem ${WEBINAR_STEM_MARKER}`);
  }
  if (!Array.isArray(raw.source_ids) || raw.source_ids.length === 0) throw new Error(`${id}: wymagana niepusta lista source_ids`);
  if (!Array.isArray(raw.evidence_unit_ids) || raw.evidence_unit_ids.length === 0) throw new Error(`${id}: wymagany co najmniej jeden fragment (evidence_unit_ids)`);
  if (!Array.isArray(raw.options)) throw new Error(`${id}: brak listy opcji`);
  if (!raw.source_ids.includes(raw.source_id)) throw new Error(`${id}: source_id ${raw.source_id} spoza source_ids (${raw.source_ids.join(', ')})`);
  for (const sid of raw.source_ids) {
    if (!sources[sid]) throw new Error(`${id}: źródło ${sid} nie występuje w dodatku`);
  }
  const locator = sourceLocator(raw);
  const fingerprint = await fingerprintRuntimeQuestion(raw);
  const out = {
    id,
    domain_id: raw.domain_id,
    topic_ids: [webinarTopicId(raw.source_id, raw.domain_id)],
    family_id: raw.family_id,
    revision: raw.revision,
    difficulty: raw.difficulty,
    difficulty_is_technical_placeholder: raw.difficulty_is_technical_placeholder,
    question_type: raw.question_type,
    figure_id: null,
    explanation_figure_id: null,
    stem_pl: raw.stem_pl,
    options: structuredClone(raw.options),
    correct_option_id: raw.correct_option_id,
    correct_explanation_pl: raw.correct_explanation_pl,
    source_ids: [...raw.source_ids],
    source_locator_pl: locator,
    review_status: 'draft_pending_clinical_review',
    approved_for_question_key: false,
    content_check_status: ADDENDUM_REVIEW_STATUS,
    cognitive_level: null,
    fingerprint,
    origin: 'webinar',
    source_id: raw.source_id,
  };
  if (Object.hasOwn(raw, 'subdomain')) out.subdomain = structuredClone(raw.subdomain);
  out.evidence_unit_ids = [...raw.evidence_unit_ids];
  out.evidence_quote = raw.evidence_quote;
  out.source_note_pl = raw.source_note_pl;
  out.clinical_signoff = false;
  return out;
}

/**
 * Adapter `dme-webinar-addendum` → rekordy `dme-runtime-bank` (kontrakt-danych.md).
 * @returns {Promise<{ entry: object, questions: object[], sources: Record<string, object>, topics: Record<string, object> }>}
 */
export async function adaptAddendum(addendum, { sha256 }) {
  if (!isObject(addendum) || addendum.format !== ADDENDUM_FORMAT) throw new Error(`Dodatek: oczekiwano formatu ${ADDENDUM_FORMAT}`);
  // Te same warunki całego pliku co validate_addendum.py z paczki (tryb dopisania, schemat, bez podpisu klinicznego).
  expectValue('Dodatek', addendum, 'schema_version', 1);
  expectValue('Dodatek', addendum, 'integration_mode', 'append');
  expectValue('Dodatek', addendum, 'clinical_signoff', false);
  expectValue('Dodatek', addendum, 'official_exam_question_bank', false);
  if (!isNonEmptyString(addendum.bank_version)) throw new Error('Dodatek: brak bank_version');
  if (!Array.isArray(addendum.questions)) throw new Error('Dodatek: brak listy pytań');
  if (!isObject(addendum.sources)) throw new Error('Dodatek: brak rejestru źródeł');
  if (addendum.count !== undefined && addendum.count !== addendum.questions.length) {
    throw new Error(`Dodatek: count ${addendum.count} ≠ liczba pytań ${addendum.questions.length}`);
  }
  const sources = {};
  for (const [key, raw] of Object.entries(addendum.sources)) sources[key] = adaptSource(key, raw);
  const questions = [];
  for (const raw of addendum.questions) questions.push(await adaptQuestion(raw, sources));
  const topicMap = new Map();
  for (const q of questions) {
    const id = q.topic_ids[0];
    if (!topicMap.has(id)) {
      topicMap.set(id, { id, title_pl: sources[q.source_id].title, domain_id: q.domain_id, learning_objective_pl: null, clinical_pearls_pl: [] });
    }
  }
  const topics = Object.fromEntries([...topicMap.entries()].sort(([a], [b]) => byCodeUnits(a, b)));
  return {
    entry: { format: ADDENDUM_FORMAT, bank_version: addendum.bank_version, sha256, count: questions.length, id_prefix: ID_PREFIX },
    questions,
    sources,
    topics,
  };
}

/* ========================================================================== */
/* Scalanie                                                                   */
/* ========================================================================== */

/** Zdania dopisywane do `status_pl` i `pool_note_pl` (liczba = pytania dodatku). */
export function webinarStatusSentence(count) {
  return ` ${count} pytań z transkrypcji webinarów (napisy automatyczne): klucz sprawdzony przez AI względem transkrypcji, bez recenzji klinicznej.`;
}
export function webinarPoolSentence(count) {
  return ` Dodano ${count} pytań z transkrypcji webinarów (napisy automatyczne); klucz sprawdzony przez AI względem transkrypcji, bez recenzji klinicznej.`;
}

const appendOnce = (text, sentence) => (text.endsWith(sentence) ? text : `${text}${sentence}`);

/** Liczności banku: kolejność kluczy bazy (nowe na końcu), statusy kontroli w kolejności pierwszego wystąpienia. */
function computeCounts(baseCounts, questions) {
  const base = isObject(baseCounts) ? baseCounts : {};
  return {
    questions: questions.length,
    families: new Set(questions.map((q) => q.family_id)).size,
    by_domain: orderedTally(base.by_domain, questions.map((q) => q.domain_id)),
    by_difficulty: orderedTally(base.by_difficulty, questions.map((q) => q.difficulty)),
    schematic: questions.filter((q) => q.question_type === 'schematic').length,
    ...orderedTally(undefined, questions.map((q) => q.content_check_status)),
  };
}

function mergeRecords(target, incoming) {
  for (const [id, record] of Object.entries(incoming)) {
    if (Object.hasOwn(target, id)) assertSameRecord(id, target[id], record);
    else target[id] = structuredClone(record);
  }
}

/**
 * Scalenie bazy (`dme-runtime-bank`) z przetworzonym dodatkiem (czyste — baza nie jest zmieniana).
 * Idempotentne: scalenie wyniku z tym samym dodatkiem daje bajtowo ten sam bank.
 */
export function mergeBank(base, adapted, { bankVersion, builtOn }) {
  const bank = structuredClone(base);
  const inAddendum = new Set();
  for (const q of adapted.questions) {
    if (inAddendum.has(q.id)) throw new Error(`${q.id}: powtórzony identyfikator w dodatku`);
    inAddendum.add(q.id);
  }
  const byId = new Map(bank.questions.map((q) => [q.id, q]));
  for (const q of adapted.questions) {
    const existing = byId.get(q.id);
    if (existing) {
      assertSameRecord(q.id, existing, q);
      continue;
    }
    const copy = structuredClone(q);
    bank.questions.push(copy);
    byId.set(q.id, copy);
  }
  mergeRecords(bank.sources, adapted.sources);
  mergeRecords(bank.topics, adapted.topics);

  const addenda = Array.isArray(bank.addenda) ? bank.addenda : [];
  const entry = adapted.entry;
  const present = addenda.find((e) => isObject(e) && e.format === entry.format && e.bank_version === entry.bank_version);
  if (present) assertSameRecord(entry.bank_version, present, entry);
  else addenda.push(structuredClone(entry));

  const count = entry.count;
  const updates = { bank_version: bankVersion, built_on: builtOn, counts: computeCounts(bank.counts, bank.questions), addenda };
  if (typeof bank.status_pl === 'string') updates.status_pl = appendOnce(bank.status_pl, webinarStatusSentence(count));
  if (typeof bank.pool_note_pl === 'string') updates.pool_note_pl = appendOnce(bank.pool_note_pl, webinarPoolSentence(count));

  const hadAddenda = Object.hasOwn(bank, 'addenda');
  const out = {};
  for (const key of Object.keys(bank)) {
    if (!hadAddenda && key === 'domains') out.addenda = addenda;
    out[key] = Object.hasOwn(updates, key) ? updates[key] : bank[key];
  }
  if (!Object.hasOwn(out, 'addenda')) out.addenda = addenda;
  return out;
}

/** Grupy ID pytań o tym samym fingerprincie pod różnymi ID (raport; nic nie jest usuwane). */
export function identicalContentPairs(questions) {
  const groups = new Map();
  for (const q of questions) {
    const ids = groups.get(q.fingerprint) ?? [];
    if (!ids.includes(q.id)) ids.push(q.id);
    groups.set(q.fingerprint, ids);
  }
  return [...groups.values()].filter((ids) => ids.length > 1);
}

/* ========================================================================== */
/* Pliki towarzyszące                                                         */
/* ========================================================================== */

/** Lista wyłączonych ID: obiekt bazy z nową wersją (ID i `policy` bez zmian); żadne ID nie może być w banku. */
export function buildRetired(base, bankVersion, bankIds) {
  const inBank = new Set(bankIds);
  const leaked = (base.ids ?? []).filter((id) => inBank.has(id));
  if (leaked.length > 0) throw new Error(`Lista wyłączonych ID zawiera pytania banku: ${leaked.join(', ')}`);
  return withValues(base, { bank_version: bankVersion });
}

/**
 * Profil treningowy: grupy bazy + ID dodatku wg działu (SKIN → skin, ANAT → facial_anatomy, reszta → other),
 * w `rules_pl` liczba pytań bazy → liczba pytań banku; każde ID banku w dokładnie jednej grupie.
 */
export function buildProfile(base, bankVersion, added, bankIds) {
  const groups = structuredClone(base.groups);
  const baseCount = Object.values(groups).flat().length;
  for (const q of added) {
    const group = PROFILE_GROUP[q.domain_id] ?? 'other';
    if (!Array.isArray(groups[group])) throw new Error(`Profil: brak grupy ${group} dla ${q.id}`);
    if (!groups[group].includes(q.id)) groups[group].push(q.id);
  }
  const groupOf = new Map();
  for (const [group, ids] of Object.entries(groups)) {
    for (const id of ids) {
      if (groupOf.has(id)) throw new Error(`Profil: ID ${id} w więcej niż jednej grupie`);
      groupOf.set(id, group);
    }
  }
  const bankSet = new Set(bankIds);
  const missing = bankIds.filter((id) => !groupOf.has(id));
  const extra = [...groupOf.keys()].filter((id) => !bankSet.has(id));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`Profil ≠ bank: brak w grupach ${missing.join(', ') || '—'}; poza bankiem ${extra.join(', ') || '—'}`);
  }
  const pattern = new RegExp(`\\b${baseCount}\\b`, 'g');
  let replaced = 0;
  const rules = (base.rules_pl ?? []).map((rule) =>
    rule.replace(pattern, () => {
      replaced++;
      return String(bankIds.length);
    }),
  );
  if (replaced === 0) throw new Error(`Profil: w rules_pl brak liczby ${baseCount} do zamiany na ${bankIds.length}`);
  return withValues(base, { bank_version: bankVersion, groups, rules_pl: rules });
}

/** Allowlista wydania: ID V18 w kolejności allowlisty V18, potem ID WB w kolejności dodatku. */
export function buildAllowlist(v18Allowed, bankVersion, wbIds) {
  const v18 = new Set(v18Allowed.ids);
  const clash = wbIds.filter((id) => v18.has(id));
  if (clash.length > 0) throw new Error(`Allowlista: ID dodatku obecne w V18: ${clash.join(', ')}`);
  return { bank_version: bankVersion, mode: ALLOWLIST_MODE, components: { V18: v18Allowed.ids.length, WB: wbIds.length }, ids: [...v18Allowed.ids, ...wbIds] };
}

/** Pliki banku/retired/profilu w `public/data/` inne niż trzy bieżące (do usunięcia). */
export function staleDataFiles(names, keep) {
  return names.filter((name) => /^(bank|retired-question-ids|training-profile)-.+\.json$/.test(name) && !keep.includes(name));
}

/* ========================================================================== */
/* Wydanie                                                                    */
/* ========================================================================== */

/** Wczytanie wejść (bajty) z katalogu projektu. */
export function readInputs(root) {
  return Object.fromEntries(Object.entries(INPUT_PATHS).map(([key, rel]) => [key, readFileSync(resolve(root, rel))]));
}

function parseInput(inputs, key) {
  try {
    return JSON.parse(Buffer.from(inputs[key]).toString('utf-8'));
  } catch (error) {
    throw new Error(`${INPUT_PATHS[key]}: niepoprawny JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

/** Opis nagłówka modułu allowlisty wydania (skład z danych). */
function allowlistDescription(allowed) {
  const ids = allowed.ids;
  const v16 = ids.filter((id) => id.startsWith('V16-')).length;
  const v17 = ids.filter((id) => id.startsWith('V17-')).length;
  return [
    `Allowlista wydania „V18 + webinary” (${ids.length} ID: ${allowed.components.V18} V18 = ${v16} V16 + ${v17} V17 oraz ${allowed.components.WB} WB`,
    'z transkrypcji webinarów) — jedyna wiążąca lista aktywnych pytań (content/v18-webinary/allowed_question_ids.json,',
    'docs/MIGRACJA_V18.md). Tylko identyfikatory, rewizje, fingerprinty, klucze, rodziny i dziedziny — bez treści pytań.',
    'Migracja danych lokalnych i wczytanie kopii zachowują postępy wyłącznie dla tych ID, gdy rewizja,',
    'fingerprint (treść + opcje) i klucz zgadzają się z bankiem; katalog aplikacji musi być równy tej liście.',
  ];
}

/**
 * Kontrola wejść i treść wszystkich wyjść wydania (bez zapisu). Każda niezgodność wejścia → wyjątek.
 */
export async function buildRelease(inputs) {
  const v18Manifest = parseInput(inputs, 'v18Manifest');
  for (const [key, name] of Object.entries(V18_MANIFEST_FILES)) {
    const expected = v18Manifest.files?.[name];
    const actual = sha256Hex(inputs[key]);
    if (actual !== expected) throw new Error(`${INPUT_PATHS[key]}: SHA-256 ${actual} ≠ ${expected} (V18 MANIFEST ${name})`);
  }
  const addendumManifest = parseInput(inputs, 'addendumManifest');
  const addendumSha = sha256Hex(inputs.addendum);
  if (addendumSha !== addendumManifest.bank_sha256) {
    throw new Error(`${INPUT_PATHS.addendum}: SHA-256 ${addendumSha} ≠ ${addendumManifest.bank_sha256} (MANIFEST dodatku)`);
  }
  if (addendumManifest.mode !== 'append') throw new Error(`MANIFEST dodatku: mode = ${shortValue(addendumManifest.mode)} — oczekiwano "append"`);

  const v18Bank = parseInput(inputs, 'v18Bank');
  const v18Allowed = parseInput(inputs, 'v18Allowed');
  const v18Retired = parseInput(inputs, 'v18Retired');
  const v18Profile = parseInput(inputs, 'v18Profile');
  const addendum = parseInput(inputs, 'addendum');
  const excluded = parseInput(inputs, 'excluded');
  for (const [name, file] of [['bank', v18Bank], ['allowlista', v18Allowed], ['retired', v18Retired], ['profil', v18Profile]]) {
    if (file.bank_version !== v18Manifest.bank_version) throw new Error(`V18 ${name}: bank_version ${file.bank_version} ≠ ${v18Manifest.bank_version}`);
  }
  const addendumIds = Array.isArray(addendum.questions) ? addendum.questions.map((q) => q?.id) : [];
  if (addendumManifest.question_count !== addendumIds.length) {
    throw new Error(`MANIFEST dodatku: question_count ${addendumManifest.question_count} ≠ ${addendumIds.length} pytań w dodatku`);
  }
  if (!sameList(addendumManifest.active_ids, addendumIds)) throw new Error('MANIFEST dodatku: active_ids ≠ ID pytań dodatku (zbiór albo kolejność)');
  if (addendum.bank_version !== addendumManifest.bank_version) {
    throw new Error(`Dodatek: bank_version ${addendum.bank_version} ≠ MANIFEST ${addendumManifest.bank_version}`);
  }
  const excludedIds = Object.keys(excluded);
  const excludedPresent = excludedIds.filter((id) => addendumIds.includes(id));
  if (excludedPresent.length > 0) throw new Error(`Wykluczone ID obecne w dodatku: ${excludedPresent.join(', ')}`);

  const adapted = await adaptAddendum(addendum, { sha256: addendumSha });
  const bankVersion = releaseBankVersion(v18Manifest.files[V18_MANIFEST_FILES.v18Bank], addendumSha);
  const merged = mergeBank(v18Bank, adapted, { bankVersion, builtOn: BUILT_ON });
  const bankIds = merged.questions.map((q) => q.id);
  const excludedInBank = excludedIds.filter((id) => bankIds.includes(id));
  if (excludedInBank.length > 0) throw new Error(`Wykluczone ID obecne w banku: ${excludedInBank.join(', ')}`);
  if (serializeJson(merged.questions.slice(0, v18Bank.questions.length)) !== serializeJson(v18Bank.questions)) {
    throw new Error('Scalony bank: rekordy V18 różnią się od content/v18/bank.json');
  }

  const retired = buildRetired(v18Retired, bankVersion, bankIds);
  const profile = buildProfile(v18Profile, bankVersion, adapted.questions, bankIds);
  const allowed = buildAllowlist(v18Allowed, bankVersion, adapted.questions.map((q) => q.id));

  const bankText = serializeJson(merged);
  const retiredText = serializeJson(retired);
  const profileText = serializeJson(profile);
  const allowedText = serializeJson(allowed);
  const bankSha256 = sha256Hex(bankText);
  const retiredSha256 = sha256Hex(retiredText);
  const profileSha256 = sha256Hex(profileText);
  const allowedSha256 = sha256Hex(allowedText);
  const bankFile = `data/bank-${bankSha256.slice(0, 12)}.json`;
  const retiredFile = `data/retired-question-ids-${retiredSha256.slice(0, 12)}.json`;
  const profileFile = `data/training-profile-${profileSha256.slice(0, 12)}.json`;
  const allowlistModule = renderAllowlistModule({
    allowed,
    bank: merged,
    allowedSha256,
    bankSha256,
    generator: 'scripts/webinary-addendum.mjs',
    description: allowlistDescription(allowed),
  });

  return {
    bankVersion,
    builtOn: BUILT_ON,
    bankFile,
    retiredFile,
    profileFile,
    bankSha256,
    retiredSha256,
    profileSha256,
    allowedSha256,
    counts: merged.counts,
    webinarCount: adapted.questions.length,
    retiredCount: retired.ids.length,
    identicalPairs: identicalContentPairs(merged.questions),
    excluded,
    addendum: { bankVersion: addendum.bank_version, sha256: addendumSha, count: adapted.questions.length },
    texts: { status: webinarStatusSentence(adapted.entry.count).trim(), pool: webinarPoolSentence(adapted.entry.count).trim() },
    files: {
      [`public/${bankFile}`]: bankText,
      [`public/${retiredFile}`]: retiredText,
      [`public/${profileFile}`]: profileText,
      [OUTPUT_PATHS.allowlist]: allowedText,
      [OUTPUT_PATHS.allowlistModule]: allowlistModule.text,
    },
  };
}

/** Raport CLI (tekst). */
export function formatReport(result, removed = []) {
  const c = result.counts;
  const statuses = Object.entries(c).filter(([k]) => !['questions', 'families', 'by_domain', 'by_difficulty', 'schematic'].includes(k));
  const lines = [
    `Wydanie: ${result.bankVersion} (built_on ${result.builtOn})`,
    `Dodatek: ${result.addendum.bankVersion}, SHA-256 ${result.addendum.sha256}, ${result.addendum.count} pytań`,
    `Pliki:`,
    `  public/${result.bankFile}  SHA-256 ${result.bankSha256}`,
    `  public/${result.retiredFile}  SHA-256 ${result.retiredSha256} (${result.retiredCount} ID)`,
    `  public/${result.profileFile}  SHA-256 ${result.profileSha256}`,
    `  ${OUTPUT_PATHS.allowlist}  SHA-256 ${result.allowedSha256} (allowedSha256)`,
    `  ${OUTPUT_PATHS.allowlistModule}`,
    `Liczby: ${c.questions} pytań, ${c.families} rodzin, schematy ${c.schematic}, WB ${result.webinarCount}`,
    `  działy: ${Object.entries(c.by_domain).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `  trudność: ${Object.entries(c.by_difficulty).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `  statusy kontroli: ${statuses.map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `Pary identycznej treści (ten sam fingerprint, różne ID): ${result.identicalPairs.length === 0 ? 'brak' : result.identicalPairs.map((g) => g.join(' = ')).join('; ')}`,
    `Wykluczone przez redakcję (tylko raport, brak w banku): ${Object.entries(result.excluded).map(([id, why]) => `${id} — ${why}`).join('; ') || 'brak'}`,
    `Dopisane zdania (do potwierdzenia przez lidera):`,
    `  status_pl += „${result.texts.status}”`,
    `  pool_note_pl += „${result.texts.pool}”`,
    `Usunięte z public/data: ${removed.length === 0 ? 'nic' : removed.join(', ')}`,
  ];
  return lines.join('\n');
}

async function main() {
  const root = resolve(process.argv[2] ?? '.');
  const result = await buildRelease(readInputs(root));
  for (const [rel, content] of Object.entries(result.files)) {
    const abs = resolve(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    if (!existsSync(abs) || readFileSync(abs, 'utf-8') !== content) writeFileSync(abs, content);
  }
  const dataDir = resolve(root, OUTPUT_PATHS.dataDir);
  const keep = [result.bankFile, result.retiredFile, result.profileFile].map((f) => f.replace(/^data\//, ''));
  const removed = staleDataFiles(readdirSync(dataDir), keep);
  for (const name of removed) rmSync(join(dataDir, name));
  console.log(formatReport(result, removed));
}

// CLI tylko przy uruchomieniu jako główny moduł (import funkcji niczego nie zapisuje).
if (isMainModule(process.argv[1], import.meta.url)) {
  main().catch((error) => {
    console.error(`BŁĄD: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
