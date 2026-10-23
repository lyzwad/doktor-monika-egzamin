/**
 * REVIEW_POLICY_V1 — kolejka błędów per `questionId` (DECYZJE §8; 03_ARCHITEKTURA §4).
 *
 * - Błędna ważna odpowiedź: `activeError = true`, `streak = 0`, `lastWrongAt`, `lastWrongSessionId`, `dueAt = now`.
 * - Poprawna przy `activeError`:
 *   - `streak = 0`, sesja ≠ `lastWrongSessionId` → `streak = 1`, `dueAt = nextDayStart`, `streakSessionId`;
 *   - `streak = 1`, sesja ≠ `streakSessionId` (i ≠ `lastWrongSessionId`) oraz `now ≥ dueAt` → rozwiązany;
 *   - w pozostałych przypadkach (ta sama sesja, przed terminem) bez zmian.
 * - Kolejny błąd zeruje serię. Próba wykluczona zgłoszeniem nie wpływa na stan (odtwarzanie z dziennika).
 */
import type { Attempt, DomainId, FamilyId, IsoDateTime, QuestionId, QuestionStat, SessionId } from './types';
import { compareIsoNullFirst, compareStrings, isAtOrAfter } from './util';

export function emptyStat(questionId: QuestionId, familyId: FamilyId, domainId: DomainId): QuestionStat {
  return {
    questionId,
    familyId,
    domainId,
    seenCount: 0,
    firstSeenAt: null,
    lastSeenAt: null,
    answeredCount: 0,
    correctCount: 0,
    wrongCount: 0,
    lastAnsweredAt: null,
    activeError: false,
    streak: 0,
    dueAt: null,
    lastWrongAt: null,
    lastWrongSessionId: null,
    streakSessionId: null,
    resolvedAt: null,
  };
}

/** Faktyczne wyświetlenie pytania (`markShown`). */
export function applyShown(stat: QuestionStat, now: IsoDateTime): QuestionStat {
  return { ...stat, seenCount: stat.seenCount + 1, firstSeenAt: stat.firstSeenAt ?? now, lastSeenAt: now };
}

export interface AnswerFacts {
  correct: boolean;
  sessionId: SessionId;
  answeredAt: IsoDateTime;
  /** Początek następnego dnia (Europe/Warsaw) z chwili odpowiedzi. */
  nextDayStart: IsoDateTime;
}

/** Ważna odpowiedź: liczniki + przejście maszyny stanów REVIEW_POLICY_V1. */
export function applyAnswer(stat: QuestionStat, facts: AnswerFacts): QuestionStat {
  const counted: QuestionStat = {
    ...stat,
    answeredCount: stat.answeredCount + 1,
    correctCount: stat.correctCount + (facts.correct ? 1 : 0),
    wrongCount: stat.wrongCount + (facts.correct ? 0 : 1),
    lastAnsweredAt: facts.answeredAt,
  };
  if (!facts.correct) {
    return {
      ...counted,
      activeError: true,
      streak: 0,
      dueAt: facts.answeredAt,
      lastWrongAt: facts.answeredAt,
      lastWrongSessionId: facts.sessionId,
      streakSessionId: null,
      resolvedAt: null,
    };
  }
  if (!stat.activeError) return counted;
  if (stat.streak === 0) {
    if (facts.sessionId === stat.lastWrongSessionId) return counted;
    return { ...counted, streak: 1, dueAt: facts.nextDayStart, streakSessionId: facts.sessionId };
  }
  // streak = 1
  const laterSession = facts.sessionId !== stat.streakSessionId && facts.sessionId !== stat.lastWrongSessionId;
  const afterDue = stat.dueAt === null || isAtOrAfter(facts.answeredAt, stat.dueAt);
  if (laterSession && afterDue) {
    return { ...counted, activeError: false, streak: 0, dueAt: null, streakSessionId: null, resolvedAt: facts.answeredAt };
  }
  return counted;
}

/** Ważne (niewykluczone) próby w kolejności czasu odpowiedzi. */
export function sortAttempts(attempts: readonly Attempt[]): Attempt[] {
  return [...attempts].sort((a, b) => compareIsoNullFirst(a.answeredAt, b.answeredAt) || compareStrings(a.id, b.id));
}

/**
 * Odtworzenie liczników odpowiedzi i stanu powtórek z dziennika ważnych prób (np. po wykluczeniu
 * próby zgłoszeniem). Pola wyświetleń (`seen*`) pozostają bez zmian — pytanie faktycznie widziano.
 */
export function recomputeStat(stat: QuestionStat, attemptsOfQuestion: readonly Attempt[]): QuestionStat {
  let out: QuestionStat = {
    ...emptyStat(stat.questionId, stat.familyId, stat.domainId),
    seenCount: stat.seenCount,
    firstSeenAt: stat.firstSeenAt,
    lastSeenAt: stat.lastSeenAt,
  };
  for (const a of sortAttempts(attemptsOfQuestion.filter((x) => !x.excluded && x.questionId === stat.questionId))) {
    out = applyAnswer(out, {
      correct: a.correct,
      sessionId: a.sessionId,
      answeredAt: a.answeredAt,
      nextDayStart: a.nextDayStart ?? a.answeredAt,
    });
  }
  return out;
}

/** Czy aktywny błąd jest należny (`dueAt ≤ now`). */
export function isDue(stat: QuestionStat | undefined, now: IsoDateTime): boolean {
  return stat !== undefined && stat.activeError && (stat.dueAt === null || isAtOrAfter(now, stat.dueAt));
}

/** Kolejność należności: najpierw najwcześniejszy `dueAt`, potem najdawniej błędne, potem id. */
export function compareByDue(a: QuestionStat, b: QuestionStat): number {
  return compareIsoNullFirst(a.dueAt, b.dueAt) || compareIsoNullFirst(a.lastWrongAt, b.lastWrongAt) || compareStrings(a.questionId, b.questionId);
}
