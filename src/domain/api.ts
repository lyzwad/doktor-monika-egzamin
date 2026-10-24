/**
 * API SILNIKA DOMENY — sygnatury czystych funkcji (kontrakt dla kontrolera, testów i UI).
 *
 * Zasady (DECYZJE §1, §3):
 * - Każda komenda dostaje JAWNY stan (`UserState`), katalog, `CommandContext` (czas, commandId,
 *   generator identyfikatorów) i — gdy losuje — seed. Nie czyta zegara, `crypto` ani `Math.random()`.
 * - Komenda zwraca `CommandResult<DomainOutcome<V>>`: nowy stan + changeset (jedna transakcja zapisu)
 *   + zdarzenia + wartość; albo błąd z kodem i komunikatem PL. Stan wejściowy pozostaje niezmieniony.
 * - Kontroler publikuje nowy stan jako trwały dopiero po udanym `Repository.commit(changeset)`.
 * - Odczyty pochodne (selektory) są czystymi funkcjami bez changesetu.
 *
 * Implementacje są w modułach (catalog, pool, sessions, report, selectors, settings, testPolicy,
 * freeFlowPolicy, review); ten plik zachowuje kontraktowe sygnatury i deleguje do nich.
 */
import * as catalogImpl from './catalog';
import * as poolImpl from './pool';
import * as reportImpl from './report';
import * as selectorsImpl from './selectors';
import * as sessionsImpl from './sessions';
import * as settingsImpl from './settings';
import type {
  Block,
  Catalog,
  CatalogQuestion,
  ChartPoint,
  CommandContext,
  CommandResult,
  DifficultyChoice,
  DomainOutcome,
  HistoryFilter,
  HistorySummary,
  IsoDateTime,
  NValidation,
  OptionId,
  PoolInfo,
  QuestionId,
  ReportPhase,
  RetryPreview,
  ReviewItem,
  RuntimeBank,
  Scope,
  Session,
  SessionConfig,
  SessionId,
  SessionProgress,
  SessionResult,
  SessionSummary,
  Settings,
  SlotId,
  BlockId,
  EventId,
  UndoToken,
  UserState,
} from './types';

export * from './types';
export { mulberry32, shuffle, randomInt, hashString32, deriveSeed, rngFor, toUint32, type Rng } from './rng';
export {
  normalizeText,
  caseFold,
  compareCodePoints,
  fingerprintPayload,
  sha256Hex,
  fingerprintQuestion,
  fingerprintRuntimeQuestion,
} from './fingerprint';
export { passThreshold, isPassed, percentTenths, truncatedPercent, formatPercentPl, pluralPl } from './scoring';
export * from './policies';
export { defaultSettings, emptyUserState, emptyChangeset, isChangesetEmpty, domainError, NotImplementedError } from './state';
/** (Dodane addytywnie przez agenta silnika) pomocnicze czyste funkcje dla kontrolera/UI. */
export { stepTestN, parseIntegerInput, initialTestConfig, initialFreeFlowConfig, poolQuestions } from './pool';
export { reportInfo } from './selectors';
export { computeFreeFlowWeights } from './freeFlowPolicy';
export { domainQuotas } from './testPolicy';
export { isSafeHttpsUrl } from './catalog';

/** Skrót typu wyniku komendy domeny. */
export type DomainCommandResult<V> = CommandResult<DomainOutcome<V>>;

/* ========================================================================== */
/* Bank i katalog                                                             */
/* ========================================================================== */

/**
 * Strukturalna kontrola wczytanego `bank.json` (format `dme-runtime-bank`, `format_version: 1`,
 * wymagane pola). Nieznany format/wersja → `INVALID_BANK`. Nie zakłada liczby pytań.
 */
export function parseRuntimeBank(input: unknown): CommandResult<RuntimeBank> {
  return catalogImpl.parseRuntimeBank(input);
}

/**
 * Buduje katalog WYŁĄCZNIE z wbudowanego banku (od V15 bez paczek): walidacja rekordów (4 różne opcje,
 * istniejący klucz, źródła z rejestru, URL tylko https, brak HTML/skryptów, figury istnieją), wykluczenie
 * ID wyłączonych, grupy profilu, asercja wersji banku. Niepoprawne rekordy → `catalog.issues`, poza pulą.
 */
export function buildCatalog(bank: RuntimeBank, content?: catalogImpl.CatalogContent): CommandResult<Catalog> {
  return catalogImpl.buildCatalog(bank, content);
}

export { parseRetiredIds, parseTrainingProfile, type CatalogContent } from './catalog';
export { CONTENT_RELEASE, CONTENT_RELEASE_LABEL } from './contentRelease';

/* ========================================================================== */
/* Pula, pojemność, walidacja N (DECYZJE §5)                                  */
/* ========================================================================== */

/** Czy pytanie pasuje do aktywnej (nieodwołanej) blokady po `questionId`, `fingerprint` lub `familyId`. */
export function isQuestionBlocked(question: CatalogQuestion, blocks: Readonly<Record<BlockId, Block>>): boolean {
  return poolImpl.isQuestionBlocked(question, blocks);
}

/**
 * Pula dopuszczalna: zakres, trudność (poza `mixed`), aktywne blokady, poprawność rekordu.
 * Pojemność = liczba różnych rodzin. „Moje błędy” NIE zmienia pojemności.
 * @param now potrzebne do liczenia należnych aktywnych błędów (`dueAt ≤ now`)
 */
export function poolFor(
  catalog: Catalog,
  state: UserState,
  scope: Scope,
  difficulty: DifficultyChoice,
  now: IsoDateTime,
): PoolInfo {
  return poolImpl.poolFor(catalog, state, scope, difficulty, now);
}

/** Skrót: pojemność puli (liczba rodzin) dla zakresu i trudności. */
export function capacityFor(catalog: Catalog, state: UserState, scope: Scope, difficulty: DifficultyChoice): number {
  return poolImpl.capacityFor(catalog, state, scope, difficulty);
}

/**
 * Walidacja liczby pytań testu (C01, S05): dozwolona liczba całkowita 1…pojemność.
 * Puste pole, 0, ujemne, ułamki, NaN i wartości > pojemności nie uruchamiają testu.
 * @param raw tekst z pola (`inputmode="numeric"`) albo liczba z przycisków ±10/szybkich wartości
 */
export function validateTestN(raw: string | number, capacity: number): NValidation {
  return poolImpl.validateTestN(raw, capacity);
}

/* ========================================================================== */
/* Start sesji                                                                */
/* ========================================================================== */

export interface StartTestInput {
  /** `targetN` wymagane (zwalidowane `validateTestN`). */
  config: SessionConfig;
  /** 32-bit seed z `crypto.getRandomValues` (kontroler). */
  seed: number;
}

export interface StartSessionValue {
  sessionId: SessionId;
  /** Otwarta wcześniej sesja zamknięta w tej samej zmianie (test → unfinished, FF → ended) albo `null`. */
  closedSessionId: SessionId | null;
}

/**
 * Start niezależnego testu wg TEST_POLICY_V2 (DECYZJE §6): zamrożony plan N slotów z unikalnych
 * rodzin, kwoty domen/poziomów, „Moje błędy” jako pozycje obowiązkowe, tasowanie slotów i opcji seedem.
 * Jeśli istnieje otwarta sesja — zamyka ją w tym samym changesecie. Zapamiętuje konfigurację w ustawieniach.
 * Błędy: `INVALID_N`, `N_EXCEEDS_CAPACITY`, `EMPTY_POOL`, `INVALID_CONFIG`.
 */
export function startTest(
  state: UserState,
  catalog: Catalog,
  input: StartTestInput,
  ctx: CommandContext,
): DomainCommandResult<StartSessionValue> {
  return sessionsImpl.startTest(state, catalog, input, ctx);
}

/**
 * Podgląd rundy „Uwzględnij błędy”/„Nowa runda” (S18): błędne, niezgłoszone pozycje
 * BEZPOŚREDNIEGO rodzica + uzupełnienia do N (najpierw niewidziane, potem najdawniej widziane).
 * Błędy: `SESSION_NOT_FOUND`, `NOT_RETRYABLE` (rodzic nie jest ukończonym testem).
 */
export function previewRetryRound(state: UserState, catalog: Catalog, sourceSessionId: SessionId): CommandResult<RetryPreview> {
  return sessionsImpl.previewRetryRound(state, catalog, sourceSessionId);
}

export interface StartRetryInput {
  sourceSessionId: SessionId;
  seed: number;
}

/**
 * Start rundy „Uwzględnij błędy” (DECYZJE §6 pkt 1a): ta sama konfiguracja i N, sloty
 * `repeated_wrong` (te same pytania; bieżąca rewizja z katalogu albo snapshot rodzica) + `filler`.
 * Ustawia `retry` (parent, chain, roundIndex, repeatedCount) zawsze; przy zerze błędów `repeatedCount = 0`
 * — runda powiązana z rodzicem, ale bez oznaczenia Powtórka (◆ i „Powtórka” tylko przy `repeatedCount > 0`).
 * Błędy: `NOT_RETRYABLE`, `INSUFFICIENT_CAPACITY`.
 */
export function startRetryRound(
  state: UserState,
  catalog: Catalog,
  input: StartRetryInput,
  ctx: CommandContext,
): DomainCommandResult<StartSessionValue> {
  return sessionsImpl.startRetryRound(state, catalog, input, ctx);
}

export interface StartFreeFlowInput {
  /** `targetN = null`. */
  config: SessionConfig;
  seed: number;
}

export interface StartFreeFlowValue extends StartSessionValue {
  /** Pierwszy slot albo `null`, gdy pula pusta (stan `empty`). */
  firstSlotId: SlotId | null;
}

/**
 * Start Free Flow (FREE_FLOW_POLICY_V2, DECYZJE §7) z pierwszym slotem.
 * Zamyka ewentualną otwartą sesję w tym samym changesecie.
 */
export function startFreeFlow(
  state: UserState,
  catalog: Catalog,
  input: StartFreeFlowInput,
  ctx: CommandContext,
): DomainCommandResult<StartFreeFlowValue> {
  return sessionsImpl.startFreeFlow(state, catalog, input, ctx);
}

/* ========================================================================== */
/* Przebieg sesji                                                             */
/* ========================================================================== */

/** Wspólne wejście komend sesji z kontrolą rewizji. */
export interface SessionCommandInput {
  sessionId: SessionId;
  /** `Session.revision`, na której opiera się widok; inna → `STALE_REVISION`. */
  expectedRevision: number;
}

export interface NextFreeFlowValue {
  slotId: SlotId | null;
  /** Pula pusta → stan `empty` (zmień zakres / importuj / zakończ), bez pętli. */
  empty: boolean;
  /** Jednorazowy komunikat „Brak aktywnych błędów w tym zakresie — kontynuujesz zwykłe pytania”. */
  myErrorsExhausted: boolean;
}

/**
 * Free Flow „Dalej”: dobiera i dopisuje kolejny slot (deterministycznie z seeda sesji i licznika),
 * przesuwa `reached`. Wymaga oceny bieżącego slotu.
 */
export function nextFreeFlowSlot(
  state: UserState,
  catalog: Catalog,
  input: SessionCommandInput,
  ctx: CommandContext,
): DomainCommandResult<NextFreeFlowValue> {
  return sessionsImpl.nextFreeFlowSlot(state, catalog, input, ctx);
}

/**
 * Test „Dalej”: przesuwa `reached` na kolejną pozycję planu (bez zmiany planu).
 * Nie jest mutacją punktową (`mutationSeq` bez zmian), zwiększa `revision`.
 */
export function advance(state: UserState, input: SessionCommandInput, ctx: CommandContext): DomainCommandResult<{ reached: number }> {
  return sessionsImpl.advance(state, input, ctx);
}

export interface MarkShownInput {
  sessionId: SessionId;
  slotId: SlotId;
}

/**
 * Pierwsze faktyczne wyświetlenie slotu (DECYZJE §6 pkt 6): `slot.shownAt`, `questionStats.seen*`.
 * Idempotentne (ponowne pokazanie nic nie zmienia → pusty changeset). Nie unieważnia „Cofnij”.
 */
export function markShown(state: UserState, input: MarkShownInput, ctx: CommandContext): DomainCommandResult<{ firstTime: boolean }> {
  return sessionsImpl.markShown(state, input, ctx);
}

export interface AnswerInput extends SessionCommandInput {
  slotId: SlotId;
  optionId: OptionId;
}

export interface AnswerValue {
  correct: boolean;
  /** Powtórzenie tej samej komendy (`ctx.commandId`) — wynik bez zmian, pusty changeset. */
  replayed: boolean;
}

/**
 * Pierwsza odpowiedź w slocie (DECYZJE §4): zapis próby, ocena, REVIEW_POLICY_V1 w `questionStats`,
 * dziennik `attempts`. Idempotentna po `ctx.commandId`. Odrzuca: zamkniętą sesję, nieistniejącą opcję,
 * slot oceniony, slot wykluczony, nieaktualną rewizję (poza identycznym powtórzeniem komendy).
 */
export function answer(state: UserState, input: AnswerInput, ctx: CommandContext): DomainCommandResult<AnswerValue> {
  return sessionsImpl.answer(state, input, ctx);
}

export interface ReportInput {
  /** Sesja, w której zgłoszono (otwarta albo zamknięta w przeglądzie); `null` poza sesją. */
  sessionId: SessionId | null;
  slotId: SlotId | null;
  questionId: QuestionId;
  /** Dla otwartej sesji wymagane; dla zamkniętej/poza sesją `null`. */
  expectedRevision: number | null;
}

export interface ReportValue {
  blockId: BlockId;
  eventId: EventId;
  phase: ReportPhase;
  replacementSlotId: SlotId | null;
  /** Brak zastępstwa — sesja w stanie oczekującym (nie kończy się z N−1). */
  awaitingReplacement: boolean;
  /** Token „Cofnij” tylko dla zgłoszenia w otwartej sesji. */
  undo: UndoToken | null;
}

/**
 * Zgłoszenie (DECYZJE §9) w jednej zmianie: blokada {questionId, revision, fingerprint, familyId},
 * zdarzenie, wykluczenie slotu (przed lub po odpowiedzi), zastępstwo spoza planu i rodzin planu,
 * aktualizacja postępu i przywrócenie stanu powtórek sprzed wykluczonej próby.
 * Free Flow: zgłoszone pytanie zastępuje kolejne. Zamknięta sesja: tylko blokada + `reportedLaterAt`.
 * Błędy: `ALREADY_REPORTED`, `STALE_REVISION`, `SLOT_NOT_FOUND`.
 */
export function reportQuestion(
  state: UserState,
  catalog: Catalog,
  input: ReportInput,
  ctx: CommandContext,
): DomainCommandResult<ReportValue> {
  return reportImpl.reportQuestion(state, catalog, input, ctx);
}

/** Czy token „Cofnij” jest nadal ważny (`session.mutationSeq` bez zmian od zgłoszenia). */
export function isUndoValid(state: UserState, token: UndoToken): boolean {
  return reportImpl.isUndoValid(state, token);
}

/**
 * Atomowe cofnięcie zgłoszenia: przywraca sesję z checkpointu (nowa `revision`), usuwa blokadę,
 * przywraca `questionStats`/`attempts`, zapisuje `report_undone`. Po kolejnej mutacji → `UNDO_EXPIRED`.
 */
export function undoReport(state: UserState, token: UndoToken, ctx: CommandContext): DomainCommandResult<{ sessionId: SessionId }> {
  return reportImpl.undoReport(state, token, ctx);
}

/**
 * Ponowna próba obsadzenia pozycji `awaitingReplacement` (np. po imporcie puli lub „Przywróć”).
 */
export function fillAwaitingReplacements(
  state: UserState,
  catalog: Catalog,
  input: SessionCommandInput,
  ctx: CommandContext,
): DomainCommandResult<{ filled: number; stillAwaiting: number }> {
  return sessionsImpl.fillAwaitingReplacements(state, catalog, input, ctx);
}

/**
 * „Pokaż wynik”: test → `completed` z `result` (próg całkowitoliczbowy). Wymaga `targetN` ważnych
 * odpowiedzi i braku oczekujących zastępstw; inaczej `TEST_NOT_COMPLETE` / `AWAITING_REPLACEMENT`.
 */
export function finishTest(state: UserState, input: SessionCommandInput, ctx: CommandContext): DomainCommandResult<{ result: SessionResult }> {
  return sessionsImpl.finishTest(state, input, ctx);
}

/**
 * „Zamknij test bez wyniku”: test → `unfinished`, `passed = null`, brakujące odpowiedzi NIE są błędami.
 */
export function closeUnfinished(state: UserState, input: SessionCommandInput, ctx: CommandContext): DomainCommandResult<{ sessionId: SessionId }> {
  return sessionsImpl.closeUnfinished(state, input, ctx);
}

/** „Zakończ sesję” Free Flow: → `ended`, podsumowanie bez progu. */
export function endFreeFlow(state: UserState, input: SessionCommandInput, ctx: CommandContext): DomainCommandResult<{ summary: SessionSummary }> {
  return sessionsImpl.endFreeFlow(state, input, ctx);
}

/* ========================================================================== */
/* Blokady i ustawienia                                                       */
/* ========================================================================== */

/** „Przywróć” w ustawieniach: `revokedAt` na blokadzie + zdarzenie; historia bez zmian. */
export function restoreBlock(state: UserState, input: { blockId: BlockId }, ctx: CommandContext): DomainCommandResult<{ blockId: BlockId }> {
  return reportImpl.restoreBlock(state, input, ctx);
}

/** Zmiana ustawień (np. zamknięcie wskazówki instalacji, `persistRequestedAt`). */
export function updateSettings(
  state: UserState,
  patch: Partial<Omit<Settings, 'id' | 'updatedAt'>>,
  ctx: CommandContext,
): DomainCommandResult<Settings> {
  return settingsImpl.updateSettings(state, patch, ctx);
}

/* ========================================================================== */
/* Paczki pytań                                                               */
/* ========================================================================== */

// Walidacja i import paczek mają JEDNO źródło reguł: `src/persistence/packs.ts`
// (`parseAndValidatePack` / `validatePackFile`), używane przez kontroler (LOG-07). Domena dostarcza
// tylko wspólną kontrolę rekordu (`checkRuntimeQuestion`), fingerprint i budowę katalogu z paczek.

/* ========================================================================== */
/* Odczyty pochodne                                                           */
/* ========================================================================== */

/** Otwarta sesja (najwyżej jedna) albo `null`. */
export function activeSession(state: UserState): Session | null {
  return selectorsImpl.activeSession(state);
}

/** Aktywne (nieodwołane) blokady, najnowsze pierwsze — lista „Wykluczone pytania”. */
export function activeBlocks(state: UserState): Block[] {
  return selectorsImpl.activeBlocks(state);
}

/** Postęp: Test = ważne ocenione / N; Free Flow = numer pytania. Bez procentu na żywo. */
export function sessionProgress(session: Session): SessionProgress {
  return selectorsImpl.sessionProgress(session);
}

/** Podsumowanie sesji (wynik, historia, podsumowanie Free Flow). Procent `null` przy 0 ocenionych. */
export function summarizeSession(session: Session): SessionSummary {
  return selectorsImpl.summarizeSession(session);
}

/** Pozycje przeglądu odpowiedzi (S17), z adnotacją „Wykluczone później”. */
export function reviewItems(state: UserState, sessionId: SessionId, filter: 'all' | 'wrong'): ReviewItem[] {
  return selectorsImpl.reviewItems(state, sessionId, filter);
}

/** Historia: testy (ukończone i niedokończone) oraz Free Flow osobno, najnowsze pierwsze. */
export function summarizeHistory(state: UserState): HistorySummary {
  return selectorsImpl.summarizeHistory(state);
}

/** Klucz konfiguracji do filtra „Porównuj podobne testy” (zakres, trudność, N, Moje błędy). */
export function configKey(config: SessionConfig): string {
  return selectorsImpl.configKey(config);
}

/**
 * Punkty wykresu: tylko ukończone testy (oś 0–100%, próg 65%), powtórki oznaczone `isRetry`.
 * Pusta historia → pusta lista (bez NaN, bez udawanego 0%).
 */
export function chartPoints(state: UserState, filter: HistoryFilter): ChartPoint[] {
  return selectorsImpl.chartPoints(state, filter);
}
