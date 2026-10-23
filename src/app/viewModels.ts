/**
 * MODELE WIDOKU — kontrakt między kontrolerem a UI (ekrany S01–S24 z Claude Design).
 *
 * UI renderuje wyłącznie te dane (plus własny stan lokalny: otwarte arkusze, powiększenie schematu,
 * rozwinięcia). Logika punktacji, doboru i powtórek jest w domenie; kontroler buduje VM z wyników domeny.
 * Teksty interfejsu (po polsku, z Design) należą do UI — VM niesie dane i klucze, nie gotowe zdania,
 * poza tekstami z banku (pytania, wyjaśnienia, źródła) i komunikatami błędów `messagePl`.
 *
 * Ochrona przed podpowiedzią (B04): przed odpowiedzią `QuestionVM` NIE zawiera klucza, wyjaśnienia,
 * źródeł ani figury objaśnienia — nie ma czego przypadkiem wyrenderować.
 */
import type {
  BlockId,
  ChartPoint,
  Difficulty,
  DifficultyChoice,
  DomainId,
  FigureId,
  HistoryFilter,
  IsoDate,
  IsoDateTime,
  NValidation,
  OptionId,
  PackIssue,
  QuestionId,
  RetryInfo,
  Scope,
  SessionId,
  SessionKind,
  SessionStatus,
  SlotId,
  SourceId,
} from '../domain/types';
import type { BackupSummary, PersistenceErrorCode } from '../persistence/api';
import type { HistoryTab, ResultOrigin, ReviewFilter } from './routes';

/* ========================================================================== */
/* Wspólne                                                                    */
/* ========================================================================== */

/** Litera pozycyjna karty odpowiedzi (A–D wg pokazanej kolejności, nie `OptionId`). */
export type AnswerLetter = 'A' | 'B' | 'C' | 'D';

/**
 * Stan karty odpowiedzi (PRZEKAZANIE §6, AnswerCard). `pressed` to `:active` w CSS.
 * - `neutral` — przed odpowiedzią,
 * - `pending` — wybrana, zapis w toku albo nieudany (niezapisana — patrz `SaveStatus`),
 * - `selected-correct` / `selected-wrong` — wybrana po ocenie,
 * - `correct-unselected` — poprawna, gdy wybrano błędną,
 * - `rest-after-eval` — pozostałe po ocenie.
 * W podglądzie (`mode !== 'live'`) te same stany; podpisy „Twoja odpowiedź — poprawna/błędna”.
 */
export type AnswerCardState =
  | 'neutral'
  | 'pending'
  | 'selected-correct'
  | 'selected-wrong'
  | 'correct-unselected'
  | 'rest-after-eval';

export interface AnswerCardVM {
  optionId: OptionId;
  letter: AnswerLetter;
  text: string;
  state: AnswerCardState;
  /** Karta jest przyciskiem tylko przed odpowiedzią w trybie `live`. */
  interactive: boolean;
}

/** Figura do wyświetlenia (`src` względny do `base`, np. `figures/x.svg`). */
export interface FigureVM {
  figureId: FigureId;
  src: string;
  alt: string;
  caption: string;
}

/** Wiersz źródła (SourceRow). `url` tylko https z rejestru albo `null`. */
export interface SourceVM {
  id: SourceId;
  title: string;
  kindPl: string;
  accessPl: string;
  url: string | null;
  doi: string | null;
  pmid: string | null;
}

/** „Rozwiń szerszy kontekst” — temat pytania (cel, perełki). */
export interface ContextVM {
  topicTitle: string;
  learningObjective: string | null;
  pearls: string[];
}

/** Panel wyjaśnienia — tylko po odpowiedzi (ExplanationPanel). */
export interface ExplanationVM {
  text: string;
  figure: FigureVM | null;
  context: ContextVM | null;
  sources: SourceVM[];
  /** „Gdzie w źródle” (lokator z banku). */
  sourceLocator: string;
}

/** Konfiguracja do etykiet („Cały zakres · Mieszany”, „20 pytań”, „Moje błędy”). */
export interface ConfigLabelVM {
  scope: Scope;
  scopeTitle: string;
  difficulty: DifficultyChoice;
  targetN: number | null;
  myErrorsPriority: boolean;
}

/* ========================================================================== */
/* S01–S02 Start                                                              */
/* ========================================================================== */

/** Karta „Kontynuuj” przerwanej sesji. */
export interface ResumeVM {
  sessionId: SessionId;
  kind: SessionKind;
  answeredValid: number;
  targetN: number | null;
  /** Free Flow: numer bieżącego pytania. */
  questionNumber: number;
  config: ConfigLabelVM;
  /** Runda powtórki („Kontynuuj test · Powtórka”). */
  retryRoundIndex: number | null;
  awaitingReplacement: boolean;
  /** Liczba pozycji czekających na zastępstwo (0, gdy brak). */
  awaitingCount: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface HomeVM {
  name: 'home';
  /** Wskazówka „Dodaj do ekranu początkowego” (pierwsze otwarcie w Safari, do zamknięcia). */
  showInstallHint: boolean;
  resume: ResumeVM | null;
}

/* ========================================================================== */
/* S03–S05 Konfiguracja                                                       */
/* ========================================================================== */

/** Szkic konfiguracji (pole liczby jako tekst — walidacja S05). */
export interface ConfigDraft {
  scope: Scope;
  difficulty: DifficultyChoice;
  /** Tekst pola liczby pytań (Test). */
  nText: string;
  myErrorsPriority: boolean;
}

export interface ScopeOptionVM {
  scope: Scope;
  title: string;
  /** Pojemność (rodziny) dla tego zakresu przy bieżącej trudności. */
  capacity: number;
  /** Liczba dostępnych pytań (po blokadach) — pokazywana obok pojemności, gdy się różni (C01). */
  questionCount: number;
}

export interface QuickValueVM {
  n: number;
  enabled: boolean;
  selected: boolean;
}

export interface ConfigVM {
  name: 'config';
  mode: SessionKind;
  draft: ConfigDraft;
  scopeTitle: string;
  scopeOptions: ScopeOptionVM[];
  /** Pojemność puli (rodziny) dla zakresu i trudności — maksimum N. */
  capacity: number;
  /** Dostępne pytania w zakresie (po blokadach); ≥ `capacity` (C01: obie liczby w UI). */
  questionCount: number;
  /** Rodziny niewidziane w tym zakresie („Niewidzianych pytań w tym zakresie: …”). */
  unseenFamilies: number;
  /** Test: wynik walidacji pola N; Free Flow: `null`. */
  nValidation: NValidation | null;
  canDecrement: boolean;
  canIncrement: boolean;
  quickValues: QuickValueVM[];
  /** Aktywne błędy w zakresie (opis przełącznika „Moje błędy”; 0 → komunikat S05e). */
  activeErrorsInScope: number;
  /** Przerwana sesja trafi do historii przy starcie nowej. */
  openSession: { sessionId: SessionId; kind: SessionKind; answeredValid: number; targetN: number | null } | null;
  canStart: boolean;
  /** Start w toku (blokada podwójnego dotknięcia). */
  starting: boolean;
}

/* ========================================================================== */
/* S06–S15, S24 Pytanie                                                       */
/* ========================================================================== */

/**
 * Tryb ekranu pytania:
 * - `live` — bieżąca pozycja otwartej sesji (można odpowiadać),
 * - `preview` — wcześniejsza pozycja otwartej sesji, tylko do odczytu („Podgląd odpowiedzi”),
 * - `review` — szczegół przeglądu zamkniętej sesji, tylko do odczytu.
 */
export type QuestionMode = 'live' | 'preview' | 'review';

export type ProgressVM =
  | { kind: 'test'; answeredValid: number; targetN: number }
  | { kind: 'freeflow'; questionNumber: number };

/** Oznaczenie pochodzenia pozycji („Z poprzedniej rundy”, „Z wcześniejszej nauki”, „Moje błędy”). */
export type OriginTag = 'repeated_wrong' | 'seen_filler' | 'my_errors' | null;

/**
 * Akcja głównego przycisku dolnego paska. `go-awaiting` — ostatnia pozycja testu oceniona, ale
 * wcześniejsza pozycja czeka na zastępstwo (S24g): przycisk prowadzi do tej pozycji.
 */
export type PrimaryAction = 'hint' | 'next' | 'show-result' | 'go-awaiting' | 'none';

/** Test: inna pozycja sesji czeka na zastępstwo (S24g, kryterium E03). */
export interface AwaitingElsewhereVM {
  /** Pierwsza oczekująca pozycja planu (od 0). */
  position: number;
  /** Liczba pozycji sesji czekających na zastępstwo. */
  count: number;
}

export interface QuestionVM {
  name: 'question';
  sessionId: SessionId;
  kind: SessionKind;
  mode: QuestionMode;
  /** Pozycja pokazywana w planie (od 0) i najdalsza osiągnięta. */
  position: number;
  reached: number;
  slotId: SlotId;
  progress: ProgressVM;
  /** Runda powtórki (tag „Powtórka · runda k”) albo `null`. */
  retryRoundIndex: number | null;
  domainId: DomainId;
  domainTitle: string;
  difficulty: Difficulty;
  originTag: OriginTag;
  /** Pozycja wykluczona zgłoszeniem (podgląd/przegląd: „Wykluczone z przyszłej nauki”). */
  excluded: boolean;
  /** Przegląd zamkniętej sesji: zgłoszone później. */
  reportedLater: boolean;
  stem: string;
  /** Figura w wersji pytania (bez ujawniania klucza). */
  figure: FigureVM | null;
  answers: AnswerCardVM[];
  answered: boolean;
  /** Wynik zapisanej odpowiedzi (`null` przed oceną). */
  correct: boolean | null;
  /** Tylko po odpowiedzi. */
  explanation: ExplanationVM | null;
  /** Flaga zgłoszenia (44×44, `aria-label="Zgłoś błąd w pytaniu"`). */
  canReport: boolean;
  canGoPrevious: boolean;
  /** „Do bieżącego” w podglądzie. */
  canJumpToCurrent: boolean;
  primaryAction: PrimaryAction;
  /** Zapis odpowiedzi w toku (karta `pending`, bez „Dalej”). */
  savingAnswer: boolean;
  /** S24: pozycja czeka na zastępstwo (brak dostępnych pytań). */
  awaitingReplacement: boolean;
  /**
   * S24g na poziomie sesji: inna pozycja otwartego testu czeka na zastępstwo (np. zgłoszono
   * wcześniejsze pytanie). `null` — brak albo to właśnie wyświetlana pozycja.
   */
  awaitingElsewhere: AwaitingElsewhereVM | null;
  /** S24: Free Flow — pula pusta. */
  freeFlowEmpty: boolean;
  /** Free Flow: jednorazowa informacja o wyczerpaniu „Moich błędów”. */
  myErrorsExhaustedNotice: boolean;
  /**
   * (Addytywne, opcjonalne — UI) Szczegół przeglądu (`mode === 'review'`): nawigacja „‹” / „Następne”
   * po pozycjach przeglądu z bieżącym filtrem. Brak → tylko „Wróć do listy”.
   */
  reviewNav?: ReviewNavVM | null;
}

/** Nawigacja w szczególe przeglądu (S17d) — kolejność i filtr jak na liście przeglądu. */
export interface ReviewNavVM {
  filter: ReviewFilter;
  /** Pozycja w przefiltrowanej liście (od 0) i jej długość. */
  index: number;
  total: number;
  prevSlotId: SlotId | null;
  nextSlotId: SlotId | null;
  /** Data sesji do paska „Test z … · tylko do odczytu”. */
  sessionDate: IsoDateTime;
}

/* ========================================================================== */
/* S16–S18 Wynik, przegląd, nowa runda                                        */
/* ========================================================================== */

export interface CompositionVM {
  repeatedWrong: number;
  myErrors: number;
  fillersUnseen: number;
  fillersSeen: number;
}

/** Arkusz „Nowa runda” (S18). */
export interface RetryPreviewVM {
  targetN: number;
  config: ConfigLabelVM;
  repeatedWrong: number;
  fillersUnseen: number;
  fillersSeen: number;
  nextRoundIndex: number;
  /** `repeatedWrong > 0` → „Powtórka”; 0 → zwykła „Nowa runda”. */
  isRetry: boolean;
  /** Za mało rodzin do N — start zablokowany, z podaną pojemnością. */
  insufficientCapacity: number | null;
}

export interface ResultVM {
  name: 'result';
  sessionId: SessionId;
  origin: ResultOrigin;
  status: 'passed' | 'failed' | 'unfinished';
  correct: number;
  targetN: number;
  answeredValid: number;
  /** Np. „65%”, „64,9%”; `null` przy 0 ocenionych. Tylko prezentacja. */
  percentText: string | null;
  /** Minimalna liczba poprawnych (`passThreshold`). */
  thresholdCorrect: number;
  config: ConfigLabelVM;
  retry: RetryInfo | null;
  composition: CompositionVM | null;
  wrongCount: number;
  createdAt: IsoDateTime;
  closedAt: IsoDateTime | null;
  /** „Uwzględnij błędy” / „Nowa runda” dostępne dla ukończonego testu. */
  canStartRetry: boolean;
  retryPreview: RetryPreviewVM | null;
}

export interface ReviewItemVM {
  slotId: SlotId;
  number: number;
  status: 'correct' | 'wrong' | 'excluded' | 'unanswered';
  reportedLater: boolean;
  domainId: DomainId;
  domainTitle: string;
  stem: string;
}

export interface ReviewVM {
  name: 'review';
  sessionId: SessionId;
  sessionStatus: SessionStatus;
  kind: SessionKind;
  filter: ReviewFilter;
  counts: { all: number; wrong: number };
  items: ReviewItemVM[];
  canStartRetry: boolean;
  retryPreview: RetryPreviewVM | null;
  /** (Addytywne, opcjonalne — UI) Podtytuł „Test z 22.10.2026 · Cały zakres · Mieszany”. */
  config?: ConfigLabelVM;
  createdAt?: IsoDateTime;
}

/* ========================================================================== */
/* S19 Podsumowanie Free Flow                                                 */
/* ========================================================================== */

export interface FreeFlowSummaryVM {
  name: 'freeflowSummary';
  sessionId: SessionId;
  origin: ResultOrigin;
  answeredValid: number;
  correct: number;
  /** `null` przy 0 ocenionych („Nie udzielono jeszcze odpowiedzi”). */
  percentText: string | null;
  config: ConfigLabelVM;
  createdAt: IsoDateTime;
  closedAt: IsoDateTime | null;
}

/* ========================================================================== */
/* S20 Historia                                                               */
/* ========================================================================== */

export interface HistoryTestItemVM {
  sessionId: SessionId;
  status: 'completed' | 'unfinished';
  correct: number;
  targetN: number;
  answeredValid: number;
  percentText: string | null;
  passed: boolean | null;
  config: ConfigLabelVM;
  isRetry: boolean;
  roundIndex: number | null;
  createdAt: IsoDateTime;
  closedAt: IsoDateTime | null;
}

export interface HistoryFreeFlowItemVM {
  sessionId: SessionId;
  answeredValid: number;
  correct: number;
  percentText: string | null;
  config: ConfigLabelVM;
  createdAt: IsoDateTime;
  closedAt: IsoDateTime | null;
}

export interface HistoryConfigOptionVM {
  key: string;
  config: ConfigLabelVM;
  count: number;
}

export interface HistoryVM {
  name: 'history';
  tab: HistoryTab;
  filter: HistoryFilter;
  configOptions: HistoryConfigOptionVM[];
  /** Tylko ukończone testy (z filtrem). Pusta lista → brak wykresu (bez udawanego 0%). */
  chart: ChartPoint[];
  selectedPoint: ChartPoint | null;
  tests: HistoryTestItemVM[];
  freeFlow: HistoryFreeFlowItemVM[];
}

/* ========================================================================== */
/* S21–S23 Ustawienia                                                         */
/* ========================================================================== */

/**
 * Stan bazy pytań (S21a/S21b). Liczby WBUDOWANEJ puli są policzone z katalogu (`Catalog.bankSummary`,
 * zgodne z `bank.counts`), nie przepisane z celów; zaimportowane pule osobno (`catalog*`).
 */
export interface BankInfoVM {
  bankVersion: string;
  builtOn: IsoDate;
  /** Wbudowana pula: liczba pytań. */
  questionCount: number;
  /** Wbudowana pula: liczba rodzin (różnych zadań). */
  familyCount: number;
  /** Rozkład poziomów wbudowanej puli (basic, intermediate, advanced). */
  byDifficulty: { difficulty: Difficulty; count: number }[];
  /** Pytania po odrębnym przeglądzie AI (`independently_checked_draft`) — NIE recenzja lekarska. */
  independentlyCheckedCount: number;
  /** Pytania ze schematem. */
  schematicCount: number;
  /** `pool_note_pl` z banku (np. cel 2000–3000 nieosiągnięty); pusty, gdy brak. */
  poolNotePl: string;
  /** Cały katalog (wbudowana + zaimportowane pule). */
  catalogQuestionCount: number;
  catalogFamilyCount: number;
  statusPl: string;
  clinicalSignoff: boolean;
}

export interface SettingsVM {
  name: 'settings';
  activeBlocksCount: number;
  bank: BankInfoVM;
  appVersion: string;
}

export interface AboutVM {
  name: 'about';
  bank: BankInfoVM;
  byDomain: { domainId: DomainId; title: string; count: number }[];
  packs: { packId: string; fileName: string; importedAt: IsoDateTime; questionCount: number }[];
  appVersion: string;
}

export interface BackupErrorVM {
  code: PersistenceErrorCode;
  messagePl: string;
  reasonsPl: string[];
  /** Dla `UnsupportedBackupVersion`. */
  foundVersion: number | null;
}

/** Przepływ kopii danych (S22a–S22h, S24e). */
export type BackupFlowVM =
  | { step: 'idle'; lastSavedFileName: string | null }
  | { step: 'saving' }
  | { step: 'checking'; fileName: string }
  | { step: 'confirm'; fileName: string; summary: BackupSummary }
  | { step: 'replacing'; fileName: string }
  | { step: 'done'; summary: BackupSummary; safetyBackupId: string; safetyFileName: string }
  | { step: 'error'; fileName: string | null; error: BackupErrorVM };

/** Automatyczna kopia bezpieczeństwa sprzed „Wczytaj kopię” (magazyn `backups`, DECYZJE §10, F03). */
export interface SafetyBackupVM {
  id: string;
  createdAt: IsoDateTime;
  fileName: string;
  sizeBytes: number;
}

export interface BackupVM {
  name: 'backup';
  flow: BackupFlowVM;
  /** Automatyczne kopie bezpieczeństwa, najnowsze pierwsze; `null` — lista jeszcze nie wczytana. */
  safetyBackups: SafetyBackupVM[] | null;
}

/** Przepływ importu puli (S22h–S22i). */
export type PoolImportFlowVM =
  | { step: 'idle' }
  | { step: 'checking'; fileName: string }
  | {
      step: 'done';
      fileName: string;
      added: number;
      updated: number;
      skippedSame: number;
      skippedBlocked: number;
      rejected: PackIssue[];
      activeBlocks: number;
    }
  | { step: 'error'; fileName: string; issues: PackIssue[]; messagePl: string | null };

export interface PoolImportVM {
  name: 'poolImport';
  flow: PoolImportFlowVM;
}

export interface ExcludedItemVM {
  blockId: BlockId;
  questionId: QuestionId;
  stem: string;
  domainId: DomainId;
  domainTitle: string;
  createdAt: IsoDateTime;
}

export interface ExcludedVM {
  name: 'excluded';
  items: ExcludedItemVM[];
  /** Otwarta sesja testu (inny komunikat po „Przywróć”). */
  hasOpenTest: boolean;
}

/* ========================================================================== */
/* Unia ekranów                                                               */
/* ========================================================================== */

export type ScreenVM =
  | HomeVM
  | ConfigVM
  | QuestionVM
  | ResultVM
  | ReviewVM
  | FreeFlowSummaryVM
  | HistoryVM
  | SettingsVM
  | AboutVM
  | BackupVM
  | PoolImportVM
  | ExcludedVM;

export type ScreenName = ScreenVM['name'];

/* ========================================================================== */
/* Stan globalny: zapis, toast, aktualizacja, przygotowanie                   */
/* ========================================================================== */

/** Komendy, których zapis może się nie udać (do komunikatu i ponowienia). */
export type SaveAction =
  | 'answer'
  | 'advance'
  | 'next-freeflow'
  | 'mark-shown'
  | 'report'
  | 'undo-report'
  | 'finish'
  | 'close-unfinished'
  | 'end-freeflow'
  | 'start-session'
  | 'restore-block'
  | 'fill-replacement'
  | 'settings';

/**
 * Stan zapisu (DECYZJE §1): `error` = niezapisane; „Spróbuj zapisać ponownie” powtarza TĘ SAMĄ komendę
 * (ten sam `commandId`). Nigdy fałszywy sukces.
 */
export type SaveStatus =
  | { status: 'idle' }
  | { status: 'saving'; commandId: string; action: SaveAction }
  | {
      status: 'error';
      commandId: string;
      action: SaveAction;
      code: PersistenceErrorCode | 'DomainError';
      messagePl: string;
      /** Liczba nieudanych prób (≥ 2 → „Zapis nadal się nie powiódł…”). */
      failures: number;
    };

/**
 * Rodzaj toastu (StatusToast). Tekst mapuje UI (Design):
 * - `reported_replaced` — „Pytanie wykluczone. Zastąpiliśmy je innym.” + Cofnij,
 * - `reported_awaiting` — wykluczone, brak zastępstwa + Cofnij,
 * - `reported_closed` — „Pytanie wykluczone z przyszłej nauki. Wynik tego testu się nie zmienia.”,
 * - `report_undone` — „Zgłoszenie cofnięte. Przywrócono poprzedni stan pytania.”,
 * - `block_restored` / `block_restored_open_test` — „Pytanie przywrócone do przyszłych losowań…”,
 * - `test_closed_unfinished` — „Test zamknięty bez wyniku…”,
 * - `freeflow_saved` — „Sesja Free Flow zapisana w historii.”,
 * - `app_updated` — „Aplikacja zaktualizowana. Przerwana sesja została zachowana.”,
 * - `backup_saved` — zapisano plik kopii (`params.fileName`),
 * - (addytywnie, integracja) `reported_excluded` — Free Flow: wykluczono wcześniejszą pozycję bez zastępstwa + Cofnij,
 * - (addytywnie, integracja) `action_failed` — akcja odrzucona bez zapisu (`params.messagePl` z domeny/trwałości/PWA).
 */
export type ToastKind =
  | 'reported_replaced'
  | 'reported_awaiting'
  | 'reported_excluded'
  | 'action_failed'
  | 'reported_closed'
  | 'report_undone'
  | 'block_restored'
  | 'block_restored_open_test'
  | 'test_closed_unfinished'
  | 'freeflow_saved'
  | 'app_updated'
  | 'backup_saved';

export interface ToastVM {
  id: string;
  kind: ToastKind;
  /** „Cofnij” — do następnej mutacji sesji, bez limitu czasu. */
  canUndo: boolean;
  /** Toast bez akcji znika po 4,5 s; z „Cofnij” — `null` (bez limitu). */
  autoHideMs: number | null;
  params: Readonly<Record<string, string | number>>;
  /**
   * Błąd odrzuconej akcji pokazany OBOK toastu z ważnym „Cofnij” (`role="alert"`), zamiast go zastąpić
   * (LOG-05). Brak — zwykły toast.
   */
  alertPl?: string;
}

export interface UpdateState {
  /** Nowa wersja gotowa (SW w `waiting`). */
  available: boolean;
  /** Baner tylko poza ekranem pytania i gdy nic nie czeka na zapis. */
  canApplyNow: boolean;
  applying: boolean;
}

/** Pierwsze przygotowanie materiałów offline (S24a/S24a2). */
export type PreparationState =
  | { status: 'running'; done: number; total: number }
  | { status: 'failed'; done: number; total: number };

export interface StorageStatusVM {
  /** `navigator.storage.persisted()`; `null` = nieznane/niedostępne. */
  persisted: boolean | null;
  usageBytes: number | null;
  quotaBytes: number | null;
}

/** Faza uruchomienia aplikacji. */
export type BootState =
  | { phase: 'loading'; stage: 'opening-storage' | 'loading-bank' | 'loading-user-data' }
  | { phase: 'ready' }
  | {
      phase: 'fatal';
      code: 'STORAGE_UNAVAILABLE' | 'BANK_UNAVAILABLE' | 'BANK_INVALID' | 'MIGRATION_FAILED' | 'UNKNOWN';
      messagePl: string;
      canRetry: boolean;
    };
