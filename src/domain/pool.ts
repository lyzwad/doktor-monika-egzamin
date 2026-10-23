/**
 * Pula dopuszczalna, pojemność i walidacja N (DECYZJE §5; SPECYFIKACJA §2; kryteria C01, D07, E01, E06).
 *
 * Pula = pytania katalogu (najnowsza poprawna rewizja) przefiltrowane po zakresie, trudności
 * (poza `mixed`) i aktywnych blokadach (po `questionId`, `fingerprint` LUB `familyId`).
 * Pojemność = liczba różnych rodzin w puli. „Moje błędy” NIE zmienia pojemności.
 */
import { DEFAULT_FREE_FLOW_CONFIG, DEFAULT_TEST_CONFIG } from './policies';
import type {
  Block,
  BlockId,
  Catalog,
  CatalogQuestion,
  DifficultyChoice,
  FamilyId,
  Fingerprint,
  IsoDateTime,
  NValidation,
  PoolInfo,
  QuestionId,
  QuestionStat,
  Scope,
  SessionConfig,
  Settings,
  UserState,
} from './types';
import { isValidConfigShape } from './util';

/* ========================================================================== */
/* Blokady                                                                    */
/* ========================================================================== */

export interface BlockIndex {
  questionIds: ReadonlySet<QuestionId>;
  fingerprints: ReadonlySet<Fingerprint>;
  familyIds: ReadonlySet<FamilyId>;
}

/** Indeks AKTYWNYCH (nieodwołanych) blokad. */
export function blockIndex(blocks: Readonly<Record<BlockId, Block>>): BlockIndex {
  const questionIds = new Set<QuestionId>();
  const fingerprints = new Set<Fingerprint>();
  const familyIds = new Set<FamilyId>();
  for (const b of Object.values(blocks)) {
    if (b.revokedAt !== null) continue;
    questionIds.add(b.questionId);
    fingerprints.add(b.fingerprint);
    familyIds.add(b.familyId);
  }
  return { questionIds, fingerprints, familyIds };
}

/** Czy treść (pytanie albo snapshot) pasuje do aktywnej blokady. */
export function isBlockedBy(index: BlockIndex, item: { id: QuestionId; fingerprint: Fingerprint; familyId: FamilyId }): boolean {
  return index.questionIds.has(item.id) || index.fingerprints.has(item.fingerprint) || index.familyIds.has(item.familyId);
}

/** Czy pytanie pasuje do aktywnej (nieodwołanej) blokady po `questionId`, `fingerprint` lub `familyId`. */
export function isQuestionBlocked(question: CatalogQuestion, blocks: Readonly<Record<BlockId, Block>>): boolean {
  return isBlockedBy(blockIndex(blocks), question);
}

/* ========================================================================== */
/* Pula                                                                       */
/* ========================================================================== */

/** Pytania puli (kolejność katalogu). */
export function poolQuestions(
  catalog: Catalog,
  blocks: Readonly<Record<BlockId, Block>>,
  scope: Scope,
  difficulty: DifficultyChoice,
): CatalogQuestion[] {
  const index = blockIndex(blocks);
  return catalog.questions.filter(
    (q) => (scope === 'ALL' || q.domainId === scope) && (difficulty === 'mixed' || q.difficulty === difficulty) && !isBlockedBy(index, q),
  );
}

/** Liczba różnych rodzin. */
export function familyCount(questions: readonly CatalogQuestion[]): number {
  return new Set(questions.map((q) => q.familyId)).size;
}

/** Rodziny, których jakiekolwiek pytanie zostało faktycznie wyświetlone (`seenCount > 0`). */
export function seenFamilies(stats: Readonly<Record<QuestionId, QuestionStat>>): Set<FamilyId> {
  const out = new Set<FamilyId>();
  for (const s of Object.values(stats)) if (s.seenCount > 0) out.add(s.familyId);
  return out;
}

/**
 * Pula dopuszczalna: zakres, trudność (poza `mixed`), aktywne blokady, poprawność rekordu (katalog).
 * `activeErrors` = wszystkie aktywne błędy w puli (priorytet „Moje błędy” w Teście i Free Flow),
 * `now` nie zmienia pojemności (rezerwowane dla przyszłych liczników należności).
 */
export function poolFor(catalog: Catalog, state: UserState, scope: Scope, difficulty: DifficultyChoice, now: IsoDateTime): PoolInfo {
  void now;
  const questions = poolQuestions(catalog, state.blocks, scope, difficulty);
  const seen = seenFamilies(state.questionStats);
  const families = new Set<FamilyId>();
  const unseen = new Set<FamilyId>();
  let activeErrors = 0;
  for (const q of questions) {
    families.add(q.familyId);
    if (!seen.has(q.familyId)) unseen.add(q.familyId);
    if (state.questionStats[q.id]?.activeError === true) activeErrors++;
  }
  return {
    scope,
    difficulty,
    questionIds: questions.map((q) => q.id),
    capacity: families.size,
    unseenFamilies: unseen.size,
    activeErrors,
  };
}

/** Pojemność puli (liczba rodzin) dla zakresu i trudności. */
export function capacityFor(catalog: Catalog, state: UserState, scope: Scope, difficulty: DifficultyChoice): number {
  return familyCount(poolQuestions(catalog, state.blocks, scope, difficulty));
}

/* ========================================================================== */
/* Walidacja N (C01, S05)                                                     */
/* ========================================================================== */

/** Liczba całkowita z pola tekstowego albo przycisku; `'EMPTY'` dla pustego pola, `null` gdy to nie liczba całkowita. */
export function parseIntegerInput(raw: string | number): number | 'EMPTY' | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && Number.isInteger(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text === '') return 'EMPTY';
  const m = /^([+\-−]?)([0-9]+)$/.exec(text);
  if (!m) return null;
  const value = Number(m[2]);
  return m[1] === '-' || m[1] === '−' ? -value : value;
}

/**
 * Walidacja liczby pytań testu: dozwolona liczba całkowita 1…pojemność.
 * Puste pole → `EMPTY`; ułamek/tekst/NaN/∞ → `NOT_INTEGER`; 0 i ujemne → `TOO_SMALL`;
 * więcej niż rodzin w puli → `EXCEEDS_CAPACITY`; pusta pula → `EMPTY_POOL`.
 */
export function validateTestN(raw: string | number, capacity: number): NValidation {
  const cap = Number.isFinite(capacity) && capacity > 0 ? Math.floor(capacity) : 0;
  if (cap === 0) return { ok: false, code: 'EMPTY_POOL', capacity: 0 };
  const parsed = parseIntegerInput(raw);
  if (parsed === 'EMPTY') return { ok: false, code: 'EMPTY', capacity: cap };
  if (parsed === null) return { ok: false, code: 'NOT_INTEGER', capacity: cap };
  if (parsed < 1) return { ok: false, code: 'TOO_SMALL', capacity: cap };
  if (parsed > cap) return { ok: false, code: 'EXCEEDS_CAPACITY', capacity: cap };
  return { ok: true, n: parsed };
}

/**
 * Przyciski ±10 (S04/S05, NumberStepper): nowa wartość albo `null`, gdy wynik byłby niedozwolony
 * (przycisk nieaktywny). Puste pole liczy się jak 0; niepoprawny tekst blokuje oba przyciski.
 */
export function stepTestN(raw: string | number, delta: number, capacity: number): number | null {
  const cap = Number.isFinite(capacity) && capacity > 0 ? Math.floor(capacity) : 0;
  const parsed = parseIntegerInput(raw);
  if (parsed === null || !Number.isInteger(delta)) return null;
  const next = (parsed === 'EMPTY' ? 0 : parsed) + delta;
  return next >= 1 && next <= cap ? next : null;
}

/** Konfiguracja startowa testu: ostatnia jawnie wybrana albo domyślna (pierwsze uruchomienie: 20/mixed/ALL). */
export function initialTestConfig(settings: Settings): SessionConfig {
  const c = settings.lastTestConfig;
  if (c && isValidConfigShape(c) && typeof c.targetN === 'number') return { ...c };
  return { ...DEFAULT_TEST_CONFIG };
}

/** Konfiguracja startowa Free Flow: ostatnia jawnie wybrana albo domyślna (ALL/mixed). */
export function initialFreeFlowConfig(settings: Settings): SessionConfig {
  const c = settings.lastFreeFlowConfig;
  if (c && isValidConfigShape(c)) return { ...c, targetN: null };
  return { ...DEFAULT_FREE_FLOW_CONFIG };
}
