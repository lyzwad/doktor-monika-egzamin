/**
 * Przypisanie historii bez profilu do profilu (DECYZJE §16) — czysta funkcja planu zapisu.
 *
 * - sesje, próby, zdarzenia i blokady: suma po kluczu; rekord już obecny w profilu NIE jest nadpisywany
 *   (ponowienie nie cofa zmian zrobionych w profilu po przypisaniu);
 * - statystyki pytań: pytanie tylko w jednej bazie — rekord bez zmian; w obu — wyświetlenia zsumowane,
 *   a liczniki i stan powtórek odtworzone z połączonego dziennika prób (`recomputeStat`);
 * - ustawienia: profil zachowuje własne; ustawienia ze źródła tylko, gdy profil ich nie ma;
 * - sesje otwarte zostają otwarte (domena wznawia najnowszą, nowy start zamyka wszystkie).
 */
import { recomputeStat } from '../domain/review';
import type { Attempt, QuestionStat, UserState, UserStoreName } from '../domain/types';
import type { MergeCounts } from './api';

export type StoreRecords = Record<UserStoreName, unknown[]>;

export interface MergePlan {
  puts: Partial<Record<UserStoreName, unknown[]>>;
  counts: MergeCounts;
}

function minIso(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function maxIso(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

export function planUnassignedMerge(target: StoreRecords, source: UserState): MergePlan {
  const idsOf = (records: unknown[], key: string): Set<string> => new Set(records.map((r) => String((r as Record<string, unknown>)[key])));
  const missing = <T>(records: Readonly<Record<string, T>>, present: Set<string>): T[] =>
    Object.entries(records)
      .filter(([id]) => !present.has(id))
      .map(([, r]) => r);

  const sessions = missing(source.sessions, idsOf(target.sessions, 'id'));
  const attempts = missing(source.attempts, idsOf(target.attempts, 'id'));
  const events = missing(source.events, idsOf(target.events, 'id'));
  const blocks = missing(source.blocks, idsOf(target.blocks, 'id'));

  const targetStats = new Map((target.questionStats as QuestionStat[]).map((s) => [s.questionId, s]));
  const allAttempts = new Map<string, Attempt>();
  for (const a of target.attempts as Attempt[]) allAttempts.set(a.id, a);
  for (const a of Object.values(source.attempts)) if (!allAttempts.has(a.id)) allAttempts.set(a.id, a);
  const questionStats: QuestionStat[] = [];
  for (const stat of Object.values(source.questionStats)) {
    const own = targetStats.get(stat.questionId);
    if (!own) {
      questionStats.push(stat);
      continue;
    }
    const seen: QuestionStat = {
      ...own,
      seenCount: own.seenCount + stat.seenCount,
      firstSeenAt: minIso(own.firstSeenAt, stat.firstSeenAt),
      lastSeenAt: maxIso(own.lastSeenAt, stat.lastSeenAt),
    };
    questionStats.push(recomputeStat(seen, [...allAttempts.values()].filter((a) => a.questionId === stat.questionId)));
  }

  const puts: MergePlan['puts'] = { sessions, attempts, events, blocks, questionStats };
  if (target.settings.length === 0) puts.settings = [source.settings];
  return {
    puts,
    counts: { sessions: sessions.length, attempts: attempts.length, questionStats: questionStats.length, blocks: blocks.length, events: events.length },
  };
}

/** Czy stan zawiera jakąkolwiek historię nauki (ustawienia się nie liczą). */
export function hasLearningData(state: UserState): boolean {
  return (
    Object.keys(state.sessions).length > 0 ||
    Object.keys(state.attempts).length > 0 ||
    Object.keys(state.questionStats).length > 0 ||
    Object.keys(state.blocks).length > 0 ||
    Object.keys(state.events).length > 0
  );
}
