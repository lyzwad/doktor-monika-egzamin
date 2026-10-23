/**
 * „Seen” i kolejność preferencji doboru (DECYZJE §6 pkt 4 i 6; 03_ARCHITEKTURA §4).
 *
 * Seen = faktyczne wyświetlenie (`markShown`), nie rezerwacja w planie. Rodzina jest widziana,
 * gdy którekolwiek jej pytanie wyświetlono. Kolejność: nigdy niewidziane (losowo seedem) →
 * widziane wg `lastSeenAt` rosnąco, potem `seenCount` rosnąco.
 */
import { shuffle, type Rng } from './rng';
import type { CatalogQuestion, FamilyId, IsoDateTime, QuestionId, QuestionStat } from './types';
import { compareIsoNullFirst } from './util';

export interface FamilySeen {
  seenCount: number;
  /** Najnowsze wyświetlenie dowolnego pytania rodziny. */
  lastSeenAt: IsoDateTime | null;
}

export interface SeenIndex {
  stats: Readonly<Record<QuestionId, QuestionStat>>;
  families: ReadonlyMap<FamilyId, FamilySeen>;
}

export function buildSeenIndex(stats: Readonly<Record<QuestionId, QuestionStat>>): SeenIndex {
  const families = new Map<FamilyId, FamilySeen>();
  for (const s of Object.values(stats)) {
    if (s.seenCount <= 0) continue;
    const prev = families.get(s.familyId);
    if (!prev) {
      families.set(s.familyId, { seenCount: s.seenCount, lastSeenAt: s.lastSeenAt });
    } else {
      families.set(s.familyId, {
        seenCount: prev.seenCount + s.seenCount,
        lastSeenAt: compareIsoNullFirst(prev.lastSeenAt, s.lastSeenAt) >= 0 ? prev.lastSeenAt : s.lastSeenAt,
      });
    }
  }
  return { stats, families };
}

export function isFamilySeen(index: SeenIndex, familyId: FamilyId): boolean {
  return index.families.has(familyId);
}

function compareSeenRecords(a: FamilySeen | undefined, b: FamilySeen | undefined): number {
  const aSeen = a !== undefined && a.seenCount > 0;
  const bSeen = b !== undefined && b.seenCount > 0;
  if (aSeen !== bSeen) return aSeen ? 1 : -1;
  if (!aSeen || !a || !b) return 0;
  return compareIsoNullFirst(a.lastSeenAt, b.lastSeenAt) || a.seenCount - b.seenCount;
}

/** Rodziny w kolejności preferencji (remisy rozstrzyga tasowanie seedem; sortowanie stabilne). */
export function orderFamilies(families: Iterable<FamilyId>, index: SeenIndex, rng: Rng): FamilyId[] {
  const shuffled = shuffle([...new Set(families)].sort(), rng);
  return shuffled.sort((a, b) => compareSeenRecords(index.families.get(a), index.families.get(b)));
}

function questionSeen(index: SeenIndex, q: CatalogQuestion): FamilySeen | undefined {
  const s = index.stats[q.id];
  return s && s.seenCount > 0 ? { seenCount: s.seenCount, lastSeenAt: s.lastSeenAt } : undefined;
}

/** Pytania w kolejności preferencji (niewidziane najpierw, potem najdawniej widziane). */
export function orderQuestions(questions: readonly CatalogQuestion[], index: SeenIndex, rng: Rng): CatalogQuestion[] {
  const base = [...questions].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return shuffle(base, rng).sort((a, b) => compareSeenRecords(questionSeen(index, a), questionSeen(index, b)));
}

/** Przedstawiciel rodziny: preferuj niewidziane w rodzinie, potem najdawniej widziane. */
export function chooseRepresentative(questions: readonly CatalogQuestion[], index: SeenIndex, rng: Rng): CatalogQuestion | null {
  return orderQuestions(questions, index, rng)[0] ?? null;
}
