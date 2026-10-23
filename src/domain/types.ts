/**
 * KONTRAKT DANYCH DOMENY — Doktor Monika Egzamin.
 *
 * Czysty TypeScript: bez React, DOM, IndexedDB, `Date.now()` i `Math.random()`.
 * Wiążące rozstrzygnięcia: docs/DECYZJE_ARCHITEKTURY.md (sekcje podane przy typach).
 *
 * Konwencje:
 * - Rekordy pliku `public/data/bank.json` (format `dme-runtime-bank` v1) mają nazwy pól
 *   jak w JSON (snake_case) — typy `Runtime*`.
 * - Model domeny (katalog, sesje, próby…) używa camelCase.
 * - Daty: ISO 8601 w UTC z kontrolera (`IsoDateTime`), np. `2026-10-22T18:42:00.000Z`.
 * - Wszystkie struktury traktuj jako niemutowalne: funkcje domeny zwracają nowe obiekty.
 * - Rekordy zapisywane w IndexedDB muszą być „structured-clone” i JSON-serializowalne
 *   (bez Map/Set/klas/funkcji/undefined w tablicach).
 */

/* ========================================================================== */
/* Identyfikatory i aliasy                                                    */
/* ========================================================================== */

/** Data i czas ISO 8601 (UTC), np. `2026-10-22T18:42:00.000Z`. */
export type IsoDateTime = string;
/** Data kalendarzowa `YYYY-MM-DD`. */
export type IsoDate = string;
/** Identyfikator pytania z banku, np. `ANAT-Q001`. Stały między rewizjami. */
export type QuestionId = string;
/** Rodzina bliskich wariantów jednego zadania (nie temat, nie domena). */
export type FamilyId = string;
/** Stały identyfikator opcji pytania (`A`…`D` w banku), niezależny od pokazanej litery. */
export type OptionId = string;
export type SourceId = string;
export type TopicId = string;
export type FigureId = string;
/** `crypto.randomUUID()` z kontrolera (DECYZJE §3). */
export type SessionId = string;
/** `crypto.randomUUID()` z kontrolera (DECYZJE §3). */
export type SlotId = string;
/** Identyfikator komendy użytkownika; powtórzenie tej samej komendy jest idempotentne. */
export type CommandId = string;
/** `crypto.randomUUID()` z kontrolera (DECYZJE §3). */
export type BlockId = string;
export type EventId = string;
/** Identyfikator łańcucha rund „Uwzględnij błędy”. */
export type RetryChainId = string;
/** Identyfikator zaimportowanej paczki pytań. */
export type PackId = string;
/** SHA-256 (hex, 64 znaki, małe litery) znormalizowanego stemu i posortowanych opcji (DECYZJE §2). */
export type Fingerprint = string;
/** Wersja banku, np. `seed-2026-10-22`. */
export type BankVersion = string;

/* ========================================================================== */
/* Enumy (stałe + typy unii)                                                  */
/* ========================================================================== */

/** Domeny w kolejności rotacji testu (DECYZJE §6): ANAT, INJ, SKIN, THER, DEV, SAFE. */
export const DOMAIN_IDS = ['ANAT', 'INJ', 'SKIN', 'THER', 'DEV', 'SAFE'] as const;
export type DomainId = (typeof DOMAIN_IDS)[number];

/** Poziom trudności pytania (autorski, nie kalibracja egzaminu). */
export const DIFFICULTIES = ['basic', 'intermediate', 'advanced'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Wybór trudności sesji: `mixed` = mieszany (domyślny), pozostałe = tylko ten poziom. */
export const DIFFICULTY_CHOICES = ['mixed', 'basic', 'intermediate', 'advanced'] as const;
export type DifficultyChoice = (typeof DIFFICULTY_CHOICES)[number];

/** Zakres sesji: cały zakres albo jedna domena. */
export type Scope = 'ALL' | DomainId;

/** Typ pytania w banku. `schematic` wymaga `figure_id`. */
export const QUESTION_TYPES = ['text', 'schematic'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Tryb sesji: dokładnie dwa tryby aplikacji. */
export const SESSION_KINDS = ['test', 'freeflow'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

/**
 * Status sesji (DECYZJE §4):
 * - `open` — w toku (najwyżej jedna otwarta sesja naraz),
 * - `completed` — Test ukończony jawnym „Pokaż wynik” po N ważnych odpowiedziach,
 * - `unfinished` — Test zamknięty bez wyniku (`passed = null`),
 * - `ended` — Free Flow zakończony ręcznie (bez progu).
 */
export const SESSION_STATUSES = ['open', 'completed', 'unfinished', 'ended'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 * Pochodzenie slotu (DECYZJE §4, §6):
 * - `planned` — zwykły dobór testu (koszyk domena × poziom),
 * - `repeated_wrong` — błąd bezpośredniego rodzica w rundzie „Uwzględnij błędy”,
 * - `my_errors` — aktywny błąd z globalnej kolejki („Moje błędy”),
 * - `filler` — uzupełnienie rundy powtórki do N,
 * - `replacement` — zastępstwo za zgłoszony slot,
 * - `freeflow` — kolejne pytanie Free Flow.
 */
export const SLOT_ORIGINS = ['planned', 'repeated_wrong', 'my_errors', 'filler', 'replacement', 'freeflow'] as const;
export type SlotOrigin = (typeof SLOT_ORIGINS)[number];

/** Przyczyna wykluczenia slotu z punktacji. Jedyna obsługiwana: zgłoszenie flagą. */
export type ExclusionReason = 'reported';

/** Przyczyna blokady pytania w przyszłych losowaniach. */
export type BlockReason = 'reported';

/**
 * Nazwy wersjonowanych polityk doboru (zapisywane w sesji dla odtwarzalności). Nowe sesje: V2;
 * V1 pozostaje poprawną wartością sesji zapisanych wcześniej (DECYZJE §6–§7).
 */
export type SelectionPolicyName = 'TEST_POLICY_V1' | 'TEST_POLICY_V2' | 'FREE_FLOW_POLICY_V1' | 'FREE_FLOW_POLICY_V2';

/* ========================================================================== */
/* Runtime bank — public/data/bank.json (DECYZJE §2)                          */
/* ========================================================================== */

/**
 * Plik runtime banku (`dme-runtime-bank` v1) generowany przez
 * `redakcja/narzedzia/zbuduj_runtime.py`. Kod nie może zakładać konkretnej liczby pytań.
 */
export interface RuntimeBank {
  format: 'dme-runtime-bank';
  format_version: 1;
  /** Wersja schematu banku źródłowego, obecnie `"1.0"`. */
  schema_version: string;
  bank_version: BankVersion;
  /** Data zbudowania pliku (`YYYY-MM-DD`). */
  built_on: IsoDate;
  /** Czy klucze mają podpisaną recenzję kliniczną. Obecnie `false` — zachować i pokazać w „O bazie”. */
  clinical_signoff: boolean;
  /** Zawsze `false`: to nie jest oficjalny bank egzaminacyjny. */
  official_exam_question_bank: false;
  /** Opis statusu materiału po polsku (do „O bazie” i ustawień). */
  status_pl: string;
  counts: RuntimeBankCounts;
  /** Jawna informacja o stanie puli (np. że cel 2000–3000 nie został osiągnięty) — „O bazie”, ustawienia. */
  pool_note_pl?: string;
  /** Informacja o scaleniu rodzin w runtime (opcjonalna). */
  family_merges_note_pl?: string;
  domains: RuntimeDomain[];
  topics: Record<TopicId, RuntimeTopic>;
  sources: Record<SourceId, RuntimeSource>;
  figures: Record<FigureId, RuntimeFigure>;
  questions: RuntimeQuestion[];
}

/** Liczebności faktycznej puli (z pliku, nie z celów). */
export interface RuntimeBankCounts {
  questions: number;
  families: number;
  by_domain: Partial<Record<DomainId, number>>;
  by_difficulty: Partial<Record<Difficulty, number>>;
  schematic: number;
  independently_checked_draft: number;
}

export interface RuntimeDomain {
  id: DomainId;
  /** Krótka nazwa, np. „Anatomia”. */
  title_pl: string;
  description_pl: string;
}

/** Temat — źródło „szerszego kontekstu” po odpowiedzi (cel nauki, perełki). */
export interface RuntimeTopic {
  id: TopicId;
  title_pl: string;
  domain_id: DomainId;
  learning_objective_pl: string | null;
  clinical_pearls_pl: string[];
}

/** Źródło z rejestru. `url` tylko https z rejestru albo `null` (DECYZJE §2). */
export interface RuntimeSource {
  id: SourceId;
  title: string;
  url: string | null;
  doi: string | null;
  pmid: string | null;
  kind: string | null;
  /** Rodzaj po polsku, np. „przegląd systematyczny”. */
  kind_pl: string;
  access: string | null;
  /** Zakres odczytu po polsku, np. „abstrakt”. */
  access_pl: string;
  checked_on: IsoDate | null;
}

/**
 * Figura (SVG lokalne w `public/figures/`). Wersja pytania nie może ujawniać klucza
 * (nazwa pliku, alt, podpis). `variant`: oczekiwane `question` albo `explanation`.
 */
export interface RuntimeFigure {
  id: FigureId;
  /** Ścieżka względna do `base`, np. `figures/PLAN-FIG-01-pytanie.svg`. */
  file: string;
  alt_pl: string;
  caption_pl: string;
  variant: string;
  source_ids: SourceId[];
  review_status: string;
  scope_notes_pl: string;
}

export interface RuntimeOption {
  id: OptionId;
  text_pl: string;
}

/** Pytanie runtime (pola jak w bank.json). */
export interface RuntimeQuestion {
  id: QuestionId;
  /** Rewizja treści (≥ 1). Wyższa rewizja tego samego `id` zastępuje starszą w katalogu. */
  revision: number;
  family_id: FamilyId;
  /** Hex SHA-256; aplikacja przelicza go przy imporcie paczek i porównuje (DECYZJE §2). */
  fingerprint: Fingerprint;
  domain_id: DomainId;
  topic_ids: TopicId[];
  difficulty: Difficulty;
  stem_pl: string;
  /** Dokładnie 4 różne opcje o stałych identyfikatorach. */
  options: RuntimeOption[];
  correct_option_id: OptionId;
  /** Wyjaśnienie wyłącznie poprawnego wariantu. */
  correct_explanation_pl: string;
  source_ids: SourceId[];
  source_locator_pl: string;
  question_type: QuestionType;
  figure_id: FigureId | null;
  explanation_figure_id: FigureId | null;
  /** Np. `draft_pending_clinical_review` — nie promować do approved. */
  review_status: string;
  /** Obecnie zawsze `false`; zachować. */
  approved_for_question_key: boolean;
  /** Np. `seed_draft_not_rechecked`, `independently_checked_draft`. */
  content_check_status: string;
  /** Np. `mechanism`, `clinical_application`, `evidence_appraisal`; może być `null`. */
  cognitive_level: string | null;
}

/* ========================================================================== */
/* Paczki pytań (import dodatkowej puli, DECYZJE §10)                         */
/* ========================================================================== */

/**
 * Zaimportowana paczka pytań (magazyn `packs`). Treść znormalizowana do formatu runtime,
 * z fingerprintami przeliczonymi przez aplikację. Import paczki nie usuwa historii,
 * snapshotów, blokad ani otwartej sesji.
 */
export interface PackRecord {
  id: PackId;
  importedAt: IsoDateTime;
  /** Nazwa wybranego pliku (do komunikatów). */
  fileName: string;
  /** `bank_version` z pliku paczki. */
  bankVersion: BankVersion;
  /** Format wejściowy pliku: bank źródłowy 1.0 albo runtime v1. */
  sourceFormat: 'bank-1.0' | 'runtime-v1';
  questions: RuntimeQuestion[];
  sources: Record<SourceId, RuntimeSource>;
  topics: Record<TopicId, RuntimeTopic>;
  figures: Record<FigureId, RuntimeFigure>;
  summary: PackImportSummary;
}

export interface PackImportSummary {
  /** Nowe `id`. */
  added: number;
  /** Wyższa rewizja istniejącego `id`. */
  updated: number;
  /** Ta sama treść pod istniejącym `id` — pominięte. */
  skippedSame: number;
  /** Treść/rodzina wcześniej wykluczona (blokada) — pominięte. */
  skippedBlocked: number;
  /** Pozycje odrzucone (np. inna treść bez wyższej rewizji). */
  rejected: number;
}

/** Niezgodność wykryta przy walidacji paczki (S22i). */
export interface PackIssue {
  questionId: QuestionId | null;
  /** Kod techniczny, np. `OPTIONS_NOT_4`, `KEY_NOT_IN_OPTIONS`, `SOURCE_NOT_IN_REGISTRY`. */
  code: string;
  /** Komunikat PL, np. „INJ-Q077: 3 warianty odpowiedzi zamiast 4”. */
  messagePl: string;
}

/**
 * Wynik walidacji paczki przed zapisem. Jeśli `fatal` nie jest puste — cały plik odrzucony
 * („Bieżąca pula pozostała bez zmian”). `rejected` — pojedyncze pozycje pominięte przy imporcie.
 */
export interface PackImportPlan {
  record: PackRecord;
  addedIds: QuestionId[];
  updatedIds: QuestionId[];
  skippedSameIds: QuestionId[];
  skippedBlockedIds: QuestionId[];
  rejected: PackIssue[];
  fatal: PackIssue[];
}

/* ========================================================================== */
/* Katalog (bank + zaimportowane paczki)                                      */
/* ========================================================================== */

/** Skąd pochodzi pytanie w katalogu. */
export type QuestionOrigin =
  | { kind: 'bank'; bankVersion: BankVersion }
  | { kind: 'pack'; packId: PackId; bankVersion: BankVersion };

export interface CatalogOption {
  id: OptionId;
  text: string;
}

/** Pytanie w katalogu (najnowsza rewizja danego `id`, po walidacji). */
export interface CatalogQuestion {
  id: QuestionId;
  revision: number;
  familyId: FamilyId;
  fingerprint: Fingerprint;
  domainId: DomainId;
  topicIds: TopicId[];
  difficulty: Difficulty;
  stem: string;
  /** Kolejność kanoniczna z banku (pokazana kolejność jest w slocie). */
  options: CatalogOption[];
  correctOptionId: OptionId;
  explanation: string;
  sourceIds: SourceId[];
  sourceLocator: string;
  questionType: QuestionType;
  figureId: FigureId | null;
  explanationFigureId: FigureId | null;
  reviewStatus: string;
  approvedForQuestionKey: boolean;
  contentCheckStatus: string;
  cognitiveLevel: string | null;
  origin: QuestionOrigin;
}

export interface CatalogDomain {
  id: DomainId;
  title: string;
  description: string;
}

export interface CatalogTopic {
  id: TopicId;
  title: string;
  domainId: DomainId;
  learningObjective: string | null;
  pearls: string[];
}

export interface CatalogSource {
  id: SourceId;
  title: string;
  /** Tylko `https:` z rejestru; inaczej `null` (bez javascript:/data:). */
  url: string | null;
  doi: string | null;
  pmid: string | null;
  kindPl: string;
  accessPl: string;
  checkedOn: IsoDate | null;
}

export interface CatalogFigure {
  id: FigureId;
  /** Ścieżka względna do `base` (np. `figures/x.svg`). */
  file: string;
  alt: string;
  caption: string;
  variant: string;
  sourceIds: SourceId[];
  reviewStatus: string;
}

/** Rekord odrzucony przy budowie katalogu (niepoprawny) — nie trafia do puli. */
export interface CatalogIssue {
  questionId: QuestionId | null;
  origin: QuestionOrigin;
  /** Kod techniczny, np. `OPTIONS_NOT_4`, `UNKNOWN_SOURCE`, `UNSAFE_URL`. */
  code: string;
  messagePl: string;
}

/**
 * Katalog pytań: bank wbudowany + zaimportowane paczki, po walidacji rekordów.
 * Nie jest zapisywany w IndexedDB — budowany przy starcie i po imporcie paczki.
 */
/**
 * Rzeczywiste liczby WBUDOWANEJ puli (policzone z pytań banku obecnych w katalogu, nie przepisane z celów)
 * i informacje o jej stanie z pliku banku — „O bazie” i ustawienia (bez fałszywych liczników).
 */
export interface CatalogBankSummary {
  questions: number;
  /** Rodziny bliskich wariantów (pojemność całego zakresu). */
  families: number;
  byDomain: Partial<Record<DomainId, number>>;
  byDifficulty: Partial<Record<Difficulty, number>>;
  /** Pytania ze schematem. */
  schematic: number;
  /** `content_check_status = independently_checked_draft` — odrębny przegląd AI, nie recenzja lekarska. */
  independentlyChecked: number;
  /** Czy `counts` zadeklarowane w pliku banku zgadzają się z policzonymi (rozbieżność → `catalog.issues`). */
  declaredCountsMatch: boolean;
  /** `pool_note_pl` z banku (pusty, gdy brak). */
  poolNotePl: string;
  /** `family_merges_note_pl` z banku (pusty, gdy brak). */
  familyMergesNotePl: string;
}

export interface Catalog {
  /** Wersja wbudowanego banku. */
  bankVersion: BankVersion;
  /** Wersje: bank + paczki (do kopii i „O bazie”). */
  bankVersions: BankVersion[];
  builtOn: IsoDate;
  statusPl: string;
  clinicalSignoff: boolean;
  domains: CatalogDomain[];
  /** Pytania w deterministycznej kolejności (bank, potem paczki wg daty importu). */
  questions: CatalogQuestion[];
  questionsById: Readonly<Record<QuestionId, CatalogQuestion>>;
  topics: Readonly<Record<TopicId, CatalogTopic>>;
  sources: Readonly<Record<SourceId, CatalogSource>>;
  figures: Readonly<Record<FigureId, CatalogFigure>>;
  issues: CatalogIssue[];
  /** Liczby i stan wbudowanej puli (dodane addytywnie — „O bazie”, ustawienia). */
  bankSummary: CatalogBankSummary;
}

/* ========================================================================== */
/* Konfiguracja sesji, przydział                                              */
/* ========================================================================== */

/**
 * Zamrożona konfiguracja sesji (DECYZJE §4). Domyślnie: cały zakres, mieszany, Test 20.
 * `targetN` tylko dla Testu (liczba całkowita 1…pojemność), dla Free Flow `null`.
 * `myErrorsPriority` — „Moje błędy”: priorytet doboru, NIE filtr pojemności.
 */
export interface SessionConfig {
  scope: Scope;
  difficulty: DifficultyChoice;
  targetN: number | null;
  myErrorsPriority: boolean;
}

/** Komórka przydziału testu: domena × poziom. */
export interface AllocationCell {
  domainId: DomainId;
  difficulty: Difficulty;
  /** Planowana kwota wg polityki. */
  target: number;
  /** Faktycznie przydzielone sloty (łącznie z obowiązkowymi). */
  actual: number;
}

/** Jawny zapis redystrybucji przy niedoborze podaży (DECYZJE §6 pkt 2–4). */
export interface Redistribution {
  kind: 'domain' | 'difficulty';
  fromDomainId: DomainId;
  fromDifficulty: Difficulty | null;
  toDomainId: DomainId;
  toDifficulty: Difficulty | null;
  count: number;
  /**
   * Przyczyna (TEST_POLICY_V2): `supply` — w koszyku zabrakło rodzin; `unseen` — w koszyku zostały
   * tylko rodziny już widziane, a gdzie indziej w zakresie były nigdy niewidziane. Brak pola = sesja V1.
   */
  reason?: 'supply' | 'unseen';
}

/**
 * Cele i faktyczny przydział sesji (TEST_POLICY_V2 / FREE_FLOW_POLICY_V2; starsze sesje — V1).
 * Dla Free Flow `cells` może być puste, a `freeFlowWeights` opisuje wagi domen.
 */
export interface Allocation {
  policy: SelectionPolicyName;
  /** Przesunięcie rotacji domen: liczba wcześniej rozpoczętych testów mod 6. */
  rotationOffset: number;
  /** Pojemność puli (liczba rodzin) w chwili startu. */
  capacityAtStart: number;
  domainTargets: Partial<Record<DomainId, number>>;
  domainActual: Partial<Record<DomainId, number>>;
  cells: AllocationCell[];
  /** Liczba pozycji obowiązkowych z rodzica (runda powtórki). */
  mandatoryRepeated: number;
  /** Liczba pozycji obowiązkowych z „Moje błędy”. */
  mandatoryMyErrors: number;
  /** Uzupełnienia nigdy niewidziane. */
  fillersUnseen: number;
  /** Uzupełnienia „z wcześniejszej nauki” (najdawniej widziane). */
  fillersSeen: number;
  redistributed: Redistribution[];
  /** Wagi domen Free Flow po adaptacji (suma = 1) albo `null` dla testu. */
  freeFlowWeights: Partial<Record<DomainId, number>> | null;
}

/** Powiązanie rundy „Uwzględnij błędy” z rodzicem (DECYZJE §4). */
export interface RetryInfo {
  /** Bezpośredni rodzic (ukończony test). */
  sourceSessionId: SessionId;
  retryChainId: RetryChainId;
  /** Numer rundy w łańcuchu: pierwszy test = 1, pierwsza powtórka = 2. */
  roundIndex: number;
  /** Liczba błędów rodzica włączonych do rundy (`repeated_wrong`). */
  repeatedCount: number;
}

/* ========================================================================== */
/* Sesja, slot, snapshot, próba                                               */
/* ========================================================================== */

export interface SnapshotOption {
  id: OptionId;
  text: string;
}

export interface SnapshotSource {
  id: SourceId;
  title: string;
  url: string | null;
  doi: string | null;
  pmid: string | null;
  kindPl: string;
  accessPl: string;
}

export interface SnapshotFigure {
  id: FigureId;
  file: string;
  alt: string;
  caption: string;
}

export interface SnapshotTopic {
  id: TopicId;
  title: string;
  learningObjective: string | null;
  pearls: string[];
}

/**
 * Snapshot pytania zamrożony w slocie (03_ARCHITEKTURA §3). Historia i przegląd czytają
 * WYŁĄCZNIE snapshot — nigdy bieżący katalog.
 */
export interface QuestionSnapshot {
  questionId: QuestionId;
  revision: number;
  bankVersion: BankVersion;
  familyId: FamilyId;
  fingerprint: Fingerprint;
  domainId: DomainId;
  domainTitle: string;
  topicIds: TopicId[];
  topics: SnapshotTopic[];
  difficulty: Difficulty;
  stem: string;
  /** Opcje w POKAZANEJ kolejności (tej samej co `Slot.optionOrder`). */
  options: SnapshotOption[];
  correctOptionId: OptionId;
  explanation: string;
  sources: SnapshotSource[];
  sourceLocator: string;
  /** Wersja pytania (bez ujawniania klucza). */
  figure: SnapshotFigure | null;
  /** Wersja objaśnienia (pokazywana dopiero po odpowiedzi). */
  explanationFigure: SnapshotFigure | null;
  reviewStatus: string;
  approvedForQuestionKey: boolean;
}

/** Pierwsza ważna odpowiedź w slocie (jedna na slot). */
export interface SlotAttempt {
  commandId: CommandId;
  optionId: OptionId;
  correct: boolean;
  answeredAt: IsoDateTime;
}

export interface SlotExclusion {
  reason: ExclusionReason;
  at: IsoDateTime;
  /** Zdarzenie `question_reported`. */
  eventId: EventId;
}

/** Slot sesji: własna tożsamość + zamrożony snapshot (DECYZJE §4). */
export interface Slot {
  id: SlotId;
  questionId: QuestionId;
  origin: SlotOrigin;
  snapshot: QuestionSnapshot;
  /** Kolejność opcji pokazana użytkowniczce (stałe `OptionId`). */
  optionOrder: OptionId[];
  attempt: SlotAttempt | null;
  excluded: SlotExclusion | null;
  /** Dla zastępstwa: slot, który zastępuje. */
  replacesSlotId: SlotId | null;
  createdAt: IsoDateTime;
  /** Pierwsze faktyczne wyświetlenie (`markShown`); rezerwacja w planie nie zużywa nowości. */
  shownAt: IsoDateTime | null;
}

/** Wynik ukończonego testu (tylko `status = 'completed'`). */
export interface SessionResult {
  correct: number;
  targetN: number;
  /** `100 * correct >= 65 * targetN` (całkowitoliczbowo). */
  passed: boolean;
  /** Procent obcięty do 0,1 (np. 64,9) — tylko do wykresu/listy; nie decyduje o zaliczeniu. */
  percent: number;
}

/** Stan specyficzny dla Free Flow. */
export interface FreeFlowState {
  /** Pokazano już jednorazowy komunikat o wyczerpaniu aktywnych błędów (DECYZJE §7). */
  myErrorsExhaustedNotified: boolean;
  /** Pula pusta przy ostatniej próbie doboru — stan `empty` (bez pętli). */
  empty: boolean;
  /** Licznik doborów (do deterministycznego seeda kolejnych slotów). */
  picks: number;
}

/**
 * Sesja (DECYZJE §4). `revision` rośnie przy KAŻDYM zapisie sesji; `mutationSeq` tylko
 * przy mutacjach punktowych (odpowiedź, zgłoszenie, cofnięcie, zakończenie, zamknięcie).
 */
export interface Session {
  id: SessionId;
  kind: SessionKind;
  status: SessionStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** Data zamknięcia (completed/unfinished/ended) albo `null`. */
  closedAt: IsoDateTime | null;
  revision: number;
  mutationSeq: number;
  config: SessionConfig;
  bankVersion: BankVersion;
  /** 32-bit seed (crypto.getRandomValues w kontrolerze). */
  seed: number;
  allocation: Allocation;
  retry: RetryInfo | null;
  /** Aktywna kolejka widoczna (sloty w kolejności pokazywania). Zastępstwo wchodzi na miejsce wykluczonego. */
  plan: SlotId[];
  /** Wszystkie sloty, także wykluczone (audyt surowego wyboru). */
  slots: Record<SlotId, Slot>;
  /** Najdalsza osiągnięta pozycja w `plan` (indeks od 0). */
  reached: number;
  /**
   * Sloty w `plan` wykluczone zgłoszeniem, dla których nie znaleziono zastępstwa
   * (stan `awaitingReplacement`: spójny, kontynuowalny, bez wyniku).
   */
  awaitingReplacement: SlotId[];
  /** Zdarzenia sesji (zgłoszenia, zastępstwa, cofnięcia…) — kopie wpisów z magazynu `events`. */
  events: DmeEvent[];
  result: SessionResult | null;
  freeFlow: FreeFlowState | null;
}

/**
 * Dziennik prób (magazyn `attempts`), także wykluczonych. Klucz = `commandId`.
 * Źródłem prawdy dla punktacji jest `Slot.attempt`; dziennik służy audytowi i kopii.
 */
export interface Attempt {
  /** = `commandId`. */
  id: CommandId;
  commandId: CommandId;
  sessionId: SessionId;
  sessionKind: SessionKind;
  slotId: SlotId;
  questionId: QuestionId;
  questionRevision: number;
  domainId: DomainId;
  difficulty: Difficulty;
  optionId: OptionId;
  optionOrder: OptionId[];
  correct: boolean;
  answeredAt: IsoDateTime;
  excluded: boolean;
  excludedReason: ExclusionReason | null;
  excludedAt: IsoDateTime | null;
  /**
   * (Dodane addytywnie przez agenta silnika.) `CommandContext.nextDayStart` z chwili odpowiedzi.
   * Pozwala dokładnie odtworzyć stan REVIEW_POLICY_V1 z dziennika ważnych prób po wykluczeniu
   * próby zgłoszeniem (DECYZJE §8–§9). Silnik zawsze je ustawia; brak (starsze rekordy) = `answeredAt`.
   */
  nextDayStart?: IsoDateTime;
}

/**
 * Statystyka pytania + kolejka błędów REVIEW_POLICY_V1 (DECYZJE §8). Klucz = `questionId`.
 * `dueAt` = `null`, gdy brak aktywnego błędu.
 */
export interface QuestionStat {
  questionId: QuestionId;
  familyId: FamilyId;
  domainId: DomainId;
  /** Liczba faktycznych wyświetleń (`markShown`). */
  seenCount: number;
  firstSeenAt: IsoDateTime | null;
  lastSeenAt: IsoDateTime | null;
  /** Ważne (niewykluczone) odpowiedzi. */
  answeredCount: number;
  correctCount: number;
  wrongCount: number;
  lastAnsweredAt: IsoDateTime | null;
  activeError: boolean;
  /** Seria poprawnych w późniejszych sesjach: 0 albo 1 (druga rozwiązuje błąd). */
  streak: 0 | 1;
  dueAt: IsoDateTime | null;
  lastWrongAt: IsoDateTime | null;
  lastWrongSessionId: SessionId | null;
  streakSessionId: SessionId | null;
  resolvedAt: IsoDateTime | null;
}

/**
 * Blokada pytania w przyszłych losowaniach (DECYZJE §9). Pula pomija pytania pasujące
 * do aktywnej blokady po `questionId`, `fingerprint` LUB `familyId`.
 */
export interface Block {
  id: BlockId;
  questionId: QuestionId;
  revision: number;
  fingerprint: Fingerprint;
  familyId: FamilyId;
  domainId: DomainId;
  /** Stem ze snapshotu — lista „Wykluczone pytania” działa także dla pytań usuniętych z banku. */
  stemPreview: string;
  reason: BlockReason;
  createdAt: IsoDateTime;
  sessionId: SessionId | null;
  slotId: SlotId | null;
  /** Zdarzenie `question_reported`. */
  eventId: EventId;
  /** „Przywróć” w ustawieniach — dotyczy tylko przyszłych losowań. */
  revokedAt: IsoDateTime | null;
}

/** Ustawienia (jeden rekord, `id = 'settings'`). */
export interface Settings {
  id: 'settings';
  /** Ostatnia jawnie wybrana konfiguracja testu (pierwsze uruchomienie: domyślna). */
  lastTestConfig: SessionConfig | null;
  /** Ostatnia jawnie wybrana konfiguracja Free Flow. */
  lastFreeFlowConfig: SessionConfig | null;
  /** Zamknięcie wskazówki instalacji (S01). */
  installHintDismissedAt: IsoDateTime | null;
  /** Prośba o `navigator.storage.persist()` po pierwszej zapisanej odpowiedzi (DECYZJE §10). */
  persistRequestedAt: IsoDateTime | null;
  updatedAt: IsoDateTime | null;
}

/* ========================================================================== */
/* Zdarzenia                                                                  */
/* ========================================================================== */

interface EventBase {
  id: EventId;
  at: IsoDateTime;
  /** Komenda, która wywołała zdarzenie (albo `null` dla zdarzeń systemowych). */
  commandId: CommandId | null;
}

/** Faza zgłoszenia względem odpowiedzi i sesji. */
export type ReportPhase = 'before_answer' | 'after_answer' | 'after_close' | 'outside_session';

/** Zdarzenia audytu (magazyn `events`; zdarzenia sesji także w `Session.events`). */
export type DmeEvent =
  | (EventBase & { type: 'session_started'; sessionId: SessionId; kind: SessionKind })
  | (EventBase & {
      type: 'question_reported';
      sessionId: SessionId | null;
      slotId: SlotId | null;
      questionId: QuestionId;
      revision: number;
      blockId: BlockId;
      phase: ReportPhase;
      /** Ustawione dla zgłoszenia w przeglądzie zamkniętej sesji („Wykluczone później”). */
      reportedLaterAt: IsoDateTime | null;
    })
  | (EventBase & {
      type: 'slot_replaced';
      sessionId: SessionId;
      excludedSlotId: SlotId;
      replacementSlotId: SlotId;
      questionId: QuestionId;
    })
  | (EventBase & { type: 'replacement_unavailable'; sessionId: SessionId; excludedSlotId: SlotId })
  | (EventBase & {
      type: 'report_undone';
      sessionId: SessionId;
      reportEventId: EventId;
      blockId: BlockId;
    })
  | (EventBase & {
      type: 'session_completed';
      sessionId: SessionId;
      correct: number;
      targetN: number;
      passed: boolean;
    })
  | (EventBase & { type: 'session_unfinished'; sessionId: SessionId; answeredValid: number })
  | (EventBase & { type: 'freeflow_ended'; sessionId: SessionId; answeredValid: number; correct: number })
  | (EventBase & { type: 'my_errors_exhausted'; sessionId: SessionId })
  | (EventBase & { type: 'block_revoked'; blockId: BlockId; questionId: QuestionId })
  | (EventBase & {
      type: 'pack_imported';
      packId: PackId;
      added: number;
      updated: number;
      skipped: number;
    })
  | (EventBase & { type: 'backup_restored'; exportedAt: IsoDateTime; safetyBackupId: string });

export type DmeEventType = DmeEvent['type'];

/* ========================================================================== */
/* Stan użytkownika, changeset, wynik komendy                                 */
/* ========================================================================== */

/**
 * Pełny stan użytkowniczki przekazywany jawnie do funkcji domeny
 * (ładowany z IndexedDB przez `Repository.loadUserState()`).
 */
export interface UserState {
  settings: Settings;
  sessions: Readonly<Record<SessionId, Session>>;
  /** Klucz = `commandId`. */
  attempts: Readonly<Record<CommandId, Attempt>>;
  /** Klucz = `questionId`. */
  questionStats: Readonly<Record<QuestionId, QuestionStat>>;
  blocks: Readonly<Record<BlockId, Block>>;
  events: Readonly<Record<EventId, DmeEvent>>;
}

/** Rekordy magazynów użytkownika objętych changesetem (DECYZJE §10). */
export interface UserStoreRecords {
  settings: Settings;
  sessions: Session;
  attempts: Attempt;
  questionStats: QuestionStat;
  blocks: Block;
  events: DmeEvent;
}
export type UserStoreName = keyof UserStoreRecords;
export const USER_STORE_NAMES = ['settings', 'sessions', 'attempts', 'questionStats', 'blocks', 'events'] as const satisfies readonly UserStoreName[];

/** Zmiany jednego magazynu: rekordy do zapisania i klucze główne do usunięcia. */
export interface StoreChange<T> {
  put: T[];
  /** Klucze główne (patrz `STORE_KEY_PATHS` w persistence/api.ts). */
  delete: string[];
}

/**
 * Warunek optymistyczny sprawdzany w TEJ SAMEJ transakcji zapisu: zapisana sesja musi mieć
 * `revision === expectedRevision` (stan, z którego wyszła domena). Inaczej commit = `Conflict`.
 * Dla nowej sesji `expectedRevision = null` (rekord nie może istnieć).
 */
export interface SessionRevisionGuard {
  sessionId: SessionId;
  expectedRevision: number | null;
}

/**
 * Lista zmian wynikająca z komendy domeny — zapisywana przez persistence w JEDNEJ
 * transakcji readwrite (DECYZJE §1). Pusty changeset = brak zapisu.
 */
export interface Changeset {
  commandId: CommandId | null;
  guards: SessionRevisionGuard[];
  stores: { [S in UserStoreName]?: StoreChange<UserStoreRecords[S]> };
}

/** Kody błędów domeny (komunikat PL w `DomainError.messagePl`). */
export type DomainErrorCode =
  | 'NOT_IMPLEMENTED'
  | 'INVALID_CONFIG'
  | 'INVALID_N'
  | 'N_EXCEEDS_CAPACITY'
  | 'EMPTY_POOL'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_NOT_OPEN'
  | 'SESSION_KIND_MISMATCH'
  | 'OPEN_SESSION_EXISTS'
  | 'STALE_REVISION'
  | 'SLOT_NOT_FOUND'
  | 'SLOT_NOT_IN_PLAN'
  | 'SLOT_ALREADY_ANSWERED'
  | 'SLOT_EXCLUDED'
  /** (Dodane addytywnie przez agenta silnika.) „Dalej” przed oceną bieżącej pozycji. */
  | 'SLOT_NOT_ANSWERED'
  | 'OPTION_NOT_FOUND'
  | 'TEST_NOT_COMPLETE'
  | 'AWAITING_REPLACEMENT'
  | 'NOT_RETRYABLE'
  | 'INSUFFICIENT_CAPACITY'
  | 'ALREADY_REPORTED'
  | 'UNDO_EXPIRED'
  | 'BLOCK_NOT_FOUND'
  | 'BLOCK_ALREADY_REVOKED'
  | 'QUESTION_NOT_FOUND'
  | 'INVALID_BANK'
  | 'INVALID_PACK';

export interface DomainError {
  code: DomainErrorCode;
  /** Komunikat po polsku, gotowy do pokazania (zwięzły, bez żargonu). */
  messagePl: string;
  /** Szczegóły techniczne (np. pojemność przy `N_EXCEEDS_CAPACITY`). */
  details?: Readonly<Record<string, string | number | boolean | null>>;
}

/** Wynik komendy: sukces z wartością albo błąd z kodem i komunikatem PL. */
export type CommandResult<T, E = DomainError> = { ok: true; value: T } | { ok: false; error: E };

/** Wynik udanej komendy domeny: nowy stan + zmiany do zapisania + zdarzenia + wartość. */
export interface DomainOutcome<V> {
  state: UserState;
  changeset: Changeset;
  events: DmeEvent[];
  value: V;
}

/* ========================================================================== */
/* Kontekst komendy, cofnięcie                                                */
/* ========================================================================== */

/** Rodzaj generowanego identyfikatora (dla czytelnych identyfikatorów w testach). */
export type IdKind = 'session' | 'slot' | 'event' | 'block' | 'chain';

/**
 * Kontekst komendy dostarczany przez kontroler (DECYZJE §3): czas, identyfikator komendy
 * i generator identyfikatorów. Domena nie czyta zegara ani `crypto` sama.
 */
export interface CommandContext {
  /** Bieżący czas (ISO, UTC). */
  now: IsoDateTime;
  /**
   * Początek następnego dnia kalendarzowego w strefie Europe/Warsaw względem `now`, jako ISO UTC
   * (np. `2026-10-22T22:00:00.000Z` dla 23.10.2026 00:00 CEST). Używany przez REVIEW_POLICY_V1.
   */
  nextDayStart: IsoDateTime;
  commandId: CommandId;
  /** Nowy unikalny identyfikator (w aplikacji `crypto.randomUUID()`, w testach licznik). */
  newId: (kind: IdKind) => string;
}

/**
 * Punkt przywrócenia dla „Cofnij zgłoszenie” (DECYZJE §9): stan sprzed zgłoszenia.
 * Trzymany w pamięci kontrolera (toast), nie w IndexedDB.
 */
export interface ReportCheckpoint {
  /** Sesja sprzed zgłoszenia (cofnięcie zapisuje ją z NOWĄ `revision`). */
  session: Session;
  /** Statystyki pytań sprzed zgłoszenia (`null` = rekordu nie było). */
  questionStats: Readonly<Record<QuestionId, QuestionStat | null>>;
  /** Wpisy dziennika prób sprzed zgłoszenia (stan wykluczenia). */
  attempts: Readonly<Record<CommandId, Attempt>>;
}

/** Token „Cofnij” — ważny tylko, gdy `session.mutationSeq` nie zmieniło się od zgłoszenia. */
export interface UndoToken {
  sessionId: SessionId;
  /** `mutationSeq` sesji PO zgłoszeniu. */
  mutationSeq: number;
  reportEventId: EventId;
  blockId: BlockId;
  checkpoint: ReportCheckpoint;
}

/* ========================================================================== */
/* Odczyty pochodne (selektory)                                               */
/* ========================================================================== */

/** Pula dopuszczalna dla zakresu i trudności (DECYZJE §5). */
export interface PoolInfo {
  scope: Scope;
  difficulty: DifficultyChoice;
  /** Pytania po filtrach: zakres, trudność, aktywne blokady, poprawność rekordu. */
  questionIds: QuestionId[];
  /** Pojemność = liczba różnych `familyId` w puli. */
  capacity: number;
  /** Liczba rodzin, których żadne pytanie nie było jeszcze wyświetlone. */
  unseenFamilies: number;
  /** Aktywne błędy w tej puli (priorytet „Moje błędy”, nie ogranicza pojemności). */
  activeErrors: number;
}

/** Wynik walidacji liczby pytań wpisanej w konfiguracji testu (S05). */
export type NValidation =
  | { ok: true; n: number }
  | {
      ok: false;
      /**
       * `EMPTY` — puste pole; `NOT_INTEGER` — ułamek/tekst/NaN; `TOO_SMALL` — 0 lub ujemne;
       * `EXCEEDS_CAPACITY` — więcej niż rodzin w puli; `EMPTY_POOL` — pula pusta.
       */
      code: 'EMPTY' | 'NOT_INTEGER' | 'TOO_SMALL' | 'EXCEEDS_CAPACITY' | 'EMPTY_POOL';
      capacity: number;
    };

/** Postęp sesji (Test: ważne ocenione / N; Free Flow: numer pytania). */
export interface SessionProgress {
  kind: SessionKind;
  /** Ważne (niewykluczone) ocenione sloty. */
  answeredValid: number;
  /** Poprawne ważne odpowiedzi — NIE pokazywać przed końcem testu. */
  correctValid: number;
  targetN: number | null;
  /** Numer pytania do nagłówka Free Flow („Pytanie k”) = pozycja `reached` + 1. */
  questionNumber: number;
  awaitingReplacement: boolean;
  /** Test: `answeredValid === targetN` i brak oczekujących zastępstw. */
  readyToFinish: boolean;
}

/** Podsumowanie sesji do wyniku, historii i podsumowania Free Flow. */
export interface SessionSummary {
  sessionId: SessionId;
  kind: SessionKind;
  status: SessionStatus;
  config: SessionConfig;
  answeredValid: number;
  correct: number;
  targetN: number | null;
  /** Procent obcięty do 0,1; `null` przy 0 ocenionych („Brak ocenionych pytań”). */
  percent: number | null;
  /** Tylko `completed`; Free Flow i unfinished: `null`. */
  passed: boolean | null;
  retry: RetryInfo | null;
  createdAt: IsoDateTime;
  closedAt: IsoDateTime | null;
}

/** Podgląd rundy „Uwzględnij błędy” / „Nowa runda” (S18). */
export interface RetryPreview {
  sourceSessionId: SessionId;
  targetN: number;
  config: SessionConfig;
  /** Błędne, niezgłoszone i obecnie niezablokowane pozycje rodzica. */
  repeatedWrong: number;
  fillersUnseen: number;
  /** Uzupełnienia „z wcześniejszej nauki” (najdawniej widziane). */
  fillersSeen: number;
  /** Numer kolejnej rundy w łańcuchu. */
  nextRoundIndex: number;
  /** Czy runda będzie oznaczona jako Powtórka (`repeatedWrong > 0`). */
  isRetry: boolean;
  /** Za mało rodzin, by uzupełnić do N — start zablokowany. */
  insufficient: { capacity: number } | null;
}

/** Pozycja przeglądu odpowiedzi (S17). */
export interface ReviewItem {
  slotId: SlotId;
  /** Numer pozycji w planie (od 1). */
  number: number;
  status: 'correct' | 'wrong' | 'excluded' | 'unanswered';
  /** Zgłoszone w przeglądzie po zamknięciu („Wykluczone później”). */
  reportedLater: boolean;
  domainId: DomainId;
  stem: string;
}

/** Filtr historii testów (S20): wszystkie albo jedna konfiguracja. */
export type HistoryFilter = { kind: 'all' } | { kind: 'config'; key: string };

/** Punkt wykresu wyników — tylko ukończone testy (F05). */
export interface ChartPoint {
  sessionId: SessionId;
  at: IsoDateTime;
  /** Obcięty do 0,1. */
  percent: number;
  passed: boolean;
  /** Powtórka (◆) vs niezależny test (●). */
  isRetry: boolean;
  roundIndex: number | null;
  myErrorsPriority: boolean;
  configKey: string;
}

/** Historia (S20): testy i Free Flow rozdzielone, najnowsze pierwsze. */
export interface HistorySummary {
  tests: SessionSummary[];
  freeFlow: SessionSummary[];
  /** Dostępne konfiguracje do filtra „Porównuj podobne testy”. */
  configs: { key: string; config: SessionConfig; count: number }[];
}
