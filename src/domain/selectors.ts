/**
 * Odczyty pochodne (selektory) — czyste funkcje bez changesetu (SPECYFIKACJA §5, §9; kryteria C03, C05, F04, F05).
 * Historia i przegląd czytają wyłącznie snapshoty slotów, nigdy bieżący katalog.
 */
import { truncatedPercent } from './scoring';
import type {
  Block,
  ChartPoint,
  DmeEvent,
  EventId,
  HistoryFilter,
  HistorySummary,
  ReviewItem,
  Session,
  SessionConfig,
  SessionId,
  SessionProgress,
  SessionSummary,
  SlotId,
  UserState,
} from './types';
import { compareIsoNullFirst, compareStrings } from './util';

/** Ważne (niewykluczone) ocenione sloty planu i poprawne wśród nich. */
export function validCounts(session: Session): { answered: number; correct: number } {
  let answered = 0;
  let correct = 0;
  for (const id of session.plan) {
    const s = session.slots[id];
    if (!s || s.excluded || !s.attempt) continue;
    answered++;
    if (s.attempt.correct) correct++;
  }
  return { answered, correct };
}

/** Otwarta sesja (najwyżej jedna; przy niespójności — najnowsza) albo `null`. */
export function activeSession(state: UserState): Session | null {
  let best: Session | null = null;
  for (const s of Object.values(state.sessions)) {
    if (s.status !== 'open') continue;
    if (!best || compareIsoNullFirst(s.createdAt, best.createdAt) > 0) best = s;
  }
  return best;
}

/** Aktywne (nieodwołane) blokady, najnowsze pierwsze — lista „Wykluczone pytania”. */
export function activeBlocks(state: UserState): Block[] {
  return Object.values(state.blocks)
    .filter((b) => b.revokedAt === null)
    .sort((a, b) => compareIsoNullFirst(b.createdAt, a.createdAt) || compareStrings(b.id, a.id));
}

/** Postęp: Test = ważne ocenione / N; Free Flow = numer pytania. Bez procentu na żywo. */
export function sessionProgress(session: Session): SessionProgress {
  const { answered, correct } = validCounts(session);
  const targetN = session.kind === 'test' ? session.config.targetN : null;
  const awaiting = session.awaitingReplacement.length > 0;
  return {
    kind: session.kind,
    answeredValid: answered,
    correctValid: correct,
    targetN,
    questionNumber: session.reached + 1,
    awaitingReplacement: awaiting,
    readyToFinish: session.kind === 'test' && session.status === 'open' && targetN !== null && answered === targetN && !awaiting,
  };
}

/**
 * Podsumowanie sesji. Procent = poprawne / ważne ocenione (obcięty do 0,1), `null` przy 0 ocenionych.
 * `passed` tylko dla `completed`; Free Flow i unfinished: `null`. Brak odpowiedzi nie jest błędem.
 */
export function summarizeSession(session: Session): SessionSummary {
  const { answered, correct } = validCounts(session);
  const completed = session.kind === 'test' && session.status === 'completed' && session.result !== null;
  return {
    sessionId: session.id,
    kind: session.kind,
    status: session.status,
    config: { ...session.config },
    answeredValid: answered,
    correct: completed && session.result ? session.result.correct : correct,
    targetN: session.kind === 'test' ? session.config.targetN : null,
    percent: completed && session.result ? session.result.percent : truncatedPercent(correct, answered),
    passed: completed && session.result ? session.result.passed : null,
    retry: session.retry ? { ...session.retry } : null,
    createdAt: session.createdAt,
    closedAt: session.closedAt,
  };
}

/** Zgłoszenia slotów sesji (bez cofniętych); `reportedLater` = zgłoszone po zamknięciu. */
export function reportInfo(state: UserState, sessionId: SessionId): { reported: Set<SlotId>; reportedLater: Set<SlotId> } {
  const undone = new Set<EventId>();
  for (const e of Object.values(state.events)) if (e.type === 'report_undone') undone.add(e.reportEventId);
  const session = state.sessions[sessionId];
  if (session) for (const e of session.events) if (e.type === 'report_undone') undone.add(e.reportEventId);
  const reported = new Set<SlotId>();
  const reportedLater = new Set<SlotId>();
  const visit = (e: DmeEvent): void => {
    if (e.type !== 'question_reported' || e.sessionId !== sessionId || e.slotId === null || undone.has(e.id)) return;
    reported.add(e.slotId);
    if (e.reportedLaterAt !== null) reportedLater.add(e.slotId);
  };
  for (const e of Object.values(state.events)) visit(e);
  if (session) for (const e of session.events) visit(e);
  return { reported, reportedLater };
}

/** Pozycje przeglądu odpowiedzi (S17) w kolejności planu, z adnotacją „Wykluczone później”. */
export function reviewItems(state: UserState, sessionId: SessionId, filter: 'all' | 'wrong'): ReviewItem[] {
  const session = state.sessions[sessionId];
  if (!session) return [];
  const { reportedLater } = reportInfo(state, sessionId);
  const items: ReviewItem[] = [];
  session.plan.forEach((slotId, index) => {
    const slot = session.slots[slotId];
    if (!slot) return;
    const status: ReviewItem['status'] = slot.excluded
      ? 'excluded'
      : slot.attempt
        ? slot.attempt.correct
          ? 'correct'
          : 'wrong'
        : 'unanswered';
    if (filter === 'wrong' && status !== 'wrong') return;
    items.push({
      slotId,
      number: index + 1,
      status,
      reportedLater: reportedLater.has(slotId),
      domainId: slot.snapshot.domainId,
      stem: slot.snapshot.stem,
    });
  });
  return items;
}

/** Klucz konfiguracji do filtra „Porównuj podobne testy” (zakres, trudność, N, Moje błędy). */
export function configKey(config: SessionConfig): string {
  return `${config.scope}|${config.difficulty}|${config.targetN ?? '-'}|${config.myErrorsPriority ? 'moje-bledy' : '-'}`;
}

function newestFirst(a: Session, b: Session): number {
  return (
    compareIsoNullFirst(b.closedAt ?? b.updatedAt, a.closedAt ?? a.updatedAt) ||
    compareIsoNullFirst(b.createdAt, a.createdAt) ||
    compareStrings(b.id, a.id)
  );
}

/** Historia: testy (ukończone i niedokończone) oraz Free Flow osobno, najnowsze pierwsze. */
export function summarizeHistory(state: UserState): HistorySummary {
  const sessions = Object.values(state.sessions);
  const tests = sessions.filter((s) => s.kind === 'test' && (s.status === 'completed' || s.status === 'unfinished')).sort(newestFirst);
  const freeFlow = sessions.filter((s) => s.kind === 'freeflow' && s.status === 'ended').sort(newestFirst);
  const configs: HistorySummary['configs'] = [];
  const byKey = new Map<string, HistorySummary['configs'][number]>();
  for (const s of tests) {
    const key = configKey(s.config);
    const entry = byKey.get(key);
    if (entry) entry.count++;
    else {
      const created = { key, config: { ...s.config }, count: 1 };
      byKey.set(key, created);
      configs.push(created);
    }
  }
  return { tests: tests.map(summarizeSession), freeFlow: freeFlow.map(summarizeSession), configs };
}

/**
 * Punkty wykresu: tylko ukończone testy (chronologicznie), powtórki oznaczone `isRetry`,
 * filtr „Moje błędy” w `myErrorsPriority`. Pusta historia → pusta lista (bez NaN, bez udawanego 0%).
 */
export function chartPoints(state: UserState, filter: HistoryFilter): ChartPoint[] {
  return Object.values(state.sessions)
    .filter((s) => s.kind === 'test' && s.status === 'completed' && s.result !== null && Number.isFinite(s.result.percent))
    .filter((s) => filter.kind === 'all' || configKey(s.config) === filter.key)
    .sort((a, b) => compareIsoNullFirst(a.closedAt, b.closedAt) || compareIsoNullFirst(a.createdAt, b.createdAt) || compareStrings(a.id, b.id))
    .map((s) => {
      const result = s.result as NonNullable<Session['result']>;
      return {
        sessionId: s.id,
        at: s.closedAt ?? s.updatedAt,
        percent: result.percent,
        passed: result.passed,
        // Powtórka (◆) tylko, gdy runda faktycznie zawiera błędy rodzica (D02: runda po bezbłędnym rodzicu
        // ma powiązanie z łańcuchem, ale nie jest oznaczana jako powtórka).
        isRetry: s.retry !== null && s.retry.repeatedCount > 0,
        roundIndex: s.retry?.roundIndex ?? null,
        myErrorsPriority: s.config.myErrorsPriority,
        configKey: configKey(s.config),
      };
    });
}
