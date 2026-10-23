/**
 * Snapshot pytania zamrażany w slocie (03_ARCHITEKTURA §3; kryteria B02, F04).
 * Historia i przegląd czytają wyłącznie snapshot — nigdy bieżący katalog.
 */
import { domainTitle } from './catalog';
import { rngFor, shuffle } from './rng';
import type {
  Catalog,
  CatalogFigure,
  CatalogQuestion,
  CommandContext,
  OptionId,
  QuestionSnapshot,
  Slot,
  SlotId,
  SlotOrigin,
  SnapshotFigure,
  SnapshotSource,
  SnapshotTopic,
} from './types';

function figureSnapshot(figure: CatalogFigure | undefined): SnapshotFigure | null {
  return figure ? { id: figure.id, file: figure.file, alt: figure.alt, caption: figure.caption } : null;
}

/** Snapshot pytania z katalogu z opcjami w pokazanej kolejności `optionOrder`. */
export function buildSnapshot(catalog: Catalog, question: CatalogQuestion, optionOrder: readonly OptionId[]): QuestionSnapshot {
  const byId = new Map(question.options.map((o) => [o.id, o]));
  const options = optionOrder.flatMap((id) => {
    const o = byId.get(id);
    return o ? [{ id: o.id, text: o.text }] : [];
  });
  const topics: SnapshotTopic[] = question.topicIds.flatMap((id) => {
    const t = catalog.topics[id];
    return t ? [{ id: t.id, title: t.title, learningObjective: t.learningObjective, pearls: [...t.pearls] }] : [];
  });
  const sources: SnapshotSource[] = question.sourceIds.flatMap((id) => {
    const s = catalog.sources[id];
    return s ? [{ id: s.id, title: s.title, url: s.url, doi: s.doi, pmid: s.pmid, kindPl: s.kindPl, accessPl: s.accessPl }] : [];
  });
  return {
    questionId: question.id,
    revision: question.revision,
    bankVersion: question.origin.bankVersion,
    familyId: question.familyId,
    fingerprint: question.fingerprint,
    domainId: question.domainId,
    domainTitle: domainTitle(catalog, question.domainId),
    topicIds: [...question.topicIds],
    topics,
    difficulty: question.difficulty,
    stem: question.stem,
    options,
    correctOptionId: question.correctOptionId,
    explanation: question.explanation,
    sources,
    sourceLocator: question.sourceLocator,
    figure: figureSnapshot(question.figureId ? catalog.figures[question.figureId] : undefined),
    explanationFigure: figureSnapshot(question.explanationFigureId ? catalog.figures[question.explanationFigureId] : undefined),
    reviewStatus: question.reviewStatus,
    approvedForQuestionKey: question.approvedForQuestionKey,
  };
}

/** Ten sam snapshot (np. rodzica, gdy pytania nie ma już w katalogu) z nową kolejnością opcji. */
export function reorderSnapshot(snapshot: QuestionSnapshot, optionOrder: readonly OptionId[]): QuestionSnapshot {
  const byId = new Map(snapshot.options.map((o) => [o.id, o]));
  return {
    ...snapshot,
    topicIds: [...snapshot.topicIds],
    topics: snapshot.topics.map((t) => ({ ...t, pearls: [...t.pearls] })),
    sources: snapshot.sources.map((s) => ({ ...s })),
    options: optionOrder.flatMap((id) => {
      const o = byId.get(id);
      return o ? [{ ...o }] : [];
    }),
  };
}

/** Kanoniczna kolejność opcji snapshotu (po identyfikatorach) — baza do ponownego tasowania. */
export function canonicalOptionIds(snapshot: QuestionSnapshot): OptionId[] {
  return snapshot.options.map((o) => o.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Kolejność opcji tasowana seedem sesji (sól: rodzaj decyzji + pytanie). */
export function shuffledOptionOrder(ids: readonly OptionId[], seed: number, salt: string): OptionId[] {
  return shuffle(ids, rngFor(seed, `options:${salt}`));
}

export interface NewSlotInput {
  origin: SlotOrigin;
  question: CatalogQuestion | null;
  /** Snapshot zapasowy (pytanie usunięte z katalogu) — opcje zostaną przetasowane. */
  fallback: QuestionSnapshot | null;
  seed: number;
  /** Sól kolejności opcji (unikalna w sesji). */
  salt: string;
  replacesSlotId: SlotId | null;
}

/** Nowy slot z własnym identyfikatorem, snapshotem i potasowaną kolejnością opcji. */
export function createSlot(catalog: Catalog, input: NewSlotInput, ctx: CommandContext): Slot {
  let snapshot: QuestionSnapshot;
  let optionOrder: OptionId[];
  if (input.question) {
    optionOrder = shuffledOptionOrder(
      input.question.options.map((o) => o.id),
      input.seed,
      input.salt,
    );
    snapshot = buildSnapshot(catalog, input.question, optionOrder);
  } else if (input.fallback) {
    optionOrder = shuffledOptionOrder(canonicalOptionIds(input.fallback), input.seed, input.salt);
    snapshot = reorderSnapshot(input.fallback, optionOrder);
  } else {
    throw new Error('createSlot: brak pytania i snapshotu');
  }
  return {
    id: ctx.newId('slot'),
    questionId: snapshot.questionId,
    origin: input.origin,
    snapshot,
    optionOrder,
    attempt: null,
    excluded: null,
    replacesSlotId: input.replacesSlotId,
    createdAt: ctx.now,
    shownAt: null,
  };
}
