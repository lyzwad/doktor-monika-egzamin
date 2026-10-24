/**
 * Zgłoszenie, blokady i cofanie (DECYZJE §9; SPECYFIKACJA §8; 03_ARCHITEKTURA §6; kryteria E01–E06).
 *
 * - Zgłoszenie (jedna zmiana): blokada {questionId, revision, fingerprint, familyId}, zdarzenie,
 *   wykluczenie slotu (przed lub po odpowiedzi), przywrócenie stanu powtórek bez wykluczonej próby,
 *   zastępstwo spoza planu i rodzin planu. Brak zastępstwa w teście → `awaitingReplacement`.
 * - Free Flow: zgłoszenie bieżącego pytania zastępuje je kolejnym doborem; wcześniejsza pozycja
 *   jest tylko wykluczana. Zamknięta sesja: tylko blokada + adnotacja `reportedLaterAt`.
 * - „Cofnij”: ważne, dopóki `mutationSeq` sesji się nie zmieniło; przywraca stan sprzed zgłoszenia
 *   (zachowując późniejsze nie-punktowe postępy: `reached`, wyświetlenia, dopisane sloty Free Flow).
 * - „Przywróć”: `revokedAt` na blokadzie — dotyczy tylko przyszłych losowań.
 */
import type { DomainCommandResult, ReportInput, ReportValue } from './api';
import { poolQuestions } from './pool';
import { recomputeStat } from './review';
import { buildSeenIndex } from './seen';
import { reportInfo } from './selectors';
import { applyFreeFlowPick, MSG, pickForSession } from './sessions';
import { createSlot } from './snapshot';
import { findTestReplacement } from './testPolicy';
import { Tx } from './tx';
import type {
  Block,
  BlockId,
  Catalog,
  CommandContext,
  DmeEvent,
  EventId,
  QuestionSnapshot,
  ReportCheckpoint,
  Session,
  SessionId,
  Slot,
  SlotId,
  UndoToken,
  UserState,
} from './types';
import { fail, ok } from './util';

function blockFor(
  ctx: CommandContext,
  ids: { blockId: BlockId; eventId: EventId },
  content: Pick<QuestionSnapshot, 'questionId' | 'revision' | 'fingerprint' | 'familyId' | 'domainId' | 'stem'>,
  where: { sessionId: SessionId | null; slotId: SlotId | null },
): Block {
  return {
    id: ids.blockId,
    questionId: content.questionId,
    revision: content.revision,
    fingerprint: content.fingerprint,
    familyId: content.familyId,
    domainId: content.domainId,
    stemPreview: content.stem,
    reason: 'reported',
    createdAt: ctx.now,
    sessionId: where.sessionId,
    slotId: where.slotId,
    eventId: ids.eventId,
    revokedAt: null,
  };
}

function hasActiveBlockForQuestion(state: UserState, questionId: string): boolean {
  return Object.values(state.blocks).some((b) => b.revokedAt === null && b.questionId === questionId);
}

const ALREADY = 'To pytanie zostało już zgłoszone.';

/** Zgłoszenie (DECYZJE §9). Błędy: `ALREADY_REPORTED`, `STALE_REVISION`, `SLOT_NOT_FOUND`, `QUESTION_NOT_FOUND`. */
export function reportQuestion(state: UserState, catalog: Catalog, input: ReportInput, ctx: CommandContext): DomainCommandResult<ReportValue> {
  // Poza sesją (np. lista pytań) — tylko blokada.
  if (input.sessionId === null) {
    const q = catalog.questionsById[input.questionId];
    if (!q) return fail('QUESTION_NOT_FOUND', 'Nie znaleziono pytania.');
    if (hasActiveBlockForQuestion(state, q.id)) return fail('ALREADY_REPORTED', ALREADY);
    const tx = new Tx(state, ctx);
    const ids = { blockId: ctx.newId('block'), eventId: ctx.newId('event') };
    tx.putBlock(
      blockFor(ctx, ids, { questionId: q.id, revision: q.revision, fingerprint: q.fingerprint, familyId: q.familyId, domainId: q.domainId, stem: q.stem }, { sessionId: null, slotId: null }),
    );
    tx.addEvent({
      id: ids.eventId,
      at: ctx.now,
      commandId: ctx.commandId,
      type: 'question_reported',
      sessionId: null,
      slotId: null,
      questionId: q.id,
      revision: q.revision,
      blockId: ids.blockId,
      phase: 'outside_session',
      reportedLaterAt: null,
    });
    return ok(tx.commit({ ...ids, phase: 'outside_session' as const, replacementSlotId: null, awaitingReplacement: false, undo: null }));
  }

  const session = state.sessions[input.sessionId];
  if (!session) return fail('SESSION_NOT_FOUND', MSG.sessionNotFound);
  const slot = input.slotId !== null ? session.slots[input.slotId] : undefined;
  if (!slot || slot.questionId !== input.questionId) return fail('SLOT_NOT_FOUND', MSG.slotNotFound);

  // Zamknięta sesja: blokada na przyszłość + adnotacja; wynik i lista pytań bez zmian.
  if (session.status !== 'open') {
    if (slot.excluded || reportInfo(state, session.id).reported.has(slot.id) || hasActiveBlockForQuestion(state, slot.questionId)) {
      return fail('ALREADY_REPORTED', ALREADY);
    }
    const tx = new Tx(state, ctx);
    const ids = { blockId: ctx.newId('block'), eventId: ctx.newId('event') };
    tx.putBlock(blockFor(ctx, ids, slot.snapshot, { sessionId: session.id, slotId: slot.id }));
    tx.addEvent({
      id: ids.eventId,
      at: ctx.now,
      commandId: ctx.commandId,
      type: 'question_reported',
      sessionId: session.id,
      slotId: slot.id,
      questionId: slot.questionId,
      revision: slot.snapshot.revision,
      blockId: ids.blockId,
      phase: 'after_close',
      reportedLaterAt: ctx.now,
    });
    return ok(tx.commit({ ...ids, phase: 'after_close' as const, replacementSlotId: null, awaitingReplacement: false, undo: null }));
  }

  // Otwarta sesja.
  if (input.expectedRevision === null || session.revision !== input.expectedRevision) {
    return fail('STALE_REVISION', MSG.stale, { expectedRevision: input.expectedRevision, revision: session.revision });
  }
  if (slot.excluded) return fail('ALREADY_REPORTED', ALREADY);
  const index = session.plan.indexOf(slot.id);
  if (index < 0) return fail('SLOT_NOT_IN_PLAN', 'To pytanie nie jest już częścią sesji.');
  // Zgłosić można tylko pozycję już osiągniętą (pokazaną) — jak przy odpowiedzi.
  if (index > session.reached) return fail('SLOT_NOT_IN_PLAN', 'To pytanie nie jest jeszcze dostępne.');
  const phase = slot.attempt ? ('after_answer' as const) : ('before_answer' as const);

  const tx = new Tx(state, ctx);
  const ids = { blockId: ctx.newId('block'), eventId: ctx.newId('event') };
  const loggedAttempt = slot.attempt ? state.attempts[slot.attempt.commandId] : undefined;
  const checkpoint: ReportCheckpoint = {
    session,
    questionStats: { [slot.questionId]: state.questionStats[slot.questionId] ?? null },
    attempts: loggedAttempt ? { [loggedAttempt.id]: loggedAttempt } : {},
  };

  tx.putBlock(blockFor(ctx, ids, slot.snapshot, { sessionId: session.id, slotId: slot.id }));
  const reportEvent: DmeEvent = {
    id: ids.eventId,
    at: ctx.now,
    commandId: ctx.commandId,
    type: 'question_reported',
    sessionId: session.id,
    slotId: slot.id,
    questionId: slot.questionId,
    revision: slot.snapshot.revision,
    blockId: ids.blockId,
    phase,
    reportedLaterAt: null,
  };
  tx.addEvent(reportEvent);

  // Wykluczenie slotu i próby; stan powtórek odtworzony z ważnych prób.
  const slots: Record<SlotId, Slot> = { ...session.slots, [slot.id]: { ...slot, excluded: { reason: 'reported', at: ctx.now, eventId: ids.eventId } } };
  const plan = [...session.plan];
  const awaiting = [...session.awaitingReplacement];
  const events: DmeEvent[] = [...session.events, reportEvent];
  if (slot.attempt) {
    if (loggedAttempt) tx.putAttempt({ ...loggedAttempt, excluded: true, excludedReason: 'reported', excludedAt: ctx.now });
    const stat = state.questionStats[slot.questionId];
    if (stat) tx.putStat(recomputeStat(stat, tx.attempts().filter((a) => a.questionId === slot.questionId)));
  }

  let replacementSlotId: SlotId | null = null;
  let awaitingReplacement = false;
  let next: Session = { ...session, slots, plan, awaitingReplacement: awaiting, events };

  if (session.kind === 'test') {
    const pool = poolQuestions(catalog, tx.blocks(), session.config.scope, session.config.difficulty);
    const slotCount = Object.keys(session.slots).length;
    const found = findTestReplacement({
      pool,
      scope: session.config.scope,
      difficulty: session.config.difficulty,
      excludedFamilies: new Set(Object.values(slots).map((s) => s.snapshot.familyId)),
      excludedQuestionIds: new Set(Object.values(slots).map((s) => s.questionId)),
      preferDomain: slot.snapshot.domainId,
      preferDifficulty: slot.snapshot.difficulty,
      seen: buildSeenIndex(tx.stats()),
      seed: session.seed,
      salt: `replacement:${slotCount}`,
      profile: session.allocation.profile ? catalog.profile : null,
      preferQuestionId: slot.questionId,
    });
    if (found) {
      const replacement = createSlot(
        catalog,
        {
          origin: 'replacement',
          question: found.question,
          fallback: null,
          seed: session.seed,
          salt: `replacement:${slotCount}:${found.question.id}`,
          replacesSlotId: slot.id,
        },
        ctx,
      );
      slots[replacement.id] = replacement;
      plan[index] = replacement.id;
      replacementSlotId = replacement.id;
      const ev: DmeEvent = {
        id: ctx.newId('event'),
        at: ctx.now,
        commandId: ctx.commandId,
        type: 'slot_replaced',
        sessionId: session.id,
        excludedSlotId: slot.id,
        replacementSlotId: replacement.id,
        questionId: found.question.id,
      };
      tx.addEvent(ev);
      events.push(ev);
    } else {
      awaiting.push(slot.id);
      awaitingReplacement = true;
      const ev: DmeEvent = { id: ctx.newId('event'), at: ctx.now, commandId: ctx.commandId, type: 'replacement_unavailable', sessionId: session.id, excludedSlotId: slot.id };
      tx.addEvent(ev);
      events.push(ev);
    }
    next = { ...session, slots, plan, awaitingReplacement: awaiting, events };
  } else if (index === session.reached) {
    // Free Flow: zgłoszone bieżące pytanie zastępuje kolejny dobór na tej samej pozycji.
    const pick = pickForSession(catalog, { stats: tx.stats(), attempts: tx.attempts(), blocks: tx.blocks() }, next, ctx.now, index);
    const applied = applyFreeFlowPick(tx, catalog, next, pick, { replaceIndex: pick.question ? index : null, replacesSlotId: pick.question ? slot.id : null });
    next = applied.session;
    replacementSlotId = applied.slotId;
    if (applied.slotId) {
      const ev: DmeEvent = {
        id: ctx.newId('event'),
        at: ctx.now,
        commandId: ctx.commandId,
        type: 'slot_replaced',
        sessionId: session.id,
        excludedSlotId: slot.id,
        replacementSlotId: applied.slotId,
        questionId: next.slots[applied.slotId]?.questionId ?? '',
      };
      tx.addEvent(ev);
      next = { ...next, events: [...next.events, ev] };
    }
  }

  tx.putSession(next, true);
  const undo: UndoToken = {
    sessionId: session.id,
    mutationSeq: tx.nextMutationSeq(session.id),
    reportEventId: ids.eventId,
    blockId: ids.blockId,
    checkpoint,
  };
  return ok(tx.commit({ ...ids, phase, replacementSlotId, awaitingReplacement, undo }));
}

/** Czy token „Cofnij” jest nadal ważny (`session.mutationSeq` bez zmian od zgłoszenia, sesja otwarta). */
export function isUndoValid(state: UserState, token: UndoToken): boolean {
  const session = state.sessions[token.sessionId];
  return session !== undefined && session.status === 'open' && session.mutationSeq === token.mutationSeq && state.blocks[token.blockId] !== undefined;
}

/**
 * Atomowe cofnięcie zgłoszenia: przywraca sesję z checkpointu (nowa `revision`), usuwa blokadę,
 * przywraca `questionStats`/`attempts`, zapisuje `report_undone`. Po kolejnej mutacji → `UNDO_EXPIRED`.
 */
export function undoReport(state: UserState, token: UndoToken, ctx: CommandContext): DomainCommandResult<{ sessionId: SessionId }> {
  if (!isUndoValid(state, token)) {
    return fail('UNDO_EXPIRED', 'Nie można już cofnąć tego zgłoszenia — sesja zmieniła się od tego czasu.');
  }
  const current = state.sessions[token.sessionId] as Session;
  const cp = token.checkpoint.session;
  const reportedSlotId = Object.values(current.slots).find((s) => s.excluded?.eventId === token.reportEventId)?.id ?? null;

  // Sloty: stan z checkpointu + późniejsze nie-punktowe postępy (wyświetlenia, dopisane sloty Free Flow).
  const slots: Record<SlotId, Slot> = { ...cp.slots };
  for (const [id, s] of Object.entries(current.slots)) {
    const before = cp.slots[id];
    if (before) {
      if (before.shownAt === null && s.shownAt !== null) slots[id] = { ...before, shownAt: s.shownAt };
      continue;
    }
    if (s.origin === 'replacement' && s.replacesSlotId === reportedSlotId) continue;
    slots[id] = s;
  }
  const appended = current.plan.slice(cp.plan.length).filter((id) => slots[id] !== undefined);
  const plan = [...cp.plan, ...appended];
  const reached = Math.min(Math.max(cp.reached, current.reached), Math.max(0, plan.length - 1));
  const freeFlow =
    current.freeFlow && cp.freeFlow
      ? { ...current.freeFlow, empty: appended.length > 0 ? current.freeFlow.empty : cp.freeFlow.empty }
      : cp.freeFlow;
  let allocation = cp.allocation;
  if (current.kind === 'freeflow') {
    const domainActual: Session['allocation']['domainActual'] = {};
    for (const id of plan) {
      const s = slots[id];
      if (s && !s.excluded) domainActual[s.snapshot.domainId] = (domainActual[s.snapshot.domainId] ?? 0) + 1;
    }
    allocation = { ...current.allocation, domainActual };
  }

  const undoneEvent: DmeEvent = {
    id: ctx.newId('event'),
    at: ctx.now,
    commandId: ctx.commandId,
    type: 'report_undone',
    sessionId: current.id,
    reportEventId: token.reportEventId,
    blockId: token.blockId,
  };
  const tx = new Tx(state, ctx);
  tx.addEvent(undoneEvent);
  tx.putSession(
    {
      ...cp,
      slots,
      plan,
      reached,
      freeFlow,
      allocation,
      awaitingReplacement: [...cp.awaitingReplacement],
      events: [...current.events, undoneEvent],
    },
    true,
  );
  tx.deleteBlock(token.blockId);
  // Statystyki sprzed zgłoszenia (`null` = zgłoszenie nie zmieniało rekordu — nic do przywrócenia).
  // Wyświetlenia po zgłoszeniu (`markShown`) to fakt, nie mutacja punktowa — zostają, jak `shownAt` slotów.
  for (const saved of Object.values(token.checkpoint.questionStats)) {
    if (!saved) continue;
    const latest = state.questionStats[saved.questionId];
    tx.putStat(latest ? { ...saved, seenCount: latest.seenCount, firstSeenAt: latest.firstSeenAt, lastSeenAt: latest.lastSeenAt } : saved);
  }
  for (const a of Object.values(token.checkpoint.attempts)) tx.putAttempt(a);
  return ok(tx.commit({ sessionId: current.id }));
}

/** „Przywróć” w ustawieniach: `revokedAt` na blokadzie + zdarzenie; historia bez zmian. */
export function restoreBlock(state: UserState, input: { blockId: BlockId }, ctx: CommandContext): DomainCommandResult<{ blockId: BlockId }> {
  const block = state.blocks[input.blockId];
  if (!block) return fail('BLOCK_NOT_FOUND', 'Nie znaleziono wykluczonego pytania.');
  if (block.revokedAt !== null) return fail('BLOCK_ALREADY_REVOKED', 'To pytanie zostało już przywrócone.');
  const tx = new Tx(state, ctx);
  tx.putBlock({ ...block, revokedAt: ctx.now });
  tx.addEvent({ id: ctx.newId('event'), at: ctx.now, commandId: ctx.commandId, type: 'block_revoked', blockId: block.id, questionId: block.questionId });
  return ok(tx.commit({ blockId: block.id }));
}
